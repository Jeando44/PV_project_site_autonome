/**
 * Calepinage résidentiel — dimensions d'ombrière déduites du champ PV dessiné sur la carte.
 *
 * ÉTAPE 2 de l'unification du calepinage : les dimensions d'ombrière ne viennent plus du
 * formulaire de calepinage.html (FormHandler.js) ni du configurateur en iframe
 * (calepinage_ombriere.js), mais du RECTANGLE réellement dessiné dans le module résidentiel.
 *
 * Principe : on ne mesure pas le contour brut, on mesure la GRILLE DE PANNEAUX effectivement
 * posée (CM.packPanelsForPan). C'est elle qui porte la vérité — un contour peut déborder de la
 * zone réellement couverte (marges de bordure, obstacles, arrondi au panneau entier), et c'est la
 * grille, pas le contour, que l'ombrière doit abriter.
 *
 * Repère : les panneaux d'un pan partagent tous le même `angle`. En pivotant leurs centres de
 * -angle, la grille devient alignée sur les axes :
 *     u = axe des rangées      -> longueur de façade de l'ombrière
 *     v = axe de la pente      -> panneaux « liés » (linked_panels_count)
 * `inverserAxes: true` échange les deux si l'ombrière est orientée dans l'autre sens.
 *
 * Point d'entrée : window.CalepinageMaisonDimensionsOmbriere
 *   - mesurerChamp(sourceId?)          -> mesures brutes en mètres (null si rien à mesurer)
 *   - dimensionsOmbriere(sourceId?, o) -> valeurs prêtes pour le modal systèmes (mètres / degrés /
 *                                         "LxC" — les unités du modal, cf. plus bas)
 *   - injecterDansModal(dims?, o)      -> écrit dans les champs du modal ombrière ouvert
 *
 * Les ids visés (facadeLength, linkedPanelsCount, roofSlope, panelWidth, pvLayout…) sont ceux que
 * les exports PDF/DXF relisent déjà tels quels — cf. FIELD_MAP dans
 * export_plans_pdf_dxf/plan_coupe_ombriere_metal.js. Remplir ces champs suffit donc à alimenter
 * l'Étape 4, sans toucher aux exports.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // Deux panneaux sont sur la même rangée si leurs centres sont à moins de la moitié du pas de
    // grille l'un de l'autre. Fraction volontairement basse (35 %) : les espacements inter-panneaux
    // sont petits devant le panneau lui-même, un seuil trop haut fusionnerait deux rangées voisines.
    const FRACTION_REGROUPEMENT = 0.35;

    // Bornes de #lowPointHeight dans ombriere_metal.html — les mêmes que celles posées sur
    // « Hauteur structure égout » côté formulaire (HAUTEUR_EGOUT_OMBRIERE,
    // calepinage_maison_formulaires.js) : une valeur acceptée d'un côté l'est de l'autre.
    const EGOUT_MIN = 2.5;
    const EGOUT_MAX = 15;

    // Vrai pendant nos propres écritures dans la modale : elles déclenchent 'input'/'change' pour
    // que la modale se redessine, et ces événements ne doivent pas repartir vers l'état
    // (cf. brancherRetourOmbriere) — sinon la valeur injectée reviendrait s'y réécrire en boucle.
    let injectionEnCours = false;

    /**
     * Calepinage en SHED : mesure d'UNE table, pas du champ entier (demande explicite — "si vous
     * avez 4 sheds avec Nb. PV par shed = 6 et 30 panneaux en longueur, il faut envoyer les
     * dimensions d'un shed pour 6L x 30C").
     *
     * Même découpage que le rendu 3D du petit champ (computePetitChampShedLayout,
     * calepinage_maison_3d_objects.js) : un module de shed = `groupSize` rangées consécutives (jy) ;
     * une table = une suite de colonnes (jx) CONTIGUËS dans ce module — un trou (bord du polygone,
     * obstacle, "Esp. groupe de shed") commence une nouvelle table. On retient la plus grande table,
     * celle que les plans de coupe et de façade doivent représenter.
     *
     * On mesure au lieu de recopier "Nb. PV par shed" x "Nb. PV en long. par shed" : ces réglages
     * sont des CONSIGNES, la pose réelle peut être plus courte (contour, obstacles) ou libre
     * ("Nb. PV en long." à 0 = remplissage maximal). Repli sur les consignes si rien n'est mesurable.
     * Renvoie { rangees, colonnes } ou null.
     */
    function mesurerTableShed(poses, groupSize) {
        const modules = new Map(); // module de shed -> (colonne jx -> ensemble des rangées jy)
        poses.forEach((pose) => {
            const parts = String(pose.panelIndex || '').split('-');
            const jx = parseInt(parts[0], 10);
            const jy = parseInt(parts[1], 10);
            if (!isFinite(jx) || !isFinite(jy)) return;
            const cle = Math.floor(jy / groupSize);
            if (!modules.has(cle)) modules.set(cle, new Map());
            const colonnes = modules.get(cle);
            if (!colonnes.has(jx)) colonnes.set(jx, new Set());
            colonnes.get(jx).add(jy);
        });

        let meilleure = null;
        modules.forEach((colonnes) => {
            const jxs = Array.from(colonnes.keys()).sort((a, b) => a - b);
            let suite = [];
            const cloturer = () => {
                if (!suite.length) return;
                let rangees = 0;
                suite.forEach((jx) => { rangees = Math.max(rangees, colonnes.get(jx).size); });
                const candidate = { rangees: rangees, colonnes: suite.length };
                if (!meilleure || (candidate.rangees * candidate.colonnes) > (meilleure.rangees * meilleure.colonnes)) {
                    meilleure = candidate;
                }
                suite = [];
            };
            jxs.forEach((jx) => {
                if (suite.length && jx !== suite[suite.length - 1] + 1) cloturer();
                suite.push(jx);
            });
            cloturer();
        });
        return meilleure;
    }

    /**
     * Nombre de rangées et de colonnes d'UN pan, dans le repère de sa propre grille. Même
     * regroupement que la mesure globale, appliqué aux seuls panneaux de ce pan.
     */
    function mesurerGrilleDUnPan(poses) {
        if (!poses.length) return null;
        const angle = poses[0].angle || 0;
        const redresses = poses.map((pose) => {
            const c = rotate({ x: pose.cx, y: pose.cy }, -angle);
            return { u: c.x, v: c.y, demiU: (pose.w || 0) / 2, demiV: (pose.l || 0) / 2 };
        });
        const pasU = Math.max(...redresses.map((x) => x.demiU)) * 2 * FRACTION_REGROUPEMENT;
        const pasV = Math.max(...redresses.map((x) => x.demiV)) * 2 * FRACTION_REGROUPEMENT;
        return {
            colonnes: regrouper(redresses.map((x) => x.u), pasU).length,
            rangees: regrouper(redresses.map((x) => x.v), pasV).length,
        };
    }

    function rotate(pt, theta) {
        const c = Math.cos(theta), s = Math.sin(theta);
        return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
    }

    /** Regroupe des valeurs 1D en paquets distants d'au moins `tolerance`. Renvoie les centres. */
    function regrouper(valeurs, tolerance) {
        const triees = valeurs.slice().sort((a, b) => a - b);
        const paquets = [];
        let courant = [triees[0]];
        for (let i = 1; i < triees.length; i += 1) {
            if (triees[i] - courant[courant.length - 1] <= tolerance) {
                courant.push(triees[i]);
            } else {
                paquets.push(courant);
                courant = [triees[i]];
            }
        }
        paquets.push(courant);
        return paquets.map((p) => p.reduce((s, v) => s + v, 0) / p.length);
    }

    /**
     * Retrouve l'état d'un champ PV. Sans sourceId, on prend le champ actuellement affiché.
     * Passe par listerChampsCarte() (orchestrateur) qui garantit que TOUS les champs connus sont
     * chargés, y compris ceux jamais rouverts depuis le dernier rechargement de page.
     */
    function etatDuChamp(sourceId) {
        if (!sourceId && CM.state && (CM.state.pans || []).length) {
            return { sourceId: CM.state.sourceId, state: CM.state };
        }
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champs = CM.listerChampsCarte();
        if (!champs.length) return null;
        const trouve = sourceId ? champs.find((c) => c.sourceId === sourceId) : champs[0];
        return trouve ? { sourceId: trouve.sourceId, state: trouve.state } : null;
    }

    /**
     * Mesure la grille de panneaux d'un champ PV, en mètres.
     * Renvoie { sourceId, longueurU, longueurV, nbColonnes, nbRangees, nbPanneaux, penteDeg,
     *           poseMode, panneau:{longueur,largeur}, angleGrilleRad }
     */
    function mesurerChamp(sourceId) {
        const champ = etatDuChamp(sourceId);
        if (!champ || typeof CM.packPanelsForPan !== 'function') return null;
        const { state } = champ;
        const pans = state.pans || [];
        if (!pans.length) return null;

        // packPanelsForPan lit CM.state en global (obstacles, espacements, dimensions panneau) :
        // on bascule temporairement, exactement comme getAllPvFieldSummaries() le fait déjà, sinon
        // un champ NON affiché serait mesuré avec les réglages du champ affiché.
        const precedent = CM.state;
        CM.state = state;
        let slots = [];
        let penteDeg = 0;
        let tableShed = null;
        let facadePlan = 0;
        let parPan = null;
        // Joints de dilatation : largeur cumulée (mm) des joints du pan le plus long, ajoutée à la
        // longueur de façade (cf. paramsJointDilatation, calepinage_maison_calculs.js).
        let jointsMm = 0;
        let nbJoints = 0;
        // Taille d'un module de shed = "Nb. PV par shed" (même plafond que le moteur de pose).
        const tailleModule = Math.max(1, Math.min(15, Number(state.shedPanelsPerGroup) || 1));
        try {
            pans.forEach((pan) => {
                const poses = CM.packPanelsForPan(pan) || [];
                if (!poses.length) return;
                if (typeof CM.jointsDilatationDuPan === 'function') {
                    const joints = CM.jointsDilatationDuPan(pan);
                    const cumul = joints.reduce((t, j) => t + j.largeurM * 1000, 0);
                    if (cumul > jointsMm) { jointsMm = cumul; nbJoints = joints.length; }
                }
                slots = slots.concat(poses);
                if (typeof CM.effectivePenteDegForPan === 'function') {
                    penteDeg = Math.max(penteDeg, CM.effectivePenteDegForPan(pan, state) || 0);
                }
                // Grille d'UN pan (le plus fourni). Une ombrière à 2 pans symétriques est portée
                // par un modèle Y : la modale de géométrie y décrit UN BRAS, pas les deux réunis
                // (cf. dimensionsOmbriere). On ne divise pas la mesure globale par 2 : l'espacement
                // entre les deux pans y serait compté une fois de trop.
                const grillePan = mesurerGrilleDUnPan(poses);
                if (grillePan && (!parPan || (grillePan.rangees * grillePan.colonnes)
                        > (parPan.rangees * parPan.colonnes))) {
                    parPan = grillePan;
                }
                // Table de shed mesurée PAN PAR PAN : les index de panneaux (jx-jy) sont propres à
                // chaque pan, les mélanger créerait des tables imaginaires.
                if (pan.poseMode === 'shed' || state.poseMode === 'shed') {
                    const t = mesurerTableShed(poses, tailleModule);
                    if (t && (!tableShed || (t.rangees * t.colonnes) > (tableShed.rangees * tableShed.colonnes))) {
                        tableShed = t;
                    }
                }
            });
            // Emprise du plan du champ MESURÉ (CM.ombrierePlanDims lit CM.state) : relevée ici,
            // pendant la bascule, pour que l'entraxe automatique soit le même dans les trois
            // formulaires (2D, modale de géométrie, 3D).
            if (typeof CM.ombrierePlanDims === 'function') {
                try { facadePlan = (CM.ombrierePlanDims() || {}).facadeLength || 0; } catch (e) { facadePlan = 0; }
            }
        } finally {
            CM.state = precedent;
        }
        if (!slots.length) return null;

        // Tous les panneaux d'une même grille partagent le même angle : on redresse sur les axes.
        const angle = slots[0].angle || 0;
        const redresses = slots.map((s) => {
            const c = rotate({ x: s.cx, y: s.cy }, -angle);
            return { u: c.x, v: c.y, demiU: (s.w || 0) / 2, demiV: (s.l || 0) / 2 };
        });

        const minU = Math.min(...redresses.map((p) => p.u - p.demiU));
        const maxU = Math.max(...redresses.map((p) => p.u + p.demiU));
        const minV = Math.min(...redresses.map((p) => p.v - p.demiV));
        const maxV = Math.max(...redresses.map((p) => p.v + p.demiV));

        const pasU = Math.max(...redresses.map((p) => p.demiU)) * 2 * FRACTION_REGROUPEMENT;
        const pasV = Math.max(...redresses.map((p) => p.demiV)) * 2 * FRACTION_REGROUPEMENT;

        return {
            sourceId: champ.sourceId,
            longueurU: maxU - minU,
            longueurV: maxV - minV,
            nbColonnes: regrouper(redresses.map((p) => p.u), pasU).length,
            nbRangees: regrouper(redresses.map((p) => p.v), pasV).length,
            nbPanneaux: slots.length,
            penteDeg,
            poseMode: state.poseMode,
            // Calepinage en shed : dimensions d'UNE table (null hors shed). Repli sur les consignes
            // du formulaire quand la mesure ne donne rien.
            tableShed: (state.poseMode === 'shed')
                ? (tableShed || {
                    rangees: Math.max(1, Number(state.shedPanelsPerGroup) || 1),
                    colonnes: Math.max(1, Number(state.shedPanelsPerRow) || 1),
                })
                : null,
            // Reportés tels quels vers les modales de géométrie / le formulaire 3D (cf.
            // injecterDansModal) : ils appartiennent au champ PV mesuré, pas au champ affiché.
            typeMontage: (typeof CM.normalizeTypeMontage === 'function')
                ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage,
            // Grille d'UN pan + géométrie de la toiture : de quoi savoir si la structure décrite
            // est un bras de Y (2 pans symétriques) ou la toiture entière.
            parPan: parPan,
            divisionMode: state.divisionMode,
            lastTwoPanKind: state.lastTwoPanKind,
            nbPans: pans.length,
            batimentHeightM: state.batimentHeightM,
            facadePlan: facadePlan,
            entraxeExpr: state.ombriereEntraxeExpr || null,
            // CORRECTIF : `state.panelLength`/`state.panelWidth` n'existent pas — les dimensions du
            // panneau vivent en MILLIMÈTRES dans l'état (panelLengthMm/panelWidthMm, cf. l'état par
            // défaut de l'orchestrateur). Elles ressortaient donc toujours `undefined` en production.
            panneau: {
                longueur: (state.panelLengthMm || 0) / 1000,
                largeur: (state.panelWidthMm || 0) / 1000,
                // Dimension du panneau SELON LE MODE DE POSE, en mm : ce qui compte pour reconstituer
                // les dimensions de l'ombrière (cf. dimensionsOmbriere ci-dessous).
                selonPoseEgoutMm: state.panelOrientation === 'paysage'
                    ? (state.panelLengthMm || 0) : (state.panelWidthMm || 0),
                selonPoseRampantMm: state.panelOrientation === 'paysage'
                    ? (state.panelWidthMm || 0) : (state.panelLengthMm || 0),
            },
            espacements: {
                xMm: state.panelSpacingXMm || 0,
                yMm: state.panelSpacingYMm || 0,
                // "Largeur rail" du système d'intégration (formulaire résidentiel, ombrières
                // uniquement) : delta X ajouté à la longueur — cf. dimensionsOmbriere.
                railMm: state.railWidthMm || 0,
                jointsMm: Math.round(jointsMm),
                nbJoints,
            },
            orientation: state.panelOrientation === 'paysage' ? 'paysage' : 'portrait',
            angleGrilleRad: angle,
        };
    }

    /**
     * Traduit la mesure en valeurs attendues par le modal systèmes (ombrière métal/bois/Solumbra,
     * bâtiment métal), DANS LES UNITÉS DE CE MODAL :
     *   - #facadeLength  : longueur totale de la façade, en MÈTRES (2 décimales)
     *   - #panelWidth    : "Largeur champ PV", en MÈTRES — la largeur du champ dans le rampant, pas
     *                      la largeur d'un panneau
     *   - #pvLayout      : texte "LxC" (L = panneaux dans le rampant, C = panneaux le long de la
     *                      façade), parsé tel quel par les modales et les exports
     *   - #roofSlope     : degrés
     * CORRECTIF (Étape 3) : ces trois premières valeurs étaient produites en millimètres / en mode
     * de pose ('portrait'), alors que les modales — et les exports PDF/DXF qui relisent ces mêmes
     * champs dans le DOM (cf. FIELD_MAP, plan_coupe_ombriere_metal.js) — les attendent comme
     * ci-dessus. Même convention que updateDimensionsFromStorage() dans ombriere_metal.html.
     *
     * CORRECTIF (demande explicite : « les dimensions envoyées pour dessiner les coupes ne sont pas
     * précises ») : les deux longueurs ne sont plus l'ENCOMBREMENT MESURÉ de la grille (distance du
     * bord extérieur du premier panneau au bord extérieur du dernier), mais la dimension
     * RECONSTITUÉE du champ :
     *     largeur  = nb de panneaux dans le rampant x dimension du panneau selon le mode de pose
     *                + les espacements entre panneaux
     *     longueur = idem le long de la façade + « Largeur rail » (delta X du système d'intégration)
     * Deux différences de fond avec la mesure brute : la dimension du panneau utilisée est la
     * dimension PHYSIQUE (jamais la profondeur projetée par la pente, dont la coupe se charge
     * elle-même à partir de #roofSlope), et la largeur du rail vient s'ajouter à la longueur.
     * L'encombrement mesuré reste disponible dans `mesure` (longueurU / longueurV).
     */
    function dimensionsOmbriere(sourceId, options) {
        const o = options || {};
        const m = mesurerChamp(sourceId);
        if (!m) return null;
        // On décrit la STRUCTURE PORTÉE, qui n'est pas toujours la grille entière :
        //  - calepinage en SHED  -> UNE table (demande explicite) ;
        //  - ombrière à 2 pans SYMÉTRIQUES -> UN BRAS. Cette géométrie est portée par un modèle
        //    « Toiture Y » / « Double toiture Y » (cf. syncOmbriereDivision), et la modale de
        //    géométrie attend pour ces modèles la largeur d'UN bras : "panelWidth représente
        //    désormais directement la largeur d'UN bras pour y_shape/doubleYShape"
        //    (effectiveWidthForHeight, ombriere_metal.js). Lui envoyer les deux bras réunis
        //    dessinait une ombrière deux fois trop large (bug rapporté).
        //    ATTENTION : le générateur 3D, lui, prend la largeur TOTALE (chaque bras couvre
        //    panelWidth/2, cf. model_y_shape.js) — il est alimenté par un autre chemin
        //    (getFormOmbriereObject), volontairement laissé tel quel.
        //  - sinon -> la grille complète, comme avant.
        const estBrasDeY = !m.tableShed && !!m.parPan && m.nbPans >= 2
            && typeof m.typeMontage === 'string' && m.typeMontage.indexOf('ombriere') === 0
            && m.divisionMode === '2pans' && m.lastTwoPanKind === 'sym';
        const unite = m.tableShed || (estBrasDeY ? m.parPan : null);
        const rangeesUtiles = unite ? unite.rangees : m.nbRangees;
        const colonnesUtiles = unite ? unite.colonnes : m.nbColonnes;
        const liesDansLaPente = o.inverserAxes ? colonnesUtiles : rangeesUtiles;
        const colonnesFacade = o.inverserAxes ? rangeesUtiles : colonnesUtiles;
        // Axe de la façade / axe du rampant : l'inversion des axes échange aussi la dimension du
        // panneau à prendre en compte, puisqu'elle suit l'axe et non le mode de pose seul.
        const dimFacadeMm = o.inverserAxes ? m.panneau.selonPoseRampantMm : m.panneau.selonPoseEgoutMm;
        const dimPenteMm = o.inverserAxes ? m.panneau.selonPoseEgoutMm : m.panneau.selonPoseRampantMm;
        const espFacadeMm = o.inverserAxes ? m.espacements.yMm : m.espacements.xMm;
        const espPenteMm = o.inverserAxes ? m.espacements.xMm : m.espacements.yMm;

        // Les joints de dilatation coupent la façade (axe de l'égout) : comptés seulement quand la
        // structure décrite est le champ le long de l'égout (pas une table de shed, axes non inversés).
        // Au joint, la largeur du joint remplace l'espacement X (cf. placerColonnesAvecJoints).
        const avecJoints = !m.tableShed && !o.inverserAxes;
        const jointsFacadeMm = avecJoints ? (m.espacements.jointsMm || 0) : 0;
        const nbJointsFacade = avecJoints ? (m.espacements.nbJoints || 0) : 0;
        const facade = (colonnesFacade * dimFacadeMm
            + Math.max(0, colonnesFacade - 1 - nbJointsFacade) * espFacadeMm
            + jointsFacadeMm
            + m.espacements.railMm) / 1000;
        const pente = (liesDansLaPente * dimPenteMm
            + Math.max(0, liesDansLaPente - 1) * espPenteMm) / 1000;
        return {
            sourceId: m.sourceId,
            facadeLength: Math.round(facade * 100) / 100,
            spanLength: Math.round(pente * 100) / 100,
            roofSlope: Math.round(m.penteDeg * 10) / 10,
            linkedPanelsCount: liesDansLaPente,
            pvLayout: `${liesDansLaPente}L x ${colonnesFacade}C`,
            panelWidth: Math.round(pente * 100) / 100,
            poseMode: m.poseMode === 'paysage' ? 'paysage' : 'portrait',
            nbPanneaux: m.nbPanneaux,
            // Shed : rappel explicite que les dimensions ci-dessus décrivent UNE table, et combien
            // de tables le champ en compte (les appelants qui chiffrent, eux, gardent nbPanneaux).
            estShed: !!m.tableShed,
            // Vrai quand les dimensions décrivent UN BRAS d'une ombrière en Y (2 pans symétriques).
            estBrasDeY: estBrasDeY,
            tableShed: m.tableShed,
            nbTablesShed: m.tableShed
                ? Math.max(1, Math.round(m.nbPanneaux / Math.max(1, m.tableShed.rangees * m.tableShed.colonnes)))
                : null,
            // "Hauteur structure égout (m)" : le champ "Hauteur bâtiment" du formulaire 2D pilote
            // #lowPointHeight de la modale (demande explicite). Ombrière MÉTAL seulement — pour le
            // bois et Solumbra ce champ est CALCULÉ (readonly), cf. injecterDansModal.
            lowPointHeight: (m.typeMontage === 'ombriere_metal' && isFinite(m.batimentHeightM))
                ? m.batimentHeightM : null,
            // Entraxes poteaux : la SAISIE de l'utilisateur, telle quelle (null s'il n'a rien saisi).
            // L'entraxe AUTOMATIQUE n'est pas calculé ici : il dépend des porte-à-faux du formulaire
            // destinataire, que seule la modale (ou la fenêtre 3D) connaît — cf. injecterDansModal.
            entraxeSaisi: (typeof CM.validerEntraxeOmbriere === 'function'
                && CM.validerEntraxeOmbriere(m.entraxeExpr).ok)
                ? (CM.validerEntraxeOmbriere(m.entraxeExpr).expr || null) : null,
            mesure: m,
        };
    }

    /**
     * Expression d'entraxes à écrire dans la modale : la saisie de l'utilisateur si elle existe,
     * sinon des travées automatiques d'environ 6 m.
     *
     * CORRECTIF (bug rapporté : « les poteaux s'affichent pour 4*10 mais plus dès que j'ajoute
     * +7 », un seul poteau restant à l'écran) : la modale déduit son porte-à-faux DROIT de
     * `longueur totale - p-à-f gauche - somme des entraxes`. Un entraxe plus long que la structure
     * rend ce porte-à-faux NÉGATIF et le dessin de façade s'effondre, sans message. L'entraxe
     * automatique est donc calé sur la PORTÉE réellement disponible — la longueur de l'ombrière
     * moins les deux porte-à-faux tels que la modale les affiche — et non sur sa longueur totale.
     */
    function entraxePourModale(d, racine) {
        const imp = implantationPourModale(d);
        if (imp) return imp.expr;
        if (d.entraxeSaisi) return d.entraxeSaisi; // choix explicite de l'utilisateur : intouchable
        if (typeof CM.entraxeOmbriereAuto !== 'function') return null;
        const lire = (id) => {
            const el = racine.getElementById ? racine.getElementById(id) : racine.querySelector('#' + id);
            const v = el ? parseFloat(String(el.value).replace(',', '.')) : NaN;
            return isFinite(v) ? v : 0;
        };
        const portee = d.facadeLength - lire('leftOverhang') - lire('rightOverhang');
        return CM.entraxeOmbriereAuto(portee > 1 ? portee : d.facadeLength);
    }

    /**
     * Implantation longitudinale du champ (entraxes + porte-à-faux gauche / droit) pour la longueur
     * transmise à la modale — règle UNIQUE partagée avec le formulaire PRO, la 3D et la carte
     * (CM.poteauxOmbriere.implantationLongitudinale). null si le champ est introuvable.
     */
    function implantationPourModale(d) {
        const P = CM.poteauxOmbriere;
        const champ = (P && d && d.sourceId) ? etatDuChamp(d.sourceId) : null;
        if (!champ || typeof P.implantationLongitudinale !== 'function') return null;
        try { return P.implantationLongitudinale(champ.state, d.facadeLength); } catch (e) { return null; }
    }

    /**
     * Champs « poteaux » à écrire dans la modale métal : #postSpacing (entraxe transversal) et
     * #postEccentricity + bouton « Côté Bas / Haut » (excentrement), d'après l'état du champ PV
     * (calepinage_maison_poteaux_ombriere.js). Rien si la modale n'est pas la modale métal, si elle
     * affiche un autre modèle que le champ (changement de modèle en cours), ou sans saisie.
     */
    function valeursPoteauxPourModale(sourceId, racine) {
        const vide = { champs: {}, boutonCote: null };
        const P = CM.poteauxOmbriere;
        const champ = P && racine && typeDeModale(racine) === 'metal' ? etatDuChamp(sourceId) : null;
        if (!champ) return vide;
        const state = champ.state;
        if (modeleMetalAffiche(racine) !== (state.ombriereMetalModel || 'single')) return vide;
        const t = P.entraxeTransversal(state);
        if (t && t.saisie) vide.champs.postSpacing = t.valeur;
        const ex = P.excentrement(state);
        if (ex) {
            if (ex.saisie) vide.champs.postEccentricity = ex.valeur;
            if (state.ombriereExcentrementCote) vide.boutonCote = ex.cote === 'high' ? 'offsetPosHigh' : 'offsetPosLow';
        }
        return vide;
    }

    /**
     * Écrit les dimensions dans les champs du modal ombrière actuellement ouvert, puis déclenche
     * 'input'+'change' pour que le modal recalcule son dessin comme si l'utilisateur avait saisi.
     * N'écrit QUE les champs présents : les modales ombrière bois/métal/Solumbra n'ont pas
     * exactement le même jeu de champs, et un id absent ne doit jamais faire échouer l'injection.
     * Renvoie la liste des ids effectivement écrits.
     */
    function injecterDansModal(dims, options) {
        const o = options || {};
        const racine = o.racine || document;
        const d = dims || dimensionsOmbriere(o.sourceId, o);
        if (!d) return [];
        if (!d.sourceId && o.sourceId) d.sourceId = o.sourceId;
        const imp = implantationPourModale(d);
        const aEcrire = {
            facadeLength: d.facadeLength,
            roofSlope: d.roofSlope,
            linkedPanelsCount: d.linkedPanelsCount,
            pvLayout: d.pvLayout,
            panelWidth: d.panelWidth,
            // NOUVEAU (demande explicite) : la modale de géométrie suit désormais aussi la hauteur
            // à l'égout et les entraxes de poteaux saisis dans le formulaire.
            lowPointHeight: d.lowPointHeight,
            // Porte-à-faux gauche AVANT les entraxes : son 'input' relance l'entraxe automatique
            // propre à la modale, que les entraxes du champ PV remplacent juste après. Le droit en
            // dernier (la modale le recalcule de toute façon : longueur - gauche - entraxes).
            leftOverhang: imp ? imp.pafG : undefined,
            postDistances: imp ? imp.expr : entraxePourModale(d, racine),
            rightOverhang: imp ? imp.pafD : undefined,
        };
        // Entraxe transversal / excentrement saisis dans le formulaire (modale MÉTAL, modèle affiché =
        // modèle du champ). Seulement une SAISIE : sans elle, le défaut posé par la modale au clic sur
        // le modèle, ou son réglage mémorisé, reste en place — et c'est aussi lui que relisent la
        // carte et la 3D (cf. CM.poteauxOmbriere.entraxeTransversal).
        const poteaux = valeursPoteauxPourModale(d.sourceId || o.sourceId, racine);
        Object.assign(aEcrire, poteaux.champs);
        const ecrits = [];
        injectionEnCours = true;
        try {
        if (poteaux.boutonCote) {
            const b = elementDe(racine, poteaux.boutonCote);
            if (b && !b.disabled && !b.classList.contains('active')) { b.click(); ecrits.push(poteaux.boutonCote); }
        }
        // Ombrière bois : position des pannes (Côté / Dessus = sur la traverse) choisie dans le
        // formulaire PRO ou la fenêtre 3D (state.ombriereBoisPannesPosition).
        const champPannes = typeDeModale(racine) === 'bois' ? etatDuChamp(d.sourceId) : null;
        if (champPannes) {
            const id = champPannes.state.ombriereBoisPannesPosition === 'top' ? 'toolPosPannesTop' : 'toolPosPannesSide';
            const b = elementDe(racine, id);
            if (b && !b.classList.contains('active')) { b.click(); ecrits.push(id); }
        }
        Object.entries(aEcrire).forEach(([id, valeur]) => {
            if (valeur === undefined || valeur === null) return;
            const el = racine.getElementById ? racine.getElementById(id) : racine.querySelector('#' + id);
            if (!el) return;
            // Champ CALCULÉ par la modale (#lowPointHeight en ombrière bois / Solumbra : déduit de la
            // hauteur libre de passage) : y écrire donnerait une valeur que la modale écraserait au
            // recalcul suivant, en affichant entre-temps une cote fausse sur les plans.
            //
            // CORRECTIF : ne tester QUE `readOnly`. `disabled` a la sémantique INVERSE dans ces
            // modales — #facadeLength et #panelWidth y sont `hidden` + `disabled` justement PARCE
            // QUE le calepinage les pilote (bug rapporté : "les dimensions de l'ombrière restent
            // figées sur les valeurs par défaut 39 x 12,40"). Les sauter revenait à ne jamais
            // transmettre les deux dimensions principales du champ PV.
            if (el.readOnly) return;
            // Réinjection à chaud (le calepinage change pendant que la modale est ouverte) : un champ
            // déjà à la bonne valeur n'est ni réécrit ni notifié — sinon chaque recalcul relancerait
            // le redessin complet de la modale, et le retour bidirectionnel du petit champ solaire
            // pourrait boucler.
            if (String(el.value) === String(valeur)) return;
            el.value = valeur;
            // CORRECTIF : `racine` est le document d'une IFRAME (même origine). Un événement
            // construit avec le `Event` de la page HÔTE est étranger à ce document ; on utilise donc
            // le constructeur de la fenêtre de l'iframe quand il est accessible, pour que les
            // écouteurs du configurateur (recalcul des cotes, plans de coupe...) le reçoivent bien.
            const fenetre = (racine.defaultView || window);
            const Evenement = fenetre.Event || Event;
            el.dispatchEvent(new Evenement('input', { bubbles: true }));
            el.dispatchEvent(new Evenement('change', { bubbles: true }));
            ecrits.push(id);
        });
        } finally {
            injectionEnCours = false;
        }
        return ecrits;
    }

    /**
     * Retour MODALE -> état du champ PV, puis formulaire résidentiel, miroir PRO et sauvegarde.
     *
     * CORRECTIF (bug rapporté : « le champ Hauteur structure égout n'est pas synchronisé entre le
     * formulaire PRO et la modale de géométrie ») : la synchronisation n'existait que dans UN sens.
     * Une hauteur (ou des entraxes) saisie dans la modale y restait, et la réinjection suivante la
     * remplaçait par la valeur du formulaire, sans que l'utilisateur comprenne pourquoi.
     *
     * Même principe que brancherRetourStructure du petit champ solaire
     * (calepinage_maison_dimensions_petit_champ.js) : un écouteur par document de modale, nos
     * propres injections ignorées, écriture dans l'état du champ VISÉ (pas du champ affiché).
     */
    function appliquerRetourOmbriere(sourceId, maj) {
        const champ = etatDuChamp(sourceId);
        if (!champ) return false;
        const state = champ.state;
        const modifies = Object.keys(maj).filter((k) => maj[k] != null && state[k] !== maj[k]);
        if (!modifies.length) return false;
        modifies.forEach((k) => { state[k] = maj[k]; });
        // Champ affiché : remettre le formulaire résidentiel en accord tout de suite. recomputeResults
        // émet 'calepinageMaisonEtatRecalcule', qui met à jour le miroir PRO (form_pro.js) et rejoue
        // la réinjection de la modale (geometrieModal.js) — sans effet, la valeur y est déjà.
        if (CM.state === state) {
            if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
            if (typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
            if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        }
        if (typeof CM.persisterEtatChamp === 'function') {
            CM.persisterEtatChamp(state.sourceId || sourceId, 'modaleGeometrieOmbriere');
        }
        return true;
    }

    // ------------------------------------------------------------------------------------------
    // Réglages PROPRES à la modale de géométrie, persistés dans l'état du champ PV
    // ------------------------------------------------------------------------------------------
    // Demande explicite : « vérifier les champs qui ne sont pas persistants dans la BD et les rendre
    // persistants ». Jusqu'ici ces réglages ne vivaient que dans le localStorage de la modale
    // (skv_geometrie_structure_data, storage_manager_geometrie_structure.js) : jamais en base, et
    // effacés à chaque changement de projet (parametreProjetFormManager.js). Ils sont désormais
    // rangés dans `state.ombriereReglagesModale` (clé de PREMIER NIVEAU, cf. PERSISTED_STATE_FIELDS),
    // donc dans calepinage_maison_v1 ET dans la colonne JSON `donnees_completes` — sans migration.
    //
    // Déjà portés par l'état, donc hors de cette liste : « Hauteur structure égout » (batimentHeightM),
    // « Entraxes poteaux » (ombriereEntraxeExpr), le modèle d'ombrière métal (ombriereMetalModel), et
    // « Nbre de pans de toiture » (#linkedPanelsCount), recalculé depuis le calepinage à chaque injection.
    //
    // `communs` : indépendants du modèle de poteaux. `parModele` (métal) : réglages que le clic sur un
    // modèle réinitialise à ses propres valeurs par défaut (entraxe, inclinaison, renfort, hauteur sous
    // renfort) — ils sont donc mémorisés PAR MODÈLE, sans quoi l'entraxe d'un « Double poteaux » (3 m)
    // serait imposé à un « Centrés liaisonnés » (15 m).
    // Ombrières bois / Solumbra (modèles sur mesure) : porte-à-faux uniquement (demande explicite).
    const REGLAGES_MODALE = {
        metal: {
            communs: {
                champs: ['overhangSymValue', 'overhangAsymHigh', 'overhangAsymLow', 'baseAltimetry'],
                boutons: [['overhangSym', 'overhangAsym']],
            },
            parModele: {
                champs: ['heightUnderBrace', 'postSpacing', 'postSpacingInclined', 'postInclinationInclined'],
                boutons: [['reinforceBracons', 'reinforceJarrets']],
            },
        },
        bois: {
            communs: {
                champs: ['overhangSymValue', 'overhangAsymHigh', 'overhangAsymLow'],
                boutons: [['overhangSym', 'overhangAsym']],
            },
        },
        solumbra: {
            communs: {
                champs: ['overhangSymValue', 'overhangAsymHigh', 'overhangAsymLow'],
                boutons: [['overhangSym', 'overhangAsym']],
            },
        },
    };

    // Modèle d'ombrière métal (valeurs de l'état, cf. METAL_MODELS de calepinage_maison_3d_ombriere_form.js)
    // -> bouton de la modale ombriere_metal.html.
    const BOUTON_MODELE_METAL = {
        single: 'modelSinglePost', offset: 'modelOffsetPost', double: 'modelDoublePost',
        inclinedPost: 'modelInclinedPost', linked: 'modelLinkedPost', y_shape: 'modelYShape',
        doubleYShape: 'modelDoubleYShape',
    };
    const MODELE_METAL_DU_BOUTON = {};
    Object.keys(BOUTON_MODELE_METAL).forEach((m) => { MODELE_METAL_DU_BOUTON[BOUTON_MODELE_METAL[m]] = m; });

    function elementDe(racine, id) {
        return racine.getElementById ? racine.getElementById(id) : racine.querySelector('#' + id);
    }
    /** 'metal' | 'bois' | 'solumbra' (window.GEOMETRIE_STRUCTURE_TYPE de la modale), sinon null. */
    function typeDeModale(racine) {
        const fenetre = racine && racine.defaultView;
        const type = fenetre && fenetre.GEOMETRIE_STRUCTURE_TYPE;
        return REGLAGES_MODALE[type] ? type : null;
    }
    function modeleMetalAffiche(racine) {
        const actif = racine.querySelector ? racine.querySelector('#model-btn-group button.active') : null;
        return actif ? (MODELE_METAL_DU_BOUTON[actif.id] || null) : null;
    }
    /** Variante de contreventement active (v1-v6) du modèle « Double poteaux », sinon null. */
    function varianteMetalAffichee(racine) {
        const actif = racine.querySelector ? racine.querySelector('#bracing-variant-group button.active') : null;
        return (actif && /^bracingV[1-6]$/.test(actif.id)) ? actif.id.slice(-2).toLowerCase() : null;
    }
    function lireBloc(racine, def) {
        const bloc = { champs: {}, boutons: [] };
        (def.champs || []).forEach((id) => {
            const el = elementDe(racine, id);
            if (el && String(el.value).trim() !== '') bloc.champs[id] = String(el.value);
        });
        (def.boutons || []).forEach((groupe) => {
            const actif = groupe.find((id) => { const b = elementDe(racine, id); return b && b.classList.contains('active'); });
            if (actif) bloc.boutons.push(actif);
        });
        return bloc;
    }
    function evenement(racine, nom) {
        const fenetre = racine.defaultView || window;
        return new (fenetre.Event || Event)(nom, { bubbles: true });
    }
    // Porte-à-faux gauche / droit et entraxes : portés par l'état du champ PV (injecterDansModal).
    // Des réglages mémorisés avant ce changement peuvent encore les contenir : jamais réappliqués.
    const CHAMPS_PILOTES_PAR_ETAT = ['leftOverhang', 'rightOverhang', 'postDistances'];
    function appliquerBloc(racine, bloc) {
        if (!bloc) return;
        // Boutons d'abord : ils affichent/masquent les champs (p-à-f sym/asym) ou réécrivent une
        // valeur par défaut (renfort -> hauteur sous renfort) que la saisie mémorisée doit remplacer.
        (bloc.boutons || []).forEach((id) => {
            const b = elementDe(racine, id);
            if (b && !b.disabled && !b.classList.contains('active')) b.click();
        });
        Object.keys(bloc.champs || {}).forEach((id) => {
            if (CHAMPS_PILOTES_PAR_ETAT.indexOf(id) !== -1) return;
            const el = elementDe(racine, id);
            if (!el || el.readOnly || String(el.value) === String(bloc.champs[id])) return;
            el.value = bloc.champs[id];
            el.dispatchEvent(evenement(racine, 'input'));
            el.dispatchEvent(evenement(racine, 'change'));
        });
    }

    /**
     * État du champ PV -> modale : modèle de poteaux (métal), puis réglages mémorisés.
     * `complet` faux (réinjection sur recalcul du calepinage) : seul le modèle est accordé, et les
     * réglages ne sont réappliqués QUE si ce modèle vient de changer (son clic les a réinitialisés) —
     * jamais par-dessus une saisie en cours dans la modale.
     * Le MODÈLE est toujours celui de l'état (choisi dans le formulaire, défaut « Centrés ») : la
     * modale démarre sur son propre défaut, qui ne doit jamais remplacer le choix de l'utilisateur.
     * Sans réglages mémorisés pour ce type (projet antérieur à cette persistance), seul le modèle est
     * imposé : pour le reste c'est la modale qui fait foi, et `adopterReglagesModale` les recueille.
     */
    function imposerReglagesModale(options) {
        const o = options || {};
        const racine = o.racine;
        const type = racine && typeDeModale(racine);
        const champ = type && etatDuChamp(o.sourceId);
        if (!champ) return false;
        const state = champ.state;
        const reglages = (state.ombriereReglagesModale && state.ombriereReglagesModale[type]) || null;
        injectionEnCours = true;
        try {
            let modeleChange = false;
            if (type === 'metal' && state.ombriereMetalModel && BOUTON_MODELE_METAL[state.ombriereMetalModel]
                && modeleMetalAffiche(racine) !== state.ombriereMetalModel) {
                const b = elementDe(racine, BOUTON_MODELE_METAL[state.ombriereMetalModel]);
                if (b && !b.disabled) { b.click(); modeleChange = true; }
            }
            // Variante V1-V6 du « Double poteaux » : comme le modèle, l'état fait foi (formulaire
            // 2D / PRO / 3D), à chaque passe.
            if (type === 'metal' && modeleMetalAffiche(racine) === 'double') {
                const v = String(state.ombriereMetalBracingVariant || 'v1').toUpperCase();
                const b = elementDe(racine, 'bracing' + v);
                if (b && !b.disabled && !b.classList.contains('active')) b.click();
            }
            if (reglages && (o.complet || modeleChange)) {
                appliquerBloc(racine, reglages.communs);
                const modele = type === 'metal' ? modeleMetalAffiche(racine) : null;
                if (modele && reglages.parModele) appliquerBloc(racine, reglages.parModele[modele]);
            }
        } finally {
            injectionEnCours = false;
        }
        return true;
    }

    /**
     * Modale -> état du champ PV : relève les réglages affichés et, s'ils diffèrent de ceux
     * mémorisés, les range dans l'état puis sauvegarde (localStorage + base). Remonte aussi le modèle
     * d'ombrière métal choisi dans la modale.
     */
    function adopterReglagesModale(racine, sourceId) {
        const type = typeDeModale(racine);
        const champ = type && etatDuChamp(sourceId);
        if (!champ) return false;
        const state = champ.state;
        const def = REGLAGES_MODALE[type];
        const tous = Object.assign({}, state.ombriereReglagesModale || {});
        const avant = tous[type] || {};
        const apres = { communs: lireBloc(racine, def.communs), parModele: Object.assign({}, avant.parModele || {}) };
        const modele = type === 'metal' ? modeleMetalAffiche(racine) : null;
        if (def.parModele && modele) apres.parModele[modele] = lireBloc(racine, def.parModele);
        if (!def.parModele) delete apres.parModele;
        const reglagesChanges = JSON.stringify(avant) !== JSON.stringify(apres);
        if (reglagesChanges) {
            tous[type] = apres;
            state.ombriereReglagesModale = tous;
        }
        // Variante Double poteaux choisie dans la modale -> état (donc formulaire 2D / PRO / 3D).
        const variante = modele === 'double' ? varianteMetalAffichee(racine) : null;
        let varianteChangee = false;
        if (variante && variante !== (state.ombriereMetalBracingVariant || 'v1')) {
            state.ombriereMetalBracingVariant = variante;
            varianteChangee = true;
            if (CM.state === state && typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
        }
        // Modèle choisi dans la modale : même effet qu'un choix dans la liste du formulaire (la
        // géométrie de toiture suit un choix EXPLICITE de modèle, cf. syncOmbriereDivision).
        if (modele && modele !== state.ombriereMetalModel) {
            const precedent = CM.state;
            CM.state = state;
            try {
                state.ombriereMetalModel = modele;
                state.ombriereParams = null; // surcharges 3D propres à l'ancien modèle
                if (typeof CM.syncOmbriereDivision === 'function') CM.syncOmbriereDivision({ suivreModele: true });
            } finally {
                CM.state = precedent;
            }
            if (CM.state === state) {
                if (typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
                if (typeof CM.render === 'function') CM.render();
                if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
            }
        } else if (!reglagesChanges && !varianteChangee) {
            return false;
        } else if (varianteChangee && CM.state === state && typeof CM.recomputeResults === 'function') {
            CM.recomputeResults(); // 3D ouverte : nouvelle variante
        }
        if (typeof CM.persisterEtatChamp === 'function') {
            CM.persisterEtatChamp(state.sourceId || sourceId, 'reglagesModaleOmbriere');
        }
        return true;
    }

    function brancherRetourOmbriere(options) {
        const o = options || {};
        const racine = o.racine;
        if (!racine || typeof racine.addEventListener !== 'function' || racine.__cmRetourOmbriere) return false;
        racine.__cmRetourOmbriere = true;
        const sourceId = o.sourceId;
        const fenetre = racine.defaultView || null;
        // Événements à ignorer : nos propres injections, et tout ce qui précède / accompagne la
        // restauration interne de la modale (valeurs par défaut posées au démarrage, clics rejoués
        // depuis son localStorage) — ce ne sont pas des choix de l'utilisateur.
        const gestionnaire = () => (fenetre && fenetre.geometrieStructureStorageManager) || null;
        const horsSaisie = () => {
            if (injectionEnCours) return true;
            const g = gestionnaire();
            return !!(g && (g.isRestoring || !g.initialRestoreDone));
        };

        const remonterEntraxes = (el) => {
            if (typeof CM.validerEntraxeOmbriere !== 'function') return;
            const P = CM.poteauxOmbriere;
            const champ = etatDuChamp(sourceId);
            const longueur = (P && champ) ? P.longueurStructure(champ.state) : 0;
            // Mêmes règles que le formulaire PRO (valeurs > 0, max 12,50 m métal / 7,80 m bois,
            // somme + porte-à-faux <= longueur) : une saisie refusée reste dans la modale.
            const v = (P && champ) ? P.validerEntraxesLongitudinaux(champ.state, el.value, longueur) : CM.validerEntraxeOmbriere(el.value);
            if (!v.ok) return;
            // Entraxes AUTOMATIQUES renvoyés tels quels par la modale : ne pas les figer en saisie.
            const imp = (P && champ) ? P.implantationLongitudinale(champ.state, longueur) : null;
            if (imp && imp.auto && v.expr === imp.expr) return;
            // Vide dans la modale = retour à l'entraxe automatique côté formulaire.
            appliquerRetourOmbriere(sourceId, { ombriereEntraxeExpr: v.expr || null });
        };

        // « P-à-F Gauche / Droit » saisis dans la modale -> porte-à-faux du champ PV (un seul des
        // deux fait foi, l'autre redevient automatique). Valeur capturée au moment de la frappe :
        // la modale réécrit aussitôt #rightOverhang (longueur - gauche - entraxes), sans événement.
        const remonterPorteAFaux = (id, valeur) => {
            const P = CM.poteauxOmbriere;
            const champ = P ? etatDuChamp(sourceId) : null;
            if (!champ || !String(valeur).trim()) return;
            const state = champ.state;
            const longueur = P.longueurStructure(state);
            const cote = id === 'rightOverhang' ? 'droit' : 'gauche';
            const v = P.validerPorteAFaux(state, cote, valeur, longueur);
            if (!v.ok) return;
            const imp = P.implantationLongitudinale(state, longueur);
            if (imp && Math.abs((cote === 'droit' ? imp.pafD : imp.pafG) - v.valeur) < 0.005) return;
            const cle = cote === 'droit' ? 'ombrierePorteAFauxDroitM' : 'ombrierePorteAFauxGaucheM';
            state[cote === 'droit' ? 'ombrierePorteAFauxGaucheM' : 'ombrierePorteAFauxDroitM'] = null;
            appliquerRetourOmbriere(sourceId, { [cle]: v.valeur });
        };
        let pafEnAttente = null;
        const viderPaf = () => {
            if (!pafEnAttente) return;
            clearTimeout(pafEnAttente.minuterie);
            const { id, valeur } = pafEnAttente;
            pafEnAttente = null;
            remonterPorteAFaux(id, valeur);
        };

        // « Entraxe (m) » (#postSpacing) / « Excentrement (m) » (#postEccentricity) / « Côté Bas /
        // Haut » saisis dans la modale -> champs « Entraxes poteaux transversaux » / « Excentrement
        // poteaux » du formulaire (calepinage_maison_poteaux_ombriere.js). Uniquement quand la modale
        // affiche le modèle du champ ; une valeur hors bornes reste dans la modale (qui la signale).
        const remonterPoteaux = (el) => {
            const P = CM.poteauxOmbriere;
            const champ = P && typeDeModale(racine) === 'metal' ? etatDuChamp(sourceId) : null;
            if (!champ || modeleMetalAffiche(racine) !== (champ.state.ombriereMetalModel || 'single')) return;
            const state = champ.state;
            if (el.id === 'postSpacing') {
                const t = P.entraxeTransversal(state);
                if (!t || !String(el.value).trim()) return;
                const v = P.validerEntraxeTransversal(t.modele, el.value);
                if (!v.ok || v.valeur === t.valeur) return;
                const apres = Object.assign({}, state.ombriereEntraxeTransversalParModele || {});
                apres[t.modele] = v.valeur;
                appliquerRetourOmbriere(sourceId, { ombriereEntraxeTransversalParModele: apres });
            } else if (el.id === 'postEccentricity') {
                const ex = P.excentrement(state);
                if (!ex || !String(el.value).trim()) return;
                const v = P.validerExcentrement(el.value);
                if (!v.ok || v.valeur === ex.valeur) return;
                appliquerRetourOmbriere(sourceId, { ombriereExcentrementM: v.valeur });
            } else if (el.id === 'offsetPosLow' || el.id === 'offsetPosHigh') {
                if (!P.excentrement(state)) return;
                appliquerRetourOmbriere(sourceId, { ombriereExcentrementCote: el.id === 'offsetPosHigh' ? 'high' : 'low' });
            }
        };
        let poteauxEnAttente = null;
        const viderPoteaux = () => {
            if (!poteauxEnAttente) return;
            clearTimeout(poteauxEnAttente.minuterie);
            const el = poteauxEnAttente.el;
            poteauxEnAttente = null;
            remonterPoteaux(el);
        };

        // CORRECTIF (bug critique rapporté : « les Entraxes poteaux ne sont pas persistants, perdus au
        // rechargement ») : ils ne remontaient vers l'état que sur 'change', c.-à-d. à la PERTE DU
        // FOCUS. Taper « 3*6+5 » puis fermer la modale ou recharger la page sans quitter le champ les
        // perdait — la modale elle-même ne les sauvegarde pas (exclus de son stockage). Ils remontent
        // désormais aussi pendant la frappe (anti-rebond), et tout ce qui est en attente est vidé à la
        // fermeture de la modale ('pagehide' de l'iframe).
        let entraxesEnAttente = null;
        let reglagesEnAttente = null;
        const viderEntraxes = () => {
            if (!entraxesEnAttente) return;
            clearTimeout(entraxesEnAttente.minuterie);
            const el = entraxesEnAttente.el;
            entraxesEnAttente = null;
            remonterEntraxes(el);
        };
        const viderReglages = () => {
            if (!reglagesEnAttente) return;
            clearTimeout(reglagesEnAttente);
            reglagesEnAttente = null;
            adopterReglagesModale(racine, sourceId);
        };
        const programmerReglages = () => {
            clearTimeout(reglagesEnAttente);
            reglagesEnAttente = setTimeout(viderReglages, 300);
        };

        racine.addEventListener('input', (e) => {
            const el = e.target;
            if (!el || !el.id || horsSaisie()) return;
            if (el.id === 'postDistances') {
                if (entraxesEnAttente) clearTimeout(entraxesEnAttente.minuterie);
                entraxesEnAttente = { el, minuterie: setTimeout(viderEntraxes, 300) };
            } else if (el.id === 'leftOverhang' || el.id === 'rightOverhang') {
                if (pafEnAttente) clearTimeout(pafEnAttente.minuterie);
                pafEnAttente = { id: el.id, valeur: String(el.value), minuterie: setTimeout(viderPaf, 300) };
            } else {
                if (el.id === 'postSpacing' || el.id === 'postEccentricity') {
                    if (poteauxEnAttente) clearTimeout(poteauxEnAttente.minuterie);
                    poteauxEnAttente = { el, minuterie: setTimeout(viderPoteaux, 300) };
                }
                programmerReglages();
            }
        });
        racine.addEventListener('change', (e) => {
            const el = e.target;
            if (!el || !el.id || injectionEnCours) return;
            if (el.id === 'lowPointHeight') {
                // Ombrière bois / Solumbra : champ CALCULÉ (readonly) — rien à remonter.
                if (el.readOnly) return;
                // CORRECTIF (bug rapporté : « la Hauteur structure égout saisie dans le formulaire PRO
                // revient à la valeur par défaut dès que j'ouvre la modale de géométrie ») : à son
                // ouverture, la modale pose ses valeurs par défaut (clic sur le modèle) puis rejoue
                // SON localStorage, chacun avec un 'change' sur #lowPointHeight. Remontés tels quels,
                // ils écrasaient batimentHeightM ; la réinjection de fin de restauration
                // ('geometrieStructureRestauree') recopiait ensuite cette valeur périmée partout.
                // Seule une saisie de l'utilisateur, après la restauration, doit remonter.
                if (horsSaisie()) return;
                const v = parseFloat(String(el.value).replace(',', '.'));
                if (!isFinite(v) || v < EGOUT_MIN || v > EGOUT_MAX) return;
                appliquerRetourOmbriere(sourceId, { batimentHeightM: v });
            } else if (el.id === 'postDistances') {
                if (entraxesEnAttente) { viderEntraxes(); return; }
                if (!horsSaisie()) remonterEntraxes(el);
            } else if (el.id === 'leftOverhang' || el.id === 'rightOverhang') {
                viderPaf();
            } else if (!horsSaisie()) {
                if (el.id === 'postSpacing' || el.id === 'postEccentricity') {
                    if (poteauxEnAttente) viderPoteaux(); else remonterPoteaux(el);
                }
                programmerReglages();
            }
        });
        // Boutons (modèle de poteaux, type de renfort, porte-à-faux sym./asym.) : pas d'input/change.
        racine.addEventListener('click', (e) => {
            const bouton = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!bouton || horsSaisie()) return;
            if (bouton.id === 'offsetPosLow' || bouton.id === 'offsetPosHigh') remonterPoteaux(bouton);
            // Ombrière bois : pannes « Dessus » (sur la traverse) / « Côté » de la vue en coupe.
            if ((bouton.id === 'toolPosPannesTop' || bouton.id === 'toolPosPannesSide') && typeDeModale(racine) === 'bois') {
                appliquerRetourOmbriere(sourceId, { ombriereBoisPannesPosition: bouton.id === 'toolPosPannesTop' ? 'top' : 'side' });
            }
            programmerReglages();
        });
        if (fenetre) {
            fenetre.addEventListener('pagehide', () => { viderEntraxes(); viderPaf(); viderPoteaux(); viderReglages(); });
        }
        // Fin de la restauration interne de la modale (1,5 s après son chargement, cf.
        // storage_manager_geometrie_structure.js) : elle rejoue le clic du modèle mémorisé dans SON
        // localStorage, ce qui réinitialise entraxes et hauteurs. L'état du champ PV reprend la main
        // — ou, s'il ne connaît encore aucun réglage (projet antérieur), il adopte ceux de la modale.
        racine.addEventListener('geometrieStructureRestauree', () => {
            const type = typeDeModale(racine);
            const champ = type && etatDuChamp(sourceId);
            if (!champ) return;
            const connus = champ.state.ombriereReglagesModale && champ.state.ombriereReglagesModale[type];
            imposerReglagesModale({ racine, sourceId, complet: true }); // sans réglages : le modèle seul
            injecterDansModal(null, { racine, sourceId });
            if (!connus) adopterReglagesModale(racine, sourceId);
        });
        return true;
    }

    window.CalepinageMaisonDimensionsOmbriere = {
        mesurerChamp, dimensionsOmbriere, injecterDansModal, brancherRetourOmbriere,
        imposerReglagesModale, adopterReglagesModale,
        _regrouper: regrouper, // exposé pour les tests
    };
})();
