/**
 * Calepinage résidentiel — configuration "Petit champ solaire" (sheds) déduite du POLYGONE LIBRE
 * dessiné sur la carte.
 *
 * ÉTAPE 3 de l'unification du calepinage : le modal "Petit champ solaire" ne se synchronise plus
 * sur le formulaire shed de calepinage.html (cf. geometrie_structure/petit_champ_solaire/
 * sync_calepinage_shed.js, qui lit le DOM de la page parente), mais sur la GRILLE DE PANNEAUX
 * réellement posée par le module résidentiel sur le champ PV dessiné (CM.packPanelsForPan).
 * Même principe et même point d'injection que l'Étape 2 (calepinage_maison_dimensions_ombriere.js).
 *
 * Repère : les panneaux d'un pan partagent tous le même `angle`. En pivotant leurs centres de
 * -angle, la grille devient alignée sur les axes :
 *     u = axe de l'égout  -> LONGUEUR d'une rangée de sheds (façade), découpée en groupes
 *     v = axe du rampant  -> empilement des panneaux d'un shed, séparé du shed suivant par
 *                            "Esp. entre sheds"
 *
 * Vocabulaire (identique au calepinage PRO, cf. geometry_engine.py::_compute_shed_grid) :
 *   - RANGÉE de shed : un empilement de L panneaux dans le rampant (CM.state.shedPanelsPerGroup),
 *                      séparé de la rangée suivante par CM.state.shedSpacingM.
 *   - GROUPE de shed : le long d'une rangée, un lot de C panneaux (CM.state.shedPanelsPerRow),
 *                      séparé du lot suivant par CM.state.shedRowGroupSpacingM.
 *   - "LxC"          : L = panneaux en rampant, C = panneaux le long de la façade — c'est le format
 *                      attendu par #pvLayout (parsé par petit_champ_solaire.js::drawFacade et
 *                      updateOverhangsFromCalepinage).
 *
 * Les séparations ne sont PAS relues dans le formulaire : elles sont mesurées sur les écarts réels
 * entre panneaux posés (les réglages ne servent que de seuil de décision), pour que le résultat
 * reste juste quand un contour irrégulier tronque des rangées ou des groupes.
 *
 * Point d'entrée : window.CalepinageMaisonDimensionsPetitChamp
 *   - mesurerSheds(sourceId?)         -> mesure brute (mètres) + détail rangée par rangée
 *   - tableauSheds(sourceId?)         -> "tableau sheds" : mêmes indicateurs que le tableau de
 *                                        résultats shed de calepinage.html (nb de rangées, nb de
 *                                        sheds, groupes par rangée, LxC, dimensions d'un shed,
 *                                        nb de panneaux, puissance)
 *   - valeursPetitChamp(sourceId?, o) -> valeurs prêtes pour le modal, dans SES unités
 *   - injecterDansModal(valeurs?, o)  -> écrit dans le modal "Petit champ solaire" ouvert
 *
 * Les ids visés sont ceux que sync_calepinage_shed.js alimentait déjà depuis le calepinage PRO :
 * remplir les mêmes champs suffit donc, sans toucher au modal ni aux exports PDF/DXF.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // Deux panneaux sont sur la même rangée (resp. colonne) si leurs centres sont distants de moins
    // de 35 % du panneau : les espacements inter-panneaux sont petits devant le panneau lui-même,
    // un seuil plus haut fusionnerait deux rangées voisines. Même constante que l'Étape 2.
    const FRACTION_REGROUPEMENT = 0.35;
    // En dessous de 1 cm, deux écarts sont considérés comme identiques : aucune séparation "large"
    // n'est alors détectable et on ne tente pas de découper en sheds / en groupes.
    const ECART_MINIMAL_M = 0.01;

    function rotate(pt, theta) {
        const c = Math.cos(theta), s = Math.sin(theta);
        return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
    }

    function arrondi(valeur, decimales) {
        const f = Math.pow(10, decimales);
        return Math.round(valeur * f) / f;
    }

    /**
     * Regroupe des points 1D en paquets distants d'au moins `tolerance`.
     * Renvoie [{ centre, indices }] trié par centre croissant — les indices disent quels panneaux
     * appartiennent à quelle rangée / colonne.
     */
    function paquets1D(valeurs, tolerance) {
        const tries = valeurs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const groupes = [];
        let courant = [tries[0]];
        for (let k = 1; k < tries.length; k += 1) {
            if (tries[k].v - courant[courant.length - 1].v <= tolerance) courant.push(tries[k]);
            else { groupes.push(courant); courant = [tries[k]]; }
        }
        groupes.push(courant);
        return groupes.map((g) => ({
            centre: g.reduce((s, p) => s + p.v, 0) / g.length,
            indices: g.map((p) => p.i),
        }));
    }

    /**
     * Seuil de séparation entre deux paquets consécutifs : au-delà, on change de shed (resp. de
     * groupe). Le réglage du formulaire (espacement technique vs espacement de séparation) donne le
     * seuil quand il est exploitable ; sinon on retombe sur la répartition réelle des écarts.
     * Renvoie Infinity quand aucune séparation n'est détectable (= un seul shed / un seul groupe).
     */
    function seuilSeparation(ecarts, espacementTechniqueM, espacementSeparationM) {
        if (espacementSeparationM > espacementTechniqueM + ECART_MINIMAL_M) {
            return (espacementTechniqueM + espacementSeparationM) / 2;
        }
        if (!ecarts.length) return Infinity;
        const min = Math.min.apply(null, ecarts), max = Math.max.apply(null, ecarts);
        if (max - min <= ECART_MINIMAL_M) return Infinity;
        return (min + max) / 2;
    }

    /** Découpe une liste de paquets consécutifs là où l'écart dépasse `seuil`. */
    function decouperParEcart(listePaquets, taillePaquet, seuil) {
        const blocs = [];
        let bloc = [listePaquets[0]];
        const ecartsLarges = [], ecartsSerres = [];
        for (let k = 1; k < listePaquets.length; k += 1) {
            const ecart = listePaquets[k].centre - listePaquets[k - 1].centre - taillePaquet;
            if (ecart > seuil) { ecartsLarges.push(ecart); blocs.push(bloc); bloc = [listePaquets[k]]; }
            else { ecartsSerres.push(ecart); bloc.push(listePaquets[k]); }
        }
        blocs.push(bloc);
        return { blocs, ecartsLarges, ecartsSerres };
    }

    function moyenne(valeurs, defaut) {
        if (!valeurs.length) return defaut;
        return valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
    }

    /**
     * Retrouve l'état d'un champ PV. Sans sourceId, on prend le champ actuellement affiché.
     * Passe par listerChampsCarte() (orchestrateur) qui garantit que TOUS les champs connus sont
     * chargés, y compris ceux jamais rouverts depuis le dernier rechargement de page.
     * Accepte aussi directement un OBJET état (copie modifiée d'un champ) : c'est ainsi que
     * l'optimisation des sheds (calepinage_maison_sheds_actions.js) évalue des variantes sans
     * toucher à l'état réel du champ.
     */
    function etatDuChamp(sourceId) {
        if (sourceId && typeof sourceId === 'object') {
            return (sourceId.pans || []).length ? { sourceId: sourceId.sourceId, state: sourceId } : null;
        }
        if (!sourceId && CM.state && (CM.state.pans || []).length) {
            return { sourceId: CM.state.sourceId, state: CM.state };
        }
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champs = CM.listerChampsCarte();
        if (!champs.length) return null;
        const trouve = sourceId ? champs.find((c) => c.sourceId === sourceId) : champs[0];
        return trouve ? { sourceId: trouve.sourceId, state: trouve.state } : null;
    }

    /** Panneaux réellement posés sur tous les pans du champ, + pente retenue. */
    function poserPanneaux(state) {
        // packPanelsForPan lit CM.state en GLOBAL (obstacles, espacements, dimensions panneau) : on
        // bascule temporairement, exactement comme getAllPvFieldSummaries(), sinon un champ NON
        // affiché serait mesuré avec les réglages du champ affiché.
        const precedent = CM.state;
        CM.state = state;
        let slots = [];
        let penteDeg = 0;
        try {
            (state.pans || []).forEach((pan) => {
                const poses = CM.packPanelsForPan(pan) || [];
                if (!poses.length) return;
                slots = slots.concat(poses);
                if (typeof CM.effectivePenteDegForPan === 'function') {
                    penteDeg = Math.max(penteDeg, CM.effectivePenteDegForPan(pan, state) || 0);
                }
            });
        } finally {
            CM.state = precedent;
        }
        return { slots, penteDeg };
    }

    /**
     * Mesure la grille shed d'un champ PV, en mètres.
     * Renvoie null si rien n'est posé (aucun champ dessiné, contour vide, obstacles couvrant tout).
     */
    function mesurerSheds(sourceId) {
        const champ = etatDuChamp(sourceId);
        if (!champ || typeof CM.packPanelsForPan !== 'function') return null;
        const state = champ.state;
        const pose = poserPanneaux(state);
        const slots = pose.slots;
        if (!slots.length) return null;

        const angle = slots[0].angle || 0;
        const points = slots.map((s) => {
            const c = rotate({ x: s.cx, y: s.cy }, -angle);
            return { u: c.x, v: c.y };
        });
        const largeurPanneauM = Math.max.apply(null, slots.map((s) => s.w || 0));    // le long de l'égout (u)
        const profondeurPanneauM = Math.max.apply(null, slots.map((s) => s.l || 0)); // dans le rampant (v)

        const espXm = (state.panelSpacingXMm || 0) / 1000;
        const espYm = (state.panelSpacingYMm || 0) / 1000;

        // --- Axe v (rampant) : rangées de panneaux, puis regroupement en RANGÉES DE SHED ---------
        const rangeesPanneaux = paquets1D(points.map((p) => p.v), profondeurPanneauM * FRACTION_REGROUPEMENT);
        const ecartsV = rangeesPanneaux.slice(1).map((r, k) =>
            r.centre - rangeesPanneaux[k].centre - profondeurPanneauM);
        const seuilV = seuilSeparation(ecartsV, espYm, state.shedSpacingM || 0);
        let decoupeV = decouperParEcart(rangeesPanneaux, profondeurPanneauM, seuilV);
        // Espacement entre sheds indiscernable de l'espacement Y entre panneaux (ex. 1 mm, permis par
        // les bornes PRO) : aucun écart ne sépare les sheds et tout le champ passerait pour UN shed.
        // Le moteur ne pose que des sheds COMPLETS (calepinage_maison_calculs.js, rowYs tronqué à un
        // multiple de "Nb. PV par shed") : on découpe alors les rangées par paquets de ce nombre.
        const nParShed = Math.max(1, Math.min(15, state.shedPanelsPerGroup || 1));
        const enShed = state.poseMode === 'shed' || (state.pans || []).some((p) => p.poseMode === 'shed');
        if (enShed && decoupeV.blocs.length === 1 && rangeesPanneaux.length > nParShed) {
            const blocs = [];
            for (let k = 0; k < rangeesPanneaux.length; k += nParShed) blocs.push(rangeesPanneaux.slice(k, k + nParShed));
            const ecartsLarges = blocs.slice(1).map((b, k) =>
                b[0].centre - blocs[k][blocs[k].length - 1].centre - profondeurPanneauM);
            decoupeV = { blocs, ecartsLarges, ecartsSerres: [] };
        }

        // --- Axe u (égout) : colonnes de panneaux, puis regroupement en GROUPES DE SHED ----------
        const colonnes = paquets1D(points.map((p) => p.u), largeurPanneauM * FRACTION_REGROUPEMENT);
        const ecartsU = colonnes.slice(1).map((c, k) => c.centre - colonnes[k].centre - largeurPanneauM);
        // Le regroupement le long de la rangée n'existe que s'il a été demandé ET qu'il creuse un
        // écart visible (cf. buildRowOffsets, calepinage_maison_calculs.js : un "Esp. groupe de
        // shed" nul laisse les panneaux enchaînés, donc rien à détecter — une rangée = un shed,
        // exactement comme le backend PRO en mode `no_row_grouping`).
        const groupementActif = (state.shedPanelsPerRow || 0) > 0 && (state.shedRowGroupSpacingM || 0) > 0;
        const seuilU = groupementActif
            ? seuilSeparation(ecartsU, espXm, state.shedRowGroupSpacingM || 0)
            : Infinity;
        const decoupeU = decouperParEcart(colonnes, largeurPanneauM, seuilU);

        // Colonne d'appartenance de chaque panneau -> groupe d'appartenance de chaque panneau.
        const groupeParPanneau = new Map();
        decoupeU.blocs.forEach((bloc, idxGroupe) => {
            bloc.forEach((colonne) => colonne.indices.forEach((i) => groupeParPanneau.set(i, idxGroupe)));
        });
        const colonneParPanneau = new Map();
        colonnes.forEach((colonne, idxColonne) => {
            colonne.indices.forEach((i) => colonneParPanneau.set(i, idxColonne));
        });

        const rangees = decoupeV.blocs.map((bloc, index) => {
            const indices = bloc.reduce((acc, r) => acc.concat(r.indices), []);
            const groupes = new Set();
            const colonnesOccupees = new Set();
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            indices.forEach((i) => {
                groupes.add(groupeParPanneau.get(i));
                colonnesOccupees.add(colonneParPanneau.get(i));
                minU = Math.min(minU, points[i].u - largeurPanneauM / 2);
                maxU = Math.max(maxU, points[i].u + largeurPanneauM / 2);
                minV = Math.min(minV, points[i].v - profondeurPanneauM / 2);
                maxV = Math.max(maxV, points[i].v + profondeurPanneauM / 2);
            });
            return {
                index,
                libelle: 'Rangée ' + (index + 1),
                nbPanneauxRampant: bloc.length,   // L de cette rangée
                nbGroupes: groupes.size,
                nbColonnes: colonnesOccupees.size,
                nbPanneaux: indices.length,
                longueurM: arrondi(maxU - minU, 2),
                // Emprise au sol de la rangée dans le repère REDRESSÉ (u, v) = repère local du champ
                // tourné de -angleGrilleRad ; +v = sens de la normale = côté où regardent les
                // panneaux (bord bas, « avant »). Lu par calepinage_maison_terrain.js pour tracer
                // les lignes de façade et de coupe.
                uMinM: minU, uMaxM: maxU, vMinM: minV, vMaxM: maxV,
            };
        });

        // L (panneaux en rampant) : la rangée la plus fournie fait foi — un contour irrégulier peut
        // tronquer la dernière rangée sans que le shed "type" change pour autant.
        const pvLargeur = Math.max.apply(null, rangees.map((r) => r.nbPanneauxRampant));
        // C (panneaux le long de la façade) : taille du plus grand groupe réellement formé (sans
        // regroupement, le groupe est la rangée entière) — même règle que le backend PRO
        // (effective_rows_for_dims, geometry_engine.py).
        const pvLongueur = groupementActif
            ? Math.max.apply(null, decoupeU.blocs.map((b) => b.length))
            : Math.max.apply(null, rangees.map((r) => r.nbColonnes));

        // Dimensions PHYSIQUES d'un shed : dimensions réelles du panneau (jamais la profondeur
        // projetée par la pente, qui ne sert qu'à l'empreinte au sol) + espacements.
        const paysage = state.panelOrientation === 'paysage';
        const dimRampantMm = paysage ? (state.panelWidthMm || 0) : (state.panelLengthMm || 0);
        const dimFacadeMm = paysage ? (state.panelLengthMm || 0) : (state.panelWidthMm || 0);

        return {
            sourceId: champ.sourceId,
            angleGrilleRad: angle,
            penteDeg: pose.penteDeg,
            orientation: paysage ? 'paysage' : 'portrait',
            panneau: {
                longueurMm: state.panelLengthMm || 0,
                largeurMm: state.panelWidthMm || 0,
                epaisseurMm: state.panelThicknessMm || 0,
                puissanceWc: state.panelPowerWc || 0,
            },
            espacements: {
                xMm: state.panelSpacingXMm || 0,
                yMm: state.panelSpacingYMm || 0,
                // Mesurés sur les panneaux posés, avec repli sur le réglage quand il n'y a qu'un
                // seul shed / un seul groupe (aucun écart à mesurer).
                entreShedsM: arrondi(moyenne(decoupeV.ecartsLarges, state.shedSpacingM || 0), 2),
                entreGroupesM: arrondi(moyenne(decoupeU.ecartsLarges, state.shedRowGroupSpacingM || 0), 2),
            },
            groupementActif,
            rangees,
            nbRangees: rangees.length,
            nbSheds: groupementActif ? rangees.reduce((s, r) => s + r.nbGroupes, 0) : rangees.length,
            nbPanneaux: slots.length,
            pvLargeur,
            pvLongueur,
            shedLargeurRampantM: arrondi(
                (pvLargeur * dimRampantMm + (pvLargeur - 1) * (state.panelSpacingYMm || 0)) / 1000, 2),
            shedLongueurGroupeM: arrondi(
                (pvLongueur * dimFacadeMm + (pvLongueur - 1) * (state.panelSpacingXMm || 0)) / 1000, 2),
        };
    }

    /**
     * "Tableau sheds" : les mêmes indicateurs que le tableau de résultats shed de calepinage.html
     * (Nombre de Sheds, Nb. de rangée de shed, Analyse par rangée / Nb. groupes dans la rangée,
     * Nbre de PV Calepinage (LxC), Dimensions d'un shed, Nombre de panneaux, Puissance), calculés
     * ici depuis le polygone libre du module résidentiel — pour que rien ne soit perdu le jour où
     * calepinage.html disparaîtra (Étape 5).
     */
    function tableauSheds(sourceId) {
        const m = mesurerSheds(sourceId);
        if (!m) return null;
        const surfacePanneauxM2 = (m.nbPanneaux * m.panneau.longueurMm * m.panneau.largeurMm) / 1e6;
        return {
            sourceId: m.sourceId,
            rangees: m.rangees,
            groupesParRangee: m.rangees.map((r) => r.nbGroupes),
            nbRangees: m.nbRangees,
            nbSheds: m.nbSheds,
            nbPanneaux: m.nbPanneaux,
            pvCalepinage: m.pvLargeur + 'L x ' + m.pvLongueur + 'C',
            dimensionsShed: m.shedLargeurRampantM.toFixed(2) + 'm X ' + m.shedLongueurGroupeM.toFixed(2) + 'm',
            shedLargeurRampantM: m.shedLargeurRampantM,
            shedLongueurGroupeM: m.shedLongueurGroupeM,
            surfaceGroupeM2: arrondi(m.shedLargeurRampantM * m.shedLongueurGroupeM, 2),
            surfacePanneauxM2: arrondi(surfacePanneauxM2, 2),
            puissanceKwc: arrondi((m.nbPanneaux * m.panneau.puissanceWc) / 1000, 3),
            penteDeg: m.penteDeg,
            mesure: m,
        };
    }

    /**
     * Traduit la mesure en valeurs attendues par le modal "Petit champ solaire", dans SES unités
     * (mètres pour les espacements de shed, millimètres pour les panneaux et les espacements X/Y).
     * `options.rangee` : index de la rangée analysée (défaut 0), qui pilote "Nb sheds en longueur".
     *
     * Volontairement absents : #facadeLength et #panelWidth, entièrement auto-calculés par le modal
     * lui-même (updateOverhangsFromCalepinage / updatePanelWidthFromRampant, petit_champ_solaire.js)
     * à partir des champs ci-dessous — les écrire ne ferait que se faire écraser au premier recalcul.
     */
    /**
     * Plan de façade d'UNE rangée (demande explicite : "Analyse par rangée : le filtre doit afficher
     * la rangée de shed correspondant au calepinage sur le plan de façade") : nombre de groupes de
     * cette rangée ET sa disposition LxC. Un contour irrégulier donne des rangées de longueurs
     * différentes : sans regroupement, la rangée est un seul shed de `nbColonnes` panneaux — garder
     * le C de la plus longue rangée dessinait toujours la même façade, quelle que soit la rangée.
     */
    function configurationRangee(m, rangee) {
        if (!rangee) return { nbShedGroups: 1, pvLayout: m.pvLargeur + 'L x ' + m.pvLongueur + 'C' };
        const c = m.groupementActif ? m.pvLongueur : rangee.nbColonnes;
        return {
            nbShedGroups: rangee.nbGroupes || 1,
            pvLayout: (rangee.nbPanneauxRampant || m.pvLargeur) + 'L x ' + c + 'C',
        };
    }

    function valeursPetitChamp(sourceId, options) {
        const o = options || {};
        const m = mesurerSheds(sourceId);
        if (!m) return null;
        const rangee = m.rangees[o.rangee || 0] || m.rangees[0];
        const config = configurationRangee(m, rangee);
        return {
            sourceId: m.sourceId,
            roofSlope: arrondi(m.penteDeg, 1),
            nbPanelsRampant: m.pvLargeur,
            panelSpacingY: m.espacements.yMm,
            panelSpacingX: m.espacements.xMm,
            nbShed: m.nbRangees,
            shedSpacing: m.espacements.entreShedsM,
            shedGroupSpacing: m.espacements.entreGroupesM,
            petitPanelLengthMm: m.panneau.longueurMm,
            petitPanelWidthMm: m.panneau.largeurMm,
            petitPanelThicknessMm: m.panneau.epaisseurMm,
            pvLayout: config.pvLayout,
            nbShedGroups: config.nbShedGroups,
            orientation: m.orientation,
            rangeeAnalysee: rangee ? rangee.index : 0,
            // Configuration de façade de CHAQUE rangée, pour le sélecteur "Analyse par rangée".
            rangees: m.rangees.map((r) => Object.assign({}, r, configurationRangee(m, r))),
            mesure: m,
        };
    }

    function trouverChamp(racine, id) {
        if (!racine) return null;
        return racine.getElementById ? racine.getElementById(id) : racine.querySelector('#' + id);
    }

    function ecrireChamp(racine, id, valeur) {
        if (valeur === undefined || valeur === null || valeur === '') return false;
        const el = trouverChamp(racine, id);
        if (!el) return false;
        if (String(el.value) === String(valeur)) return true; // déjà à jour : ne pas relancer les calculs
        el.value = valeur;
        // Même correctif que pour l'ombrière (calepinage_maison_dimensions_ombriere.js) : `racine`
        // est le document d'une iframe, on utilise SON constructeur d'événement.
        const Evenement = ((racine.defaultView || window).Event) || Event;
        el.dispatchEvent(new Evenement('input', { bubbles: true }));
        el.dispatchEvent(new Evenement('change', { bubbles: true }));
        return true;
    }

    /**
     * "Mode de pose des panneaux" : deux boutons, pas un champ — on clique celui qui correspond, et
     * seulement s'il n'est pas déjà actif (sinon le modal redessine pour rien).
     */
    function appliquerOrientation(racine, orientation) {
        const el = trouverChamp(racine, orientation === 'paysage' ? 'panelOrientationPaysage' : 'panelOrientationPortrait');
        if (!el || typeof el.click !== 'function') return false;
        if (el.classList && el.classList.contains && el.classList.contains('active')) return true;
        el.click();
        return true;
    }

    /**
     * "Analyse par rangée" : les options venaient du sélecteur jumeau de calepinage.html
     * (#shedRowSelector, recopiées par sync_calepinage_shed.js::populateFacadeRowSelector) ; elles
     * viennent désormais du tableau mesuré. Mêmes libellés ("Rangée n", valeur = index) pour rester
     * interchangeable avec l'ancien chemin tant que les deux coexistent.
     * Changer de rangée met à jour "Nb sheds en longueur" (#nbShedGroups) depuis ce tableau.
     */
    function remplirSelecteurRangees(racine, rangees, rangeeActive) {
        const select = trouverChamp(racine, 'facadeRowSelector');
        if (!select || !rangees.length || typeof racine.createElement !== 'function') return false;
        const valeurs = rangees.map((r) => String(r.index));
        const actuelles = Array.prototype.slice.call(select.options || []).map((opt) => opt.value);
        const identiques = valeurs.length === actuelles.length && valeurs.every((v, i) => v === actuelles[i]);
        if (!identiques) {
            select.innerHTML = '';
            rangees.forEach((r) => {
                const opt = racine.createElement('option');
                opt.value = String(r.index);
                opt.textContent = r.libelle;
                select.appendChild(opt);
            });
        }
        select.value = String(rangeeActive);
        // CORRECTIF (bug rapporté : "sélectionner une rangée pour afficher la vue de façade ne
        // fonctionne pas") : l'écouteur fermait sur les rangées de la PREMIÈRE injection (il y en a
        // deux par ouverture, cf. geometrieModal.js) ; il lit désormais la liste courante.
        select.__rangeesCalepinage = rangees;

        // Un seul écouteur par sélecteur : le modal est rechargé à chaque ouverture, mais l'injection
        // peut être rejouée sur un modal déjà ouvert.
        if (select.dataset && !select.dataset.calepinageMaisonRangees) {
            select.dataset.calepinageMaisonRangees = 'true';
            select.addEventListener('change', () => {
                const choisie = (select.__rangeesCalepinage || [])
                    .filter((r) => String(r.index) === String(select.value))[0];
                if (!choisie) return;
                // Disposition AVANT le nombre de groupes : chaque écriture relance le dessin.
                if (choisie.pvLayout) ecrireChamp(racine, 'pvLayout', choisie.pvLayout);
                ecrireChamp(racine, 'nbShedGroups', choisie.nbShedGroups || choisie.nbGroupes);
            });
        }
        return true;
    }

    /** Rangée actuellement choisie dans le modal (null si aucune) : une réinjection la conserve. */
    function rangeeAffichee(racine) {
        const select = trouverChamp(racine, 'facadeRowSelector');
        if (!select || select.value === '' || select.value == null) return null;
        const n = parseInt(select.value, 10);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Écrit la configuration dans le modal "Petit champ solaire" actuellement ouvert, puis déclenche
     * 'input'+'change' pour qu'il recalcule ses dessins comme si l'utilisateur avait saisi.
     * N'écrit QUE les champs présents : un id absent ne doit jamais faire échouer l'injection.
     * Renvoie la liste des ids effectivement traités.
     */
    function injecterDansModal(valeurs, options) {
        const o = options || {};
        const racine = o.racine || document;
        const rangeeCourante = rangeeAffichee(racine);
        const v = valeurs || valeursPetitChamp(o.sourceId, (o.rangee == null && rangeeCourante != null)
            ? Object.assign({}, o, { rangee: rangeeCourante }) : o);
        if (!v) return [];
        const aEcrire = {
            roofSlope: v.roofSlope,
            nbPanelsRampant: v.nbPanelsRampant,
            panelSpacingY: v.panelSpacingY,
            panelSpacingX: v.panelSpacingX,
            nbShed: v.nbShed,
            shedSpacing: v.shedSpacing,
            shedGroupSpacing: v.shedGroupSpacing,
            petitPanelLengthMm: v.petitPanelLengthMm,
            petitPanelWidthMm: v.petitPanelWidthMm,
            petitPanelThicknessMm: v.petitPanelThicknessMm,
            pvLayout: v.pvLayout,
            nbShedGroups: v.nbShedGroups,
        };
        const ecrits = [];
        Object.keys(aEcrire).forEach((id) => {
            if (ecrireChamp(racine, id, aEcrire[id])) ecrits.push(id);
        });
        if (appliquerOrientation(racine, v.orientation)) ecrits.push('panelOrientation');
        if (remplirSelecteurRangees(racine, v.rangees || [], v.rangeeAnalysee || 0)) ecrits.push('facadeRowSelector');
        return ecrits;
    }

    // ------------------------------------------------------------------------------------------
    // Modèle de poteaux, variante Double Poteaux et « Hauteur bas PV » : synchronisation
    // BIDIRECTIONNELLE avec le configurateur (demande explicite : "le choix du modèle de poteaux doit
    // être synchronisé entre le formulaire PRO, le modal petit champ solaire et le modal
    // multi-typologie"). Source unique : l'état du champ (petitChampModel, petitChampBracingVariant,
    // petitChampLowPointHeightM), que le formulaire PRO et le modal multi-typologie affichent déjà.
    // ------------------------------------------------------------------------------------------

    // Valeurs de l'état (mêmes que #calepinageMaisonPetitChampModel) -> boutons du configurateur.
    const MODELE_VERS_BOUTON = {
        centre: 'modelSinglePost', excentre: 'modelOffsetPost', double: 'modelDoublePost', bipente: 'modelYShape',
    };
    const BOUTON_VERS_MODELE = {};
    Object.keys(MODELE_VERS_BOUTON).forEach((m) => { BOUTON_VERS_MODELE[MODELE_VERS_BOUTON[m]] = m; });
    const HAUTEUR_BAS_PV_MIN = 0.3;
    const HAUTEUR_BAS_PV_MAX = 5;

    /** Vrai pendant nos propres clics/écritures dans le configurateur : ne pas les renvoyer. */
    let injectionStructureEnCours = false;

    /** État du champ, y compris sans panneau posé (le modèle se règle avant le calepinage). */
    function etatStructure(sourceId) {
        if (CM.state && (!sourceId || CM.state.sourceId === sourceId)) return CM.state;
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champ = CM.listerChampsCarte().find((c) => c.sourceId === sourceId);
        return champ ? champ.state : null;
    }

    function cliquerSiInactif(racine, id) {
        const btn = trouverChamp(racine, id);
        if (!btn || typeof btn.click !== 'function') return false;
        if (!(btn.classList && btn.classList.contains('active'))) btn.click();
        return true;
    }

    /**
     * État du champ -> configurateur. À appeler AVANT injecterDansModal : le clic sur « Double
     * Poteaux » réinitialise des champs du configurateur (#shedSpacing, #heightUnderBrace) que
     * l'injection des dimensions réécrit ensuite.
     */
    function injecterStructureDansModal(options) {
        const o = options || {};
        const racine = o.racine || document;
        const state = etatStructure(o.sourceId);
        if (!state) return [];
        const ecrits = [];
        injectionStructureEnCours = true;
        try {
            const modele = MODELE_VERS_BOUTON[state.petitChampModel] ? state.petitChampModel : 'centre';
            if (cliquerSiInactif(racine, MODELE_VERS_BOUTON[modele])) ecrits.push('postModel');
            if (modele === 'double') {
                const variante = String(state.petitChampBracingVariant || 'v1').toUpperCase();
                if (cliquerSiInactif(racine, 'bracing' + variante)) ecrits.push('bracingVariant');
            }
            if (ecrireChamp(racine, 'lowPointHeight', state.petitChampLowPointHeightM)) ecrits.push('lowPointHeight');
        } finally {
            injectionStructureEnCours = false;
        }
        return ecrits;
    }

    /** Configurateur -> état du champ, puis modal ouvert, formulaire PRO (événement) et sauvegarde. */
    function appliquerRetourStructure(sourceId, maj) {
        const state = etatStructure(sourceId);
        if (!state) return;
        const modifies = Object.keys(maj).filter((k) => maj[k] != null && state[k] !== maj[k]);
        if (!modifies.length) return;
        modifies.forEach((k) => { state[k] = maj[k]; });
        // Même effet qu'un changement de modèle dans le modal (#calepinageMaisonPetitChampModel) :
        // les surcharges 3D du modèle précédent ne s'appliquent plus.
        if (modifies.indexOf('petitChampModel') !== -1) state.petitChampParams = null;
        if (CM.state === state) {
            if (typeof CM.updateEquipmentFieldsUI === 'function') CM.updateEquipmentFieldsUI();
            if (typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
            if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        }
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(state.sourceId || sourceId, 'configurateurPetitChamp');
    }

    /**
     * Branche, une fois par document de configurateur, le retour des choix de l'utilisateur vers
     * l'état. Ignore nos propres injections et la restauration du configurateur (ses clics
     * rejouent une sauvegarde locale/serveur : l'état du champ fait foi, il est réinjecté ensuite
     * sur 'geometrieStructureRestauree').
     */
    function brancherRetourStructure(options) {
        const o = options || {};
        const racine = o.racine;
        if (!racine || typeof racine.addEventListener !== 'function' || racine.__cmRetourStructure) return false;
        racine.__cmRetourStructure = true;
        const sourceId = o.sourceId;
        const geste = () => {
            if (injectionStructureEnCours) return false;
            const vue = racine.defaultView;
            const m = vue && vue.geometrieStructureStorageManager;
            return !(m && (m.isRestoring || !m.initialRestoreDone));
        };
        racine.addEventListener('click', (e) => {
            // Boutons #model-btn-group / #bracing-variant-group, reconnus à leur id (unique).
            const btn = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!btn || !geste()) return;
            if (BOUTON_VERS_MODELE[btn.id]) appliquerRetourStructure(sourceId, { petitChampModel: BOUTON_VERS_MODELE[btn.id] });
            else if (/^bracingV[1-4]$/.test(btn.id)) appliquerRetourStructure(sourceId, { petitChampBracingVariant: btn.id.slice(-2).toLowerCase() });
        });
        racine.addEventListener('change', (e) => {
            if (!e.target || e.target.id !== 'lowPointHeight' || !geste()) return;
            const v = parseFloat(String(e.target.value).replace(',', '.'));
            if (!Number.isFinite(v) || v < HAUTEUR_BAS_PV_MIN || v > HAUTEUR_BAS_PV_MAX) return;
            appliquerRetourStructure(sourceId, { petitChampLowPointHeightM: v });
        });
        // Fin de restauration du configurateur (storage_manager_geometrie_structure.js, ou relecture
        // serveur tardive) : ses clics ont pu remettre un ancien modèle -> on réimpose l'état, puis
        // les dimensions (le clic modèle réinitialise certaines d'entre elles).
        racine.addEventListener('geometrieStructureRestauree', () => {
            injecterStructureDansModal({ racine, sourceId });
            try { injecterDansModal(null, { racine, sourceId }); } catch (err) { /* aucun calepinage */ }
        });
        return true;
    }

    window.CalepinageMaisonDimensionsPetitChamp = {
        mesurerSheds, tableauSheds, valeursPetitChamp, injecterDansModal,
        injecterStructureDansModal, brancherRetourStructure,
        _paquets1D: paquets1D, _seuilSeparation: seuilSeparation, // exposés pour les tests
    };
})();
