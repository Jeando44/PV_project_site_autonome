/**
 * Calepinage résidentiel — boutons "Calculer", "Résultats" et "Optimisation" du Petit champ solaire
 * (sheds), sous Portrait/Paysage, dans le modal résidentiel ET dans son clone du formulaire PRO.
 *
 * Les boutons ne font qu'émettre des événements (calepinage_maison_formulaires.js pour le modal,
 * calepinage_maison_form_pro.js pour le clone) :
 *     petitChampCalculerClicked / petitChampResultatsClicked / petitChampOptimisationClicked
 *     detail : { pvId } (sourceId du champ PV — égal au pvId de l'onglet PRO)
 * Ce fichier les écoute.
 *
 * ── Calculer ──────────────────────────────────────────────────────────────────────────────────
 * Aucun moteur nouveau : la grille shed est celle réellement posée par le module résidentiel,
 * relue par CalepinageMaisonDimensionsPetitChamp.tableauSheds(). S'y ajoutent les indicateurs du
 * tableau "Résultats du calepinage shed" de l'ancien calepinage polygonal (calepinage.html,
 * #shedResultsModal — mêmes libellés, même disposition en deux tableaux) : surfaces, ratio de
 * couverture, et "% Perte d'ombrage entre shed" demandé au backend (/calculate_shed_shading, pvlib),
 * comme l'ancien chemin (PolygonPanelsManager.requestShedShadingFromBackend).
 * Le modal de résultats est construit ici plutôt que de réutiliser #shedResultsModal-<pvId> :
 * celui-ci vit dans calepinage.html (gabarit PRO voué à disparaître, Étape 5) et ses « miroirs »
 * relisent les anciens champs PRO, plus alimentés depuis la bascule.
 *
 * ── Résultats ─────────────────────────────────────────────────────────────────────────────────
 * Réaffiche le dernier calcul du champ SANS recalculer si ses données d'entrée n'ont pas changé
 * (signature de l'état du champ + position du projet). Sinon, recalcule.
 *
 * ── Optimisation ──────────────────────────────────────────────────────────────────────────────
 * Modal où l'utilisateur saisit 5 configurations (Mode de pose Portrait/Paysage, Nb. PV par shed,
 * Espacement entre shed, Pente toiture 1), validées avec les bornes du formulaire PRO. Les 5 calculs
 * sont lancés en parallèle sur des COPIES de l'état (le champ n'est pas modifié), la configuration qui
 * maximise la puissance nette d'ombrage (kWc x (1 - perte), valeurs brutes) est signalée et
 * pré-cochée. Un filtre d'affichage ne montre que la (les) configuration(s) au ratio de couverture,
 * à l'ombrage ou à la puissance max/min. "Appliquer" écrit la configuration cochée dans l'état du
 * champ (canevas, carte, formulaire PRO suivent) puis relance "Calculer".
 * Les deux modals ont un en-tête noir et sont déplaçables par leur en-tête.
 *
 * Point d'entrée : window.CalepinageMaisonShedsActions { calculer, resultats, optimisation, evaluer }
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};

    // Bornes du formulaire PRO (calepinage.html : #shedsCols, #shedsColSpacing, #pente_panneaux_shed),
    // identiques à celles du formulaire résidentiel (calepinage_maison_formulaires.js).
    const BORNES = {
        nbPvParShed: { min: 1, max: 15, integer: true, label: 'Nb. PV par shed' },
        espacementMm: { min: 300, max: 10000, integer: false, label: 'Espacement entre shed (mm)' },
        penteDeg: { min: 0, max: 90, integer: false, label: 'Pente toiture 1 (°)' },
    };
    const NB_CONFIGURATIONS = 5;
    const Z_INDEX = 1000000; // au-dessus du modal résidentiel (999998)

    /** Dernier calcul par champ : { signature, resultat }. */
    const cacheResultats = new Map();

    function cm() { return window.CalepinageMaisonIndiv; }

    function arrondi(valeur, decimales) {
        const f = Math.pow(10, decimales);
        return Math.round(valeur * f) / f;
    }

    // ------------------------------------------------------------------------------------------
    // Champ PV visé
    // ------------------------------------------------------------------------------------------

    /** pvId de l'événement ; à défaut, onglet PRO actif ; à défaut, champ ouvert dans le modal. */
    function pvIdDepuisEvenement(detail) {
        const d = detail || {};
        if (d.pvId) return d.pvId;
        if (d.state && d.state.sourceId) return d.state.sourceId;
        const actif = document.querySelector('.tab-content.active[id^="form-"]');
        if (actif) return actif.id.slice('form-'.length);
        const CM = cm();
        return CM.state ? CM.state.sourceId : null;
    }

    /** État du champ : CM.state s'il est affiché (il porte les modifications en cours), sinon le cache. */
    function etatDuChamp(pvId) {
        const CM = cm();
        if (CM.state && (!pvId || CM.state.sourceId === pvId)) return CM.state;
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champ = CM.listerChampsCarte().find((c) => c.sourceId === pvId);
        return champ ? champ.state : null;
    }

    function estEnShed(state) {
        return state.poseMode === 'shed' || (state.pans || []).some((p) => p.poseMode === 'shed');
    }

    /**
     * Position du projet pour le calcul d'ombrage : adresse géocodée (même lecture que
     * GeometryUtils.getProjectAddressLatLng, module ES inaccessible d'ici), à défaut l'origine du
     * champ sur la carte.
     */
    function positionProjet(pvId) {
        const lire = (brut) => {
            if (!brut) return null;
            try {
                let d = JSON.parse(brut);
                if (typeof d === 'string') d = JSON.parse(d);
                const lat = parseFloat(d && d.latitude), lng = parseFloat(d && d.longitude);
                return (isNaN(lat) || isNaN(lng)) ? null : { lat, lng };
            } catch (e) { return null; }
        };
        const cache = document.getElementById('parametre_project_hidden');
        const depuisCache = cache ? lire(cache.value) : null;
        if (depuisCache) return depuisCache;
        try {
            const stocke = JSON.parse(localStorage.getItem('solarProjectData') || 'null');
            const depuisStockage = lire(stocke && stocke.projectInfo && stocke.projectInfo.adresseProjet);
            if (depuisStockage) return depuisStockage;
        } catch (e) { /* aucune adresse enregistrée */ }
        const CM = cm();
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champ = CM.listerChampsCarte().find((c) => c.sourceId === pvId);
        const o = champ && champ.origin;
        if (!o) return null;
        const lat = typeof o.lat === 'function' ? o.lat() : parseFloat(o.lat);
        const lng = typeof o.lng === 'function' ? o.lng() : parseFloat(o.lng);
        return (isNaN(lat) || isNaN(lng)) ? null : { lat, lng };
    }

    /**
     * Signature des données d'entrée d'un champ : tout l'état sérialisable (contour, pans,
     * obstacles, panneau, espacements, sheds, pente...) + la position du projet. Les objets de
     * carte / DOM et les images de fond sont ignorés (non sérialisables ou sans effet sur le calcul).
     */
    function signature(state, position) {
        const vus = new WeakSet();
        try {
            return JSON.stringify({ state, position }, (cle, valeur) => {
                if (typeof valeur === 'function') return undefined;
                if (/image|dataurl|capture|fond/i.test(cle)) return undefined;
                // Case « terrain » et dernier résultat d'ombrage enregistré : sorties du calcul, pas entrées.
                if (/^ombrage(Terrain|Sheds)/.test(cle)) return undefined;
                if (valeur && typeof valeur === 'object') {
                    if (typeof valeur.getPath === 'function' || typeof valeur.getMap === 'function') return undefined;
                    if (typeof Node !== 'undefined' && valeur instanceof Node) return undefined;
                    if (vus.has(valeur)) return undefined;
                    vus.add(valeur);
                }
                return valeur;
            });
        } catch (e) {
            return null; // signature impossible : on recalculera
        }
    }

    // ------------------------------------------------------------------------------------------
    // Calcul
    // ------------------------------------------------------------------------------------------

    /** Surface du contour (somme des pans, formule du lacet), en m². */
    function surfaceContourM2(state) {
        return (state.pans || []).reduce((total, pan) => {
            const pts = pan.points || [];
            let a = 0;
            for (let i = 0; i < pts.length; i += 1) {
                const p = pts[i], q = pts[(i + 1) % pts.length];
                a += p.x * q.y - q.x * p.y;
            }
            return total + Math.abs(a) / 2;
        }, 0);
    }


    /** Nombre de panneaux par shed tel que le moteur le pose (même plafond que computeCandidatePanelSlots). */
    function panneauxParShed(state) {
        return Math.max(1, Math.min(BORNES.nbPvParShed.max, Math.round(state.shedPanelsPerGroup || 1)));
    }

    /**
     * Résultats géométriques d'un état (synchrone, sans perte d'ombrage). null si rien n'est posé.
     * Les indicateurs sont calculés sur les valeurs NON arrondies ; seul l'affichage est arrondi.
     * `requeteOmbrage` porte les paramètres attendus par /calculate_shed_shading (mètres, azimut pvlib).
     */
    function evaluer(state) {
        const service = window.CalepinageMaisonDimensionsPetitChamp;
        if (!service || typeof service.tableauSheds !== 'function') return null;
        const t = service.tableauSheds(state);
        if (!t) return null;
        const m = t.mesure;
        const penteDeg = m.penteDeg || 0;
        const surfaceInclineeM2 = (m.nbPanneaux * m.panneau.longueurMm * m.panneau.largeurMm) / 1e6;
        const surfaceProjeteeM2 = surfaceInclineeM2 * Math.cos((penteDeg * Math.PI) / 180);
        const surfacePolygoneM2 = surfaceContourM2(state);
        const azimutPvgis = ((state.pans || [])[0] || {}).azimuth || 0; // Sud = 0, Ouest = +90

        // Profondeur d'un shed le long de la pente, reconstituée depuis le RÉGLAGE (le moteur ne pose
        // que des sheds complets) : n panneaux dans leur dimension de rampant + (n-1) espacements Y.
        // Plus sûre que la mesure des écarts, qui dépend de la détection des séparations.
        const n = panneauxParShed(state);
        const paysage = state.panelOrientation === 'paysage';
        const rampantMm = paysage ? (state.panelWidthMm || 0) : (state.panelLengthMm || 0);
        const profondeurShedM = (n * rampantMm + (n - 1) * (state.panelSpacingYMm || 0)) / 1000;

        const requeteOmbrage = {
            tilt: penteDeg,
            // Espace LIBRE au sol entre deux sheds : c'est bien ce que le moteur ajoute après la
            // profondeur projetée d'un shed (computeCandidatePanelSlots), et ce qu'attend le backend.
            gap: state.shedSpacingM || 0,
            collector_width: profondeurShedM,
            azimuth: (180 + azimutPvgis + 360) % 360, // convention pvlib : 180 = Sud
        };
        // Hauteur du bord bas des panneaux (petit champ solaire), sinon défaut du backend (0,5 m).
        if (state.petitChampLowPointHeightM > 0) requeteOmbrage.height = state.petitChampLowPointHeightM;

        return {
            orientation: paysage ? 'paysage' : 'portrait',
            penteDeg: arrondi(penteDeg, 1),
            azimutDeg: arrondi(azimutPvgis, 1),
            surfacePolygoneM2: arrondi(surfacePolygoneM2, 2),
            surfaceInclineeM2: arrondi(surfaceInclineeM2, 2),
            surfaceProjeteeM2: arrondi(surfaceProjeteeM2, 2),
            surfaceGroupeM2: t.surfaceGroupeM2,
            nbSheds: t.nbSheds,
            nbRangees: t.nbRangees,
            nbPvLargeur: m.pvLargeur,
            espacementShedsMm: Math.round((state.shedSpacingM || 0) * 1000),
            // Regroupement le long de la rangée (0 = remplissage maximal, sans groupe).
            nbPvLongueurParShed: Math.max(0, Math.round(state.shedPanelsPerRow || 0)),
            espacementGroupesMm: Math.round((state.shedRowGroupSpacingM || 0) * 1000),
            // « Esp. bordure » : recul des panneaux par rapport au contour (0 pour une ombrière, cf.
            // effectiveEdgeClearanceM).
            espacementBordureMm: Math.round(((typeof cm().isOmbriereType === 'function' && cm().isOmbriereType(state.typeMontage))
                ? 0 : (state.edgeClearanceM || 0)) * 1000),
            // Données de production (dossier de plans) : pertes système et type de montage PVGIS.
            perteSysteme: Number(state.perteSysteme),
            montagePvgis: typeof cm().typeMontageToPvgisMount === 'function' ? cm().typeMontageToPvgisMount(state.typeMontage) : 'free',
            ratioCouvertureBrut: surfacePolygoneM2 > 0 ? (surfaceProjeteeM2 / surfacePolygoneM2) * 100 : null,
            ratioCouverture: surfacePolygoneM2 > 0 ? arrondi((surfaceProjeteeM2 / surfacePolygoneM2) * 100, 1) : null,
            perteOmbrage: null,
            perteOmbrageBrute: null,
            erreurOmbrage: null,
            // Ombrage avec terrain (petit champ solaire au sol) : perte et orientation RÉELLE des
            // tables (dérivées, cf. CalepinageMaisonTerrainTables.geometrieOmbrage).
            terrainApplicable: estChampAuSol(state),
            perteOmbrageTerrain: null,
            perteOmbrageTerrainBrute: null,
            erreurOmbrageTerrain: null,
            penteReelleDeg: null,
            azimutReelDeg: null,
            dispersionOrientationDeg: null,
            alerteDispersion: false,
            pansOrientationReelle: null,
            nbPanneaux: t.nbPanneaux,
            puissanceKwc: arrondi((m.nbPanneaux * (m.panneau.puissanceWc || 0)) / 1000, 3),
            dimensionsShed: t.dimensionsShed,
            rangees: t.rangees,
            pvCalepinage: t.pvCalepinage,
            panneauDimensions: `${m.panneau.longueurMm}mm X ${m.panneau.largeurMm}mm`,
            panneauPuissanceWc: m.panneau.puissanceWc,
            requeteOmbrage,
        };
    }

    /**
     * "% Perte d'ombrage entre shed" via le backend pvlib.
     * Renvoie { valeur, erreur } : valeur = perte brute (%) ou null, erreur = raison lisible.
     */
    async function perteOmbrage(requete, position) {
        if (!position) return { valeur: null, erreur: 'Adresse du projet non géolocalisée.' };
        if (!(requete.gap > 0) || !(requete.collector_width > 0)) {
            return { valeur: null, erreur: 'Espacement entre sheds ou profondeur de shed nul.' };
        }
        const prefixe = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        try {
            const reponse = await fetch(`${prefixe}/calculate_shed_shading`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ lat: position.lat, lon: position.lng }, requete)),
            });
            const donnees = await reponse.json();
            if (typeof donnees.lossPercent === 'number' && isFinite(donnees.lossPercent)) {
                return { valeur: donnees.lossPercent, erreur: null };
            }
            return { valeur: null, erreur: donnees.error || 'Réponse du serveur invalide.' };
        } catch (e) {
            console.warn('[Sheds] Perte d\'ombrage indisponible', e);
            return { valeur: null, erreur: 'Serveur injoignable.' };
        }
    }

    function appliquerOmbrage(r, o) {
        r.perteOmbrageBrute = o.valeur;
        r.perteOmbrage = o.valeur === null ? null : arrondi(o.valeur, 1);
        r.erreurOmbrage = o.erreur;
        return r;
    }

    // ------------------------------------------------------------------------------------------
    // Ombrage avec terrain (petit champ solaire au sol)
    // ------------------------------------------------------------------------------------------

    /** Petit champ solaire AU SOL : seul cas où les tables reposent sur le terrain. */
    function estChampAuSol(state) {
        const CM = cm();
        const tm = typeof CM.normalizeTypeMontage === 'function' ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage;
        return tm === 'champ_solaire';
    }

    /**
     * Signature de ce dont dépend l'ombrage avec terrain : géométrie posée et réglages des tables,
     * position du projet. Contrairement à signature(), insensible au zoom / déplacement du canevas :
     * elle sert à savoir si le résultat ENREGISTRÉ (case « prendre en compte le terrain ») vaut
     * encore pour la production.
     */
    const CHAMPS_SIGNATURE_TERRAIN = ['pans', 'obstacles', 'deletedPanelIndicesByPan', 'gridOffsetByPan', 'typeMontage', 'poseMode',
        'panelLengthMm', 'panelWidthMm', 'panelThicknessMm', 'panelSpacingXMm', 'panelSpacingYMm', 'panelOrientation',
        'shedSpacingM', 'shedPanelsPerGroup', 'shedPanelsPerRow', 'shedRowGroupSpacingM', 'shedRegularAlignment', 'edgeClearanceM',
        'penteDeg', 'penteDeg2', 'petitChampModel', 'petitChampParams', 'petitChampLowPointHeightM',
        'contourMode', 'polygonAzimuthDeg', 'rectAzimuthOffsetDeg'];

    function signatureOmbrageTerrain(state, position) {
        const extrait = {};
        CHAMPS_SIGNATURE_TERRAIN.forEach((k) => {
            const v = state[k];
            if (v instanceof Map) {
                extrait[k] = Array.from(v.entries()).map(([cle, x]) => [cle, x instanceof Set ? Array.from(x).sort() : x])
                    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
            } else extrait[k] = v;
        });
        const p = position ? [Number(position.lat).toFixed(5), Number(position.lng).toFixed(5)] : null;
        try { return JSON.stringify([extrait, p]); } catch (e) { return null; }
    }

    /**
     * "% Perte d'ombrage avec terrain" + orientation réelle des tables (backend pvlib, cf.
     * calcul_shed_shading_terrain.py). La grille de terrain est chargée sur le contour du champ.
     * -> { valeur, erreur, orientation, pans }
     */
    async function perteOmbrageTerrain(pvId, state, requetePlat, position) {
        const vide = (erreur) => ({ valeur: null, erreur, orientation: null, pans: null });
        if (!estChampAuSol(state)) return vide('Sans objet : petit champ solaire au sol uniquement.');
        const TT = window.CalepinageMaisonTerrainTables;
        if (!TT || typeof TT.geometrieOmbrageChamp !== 'function') return vide('Module terrain non chargé.');
        let geom;
        try {
            geom = await TT.geometrieOmbrageChamp(pvId, state);
        } catch (e) {
            console.info('[Sheds] Terrain indisponible pour l\'ombrage', e && (e.code || e));
            return vide('Terrain indisponible' + (e && e.code ? ` (${e.code})` : '') + '.');
        }
        if (!geom) return vide('Aucune table posée sur le terrain.');
        const orientation = {
            penteReelleDeg: geom.equivalent.tiltReelDeg,
            azimutReelDeg: geom.equivalent.azimutReelDeg,
            dispersionDeg: geom.equivalent.dispersionDeg,
            alerteDispersion: geom.equivalent.alerteDispersion,
        };
        const avecOrientation = (o) => Object.assign(o, { orientation, pans: geom.pans });
        if (!position) return avecOrientation(vide('Adresse du projet non géolocalisée.'));
        if (!(geom.requete.collector_width > 0)) return avecOrientation(vide('Profondeur de shed nulle.'));
        const corps = Object.assign({ lat: position.lat, lon: position.lng }, geom.requete);
        if (requetePlat && requetePlat.height > 0) corps.height = requetePlat.height;
        const prefixe = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        try {
            const reponse = await fetch(`${prefixe}/calculate_shed_shading_terrain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corps),
            });
            const donnees = await reponse.json();
            if (typeof donnees.lossPercent === 'number' && isFinite(donnees.lossPercent)) {
                return avecOrientation({ valeur: donnees.lossPercent, erreur: null });
            }
            return avecOrientation(vide(donnees.error || 'Réponse du serveur invalide.'));
        } catch (e) {
            console.warn('[Sheds] Perte d\'ombrage avec terrain indisponible', e);
            return avecOrientation(vide('Serveur injoignable.'));
        }
    }

    function appliquerOmbrageTerrain(r, o) {
        r.perteOmbrageTerrainBrute = o.valeur;
        r.perteOmbrageTerrain = o.valeur === null ? null : arrondi(o.valeur, 1);
        r.erreurOmbrageTerrain = o.erreur;
        const or = o.orientation;
        r.penteReelleDeg = or ? arrondi(or.penteReelleDeg, 1) : null;
        r.azimutReelDeg = or ? arrondi(or.azimutReelDeg, 1) : null;
        r.dispersionOrientationDeg = or ? arrondi(or.dispersionDeg, 1) : null;
        r.alerteDispersion = !!(or && or.alerteDispersion);
        r.pansOrientationReelle = o.pans || null;
        return r;
    }

    /**
     * Évaluation complète (géométrie + ombrage plat + ombrage avec terrain) d'un état. Sans pvId,
     * pas de terrain (le champ de la carte est inconnu) : perte avec terrain laissée à null.
     */
    async function evaluerAvecOmbrage(state, position, pvId) {
        const r = evaluer(state);
        if (!r) return null;
        const [plat, terrain] = await Promise.all([
            perteOmbrage(r.requeteOmbrage, position),
            pvId && r.terrainApplicable ? perteOmbrageTerrain(pvId, state, r.requeteOmbrage, position) : null,
        ]);
        appliquerOmbrage(r, plat);
        if (terrain) appliquerOmbrageTerrain(r, terrain);
        return r;
    }

    // ------------------------------------------------------------------------------------------
    // Ombrage entre sheds dans la PRODUCTION (tout calepinage en sheds)
    // ------------------------------------------------------------------------------------------
    // La production (getAllPvFieldSummaries, synchrone) lit le dernier résultat d'ombrage
    // ENREGISTRÉ dans l'état du champ (persisté) : state.ombrageShedsResultat = { signature,
    // perte (terrain plat), perteTerrain, penteReelleDeg, azimutReelDeg, dispersionDeg, pans }.
    // Règle : perte entre sheds (terrain plat) toujours appliquée ; case « prendre en compte le
    // terrain » cochée -> la perte avec terrain la REMPLACE et la pente / l'azimut réels sont
    // envoyés à PVGIS. Le résultat est enregistré à chaque calcul du champ (Calculer, dossier) et
    // recalculé avant la production s'il manque ou ne correspond plus au calepinage
    // (actualiserOmbragesProduction, appelée par SummaryModal).

    /**
     * Case « prendre en compte le terrain » : COCHÉE PAR DÉFAUT (décision utilisateur 2026-10-05) —
     * seul un décochage explicite (state.ombrageTerrainProduction === false) l'écarte. Un champ
     * jamais réglé (valeur absente) prend donc le terrain en compte dans le productible.
     */
    function terrainDansProduction(state) {
        return !!state && state.ombrageTerrainProduction !== false;
    }

    /**
     * Calepinage posé en sheds (petit champ au sol, toiture terrasse...) : la perte d'ombrage entre
     * sheds entre dans la production. Hors petit champ au sol, le support est considéré PLAT (perte
     * plate seule) ; le terrain réel ne concerne que le petit champ au sol.
     */
    function ombrageEnProduction(state) {
        return !!state && estEnShed(state);
    }

    /**
     * Enregistre le résultat d'un calcul du champ réel. `signatureEntree` : signature prise AVANT
     * les appels réseau (le calepinage a pu changer pendant le calcul : le résultat est alors
     * enregistré comme périmé, et recalculé à la prochaine production).
     */
    function memoriserOmbrages(pvId, state, r, signatureEntree) {
        if (!ombrageEnProduction(state) || !r) return;
        const nombre = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
        const nouveau = {
            signature: signatureEntree,
            perte: nombre(r.perteOmbrageBrute),
            erreur: r.erreurOmbrage || null,
            perteTerrain: nombre(r.perteOmbrageTerrainBrute),
            erreurTerrain: r.erreurOmbrageTerrain || null,
            penteReelleDeg: nombre(r.penteReelleDeg),
            azimutReelDeg: nombre(r.azimutReelDeg),
            dispersionDeg: nombre(r.dispersionOrientationDeg),
            pans: (r.pansOrientationReelle || []).map((p) => ({
                panId: p.panId, penteReelleDeg: arrondi(p.tiltReelDeg, 2), azimutReelDeg: arrondi(p.azimutReelDeg, 2),
            })),
        };
        // Pas de réécriture (ni de « modification non enregistrée ») si rien n'a changé.
        if (JSON.stringify(state.ombrageShedsResultat || null) === JSON.stringify(nouveau)) return;
        state.ombrageShedsResultat = nouveau;
        const CM = cm();
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'ombrageSheds');
    }

    /**
     * Ombrage entre sheds à appliquer à la production d'un champ (lecture synchrone) :
     *   null                       pas un petit champ au sol en sheds (rien à appliquer) ;
     *   { valide: false, erreur }  aucun résultat à jour (à recalculer) ;
     *   { valide: true, perte, terrain, penteReelleDeg, azimutReelDeg, pans, terrainIndisponible }
     *     perte = avec terrain si la case est cochée et le calcul avec terrain disponible, sinon
     *     terrain plat (terrainIndisponible = case cochée mais pas de résultat avec terrain).
     */
    function ombragePourProduction(pvId, state) {
        if (!ombrageEnProduction(state)) return null;
        const r = state.ombrageShedsResultat;
        const sig = signatureOmbrageTerrain(state, positionProjet(pvId || state.sourceId));
        if (!r || !r.signature || r.signature !== sig) return { valide: false, erreur: 'perte d\'ombrage entre sheds à recalculer' };
        const avecTerrain = terrainDansProduction(state) && estChampAuSol(state);
        if (avecTerrain && typeof r.perteTerrain === 'number' && typeof r.penteReelleDeg === 'number') {
            return { valide: true, terrain: true, perte: r.perteTerrain, perteTerrainPlat: r.perte,
                penteReelleDeg: r.penteReelleDeg, azimutReelDeg: r.azimutReelDeg, pans: r.pans || [] };
        }
        if (typeof r.perte !== 'number') return { valide: false, erreur: r.erreur || 'perte d\'ombrage entre sheds non calculée' };
        return { valide: true, terrain: false, perte: r.perte, terrainIndisponible: avecTerrain, erreurTerrain: r.erreurTerrain };
    }

    /**
     * Recalcule, pour chaque petit champ au sol en sheds de la carte, le résultat d'ombrage s'il
     * manque ou est périmé (avant un calcul de production). Les échecs (réseau, terrain) sont
     * enregistrés tels quels : la production les signale au lieu de bloquer.
     */
    async function actualiserOmbragesProduction() {
        const CM = cm();
        if (typeof CM.listerChampsCarte !== 'function') return;
        let champs = [];
        try { champs = CM.listerChampsCarte() || []; } catch (e) { champs = []; }
        await Promise.all(champs.map(async (c) => {
            const id = c.sourceId;
            const state = etatDuChamp(id);
            if (!ombrageEnProduction(state) || !(state.pans || []).length) return;
            const actuel = ombragePourProduction(id, state);
            const r0 = state.ombrageShedsResultat;
            const aJour = actuel && actuel.valide
                && !(terrainDansProduction(state) && actuel.terrainIndisponible && r0 && r0.perteTerrain === null && !r0.erreurTerrain);
            if (aJour) return;
            const position = positionProjet(id);
            const sigTerrain = signatureOmbrageTerrain(state, position);
            const sig = signature(state, position);
            try {
                const r = await evaluerAvecOmbrage(state, position, id);
                if (!r) return;
                if (sig) cacheResultats.set(id, { signature: sig, resultat: r });
                memoriserOmbrages(id, state, r, sigTerrain);
            } catch (e) {
                console.warn('[Sheds] Ombrage pour la production indisponible', id, e);
            }
        }));
    }

    /** Contrôles communs aux 3 boutons ; renvoie l'état du champ ou null (message affiché). */
    function etatExploitable(pvId) {
        const state = etatDuChamp(pvId);
        if (!state || !(state.pans || []).length) {
            alert('Aucun calepinage pour ce champ PV : tracez d\'abord le champ sur la carte.');
            return null;
        }
        if (!estEnShed(state)) {
            alert('Le calcul des sheds nécessite le type de calepinage « Shed ».');
            return null;
        }
        return state;
    }

    // Jeton par champ : un calcul relancé avant la réponse du précédent l'emporte toujours (la
    // réponse tardive d'un ancien calcul ne doit ni s'afficher ni entrer dans le cache).
    const jetonCalcul = new Map();

    async function calculer(pvId) {
        const state = etatExploitable(pvId);
        if (!state) return null;
        const id = pvId || state.sourceId;
        const jeton = (jetonCalcul.get(id) || 0) + 1;
        jetonCalcul.set(id, jeton);
        const position = positionProjet(id);
        const sig = signature(state, position);
        const sigTerrain = signatureOmbrageTerrain(state, position);
        const resultat = evaluer(state);
        if (!resultat) {
            alert('Aucun panneau ne peut être posé avec ces paramètres.');
            return null;
        }
        afficherResultats(id, resultat, true);
        const [plat, terrain] = await Promise.all([
            perteOmbrage(resultat.requeteOmbrage, position),
            resultat.terrainApplicable ? perteOmbrageTerrain(id, state, resultat.requeteOmbrage, position) : null,
        ]);
        appliquerOmbrage(resultat, plat);
        if (terrain) appliquerOmbrageTerrain(resultat, terrain);
        if (jetonCalcul.get(id) !== jeton) return resultat;
        if (sig) cacheResultats.set(id, { signature: sig, resultat });
        memoriserOmbrages(id, state, resultat, sigTerrain);
        afficherResultats(id, resultat, false);
        return resultat;
    }

    function resultats(pvId) {
        const state = etatExploitable(pvId);
        if (!state) return null;
        const id = pvId || state.sourceId;
        const enCache = cacheResultats.get(id);
        if (enCache && enCache.signature === signature(state, positionProjet(id))) {
            afficherResultats(id, enCache.resultat, false);
            return Promise.resolve(enCache.resultat);
        }
        return calculer(id); // aucune donnée, ou données d'entrée modifiées depuis le dernier calcul
    }

    /**
     * Résultats du champ pour le dossier de plans, SANS modal ni alerte : dernier calcul « Calculer »
     * s'il correspond encore aux données du champ, sinon calcul complet (géométrie + ombrage), mis en
     * cache comme un clic sur « Calculer ». null si le champ n'est pas un calepinage shed posé.
     * @returns {Promise<{resultat:Object, position:{lat,lng}|null, terrainProduction:boolean}|null>}
     */
    async function resultatsPourRapport(pvId) {
        const state = etatDuChamp(pvId);
        if (!state || !(state.pans || []).length || !estEnShed(state)) return null;
        const id = pvId || state.sourceId;
        const position = positionProjet(id);
        const sig = signature(state, position);
        const enCache = cacheResultats.get(id);
        // terrainProduction : case « prendre en compte le terrain » (même règle que la production).
        const terrainProduction = terrainDansProduction(state);
        if (enCache && sig && enCache.signature === sig) return { resultat: enCache.resultat, position, terrainProduction };
        const sigTerrain = signatureOmbrageTerrain(state, position);
        const resultat = await evaluerAvecOmbrage(state, position, id);
        if (resultat && sig) cacheResultats.set(id, { signature: sig, resultat });
        if (resultat) memoriserOmbrages(id, state, resultat, sigTerrain);
        return resultat ? { resultat, position, terrainProduction } : null;
    }

    // ------------------------------------------------------------------------------------------
    // Modals : style commun (en-tête noir, déplaçables)
    // ------------------------------------------------------------------------------------------

    // Styles du tableau "Résultats du calepinage shed" d'origine (calepinage.html :
    // .shed-results-table / .shed-result-field), repris sous des classes propres au module : cette
    // feuille n'est pas chargée hors du gabarit PRO.
    const CSS = `
        .cm-shed-modal-entete { display:flex; justify-content:space-between; align-items:center; background:#000; color:#fff; padding:12px 18px; cursor:move; user-select:none; }
        .cm-shed-modal-entete h5 { margin:0; color:#fff; font-weight:bold; font-size:1rem; }
        .cm-shed-modal-entete button { background:transparent; border:none; font-size:1.2em; cursor:pointer; color:#fff; }
        .cm-shed-results-table { width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:auto; }
        .cm-shed-results-table td { padding:5px 6px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
        .cm-shed-results-table tr:nth-child(even) { background-color:#f9fafb; }
        .cm-shed-results-table td:first-child { color:#374151; font-weight:600; width:1%; white-space:nowrap; }
        .cm-shed-results-table td:last-child { width:100%; }
        .cm-shed-result-field { display:block; box-sizing:border-box; width:100%; min-width:70px; height:26px; line-height:24px; margin:0;
            font-size:0.8rem; font-weight:bold; text-align:center; text-align-last:center; background-color:#e6f4ea !important;
            border:1px solid #b7dfc2 !important; border-radius:4px; color:#111827; }
        /* Largeurs FIXES par colonne (<colgroup>) : en largeur automatique, le navigateur donnait
           l'essentiel de la place aux colonnes aux libellés longs sur une ligne (Espacement, Pente,
           Puissance, Nombre de panneaux) et écrasait les autres. */
        .cm-shed-optim-table { width:100%; min-width:1200px; border-collapse:collapse; font-size:0.8rem; table-layout:fixed; }
        .cm-shed-optim-table th { padding:6px 8px; background:#f3f4f6; border-bottom:1px solid #d1d5db; text-align:center; vertical-align:bottom; font-weight:600; color:#374151; line-height:1.3; }
        .cm-shed-optim-table td { padding:5px 8px; border-bottom:1px solid #e5e7eb; text-align:center; vertical-align:middle; }
        .cm-shed-optim-table td.cm-shed-res { background-color:#e6f4ea; font-weight:bold; color:#111827; white-space:nowrap; }
        .cm-shed-optim-table tr.cm-shed-optimale td { box-shadow: inset 0 2px 0 #16a34a, inset 0 -2px 0 #16a34a; }
        .cm-shed-optim-table input[type=number], .cm-shed-optim-table select { width:100%; max-width:96px; height:30px; padding:2px 4px; font-size:0.8rem; text-align:center; box-sizing:border-box; margin:0 auto; display:block; }
        .cm-shed-optim-table input[type=checkbox] { width:16px; height:16px; margin:0 auto; display:block; cursor:pointer; }
        .cm-shed-optim-table td.cm-col-config { font-weight:600; white-space:nowrap; }`;

    function injecterStyle() {
        if (document.getElementById('cmShedActionsStyle')) return;
        const style = document.createElement('style');
        style.id = 'cmShedActionsStyle';
        style.textContent = CSS;
        (document.head || document.body).appendChild(style);
    }

    const STYLE_FOND = `display:none; align-items:center; justify-content:center; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:${Z_INDEX};`;
    const STYLE_BOITE = 'background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:1px solid #ddd; font-family:sans-serif;';

    /**
     * Rend la boîte déplaçable par son en-tête (même principe que shed_results_modal.js :
     * translation CSS mémorisée dans dataset, recentrée à chaque ouverture).
     */
    function rendreDeplacable(boite, entete) {
        let enCours = false, departX = 0, departY = 0;
        entete.addEventListener('mousedown', (e) => {
            if (e.target.closest && e.target.closest('button')) return;
            enCours = true;
            departX = e.clientX - parseFloat(boite.dataset.dx || 0);
            departY = e.clientY - parseFloat(boite.dataset.dy || 0);
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!enCours) return;
            boite.dataset.dx = e.clientX - departX;
            boite.dataset.dy = e.clientY - departY;
            boite.style.transform = `translate(${boite.dataset.dx}px, ${boite.dataset.dy}px)`;
        });
        document.addEventListener('mouseup', () => { enCours = false; });
    }

    function creerModal(id, largeur) {
        injecterStyle();
        const fond = document.createElement('div');
        fond.id = id;
        fond.style.cssText = STYLE_FOND;
        fond.innerHTML = `
            <div data-role="boite" style="${STYLE_BOITE} ${largeur}">
                <div class="cm-shed-modal-entete">
                    <h5></h5>
                    <button type="button" data-role="fermer" title="Fermer"><i class="fas fa-times"></i></button>
                </div>
                <div data-role="corps" style="padding:18px; max-height:80vh; overflow:auto;"></div>
            </div>`;
        fond.querySelector('[data-role="fermer"]').addEventListener('click', () => { fond.style.display = 'none'; });
        rendreDeplacable(fond.querySelector('[data-role="boite"]'), fond.querySelector('.cm-shed-modal-entete'));
        document.body.appendChild(fond);
        return fond;
    }

    function ouvrirModal(fond) {
        const boite = fond.querySelector('[data-role="boite"]');
        boite.dataset.dx = 0;
        boite.dataset.dy = 0;
        boite.style.transform = 'translate(0px, 0px)';
        fond.style.display = 'flex';
    }

    /** Corps neuf : les écouteurs posés sur l'ancien ne doivent pas s'empiler d'une ouverture à l'autre. */
    function corpsNeuf(fond) {
        const ancien = fond.querySelector('[data-role="corps"]');
        const corps = ancien.cloneNode(false);
        ancien.parentNode.replaceChild(corps, ancien);
        return corps;
    }

    function echapper(texte) {
        return String(texte).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function texteValeur(v, enCours) {
        if (v === null || v === undefined || v === '') return enCours ? '…' : '—';
        return String(v);
    }

    // ------------------------------------------------------------------------------------------
    // Modal "Résultats du calepinage shed" (même contenu et mêmes libellés que calepinage.html)
    // ------------------------------------------------------------------------------------------

    function champ(valeur, enCours, titre) {
        const t = titre ? ` title="${echapper(titre)}"` : '';
        return `<input type="text" class="cm-shed-result-field" readonly value="${echapper(texteValeur(valeur, enCours))}"${t}>`;
    }

    function ligne(libelle, contenu) {
        return `<tr><td>${libelle}</td><td>${contenu}</td></tr>`;
    }

    /**
     * Bloc « Terrain » du modal Résultats (petit champ au sol) : perte avec terrain, orientation
     * saisie et orientation réelle recalculée, case « prendre en compte le terrain » (production).
     */
    function blocTerrain(pvId, r, enCours) {
        const state = etatDuChamp(pvId) || {};
        const coche = terrainDansProduction(state) ? ' checked' : '';
        const lignes = [
            ligne('% Perte d\'ombrage avec terrain', champ(r.perteOmbrageTerrain, enCours, r.erreurOmbrageTerrain)),
            ligne('Pente réelle avec terrain (°)', champ(r.penteReelleDeg, enCours)),
            ligne('Azimut réel avec terrain (°)', champ(r.azimutReelDeg, enCours)),
        ].join('');
        const alerte = !enCours && r.alerteDispersion
            ? `<div style="margin-top:6px; font-size:0.8rem; color:#b45309;">Orientation des tables dispersée (jusqu'à ${echapper(r.dispersionOrientationDeg)}° de l'orientation moyenne) : la pente et l'azimut réels sont une moyenne.</div>` : '';
        const erreur = !enCours && r.erreurOmbrageTerrain
            ? `<div style="margin-top:6px; font-size:0.8rem; color:#b45309;">Perte d'ombrage avec terrain non calculée : ${echapper(r.erreurOmbrageTerrain)}</div>` : '';
        return `
            <div style="margin-top:14px; max-width:520px;">
                <h6 style="margin:0 0 6px 0; font-size:0.8rem; font-weight:700; color:#5d5e5f;">Terrain</h6>
                <table class="cm-shed-results-table"><tbody>${lignes}</tbody></table>
                <label style="display:flex; gap:8px; align-items:center; margin:8px 0 0 0; font-size:0.8rem; color:#374151; cursor:pointer;">
                    <input type="checkbox" data-role="terrain-production"${coche}>
                    Prendre en compte le terrain dans la production (perte avec terrain, pente et azimut réels)
                </label>
                ${alerte}${erreur}
            </div>`;
    }

    function afficherResultats(pvId, r, ombrageEnCours) {
        const modal = document.getElementById('cmShedResultatsModal')
            || creerModal('cmShedResultatsModal', 'width:95%; max-width:860px;');
        modal.querySelector('h5').innerHTML = `<i class="fas fa-chart-bar"></i> Résultats du calepinage shed — ${echapper(pvId || '')}`;
        const options = (r.rangees || []).map((rg) => `<option value="${rg.index}">${echapper(rg.libelle)}</option>`).join('');
        const table = (titre, lignes) => `
            <div style="flex:1 1 360px; min-width:0;">
                <h6 style="margin:0 0 6px 0; font-size:0.8rem; font-weight:700; color:#5d5e5f;">${titre}</h6>
                <table class="cm-shed-results-table"><tbody>${lignes}</tbody></table>
            </div>`;
        const corps = corpsNeuf(modal);
        corps.innerHTML = `
            <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
                ${table('Géométrie et surface', [
                    ligne('Pente des panneaux (°)', champ(r.penteDeg)),
                    ligne('Azimut (°)', champ(r.azimutDeg)),
                    ligne('Surface du polygone (m²)', champ(r.surfacePolygoneM2)),
                    ligne('Surface des panneaux inclinés (m²)', champ(r.surfaceInclineeM2)),
                    ligne('Surface des panneaux projetée (m²)', champ(r.surfaceProjeteeM2)),
                    ligne('Surface d\'un groupe de shed (m²)', champ(r.surfaceGroupeM2)),
                    ligne('Nombre de Sheds', champ(r.nbSheds)),
                    ligne('Nb. de rangée de shed', champ(r.nbRangees)),
                    ligne('Nb. PV en largeur', champ(r.nbPvLargeur)),
                    ligne('Esp. entre sheds', champ(r.espacementShedsMm)),
                ].join(''))}
                ${table('Puissance et gabarit', [
                    ligne('Ratio de couverture (%)', champ(r.ratioCouverture)),
                    ligne('% Perte d\'ombrage entre shed', champ(r.perteOmbrage, ombrageEnCours, r.erreurOmbrage)),
                    ligne('Nombre de panneaux', champ(r.nbPanneaux)),
                    ligne('Puissance (kWc)', champ(r.puissanceKwc)),
                    ligne('Dimensions d\'un shed (m)', champ(r.dimensionsShed)),
                    ligne('Analyse par rangée', `<select data-role="rangee" class="cm-shed-result-field">${options}</select>`),
                    ligne('Nb. groupes dans la rangée', `<span data-role="groupes">${champ(((r.rangees || [])[0] || {}).nbGroupes)}</span>`),
                    ligne('Nbre de PV Calepinage (LxC)', champ(r.pvCalepinage)),
                    ligne('Dimensions panneaux (mm)', champ(r.panneauDimensions)),
                    ligne('Puissance panneaux (Wc)', champ(r.panneauPuissanceWc)),
                ].join(''))}
            </div>
            ${r.terrainApplicable ? blocTerrain(pvId, r, ombrageEnCours) : ''}
            ${(!ombrageEnCours && r.erreurOmbrage) ? `<div style="margin-top:10px; font-size:0.8rem; color:#b45309;">Perte d'ombrage non calculée : ${echapper(r.erreurOmbrage)}</div>` : ''}`;
        const caseTerrain = corps.querySelector('[data-role="terrain-production"]');
        if (caseTerrain) {
            caseTerrain.addEventListener('change', () => {
                const state = etatDuChamp(pvId);
                if (!state) return;
                // Seule la case change : le résultat enregistré (perte plate ET avec terrain) sert aux deux cas.
                state.ombrageTerrainProduction = caseTerrain.checked;
                const CM = cm();
                if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'ombrageTerrain');
            });
        }
        const select = corps.querySelector('[data-role="rangee"]');
        select.addEventListener('change', () => {
            const rg = (r.rangees || []).find((x) => String(x.index) === select.value);
            corps.querySelector('[data-role="groupes"]').innerHTML = champ(rg ? rg.nbGroupes : null);
        });
        // Rafraîchissement (réponse de l'ombrage) : la fenêtre reste où l'utilisateur l'a déplacée.
        if (modal.style.display !== 'flex') ouvrirModal(modal);
    }

    // ------------------------------------------------------------------------------------------
    // Optimisation
    // ------------------------------------------------------------------------------------------

    const MODES_DE_POSE = [
        { valeur: 'portrait', libelle: 'Portrait' },
        { valeur: 'paysage', libelle: 'Paysage' },
    ];
    const CHAMPS_OPTIM = ['nbPvParShed', 'espacementMm', 'penteDeg'];

    // Colonnes de résultats : mêmes libellés que la carte de résultats du calcul de sheds.
    const COLONNES_RESULTATS = [
        { cle: 'puissanceKwc', libelle: 'Puissance<br>(kWc)', largeur: 7 },
        { cle: 'nbPanneaux', libelle: 'Nombre de<br>panneaux', largeur: 7 },
        { cle: 'ratioCouverture', libelle: 'Ratio de<br>couverture (%)', largeur: 8.5 },
        { cle: 'perteOmbrage', libelle: '% Perte d\'ombrage<br>entre shed', largeur: 9.5 },
        { cle: 'perteOmbrageTerrain', libelle: '% Perte d\'ombrage<br>avec terrain', largeur: 10, erreur: 'erreurOmbrageTerrain' },
        { cle: 'surfaceInclineeM2', libelle: 'Surface des panneaux<br>inclinés (m²)', largeur: 9.5 },
        { cle: 'surfaceProjeteeM2', libelle: 'Surface des panneaux<br>projetée (m²)', largeur: 9.5 },
    ];

    // Colonnes de saisie : en-têtes sur 2 lignes (mêmes libellés que BORNES) et largeur en %.
    // Total avec les colonnes de résultats ci-dessus : 100 %.
    const COLONNES_SAISIE = [
        { entete: 'Choix', largeur: 5 },
        { entete: '', largeur: 6 },
        { entete: 'Mode de<br>pose', largeur: 7 },
        { entete: 'Nb. PV<br>par shed', largeur: 6.5, champ: 'nbPvParShed' },
        { entete: 'Espacement entre<br>shed (mm)', largeur: 8, champ: 'espacementMm' },
        { entete: 'Pente<br>toiture 1 (°)', largeur: 6.5, champ: 'penteDeg' },
    ];

    // Filtres d'affichage : critère sur la valeur BRUTE (non arrondie), ex æquo tous affichés.
    const FILTRES = [
        { valeur: 'toutes', libelle: 'Toutes les configurations' },
        { valeur: 'ratio-max', libelle: 'Ratio de couverture : max', cle: 'ratioCouvertureBrut', sens: 1 },
        { valeur: 'ratio-min', libelle: 'Ratio de couverture : min', cle: 'ratioCouvertureBrut', sens: -1 },
        { valeur: 'ombrage-max', libelle: 'Ombrage : max', cle: 'perteOmbrageBrute', sens: 1 },
        { valeur: 'ombrage-min', libelle: 'Ombrage : min', cle: 'perteOmbrageBrute', sens: -1 },
        { valeur: 'ombrage-terrain-max', libelle: 'Ombrage avec terrain : max', cle: 'perteOmbrageTerrainBrute', sens: 1 },
        { valeur: 'ombrage-terrain-min', libelle: 'Ombrage avec terrain : min', cle: 'perteOmbrageTerrainBrute', sens: -1 },
        { valeur: 'puissance-max', libelle: 'Puissance : max', cle: 'puissanceKwc', sens: 1 },
        { valeur: 'puissance-min', libelle: 'Puissance : min', cle: 'puissanceKwc', sens: -1 },
    ];

    /**
     * Configurations retenues par un filtre : tableau de booléens (une entrée par configuration),
     * ou null pour "Toutes". Les configurations sans la donnée (aucun panneau, ombrage non calculé)
     * sont exclues ; les ex æquo sont tous retenus.
     */
    function selectionParFiltre(resultatsConfigs, valeurFiltre) {
        const filtre = FILTRES.find((f) => f.valeur === valeurFiltre);
        if (!filtre || !filtre.cle) return null;
        const valeurs = resultatsConfigs.map((r) => (r && typeof r[filtre.cle] === 'number') ? r[filtre.cle] : null);
        const connues = valeurs.filter((v) => v !== null);
        if (!connues.length) return valeurs.map(() => false);
        const extreme = filtre.sens > 0 ? Math.max.apply(null, connues) : Math.min.apply(null, connues);
        return valeurs.map((v) => v !== null && Math.abs(v - extreme) <= 1e-9);
    }

    /**
     * Index de la configuration optimale (production nette d'ombrage, valeurs brutes) ou -1.
     * Classement sur la perte AVEC TERRAIN quand elle est disponible pour toutes les configurations
     * calculées (critere 'terrain'), sinon sur la perte plate (critere 'plat') : un mélange des deux
     * comparerait des pertes qui ne mesurent pas la même chose.
     */
    function indexOptimal(resultatsConfigs) {
        const calculees = resultatsConfigs.filter(Boolean);
        const terrain = calculees.length > 0 && calculees.every((r) => typeof r.perteOmbrageTerrainBrute === 'number');
        const cle = terrain ? 'perteOmbrageTerrainBrute' : 'perteOmbrageBrute';
        let meilleur = -1, meilleurScore = -Infinity;
        resultatsConfigs.forEach((r, i) => {
            if (!r) return;
            const score = r.puissanceKwc * (1 - (r[cle] || 0) / 100);
            if (score > meilleurScore + 1e-9) { meilleurScore = score; meilleur = i; }
        });
        return { index: meilleur, score: meilleurScore, critere: terrain ? 'terrain' : 'plat' };
    }

    function borner(v, b) {
        const x = Math.min(b.max, Math.max(b.min, v));
        return b.integer ? Math.round(x) : x;
    }

    /** 5 configurations proposées autour du réglage actuel ; l'utilisateur les modifie librement. */
    function configurationsInitiales(state) {
        const n = panneauxParShed(state);
        const e = Math.round((state.shedSpacingM || 2.5) * 1000);
        const p = state.penteDeg != null ? state.penteDeg : 15;
        const o = state.panelOrientation === 'paysage' ? 'paysage' : 'portrait';
        const autre = o === 'paysage' ? 'portrait' : 'paysage';
        const B = BORNES;
        return [
            { nbPvParShed: n, espacementMm: e, penteDeg: p, orientation: o },
            { nbPvParShed: n, espacementMm: borner(Math.round(e * 0.8), B.espacementMm), penteDeg: borner(p - 5, B.penteDeg), orientation: o },
            { nbPvParShed: n, espacementMm: borner(Math.round(e * 1.2), B.espacementMm), penteDeg: borner(p + 5, B.penteDeg), orientation: o },
            { nbPvParShed: borner(n + 1, B.nbPvParShed), espacementMm: borner(Math.round(e * 1.2), B.espacementMm), penteDeg: p, orientation: o },
            { nbPvParShed: n, espacementMm: e, penteDeg: p, orientation: autre },
        ];
    }

    /** Message d'erreur pour une saisie (bornes PRO), ou null. */
    function erreurSaisie(brut, b) {
        const texte = String(brut).trim().replace(',', '.');
        const v = Number(texte);
        if (texte === '' || !isFinite(v)) return `${b.label} : valeur numérique requise.`;
        if (b.integer && !Number.isInteger(v)) return `${b.label} : doit être un nombre entier.`;
        if (v < b.min || v > b.max) return `${b.label} : doit être compris entre ${b.min} et ${b.max}.`;
        return null;
    }

    /** État évalué pour une configuration : copie superficielle, le champ réel n'est jamais touché. */
    function etatPourConfiguration(etat, c) {
        return Object.assign({}, etat, {
            shedPanelsPerGroup: c.nbPvParShed,
            shedSpacingM: c.espacementMm / 1000,
            penteDeg: c.penteDeg,
            panelOrientation: c.orientation,
        });
    }

    function optimisation(pvId) {
        const state = etatExploitable(pvId);
        if (!state) return;
        const id = pvId || state.sourceId;
        const modal = document.getElementById('cmShedOptimisationModal')
            || creerModal('cmShedOptimisationModal', 'width:98%; max-width:1480px;');
        modal.querySelector('h5').innerHTML = `<i class="fas fa-sliders-h"></i> Optimisation du calepinage shed — ${echapper(id)}`;

        const lignes = configurationsInitiales(state).map((c, i) => `
            <tr data-config="${i}">
                <td><input type="checkbox" data-role="choix" disabled title="Choisir cette configuration"></td>
                <td class="cm-col-config">Config. ${i + 1}</td>
                <td><select data-champ="orientation">${MODES_DE_POSE.map((m) =>
                    `<option value="${m.valeur}"${m.valeur === c.orientation ? ' selected' : ''}>${m.libelle}</option>`).join('')}</select></td>
                ${CHAMPS_OPTIM.map((k) => `<td>
                    <input type="number" data-champ="${k}" value="${c[k]}" min="${BORNES[k].min}" max="${BORNES[k].max}" step="${BORNES[k].integer ? 1 : 'any'}">
                    <div data-erreur="${k}" style="display:none; color:#dc3545; font-size:0.7rem; max-width:120px; margin:auto;"></div></td>`).join('')}
                ${COLONNES_RESULTATS.map((col) => `<td class="cm-shed-res" data-res="${col.cle}">—</td>`).join('')}
            </tr>`).join('');

        const corps = corpsNeuf(modal);
        corps.innerHTML = `
            <p style="margin:0 0 10px 0; font-size:0.85rem; color:#374151;">
                Définissez ${NB_CONFIGURATIONS} configurations puis lancez le calcul : les ${NB_CONFIGURATIONS} calepinages
                sont calculés en parallèle, sans modifier le champ PV. Cochez ensuite la configuration à retenir et cliquez sur « Appliquer ».
            </p>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:0.85rem;">
                <label for="cmShedOptimFiltre" style="margin:0; font-weight:600; color:#374151;">Affichage :</label>
                <select id="cmShedOptimFiltre" data-role="filtre" disabled style="height:30px; font-size:0.85rem; width:auto; min-width:240px; max-width:320px; flex:0 0 auto;">
                    ${FILTRES.map((f) => `<option value="${f.valeur}">${f.libelle}</option>`).join('')}
                </select>
            </div>
            <div style="overflow-x:auto;">
            <table class="cm-shed-optim-table">
                <colgroup>${COLONNES_SAISIE.concat(COLONNES_RESULTATS).map((col) => `<col style="width:${col.largeur}%;">`).join('')}</colgroup>
                <thead><tr>
                    ${COLONNES_SAISIE.map((col) => `<th${col.champ ? ` title="${echapper(BORNES[col.champ].label)}"` : ''}>${col.entete}</th>`).join('')}
                    ${COLONNES_RESULTATS.map((col) => `<th>${col.libelle}</th>`).join('')}
                </tr></thead>
                <tbody>${lignes}</tbody>
            </table></div>
            <div data-role="statut" style="margin-top:10px; font-size:0.8rem; color:#374151;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
                <button type="button" data-role="lancer" class="btn btn-primary" style="background:#005A9E; border-color:#005A9E;"><i class="fas fa-play"></i> Lancer le calcul d'optimisation</button>
                <button type="button" data-role="appliquer" class="btn btn-success" disabled><i class="fas fa-check"></i> Appliquer</button>
                <button type="button" data-role="fermer-bas" class="btn btn-secondary">Fermer</button>
            </div>`;

        const statut = corps.querySelector('[data-role="statut"]');
        const btnLancer = corps.querySelector('[data-role="lancer"]');
        const btnAppliquer = corps.querySelector('[data-role="appliquer"]');
        const selectFiltre = corps.querySelector('[data-role="filtre"]');
        const trs = Array.from(corps.querySelectorAll('tr[data-config]'));
        // Résultats affichés : { configs, resultats } — vidés dès qu'une saisie change.
        let calcul = null;
        // Génération : une saisie modifiée pendant un calcul rend sa réponse caduque.
        let generation = 0;

        const lireLigne = (tr) => {
            const cfg = { orientation: tr.querySelector('[data-champ="orientation"]').value === 'paysage' ? 'paysage' : 'portrait' };
            let valide = true;
            CHAMPS_OPTIM.forEach((k) => {
                const input = tr.querySelector(`[data-champ="${k}"]`);
                const err = erreurSaisie(input.value, BORNES[k]);
                const zone = tr.querySelector(`[data-erreur="${k}"]`);
                input.style.borderColor = err ? '#dc3545' : '';
                zone.style.display = err ? 'block' : 'none';
                zone.textContent = err || '';
                if (err) valide = false;
                else cfg[k] = Number(String(input.value).trim().replace(',', '.'));
            });
            return valide ? cfg : null;
        };

        const majAppliquer = () => {
            const coche = corps.querySelector('[data-role="choix"]:checked');
            btnAppliquer.disabled = !coche || coche.closest('tr').style.display === 'none';
        };

        const appliquerFiltre = () => {
            const retenues = calcul ? selectionParFiltre(calcul.resultats, selectFiltre.value) : null;
            trs.forEach((tr, i) => {
                const visible = !retenues || retenues[i];
                tr.style.display = visible ? '' : 'none';
                if (!visible) tr.querySelector('[data-role="choix"]').checked = false;
            });
            if (retenues && !retenues.some(Boolean)) {
                statut.textContent = 'Aucune configuration ne dispose de cette donnée (perte d\'ombrage non calculée ?).';
            }
            majAppliquer();
        };

        const invalider = () => {
            generation += 1;
            calcul = null;
            trs.forEach((tr, i) => {
                tr.classList.remove('cm-shed-optimale');
                tr.querySelector('.cm-col-config').textContent = `Config. ${i + 1}`;
                tr.querySelectorAll('[data-res]').forEach((c) => { c.textContent = '—'; c.title = ''; });
                const choix = tr.querySelector('[data-role="choix"]');
                choix.checked = false; choix.disabled = true;
            });
            selectFiltre.value = 'toutes';
            selectFiltre.disabled = true;
            appliquerFiltre();
            btnLancer.disabled = false;
        };

        // Toute modification d'une saisie invalide les résultats affichés (ils ne correspondent plus).
        const surSaisie = (e) => {
            if (!e.target.dataset.champ) return;
            lireLigne(e.target.closest('tr'));
            if (calcul || btnLancer.disabled) { invalider(); statut.textContent = 'Saisie modifiée : relancez l\'optimisation.'; }
        };
        corps.addEventListener('input', surSaisie);
        corps.addEventListener('change', (e) => {
            if (e.target.dataset.champ === 'orientation') { surSaisie(e); return; }
            if (e.target === selectFiltre) { appliquerFiltre(); return; }
            if (e.target.dataset.role !== 'choix') return;
            if (e.target.checked) {
                corps.querySelectorAll('[data-role="choix"]').forEach((c) => { if (c !== e.target) c.checked = false; });
            }
            majAppliquer();
        });

        btnLancer.addEventListener('click', async () => {
            const configs = trs.map(lireLigne);
            if (configs.some((c) => !c)) {
                statut.textContent = 'Corrigez les valeurs en rouge avant de lancer l\'optimisation.';
                return;
            }
            const etat = etatDuChamp(id);
            if (!etat) return;
            invalider();
            const maGeneration = generation;
            const position = positionProjet(id);
            btnLancer.disabled = true;
            statut.textContent = `Calcul des ${configs.length} configurations en cours…`;
            trs.forEach((tr) => tr.querySelectorAll('[data-res]').forEach((c) => { c.textContent = '…'; }));

            const resultatsConfigs = await Promise.all(configs.map((c) =>
                evaluerAvecOmbrage(etatPourConfiguration(etat, c), position, id).catch((err) => {
                    console.error('[Sheds] Évaluation d\'une configuration', err);
                    return null;
                })));
            if (maGeneration !== generation) return; // saisie modifiée entre-temps : résultat caduc

            calcul = { configs, resultats: resultatsConfigs };
            resultatsConfigs.forEach((r, i) => {
                const tr = trs[i];
                tr.querySelectorAll('[data-res]').forEach((cellule) => {
                    const col = COLONNES_RESULTATS.find((x) => x.cle === cellule.dataset.res) || {};
                    cellule.textContent = r ? texteValeur(r[cellule.dataset.res]) : 'Aucun panneau';
                    const erreur = r && (cellule.dataset.res === 'perteOmbrage' ? r.erreurOmbrage : col.erreur ? r[col.erreur] : null);
                    cellule.title = erreur || '';
                });
                tr.querySelector('[data-role="choix"]').disabled = !r;
                const etiquette = tr.querySelector('.cm-col-config');
                etiquette.textContent = `Config. ${i + 1}`;
            });
            selectFiltre.disabled = false;
            const optimal = indexOptimal(resultatsConfigs);
            if (optimal.index >= 0) {
                const trOpt = trs[optimal.index];
                trOpt.classList.add('cm-shed-optimale');
                trOpt.querySelector('[data-role="choix"]').checked = true;
                trOpt.querySelector('.cm-col-config').innerHTML = `Config. ${optimal.index + 1}<br><span style="color:#16a34a; font-size:0.72rem;">&#9733; Optimale</span>`;
                const cleOmbrage = optimal.critere === 'terrain' ? 'perteOmbrageTerrainBrute' : 'perteOmbrageBrute';
                const sansOmbrage = resultatsConfigs.filter((r) => r && r[cleOmbrage] === null);
                const critere = optimal.critere === 'terrain' ? 'perte d\'ombrage avec terrain' : 'perte d\'ombrage entre shed (terrain plat)';
                const sansTerrain = optimal.critere === 'plat' && resultatsConfigs.some((r) => r && r.terrainApplicable)
                    ? ` Perte avec terrain indisponible pour au moins une configuration${(resultatsConfigs.find((r) => r && r.erreurOmbrageTerrain) || {}).erreurOmbrageTerrain ? ` (${echapper(resultatsConfigs.find((r) => r && r.erreurOmbrageTerrain).erreurOmbrageTerrain)})` : ''} : classement sur le terrain plat.` : '';
                statut.innerHTML = `Configuration optimale : <strong>Config. ${optimal.index + 1}</strong> (puissance nette d'ombrage la plus élevée : ${arrondi(optimal.score, 3)} kWc, ${critere})`
                    + (sansOmbrage.length ? ` — perte d'ombrage non calculée pour ${sansOmbrage.length} configuration(s), classées sur la puissance seule.` : '.')
                    + sansTerrain;
            } else {
                statut.textContent = 'Aucune configuration ne permet de poser de panneau.';
            }
            btnLancer.disabled = false;
            majAppliquer();
        });

        btnAppliquer.addEventListener('click', () => {
            const coche = corps.querySelector('[data-role="choix"]:checked');
            if (!coche || !calcul) return;
            const cfg = calcul.configs[Number(coche.closest('tr').dataset.config)];
            if (!cfg) return;
            modal.style.display = 'none';
            appliquerConfiguration(id, cfg);
        });

        corps.querySelector('[data-role="fermer-bas"]').addEventListener('click', () => { modal.style.display = 'none'; });
        ouvrirModal(modal);
    }

    /**
     * Écrit la configuration retenue dans l'état du champ, puis redessine (canevas + carte via
     * recomputeResults, CM.state basculé comme dans calepinage_maison_form_pro.js), sauvegarde,
     * resynchronise le formulaire PRO et relance "Calculer".
     */
    function appliquerConfiguration(pvId, cfg) {
        const CM = cm();
        const state = etatDuChamp(pvId);
        if (!state) return;
        state.shedPanelsPerGroup = cfg.nbPvParShed;
        state.shedSpacingM = cfg.espacementMm / 1000;
        state.penteDeg = cfg.penteDeg;
        if (typeof CM.signalerSaisieParametre === 'function') CM.signalerSaisieParametre(state, 'penteDeg');
        state.panelOrientation = cfg.orientation;

        const rafraichirFormulaire = () => {
            if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
            if (typeof CM.updateOrientationUI === 'function') CM.updateOrientationUI();
        };
        const precedent = CM.state;
        CM.state = state;
        try {
            rafraichirFormulaire();
            if (typeof CM.render === 'function') CM.render();
            if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        } catch (e) {
            console.warn('[Sheds] Redessin après optimisation', e);
        } finally {
            CM.state = precedent;
            if (precedent !== state && CM.modal && CM.modal.style.display !== 'none') {
                try {
                    rafraichirFormulaire();
                    if (typeof CM.render === 'function') CM.render();
                } catch (e) { /* modal pas prêt */ }
            }
        }
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'optimisationSheds');
        if (window.CalepinageMaisonFormPro) window.CalepinageMaisonFormPro.synchroniser(pvId);
        calculer(pvId);
    }

    // ------------------------------------------------------------------------------------------
    // Câblage
    // ------------------------------------------------------------------------------------------

    window.addEventListener('petitChampCalculerClicked', (e) => { calculer(pvIdDepuisEvenement(e.detail)); });
    window.addEventListener('petitChampResultatsClicked', (e) => { resultats(pvIdDepuisEvenement(e.detail)); });
    window.addEventListener('petitChampOptimisationClicked', (e) => { optimisation(pvIdDepuisEvenement(e.detail)); });

    window.CalepinageMaisonShedsActions = {
        calculer, resultats, optimisation, evaluer, evaluerAvecOmbrage, appliquerConfiguration, resultatsPourRapport, BORNES, FILTRES,
        _signature: signature, _surfaceContourM2: surfaceContourM2, _etatPourConfiguration: etatPourConfiguration,
        _selectionParFiltre: selectionParFiltre, _indexOptimal: indexOptimal,
        signatureOmbrageTerrain, ombragePourProduction, actualiserOmbragesProduction, _positionProjet: positionProjet,
    };
})();
