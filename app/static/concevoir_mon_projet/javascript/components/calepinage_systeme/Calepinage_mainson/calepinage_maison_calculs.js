/**
 * Calepinage résidentiel — Calculs : géométrie pure, calepinage/collision de panneaux, division en
 * pans de toiture, comptage de structure. Aucun DOM, aucun canvas, aucun addEventListener.
 *
 * Fait partie de la scission de l'ancien calepinage_maison_indiv.js (3284 lignes, une seule
 * closure) en 4 fichiers : calculs (ce fichier) / dessin / formulaires / orchestrateur, tous
 * chargés en <script> classique (pas de module ES6, cf. menu.html) et reliés par le namespace
 * partagé window.CalepinageMaisonIndiv (CM ci-dessous) — seul moyen de partager un état mutable
 * entre plusieurs balises <script>, chacune ayant sa propre portée top-level.
 *
 * CM.state remplace l'ancienne variable `let state` (réassignée ailleurs, dans orchestrateur et
 * formulaires) : toujours déréférencée à l'intérieur des corps de fonction ci-dessous, jamais mise
 * en cache dans une variable de portée fichier (state est réassigné en cours de vie).
 *
 * Convention de ce fichier : les fonctions utilisées UNIQUEMENT ici restent des déclarations
 * locales ordinaires (pas de préfixe CM.) ; celles appelées depuis dessin.js/formulaires.js sont
 * en plus exposées via CM.nomFonction = nomFonction (bloc d'export en fin de fichier), tout en
 * restant appelables localement par leur nom nu (aucun changement des appels internes).
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // --------------------------------------------------------------------------------------
    // Bibliothèque d'obstacles (étape 3) — exportée (lue par dessin.js et formulaires.js)
    // --------------------------------------------------------------------------------------
    // defaultElevationM/minElevationM/maxElevationM (demande explicite) : hauteur PHYSIQUE de
    // l'obstacle au-dessus du plan de toiture, utilisée UNIQUEMENT pour son extrusion dans la vue 3D
    // (cf. calepinage_maison_3d_geometry.js) — à ne pas confondre avec defaultW/defaultH, l'empreinte
    // 2D (vue de dessus) de l'obstacle. Bornes exactes demandées pour velux/lanterneau/forme/
    // cheminée/circulaire ; vmc/ligne (non demandés) reçoivent une valeur par défaut raisonnable du
    // même ordre de grandeur, à ajuster si besoin.
    CM.OBSTACLE_TYPES = {
        velux: { label: 'Velux', defaultW: 1.0, defaultH: 1.3, defaultBuffer: 0.15, color: '#0ea5e9', defaultElevationM: 0.2, minElevationM: 0.1, maxElevationM: 0.5 },
        // NOUVEAU (demande explicite) : copie conforme du Velux (mêmes dimensions/buffer/couleur,
        // même comportement — rien d'autre à câbler, cf. setupPaletteDrag/onDocumentMouseUp dans
        // dessin.js, génériques sur CM.OBSTACLE_TYPES).
        lanterneau: { label: 'Lanterneau', defaultW: 1.0, defaultH: 1.3, defaultBuffer: 0.15, color: '#0ea5e9', defaultElevationM: 0.45, minElevationM: 0.2, maxElevationM: 0.7 },
        cheminee: { label: 'Cheminée', defaultW: 0.8, defaultH: 0.8, defaultBuffer: 0.3, color: '#dc2626', defaultElevationM: 1.5, minElevationM: 0.5, maxElevationM: 3 },
        vmc: { label: 'Sortie VMC', defaultW: 0.5, defaultH: 0.5, defaultBuffer: 0.2, color: '#f59e0b', defaultElevationM: 0.3, minElevationM: 0.1, maxElevationM: 0.6 },
        forme: { label: 'Forme libre', defaultW: 1.0, defaultH: 1.0, defaultBuffer: 0.1, color: '#6b7280', defaultElevationM: 0.5, minElevationM: 0.2, maxElevationM: 5 },
        circulaire: { label: 'Obstacle circulaire', defaultW: 0.6, defaultH: 0.6, defaultBuffer: 0.2, color: '#8b5cf6', shape: 'circle', defaultElevationM: 0.2, minElevationM: 0.1, maxElevationM: 3 },
        // NOUVEAU (demande explicite : "ajouter un obstacle ligne") : géométriquement déjà un
        // rectangle très fin (longueur = w, épaisseur = h) — aucune shape dédiée nécessaire, le
        // rendu/la collision/le hit-test rectangle déjà génériques (isPointInObstacleBuffer,
        // obstacleCornersTrue) s'appliquent tels quels, comme pour tous les autres types.
        ligne: { label: 'Obstacle ligne', defaultW: 1.5, defaultH: 0.1, defaultBuffer: 0.05, color: '#f97316', defaultElevationM: 0.1, minElevationM: 0.05, maxElevationM: 0.5 },
    };

    // --------------------------------------------------------------------------------------
    // "Type de structure supportant les panneaux" (#cmTypeMontageSelect, ex-"Type de montage") —
    // CORRECTIF (demande explicite) : nouvelles options ; reconnaît aussi les 4 anciennes valeurs
    // (free/terrasse/sur_imposition/building) pour les projets déjà enregistrés n'ayant pas encore
    // rouvert ce champ, afin de ne jamais afficher le <select> vide ni fausser le calcul PVGIS.
    // CORRECTIF (demande explicite : "Toiture résidentielle / Bâtiment incliné (métal-bois) /
    // Toiture terrasse / Ombrière / Champ solaire / Autres") : "Ombrière, champ solaire" (une seule
    // option jusqu'ici) scindée en 2 valeurs distinctes ('ombriere'/'champ_solaire'), et
    // 'toiture_residentielle' ajoutée comme NOUVEAU défaut (cf. createDefaultState() ci-dessous,
    // orchestrateur.js) — 'ombriere_champ', l'ancienne valeur combinée, n'est donc plus une valeur
    // canonique mais reste reconnue via TYPE_MONTAGE_LEGACY_MAP (projets déjà enregistrés avant ce
    // correctif : reportée sur 'ombriere' par défaut, l'utilisateur peut préciser "Champ solaire"
    // au besoin en rouvrant ce champ).
    // --------------------------------------------------------------------------------------
    // CORRECTIF (demande explicite) : "Ombrière" scindée par MATÉRIAU — 'ombriere_metal' /
    // 'ombriere_bois' / 'ombriere_solumbra' (Solumbra non sélectionnable pour l'instant) — mêmes
    // libellés que le formulaire calepinage.html. 'ombriere' générique conservé (projets existants).
    const TYPE_MONTAGE_VALUES = ['toiture_residentielle', 'toiture_inclinee', 'toiture_terrasse',
        'ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra', 'champ_solaire', 'mixte'];
    const TYPE_MONTAGE_LEGACY_MAP = {
        free: 'ombriere',
        terrasse: 'toiture_terrasse',
        sur_imposition: 'toiture_inclinee',
        building: 'toiture_inclinee',
        ombriere_champ: 'ombriere',
        // Valeurs du <select> "Type de structure" de calepinage.html (accents/casse).
        'Ombrière métal': 'ombriere_metal',
        'Ombrière bois': 'ombriere_bois',
        'Ombrière solumbra': 'ombriere_solumbra',
        'Ombrière-Solumbra': 'ombriere_solumbra',
        'Petit champ solaire': 'champ_solaire',
        'Toiture terasse': 'toiture_terrasse',
        'Toiture terrasse': 'toiture_terrasse',
        'Bâtiment incliné métal': 'toiture_inclinee',
        'bâtiment incliné bois': 'toiture_inclinee',
        'Toiture résidentielle': 'toiture_residentielle',
        'Autres': 'mixte',
    };

    function normalizeTypeMontage(value) {
        if (TYPE_MONTAGE_VALUES.includes(value)) return value;
        return TYPE_MONTAGE_LEGACY_MAP[value] || 'toiture_residentielle';
    }

    // true pour toute variante d'ombrière ('ombriere', 'ombriere_metal', 'ombriere_bois',
    // 'ombriere_solumbra') — utilisé par le formulaire (masquages) et la génération 3D.
    function isOmbriereType(value) {
        return normalizeTypeMontage(value).indexOf('ombriere') === 0;
    }

    // NOUVEAU (demande explicite : "lier le type de structure supportant les panneaux aux boutons de
    // type de calepinage disponibles") : n'affiche, pour chaque "Type de structure" (typeMontage), que
    // les boutons de calepinage (poseMode) pertinents — cf. updatePoseModeUI() (calepinage_maison_
    // formulaires.js), qui masque les autres et rebascule le mode actif dessus s'il n'est plus autorisé.
    const TYPE_MONTAGE_POSE_MODES = {
        toiture_residentielle: ['incline', 'shed'],
        toiture_inclinee: ['incline'],
        toiture_terrasse: ['plat', 'shed', 'dome'],
        ombriere: ['incline', 'shed'],
        ombriere_metal: ['incline', 'shed'],
        ombriere_bois: ['incline', 'shed'],
        ombriere_solumbra: ['incline', 'shed'],
        // "Petit champ solaire" : calepinage en SHED (dent de scie) uniquement — le bouton "Incliné"
        // est masqué (demande explicite). Le 3D en shed s'appuie sur geometrie_3D/Petit_champ_solaire/.
        champ_solaire: ['shed', 'dome'],
        mixte: ['incline', 'plat', 'dome', 'shed'],
    };

    // « Esp. bordure » par défaut selon le type de structure (demande explicite) : 250 mm en toiture
    // résidentielle et bâtiment incliné, 900 mm sinon (toiture terrasse, valeur historique).
    const EDGE_CLEARANCE_DEFAUTS_M = [0.90, 0.25];
    function edgeClearanceDefautM(typeMontage) {
        const v = normalizeTypeMontage(typeMontage);
        return (v === 'toiture_residentielle' || v === 'toiture_inclinee') ? 0.25 : 0.90;
    }

    function getAllowedPoseModes(typeMontage) {
        return TYPE_MONTAGE_POSE_MODES[typeMontage] || TYPE_MONTAGE_POSE_MODES.toiture_residentielle;
    }

    /** Mapping PVGIS confirmé : Toiture résidentielle/Bâtiment incliné/Toiture terrasse/Autres ->
     * 'building', Ombrière/Champ solaire -> 'free' (PVGIS n'accepte que ces 2 valeurs pour son
     * modèle thermique). */
    function typeMontageToPvgisMount(value) {
        const v = normalizeTypeMontage(value);
        return (isOmbriereType(v) || v === 'champ_solaire') ? 'free' : 'building';
    }

    function panelLengthM() { return (CM.state.panelLengthMm || 0) / 1000; }
    function panelWidthM() { return (CM.state.panelWidthMm || 0) / 1000; }
    function panelSpacingXM() { return (CM.state.panelSpacingXMm || 0) / 1000; }
    function panelSpacingYM() { return (CM.state.panelSpacingYMm || 0) / 1000; }
    // Panneaux d'une rangée de dôme (moitié de chaque côté) : 2, 4, 6 ... 14 ; toute autre valeur
    // (absente d'un état enregistré avant ce réglage, impaire, hors bornes) -> 2, le cas historique.
    const DOME_PANELS_VALIDES = [2, 4, 6, 8, 10, 12, 14];
    function domePanelsPerRow(state) {
        const n = Number((state || CM.state).domePanelsPerRow);
        return DOME_PANELS_VALIDES.includes(n) ? n : 2;
    }

    // --------------------------------------------------------------------------------------
    // Géométrie (repère local en mètres)
    // --------------------------------------------------------------------------------------
    function latLngToLocal(origin, latLng) {
        const metersPerLat = 111320;
        const metersPerLng = metersPerLat * Math.cos((origin.lat() * Math.PI) / 180);
        return {
            x: (latLng.lng() - origin.lng()) * metersPerLng,
            y: (latLng.lat() - origin.lat()) * metersPerLat
        };
    }

    function localToLatLng(origin, pt) {
        const metersPerLat = 111320;
        const metersPerLng = metersPerLat * Math.cos((origin.lat() * Math.PI) / 180);
        return new google.maps.LatLng(
            origin.lat() + pt.y / metersPerLat,
            origin.lng() + pt.x / metersPerLng
        );
    }

    function boundingBox(poly) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        poly.forEach((p) => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        return { minX, minY, maxX, maxY };
    }

    function simplifyCollinearLocal(points) {
        if (points.length <= 3) return points;
        const EPS = 1e-4;
        let pts = points.slice();
        let changed = true;
        while (changed && pts.length > 3) {
            changed = false;
            for (let i = 0; i < pts.length; i++) {
                const prev = pts[(i - 1 + pts.length) % pts.length];
                const cur = pts[i];
                const next = pts[(i + 1) % pts.length];
                const seg1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                const seg2 = Math.hypot(next.x - cur.x, next.y - cur.y);
                const cross = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x);
                if (seg1 < EPS || seg2 < EPS || Math.abs(cross) / (seg1 * seg2) < EPS) {
                    pts.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        return pts;
    }

    function polygonCentroid(poly) {
        let x = 0, y = 0;
        poly.forEach((p) => { x += p.x; y += p.y; });
        return { x: x / poly.length, y: y / poly.length };
    }

    function polygonAreaCentroid(poly) {
        let area = 0, cx = 0, cy = 0;
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const p0 = poly[i], p1 = poly[(i + 1) % n];
            const cross = p0.x * p1.y - p1.x * p0.y;
            area += cross;
            cx += (p0.x + p1.x) * cross;
            cy += (p0.y + p1.y) * cross;
        }
        area *= 0.5;
        if (Math.abs(area) < 1e-9) return polygonCentroid(poly);
        return { x: cx / (6 * area), y: cy / (6 * area) };
    }

    function normalize(v) {
        const len = Math.hypot(v.x, v.y) || 1;
        return { x: v.x / len, y: v.y / len };
    }

    function computeRefAngle(poly) {
        let longestLen = -1, angle = 0;
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len > longestLen) { longestLen = len; angle = Math.atan2(b.y - a.y, b.x - a.x); }
        }
        return angle;
    }

    /**
     * NOUVEAU (correctif définitif, bug rapporté : "à la réouverture d'un projet sauvegardé, les
     * panneaux d'un rectangle ne sont plus parallèles à ses côtés / ne conservent pas leur azimut
     * initial") : comparaison géométrique TOLÉRANTE de deux contours (même longueur, mêmes points à
     * epsMeters près, MÊME ORDRE — l'ordre des sommets est stable de bout en bout dans ce module :
     * _persistPolygons()/restorePolygons()/hydrateFromDatabaseIfEmpty() préservent tous l'ordre du
     * tableau). Utilisée par openCalepinageMaisonModal() (orchestrateur.js) pour décider si le
     * contour vivant a RÉELLEMENT changé de forme depuis la dernière fois que pan.angle/pan.azimuth
     * ont été établis pour lui — la vraie racine du bug : ces 2 champs sont des données UTILISATEUR
     * (angle du rectangle tel que dessiné, éventuel azimut/rotation choisi) qui n'ont aucune raison
     * d'être recalculées depuis la géométrie à chaque ouverture de modal, seulement quand le contour
     * a effectivement bougé (édition réelle d'un sommet). Les recalculer systématiquement — comme le
     * code le faisait jusqu'ici — expose à la moindre divergence entre 2 dérivations indépendantes
     * de la même géométrie (arrondis du round-trip lat/lng, timing de restauration de
     * rectAzimuthOffsetDeg, edge cases de simplifyCollinearLocal...) : suffisant pour faire pivoter
     * toute la grille de panneaux sans qu'aucune forme n'ait réellement changé.
     */
    /**
     * NOUVEAU (demande explicite, étude de faisabilité : "modifier le rectangle directement sur le
     * canva, en modifiant les arêtes — le rectangle doit toujours rester un polygone à 4 angles de
     * 90°") : port en mètres locaux (CM.state.roofLocal est déjà dans ce repère, aucune conversion
     * lat/lng nécessaire ici — contrairement à polygon_maison.js::squareRectangleFromCorner, la
     * version historique qui édite le rectangle sur la carte Google Maps et dont l'algorithme
     * ci-dessous est le portage direct, même géométrie) : le sommet OPPOSÉ à celui déplacé
     * (draggedIndex) sert d'ancre fixe ; les 2 axes du rectangle sont dérivés des arêtes
     * ancre→voisins (inchangées) ; les 2 sommets adjacents glissent chacun sur leur propre axe ;
     * le sommet déplacé est recalculé comme le 4e coin du rectangle ainsi obtenu. Retourne toujours
     * exactement 4 points, jamais de coin en trop ni d'angle autre que 90°. `points` : 4 points
     * {x,y} en mètres, MÊME ORDRE que CM.state.roofLocal. Retourne null si dégénéré (ancre et voisin
     * confondus).
     */
    function squareRectangleFromLocalCorner(points, draggedIndex) {
        if (!points || points.length !== 4 || typeof draggedIndex !== 'number') return null;
        const k = ((draggedIndex % 4) + 4) % 4;
        const anchorIdx = (k + 2) % 4;
        const adj1Idx = (k + 1) % 4;
        const adj2Idx = (k + 3) % 4;

        const anchor = points[anchorIdx];
        const adj1 = points[adj1Idx];
        const adj2 = points[adj2Idx];
        const dragged = points[k];

        const toUnit = (p) => {
            const dx = p.x - anchor.x, dy = p.y - anchor.y;
            const len = Math.hypot(dx, dy);
            return len < 1e-6 ? null : { x: dx / len, y: dy / len };
        };
        const axis1 = toUnit(adj1);
        const axis2 = toUnit(adj2);
        if (!axis1 || !axis2) return null; // ancre/voisin coïncidents — cas dégénéré

        const dragRel = { x: dragged.x - anchor.x, y: dragged.y - anchor.y };
        const len1 = dragRel.x * axis1.x + dragRel.y * axis1.y; // projection sur axis1
        const len2 = dragRel.x * axis2.x + dragRel.y * axis2.y; // projection sur axis2

        const newAdj1 = { x: anchor.x + axis1.x * len1, y: anchor.y + axis1.y * len1 };
        const newAdj2 = { x: anchor.x + axis2.x * len2, y: anchor.y + axis2.y * len2 };
        const newDragged = { x: newAdj1.x + newAdj2.x - anchor.x, y: newAdj1.y + newAdj2.y - anchor.y };

        const result = new Array(4);
        result[anchorIdx] = anchor;
        result[adj1Idx] = newAdj1;
        result[adj2Idx] = newAdj2;
        result[k] = newDragged;
        return result;
    }

    function roofLocalsMatch(a, b, epsMeters) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return false;
        const eps = epsMeters != null ? epsMeters : 0.05; // 5 cm : tolère le bruit flottant, pas une vraie édition
        for (let i = 0; i < a.length; i++) {
            const pa = a[i], pb = b[i];
            if (!pa || !pb) return false;
            if (Math.abs(pa.x - pb.x) > eps || Math.abs(pa.y - pb.y) > eps) return false;
        }
        return true;
    }

    /**
     * CORRECTIF (demande explicite : "les panneaux deviennent en biais quand on modifie les arêtes
     * d'un polygone... doivent toujours être parallèles à une face, idéalement avec la largeur du
     * polygone comme référence") : contrairement à computeRefAngle() ci-dessus (arête la PLUS
     * LONGUE "du moment" — donc instable, peut sauter d'une arête à l'autre au moindre
     * micro-déplacement d'un sommet, cf. openCalepinageMaisonModal()/applyContourDims()), cette
     * fonction retourne l'angle d'une arête FIXE et prévisible : points[0]→points[3] ("largeur",
     * même arête que `dir2` déjà utilisée par applyContourDims()/updateContourDimsUI() pour le
     * champ "Largeur"). Repli sur computeRefAngle() (comportement historique) si le contour n'a pas
     * exactement 4 points (toit divisé/forme complexe, hors du périmètre de cette demande).
     */
    function computeWidthEdgeAngle(points) {
        if (!points || points.length !== 4) return computeRefAngle(points);
        const p0 = points[0], p3 = points[3];
        return Math.atan2(p3.y - p0.y, p3.x - p0.x);
    }

    /**
     * CORRECTIF (bug rapporté : "inversion paysage/portrait pour le Monopente uniquement" + "flèche
     * masquée pour le Monopente") : computeCandidatePanelSlots() suppose PARTOUT que pan.angle
     * représente l'axe de la LONGUEUR/égout (axe X local = alongEave, axe Y local = alongRampant) —
     * hypothèse vraie pour les toits DIVISÉS (2/4 pans, dont l'angle vient de
     * computeLongestEdgeDir()/l'angle du faîtage, la direction de la longueur), mais FAUSSE pour le
     * Monopente rectangle, qui utilisait jusqu'ici computeWidthEdgeAngle() ci-dessus — l'arête
     * points[0]→points[3], documentée comme la LARGEUR, perpendiculaire à la longueur pour un
     * rectangle non carré. Cette fonction retourne l'angle de l'arête points[0]→points[1] — la
     * LONGUEUR, même arête que `dir1` déjà utilisée par applyContourDims()/updateContourDimsUI()
     * pour le champ "Longueur" — même stabilité que computeWidthEdgeAngle() (arête FIXE par index,
     * pas "la plus longue du moment"), mais sur le bon axe, cohérent avec les toits divisés.
     */
    /**
     * Rectangle à 3 points dans le repère local en mètres — portage exact de
     * MaisonPolygonManager.calculateRectPoints() (polygon_maison.js, traçé sur la carte réelle),
     * qui est elle-même le portage de solar_calculations.js::calculateRectPoints (calepinage
     * rectangulaire grand projet).
     *
     * Demande explicite : l'outil « Rectangle (contour) » du canevas doit se comporter comme celui
     * de la carte — p1→p2 fixe l'arête de LONGUEUR et donc la direction (la rotation exacte du
     * rectangle), p3 sa profondeur perpendiculaire, du côté où se trouve le curseur. L'outil
     * produisait jusqu'ici un rectangle aligné sur les axes du repère local (min/max sur x et y),
     * donc incapable de suivre une toiture en biais.
     *
     * Les 4 coins sont retournés dans l'ordre [p1, p2, c3, c4], p1→p2 en premier : c'est la
     * convention que computeLengthEdgeAngle() ci-dessous attend pour orienter la grille de panneaux
     * parallèlement au rectangle.
     *
     * @param {{x:number,y:number}} p1 - 1er clic
     * @param {{x:number,y:number}} p2 - 2e clic : fixe la longueur ET la direction
     * @param {{x:number,y:number}} p3 - 3e clic (ou position du curseur) : fixe la profondeur
     * @returns {Array<{x:number,y:number}>|null} les 4 coins, ou null si p1 et p2 sont confondus
     */
    function rectFromThreePointsLocal(p1, p2, p3) {
        const dir = normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
        if (!dir.x && !dir.y) return null; // p1 == p2 : aucune direction exploitable
        // Normale unitaire à l'arête de longueur. Le produit scalaire ci-dessous est SIGNé : il
        // porte à la fois la profondeur et le côté (gauche/droite) où pointe le curseur, ce qui
        // rend inutile le calcul de « sens de rotation » de la version sphérique (turn = ±90°).
        const normal = { x: -dir.y, y: dir.x };
        const depth = (p3.x - p2.x) * normal.x + (p3.y - p2.y) * normal.y;
        return [
            { x: p1.x, y: p1.y },
            { x: p2.x, y: p2.y },
            { x: p2.x + normal.x * depth, y: p2.y + normal.y * depth },
            { x: p1.x + normal.x * depth, y: p1.y + normal.y * depth },
        ];
    }

    /**
     * Angle de référence PAR DÉFAUT d'un contour rectangulaire : l'arête de longueur
     * points[0]→points[1], ramenée à l'orientation qui fait regarder les panneaux vers le SUD.
     *
     * CORRECTIF (demande explicite : "définir par défaut la flèche orientée sud dans le canevas et
     * sur la carte ; actuellement elle est orientée Nord, il faut une rotation de 180°").
     * `atan2(p1-p0)` dépend du SENS de parcours du contour : selon le côté par lequel l'utilisateur
     * commence son rectangle, la normale — donc l'azimut des panneaux, donc la flèche — sortait vers
     * le Sud ou vers le Nord, sans qu'aucune règle ne tranche. C'est `orienterVersLeSud()` qui
     * tranche désormais, à la SOURCE : la flèche ne se contente pas d'être redessinée à l'envers,
     * c'est l'azimut réellement utilisé par le calcul de production qui vaut ~0° (Sud) par défaut.
     *
     * Un demi-tour de l'angle de référence laisse la GRILLE de panneaux identique (un axe parcouru
     * dans l'autre sens est le même axe) : seuls l'azimut et la flèche changent.
     *
     * L'offset utilisateur `rectAzimuthOffsetDeg` (bouton "Tourner l'azimut de 90°") s'ajoute à
     * cette base chez TOUS les appelants : les paliers deviennent donc bien Sud → Ouest → Nord →
     * Est → Sud, comme l'annonce l'infobulle du bouton.
     */
    function computeLengthEdgeAngle(points) {
        if (!points || points.length !== 4) return orienterVersLeSud(computeRefAngle(points));
        const p0 = points[0], p1 = points[1];
        return orienterVersLeSud(Math.atan2(p1.y - p0.y, p1.x - p0.x));
    }

    /**
     * Ajoute un demi-tour à un angle de référence si la normale qui en découle (= azimut des
     * panneaux, cf. applyReferenceAngleToPan) regarde vers le Nord. Après appel, l'azimut par défaut
     * est toujours dans [-90°, 90°], c'est-à-dire orienté Sud.
     */
    function orienterVersLeSud(refAngle) {
        const dir = { x: Math.cos(refAngle), y: Math.sin(refAngle) };
        const normal = { x: -dir.y, y: dir.x };
        return Math.abs(toAzimuth(headingOfVector(normal))) <= 90 ? refAngle : refAngle + Math.PI;
    }

    /**
     * CORRECTIF (demande explicite : "la flèche de l'azimut doit être toujours parallèle aux
     * panneaux") : jusqu'ici pan.angle (grille de panneaux) et pan.azimuth (flèche) étaient deux
     * champs stockés indépendamment, synchronisés une seule fois à la création du pan
     * (resetDivision()/applyRidgeSplit()/divideInto4Pans()) puis jamais recalculés ensemble —
     * pouvant diverger silencieusement dès qu'une édition du contour ne touchait que l'un des deux
     * (ou aucun). Cette fonction dérive TOUJOURS les deux d'une seule valeur de référence, avec
     * exactement la même relation angle/azimut que resetDivision() (azimut = cap de la normale à
     * l'angle de référence) — seule la SOURCE de l'angle change d'un appelant à l'autre
     * (computeWidthEdgeAngle() désormais, au lieu de computeRefAngle() recalculé à la volée).
     * Préserve un éventuel flip manuel de l'utilisateur (bouton "Inverser l'azimut", ±180°) : si
     * l'azimut actuel du pan correspondait à l'opposé de l'azimut "par défaut" AVANT ce recalcul, on
     * réapplique ce même flip relatif après, pour ne pas annuler silencieusement son choix de
     * façade à chaque édition du contour.
     */
    function applyReferenceAngleToPan(pan, refAngle) {
        const dir = { x: Math.cos(refAngle), y: Math.sin(refAngle) };
        const normal = { x: -dir.y, y: dir.x };
        const defaultAzimuth = toAzimuth(headingOfVector(normal));

        const oldDir = { x: Math.cos(pan.angle || 0), y: Math.sin(pan.angle || 0) };
        const oldNormal = { x: -oldDir.y, y: oldDir.x };
        const oldDefaultAzimuth = toAzimuth(headingOfVector(oldNormal));
        let delta = (typeof pan.azimuth === 'number' ? pan.azimuth : oldDefaultAzimuth) - oldDefaultAzimuth;
        delta = ((delta + 180) % 360 + 360) % 360 - 180; // ramène dans [-180, 180]
        const wasFlipped = Math.abs(Math.abs(delta) - 180) < 1;

        pan.angle = refAngle;
        let newAzimuth = defaultAzimuth;
        if (wasFlipped) {
            newAzimuth += 180;
            if (newAzimuth > 180) newAzimuth -= 360;
            else if (newAzimuth <= -180) newAzimuth += 360;
        }
        pan.azimuth = Math.round(newAzimuth);
    }

    /**
     * NOUVEAU (demande explicite : "polygone libre : panneaux toujours alignés, orientés plein sud
     * par défaut" + "champ azimut pour faire la rotation des panneaux") : inverse mathématique exacte
     * de la dérivation azimut déjà faite par applyReferenceAngleToPan() ci-dessus (même convention
     * déjà documentée dans le formulaire : Sud=0°, Ouest=90°, Est=-90°, Nord=±180°) — permet de
     * partir d'un azimut CHOISI (plein sud par défaut, ou une valeur saisie par l'utilisateur) plutôt
     * que de toujours devoir en dériver un depuis la géométrie du contour (instable pour un polygone
     * libre, cf. computeRefAngle()). Utilisée par resetDivision()/openCalepinageMaisonModal() pour
     * un contour en mode 'polygon' (CM.state.contourMode) : une référence CONSTANTE (indépendante de
     * la forme éditée) garantit que les panneaux ne dérivent/se désalignent jamais au fil des
     * éditions du contour.
     */
    function angleForAzimuth(azimuthDeg) {
        const heading = ((azimuthDeg + 180) % 360 + 360) % 360; // inverse de toAzimuth()
        const normal = vectorFromHeading(heading);
        const dir = { x: normal.y, y: -normal.x }; // inverse de normal = {-dir.y, dir.x}
        return Math.atan2(dir.y, dir.x);
    }

    /**
     * Angle de référence STABLE (orientation de la grille d'un pan non divisé) d'un champ PV —
     * point unique des sites qui (re)dérivent l'orientation : resetDivision, resynchronisations de
     * l'orchestrateur, bouton "Tourner l'azimut", édition du contour.
     *  - polygone libre : azimut réglable, plein sud par défaut (polygonAzimuthDeg) ;
     *  - "Petit champ solaire" (demande explicite : "dessiné orienté plein sud par défaut lors de sa
     *    création") : champ au sol, rien n'impose de suivre l'arête du rectangle tracé — plein sud,
     *    plus les paliers de 90° du bouton (rectAzimuthOffsetDeg) ;
     *  - sinon (rectangle) : arête de longueur du contour + rectAzimuthOffsetDeg.
     * @param {object} [state] - état du champ (CM.state par défaut)
     * @param {{x,y}[]} [contour] - contour à utiliser (state.roofLocal par défaut)
     */
    function angleReferenceStable(state, contour) {
        const st = state || CM.state;
        if (st.contourMode === 'polygon') return angleForAzimuth(st.polygonAzimuthDeg || 0);
        const offset = ((st.rectAzimuthOffsetDeg || 0) * Math.PI) / 180;
        if (normalizeTypeMontage(st.typeMontage) === 'champ_solaire') return angleForAzimuth(0) + offset;
        return computeLengthEdgeAngle(contour || st.roofLocal) + offset;
    }

    function rotateAroundOrigin(pt, angleRad) {
        const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
        return { x: pt.x * cosA - pt.y * sinA, y: pt.x * sinA + pt.y * cosA };
    }

    function metersToDisplay(pt) {
        return CM.state.viewMode === 'aligned' ? rotateAroundOrigin(pt, -CM.state.refAngle) : pt;
    }
    function displayToMeters(pt) {
        return CM.state.viewMode === 'aligned' ? rotateAroundOrigin(pt, CM.state.refAngle) : pt;
    }

    function headingOfVector(v) {
        let h = (Math.atan2(v.x, v.y) * 180) / Math.PI;
        if (h < 0) h += 360;
        return h;
    }
    function toAzimuth(compassHeading) {
        let az = compassHeading - 180;
        if (az <= -180) az += 360;
        if (az > 180) az -= 360;
        return Math.round(az);
    }
    function vectorFromHeading(compassHeadingDeg) {
        const rad = (compassHeadingDeg * Math.PI) / 180;
        return { x: Math.sin(rad), y: Math.cos(rad) };
    }

    function pointInPolygon(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = (yi > pt.y) !== (yj > pt.y) &&
                pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // CORRECTIF (bug rapporté : "le décalage du buffer zone n'est pas identique dans le polygone
    // libre") : méthode standard d'offset de polygone par intersection des droites décalées de
    // deux arêtes adjacentes en chaque sommet — remplace à la fois l'ancien bufferPolygonOutward()
    // (qui poussait chaque sommet le long d'un rayon centroïde→sommet, sans rapport avec les
    // normales des arêtes, donc structurellement incapable de produire un décalage perpendiculaire
    // uniforme) et l'ancien erodePolygonByEdgeClearances() (qui découpait SÉQUENTIELLEMENT par
    // demi-plan — une intersection de demi-plans est TOUJOURS convexe, donc fausse dès que le
    // contour est concave — et déterminait le sens "vers l'intérieur" arête par arête via une
    // comparaison au centroïde arithmétique, pouvant s'inverser localement sur un contour
    // irrégulier). Ici, le sens "vers l'intérieur" est déterminé UNE SEULE FOIS pour tout le
    // polygone via l'aire signée (formule du lacet — sens de parcours CW/CCW, une propriété globale
    // non ambiguë), et chaque sommet reconstruit est l'intersection des 2 droites décalées
    // adjacentes (pas un clip qui force la convexité) — gère donc correctement un sommet rentrant.
    // Vérifié numériquement (carré, hexagone en L avec sommet concave) : distance perpendiculaire
    // strictement uniforme à chaque arête, y compris autour du sommet concave.
    // @param {{x,y}[]} poly
    // @param {number[]} distances - une distance par arête (poly[i] -> poly[i+1])
    // @param {boolean} inward - true = érosion (vers l'intérieur), false = expansion (vers l'extérieur)
    function offsetPolygonEdges(poly, distances, inward) {
        const n = poly.length;
        if (n < 3) return poly;
        let signedArea = 0;
        for (let i = 0; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            signedArea += a.x * b.y - b.x * a.y;
        }
        const ccw = signedArea > 0;

        const edges = poly.map((a, i) => {
            const b = poly[(i + 1) % n];
            const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
            let edgeNormal = ccw ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x }; // toujours "vers l'intérieur"
            if (!inward) edgeNormal = { x: -edgeNormal.x, y: -edgeNormal.y };
            const d = distances[i] || 0;
            return { point: { x: a.x + edgeNormal.x * d, y: a.y + edgeNormal.y * d }, dir };
        });

        return poly.map((original, i) => {
            const prev = edges[(i - 1 + n) % n];
            const cur = edges[i];
            // Intersection des 2 droites (pas un simple clip par demi-plan) : gère correctement un
            // sommet rentrant (concave), pas seulement convexe.
            const det = prev.dir.x * cur.dir.y - prev.dir.y * cur.dir.x;
            if (Math.abs(det) < 1e-9) return original; // arêtes colinéaires — repli : sommet inchangé
            const dx = cur.point.x - prev.point.x, dy = cur.point.y - prev.point.y;
            const t = (dx * cur.dir.y - dy * cur.dir.x) / det;
            return { x: prev.point.x + prev.dir.x * t, y: prev.point.y + prev.dir.y * t };
        });
    }

    function bufferPolygonOutward(poly, amount) {
        if (!amount) return poly;
        return offsetPolygonEdges(poly, poly.map(() => amount), false);
    }

    function intersectLineWithSegment(linePoint, lineDir, a, b) {
        const dx1 = lineDir.x, dy1 = lineDir.y;
        const dx2 = b.x - a.x, dy2 = b.y - a.y;
        const det = dx2 * dy1 - dx1 * dy2;
        if (Math.abs(det) < 1e-9) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ex = a.x - linePoint.x, ey = a.y - linePoint.y;
        const s = (dx1 * ey - dy1 * ex) / det;
        return { x: a.x + s * dx2, y: a.y + s * dy2 };
    }

    function clipPolygonByLine(poly, linePoint, lineDir, keepSign) {
        const normal = { x: -lineDir.y, y: lineDir.x };
        const side = (p) => keepSign * ((p.x - linePoint.x) * normal.x + (p.y - linePoint.y) * normal.y);
        const output = [];
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const cur = poly[i];
            const prev = poly[(i - 1 + n) % n];
            const curIn = side(cur) >= -1e-9;
            const prevIn = side(prev) >= -1e-9;
            if (curIn) {
                if (!prevIn) output.push(intersectLineWithSegment(linePoint, lineDir, prev, cur));
                output.push(cur);
            } else if (prevIn) {
                output.push(intersectLineWithSegment(linePoint, lineDir, prev, cur));
            }
        }
        return output;
    }

    function distanceToLine(pt, linePoint, lineDir) {
        const n = { x: -lineDir.y, y: lineDir.x };
        return Math.abs((pt.x - linePoint.x) * n.x + (pt.y - linePoint.y) * n.y);
    }

    function tagRidgeEdges(points, linePoint, lineDir, eps = 1e-6) {
        const idx = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            if (distanceToLine(a, linePoint, lineDir) < eps && distanceToLine(b, linePoint, lineDir) < eps) idx.push(i);
        }
        return idx;
    }

    function computeLongestEdgeDir(poly) {
        let longestLen = -1, longestDir = { x: 1, y: 0 };
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len > longestLen) { longestLen = len; longestDir = normalize({ x: b.x - a.x, y: b.y - a.y }); }
        }
        return longestDir;
    }

    /**
     * NOUVEAU (demande explicite : « ajouter un bouton pour inverser le faîtage — l'axe du faîtage
     * est défini par défaut sur la largeur du rectangle, il y a des cas où il doit être dessiné sur
     * la longueur ») : axe de référence du faîtage. Par défaut l'arête la plus longue du contour
     * (comportement historique de computeLongestEdgeDir, ci-dessus) ; avec CM.state.ridgeAxisSwapped
     * (bouton « Inverser le faîtage », cf. calepinage_maison_formulaires.js), la PERPENDICULAIRE.
     *
     * Un seul point d'entrée pour les 4 divisions (2 pans sym/asym, 4 pans croupe, 4 pans sym) : la
     * bascule vaut donc pour toutes, et le calepinage suit sans traitement particulier — chaque pan
     * porte `angle: <angle du faîtage>`, que computeCandidatePanelSlots() utilise comme axe de
     * l'égout (axe X local). Inverser le faîtage redresse donc la grille sur le nouvel axe, donc
     * avec la nouvelle largeur de pan, sans rien changer ailleurs.
     */
    function ridgeAxisDir(poly, state) {
        const st = state || CM.state;
        const dir = computeLongestEdgeDir(poly);
        if (!st || !st.ridgeAxisSwapped) return dir;
        return { x: -dir.y, y: dir.x };
    }

    function computeAutoRidge(poly) {
        const longestDir = ridgeAxisDir(poly);
        const c = polygonAreaCentroid(poly);
        return { a: c, b: { x: c.x + longestDir.x, y: c.y + longestDir.y } };
    }

    function computeAsymmetricRidge(poly, percent) {
        const dir = ridgeAxisDir(poly);
        const angle = Math.atan2(dir.y, dir.x);
        const localPoints = poly.map((p) => rotateAroundOrigin(p, -angle));
        const bb = boundingBox(localPoints);
        const totalWidth = bb.maxY - bb.minY;
        const fraction = Math.max(5, Math.min(95, percent)) / 100;
        const localPoint = { x: 0, y: bb.minY + fraction * totalWidth };
        const truePoint = rotateAroundOrigin(localPoint, angle);
        return { a: truePoint, b: { x: truePoint.x + dir.x, y: truePoint.y + dir.y } };
    }

    // --------------------------------------------------------------------------------------
    // Division du toit en pans (étape 2)
    // --------------------------------------------------------------------------------------
    function clearPanelEditsState() {
        CM.state.gridOffsetByPan.clear();
        CM.state.deletedPanelIndicesByPan.clear();
    }

    function applyRidgeSplit(ridge) {
        clearPanelEditsState();
        CM.state.ridge = ridge;
        // CORRECTIF (bug rapporté : "en passant d'une toiture 4 pans symétrique à 2 pans, les 2
        // lignes de faîtage restent affichées") : divideInto4PansSymmetric() (ci-dessous) est seule à
        // écrire CM.state.ridgeLines — jamais nettoyée en repassant sur un Bipente (symétrique ou
        // asymétrique, tous deux via applyRidgeSplit), qui ne connaît que CM.state.ridge (une seule
        // ligne, ci-dessus).
        CM.state.ridgeLines = [];
        const dir = normalize({ x: ridge.b.x - ridge.a.x, y: ridge.b.y - ridge.a.y });
        const normal1 = { x: -dir.y, y: dir.x };
        const ridgeAngle = Math.atan2(dir.y, dir.x);

        const pan1Points = clipPolygonByLine(CM.state.roofLocal, ridge.a, dir, 1);
        const pan2Points = clipPolygonByLine(CM.state.roofLocal, ridge.a, dir, -1);

        // CORRECTIF (bug rapporté à 2 reprises : "inverser le sens des doubles flèches" puis, après
        // vérification à l'écran, "tourner les flèches chacun de 180°" pour les toitures Bipente
        // symétrique/asymétrique) : le 1er correctif avait permuté Pan 1/Pan 2 (-normal1/+normal1) ;
        // la 2e demande, testée en conditions réelles, revient très exactement à appliquer encore
        // 180° de plus à CHAQUE flèche — net : Pan 1 -> +normal1, Pan 2 -> -normal1 (la formule
        // d'origine, avant le 1er correctif). Conservé tel quel (au lieu d'un double `-` qui masquerait
        // cet aller-retour) pour rester lisible.
        CM.state.pans = [
            { id: 'Pan 1', points: pan1Points, azimuth: toAzimuth(headingOfVector(normal1)), poseMode: CM.state.poseMode, angle: ridgeAngle, ridgeEdgeIndices: tagRidgeEdges(pan1Points, ridge.a, dir) },
            { id: 'Pan 2', points: pan2Points, azimuth: toAzimuth(headingOfVector({ x: -normal1.x, y: -normal1.y })), poseMode: CM.state.poseMode, angle: ridgeAngle, ridgeEdgeIndices: tagRidgeEdges(pan2Points, ridge.a, dir) }
        ].filter((p) => p.points.length >= 3);
        CM.state.divisionMode = '2pans';
    }

    function divideInto2PansSymmetric() {
        applyRidgeSplit(computeAutoRidge(CM.state.roofLocal));
        CM.state.lastTwoPanKind = 'sym';
    }

    function divideInto2PansAsymmetric() {
        applyRidgeSplit(computeAsymmetricRidge(CM.state.roofLocal, CM.state.asymmetryPercent));
        CM.state.lastTwoPanKind = 'asym';
    }

    const RIDGE_MIN_M = 0.05;

    function divideInto4Pans(ridgeLengthM) {
        clearPanelEditsState();
        // CORRECTIF (même bug que applyRidgeSplit ci-dessus) : nettoie les lignes faîtage/noue d'un
        // éventuel 4 pans symétrique précédent (divideInto4PansSymmetric) — cette croupe n'écrit que
        // CM.state.ridge (ci-dessous), jamais ridgeLines.
        CM.state.ridgeLines = [];
        const refDir = ridgeAxisDir(CM.state.roofLocal);
        const refAngleLocal = Math.atan2(refDir.y, refDir.x);
        const localAll = CM.state.roofLocal.map((p) => rotateAroundOrigin(p, -refAngleLocal));
        const bb = boundingBox(localAll);
        const localCorners = [
            { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY },
            { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY }
        ];
        const corners = localCorners.map((p) => rotateAroundOrigin(p, refAngleLocal));
        const center = rotateAroundOrigin({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }, refAngleLocal);
        const longAxisLenM = bb.maxX - bb.minX;
        const clampedRidgeLenM = Math.min(Math.max(0, ridgeLengthM || 0), longAxisLenM * 0.98);

        const edgeMeta = [];
        for (let i = 0; i < 4; i++) {
            const a = corners[i], b = corners[(i + 1) % 4];
            const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
            const candidateNormal = { x: dir.y, y: -dir.x };
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const towardOutside = { x: mid.x - center.x, y: mid.y - center.y };
            const sign = candidateNormal.x * towardOutside.x + candidateNormal.y * towardOutside.y >= 0 ? 1 : -1;
            const normal = { x: candidateNormal.x * sign, y: candidateNormal.y * sign };
            edgeMeta.push({ a, b, azimuth: toAzimuth(headingOfVector(normal)), angle: Math.atan2(dir.y, dir.x) });
        }

        if (clampedRidgeLenM < RIDGE_MIN_M) {
            CM.state.pans = edgeMeta.map((m, i) => ({
                id: `Pan ${i + 1}`, points: [m.a, m.b, center], azimuth: m.azimuth, poseMode: CM.state.poseMode,
                angle: m.angle, ridgeEdgeIndices: [1, 2]
            }));
            CM.state.divisionMode = '4pans';
            return;
        }

        const midX = (bb.minX + bb.maxX) / 2, midY = (bb.minY + bb.maxY) / 2;
        const ridgeStart = rotateAroundOrigin({ x: midX - clampedRidgeLenM / 2, y: midY }, refAngleLocal);
        const ridgeEnd = rotateAroundOrigin({ x: midX + clampedRidgeLenM / 2, y: midY }, refAngleLocal);
        const [c0, c1, c2, c3] = corners;

        const specialLines = [
            { point: ridgeStart, dir: refDir },
            { point: c0, dir: normalize({ x: ridgeStart.x - c0.x, y: ridgeStart.y - c0.y }) },
            { point: c3, dir: normalize({ x: ridgeStart.x - c3.x, y: ridgeStart.y - c3.y }) },
            { point: c1, dir: normalize({ x: ridgeEnd.x - c1.x, y: ridgeEnd.y - c1.y }) },
            { point: c2, dir: normalize({ x: ridgeEnd.x - c2.x, y: ridgeEnd.y - c2.y }) },
        ];
        const tagSpecial = (points) => {
            const set = new Set();
            specialLines.forEach((l) => tagRidgeEdges(points, l.point, l.dir).forEach((i) => set.add(i)));
            return [...set];
        };

        const shapes = [
            { points: [c0, c1, ridgeEnd, ridgeStart], meta: edgeMeta[0] },
            { points: [c1, c2, ridgeEnd], meta: edgeMeta[1] },
            { points: [c2, c3, ridgeStart, ridgeEnd], meta: edgeMeta[2] },
            { points: [c3, c0, ridgeStart], meta: edgeMeta[3] },
        ];
        CM.state.pans = shapes.map((s, i) => ({
            id: `Pan ${i + 1}`, points: s.points, azimuth: s.meta.azimuth, poseMode: CM.state.poseMode,
            angle: s.meta.angle, ridgeEdgeIndices: tagSpecial(s.points)
        }));
        CM.state.divisionMode = '4pans';
    }

    // NOUVEAU (demande explicite : "Diviser en 4 pans symétrique" — un faîtage ET une noue au milieu,
    // "combinaison de 2 toitures Bipente symétrique") : contrairement à divideInto4Pans ci-dessus
    // (croupe/pyramidale — un seul faîtage central, 4 arêtiers, jamais de noue), cette division
    // découpe le toit en 4 BANDES ÉGALES, toutes parallèles à l'arête la plus longue (comme un
    // Bipente symétrique appliqué 2 fois, empilé) : bande 1 et 4 (extrémités) descendent vers leur
    // égout, bandes 2 et 3 (au centre) descendent l'une vers l'autre — leur ligne de jonction commune
    // (au milieu) est donc une NOUE (eau qui s'y rejoint), tandis que les 2 lignes intermédiaires
    // (entre bandes 1-2 et 3-4) sont des FAÎTAGES (chaque bande de part et d'autre s'en éloigne).
    // Inspiré de la toiture "Multipente" du calepinage rectangulaire (calepinage_rectangulaire.js),
    // dont le motif en dents de scie (montée/descente alternées) produit exactement ce même profil
    // faîtage-noue-faîtage pour 4 sections.
    function divideInto4PansSymmetric() {
        clearPanelEditsState();
        const poly = CM.state.roofLocal;
        const refDir = ridgeAxisDir(poly);
        const refAngle = Math.atan2(refDir.y, refDir.x);
        const localAll = poly.map((p) => rotateAroundOrigin(p, -refAngle));
        const bb = boundingBox(localAll);
        const extent = bb.maxY - bb.minY;
        const quarter = extent / 4;

        // 3 lignes de coupe, toutes parallèles à refDir, à 1/4, 2/4 (= noue) et 3/4 de l'étendue
        // perpendiculaire — extrémités calculées sur toute la largeur locale (bb.minX/maxX) pour un
        // tracé pleine longueur (pas un simple segment unitaire).
        const cutLine = (k) => {
            const yLocal = bb.minY + k * quarter;
            const a = rotateAroundOrigin({ x: bb.minX, y: yLocal }, refAngle);
            const b = rotateAroundOrigin({ x: bb.maxX, y: yLocal }, refAngle);
            return { a, b };
        };
        const line1 = cutLine(1), line2 = cutLine(2), line3 = cutLine(3);

        const strip1 = clipPolygonByLine(poly, line1.a, refDir, -1);
        const strip2 = clipPolygonByLine(clipPolygonByLine(poly, line1.a, refDir, 1), line2.a, refDir, -1);
        const strip3 = clipPolygonByLine(clipPolygonByLine(poly, line2.a, refDir, 1), line3.a, refDir, -1);
        const strip4 = clipPolygonByLine(poly, line3.a, refDir, 1);

        // Azimut : même technique auto-vérifiée que divideInto4Pans ci-dessus (produit de scalaire
        // contre le centroïde réel), plutôt que de supposer un sens fixe — évite de reproduire le bug
        // déjà corrigé sur applyRidgeSplit (Bipente), où le signe supposé s'est révélé inversé à
        // l'écran. Bandes 1/4 (extrémités) : azimut vers l'EXTÉRIEUR (loin du centre du toit).
        // Bandes 2/3 (centrales) : azimut vers l'INTÉRIEUR (vers la noue, au centre).
        const normal = { x: -refDir.y, y: refDir.x };
        const roofCentroid = polygonAreaCentroid(poly);
        const azimuthFor = (points, wantOutward) => {
            if (points.length < 3) return 0;
            const c = polygonAreaCentroid(points);
            const away = { x: c.x - roofCentroid.x, y: c.y - roofCentroid.y };
            const outwardSign = (normal.x * away.x + normal.y * away.y) >= 0 ? 1 : -1;
            const finalSign = wantOutward ? outwardSign : -outwardSign;
            return toAzimuth(headingOfVector({ x: normal.x * finalSign, y: normal.y * finalSign }));
        };

        const tagAll = (points) => {
            const set = new Set();
            [line1, line2, line3].forEach((l) => tagRidgeEdges(points, l.a, refDir).forEach((i) => set.add(i)));
            return [...set];
        };

        const strips = [
            { id: 'Pan 1', points: strip1, outward: true },
            { id: 'Pan 2', points: strip2, outward: false },
            { id: 'Pan 3', points: strip3, outward: false },
            { id: 'Pan 4', points: strip4, outward: true },
        ];
        CM.state.pans = strips
            .filter((s) => s.points.length >= 3)
            .map((s) => ({
                id: s.id, points: s.points, azimuth: azimuthFor(s.points, s.outward),
                poseMode: CM.state.poseMode, angle: refAngle, ridgeEdgeIndices: tagAll(s.points),
            }));

        // NOUVEAU : plusieurs lignes typées (ridge/valley), contrairement à CM.state.ridge (une seule
        // ligne, Bipente/croupe) — cf. rendu dédié dans calepinage_maison_dessin.js.
        CM.state.ridgeLines = [
            { a: line1.a, b: line1.b, type: 'ridge' },
            { a: line2.a, b: line2.b, type: 'valley' },
            { a: line3.a, b: line3.b, type: 'ridge' },
        ];
        CM.state.ridge = null;
        CM.state.divisionMode = '4panssym';
    }

    function resetDivision() {
        clearPanelEditsState();
        // CORRECTIF (demande explicite : "polygone libre : panneaux orientés plein sud par défaut,
        // toujours alignés") : un contour tracé en polygone libre (CM.state.contourMode ===
        // 'polygon') utilise une référence CONSTANTE (plein sud par défaut, ou l'azimut choisi via le
        // nouveau champ du formulaire, CM.state.polygonAzimuthDeg) plutôt que la géométrie du contour
        // — jamais de dérive/désalignement au fil des éditions, puisque cette référence ne dépend pas
        // de la forme éditée. En mode 'rect' (ou contourMode non encore défini, ex. maison
        // enregistrée avant l'introduction de ce champ) :
        // CORRECTIF (bug rapporté : "inversion paysage/portrait pour le Monopente" + "flèche par
        // défaut vers la longueur") : utilise désormais computeLengthEdgeAngle() — arête FIXE
        // points[0]→points[1], la LONGUEUR, cohérente avec l'axe que computeCandidatePanelSlots()
        // suppose partout (alongEave = axe X local) et avec ce qu'utilisent déjà les toits divisés
        // (computeLongestEdgeDir) — au lieu de l'ancien computeWidthEdgeAngle() (arête points[0]→
        // points[3], la LARGEUR, perpendiculaire à la longueur pour un rectangle non carré), qui
        // faisait échanger les axes X/Y locaux pour le Monopente uniquement (inversant paysage/
        // portrait) et rendait le décalage de la flèche imprévisible. Même stabilité qu'avant (arête
        // FIXE par index, pas "la plus longue du moment").
        // NOUVEAU (demande explicite : "faire pivoter la flèche par paliers de 90° pour le
        // Monopente") : rectAzimuthOffsetDeg (orchestrateur.js, 0 par défaut) s'ajoute à cette
        // référence géométrique — additif, donc survit aux resynchronisations (contrairement à un
        // simple override d'angle, qui serait écrasé au prochain appel de cette fonction).
        // Référence commune à tous les sites (cf. angleReferenceStable : plein sud pour le petit
        // champ solaire).
        const refAngle = angleReferenceStable(CM.state);
        let defaultAzimuth;
        if (CM.state.contourMode === 'polygon') {
            defaultAzimuth = CM.state.polygonAzimuthDeg || 0;
        } else {
            const dir = { x: Math.cos(refAngle), y: Math.sin(refAngle) };
            const normal = { x: -dir.y, y: dir.x };
            defaultAzimuth = toAzimuth(headingOfVector(normal));
        }
        CM.state.pans = [{
            id: 'Pan 1', points: CM.state.roofLocal,
            azimuth: defaultAzimuth,
            poseMode: CM.state.poseMode,
            angle: refAngle,
            ridgeEdgeIndices: []
        }];
        CM.state.divisionMode = 'none';
        CM.state.ridge = null;
        // NOUVEAU (demande explicite : "Diviser en 4 pans symétrique") : nettoie les 3 lignes
        // faîtage/noue de divideInto4PansSymmetric ci-dessus, sinon elles restent affichées après un
        // retour à Monopente (cf. rendu dans calepinage_maison_dessin.js).
        CM.state.ridgeLines = [];
        CM.state.tracingRidge = false;
        if (CM.ridgeBtn) CM.updateRidgeButtonUI();
    }

    // --------------------------------------------------------------------------------------
    // Panneaux : calepinage/collision par pan
    // --------------------------------------------------------------------------------------
    function isPointInObstacleBuffer(pt, o) {
        const local = rotateAroundOrigin({ x: pt.x - o.x, y: pt.y - o.y }, -(o.angle || 0));
        return Math.abs(local.x) <= o.w / 2 + o.buffer && Math.abs(local.y) <= o.h / 2 + o.buffer;
    }

    function obstacleCornersTrue(o, extra = 0) {
        const hw = o.w / 2 + extra, hh = o.h / 2 + extra;
        return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
            .map((c) => {
                const r = rotateAroundOrigin(c, o.angle || 0);
                return { x: r.x + o.x, y: r.y + o.y };
            });
    }

    // NOUVEAU (demande explicite) : pente propre au Pan 2 d'une toiture 2 pans ASYMÉTRIQUE
    // (CM.state.penteDeg2). Tous les autres cas -> CM.state.penteDeg. `state` optionnel : utile quand
    // on calcule pour une AUTRE maison que l'active (cf. getAllPvFieldSummaries, orchestrateur.js).
    function effectivePenteDegForPan(pan, state) {
        state = state || CM.state;
        if (state.divisionMode === '2pans' && state.lastTwoPanKind === 'asym'
            && pan && pan.id === 'Pan 2' && state.penteDeg2 != null) {
            return state.penteDeg2;
        }
        return state.penteDeg;
    }

    function getEffectivePanelDims(poseMode, penteDegOverride) {
        const lengthM = panelLengthM(), widthM = panelWidthM();
        const penteDeg = (penteDegOverride != null) ? penteDegOverride : CM.state.penteDeg;
        const penteRad = (penteDeg * Math.PI) / 180;
        const domeTiltRad = (CM.state.domeTiltDeg * Math.PI) / 180;
        let cosP = 1;
        // CORRECTIF (bug rapporté : "le comptage de panneaux en shed est faux — même nombre entre
        // 10° et 45°") : branche 'shed' manquante ici — cosP restait à 1 quel que soit l'angle, donc
        // pairHeightM (profondeur de rangée, calepinage_maison_calculs.js::computeCandidatePanelSlots)
        // ne dépendait jamais de l'inclinaison. Même formule que 'incline' (le shed réutilise
        // CM.state.penteDeg, pas de champ dédié) — même principe que TOUS les moteurs shed du
        // calepinage Pro/Grand-projet (LineToShed.js/ShedPolygon.js/LineToPolygon.js/
        // SolarRectangle.js : `Math.cos(tiltRad)` appliqué à la profondeur du panneau avant
        // empilement en rangées — plus l'angle est important, plus la profondeur projetée diminue,
        // plus de rangées tiennent dans une même surface).
        if (poseMode === 'incline' || poseMode === 'shed') cosP = Math.cos(penteRad) || 0.0001;
        else if (poseMode === 'dome') cosP = Math.cos(domeTiltRad) || 0.0001;
        if (CM.state.panelOrientation === 'paysage') {
            return { alongEave: lengthM, alongRampant: widthM * cosP };
        }
        return { alongEave: widthM, alongRampant: lengthM * cosP };
    }

    // Espacement de bordure EFFECTIF : forcé à 0 pour une ombrière (les panneaux vont jusqu'au nu de
    // la structure — demande explicite : "il ne faut pas afficher de bordure pour l'ombrière"). Le
    // champ de saisie est d'ailleurs masqué (updatePoseModeUI). Utilisé pour le calcul de pose ET
    // pour le rendu 2D de la zone de dégagement (calepinage_maison_dessin.js).
    function effectiveEdgeClearanceM() {
        return isOmbriereType(CM.state.typeMontage) ? 0 : CM.state.edgeClearanceM;
    }

    function computeEdgeClearances(pan) {
        const edgeM = effectiveEdgeClearanceM();
        const ridgeSet = new Set(pan.ridgeEdgeIndices || []);
        return pan.points.map((_, i) =>
            (CM.state.divisionMode !== 'none' && ridgeSet.has(i)) ? CM.state.ridgeClearanceEachSideM : edgeM
        );
    }

    function erodePolygonByEdgeClearances(poly, clearances) {
        if (poly.length < 3) return [];
        return offsetPolygonEdges(poly, clearances, true);
    }

    // NOUVEAU (demande explicite : "Nb. panneaux en longueur"/"Esp. groupe de shed (mm)", même
    // logique que le calepinage polygonale en shed) : port fidèle de
    // LineToShed.js::calculateShedLayout/buildOffsets — regroupe les panneaux d'une rangée par lots
    // de `groupSize`, insérant `groupSpacing` (au lieu du simple `spacing` technique) à chaque
    // frontière de groupe, puis centre l'ensemble sur `available`. groupSize<=0 dégénère vers un
    // enchaînement continu (comportement historique, strictement inchangé) : c'est la valeur par
    // défaut de shedPanelsPerRow, donc aucune régression pour les pans déjà existants.
    function buildRowOffsets(available, effSize, spacing, groupSize, groupSpacing) {
        const offsets = [];
        let cursor = 0, idx = 0;
        if (effSize <= 0) return offsets;
        while (cursor + effSize <= available + 0.001) {
            offsets.push(cursor + effSize / 2);
            idx += 1;
            const isGroupBoundary = groupSize > 0 && idx % groupSize === 0;
            cursor += effSize + spacing + (isGroupBoundary ? groupSpacing : 0);
        }
        // CORRECTIF (règle métier explicite : "une rangée de shed ne doit pas se terminer avec un
        // nombre de panneaux impair si ce n'est pas prévu — le nombre total doit être un multiple
        // exact du paramètre de regroupement") : le remplissage ci-dessus s'arrête dès que le
        // panneau suivant ne tient plus, sans jamais vérifier que le DERNIER groupe est complet —
        // tronque ce groupe final incomplet plutôt que de le laisser tel quel. Sans effet quand
        // groupSize <= 0 (pas de regroupement demandé, comportement historique par défaut inchangé).
        const kept = groupSize > 0 ? offsets.slice(0, Math.floor(offsets.length / groupSize) * groupSize) : offsets;
        if (kept.length > 0) {
            // Bord de fin du dernier panneau CONSERVÉ (pas cursor, qui inclut encore l'espacement
            // suivant un panneau désormais retiré par la troncature).
            const actualUsed = kept[kept.length - 1] + effSize / 2;
            const shift = (available - actualUsed) / 2;
            return kept.map((o) => o + shift);
        }
        return kept;
    }

    // ------------------------------------------------------------------------------------------
    // Joints de dilatation (demande explicite : ombrières métal / bois / Solumbra et bâtiment
    // incliné, projets PRO / Grand projet — formulaires résidentiel et PRO en miroir).
    //
    // Base de calcul reprise de l'ancien calepinage (calepinage_ombriere.js::calculateResults,
    // SolarRectangle.js::computeOffsets) : la longueur du champ PV le long de l'égout est comparée à
    // la « longueur limite » ; au-delà, le champ est coupé en tronçons séparés par un joint.
    // Au joint, l'écart entre les deux panneaux voisins est la LARGEUR DU JOINT (demande explicite :
    // il remplace l'espacement X à cet endroit) : longueur totale =
    //   panneaux + (nbColonnes - 1 - nbJoints) x espacement X + nbJoints x largeur du joint.
    // Deux répartitions (state.jointDilatationRepartition), aucun tronçon ne dépassant la limite :
    //  - 'egale' (défaut) : colonnes réparties à parts égales (100 m, limite 65 m -> 2 x 50 m) ;
    //  - 'limite' : tronçons remplis jusqu'à la longueur limite, le reste en dernier (65 + 35 m).
    // ------------------------------------------------------------------------------------------
    const JOINT_DILATATION = {
        largeurDefautMm: 100, largeurMinMm: 10, largeurMaxMm: 300,
        limiteDefautM: 65, limiteMinM: 50, limiteMaxM: 100,
    };
    const TYPES_AVEC_JOINT_DILATATION = ['ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra', 'toiture_inclinee'];

    // Toiture terrasse (demande explicite) : au-delà de 300 m² de panneaux, le champ est coupé par
    // une SÉPARATION PHYSIQUE (90 cm par défaut, réglable) en sections de 300 m² au plus. Même
    // mécanique que les joints (tronçons égaux le long de l'égout) ; la longueur limite d'une
    // section se déduit de la surface d'une colonne de panneaux (cf. computeCandidatePanelSlots).
    const SEPARATION_TERRASSE = {
        surfaceMaxM2: 300, largeurDefautMm: 900, largeurMinMm: 300, largeurMaxMm: 3000,
    };

    function jointsDilatationApplicables(state) {
        return !!state && TYPES_AVEC_JOINT_DILATATION.indexOf(normalizeTypeMontage(state.typeMontage)) !== -1;
    }

    function borner(valeur, min, max, defaut) {
        const v = Number(valeur);
        if (valeur === null || valeur === undefined || valeur === '' || !isFinite(v)) return defaut;
        return Math.min(max, Math.max(min, v));
    }

    /**
     * Réglages de joint d'un pan ({largeurM, limiteM}), ou null si le type de structure n'en
     * prévoit pas. Pas de joint pour une pose en shed ou en dôme : leurs rangées sont déjà coupées
     * en tables séparées par « Esp. groupe de shed ».
     */
    function paramsJointDilatation(state, pan) {
        if (pan && (pan.poseMode === 'shed' || pan.poseMode === 'dome')) return null;
        if (state && normalizeTypeMontage(state.typeMontage) === 'toiture_terrasse') {
            const T = SEPARATION_TERRASSE;
            return {
                nature: 'separation',
                largeurM: borner(state.terrasseSeparationMm, T.largeurMinMm, T.largeurMaxMm, T.largeurDefautMm) / 1000,
                surfaceMaxM2: T.surfaceMaxM2,
                limiteM: null, // calculée depuis le nombre de rangées posées
                repartition: 'egale',
            };
        }
        if (!jointsDilatationApplicables(state)) return null;
        const J = JOINT_DILATATION;
        return {
            largeurM: borner(state.jointDilatationMm, J.largeurMinMm, J.largeurMaxMm, J.largeurDefautMm) / 1000,
            limiteM: borner(state.jointDilatationLimiteM, J.limiteMinM, J.limiteMaxM, J.limiteDefautM),
            repartition: state.jointDilatationRepartition === 'limite' ? 'limite' : 'egale',
            nature: 'joint',
        };
    }

    /**
     * Répartit n colonnes en tronçons de longueur <= limiteM. Renvoie le nombre de colonnes de
     * chaque tronçon. 'egale' : parts égales (les premiers tronçons prennent la colonne en plus) ;
     * 'limite' : chaque tronçon aussi long que la limite le permet, le reliquat en dernier.
     */
    function decouperEnTroncons(n, w, s, limiteM, repartition) {
        if (n <= 0) return [];
        const longueur = (k) => k * w + Math.max(0, k - 1) * s;
        if (repartition === 'limite') {
            const parTroncon = Math.max(1, Math.floor((limiteM + s + 1e-9) / (w + s)));
            const troncons = [];
            for (let reste = n; reste > 0; reste -= parTroncon) troncons.push(Math.min(parTroncon, reste));
            return troncons;
        }
        let nb = Math.max(1, Math.ceil(longueur(n) / limiteM - 1e-9));
        while (nb < n && longueur(Math.ceil(n / nb)) > limiteM + 1e-9) nb += 1;
        const base = Math.floor(n / nb), reste = n % nb;
        return Array.from({ length: nb }, (_, i) => base + (i < reste ? 1 : 0));
    }

    /**
     * Même rôle que buildRowOffsets (sans regroupement) quand des joints s'imposent : centres des
     * colonnes le long de `available`, centrés, avec un joint entre tronçons. Le nombre de colonnes
     * est réduit tant que colonnes + joints ne tiennent pas. Renvoie
     *   { centres, jointsX (milieu de chaque joint), frontieres (index de la 1re colonne après
     *     chaque joint), troncons }.
     */
    function placerColonnesAvecJoints(available, w, s, joint) {
        let n = Math.floor((available + 0.001 + s) / (w + s));
        let troncons = [];
        let total = 0;
        for (; n > 0; n -= 1) {
            troncons = decouperEnTroncons(n, w, s, joint.limiteM, joint.repartition);
            const nbJoints = troncons.length - 1;
            total = n * w + (n - 1 - nbJoints) * s + nbJoints * joint.largeurM;
            if (total <= available + 0.001) break;
        }
        const centres = [], jointsX = [], frontieres = [];
        if (n <= 0) return { centres, jointsX, frontieres, troncons: [] };
        let curseur = (available - total) / 2;
        troncons.forEach((k, t) => {
            for (let i = 0; i < k; i += 1) {
                centres.push(curseur + w / 2);
                curseur += w + s;
            }
            if (t < troncons.length - 1) {
                const bordFin = curseur - s; // bord du dernier panneau du tronçon
                jointsX.push(bordFin + joint.largeurM / 2);
                frontieres.push(centres.length);
                curseur = bordFin + joint.largeurM; // le joint remplace l'espacement X
            }
        });
        return { centres, jointsX, frontieres, troncons };
    }

    // CORRECTIF (bug rapporté : "les panneaux ne sont pas parallèles au rectangle — ils doivent
    // toujours l'être à la largeur et à la longueur") : pour un contour RECTANGLE (4 sommets, mode
    // ≠ 'polygon'), l'angle de la grille (et de la structure) est TOUJOURS redérivé de l'arête réelle
    // points[0]→points[1] du pan affiché, au lieu de faire confiance à pan.angle — qui pouvait rester
    // obsolète après une édition de sommet / un redimensionnement (les resynchronisations ne couvrent
    // pas tous les chemins), d'où des panneaux légèrement de travers. Le décalage manuel
    // rectAzimuthOffsetDeg (paliers de 90°, garde les panneaux parallèles) reste appliqué à
    // l'identique de resetDivision(). Pour un toit divisé (pans triangulaires/polygonaux) ou un
    // contour polygone libre, on garde pan.angle (référence stable voulue, cf. resetDivision()).
    function effectiveGridAngle(pan) {
        // Uniquement le cas "contour rectangle non divisé" : un toit divisé (2/4 pans) fixe
        // volontairement pan.angle sur l'axe du faîtage — ne pas le réécraser depuis l'arête [0]→[1]
        // d'un demi-pan (qui n'est pas forcément parallèle au faîtage). Idem contour polygone libre
        // (référence d'azimut stable voulue, cf. resetDivision()).
        if (CM.state.divisionMode === 'none'
            && CM.state.contourMode !== 'polygon'
            && Array.isArray(pan.points) && pan.points.length === 4) {
            const p0 = pan.points[0], p1 = pan.points[1];
            return Math.atan2(p1.y - p0.y, p1.x - p0.x) + (((CM.state.rectAzimuthOffsetDeg || 0) * Math.PI) / 180);
        }
        return pan.angle || 0;
    }

    /**
     * Règle métier de l'option "Sheds réguliers" (demande explicite) : elle ne s'applique que si
     * "Esp. groupe de shed (mm)" > 0 ET "Nb. PV en long. par shed" > 0 — sans ces deux réglages il
     * n'y a pas de TABLE (groupe de panneaux le long de la rangée) à comparer. Partagée avec le
     * formulaire (updateShedRegularAvailability), qui désactive la case dans le cas contraire.
     */
    function shedRegulierApplicable(state) {
        return !!state && (state.shedPanelsPerRow || 0) > 0 && (state.shedRowGroupSpacingM || 0) > 0;
    }

    // ── Cache du placement ────────────────────────────────────────────────────────────────────────
    // Le placement d'un champ solaire (jusqu'à ~25 000 panneaux : 4 coins de chaque emplacement
    // testés contre le contour et les obstacles, recherche du meilleur décalage) était recalculé
    // plusieurs fois à CHAQUE rendu, donc à chaque clic, survol ou cran de molette. Il est désormais
    // réutilisé tant que son empreinte ne change pas : le pan, TOUS les réglages simples de l'état
    // (nombres, textes, booléens — ce qui couvre les réglages lus par les fonctions auxiliaires sans
    // avoir à les lister), les obstacles, le décalage de grille et les panneaux supprimés du pan.
    // Seuls les réglages de vue (zoom, décalage, échelle) sont exclus : ils n'influencent pas le
    // placement. Le tableau renvoyé est PARTAGÉ : ne jamais le modifier.
    const CHAMPS_HORS_PLACEMENT = new Set(['zoomFactor', 'panOffsetX', 'panOffsetY', 'scale', 'offsetX', 'offsetY',
        'mapScreenshotToken', 'selectedObstacleId', 'panToolActive']);
    const cachePlacement = new WeakMap();   // state -> Map(pan.id -> { cle, slots })
    let placementFige = 0;

    /** Pendant un geste « vue seule » (zoom, déplacement de la vue), même l'empreinte est sautée. */
    function avecPlacementFige(fn) {
        placementFige++;
        try { return fn(); } finally { placementFige--; }
    }

    function empreintePlacement(pan, state) {
        const morceaux = [];
        Object.keys(state).forEach((k) => {
            const v = state[k];
            const t = typeof v;
            if ((v === null || t === 'number' || t === 'string' || t === 'boolean') && !CHAMPS_HORS_PLACEMENT.has(k)) {
                morceaux.push(k + '=' + v);
            }
        });
        const obstacles = (state.obstacles || []).map((o) =>
            [o.x, o.y, o.w, o.h, o.angle || 0, o.buffer].join(',')).join(';');
        const decalage = state.gridOffsetByPan && state.gridOffsetByPan.get(pan.id);
        const supprimes = state.deletedPanelIndicesByPan && state.deletedPanelIndicesByPan.get(pan.id);
        return morceaux.join('|') + '#' + JSON.stringify(pan) + '#' + obstacles
            + '#' + (decalage ? decalage.dx + ',' + decalage.dy : '')
            + '#' + (supprimes ? Array.from(supprimes).join(',') : '');
    }

    function computeCandidatePanelSlots(pan) {
        const state = CM.state;
        let parPan = cachePlacement.get(state);
        if (!parPan) { parPan = new Map(); cachePlacement.set(state, parPan); }
        const memo = parPan.get(pan.id);
        if (placementFige && memo) return memo.slots;
        let cle = null;
        try { cle = empreintePlacement(pan, state); } catch (e) { cle = null; }
        if (cle !== null && memo && memo.cle === cle) return memo.slots;
        const slots = calculerCandidatePanelSlots(pan);
        if (cle !== null) parPan.set(pan.id, { cle, slots });
        return slots;
    }

    function calculerCandidatePanelSlots(pan) {
        const dims = getEffectivePanelDims(pan.poseMode, effectivePenteDegForPan(pan));
        const w = dims.alongEave, l = dims.alongRampant;
        if (w <= 0 || l <= 0) return [];

        const angle = effectiveGridAngle(pan);
        const overhang = (CM.state.overhangRampant + CM.state.overhangLongpan) / 2;
        // CORRECTIF (bug rapporté : "avec un porte-à-faux, des panneaux se posent sur le faîtage") :
        // le porte-à-faux prolonge la toiture au-delà de l'ÉGOUT et des RIVES, JAMAIS au-delà du
        // FAÎTAGE (où deux pans se rejoignent). Sans cette exclusion, bufferPolygonOutward décalait
        // aussi l'arête de faîtage vers l'extérieur ; dès que overhang > "Largeur faîtage"
        // (ridgeClearanceEachSideM, ré-érodée juste après), la zone de pose franchissait le faîtage.
        // Même condition que computeEdgeClearances() pour rester cohérent.
        const ridgeSet = new Set(pan.ridgeEdgeIndices || []);
        const bufferedPoints = overhang
            ? offsetPolygonEdges(
                pan.points,
                pan.points.map((_, i) =>
                    (CM.state.divisionMode !== 'none' && ridgeSet.has(i)) ? 0 : overhang),
                false)
            : pan.points;

        const erodedPoints = erodePolygonByEdgeClearances(bufferedPoints, computeEdgeClearances(pan));
        if (erodedPoints.length < 3) return [];

        const localPoints = erodedPoints.map((p) => rotateAroundOrigin(p, -angle));
        const bb = boundingBox(localPoints);

        const spacingX = panelSpacingXM();
        const isDome = pan.poseMode === 'dome';
        const domePanelGapM = isDome ? CM.state.domePanelSpacingM : 0;
        // Rangée de dôme = nbDome panneaux enchaînés le long du rampant (moitié de chaque côté du
        // faîtage), tous séparés par "Esp. panneaux du dôme" ; nbDome = 2 : le dôme historique.
        const nbDome = isDome ? domePanelsPerRow() : 1;
        const pairHeightM = isDome ? (nbDome * l + (nbDome - 1) * domePanelGapM) : l;
        const spacingY = isDome ? CM.state.domeSpacingM : (pan.poseMode === 'shed' ? CM.state.shedSpacingM : panelSpacingYM());
        // "Nb. panneaux en longueur" / "Esp. groupe de shed (mm)" : regroupement le long de la
        // rangée (axe X, égout) — 0 = pas de regroupement (cf. buildRowOffsets ci-dessus).
        const shedPanelsPerRow = pan.poseMode === 'shed' ? Math.max(0, Math.min(40, CM.state.shedPanelsPerRow || 0)) : 0;
        const shedRowGroupSpacingM = pan.poseMode === 'shed' ? Math.max(0, CM.state.shedRowGroupSpacingM || 0) : 0;

        const usableY = Math.max(0, bb.maxY - bb.minY);

        // Plafond aligné sur la saisie "Nb. PV par shed" (1-15, bornes du formulaire PRO) : il était
        // à 10, une valeur de 11 à 15 était donc calculée silencieusement comme 10.
        const shedGroupSize = pan.poseMode === 'shed' ? Math.max(1, Math.min(15, CM.state.shedPanelsPerGroup || 1)) : 1;
        // "Sheds réguliers" : une TABLE = shedGroupSize panneaux en largeur (rampant, un module de
        // rangées) x shedPanelsPerRow panneaux en longueur (un groupe de colonnes séparé du suivant
        // par l'esp. groupe de shed, cf. buildRowOffsets : groupe = floor(jx / shedPanelsPerRow)).
        const shedRegulierActif = pan.poseMode === 'shed' && !!CM.state.shedRegularAlignment
            && shedRegulierApplicable(CM.state) && shedPanelsPerRow > 0;
        const panneauxParTable = shedGroupSize * shedPanelsPerRow;
        const cleTable = (jx, jy) => `${Math.floor(jx / shedPanelsPerRow)}-${Math.floor(jy / shedGroupSize)}`;
        let rowYs;
        if (shedGroupSize > 1 && pairHeightM > 0) {
            rowYs = [];
            let y = 0;
            while (y + pairHeightM <= usableY + 1e-9) {
                rowYs.push(y);
                const isGroupBoundary = (rowYs.length % shedGroupSize) === 0;
                y += pairHeightM + (isGroupBoundary ? spacingY : panelSpacingYM());
            }
            // CORRECTIF (même règle métier que buildRowOffsets ci-dessus, appliquée ici à l'axe Y —
            // "Nombre de panneaux par module shed") : tronque le dernier module (groupe de rangées)
            // incomplet en fin de pan, plutôt que de laisser un reliquat de rangées non groupées.
            rowYs = rowYs.slice(0, Math.floor(rowYs.length / shedGroupSize) * shedGroupSize);
        } else {
            const countY = pairHeightM > 0 ? Math.floor((usableY + spacingY) / (pairHeightM + spacingY)) : 0;
            rowYs = Array.from({ length: countY }, (_, i) => i * (pairHeightM + spacingY));
        }
        const usedY = rowYs.length > 0 ? rowYs[rowYs.length - 1] + pairHeightM : 0;
        const gridOffset = CM.state.gridOffsetByPan.get(pan.id) || { dx: 0, dy: 0 };
        const startY = bb.minY + (usableY - usedY) / 2 + gridOffset.dy;

        const deletedSet = CM.state.deletedPanelIndicesByPan.get(pan.id);

        const slots = [];
        const pushSlot = (x, y, h, jx, jy, domeSide) => {
            const localCorners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
            const trueCorners = localCorners.map((c) => rotateAroundOrigin(c, angle));
            const inside = trueCorners.every((c) => pointInPolygon(c, erodedPoints));
            const blocked = trueCorners.some((c) => CM.state.obstacles.some((o) => isPointInObstacleBuffer(c, o)));
            if (!inside || blocked) return;
            const idxKey = domeSide === undefined ? `${jx}-${jy}` : `${jx}-${jy}-${domeSide}`;
            const trueCenter = rotateAroundOrigin({ x: x + w / 2, y: y + h / 2 }, angle);
            slots.push({
                idxKey, cx: trueCenter.x, cy: trueCenter.y, w, l: h, angle,
                deleted: !!(deletedSet && deletedSet.has(idxKey)),
            });
        };

        // CORRECTIF (bug rapporté : "les panneaux ne sont pas alignés verticalement" sur un contour
        // polygonal libre irrégulier) : xCenters est désormais calculé UNE SEULE FOIS, depuis la
        // largeur du pan ENTIER (bb, déjà calculée plus haut), au lieu d'être recalculé et recentré
        // à chaque rangée depuis la largeur locale de CETTE rangée (rowBB) — pour un contour
        // rectangulaire, bb et la largeur de chaque rangée coïncident déjà (aucun changement visible,
        // aucune régression) ; pour un contour irrégulier, chaque rangée avait sa propre largeur/
        // origine locale, désalignant les colonnes d'une rangée à l'autre (cf. calepinage_shed.js::
        // calculateShedGridPoly du calepinage Pro/Grand-projet, qui évite le même problème en
        // calculant une grille ABSOLUE unique). Le test d'appartenance déjà en place dans pushSlot()
        // (pointInPolygon sur les 4 coins contre erodedPoints) rejette naturellement, rangée par
        // rangée, les positions de cette grille globale qui tombent hors du contour à cet endroit —
        // aucun nouveau code de clipping/rejet nécessaire.
        const usableX = Math.max(0, bb.maxX - bb.minX);
        let xCenters = buildRowOffsets(usableX, w, spacingX, shedPanelsPerRow, shedRowGroupSpacingM);
        // Joints de dilatation (ombrières / bâtiment incliné) : la grille est recalculée en
        // tronçons séparés par un joint dès que la longueur du champ dépasse la longueur limite.
        const joint = paramsJointDilatation(CM.state, pan);
        let jointsLocalX = [], frontieresJoints = [];
        if (joint && joint.surfaceMaxM2) {
            // Terrasse : une section = au plus surfaceMaxM2 de panneaux. Surface d'une colonne =
            // rangées posées x surface PHYSIQUE d'un panneau (nbDome panneaux par rangée en dôme). On en
            // déduit le nombre de colonnes par section, puis la longueur limite équivalente.
            const surfacePanneauM2 = ((CM.state.panelLengthMm || 0) * (CM.state.panelWidthMm || 0)) / 1e6;
            const surfaceColonneM2 = rowYs.length * nbDome * surfacePanneauM2;
            if (surfaceColonneM2 > 0) {
                const colonnesMax = Math.max(1, Math.floor(joint.surfaceMaxM2 / surfaceColonneM2 + 1e-9));
                joint.limiteM = colonnesMax * w + (colonnesMax - 1) * spacingX + 1e-6;
            }
        }
        if (joint && joint.limiteM) {
            const r = placerColonnesAvecJoints(usableX, w, spacingX, joint);
            if (r.jointsX.length) {
                xCenters = r.centres;
                jointsLocalX = r.jointsX;
                frontieresJoints = r.frontieres;
            }
        }

        // NOUVEAU (demande explicite : "assurez-vous que le polygone soit rempli au maximum de
        // panneaux en tenant compte des variables du formulaire", cas polygone libre + shed) : la
        // grille xCenters ci-dessus est centrée une seule fois sur bb, sans tenir compte d'où le
        // contour irrégulier va effectivement couper les empilements shed (cf. le filtre obligatoire
        // plus bas). Teste ici plusieurs décalages horizontaux (phases) de cette même grille — à
        // réglages de formulaire strictement identiques — et conserve celui qui maximise le nombre de
        // panneaux qui survivront au filtre d'empilement complet. Recentré sur le polygone libre
        // (contour rectangulaire : la grille couvre déjà toute la largeur utile sans coupure, cette
        // recherche y serait un no-op coûteux pour rien).
        // Avec "Sheds réguliers", c'est le nombre de panneaux des TABLES COMPLÈTES qui est maximisé
        // (une table tronquée par le contour sera retirée en entier par le filtre plus bas).
        if (pan.poseMode === 'shed' && CM.state.contourMode === 'polygon' && (shedGroupSize > 1 || shedRegulierActif) && xCenters.length > 0) {
            const rowBands = rowYs.map((ry) => {
                const yPair = startY + ry;
                const band = clipPolygonByLine(
                    clipPolygonByLine(localPoints, { x: 0, y: yPair }, { x: 1, y: 0 }, 1),
                    { x: 0, y: yPair + pairHeightM }, { x: 1, y: 0 }, -1
                );
                return band.length >= 3;
            });
            // Recherche répétée 33 fois sur tout le champ (~25 000 emplacements) : l'appartenance au
            // contour est testée dans le repère de la grille (localPoints = contour érodé tourné de
            // -angle, même géométrie), sans tourner ni allouer les 4 coins de chaque emplacement ;
            // les coins réels ne sont calculés que s'il y a des obstacles.
            const obstacles = CM.state.obstacles;
            const pt = { x: 0, y: 0 };
            const dansContour = (x, y) => { pt.x = x; pt.y = y; return pointInPolygon(pt, localPoints); };
            const countCompleteSlotsForXCenters = (centers) => {
                const countByStack = new Map();
                rowYs.forEach((ry, jy) => {
                    if (!rowBands[jy]) return;
                    const yPair = startY + ry;
                    const yHaut = yPair + pairHeightM;
                    const moduleIdx = Math.floor(jy / shedGroupSize);
                    centers.forEach((centerX, jx) => {
                        const x = bb.minX + centerX - w / 2 + gridOffset.dx;
                        if (!(dansContour(x, yPair) && dansContour(x + w, yPair) && dansContour(x + w, yHaut) && dansContour(x, yHaut))) return;
                        if (obstacles.length) {
                            const corners = [{ x, y: yPair }, { x: x + w, y: yPair }, { x: x + w, y: yHaut }, { x, y: yHaut }]
                                .map((c) => rotateAroundOrigin(c, angle));
                            if (corners.some((c) => obstacles.some((o) => isPointInObstacleBuffer(c, o)))) return;
                        }
                        const key = shedRegulierActif ? cleTable(jx, jy) : `${jx}-${moduleIdx}`;
                        countByStack.set(key, (countByStack.get(key) || 0) + 1);
                    });
                });
                const complet = shedRegulierActif ? panneauxParTable : shedGroupSize;
                let total = 0;
                countByStack.forEach((count) => { if (count === complet) total += complet; });
                return total;
            };

            const pitch = w + spacingX;
            const sampleCount = 16;
            let bestCenters = xCenters, bestCount = countCompleteSlotsForXCenters(xCenters), bestAbsDelta = 0;
            for (let i = 1; i <= sampleCount; i++) {
                const delta = (i / sampleCount) * (pitch / 2);
                [delta, -delta].forEach((d) => {
                    const shifted = xCenters.map((c) => c + d);
                    // Ignore une phase qui ferait sortir la grille de bb (usableX) — le centrage
                    // initial de buildRowOffsets tient toujours dans usableX, un décalage trop grand
                    // ferait dépasser la première/dernière colonne.
                    if (shifted[0] - w / 2 < -0.01 || shifted[shifted.length - 1] + w / 2 > usableX + 0.01) return;
                    const count = countCompleteSlotsForXCenters(shifted);
                    if (count > bestCount || (count === bestCount && Math.abs(d) < bestAbsDelta)) {
                        bestCount = count; bestCenters = shifted; bestAbsDelta = Math.abs(d);
                    }
                });
            }
            xCenters = bestCenters;
        }

        for (let jy = 0; jy < rowYs.length; jy++) {
            const yPair = startY + rowYs[jy];
            const band = clipPolygonByLine(
                clipPolygonByLine(localPoints, { x: 0, y: yPair }, { x: 1, y: 0 }, 1),
                { x: 0, y: yPair + pairHeightM }, { x: 1, y: 0 }, -1
            );
            if (band.length < 3) continue; // rangée hors du contour à cette hauteur — rien à y placer
            xCenters.forEach((centerX, jx) => {
                const x = bb.minX + centerX - w / 2 + gridOffset.dx;
                if (isDome) {
                    // Index "jx-jy-k", k = 0 .. nbDome-1 depuis le bas de la rangée (k < nbDome/2 :
                    // premier côté) — pour nbDome = 2, k = 0/1 reste l'ancien côté du dôme, donc
                    // les panneaux supprimés des calepinages enregistrés restent les mêmes.
                    for (let k = 0; k < nbDome; k++) {
                        pushSlot(x, yPair + k * (l + domePanelGapM), l, jx, jy, k);
                    }
                } else {
                    pushSlot(x, yPair, l, jx, jy, undefined);
                }
            });
        }

        // NOUVEAU (demande explicite : "les rangées de shed ne doivent pas terminer avec des
        // panneaux isolés — chaque rangée de shed doit avoir un nombre de panneaux = Nb. PV par
        // shed... on aura toujours un nombre de panneaux pairs comme total") : contrairement au
        // filtre optionnel "Sheds réguliers" ci-dessous (qui ne compare que des TOTAUX par module sur
        // toute la largeur du pan, et reste facultatif), celui-ci est TOUJOURS actif dès que
        // shedGroupSize > 1 (un "shed" = un empilement de shedGroupSize panneaux le long du rampant à
        // une position jx donnée) : retire tout empilement (jx, module) dont le nombre de panneaux
        // survivants est inférieur à shedGroupSize — un empilement conservé compte donc toujours
        // EXACTEMENT shedGroupSize panneaux, ce qui garantit mécaniquement que le total du pan reste
        // un multiple de shedGroupSize (pair, pour la valeur par défaut 2). No-op pour
        // shedGroupSize === 1 (comportement historique inchangé).
        if (pan.poseMode === 'shed' && shedGroupSize > 1) {
            const jxOf = (idxKey) => parseInt(idxKey.split('-')[0], 10);
            const jyOf = (idxKey) => parseInt(idxKey.split('-')[1], 10);
            const moduleOf = (jy) => Math.floor(jy / shedGroupSize);
            const countByStack = new Map();
            slots.forEach((s) => {
                if (s.deleted) return;
                const key = `${jxOf(s.idxKey)}-${moduleOf(jyOf(s.idxKey))}`;
                countByStack.set(key, (countByStack.get(key) || 0) + 1);
            });
            slots.forEach((s) => {
                if (s.deleted) return;
                const key = `${jxOf(s.idxKey)}-${moduleOf(jyOf(s.idxKey))}`;
                if ((countByStack.get(key) || 0) < shedGroupSize) s.deleted = true;
            });
        }

        // CORRECTIF (bug critique rapporté : "cliquer sur Sheds réguliers supprime tous les
        // panneaux") : le filtre précédent exigeait qu'une colonne (jx) soit présente dans 100% des
        // rangées de TOUT le pan, sans aucune tolérance — un bruit de virgule flottante sur
        // pointInPolygon (comparaison stricte) ou une largeur de rangée légèrement différente d'une
        // rangée à l'autre (contour non parfaitement rectangulaire) suffisait à ce qu'AUCUNE colonne
        // n'atteigne 100%, vidant tout le pan d'un coup. Comparé à la référence Pro/Grand-projet
        // (calepinage_shed.js::calculateShedGridPoly), dont le contrôle "régulier" est scopé à UNE
        // SEULE table/module (un petit groupe fixe de rangées), jamais à l'ensemble du toit : la
        // complétude est désormais vérifiée par MODULE shed (shedGroupSize rangées consécutives,
        // moduleIndex = jy / shedGroupSize) — un module incomplet ne perd que SES colonnes
        // incomplètes, jamais les modules voisins. Recentré sur le mode 'shed' uniquement (le dôme
        // n'a pas de notion de "module" — shedGroupSize y vaut toujours 1, ce qui aurait rendu ce
        // filtre un no-op silencieux ; la case correspondante n'est d'ailleurs plus affichée en
        // mode dôme, cf. formulaires.js).
        // CORRECTIF (demande explicite : "lorsque la case Sheds réguliers est cochée, il faut
        // afficher et comptabiliser uniquement les groupes de sheds qui ont un même nombre de
        // panneaux") : remplace le précédent contrôle de complétude de colonne INTRA-module par une
        // comparaison du nombre TOTAL de panneaux entre modules — détermine le nombre de panneaux
        // le plus FRÉQUENT parmi tous les modules du pan (en cas d'égalité, le plus grand l'emporte)
        // comme référence "régulière", puis retire les modules dont le total diffère. Gardé au mode
        // 'shed' uniquement (le dôme n'a pas de notion de "module", shedGroupSize y vaut toujours 1).
        // NOUVEAU (demande explicite : "le shed régulier fonctionne uniquement si Nb. PV par shed et
        // Nb. PV en long. par shed sont > 1 et Esp. groupe de shed (mm) est > 0") : même règle
        // qu'appliquée côté formulaire (updateShedRegularAvailability()) pour désactiver la case,
        // reproduite ici pour qu'un état déjà coché ne produise jamais d'effet si les préconditions
        // cessent d'être remplies après coup (ex. état persisté avant un changement de réglage).
        // CORRECTIF (demande explicite : "dans le cas du polygone libre et l'option shed, Sheds
        // réguliers doit être désélectionné") : sur ce contour, le nouveau filtre obligatoire
        // d'empilement shed complet (plus haut) couvre déjà, de façon plus stricte, ce que ce filtre
        // optionnel propose au niveau du module — désactivé ici en miroir de
        // updateShedRegularAvailability() (formulaires.js), pour qu'un état déjà persisté avec la
        // case cochée sur un ancien contour n'ait plus d'effet après ce correctif.
        // CORRECTIF (bug rapporté : "shed régulier coché, les sheds irréguliers restent affichés et
        // comptés") : l'ancien filtre comparait le TOTAL de panneaux de chaque module (toute une
        // rangée de tables sur la largeur du pan) au total le plus fréquent — une rangée contenant
        // des tables tronquées gardait donc celles-ci dès que les autres rangées l'étaient pareil, et
        // il était de plus neutralisé sur un polygone libre et quand "Nb. PV par shed" valait 1.
        // Désormais (demande explicite) : ne sont gardées que les tables COMPLÈTES, composées
        // exactement de shedGroupSize panneaux en largeur x shedPanelsPerRow en longueur (ex. 2 x 10
        // = 20 panneaux) ; toute table incomplète (contour, obstacle, bord) est retirée en entier.
        // Les panneaux retirés passent `deleted` : packPanelsForPan ne les renvoie plus, donc rendu,
        // carte, compteurs et calculs (production, résultats shed) suivent sans autre traitement.
        if (shedRegulierActif) {
            const jxOf = (idxKey) => parseInt(idxKey.split('-')[0], 10);
            const jyOf = (idxKey) => parseInt(idxKey.split('-')[1], 10);
            const countByTable = new Map();
            slots.forEach((s) => {
                if (s.deleted) return;
                const key = cleTable(jxOf(s.idxKey), jyOf(s.idxKey));
                countByTable.set(key, (countByTable.get(key) || 0) + 1);
            });
            slots.forEach((s) => {
                if (s.deleted) return;
                if ((countByTable.get(cleTable(jxOf(s.idxKey), jyOf(s.idxKey))) || 0) !== panneauxParTable) s.deleted = true;
            });
        }

        // Segments des joints (repère réel, mètres) pour le dessin 2D et les cotes : chaque joint
        // s'étend sur la hauteur des panneaux effectivement posés de part et d'autre. Porté par le
        // tableau lui-même (propriété, pas un élément) : packPanelsForPan n'en renvoie qu'une copie
        // filtrée, et l'état n'est jamais modifié.
        slots.jointsDilatation = [];
        jointsLocalX.forEach((xj, j) => {
            const k = frontieresJoints[j];
            let yMin = Infinity, yMax = -Infinity;
            slots.forEach((s) => {
                if (s.deleted) return;
                const jx = parseInt(s.idxKey.split('-')[0], 10);
                if (jx !== k - 1 && jx !== k) return;
                const c = rotateAroundOrigin({ x: s.cx, y: s.cy }, -angle);
                yMin = Math.min(yMin, c.y - s.l / 2);
                yMax = Math.max(yMax, c.y + s.l / 2);
            });
            if (!isFinite(yMin)) return;
            const x = bb.minX + xj + gridOffset.dx;
            slots.jointsDilatation.push({
                a: rotateAroundOrigin({ x, y: yMin }, angle),
                b: rotateAroundOrigin({ x, y: yMax }, angle),
                largeurM: joint.largeurM,
                nature: joint.nature,
            });
        });

        return slots;
    }

    /**
     * Joints de dilatation d'un pan pour l'état courant (CM.state) : [{a, b, largeurM}] en mètres,
     * repère réel. Tableau vide si le type de structure n'en prévoit pas ou si le champ est plus
     * court que la longueur limite.
     */
    function jointsDilatationDuPan(pan) {
        return computeCandidatePanelSlots(pan).jointsDilatation || [];
    }

    // ── Dôme : 2 champs PV par pan, un par azimut ─────────────────────────────────────────────────
    // Une rangée de dôme est un toit à 2 pans symétriques : les panneaux k < N/2 (index "jx-jy-k",
    // cf. computeCandidatePanelSlots) montent vers le faîtage de la rangée dans le sens +y de la
    // grille, donc regardent -y ; les autres en redescendent et regardent +y. Chaque côté est un
    // champ PV distinct pour la production (azimut propre, même inclinaison domeTiltDeg).
    const SUFFIXES_CHAMP_DOME = ['_Dome1', '_Dome2'];

    /** Côté (0 ou 1) d'un panneau de dôme, null hors dôme (index sans 3e composante). */
    function coteDomePanneau(panelIndex, state) {
        const k = parseInt(String(panelIndex || '').split('-')[2], 10);
        if (!Number.isFinite(k)) return null;
        return k < domePanelsPerRow(state) / 2 ? 0 : 1;
    }

    /**
     * Azimuts [côté 0, côté 1] d'un pan en dôme (convention du formulaire : Sud = 0°, Ouest = 90°).
     * Gardent l'azimut affiché du pan (pan.azimuth) et son opposé ; seul le côté qui reçoit
     * pan.azimuth est déduit de la géométrie (angle de grille `angle` des panneaux posés).
     */
    function azimutsCotesDome(pan, angle) {
        const norm = (a) => { let v = ((a + 180) % 360 + 360) % 360 - 180; if (v === -180) v = 180; return v; };
        const versPlusY = toAzimuth(headingOfVector({ x: -Math.sin(angle || 0), y: Math.cos(angle || 0) }));
        const az = Number.isFinite(Number(pan && pan.azimuth)) ? Number(pan.azimuth) : versPlusY;
        const oppose = norm(az + 180);
        // Côté 1 regarde +y : il reçoit celui des deux azimuts le plus proche de +y.
        return Math.abs(norm(az - versPlusY)) <= 90 ? [oppose, norm(az)] : [norm(az), oppose];
    }

    function packPanelsForPan(pan) {
        return computeCandidatePanelSlots(pan)
            .filter((s) => !s.deleted)
            .map((s) => ({ cx: s.cx, cy: s.cy, w: s.w, l: s.l, angle: s.angle, panId: pan.id, panelIndex: s.idxKey }));
    }

    // Même résultat que packPanelsForPan, mais le MÊME tableau tant que le placement n'a pas changé :
    // le rendu du canevas s'en sert de clé pour réutiliser ses tracés. Lecture seule.
    const panneauxParPlacement = new WeakMap();   // slots -> panneaux
    function panneauxPartagesDuPan(pan) {
        const slots = computeCandidatePanelSlots(pan);
        let panneaux = panneauxParPlacement.get(slots);
        if (!panneaux) {
            panneaux = slots.filter((s) => !s.deleted)
                .map((s) => ({ cx: s.cx, cy: s.cy, w: s.w, l: s.l, angle: s.angle, panId: pan.id, panelIndex: s.idxKey }));
            panneauxParPlacement.set(slots, panneaux);
        }
        return panneaux;
    }

    /**
     * NOUVEAU (demande explicite : "les dimensions des champs PV n'apparaissent pas dans le Summary
     * modal", et dimensions d'ombrière plus précises) : mesure la grille d'un pan et en déduit les
     * dimensions du champ PV correspondant.
     *
     * Les longueurs ne sont PAS l'encombrement mesuré des panneaux posés mais la dimension
     * RECONSTITUÉE : nb de panneaux x dimension du panneau selon le mode de pose + les espacements.
     * La dimension du panneau utilisée est la dimension PHYSIQUE (panelLengthMm/panelWidthMm), pas
     * la profondeur projetée par la pente — la projection est appliquée à part (surfaceProjeteeM2).
     *
     * `state` optionnel (défaut CM.state) : packPanelsForPan lit CM.state en GLOBAL, on bascule donc
     * temporairement pour mesurer un champ qui n'est pas celui affiché (même patron que
     * getAllPvFieldSummaries).
     * Renvoie null si aucun panneau n'est posé sur ce pan.
     */
    function mesurerGrillePan(pan, state) {
        state = state || CM.state;
        const precedent = CM.state;
        CM.state = state;
        let slots = [];
        let joints = [];
        try {
            const candidats = computeCandidatePanelSlots(pan);
            joints = candidats.jointsDilatation || [];
            slots = candidats.filter((s) => !s.deleted);
        } finally {
            CM.state = precedent;
        }
        if (!slots.length) return null;
        const jointMm = joints.length ? joints[0].largeurM * 1000 : 0;

        // Tous les panneaux d'une grille partagent le même angle : on redresse sur les axes pour
        // compter colonnes (axe de l'égout) et rangées (axe du rampant).
        const angle = slots[0].angle || 0;
        const points = slots.map((s) => rotateAroundOrigin({ x: s.cx, y: s.cy }, -angle));
        const largeurSlot = Math.max.apply(null, slots.map((s) => s.w || 0));
        const profondeurSlot = Math.max.apply(null, slots.map((s) => s.l || 0));
        // 35 % du panneau : les espacements sont petits devant le panneau lui-même, un seuil plus
        // haut fusionnerait deux rangées voisines (même constante que les modules de dimensions).
        const compter = (valeurs, tolerance) => {
            const triees = valeurs.slice().sort((a, b) => a - b);
            let n = 1;
            for (let i = 1; i < triees.length; i += 1) {
                if (triees[i] - triees[i - 1] > tolerance) n += 1;
            }
            return n;
        };
        const nbColonnes = compter(points.map((p) => p.x), largeurSlot * 0.35);
        const nbRangees = compter(points.map((p) => p.y), profondeurSlot * 0.35);

        const paysage = state.panelOrientation === 'paysage';
        const dimEgoutMm = paysage ? (state.panelLengthMm || 0) : (state.panelWidthMm || 0);
        const dimRampantMm = paysage ? (state.panelWidthMm || 0) : (state.panelLengthMm || 0);
        // Joints de dilatation : au joint, la largeur du joint remplace l'espacement X.
        const longueurM = (nbColonnes * dimEgoutMm
            + Math.max(0, nbColonnes - 1 - joints.length) * (state.panelSpacingXMm || 0)
            + joints.length * jointMm) / 1000;
        const largeurM = (nbRangees * dimRampantMm
            + Math.max(0, nbRangees - 1) * (state.panelSpacingYMm || 0)) / 1000;

        const surfacePanneauxM2 = (slots.length * dimEgoutMm * dimRampantMm) / 1e6;
        const penteDeg = effectivePenteDegForPan(pan, state);
        return {
            nbColonnes, nbRangees,
            nbPanneaux: slots.length,
            longueurM: Math.round(longueurM * 100) / 100,
            largeurM: Math.round(largeurM * 100) / 100,
            // "LxC" : L = panneaux dans le rampant, C = panneaux le long de la façade — même
            // convention que #pvLayout des modales structure et que le calepinage PRO.
            disposition: `${nbRangees}L x ${nbColonnes}C`,
            surfacePanneauxM2: Math.round(surfacePanneauxM2 * 100) / 100,
            // Empreinte au sol : surface réelle ramenée à l'horizontale par la pente du pan.
            surfaceProjeteeM2: Math.round(surfacePanneauxM2 * Math.cos((penteDeg * Math.PI) / 180) * 100) / 100,
            penteDeg,
            angleGrilleRad: angle,
            nbJointsDilatation: joints.length,
            jointDilatationMm: jointMm,
        };
    }

    function pointInRotatedRect(pt, rect) {
        const local = rotateAroundOrigin({ x: pt.x - rect.cx, y: pt.y - rect.cy }, -rect.angle);
        return Math.abs(local.x) <= rect.w / 2 && Math.abs(local.y) <= rect.l / 2;
    }

    function deletePanelAt(pan, meterPt) {
        const slots = computeCandidatePanelSlots(pan);
        const hit = slots.find((s) => !s.deleted && pointInRotatedRect(meterPt, s));
        if (!hit) return false;
        if (!CM.state.deletedPanelIndicesByPan.has(pan.id)) CM.state.deletedPanelIndicesByPan.set(pan.id, new Set());
        CM.state.deletedPanelIndicesByPan.get(pan.id).add(hit.idxKey);
        return true;
    }

    // 2026-10-09 : deux polygones CONVEXES se touchent-ils (théorème de l'axe séparateur) ? Un
    // simple contact compte comme une intersection.
    function convexPolygonsIntersect(a, b) {
        const projeter = (pts, ax) => {
            let min = Infinity, max = -Infinity;
            pts.forEach((p) => { const v = p.x * ax.x + p.y * ax.y; if (v < min) min = v; if (v > max) max = v; });
            return { min, max };
        };
        return [a, b].every((poly) => poly.every((p, i) => {
            const q = poly[(i + 1) % poly.length];
            const ax = { x: -(q.y - p.y), y: q.x - p.x };
            if (!ax.x && !ax.y) return true;
            const pa = projeter(a, ax), pb = projeter(b, ax);
            return pa.max >= pb.min && pb.max >= pa.min;
        }));
    }

    // 2026-10-09 (demande explicite : "suppression multiple par sélection rectangulaire, un panneau
    // partiellement inclus dans le rectangle doit être supprimé") : supprime, sur tous les pans du
    // champ affiché, chaque panneau posé qui touche `selection` (polygone convexe en mètres locaux —
    // le rectangle tracé à l'écran, éventuellement tourné par la vue Nord-Sud). Même mécanisme que
    // deletePanelAt (deletedPanelIndicesByPan) : totaux, persistance et restauration au clic droit
    // inchangés. Retourne le nombre de panneaux supprimés.
    function deletePanelsInPolygon(selection) {
        if (!Array.isArray(selection) || selection.length < 3) return 0;
        let n = 0;
        CM.state.pans.forEach((pan) => {
            const touches = computeCandidatePanelSlots(pan)
                .filter((s) => !s.deleted && convexPolygonsIntersect(panelCornersTrue(s), selection));
            if (!touches.length) return;
            if (!CM.state.deletedPanelIndicesByPan.has(pan.id)) CM.state.deletedPanelIndicesByPan.set(pan.id, new Set());
            const set = CM.state.deletedPanelIndicesByPan.get(pan.id);
            touches.forEach((s) => set.add(s.idxKey));
            n += touches.length;
        });
        return n;
    }

    // 2026-10-09 (finition demandée : "pouvoir restaurer les panneaux avec le rectangle après
    // suppression") : pendant de deletePanelsInPolygon — tout panneau SUPPRIMÉ qui touche
    // `selection` est remis en place. Retourne le nombre de panneaux restaurés.
    function restorePanelsInPolygon(selection) {
        if (!Array.isArray(selection) || selection.length < 3) return 0;
        let n = 0;
        CM.state.pans.forEach((pan) => {
            const set = CM.state.deletedPanelIndicesByPan.get(pan.id);
            if (!set || !set.size) return;
            computeCandidatePanelSlots(pan)
                .filter((s) => s.deleted && convexPolygonsIntersect(panelCornersTrue(s), selection))
                .forEach((s) => { if (set.delete(s.idxKey)) n++; });
        });
        return n;
    }

    function restoreNearestPanelAt(pan, meterPt) {
        const deletedSet = CM.state.deletedPanelIndicesByPan.get(pan.id);
        if (!deletedSet || !deletedSet.size) return false;
        const slots = computeCandidatePanelSlots(pan).filter((s) => s.deleted);
        let best = null, bestDist = Infinity;
        slots.forEach((s) => {
            const d = Math.hypot(s.cx - meterPt.x, s.cy - meterPt.y);
            if (d < bestDist) { bestDist = d; best = s; }
        });
        if (best && bestDist < 3) {
            deletedSet.delete(best.idxKey);
            return true;
        }
        return false;
    }

    function panelCornersTrue(panel) {
        const hw = panel.w / 2, hl = panel.l / 2;
        return [
            { x: -hw, y: -hl }, { x: hw, y: -hl }, { x: hw, y: hl }, { x: -hw, y: hl }
        ].map((c) => {
            const r = rotateAroundOrigin(c, panel.angle);
            return { x: r.x + panel.cx, y: r.y + panel.cy };
        });
    }

    function computeStructureCounts(pan) {
        const angle = effectiveGridAngle(pan);
        const localPoints = pan.points.map((p) => rotateAroundOrigin(p, -angle));
        const bb = boundingBox(localPoints);
        const chevronStep = Math.max(0.05, CM.state.chevronSpacingM || 0.6);
        const panneStep = Math.max(0.05, CM.state.panneSpacingM || 1.2);
        const liteauStep = Math.max(0.02, CM.state.liteauSpacingM || 0.35);
        // CM.packPanelsForPan (pas l'appel local packPanelsForPan) : un correctif backend
        // éventuellement appliqué (cf. calepinage_maison_verif_test.js, qui n'enveloppe que la
        // propriété CM.packPanelsForPan) ne serait sinon jamais reflété dans le nombre de rails.
        const panels = CM.packPanelsForPan(pan);
        const isPaysage = CM.state.panelOrientation === 'paysage';
        const railSpacingM = 0.6 * (isPaysage ? panelWidthM() : panelLengthM());
        return {
            chevrons: Math.floor((bb.maxX - bb.minX) / chevronStep) + 1,
            pannes: Math.floor((bb.maxY - bb.minY) / panneStep) + 1,
            liteaux: Math.floor((bb.maxY - bb.minY) / liteauStep) + 1,
            rails: 2 * panels.length,
            railSpacingM,
        };
    }

    // --------------------------------------------------------------------------------------
    // Entraxes de poteaux d'ombrière — SOURCE UNIQUE de la règle (demande explicite)
    // --------------------------------------------------------------------------------------
    // Le même texte alimente trois formulaires : la section "Géométrie de la toiture" (résidentiel
    // + son miroir PRO), #postDistances des modales de géométrie / du canvas 2D, et
    // #cmOmb_postDistances du formulaire 3D. Il est stocké tel quel dans
    // CM.state.ombriereEntraxeExpr et interprété par parsePostDistancesSimple()
    // (geometrie_3D/ombriere_metal/model_single_post.js). Les trois champs partagent donc cette
    // validation-ci : une expression acceptée quelque part l'est partout.
    //
    // Jeu de caractères aligné sur le pattern HTML de #postDistances (ombriere_metal.html) :
    // chiffres, '*', '+', '.', espaces — étendu à 'x'/'X' et ',' que parsePostDistancesSimple
    // tolère déjà ("6 x 5", "3*2,5").
    const ENTRAXE_CARACTERES = /^[0-9.,*xX+\s]*$/;

    /**
     * Valide une expression d'entraxes SANS la modifier (jamais de correction silencieuse : une
     * saisie refusée reste à l'écran avec son message, comme tous les champs du formulaire).
     * Vide = valide, et signifie "auto" (cf. entraxeOmbriereAuto).
     * Renvoie { ok, expr, message }.
     */
    function validerEntraxeOmbriere(expr) {
        const brut = String(expr == null ? '' : expr);
        const net = brut.trim();
        if (!net) return { ok: true, expr: '', message: null };
        if (!ENTRAXE_CARACTERES.test(net)) {
            return { ok: false, expr: net, message: "Entraxes : seuls les chiffres, le point, ’+’ et ’*’ sont autorisés." };
        }
        // Au moins une travée exploitable, sinon la 3D et les coupes n'auraient aucun poteau.
        const travees = (typeof window.parsePostDistancesSimple === 'function')
            ? window.parsePostDistancesSimple(net, 0).length - 1
            : net.split(/[+\s]+/).filter(Boolean).length;
        if (travees < 1) {
            return { ok: false, expr: net, message: 'Entraxes : aucune travée exploitable (ex. : 4*10.5 + 2*8).' };
        }
        return { ok: true, expr: net, message: null };
    }

    /** Somme des travées d'une expression, en mètres (0 si elle n'en contient aucune). */
    function longueurEntraxeOmbriere(expr) {
        if (typeof window.parsePostDistancesSimple !== 'function') return 0;
        const positions = window.parsePostDistancesSimple(expr, 0);
        return positions.length ? positions[positions.length - 1] : 0;
    }

    /**
     * Entraxe par défaut d'une façade : travées régulières d'environ 6 m. Règle jusqu'ici
     * recopiée à trois endroits de calepinage_maison_3d_objects.js — centralisée ici pour que
     * l'auto-remplissage du champ et la 3D ne puissent pas diverger.
     */
    function entraxeOmbriereAuto(facadeLengthM) {
        const facade = Number(facadeLengthM) > 0 ? Number(facadeLengthM) : 12;
        const travees = Math.max(1, Math.round(facade / 6));
        const longueur = Math.round((facade / travees) * 100) / 100;
        return travees + '*' + longueur;
    }

    /**
     * Expression à envoyer aux trois formulaires : la saisie de l'utilisateur si elle est valide,
     * sinon l'entraxe automatique. `state` peut être un autre champ PV que celui affiché.
     */
    function entraxeOmbriereEffectif(state, facadeLengthM) {
        const st = state || CM.state || {};
        const v = validerEntraxeOmbriere(st.ombriereEntraxeExpr);
        return (v.ok && v.expr) ? v.expr : entraxeOmbriereAuto(facadeLengthM);
    }

    // --------------------------------------------------------------------------------------
    // Export vers le namespace partagé (fonctions appelées depuis dessin.js / formulaires.js)
    // --------------------------------------------------------------------------------------
    Object.assign(CM, {
        shedRegulierApplicable, domePanelsPerRow, coteDomePanneau, azimutsCotesDome, SUFFIXES_CHAMP_DOME,
        validerEntraxeOmbriere, longueurEntraxeOmbriere, entraxeOmbriereAuto, entraxeOmbriereEffectif,
        latLngToLocal, localToLatLng, boundingBox, simplifyCollinearLocal, polygonCentroid,
        normalize, computeRefAngle, computeWidthEdgeAngle, computeLengthEdgeAngle, orienterVersLeSud, applyReferenceAngleToPan, angleForAzimuth, angleReferenceStable,
        roofLocalsMatch, squareRectangleFromLocalCorner, rectFromThreePointsLocal,
        normalizeTypeMontage, isOmbriereType, effectiveEdgeClearanceM, typeMontageToPvgisMount, getAllowedPoseModes,
        EDGE_CLEARANCE_DEFAUTS_M, edgeClearanceDefautM,
        rotateAroundOrigin, metersToDisplay, displayToMeters,
        vectorFromHeading, pointInPolygon, bufferPolygonOutward,
        divideInto2PansSymmetric, divideInto2PansAsymmetric, divideInto4Pans, divideInto4PansSymmetric, resetDivision,
        ridgeAxisDir,
        obstacleCornersTrue, erodePolygonByEdgeClearances, offsetPolygonEdges, packPanelsForPan, panneauxPartagesDuPan, avecPlacementFige, deletePanelAt, deletePanelsInPolygon, restorePanelsInPolygon,
        restoreNearestPanelAt, panelCornersTrue, computeStructureCounts, panelLengthM,
        effectiveGridAngle, effectivePenteDegForPan, mesurerGrillePan,
        JOINT_DILATATION, SEPARATION_TERRASSE, jointsDilatationApplicables, paramsJointDilatation, decouperEnTroncons,
        placerColonnesAvecJoints, jointsDilatationDuPan,
    });
})();
