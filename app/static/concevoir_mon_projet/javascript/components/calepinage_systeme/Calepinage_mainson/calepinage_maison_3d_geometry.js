/**
 * Calepinage résidentiel — génération de la GÉOMÉTRIE 3D du bâtiment (Phase 1 : Monopente + Bipente
 * symétrique/asymétrique) à partir de l'emprise 2D déjà saisie (CM.state.roofLocal / CM.state.pans).
 *
 * PUR / SANS DOM / SANS BABYLON : ce fichier ne fait que transformer les données planaires (mètres,
 * repère local {x,y} — cf. calepinage_maison_calculs.js::latLngToLocal, +x = Est, +y = Nord) en
 * polygones 3D prêts à mailler. Le maillage Babylon proprement dit vit dans
 * calepinage_maison_3d_viewer.js (qui consomme la sortie de CM.buildResidential3DModel()).
 *
 * Repère de sortie = repère Babylon : X = Est, Y = altitude (haut), Z = Nord. Un point planaire
 * {x, y} devient donc {x: x - center.x, y: altitude, z: y - center.z}, recentré sur le centroïde de
 * l'emprise de la maison active pour que la scène reste proche de l'origine.
 *
 * "Hauteur bâtiment" (CM.state.batimentHeightM, nouveau champ, défaut 3 m) = sol → gouttière (bas de
 * pente). Le faîtage monte AU-DESSUS de cette hauteur selon la pente (CM.state.penteDeg) et la
 * distance rampante du pan. Les panneaux sont relevés de CM.state.railHeightMm (nouveau champ, défaut
 * 30 mm, "Hauteur système d'intégration" du modal Détails structure) au-dessus de la couverture.
 *
 * Hors périmètre Phase 1 (rendu quand même en "best effort", non garanti) : 4 pans croupe/symétrique
 * (arêtiers/noues), dôme, shed. Le calcul d'altitude par pan ci-dessous se généralise partiellement
 * (il s'appuie sur pan.ridgeEdgeIndices, déjà renseigné par toutes les divisions), mais seules les
 * toitures Monopente et Bipente sont testées/validées à ce stade.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    const DEG2RAD = Math.PI / 180;

    /**
     * Bornes de validation des objets de la scène 3D et des obstacles (demande explicite : valider
     * les dimensions avant rendu et calcul d'ombrage, pour des résultats fiables et un serveur qui
     * ne reçoit jamais de géométrie aberrante). Les bornes propres à chaque objet de la bibliothèque
     * sont dans scene_objects_library.js (fields[].min/max).
     *  - position : ±250 m autour de l'origine du champ (x = Est, z = Nord ; négatif = ouest/sud) ;
     *  - rotation : ramenée dans [0, 360[ ;
     *  - obstacle : largeur/longueur 0,05-50 m, hauteur dans les bornes de son type (CM.OBSTACLE_TYPES,
     *    sinon 0,02-50 m).
     */
    const SCENE_LIMITES = {
        positionMaxM: 250,
        obstacleDimMinM: 0.05, obstacleDimMaxM: 50,
        obstacleHauteurMinM: 0.02, obstacleHauteurMaxM: 50,
    };
    const bornerNum = (v, d, lo, hi) => {
        const n = Number(v);
        return Math.min(hi, Math.max(lo, isFinite(n) ? n : d));
    };
    const normaliserDeg = (deg) => ((((Number(deg) || 0) % 360) + 360) % 360);
    // Rayon (m) de l'emprise d'un objet à contour libre (bâtiment dessiné, params.points relatifs à
    // sa position) : cadrage caméra sur tout le bâtiment, pas seulement son centre. 0 sinon.
    function rayonContourObjet(params) {
        const pts = params && Array.isArray(params.points) ? params.points : [];
        return pts.reduce((r, p) => {
            const d = Math.hypot(Number(p && p.x) || 0, Number(p && p.z) || 0);
            return isFinite(d) ? Math.max(r, d) : r;
        }, 0);
    }

    /** Copie bornée d'un obstacle (l'original n'est pas modifié). null si position illisible. */
    function sanitizeObstacle(o) {
        if (!o || !isFinite(Number(o.x)) || !isFinite(Number(o.y))) return null;
        const L = SCENE_LIMITES;
        const def = (CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[o.type]) || {};
        const hMin = def.minElevationM != null ? def.minElevationM : L.obstacleHauteurMinM;
        const hMax = def.maxElevationM != null ? def.maxElevationM : L.obstacleHauteurMaxM;
        const hDef = def.defaultElevationM != null ? def.defaultElevationM : 0.3;
        return Object.assign({}, o, {
            x: bornerNum(o.x, 0, -L.positionMaxM, L.positionMaxM),
            y: bornerNum(o.y, 0, -L.positionMaxM, L.positionMaxM),
            w: bornerNum(o.w, def.defaultW || 1, L.obstacleDimMinM, L.obstacleDimMaxM),
            h: bornerNum(o.h, def.defaultH || 1, L.obstacleDimMinM, L.obstacleDimMaxM),
            elevationM: bornerNum(o.elevationM, hDef, hMin, hMax),
            angle: isFinite(Number(o.angle)) ? Number(o.angle) : 0,
        });
    }

    // Direction 2D de la ligne de plus grande pente (descendante) d'un pan Monopente, dérivée de son
    // azimut (convention du formulaire : Sud=0°, Ouest=90°, Est=-90°, Nord=±180°). Cap boussole =
    // azimut + 180 ; vecteur = {sin(cap), cos(cap)} dans le repère local (+x Est, +y Nord).
    function downslopeDirFromAzimuth(azimuthDeg) {
        const capRad = ((Number(azimuthDeg) || 0) + 180) * DEG2RAD;
        return { x: Math.sin(capRad), y: Math.cos(capRad) };
    }

    // Distance d'un point {x,y} à la droite (infinie) passant par a et b.
    function distToLine(pt, a, b) {
        let dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        return Math.abs((pt.x - a.x) * (-dy) + (pt.y - a.y) * dx);
    }

    // Distance "rampante" d'un point du pan à son arête de FAÎTAGE (0 au faîtage, croît vers le bas
    // du pan = égout ou noue).
    // - Pan issu d'une division (ridgeEdgeIndices non vide) : distance perpendiculaire à l'arête de
    //   faîtage taguée.
    //   CORRECTIF (bug rapporté : "4 pans symétriques -> 2 pans en shed") : pour une toiture 4 pans
    //   symétrique, les pans centraux ont DEUX arêtes taguées (le faîtage ET la noue centrale). Sans
    //   info de type, ridgeIdx[0] pouvait être la NOUE -> pente inversée (aspect "shed"). Quand
    //   `ridgeLines` (lignes typées faîtage/noue) est fourni, on ne garde que les arêtes situées sur
    //   une ligne de type 'ridge' (le haut du pan).
    // - Pan Monopente non divisé : projection sur la direction de plus grande pente (azimut).
    function ridgeRunFn(pan, ridgeLines) {
        const pts = pan.points || [];
        let ridgeIdx = Array.isArray(pan.ridgeEdgeIndices) ? pan.ridgeEdgeIndices.slice() : [];
        if (ridgeIdx.length > 1 && Array.isArray(ridgeLines) && ridgeLines.length && pts.length >= 2) {
            const ridgeTypeLines = ridgeLines.filter((L) => L && L.type === 'ridge' && L.a && L.b);
            if (ridgeTypeLines.length) {
                const onRidge = ridgeIdx.filter((i) => {
                    const a = pts[i], b = pts[(i + 1) % pts.length];
                    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                    return ridgeTypeLines.some((L) => distToLine(mid, L.a, L.b) < 0.08);
                });
                if (onRidge.length) ridgeIdx = onRidge;
            }
        }
        if (ridgeIdx.length && pts.length >= 2) {
            const a = pts[ridgeIdx[0]];
            const b = pts[(ridgeIdx[0] + 1) % pts.length];
            let dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const nx = -dy, ny = dx; // normale unitaire à l'arête de faîtage
            return (pt) => Math.abs((pt.x - a.x) * nx + (pt.y - a.y) * ny);
        }
        // Monopente : pas d'arête de faîtage taguée -> direction de pente via l'azimut.
        const d = downslopeDirFromAzimuth(pan.azimuth);
        let minProj = Infinity;
        pts.forEach((p) => { minProj = Math.min(minProj, p.x * d.x + p.y * d.y); });
        if (!isFinite(minProj)) minProj = 0;
        return (pt) => (pt.x * d.x + pt.y * d.y) - minProj;
    }

    /**
     * Obstacles 2D posés AU SOL (pas sur une toiture) : ceux d'une ombrière / d'un petit champ
     * solaire, ou dessinés hors des pans d'un bâtiment. Pavé droit vertical de leur hauteur propre
     * (o.elevationM, sinon défaut du type — cf. CM.OBSTACLE_TYPES), depuis y = 0.
     * Source UNIQUE pour la vue 3D (model.groundObstacleGroups) et la scène d'ombrage.
     * @returns {Array<{id, type, label, color, height, quads}>} quads au format {x, y: altitude, z}.
     */
    function groundObstacleGroupsFor(obstacles, center) {
        const c0 = center || { x: 0, z: 0 };
        const groupes = [];
        (obstacles || []).map(sanitizeObstacle).forEach((o) => {
            if (!o || typeof CM.obstacleCornersTrue !== 'function') return;
            const coins = CM.obstacleCornersTrue(o);
            if (!coins || coins.length !== 4 || !coins.every((c) => isFinite(c.x) && isFinite(c.y))) return;
            const def = CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[o.type];
            const h = Math.max(0.02, Number(o.elevationM) || (def && def.defaultElevationM) || 0.3);
            const bas = coins.map((c) => ({ x: c.x - c0.x, y: 0, z: c.y - c0.z }));
            const haut = coins.map((c) => ({ x: c.x - c0.x, y: h, z: c.y - c0.z }));
            const quads = [];
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4;
                quads.push([bas[i], bas[j], haut[j], haut[i]]);
            }
            quads.push(haut);
            groupes.push({
                id: o.id, type: o.type, label: (def && def.label) || o.type || 'Obstacle',
                color: (def && def.color) || '#6b7280', height: h, quads,
            });
        });
        return groupes;
    }

    // Construit un bâtiment 3D à partir d'un état résidentiel (actif ou reprojeté). Toutes les
    // coordonnées planaires sont attendues dans le MÊME repère (celui de la maison active) — la
    // reprojection éventuelle est faite en amont par getOtherHousesReprojected().
    function buildOneBuilding(opts) {
        const { sourceId, footprint, pans, panelsByPan, center } = opts;
        const wallHeight = Math.max(0.2, Number(opts.wallHeight) || 3);
        const railGapM = Math.max(0, (Number(opts.railHeightMm) || 0) / 1000);
        const penteDeg = Number(opts.penteDeg) || 0;
        // Pente propre au 2e pan d'une toiture asymétrique (demande explicite). Défaut = penteDeg.
        const penteDeg2 = (opts.penteDeg2 != null && !isNaN(Number(opts.penteDeg2)))
            ? Number(opts.penteDeg2) : penteDeg;
        const ctx = { penteDeg, domeTiltDeg: Number(opts.domeTiltDeg) || 0, wallHeight };

        // "Type de faîtage" pour une toiture 2 pans ASYMÉTRIQUE (demande explicite) :
        //  - 'avec' (ouverture) : chaque pan garde SA hauteur de faîtage propre (selon SA pente et son
        //    rampant) -> les 2 arêtes de faîtage sont à des hauteurs différentes = partie verticale /
        //    clerestory, typique des bâtiments bois.
        //  - 'sans' (défaut) : pas de partie verticale — les 2 pans se rejoignent sur une seule ligne
        //    de faîtage (V inversé). Hauteur de faîtage commune = la PLUS HAUTE des deux (chaque pan
        //    calculé à SA pente) ; l'autre pan est redressé pour la rejoindre.
        const isAsym2Pans = opts.divisionMode === '2pans' && opts.lastTwoPanKind === 'asym';
        const sansOuverture = isAsym2Pans && (opts.faitageAsymType || 'sans') === 'sans';

        // PHASE 2 (demande explicite) : toiture 4 pans CROUPE (divisionMode '4pans' — pyramide OU avec
        // segment de faîtage + arêtiers). Chaque pan a exactement UNE arête sur le périmètre du
        // bâtiment (l'égout = la seule arête NON taguée dans ridgeEdgeIndices) ; il monte de cet égout
        // vers le faîtage/l'apex. Faîtage de niveau garanti quelle que soit la longueur de faîtage
        // saisie : hauteur commune = la plus haute des arêtes (chaque pan à SA pente), les autres
        // redressés pour la rejoindre -> les arêtiers se referment, pas de déchirure au sommet.
        const isCroupe = opts.divisionMode === '4pans';

        // Toiture terrasse : la "Pente toiture" incline la dalle en 3D (drainage / croupe basse pente)
        // — un pan 'plat' d'une terrasse n'est donc PAS forcément à 0° (bug rapporté : "pente 20°,
        // toiture reste à plat").
        const normTm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(opts.typeMontage) : opts.typeMontage;
        const isTerrasse = normTm === 'toiture_terrasse';

        // Pente (deg) d'un pan pour le CALCUL 3D : Pan 2 d'une toiture asym -> penteDeg2 ;
        // dôme -> domeTiltDeg ; plat -> 0 SAUF toiture terrasse (où la pente incline la dalle) ;
        // sinon penteDeg.
        function penteDegForPan(pan) {
            if (!pan) return penteDeg;
            // Scène d'ombrage (calepinage_maison_ombrage_scene.js) : sous des sheds, la pente saisie
            // est celle des PANNEAUX, pas de la dalle — la dalle reste horizontale.
            if (opts.dalleShedHorizontale && (pan.poseMode === 'shed' || pan.poseMode === 'dome')) return 0;
            if (pan.poseMode === 'dome') return ctx.domeTiltDeg || 0;
            if (pan.poseMode === 'plat') return isTerrasse ? penteDeg : 0;
            return (isAsym2Pans && pan.id === 'Pan 2') ? penteDeg2 : penteDeg;
        }

        // Distance perpendiculaire d'un point du pan à son arête d'ÉGOUT (croupe) = la seule arête
        // NON taguée dans ridgeEdgeIndices. 0 à l'égout, croît vers le faîtage/l'apex.
        function eaveDistFn(pan) {
            const pts = pan.points || [];
            const tagged = new Set(pan.ridgeEdgeIndices || []);
            let eaveEdge = -1;
            for (let i = 0; i < pts.length; i++) {
                if (!tagged.has(i)) { if (eaveEdge === -1) eaveEdge = i; else { eaveEdge = -2; break; } }
            }
            if (eaveEdge < 0) eaveEdge = 0; // repli : pas exactement 1 arête libre
            const a = pts[eaveEdge], b = pts[(eaveEdge + 1) % pts.length];
            let dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
            let nx = -dy, ny = dx;
            // Oriente la normale vers l'INTÉRIEUR du pan (centroïde) : points internes -> distance > 0,
            // points au-delà de l'égout (porte-à-faux) -> distance < 0.
            let cx = 0, cy = 0;
            pts.forEach((p) => { cx += p.x; cy += p.y; });
            cx /= pts.length; cy /= pts.length;
            if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; }
            return (pt) => (pt.x - a.x) * nx + (pt.y - a.y) * ny;
        }

        // Pré-passe : run(), maxRun et hauteur de faîtage propre (rampant * tan(pente_du_pan)) par pan.
        const ridgeLines = Array.isArray(opts.ridgeLines) ? opts.ridgeLines : [];
        const panRunFns = (pans || []).map((p) => ridgeRunFn(p, ridgeLines));
        const panMaxRuns = (pans || []).map((p, i) => {
            let m = 0;
            (p.points || []).forEach((pt) => { m = Math.max(m, panRunFns[i](pt)); });
            return m;
        });
        const panRidgeRises = (pans || []).map((p, i) => panMaxRuns[i] * Math.tan(penteDegForPan(p) * DEG2RAD));
        // Faîtage commun ("sans ouverture") = la plus haute des arêtes de faîtage propres.
        const commonRise = panRidgeRises.length ? Math.max.apply(null, panRidgeRises) : 0;

        // Pré-passe CROUPE : distance à l'égout par pan, distance max (au faîtage/apex), et hauteur de
        // faîtage COMMUNE (= la plus haute des arêtes propres, pour un faîtage de niveau).
        const panEaveFns = isCroupe ? (pans || []).map((p) => eaveDistFn(p)) : [];
        const panEaveMax = isCroupe ? (pans || []).map((p, i) => {
            let m = 0;
            (p.points || []).forEach((pt) => { m = Math.max(m, Math.abs(panEaveFns[i](pt))); });
            return m;
        }) : [];
        const croupeRise = isCroupe && panEaveMax.length
            ? Math.max.apply(null, panEaveMax.map((d) => d * Math.tan(penteDeg * DEG2RAD)).concat([0]))
            : 0;

        const to2D = (p) => ({ x: p.x - center.x, z: p.y - center.z });
        const lift = (p, y) => ({ x: p.x - center.x, y, z: p.y - center.z });

        const footprint2D = (footprint || []).map(to2D);

        const roofPolys = [];
        const skirtQuads = [];
        const panelQuads = [];
        // Panneaux regroupés par pan (même ordre que `pans`) : un champ PV = un pan pour le calcul de
        // production (cf. getAllPvFieldSummaries), donc aussi pour l'ombrage proche.
        const panelQuadsByPan = [];
        // NOUVEAU (demande explicite : "donner des hauteurs aux obstacles pour leur affichage dans la
        // modélisation 3D") : un groupe par obstacle {color, quads} — regroupés par couleur (donc par
        // type) côté viewer pour limiter le nombre de matériaux/meshes créés.
        const obstacleGroups = [];
        let maxHeight = wallHeight;

        // Rattache chaque obstacle au PAN sur lequel il repose (nécessaire pour lire la bonne fonction
        // d'altitude ci-dessous, propre à chaque pan) : panId (posé à la création de l'obstacle) en
        // priorité, repli géométrique (point dans le contour) si absent/périmé (obstacle dupliqué avant
        // ce correctif, contour redivisé depuis...).
        const obstacles = (Array.isArray(opts.obstacles) ? opts.obstacles : []).map(sanitizeObstacle).filter(Boolean);
        const obstaclePanIndex = obstacles.map((o) => {
            let idx = (pans || []).findIndex((p) => p.id === o.panId);
            if (idx === -1 && typeof CM.pointInPolygon === 'function') {
                idx = (pans || []).findIndex((p) => CM.pointInPolygon({ x: o.x, y: o.y }, p.points || []));
            }
            return idx;
        });

        // Porte-à-faux (toujours stockés en MÈTRES dans CM.state). Le calepinage 2D bufferise la zone
        // de pose des panneaux de la MOYENNE des 2 (cf. computeCandidatePanelSlots) — on étend donc le
        // plan de toiture d'autant sur toutes les arêtes SAUF le faîtage (qui ne déborde jamais), pour
        // que la toiture couvre exactement les panneaux, sans jamais qu'un panneau dépasse.
        const overhangAvg = Math.max(0,
            ((Number(opts.overhangRampant) || 0) + (Number(opts.overhangLongpan) || 0)) / 2);

        (pans || []).forEach((pan, panIndex) => {
            const pts = pan.points || [];
            if (pts.length < 3) return;
            const tan = Math.tan(penteDegForPan(pan) * DEG2RAD); // pente propre au pan (Pan 2 asym -> penteDeg2)
            const run = panRunFns[panIndex]; // 0 au faîtage, croît vers l'égout — défini sur pts D'ORIGINE
            const maxRun = panMaxRuns[panIndex];
            // maxRun = distance rampante faîtage -> égout (mur). L'égout est à la hauteur du bâtiment ;
            // le faîtage monte de maxRun*tan(pente). altitude(pt) = wallHeight + (maxRun - run(pt))*tan :
            // PAS de clamp -> au-delà du mur (porte-à-faux) l'altitude passe SOUS wallHeight, la toiture
            // débordant vers le bas dans le prolongement du rampant (comme les modèles de la librairie).
            // Mode "sans ouverture" : hauteur de faîtage COMMUNE (commonRise) -> les 2 pans se
            // rejoignent (V inversé), le pan étroit ayant une pente effective plus forte.
            // Croupe : depuis l'égout vers le faîtage/apex, hauteur de faîtage commune (croupeRise) ->
            // arêtiers fermés, apex unique. Distance signée -> au-delà de l'égout (porte-à-faux),
            // altitude sous wallHeight.
            const eaveMax = isCroupe ? panEaveMax[panIndex] : 0;
            const elevation = isCroupe
                ? (pt) => wallHeight + (eaveMax > 1e-6 ? (panEaveFns[panIndex](pt) / eaveMax) : 0) * croupeRise
                : (sansOuverture && maxRun > 1e-6)
                    ? (pt) => wallHeight + (1 - run(pt) / maxRun) * commonRise
                    : (pt) => wallHeight + (maxRun - run(pt)) * tan;

            // Contour de la SURFACE de toiture = pts d'origine, arêtes non-faîtage décalées vers
            // l'extérieur du porte-à-faux (les murs, eux, restent sur footprint = Largeur x longueur).
            let roofPts = pts;
            if (overhangAvg > 0 && typeof CM.offsetPolygonEdges === 'function') {
                const ridgeSet = new Set(pan.ridgeEdgeIndices || []);
                const dists = pts.map((_, i) => (ridgeSet.has(i) ? 0 : overhangAvg));
                try { roofPts = CM.offsetPolygonEdges(pts, dists, false) || pts; } catch (e) { roofPts = pts; }
            }

            const poly3D = roofPts.map((p) => {
                const y = elevation(p);
                if (y > maxHeight) maxHeight = y;
                return lift(p, y);
            });
            roofPolys.push(poly3D);

            // Jupe verticale sous CHAQUE arête du pan : du haut de mur (wallHeight) jusqu'au plan de
            // toiture. Règle uniforme : arête d'égout -> quad dégénéré (hauteur nulle, inoffensif) ;
            // arêtes de rive -> pignon incliné ; arête de faîtage (Bipente) -> les 2 pans produisent
            // chacun un triangle jusqu'au même faîtage = pignon triangulaire complet.
            // CROUPE : aucune jupe — un toit à croupe n'a pas de pignon ; les plans de toiture se
            // rejoignent le long des arêtiers et ferment le volume.
            for (let i = 0; !isCroupe && i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const ya = elevation(a), yb = elevation(b);
                if (ya <= wallHeight + 1e-4 && yb <= wallHeight + 1e-4) continue;
                skirtQuads.push([
                    lift(a, wallHeight), lift(b, wallHeight), lift(b, yb), lift(a, ya),
                ]);
            }

            // Panneaux du pan, relevés dans le plan incliné + jeu "système d'intégration".
            const panels = (panelsByPan && panelsByPan[panIndex]) || [];
            const quadsOfPan = [];
            // Sheds (scène d'ombrage seulement) : chaque module de rangées est incliné à la pente
            // des panneaux au-dessus de la couverture, au lieu d'être plaqué dessus.
            const shedLift = (opts.panneauxShedInclines && pan.poseMode === 'shed' && typeof CM.liftPanelsTilted === 'function')
                ? CM.liftPanelsTilted(panels, {
                    baseElevation: (c) => elevation(c) + railGapM,
                    tiltDeg: (isAsym2Pans && pan.id === 'Pan 2') ? penteDeg2 : penteDeg,
                    azimuthDeg: pan.azimuth,
                    groupSize: opts.shedPanelsPerGroup,
                })
                : null;
            // Dômes (scène d'ombrage seulement) : chaque côté des rangées incliné à domeTiltDeg vers
            // son propre azimut (cf. CM.azimutsCotesDome), le faîtage de la rangée au centre.
            let domeLift = null;
            if (opts.panneauxShedInclines && pan.poseMode === 'dome' && panels.length
                && typeof CM.liftPanelsTilted === 'function' && typeof CM.azimutsCotesDome === 'function') {
                const azimuts = CM.azimutsCotesDome(pan, panels[0].angle);
                domeLift = new Array(panels.length);
                [0, 1].forEach((cote) => {
                    const idx = [];
                    panels.forEach((p, i) => { if ((CM.coteDomePanneau(p.panelIndex) === 0 ? 0 : 1) === cote) idx.push(i); });
                    if (!idx.length) return;
                    const releves = CM.liftPanelsTilted(idx.map((i) => panels[i]), {
                        baseElevation: (c) => elevation(c) + railGapM,
                        tiltDeg: ctx.domeTiltDeg || 0,
                        azimuthDeg: azimuts[cote],
                        groupSize: 1,
                    });
                    idx.forEach((i, j) => { domeLift[i] = releves[j]; });
                });
            }
            panels.forEach((panel, i) => {
                const corners = CM.panelCornersTrue(panel);
                if (!corners || corners.length !== 4) return;
                const quad = (domeLift && domeLift[i])
                    ? domeLift[i].map((c) => lift(c, c.elev))
                    : shedLift
                    ? shedLift[i].map((c) => lift(c, c.elev))
                    : corners.map((c) => lift(c, elevation(c) + railGapM));
                panelQuads.push(quad);
                quadsOfPan[i] = quad; // même index que `panels` (côtés de dôme, cf. ombrage_scene)
            });
            panelQuadsByPan[panIndex] = quadsOfPan;

            // Obstacles (vélux, cheminée, lanterneau...) rattachés à CE pan : extrudés depuis le plan
            // de toiture (chaque coin suit la pente, comme les panneaux ci-dessus) jusqu'à leur
            // hauteur PROPRE (o.elevationM, par type — cf. CM.OBSTACLE_TYPES). 4 faces latérales +
            // 1 chapeau ; pas de face basse (posée sur la toiture, jamais vue).
            obstacles.forEach((o, oi) => {
                if (obstaclePanIndex[oi] !== panIndex) return;
                if (typeof CM.obstacleCornersTrue !== 'function') return;
                const baseCorners = CM.obstacleCornersTrue(o);
                if (!baseCorners || baseCorners.length !== 4) return;
                const def = CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[o.type];
                const elevM = Math.max(0.02, Number(o.elevationM) || (def && def.defaultElevationM) || 0.3);
                const baseY = baseCorners.map((c) => elevation(c));
                // CORRECTIF (bug rapporté, capture à l'appui : "l'obstacle 3D n'a pas d'angles droits
                // par rapport à la toiture") : l'extrusion était VERTICALE — sur un pan incliné, les
                // faces avant/arrière formaient un parallélogramme penché. Elle suit désormais la
                // NORMALE au pan (vélux, lanterneau, VMC... = pavé droit posé sur la toiture). Une
                // cheminée reste verticale, comme en réalité. Pan horizontal : identique à avant.
                let n = { x: 0, y: 1, z: 0 };
                if (o.type !== 'cheminee') {
                    const c0 = { x: o.x, y: o.y };
                    const e0 = elevation(c0);
                    const gx = elevation({ x: o.x + 1, y: o.y }) - e0;
                    const gy = elevation({ x: o.x, y: o.y + 1 }) - e0;
                    const len = Math.hypot(gx, 1, gy);
                    if (isFinite(len) && len > 0) n = { x: -gx / len, y: 1 / len, z: -gy / len };
                }
                const topCorners = baseCorners.map((c) => ({ x: c.x + n.x * elevM, y: c.y + n.z * elevM }));
                const topY = baseY.map((y) => y + n.y * elevM);
                const quads = [];
                for (let i = 0; i < 4; i++) {
                    const j = (i + 1) % 4;
                    quads.push([lift(baseCorners[i], baseY[i]), lift(baseCorners[j], baseY[j]),
                    lift(topCorners[j], topY[j]), lift(topCorners[i], topY[i])]);
                }
                quads.push(topCorners.map((c, i) => lift(c, topY[i]))); // chapeau
                obstacleGroups.push({ id: o.id, type: o.type, color: (def && def.color) || '#6b7280', quads });
                const maxTop = Math.max.apply(null, topY);
                if (maxTop > maxHeight) maxHeight = maxTop;
            });
        });

        // ACROTÈRE (demande explicite) : garde-corps périphérique d'une TOITURE TERRASSE. Ceinture le
        // contour du bâtiment (footprint), de wallHeight à wallHeight + acrotereHeightM. Faces
        // extérieure + intérieure (retrait `parapetThicknessM`) + chapeau. Pris en compte quel que
        // soit le type de calepinage (le champ n'apparaît que pour "Toiture terrasse", cf.
        // updatePoseModeUI).
        const parapetQuads = [];
        const acrotereH = Math.max(0, Number(opts.acrotereHeightM) || 0);
        if (isTerrasse && acrotereH > 0.001) {
            const fpM = footprint || [];
            const topY = wallHeight + acrotereH;
            const thick = 0.2;
            let innerM = fpM;
            if (typeof CM.offsetPolygonEdges === 'function') {
                try { innerM = CM.offsetPolygonEdges(fpM, fpM.map(() => thick), true) || fpM; } catch (e) { innerM = fpM; }
            }
            for (let i = 0; i < fpM.length; i++) {
                const oa = fpM[i], ob = fpM[(i + 1) % fpM.length];
                const ia = innerM[i] || oa, ib = innerM[(i + 1) % innerM.length] || ob;
                // face extérieure
                parapetQuads.push([lift(oa, wallHeight), lift(ob, wallHeight), lift(ob, topY), lift(oa, topY)]);
                // face intérieure (winding inversé)
                parapetQuads.push([lift(ia, wallHeight), lift(ia, topY), lift(ib, topY), lift(ib, wallHeight)]);
                // chapeau
                parapetQuads.push([lift(oa, topY), lift(ob, topY), lift(ib, topY), lift(ia, topY)]);
            }
            if (topY > maxHeight) maxHeight = topY;
        }

        // Obstacles 2D hors de tout pan (poteau, abri... dessinés à côté du bâtiment) : pavé posé au
        // sol, au lieu d'être ignorés (demande explicite : "les obstacles 2D doivent apparaître en 3D").
        const groundObstacleGroups = groundObstacleGroupsFor(
            obstacles.filter((o, oi) => obstaclePanIndex[oi] === -1), center);
        groundObstacleGroups.forEach((g) => { if (g.height > maxHeight) maxHeight = g.height; });

        // Murs (sol -> haut de mur) : le viewer les extrude lui-même depuis `footprint` ; exposés ici
        // pour la scène d'ombrage, où un mur peut masquer un champ plus bas (ombrière, petit champ).
        const wallQuads = (footprint || []).map((a, i, fp) => {
            const b = fp[(i + 1) % fp.length];
            return [lift(a, 0), lift(b, 0), lift(b, wallHeight), lift(a, wallHeight)];
        });

        return {
            sourceId: sourceId || null,
            wallHeight,
            footprint: footprint2D,
            roofPolys,
            skirtQuads,
            panelQuads,
            panelQuadsByPan,
            wallQuads,
            parapetQuads,
            obstacleGroups,
            groundObstacleGroups,
            maxHeight,
            // Texture des toits en 3D (cf. calepinage_maison_3d_textures_toit.js) : type normalisé
            // (texture par défaut) + choix du menu « Toit » propre à ce champ PV (null = auto).
            typeMontage: normTm,
            roofTexture3D: opts.roofTexture3D || null,
        };
    }

    /**
     * Point d'entrée : construit le modèle 3D de TOUTES les maisons connues (active + autres,
     * reprojetées dans le repère de l'active), recentré sur le centroïde de l'emprise active.
     * Retourne null si la maison active n'a pas encore d'emprise exploitable.
     */
    function buildResidential3DModel() {
        const activeFootprint = (CM.state.roofLocal || []).slice();
        if (activeFootprint.length < 3) return null;

        const center2D = CM.polygonCentroid(activeFootprint);
        // Repli sur le centre de la bbox si le centroïde est dégénéré (polygone quasi-plat / auto-
        // intersecté) — sinon tout le modèle 3D part en NaN (bug rapporté : "polygone libre, le 3D
        // ne s'affiche pas").
        let cx = center2D && isFinite(center2D.x) ? center2D.x : NaN;
        let cy = center2D && isFinite(center2D.y) ? center2D.y : NaN;
        if (!isFinite(cx) || !isFinite(cy)) {
            let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
            activeFootprint.forEach((p) => {
                mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
                mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
            });
            cx = (mnx + mxx) / 2; cy = (mny + mxy) / 2;
        }
        const center = { x: cx, z: cy };

        const activePans = (CM.state.pans && CM.state.pans.length)
            ? CM.state.pans
            : [{ id: 'Pan 1', points: activeFootprint, azimuth: 0, poseMode: CM.state.poseMode, ridgeEdgeIndices: [] }];

        // Ombrière / petit champ solaire issus du formulaire 2D : la structure principale de la maison
        // active EST cette structure (générée plus bas comme objet de scène) — on n'ajoute PAS le
        // volume "maison" et on N'appelle PAS packPanelsForPan (inutile ici, et son chemin polygone+
        // shed pouvait être très lent -> "le 3D ne s'affiche pas").
        let activeFormOmbriere = null, activeFormPetitChamp = null;
        try { if (typeof CM.getFormOmbriereObject === 'function') activeFormOmbriere = CM.getFormOmbriereObject(); } catch (e) { activeFormOmbriere = null; }
        try { if (typeof CM.getFormPetitChampObject === 'function') activeFormPetitChamp = CM.getFormPetitChampObject(); } catch (e) { activeFormPetitChamp = null; }
        const suppressBuilding = !!(activeFormOmbriere || activeFormPetitChamp);

        const activePanelsByPan = suppressBuilding ? [] : activePans.map((pan) => {
            try { return CM.packPanelsForPan(pan); } catch (e) { return []; }
        });

        const buildings = suppressBuilding ? [] : [buildOneBuilding({
            sourceId: CM.state.sourceId,
            footprint: activeFootprint,
            pans: activePans,
            panelsByPan: activePanelsByPan,
            wallHeight: CM.state.batimentHeightM,
            railHeightMm: CM.state.railHeightMm,
            penteDeg: CM.state.penteDeg,
            penteDeg2: CM.state.penteDeg2,
            domeTiltDeg: CM.state.domeTiltDeg,
            overhangRampant: CM.state.overhangRampant,
            overhangLongpan: CM.state.overhangLongpan,
            divisionMode: CM.state.divisionMode,
            lastTwoPanKind: CM.state.lastTwoPanKind,
            faitageAsymType: CM.state.faitageAsymType,
            ridgeLines: CM.state.ridgeLines,
            typeMontage: CM.state.typeMontage,
            roofTexture3D: CM.state.roofTexture3D,
            acrotereHeightM: CM.state.acrotereHeightM,
            obstacles: CM.state.obstacles,
            center,
        })];

        // CORRECTIF (bug rapporté : "la 3D n'affiche pas le calepinage dessiné mais un autre
        // calepinage en mémoire") : les autres champs PV n'étaient dessinés en 2D qu'avec la vue
        // combinée (CM.multiHouseViewActive, désactivée par défaut) mais TOUJOURS ajoutés en 3D. La
        // 3D suit désormais la même règle que la 2D : ce qui est affiché en plan est ce qui est généré.
        let others = [];
        if (CM.multiHouseViewActive) {
            try { others = CM.getOtherHousesReprojected() || []; } catch (e) { others = []; }
        }
        // CORRECTIF (bug rapporté : "plusieurs rectangles sur la carte, chaque champ PV avec son
        // propre type de structure — le modèle 3D affiche un bâtiment monopente au lieu de
        // l'ombrière/petit champ solaire configuré pour ce champ") : une AUTRE maison (h) dont le
        // typeMontage est form-driven (ombrière métal/bois, petit champ solaire) suit désormais
        // EXACTEMENT la même règle que la maison active (suppressBuilding ci-dessus, ligne ~380) —
        // h.formOmbriere/h.formPetitChamp sont calculés par getOtherHousesReprojected() (bascule
        // temporaire CM.state = cette maison, cf. calepinage_maison_orchestrateur.js), déjà dimensionnés
        // et positionnés sur LE PLAN DE CETTE MAISON, pas sur celui de la maison active. Aucun volume
        // "bâtiment" n'est donc créé pour elle ; sa structure est pilotée plus bas (otherHousesFormObjects).
        const otherHousesFormObjects = [];
        // Objets 3D posés sur les autres champs (déjà reprojetés), en lecture seule dans cette vue.
        const otherHousesSceneObjects = [];
        others.forEach((h) => {
            if (!h.roofLocal || h.roofLocal.length < 3) return;
            (h.sceneObjects3D || []).forEach((o) => otherHousesSceneObjects.push({ ...o, sourceId: h.sourceId }));
            if (h.formOmbriere || h.formPetitChamp) {
                if (h.formOmbriere) otherHousesFormObjects.push(h.formOmbriere);
                if (h.formPetitChamp) otherHousesFormObjects.push(h.formPetitChamp);
                return;
            }
            buildings.push(buildOneBuilding({
                sourceId: h.sourceId,
                footprint: h.roofLocal,
                pans: h.pans || [],
                panelsByPan: h.panelsByPan || [],
                wallHeight: h.batimentHeightM,
                railHeightMm: h.railHeightMm,
                penteDeg: h.penteDeg,
                penteDeg2: h.penteDeg2,
                domeTiltDeg: h.domeTiltDeg,
                overhangRampant: h.overhangRampant,
                overhangLongpan: h.overhangLongpan,
                divisionMode: h.divisionMode,
                lastTwoPanKind: h.lastTwoPanKind,
                faitageAsymType: h.faitageAsymType,
                ridgeLines: h.ridgeLines,
                typeMontage: h.typeMontage,
                roofTexture3D: h.roofTexture3D,
                acrotereHeightM: h.acrotereHeightM,
                obstacles: h.obstacles,
                center,
            }));
        });

        // Obstacles 2D au sol : hors pans des bâtiments (déjà dans chaque bâtiment) + TOUS ceux des
        // structures autoportées (ombrière / petit champ solaire), qui n'ont pas de toiture.
        const groundObstacleGroups = [];
        buildings.forEach((b) => { (b.groundObstacleGroups || []).forEach((g) => groundObstacleGroups.push(g)); });
        if (suppressBuilding) {
            groundObstacleGroupsFor(CM.state.obstacles, center).forEach((g) => groundObstacleGroups.push(g));
        }
        others.forEach((h) => {
            if (h.formOmbriere || h.formPetitChamp) {
                groundObstacleGroupsFor(h.obstacles, center).forEach((g) => groundObstacleGroups.push(Object.assign(g, { autreChamp: true })));
            }
        });

        let span = 0, maxHeight = 0;
        groundObstacleGroups.forEach((g) => {
            g.quads[4].forEach((p) => { span = Math.max(span, Math.hypot(p.x, p.z)); });
            maxHeight = Math.max(maxHeight, g.height);
        });
        buildings.forEach((b) => {
            b.footprint.forEach((p) => { span = Math.max(span, Math.hypot(p.x, p.z)); });
            maxHeight = Math.max(maxHeight, b.maxHeight);
        });

        const groundImage = buildGroundImage(center);
        if (groundImage) {
            groundImage.corners.forEach((c) => { span = Math.max(span, Math.hypot(c.x, c.z)); });
        }

        // NOUVEAU (Phase A) : objets de contexte 3D (arbre, bâtiment voisin, mât...). Données brutes
        // recentrées sur le même repère que le reste de la scène — le maillage (window.OBJECT_LIBRARY
        // [typeKey].build) est fait par calepinage_maison_3d_viewer.js.
        // Dimensions d'ombrière (longueur façade / largeur champ PV / pente) VERROUILLÉES sur la vue
        // en plan : recalculées ici à chaque rendu depuis l'emprise 2D courante — l'utilisateur ne
        // les modifie pas dans la fenêtre de personnalisation (cf. calepinage_maison_3d_ombriere_form.js).
        const planDims = (typeof CM.ombrierePlanDims === 'function') ? CM.ombrierePlanDims() : null;
        const isOmbriereKey = (k) => typeof k === 'string' && (k.indexOf('metal_') === 0 || k.indexOf('bois_') === 0);
        // Ombrière issue du formulaire 2D (typeMontage 'ombriere_metal'/'ombriere_bois') : objet de
        // scène synthétique reconstruit à chaque rendu, calé sur l'emprise du plan.
        const placedObjects = (CM.state.sceneObjects3D || []).slice();
        [activeFormOmbriere, activeFormPetitChamp].forEach((fo) => {
            if (!fo) return;
            placedObjects.push(fo);
            // Cadre caméra : sans volume "maison", garantir un span cohérent avec la structure.
            const p = fo.params || {};
            span = Math.max(span, (Math.max(Number(p.facadeLength) || 0, Number(p.panelWidth) || 0, (planDims && planDims.panelWidth) || 0) * 0.7) + 5);
        });
        const sceneObjects = placedObjects.map((o) => {
            const x = (Number(o.x) || 0) - center.x;
            const z = (Number(o.z) || 0) - center.z;
            span = Math.max(span, Math.hypot(x, z) + 3 + rayonContourObjet(o.params));
            const rotationDeg = normaliserDeg(o.rotationDeg);
            let params = o.params || {};
            // Paramètres bornés (fields[].min/max de la bibliothèque) : la 3D affiche exactement ce
            // que le calcul d'ombrage utilise, même pour un objet enregistré avant ces bornes.
            if (!isOmbriereKey(o.typeKey) && typeof window.sanitizeSceneObjectParams === 'function'
                && o.id !== CM.FORM_OMBRIERE_ID && o.id !== CM.FORM_PETITCHAMP_ID) {
                params = window.sanitizeSceneObjectParams(o.typeKey, params);
            }
            if (planDims && isOmbriereKey(o.typeKey)) {
                params = Object.assign({}, params, {
                    facadeLength: planDims.facadeLength,
                    panelWidth: planDims.panelWidth,
                    roofSlope: planDims.roofSlope,
                });
            }
            return { id: o.id, typeKey: o.typeKey, x, z, rotationDeg, params: params };
        });

        // CORRECTIF (suite) : structures form-driven des AUTRES maisons — PAS de verrouillage planDims
        // ici (ce serait celui de la maison ACTIVE, sans rapport avec leur propre plan) : leurs
        // dimensions/position sont déjà correctes, calculées sous la bascule temporaire CM.state de
        // getOtherHousesReprojected(). Identifiant préfixé par sourceId pour rester unique dans la
        // scène (getFormOmbriereObject()/getFormPetitChampObject() renvoient le même id littéral
        // '__cm_form_ombriere__'/'__cm_form_petitchamp__' quelle que soit la maison).
        otherHousesFormObjects.forEach((fo, idx) => {
            const x = (Number(fo.x) || 0) - center.x;
            const z = (Number(fo.z) || 0) - center.z;
            // Cadre caméra : toute la structure, pas seulement son centre (vue 3D de tous les champs).
            const pf = fo.params || {};
            const demiTaille = Math.max(Number(pf.facadeLength) || 0, Number(pf.panelWidth) || 0) / 2;
            span = Math.max(span, Math.hypot(x, z) + demiTaille + 3);
            sceneObjects.push({
                id: 'other_' + idx + '_' + fo.id,
                typeKey: fo.typeKey,
                x, z,
                rotationDeg: Number(fo.rotationDeg) || 0,
                params: fo.params || {},
            });
        });

        otherHousesSceneObjects.forEach((o) => {
            const x = (Number(o.x) || 0) - center.x;
            const z = (Number(o.z) || 0) - center.z;
            span = Math.max(span, Math.hypot(x, z) + 3 + rayonContourObjet(o.params));
            const params = (typeof window.sanitizeSceneObjectParams === 'function')
                ? window.sanitizeSceneObjectParams(o.typeKey, o.params || {}) : (o.params || {});
            sceneObjects.push({
                id: 'other_' + o.sourceId + '_' + o.id,
                typeKey: o.typeKey,
                x, z,
                rotationDeg: normaliserDeg(o.rotationDeg),
                params,
            });
        });

        return { center, buildings, groundImage, sceneObjects, groundObstacleGroups, span: span || 10, maxHeight: maxHeight || 3 };
    }

    // FIX (demande explicite) : faire apparaître la capture d'écran (fond de carte) au sol dans la
    // scène 3D. Reconstruit le quadrilatère couvert par l'image en mètres locaux à partir de
    // CM.state.mapScreenshotRef (2 points mètres <-> 2 points pixels), même transformation affine que
    // calepinage_maison_dessin.js::imagePixelToLocalMeters / le rendu 2D du fond -> l'image est donc
    // À LA MÊME ÉCHELLE que l'emprise. Retourne null si aucune capture n'est disponible/affichée.
    function buildGroundImage(center) {
        const img = CM.state.mapScreenshotImgObj;
        const ref = CM.state.mapScreenshotRef;
        if (!CM.state.showBackgroundImage || !img || !ref || !ref.p1 || !ref.p2) return null;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return null;

        // Repère "pixel Y vers le haut" pour rester cohérent avec le repère mètres (+y = Nord).
        const p1 = { x: ref.p1.x, y: -ref.p1.y };
        const p2 = { x: ref.p2.x, y: -ref.p2.y };
        const sv = { x: p2.x - p1.x, y: p2.y - p1.y };
        const mv = { x: ref.m2.x - ref.m1.x, y: ref.m2.y - ref.m1.y };
        const scale = Math.hypot(mv.x, mv.y) / (Math.hypot(sv.x, sv.y) || 1);
        const angle = Math.atan2(mv.y, mv.x) - Math.atan2(sv.y, sv.x);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const pxToLocal = (px, py) => {
            const rx = px - p1.x, ry = -py - p1.y; // -py : passage en Y vers le haut
            const x = (rx * cos - ry * sin) * scale;
            const y = (rx * sin + ry * cos) * scale;
            return { x: ref.m1.x + x, z: ref.m1.y + y };
        };
        // Ordre = coins pixel (0,0) haut-gauche, (w,0), (w,h), (0,h) — recentrés repère Babylon.
        const corners = [
            pxToLocal(0, 0), pxToLocal(w, 0), pxToLocal(w, h), pxToLocal(0, h),
        ].map((c) => ({ x: c.x - center.x, z: c.z - center.z }));

        let url = null;
        try { url = img.src || null; } catch (e) { url = null; }
        if (!url) return null;
        // `element`/`w`/`h` : le terrain 3D (calepinage_maison_3d_terrain.js) redessine la capture
        // au centre d'un canevas bordé, pour ne pas étirer ses pixels de bord sur tout le relief.
        return { url, corners, element: img, w, h };
    }

    /**
     * Relève des panneaux posés en plan sur un plan INCLINÉ (ombrière, petit champ solaire, sheds) :
     * le bord bas de chaque groupe regarde l'azimut du pan (convention du formulaire : Sud = 0°,
     * Ouest = 90°) et est posé à `baseElevation(coin)` ; l'altitude croît vers l'amont selon la pente.
     * Groupes : `groupSize` rangées consécutives (index "jx-jy" du calepinage) = un module de shed ;
     * sans groupSize, tout le pan forme un seul plan (ombrière monopente, chaque pan d'une ombrière Y).
     * @returns {Array<Array<{x,y,elev}>>} les 4 coins de chaque panneau, dans l'ordre de `panels`.
     */
    function liftPanelsTilted(panels, cfg) {
        const tan = Math.tan((Number(cfg.tiltDeg) || 0) * DEG2RAD);
        const d = downslopeDirFromAzimuth(cfg.azimuthDeg);
        const groupSize = Math.max(0, Math.round(Number(cfg.groupSize) || 0));
        const groupOf = (panel) => {
            if (!groupSize) return 0;
            const jy = parseInt(String(panel.panelIndex || '').split('-')[1], 10);
            return isFinite(jy) ? Math.floor(jy / groupSize) : 0;
        };
        const cornersList = panels.map((p) => CM.panelCornersTrue(p) || []);
        // Bord bas de chaque groupe = coin le plus avancé dans le sens de la descente.
        const lowEdge = new Map();
        panels.forEach((p, i) => {
            const g = groupOf(p);
            cornersList[i].forEach((c) => {
                const s = c.x * d.x + c.y * d.y;
                if (!lowEdge.has(g) || s > lowEdge.get(g)) lowEdge.set(g, s);
            });
        });
        return panels.map((p, i) => {
            const low = lowEdge.get(groupOf(p)) || 0;
            return cornersList[i].map((c) => ({
                x: c.x, y: c.y,
                elev: cfg.baseElevation(c) + (low - (c.x * d.x + c.y * d.y)) * tan,
            }));
        });
    }

    Object.assign(CM, {
        buildResidential3DModel, buildOneBuilding, liftPanelsTilted, groundObstacleGroupsFor,
        SCENE_LIMITES, sanitizeObstacle, normaliserDeg,
    });
})();
