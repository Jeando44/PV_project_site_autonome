/**
 * Calepinage maison — alimentation du « Configurateur Calepinage » des ombrières.
 *
 * Le configurateur (modals/geometrie/calepinage_ombriere.html + calepinage_ombriere.js) est chargé
 * dans une iframe IMBRIQUÉE des modales ombrière métal / bois / Solumbra et bâtiment métal. Ses
 * sections « 1. Paramètres couverture », « 2. Panneaux & Système » et « 3. Calepinage &
 * Espacements » n'étaient remplies que depuis l'ancien stockage PRO (`solarProjectData.formData` /
 * `shapes`), que plus personne n'alimente depuis que le module résidentiel est l'unique moteur de
 * calepinage : elles restaient sur leurs valeurs par défaut (40 x 7 panneaux, 450 Wc...) alors que
 * le Summary modal affichait le vrai champ PV.
 *
 * Ce service traduit l'état d'un champ PV du module (`CM.state` du champ, même source que
 * getAllPvFieldSummaries / Summary modal) en valeurs des champs du configurateur, DANS SES UNITÉS :
 *   - toiture_dim_l / toiture_dim_w : mètres ; count_* : nombre de panneaux (X = le long de la
 *     façade / de l'égout, Y = dans le rampant) ; panel_dim_* / intermodule_* / delta_w : mm.
 * Aucune règle de calcul propre : la grille vient de CM.mesurerGrillePan (vrai moteur de pose).
 *
 * Point d'entrée : window.CalepinageMaisonConfigurateurOmbriere
 *   { valeursConfigurateur(sourceId), injecterDansConfigurateur(racine, sourceId) }
 * Appelé depuis l'iframe (qui remonte ses fenêtres parentes pour le trouver) AVANT ses anciennes
 * synchronisations, qui ne servent plus que de repli quand aucun champ PV ne correspond.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    const arrondi = (v, n) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

    // Types de montage du module -> option du <select id="type"> du configurateur. Solumbra partage
    // la VALEUR 'Ombriere_beton' avec « Ombrière béton » : on la retrouve donc par son libellé.
    const TYPE_VERS_CONFIGURATEUR = {
        ombriere_metal: { valeur: 'Ombriere_metal' },
        ombriere_bois: { valeur: 'Ombriere_bois' },
        ombriere_solumbra: { libelle: 'solumbra' },
        incline: { valeur: 'toiture_inclinee' },
        toiture_residentielle: { valeur: 'toiture_inclinee' },
    };
    const TYPES_OMBRIERE = ['ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra'];

    function etatDuChamp(sourceId) {
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champs = CM.listerChampsCarte();
        if (!champs.length) return null;
        // Sans identifiant, on ne prend le champ que s'il est seul : deviner parmi plusieurs
        // champs afficherait les données d'un autre champ PV que celui de l'onglet.
        const trouve = sourceId
            ? champs.find((c) => c.sourceId === sourceId)
            : (champs.length === 1 ? champs[0] : null);
        return trouve ? { sourceId: trouve.sourceId, state: trouve.state } : null;
    }

    function geometrieToiture(state) {
        const mode = state.divisionMode || 'none';
        if (mode === '2pans') {
            return state.lastTwoPanKind === 'asym' ? 'Bipente_asymetrique' : 'Bipente_symetrique';
        }
        if (mode === '4pans' || mode === '4panssym') return 'Multipente';
        return 'Monopente';
    }

    /**
     * Valeurs du configurateur pour un champ PV, ou null si le champ n'existe pas / n'a aucun
     * panneau posé (le configurateur garde alors l'ancienne synchronisation).
     * `faitageMm` / `margeYmm` : valeurs courantes du configurateur (réglages qui lui sont propres),
     * utilisées seulement pour reconstituer la largeur de la toiture.
     */
    function valeursConfigurateur(sourceId, options) {
        const o = options || {};
        if (typeof CM.mesurerGrillePan !== 'function') return null;
        const champ = etatDuChamp(sourceId);
        if (!champ) return null;
        const { state } = champ;
        const pans = state.pans || [];
        const grilles = pans.map((pan) => CM.mesurerGrillePan(pan, state));
        const indicesPoses = grilles.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
        if (!indicesPoses.length) return null;

        const g1 = grilles[indicesPoses[0]];
        const g2 = indicesPoses.length > 1 ? grilles[indicesPoses[1]] : g1;
        const pan1 = pans[indicesPoses[0]];
        const penteType = geometrieToiture(state);
        const multiZone = penteType !== 'Monopente';
        const typeMontage = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage;
        const estOmbriere = TYPES_OMBRIERE.indexOf(typeMontage) !== -1;
        const railMm = estOmbriere ? (Number(state.railWidthMm) || 0) : null;
        const jointBrut = typeof CM.paramsJointDilatation === 'function' ? CM.paramsJointDilatation(state, pan1) : null;
        const joint = jointBrut && jointBrut.nature === 'joint' ? jointBrut : null; // pas la séparation de terrasse

        // Dimensions de la toiture = champ PV reconstitué (panneaux + espacements), plus les marges
        // que le configurateur ajoute lui-même (rail en X, marge Y) : mêmes totaux que les siens.
        const longueurM = Math.max(...indicesPoses.map((i) => grilles[i].longueurM)) + (railMm || 0) / 1000;
        const largeurPansM = indicesPoses.reduce((s, i) => s + grilles[i].largeurM, 0);
        const faitageM = multiZone ? (Number(o.faitageMm) || 0) / 1000 : 0;
        const largeurM = largeurPansM + faitageM + (Number(o.margeYmm) || 0) / 1000;

        const penteDeg = Number(state.penteDeg) || 0;
        const penteDeg2 = penteType === 'Bipente_asymetrique' && state.penteDeg2 != null
            ? Number(state.penteDeg2) : penteDeg;

        return {
            sourceId: champ.sourceId,
            type: TYPE_VERS_CONFIGURATEUR[typeMontage] || null,
            champs: {
                toiture_dim_l: arrondi(longueurM, 2),
                toiture_dim_w: arrondi(largeurM, 2),
                toiture_pente_type: penteType,
                asymetrie_percent: penteType === 'Bipente_asymetrique' && state.asymmetryPercent != null
                    ? Math.round(state.asymmetryPercent) : null,
                nb_pentes: penteType === 'Multipente' ? 4 : null,
                panel_ref: state.panelRef || null,
                panel_dim_l: state.panelLengthMm || null,
                panel_dim_w: state.panelWidthMm || null,
                power_unit: state.panelPowerWc || null,
                azimut: pan1 && pan1.azimuth != null ? Math.round(pan1.azimuth) : null,
                pente: arrondi(penteDeg, 1),
                pente2: arrondi(penteDeg2, 1),
                pv_number: champ.sourceId,
                count_x: g1.nbColonnes,
                count_y: g1.nbRangees,
                count_x2: multiZone ? g2.nbColonnes : null,
                count_y2: multiZone ? g2.nbRangees : null,
                intermodule_x: state.panelSpacingXMm != null ? state.panelSpacingXMm : null,
                intermodule_y: state.panelSpacingYMm != null ? state.panelSpacingYMm : null,
                // « Largeur rail » du module = delta X ajouté à la longueur = « Marge Longueur X ».
                delta_w: railMm,
                // Joints de dilatation du module (0 = aucun joint pour ce type de structure) : le
                // configurateur les compte et les dessine lui-même (calepinage_ombriere.js).
                joint_dilatation: joint ? Math.round(joint.largeurM * 1000) : 0,
                limit_dilatation: joint ? joint.limiteM : 0,
            },
            modePose: state.panelOrientation === 'paysage' ? 'Paysage' : 'Portrait',
            // Répartition des joints (case « Couper à la longueur limite ») : lue par
            // calepinage_ombriere.js::calculateResults via document.documentElement.dataset.
            jointRepartition: joint ? joint.repartition : 'egale',
        };
    }

    /**
     * Écrit les valeurs dans le document du configurateur puis relance SES fonctions de
     * rafraîchissement (pas d'événement 'change' : ceux de count_x / toiture_pente_type appellent
     * setDefaultPanelCounts(), qui réécrirait les compteurs de la zone 2).
     * Renvoie la liste des ids modifiés, ou null si aucun champ PV ne correspond (repli attendu).
     */
    function injecterDansConfigurateur(racine, sourceId) {
        const doc = racine || document;
        const lire = (id) => {
            const el = doc.getElementById(id);
            return el ? el.value : null;
        };
        const v = valeursConfigurateur(sourceId, {
            faitageMm: lire('largeur_faitage_mm'),
            margeYmm: lire('delta_l'),
        });
        if (!v) return null;

        const modifies = [];
        Object.entries(v.champs).forEach(([id, valeur]) => {
            if (valeur === undefined || valeur === null || valeur === '') return;
            const el = doc.getElementById(id);
            if (!el || String(el.value) === String(valeur)) return;
            el.value = valeur;
            modifies.push(id);
        });

        const select = doc.getElementById('type');
        if (select && v.type) {
            const options = Array.prototype.slice.call(select.options || []);
            const cible = options.find((opt) => (v.type.valeur
                ? opt.value === v.type.valeur
                : String(opt.textContent || '').toLowerCase().indexOf(v.type.libelle) !== -1));
            if (cible && !cible.selected) {
                select.selectedIndex = options.indexOf(cible);
                modifies.push('type');
            }
        }

        const racineDoc = doc.documentElement;
        if (racineDoc && racineDoc.dataset && racineDoc.dataset.jointRepartition !== v.jointRepartition) {
            racineDoc.dataset.jointRepartition = v.jointRepartition;
            modifies.push('jointRepartition');
        }

        const radios = Array.prototype.slice.call(doc.getElementsByName ? doc.getElementsByName('mode') : []);
        const radio = radios.find((r) => r.value === v.modePose);
        if (radio && !radio.checked) {
            radio.checked = true;
            modifies.push('mode');
        }

        if (modifies.length) {
            const fen = doc.defaultView || window;
            // updateAzimut / updatePente / updateDimensions redessinent chacune (calcul local) ; les
            // deux premières mettent aussi à jour la boussole et le libellé de pente.
            ['toggleConditionalFields', 'togglePenteConditionalFields', 'handlePente2Visibility',
                'updateAzimut', 'updatePente', 'updateDimensions'].forEach((nom) => {
                if (typeof fen[nom] !== 'function') return;
                try { fen[nom](); } catch (e) { console.warn('[CalepinageMaisonConfigurateurOmbriere]', nom, e); }
            });
        }
        return modifies;
    }

    /**
     * Géométrie de toiture RÉELLE d'un champ PV ('Monopente', 'Bipente_symetrique',
     * 'Bipente_asymetrique', 'Multipente'), ou null si aucun champ du module ne correspond.
     *
     * Demande explicite : les modèles « Toiture Y » / « Double toiture Y » (ombrière métal) et
     * « Est-Ouest » (bois) ne s'affichent que pour « Diviser en 2 pans symétriques ». Les
     * configurateurs lisaient la géométrie dans l'ancien stockage PRO
     * (solarProjectData.formData[pvId].toiture_pente_type), plus alimenté depuis l'unification :
     * la réponse était toujours « Monopente » et ces modèles n'apparaissaient jamais.
     */
    function geometrieToitureDuChamp(sourceId) {
        const champ = etatDuChamp(sourceId);
        return champ ? geometrieToiture(champ.state) : null;
    }

    window.CalepinageMaisonConfigurateurOmbriere = { valeursConfigurateur, injecterDansConfigurateur, geometrieToitureDuChamp };
})();
