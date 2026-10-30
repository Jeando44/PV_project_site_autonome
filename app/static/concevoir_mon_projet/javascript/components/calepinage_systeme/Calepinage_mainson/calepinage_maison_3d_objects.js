/**
 * Calepinage résidentiel — objets de contexte 3D (Phase A).
 *
 * Réutilise TELLE QUELLE la bibliothèque d'objets Babylon existante
 * (app/static/concevoir_mon_projet/javascript/geometrie_3D/scene_objects_library.js →
 * window.OBJECT_LIBRARY). Ce fichier ne fait QUE gérer la liste d'objets posés dans la scène de la
 * maison active (CM.state.sceneObjects3D) : catalogue, ajout/suppression/mise à jour. Aucun DOM,
 * aucun Babylon ici — le maillage est fait par calepinage_maison_3d_viewer.js à partir de
 * def.build(scene, params).
 *
 * Un objet posé : { id, typeKey, x, z, rotationDeg, params }
 *   - x, z : position en MÈTRES dans le repère local de la maison (même repère que CM.state.roofLocal :
 *     x = Est, z = Nord — c.-à-d. la coordonnée `.y` d'un point de roofLocal). Le recentrage sur le
 *     centroïde du contour est fait en aval (buildResidential3DModel).
 *   - params : instantané de def.defaults, fusionné avec les réglages saisis par l'utilisateur.
 *   Tout est JSON-sérialisable → persistable via PERSISTED_STATE_FIELDS.
 *
 * Deux catalogues distincts :
 *   - getSceneObjectCatalog()  -> objets SIMPLES et autonomes (arbre, maisons, mât, poteau, blocs,
 *     toitures) — bouton « 📦 Objets 3D » du viewer.
 *   - getOmbriereCatalog(family) -> modèles d'ombrière métal OU bois (entrées `metal_*` / `bois_*` de
 *     scene_objects_library.js) — 2 boutons dédiés « ⛺ Ombrière métal » / « 🪵 Ombrière bois ».
 * Pour une ombrière posée, `params` est un instantané COMPLET du formulaire porté
 * (CM.getOmbriereDefaults) + dimensions verrouillées sur le plan 2D (facadeLength / panelWidth /
 * roofSlope, cf. ombrierePlanDims) ; la personnalisation passe par CM.renderOmbriereForm
 * (calepinage_maison_3d_ombriere_form.js) et le rendu par window.buildOmbriere3D /
 * window.buildOmbriereBois3D (appelés depuis le viewer).
 * Les familles `batiment_metal_*` / `petit_champ_solaire_*` restent exclues des deux catalogues.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    // Familles EXCLUES du catalogue « Objets 3D » (elles ont leur propre bouton, ou sont hors
    // périmètre). Les ombrières métal/bois (`metal_*` / `bois_*`) sont exposées séparément par
    // getOmbriereCatalog() — cf. les 2 boutons dédiés du viewer.
    const FAMILY_PREFIXES = ['metal_', 'bois_', 'batiment_metal_', 'petit_champ_solaire_'];
    function isFamilyKey(key) {
        return FAMILY_PREFIXES.some((p) => key.indexOf(p) === 0);
    }
    function isOmbriereKey(key) {
        return key.indexOf('metal_') === 0 || key.indexOf('bois_') === 0;
    }

    // Ordre d'affichage souhaité dans le sélecteur (les clés absentes sont ajoutées à la fin).
    const CATALOG_ORDER = [
        'tree', 'treeConifer', 'houseMono', 'houseBi', 'houseMulti', 'houseAsym', 'houseHip',
        'terrace', 'rectRoof', 'box', 'lightMast', 'pole',
    ];

    // Modèles d'ombrière par famille (repli statique si window.LIBRARY_STRUCTURE_FAMILIES absent).
    const OMBRIERE_MODELS = {
        metal: [
            { k: 'single', l: 'Centrés' }, { k: 'offset', l: 'Excentrés' }, { k: 'double', l: 'Double Poteaux' },
            { k: 'inclinedPost', l: 'Poteaux Inclinés' }, { k: 'linked', l: 'Centrés liaisonnés' },
            { k: 'y_shape', l: 'Toiture Y' }, { k: 'doubleYShape', l: 'Double toiture Y' },
        ],
        bois: [
            { k: 'inclinedPost', l: 'Gd. Monopan' }, { k: 'y_shape', l: 'Est-Ouest' }, { k: 'double', l: '2 poteaux (5m)' },
            { k: 'simple_azelan', l: 'Azélan' }, { k: 'simple_travolta', l: 'Travolta' }, { k: 'simple_travolta_2', l: 'Travolta-2' },
        ],
    };

    // Catalogue des modèles d'une famille d'ombrière : [{ key, label, shortLabel, icon, postModel }].
    function getOmbriereCatalog(family) {
        family = family === 'bois' ? 'bois' : 'metal';
        const lib = window.OBJECT_LIBRARY || {};
        const fam = (window.LIBRARY_STRUCTURE_FAMILIES && window.LIBRARY_STRUCTURE_FAMILIES[family]) || null;
        const models = (fam && Array.isArray(fam.models))
            ? fam.models.map((m) => ({ k: m.key, l: m.label }))
            : OMBRIERE_MODELS[family];
        const icon = family === 'bois' ? '🪵' : '⛺';
        return models.map((m) => {
            const key = family + '_' + m.k;
            return {
                key: key,
                postModel: m.k,
                shortLabel: m.l,
                label: (lib[key] && lib[key].label) || (family === 'bois' ? 'Ombrière Bois' : 'Ombrière Métal') + ' - ' + m.l,
                icon: (lib[key] && lib[key].icon) || icon,
            };
        });
    }

    // Construit la liste [{ key, label, icon }] des objets simples disponibles, à partir de
    // window.OBJECT_LIBRARY (peut ne pas encore être chargée au moment de l'IIFE -> getter paresseux).
    function getSceneObjectCatalog() {
        const lib = window.OBJECT_LIBRARY;
        if (!lib) return [];
        // `dessine` : objet tracé avec son propre outil (bâtiment dessiné, bouton polygone du viewer).
        const keys = Object.keys(lib).filter((k) => !isFamilyKey(k) && !(lib[k] && lib[k].dessine));
        keys.sort((a, b) => {
            const ia = CATALOG_ORDER.indexOf(a), ib = CATALOG_ORDER.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        return keys.map((k) => ({ key: k, label: lib[k].label || k, icon: lib[k].icon || '📦' }));
    }

    /**
     * Repère de l'ombrière dans le plan, calé sur la GRILLE du calepinage 2D (angle du 1er pan) :
     *   u = direction de l'égout (façade), v = (-u.y, u.x) = côté bas, tourné vers l'azimut.
     * CORRECTIF (bug rapporté : "la 3D n'a ni les dimensions ni l'azimut du champ dessiné en 2D, le
     * champ se met nord-sud") : les dimensions étaient prises sur la boîte englobante ALIGNÉE
     * Est/Nord du contour et l'ombrière posée sans rotation — un rectangle tourné de 20° donnait une
     * structure plus grande que le champ, orientée plein sud. Longueur/largeur et centre sont
     * désormais mesurés le long de u/v, et `rotationDeg` oriente la structure comme le champ.
     * Rotation Babylon (autour de Y) : axe X du générateur -> -u, axe Z (pente montante) -> -v,
     * soit le côté bas (Z-) du générateur tourné vers l'azimut — même règle que les sheds du petit
     * champ solaire (computePetitChampShedLayout).
     */
    function ombriereFrame() {
        const pts = (CM.state && CM.state.roofLocal) || [];
        const pan = (CM.state && CM.state.pans && CM.state.pans[0]) || null;
        let a = pan && isFinite(pan.angle) ? Number(pan.angle) : NaN;
        if (!isFinite(a) && pan && typeof CM.angleForAzimuth === 'function') a = CM.angleForAzimuth(Number(pan.azimuth) || 0);
        if (!isFinite(a)) a = Math.PI; // plein sud (cf. angleForAzimuth(0))
        const u = { x: Math.cos(a), y: Math.sin(a) };
        const v = { x: -u.y, y: u.x };
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        pts.forEach((p) => {
            const su = p.x * u.x + p.y * u.y, sv = p.x * v.x + p.y * v.y;
            minU = Math.min(minU, su); maxU = Math.max(maxU, su);
            minV = Math.min(minV, sv); maxV = Math.max(maxV, sv);
        });
        if (!isFinite(minU)) return { lengthU: 0, lengthV: 0, cx: 0, cy: 0, rotationDeg: 0 };
        const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
        return {
            lengthU: maxU - minU,
            lengthV: maxV - minV,
            cx: mu * u.x + mv * v.x,
            cy: mu * u.y + mv * v.y,
            rotationDeg: (Math.atan2(u.y, -u.x) * 180) / Math.PI,
        };
    }

    // Dimensions issues de la vue en plan du calepinage (verrouillées côté fenêtre d'ombrière),
    // mesurées dans le repère de la grille (cf. ombriereFrame) : longueur = le long de l'égout,
    // largeur champ PV = profondeur horizontale vers l'azimut, pente = pente effective du 1er pan
    // (sinon CM.state.penteDeg).
    function ombrierePlanDims() {
        const f = ombriereFrame();
        // Bornes de sûreté : une emprise dégénérée (polygone quasi-plat) ou démesurée ne doit pas
        // produire une structure invisible/gigantesque (bug rapporté "polygone libre : pas de 3D").
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        const r2 = (v) => Math.round(v * 100) / 100;
        let slope = Number(CM.state && CM.state.penteDeg) || 0;
        const pan = (CM.state && CM.state.pans && CM.state.pans[0]) || null;
        if (pan && typeof CM.effectivePenteDegForPan === 'function') {
            const s = CM.effectivePenteDegForPan(pan);
            if (s != null && !isNaN(s)) slope = s;
        }
        const longueur = r2(clamp(f.lengthU, 0, 1000)), largeur = r2(clamp(f.lengthV, 0, 1000));
        return {
            facadeLength: (longueur >= 1 ? longueur : 39),
            panelWidth: (largeur >= 1 ? largeur : 12.4),
            roofSlope: clamp(Math.round(slope) || 0, 0, 60),
        };
    }

    /**
     * Grille de panneaux RÉELLEMENT posée sur le plan 2D du champ courant (CM.state) : mêmes
     * panneaux que la carte et le canevas 2D (packPanelsForPan). null sans panneau posé.
     * CORRECTIF (bug rapporté : « le nombre de panneaux de la vue 3D ne correspond pas à celui de la
     * carte ») : les générateurs 3D d'ombrière dessinent une grille `pvLayout` (« 7L x 40C ») qui
     * restait à sa valeur par défaut (280 panneaux), quel que soit le calepinage.
     */
    function grillePanneauxPlan() {
        const D = window.CalepinageMaisonDimensionsOmbriere;
        if (!D || typeof D.mesurerChamp !== 'function' || !CM.state || !(CM.state.pans || []).length) return null;
        let m = null;
        try { m = D.mesurerChamp(); } catch (e) { m = null; }
        return (m && m.nbPanneaux > 0 && m.nbRangees > 0 && m.nbColonnes > 0) ? m : null;
    }

    /**
     * `pvLayout` du générateur 3D d'ombrière (« L x C », L = panneaux dans la pente, C = le long de la
     * façade) déduit de la grille 2D. Les modèles en Y répètent la grille sur chaque BRAS (2 bras pour
     * « Toiture Y », 4 pour « Double toiture Y ») : L est alors le nombre de rangées d'un bras.
     */
    function pvLayoutDuPlan(postModel) {
        const m = grillePanneauxPlan();
        if (!m) return null;
        const nbBras = postModel === 'doubleYShape' ? 4 : (postModel === 'y_shape' ? 2 : 1);
        let rangees = m.nbRangees, colonnes = m.nbColonnes;
        if (nbBras > 1) {
            // Un pan par bras (2 pans symétriques) : la grille d'un pan décrit un bras.
            if (m.parPan && m.nbPans >= nbBras) { rangees = m.parPan.rangees; colonnes = m.parPan.colonnes; }
            else rangees = Math.max(1, Math.round(m.nbRangees / nbBras));
        }
        return `${Math.max(1, rangees)}L x ${Math.max(1, colonnes)}C`;
    }

    function roofBBox() {
        const pts = CM.state.roofLocal || [];
        if (!pts.length) return { cx: 0, cy: 0, maxDim: 10 };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        pts.forEach((p) => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        let c = (typeof CM.polygonCentroid === 'function') ? CM.polygonCentroid(pts) : null;
        // Repli sur le centre de la bbox si le centroïde est dégénéré (division par une aire nulle).
        if (!c || !isFinite(c.x) || !isFinite(c.y)) c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        return { cx: c.x, cy: c.y, maxDim: Math.max(maxX - minX, maxY - minY) || 10 };
    }

    let _seq = 0;
    // Position bornée (cf. CM.SCENE_LIMITES, calepinage_maison_3d_geometry.js).
    function bornerPosition(v) {
        const max = (CM.SCENE_LIMITES && CM.SCENE_LIMITES.positionMaxM) || 250;
        const n = Number(v);
        return Math.min(max, Math.max(-max, isFinite(n) ? n : 0));
    }
    const normaliserDeg = (deg) => ((((Number(deg) || 0) % 360) + 360) % 360);
    function nextId() { return 'so3d_' + (Date.now().toString(36)) + '_' + (_seq++); }

    // Pose un objet. `pos` (facultatif) = { x, z } en mètres dans le repère local (fourni par le
    // glisser-déposer sur le canevas 3D). Sans `pos` : à côté du bâtiment, en éventail (angle d'or)
    // pour ne pas empiler les objets.
    function addSceneObject3D(typeKey, pos) {
        const lib = window.OBJECT_LIBRARY;
        if (!lib || !lib[typeKey]) return null;
        if (!Array.isArray(CM.state.sceneObjects3D)) CM.state.sceneObjects3D = [];
        const def = lib[typeKey];
        let defaults;
        if (isOmbriereKey(typeKey)) {
            // Ombrière : instantané COMPLET du formulaire porté (calepinage_maison_3d_ombriere_form.js)
            // + dimensions verrouillées sur le plan + famille/modèle déduits de la clé.
            const i = typeKey.indexOf('_');
            const family = typeKey.slice(0, i);
            const postModel = typeKey.slice(i + 1);
            const base = (typeof CM.getOmbriereDefaults === 'function') ? CM.getOmbriereDefaults(family) : {};
            const dims = ombrierePlanDims();
            // Entraxes poteaux adaptés à la longueur du plan (travées ~6 m) plutôt que la chaîne
            // "3*10 + 6" figée du formulaire d'origine (calée sur une façade de 39 m).
            // Ombrière POSÉE à la main : toujours l'entraxe AUTO — la saisie du formulaire 2D
            // (CM.state.ombriereEntraxeExpr) ne concerne que l'ombrière du formulaire.
            defaults = Object.assign({}, base, dims, {
                structureType: family, postModel: postModel,
                postDistances: CM.entraxeOmbriereAuto(dims.facadeLength),
            });
        } else {
            defaults = (typeof def.defaults === 'function') ? {} : Object.assign({}, def.defaults || {});
            if (typeof window.sanitizeSceneObjectParams === 'function') defaults = window.sanitizeSceneObjectParams(typeKey, defaults);
        }
        const bb = roofBBox();
        let x, z;
        if (pos && isFinite(pos.x) && isFinite(pos.z)) {
            x = Number(pos.x); z = Number(pos.z);
        } else {
            const n = CM.state.sceneObjects3D.length;
            const radius = bb.maxDim / 2 + 5;
            const ang = n * 2.399963229728653; // angle d'or (rad)
            x = bb.cx + Math.cos(ang) * radius;
            z = bb.cy + Math.sin(ang) * radius;
        }
        const obj = { id: nextId(), typeKey: typeKey, x: bornerPosition(x), z: bornerPosition(z), rotationDeg: 0, params: defaults };
        CM.state.sceneObjects3D.push(obj);
        persistSceneObjects3D();
        return obj;
    }

    // --- Bâtiment dessiné (bouton polygone de la vue 3D) -------------------------------------------
    const BATIMENT_DESSINE_KEY = 'batimentDessine';
    // Hauteur demandée à la fin du tracé : 0,1-100 m, 3 m par défaut (mêmes bornes que le champ
    // « Hauteur du bâtiment » de la bibliothèque, qui les réapplique à chaque enregistrement).
    const BATIMENT_DESSINE_HAUTEUR = { min: 0.1, max: 100, defaut: 3 };

    // Vrai si deux côtés NON adjacents du contour {x, z} (fermé) se croisent ou se touchent.
    function contourAutoIntersecte(pts) {
        const n = (pts || []).length;
        if (n < 4) return false;
        const orient = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        const surSegment = (a, b, p) => Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9
            && Math.min(a.z, b.z) - 1e-9 <= p.z && p.z <= Math.max(a.z, b.z) + 1e-9;
        const secants = (a, b, c, d) => {
            const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
            if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
            return (o1 === 0 && surSegment(a, b, c)) || (o2 === 0 && surSegment(a, b, d))
                || (o3 === 0 && surSegment(c, d, a)) || (o4 === 0 && surSegment(c, d, b));
        };
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (j === i + 1 || (i === 0 && j === n - 1)) continue; // côtés adjacents
                if (secants(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
            }
        }
        return false;
    }

    /**
     * Pose un bâtiment tracé au sol. `contour` : sommets {x, z} en mètres dans le repère local du
     * champ (celui des autres objets posés) ; `hauteur` : 0,1-100 m. L'objet est centré sur le
     * centroïde de l'emprise, ses sommets sont stockés relativement à ce centre (déplacement et
     * rotation identiques aux autres objets). Renvoie l'objet posé, ou null si le contour est
     * inutilisable (moins de 3 sommets, aire nulle, côtés qui se croisent).
     */
    function addBatimentDessine3D(contour, hauteur) {
        const lib = window.OBJECT_LIBRARY;
        if (!lib || !lib[BATIMENT_DESSINE_KEY] || !CM.state) return null;
        const pts = (Array.isArray(contour) ? contour : [])
            .map((p) => ({ x: Number(p && p.x), z: Number(p && p.z) }))
            .filter((p) => isFinite(p.x) && isFinite(p.z))
            .filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.z - arr[i - 1].z) >= 0.01);
        while (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.01) pts.pop();
        if (pts.length < 3 || contourAutoIntersecte(pts)) return null;
        let a = 0, cx = 0, cz = 0;
        pts.forEach((p, i) => {
            const q = pts[(i + 1) % pts.length];
            const c = p.x * q.z - q.x * p.z;
            a += c; cx += (p.x + q.x) * c; cz += (p.z + q.z) * c;
        });
        if (Math.abs(a / 2) < 0.01) return null;
        cx /= (3 * a); cz /= (3 * a);
        const x = bornerPosition(cx), z = bornerPosition(cz);
        const H = BATIMENT_DESSINE_HAUTEUR;
        const h = Number(hauteur);
        let params = {
            height: Math.min(H.max, Math.max(H.min, isFinite(h) ? h : H.defaut)),
            points: pts.map((p) => ({ x: p.x - x, z: p.z - z })),
        };
        if (typeof window.sanitizeSceneObjectParams === 'function') params = window.sanitizeSceneObjectParams(BATIMENT_DESSINE_KEY, params);
        if (!Array.isArray(CM.state.sceneObjects3D)) CM.state.sceneObjects3D = [];
        const obj = { id: nextId(), typeKey: BATIMENT_DESSINE_KEY, x, z, rotationDeg: 0, params };
        CM.state.sceneObjects3D.push(obj);
        persistSceneObjects3D();
        return obj;
    }

    // Persiste ET re-rend : sans recomputeResults(), une suppression d'objet 3D restait purement en
    // mémoire (canevas mis à jour, mais ni localStorage ni BD) — l'objet réapparaissait donc à la
    // réouverture / au rechargement (bug rapporté "l'ombrière supprimée réapparaît").
    function persistSceneObjects3D() {
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
    }

    function removeSceneObject3D(id) {
        if (!Array.isArray(CM.state.sceneObjects3D)) return;
        CM.state.sceneObjects3D = CM.state.sceneObjects3D.filter((o) => o.id !== id);
        persistSceneObjects3D();
    }

    function clearSceneObjects3D() {
        CM.state.sceneObjects3D = [];
        persistSceneObjects3D();
    }

    // --- Ombrière issue du FORMULAIRE 2D (typeMontage 'ombriere_metal' / 'ombriere_bois') ----------
    // Ce n'est PAS un objet posé dans sceneObjects3D : elle est reconstruite à chaque rendu depuis
    // CM.state (modèle + surcharges), calée sur l'emprise du plan. Le viewer la traite comme un objet
    // de scène avec l'id réservé FORM_OMBRIERE_ID ; clic droit -> fenêtre de personnalisation.
    const FORM_OMBRIERE_ID = '__cm_form_ombriere__';

    function ombriereTypeFamily() {
        const tm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(CM.state.typeMontage) : CM.state.typeMontage;
        if (tm === 'ombriere_metal') return 'metal';
        if (tm === 'ombriere_bois') return 'bois';
        return null; // 'ombriere' générique / 'ombriere_solumbra' : pas de générateur 3D pour l'instant
    }

    // Nettoie les entrées d'ombrière POSÉES manuellement (ancienne palette drag-drop, versions
    // précédentes de la fonctionnalité) : l'ombrière est désormais pilotée par le formulaire 2D —
    // toute entrée `metal_*` / `bois_*` restante dans sceneObjects3D est un doublon obsolète qui
    // s'affichait EN PLUS de l'ombrière du formulaire (bug rapporté "ombrière fantôme impossible à
    // supprimer"). Mutation sans recompute ici : la prochaine sauvegarde naturelle la persistera.
    function stripLegacyOmbriereSceneObjects() {
        if (!Array.isArray(CM.state.sceneObjects3D) || !CM.state.sceneObjects3D.length) return;
        const kept = CM.state.sceneObjects3D.filter((o) => !(o && typeof o.typeKey === 'string'
            && (o.typeKey.indexOf('metal_') === 0 || o.typeKey.indexOf('bois_') === 0)));
        if (kept.length !== CM.state.sceneObjects3D.length) CM.state.sceneObjects3D = kept;
    }

    // Couleur des panneaux choisie dans la palette du menu 3D (CM.state.panelColor3D, null = couleur
    // propre au modèle). Appliquée en DERNIER aux structures du formulaire : leur fenêtre de
    // personnalisation affiche donc cette même couleur et la renvoie inchangée à chaque modification.
    // Demande explicite : couleur par défaut = celle des panneaux sur la carte et le canevas 2D
    // (#1e293b), imposée aussi quand la palette est vide pour que d'anciens paramètres de modèle
    // enregistrés avec l'ancien bleu (#1a2659) ne le fassent pas réapparaître.
    const DEFAULT_PANEL_COLOR = '#1e293b';
    const ANCIENS_DEFAUTS_PANNEAUX = ['#1a2659', DEFAULT_PANEL_COLOR];
    function panelColorOverride() {
        const c = CM.state && CM.state.panelColor3D;
        return { panelColor: (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : DEFAULT_PANEL_COLOR };
    }

    // Couleur saisie dans une fenêtre de personnalisation -> palette du menu 3D (source unique).
    function syncPanelColorFromPatch(p) {
        if (!p || typeof p.panelColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.panelColor)) return;
        const c = CM.state && CM.state.panelColor3D;
        const courante = (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : null;
        if (courante ? courante.toLowerCase() !== p.panelColor.toLowerCase() : true) {
            // Sans couleur de palette, on n'en crée une que si la fenêtre a réellement changé la couleur
            // par défaut du modèle (sinon chaque modification figerait la couleur par défaut).
            if (!courante && ANCIENS_DEFAUTS_PANNEAUX.includes(p.panelColor.toLowerCase())) return;
            CM.state.panelColor3D = p.panelColor;
        }
    }

    // Champs COMMUNS au formulaire 2D et à la fenêtre 3D : ils vivent dans l'état canonique, PAS
    // dans `ombriereParams` — sinon les formulaires divergent, et surtout la saisie DISPARAÎT :
    // `ombriereParams` est remis à null à chaque filtrage de modèles / changement de type
    // (filtrerModelesOmbriere, calepinage_maison_formulaires.js), ce qui effaçait en silence
    // l'entraxe saisi (bug rapporté). Même principe que PETITCHAMP_COMMON_KEYS plus bas.
    // doublePostBracing : variante de contreventement V1-V6 du modèle métal « Double poteaux »,
    // choisie aussi dans le formulaire 2D / PRO (CM.state.ombriereMetalBracingVariant).
    // leftOverhang / rightOverhang : porte-à-faux synchronisés avec le formulaire PRO et la modale
    // (CM.poteauxOmbriere.implantationLongitudinale) ; purlinsPosition : pannes de l'ombrière bois
    // (CM.state.ombriereBoisPannesPosition).
    const OMBRIERE_COMMON_KEYS = ['postDistances', 'lowPointHeight', 'facadeLength', 'panelWidth', 'roofSlope', 'doublePostBracing',
        'leftOverhang', 'rightOverhang', 'purlinsPosition'];
    const VARIANTES_DOUBLE_POTEAUX_METAL = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];

    /**
     * "Hauteur structure égout (m)" pilotée par le champ "Hauteur bâtiment" du formulaire 2D
     * (CM.state.batimentHeightM) — demande explicite, limitée à l'OMBRIÈRE MÉTAL : pour le bois et
     * Solumbra, #lowPointHeight est un champ CALCULÉ (déduit de la hauteur libre de passage), il n'y
     * a rien à y imposer. null = laisser la valeur propre au formulaire 3D.
     */
    function hauteurEgoutOmbriere() {
        const tm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(CM.state.typeMontage) : CM.state.typeMontage;
        if (tm !== 'ombriere_metal') return null;
        const h = Number(CM.state.batimentHeightM);
        return (isFinite(h) && h > 0) ? h : null;
    }

    /**
     * Implantation longitudinale du champ affiché (ou null) — calculée sur la longueur de la
     * structure transmise à la modale (rail compris), pour que la 3D, la modale et le formulaire
     * affichent les MÊMES entraxes et porte-à-faux ; repli sur la longueur de la structure 3D.
     */
    function implantation3D(dims) {
        const P = CM.poteauxOmbriere;
        if (!P || typeof P.implantationLongitudinale !== 'function') return null;
        try {
            const longueur = P.longueurStructure(CM.state) || (dims && dims.facadeLength);
            return longueur > 0 ? P.implantationLongitudinale(CM.state, longueur) : null;
        } catch (e) { return null; }
    }

    // Objet de scène synthétique { id, typeKey, x, z, rotationDeg, params } ou null (type non ombrière).
    function getFormOmbriereObject() {
        const tm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(CM.state.typeMontage) : CM.state.typeMontage;
        // Dès que le projet est de type "ombrière" (y compris l'ancienne valeur générique), on purge
        // les ombrières POSÉES obsolètes (ancienne palette drag-drop) — cf. bug "ombrière fantôme".
        if (typeof tm === 'string' && tm.indexOf('ombriere') === 0) stripLegacyOmbriereSceneObjects();
        const family = ombriereTypeFamily();
        if (!family) return null;
        const postModel = family === 'bois'
            ? (CM.state.ombriereBoisModel || 'inclinedPost')
            : (CM.state.ombriereMetalModel || 'single');
        const base = (typeof CM.getOmbriereDefaults === 'function') ? CM.getOmbriereDefaults(family) : {};
        const dims = ombrierePlanDims();
        // Champs COMMUNS aux 3 formulaires (2D, modale de géométrie, 3D) : posés EN DERNIER, donc
        // au-dessus de `ombriereParams` — l'état canonique fait toujours foi, et la fenêtre 3D les y
        // renvoie (cf. OMBRIERE_COMMON_KEYS / updateFormOmbriere).
        // Entraxe automatique calé sur la PORTÉE entre poteaux d'extrémité (longueur moins les deux
        // porte-à-faux), pas sur la longueur totale : les générateurs 3D posent le premier poteau à
        // `leftOverhang` puis cumulent les travées — des travées couvrant toute la longueur feraient
        // sortir le dernier poteau de la structure. Même règle que la modale (cf. entraxePourModale,
        // calepinage_maison_dimensions_ombriere.js).
        const surcharges = CM.state.ombriereParams || {};
        const pafG = Number(surcharges.leftOverhang != null ? surcharges.leftOverhang : base.leftOverhang) || 0;
        const pafD = Number(surcharges.rightOverhang != null ? surcharges.rightOverhang : base.rightOverhang) || 0;
        const portee = (dims.facadeLength || 0) - pafG - pafD;
        const communs = {
            postDistances: CM.entraxeOmbriereEffectif(CM.state, portee > 1 ? portee : dims.facadeLength),
        };
        // Implantation commune au formulaire PRO, à la modale de géométrie et à la carte (entraxes
        // + porte-à-faux), calculée sur la longueur de la structure 3D.
        const imp = implantation3D(dims);
        if (imp) {
            communs.postDistances = imp.expr;
            communs.leftOverhang = imp.pafG;
            communs.rightOverhang = imp.pafD;
        }
        if (family === 'bois') communs.purlinsPosition = CM.state.ombriereBoisPannesPosition === 'top' ? 'top' : 'side';
        const egout = hauteurEgoutOmbriere();
        if (egout != null) communs.lowPointHeight = egout;
        if (family === 'metal') communs.doublePostBracing = CM.state.ombriereMetalBracingVariant || 'v1';
        // Entraxe transversal (Double poteaux / Centrés liaisonnés / Double toiture Y) et excentrement
        // (Poteaux excentrés) : mêmes valeurs que le formulaire 2D, la modale et la carte
        // (calepinage_maison_poteaux_ombriere.js). L'excentrement y est mesuré depuis l'égout ; le
        // générateur 3D le veut depuis le centre de la traverse, d'où la conversion.
        const P = CM.poteauxOmbriere;
        if (family === 'metal' && P) {
            const t = P.entraxeTransversal(CM.state);
            if (t) communs.postSpacing = t.valeur;
            const ex = P.excentrement(CM.state);
            if (ex) communs.postEccentricity = P.excentrementVers3D(ex, dims.panelWidth, !!surcharges.invertSlope);
        }
        // Disposition des panneaux = grille du plan 2D (même nombre que la carte et le canevas 2D),
        // jamais la valeur par défaut du formulaire ; verrouillée dans la fenêtre 3D.
        const pvLayout = pvLayoutDuPlan(postModel);
        if (pvLayout) communs.pvLayout = pvLayout;
        const params = Object.assign({}, base,
            CM.state.ombriereParams || {}, dims, { structureType: family, postModel: postModel },
            communs, panelColorOverride());
        // Centre et orientation du champ dessiné (cf. ombriereFrame), pas la boîte Est/Nord.
        const f = ombriereFrame();
        return { id: FORM_OMBRIERE_ID, typeKey: family + '_' + postModel, x: f.cx, z: f.cy, rotationDeg: f.rotationDeg, params: params };
    }

    // Modification depuis la vue 3D (clic droit) : écrit le modèle + les surcharges dans CM.state,
    // resynchronise le <select> 2D, puis relance le calcul + rendu.
    function updateFormOmbriere(patch) {
        if (!patch) return;
        let modelChanged = false;
        if (typeof patch.typeKey === 'string' && patch.typeKey) {
            const i = patch.typeKey.indexOf('_');
            const fam = patch.typeKey.slice(0, i);
            const pm = patch.typeKey.slice(i + 1);
            const curModel = fam === 'bois' ? CM.state.ombriereBoisModel : CM.state.ombriereMetalModel;
            if (pm !== curModel) {
                modelChanged = true;
                if (fam === 'bois') CM.state.ombriereBoisModel = pm;
                else CM.state.ombriereMetalModel = pm;
                const selId = fam === 'bois' ? 'calepinageMaisonOmbriereBoisModel' : 'calepinageMaisonOmbriereMetalModel';
                const sel = CM.modalBody && CM.modalBody.querySelector('#' + selId);
                if (sel && sel.value !== pm) sel.value = pm;
            }
        }
        // Changement de modèle -> on repart des défauts du nouveau modèle (les surcharges saisies
        // pour l'ancien modèle — entraxes, excentrement... — ne s'appliquent pas au nouveau et
        // faisaient diverger la 3D du modèle choisi). Sinon, on fusionne les surcharges.
        const p = (patch.params && typeof patch.params === 'object') ? patch.params : null;

        // Champs communs -> état canonique (le formulaire 2D et son miroir PRO les affichent).
        if (p) {
            const Pl = CM.poteauxOmbriere;
            const dimsPlan = ombrierePlanDims() || {};
            const impAvant = implantation3D(dimsPlan);
            // Porte-à-faux : seul celui que l'utilisateur a modifié dans la fenêtre 3D est enregistré
            // (l'autre redevient automatique) ; valeur hors règles ignorée, comme les entraxes.
            if (impAvant && Pl) {
                [['leftOverhang', 'gauche', 'pafG', 'ombrierePorteAFauxGaucheM', 'ombrierePorteAFauxDroitM'],
                 ['rightOverhang', 'droit', 'pafD', 'ombrierePorteAFauxDroitM', 'ombrierePorteAFauxGaucheM']].some(([k, cote, eff, cle, autre]) => {
                    if (!isFinite(p[k]) || Math.abs(p[k] - impAvant[eff]) < 0.005) return false;
                    const v = Pl.validerPorteAFaux(CM.state, cote, p[k], impAvant.longueur);
                    if (v.ok) { CM.state[cle] = v.valeur; CM.state[autre] = null; }
                    return true;
                });
            }
            if (typeof p.postDistances === 'string' && typeof CM.validerEntraxeOmbriere === 'function') {
                const v = (Pl && typeof Pl.validerEntraxesLongitudinaux === 'function')
                    ? Pl.validerEntraxesLongitudinaux(CM.state, p.postDistances, impAvant ? impAvant.longueur : dimsPlan.facadeLength)
                    : CM.validerEntraxeOmbriere(p.postDistances);
                // Saisie invalide : ignorée ici (la fenêtre 3D garde le texte à l'écran), l'état
                // conserve la dernière expression valable.
                if (v.ok) {
                    // N'enregistre une saisie que si elle DIFFÈRE de l'entraxe automatique : sinon la
                    // simple ouverture de la fenêtre 3D (qui pré-remplit le champ) figerait l'auto.
                    const auto = impAvant ? (impAvant.auto ? impAvant.expr : null) : CM.entraxeOmbriereAuto(dimsPlan.facadeLength);
                    if (!v.expr || v.expr === auto) CM.state.ombriereEntraxeExpr = null;
                    else if (!impAvant || v.expr !== impAvant.expr || !impAvant.auto) CM.state.ombriereEntraxeExpr = v.expr;
                }
            }
            if ((p.purlinsPosition === 'top' || p.purlinsPosition === 'side') && ombriereTypeFamily() === 'bois') {
                CM.state.ombriereBoisPannesPosition = p.purlinsPosition === 'top' ? 'top' : null;
            }
            // Hauteur égout : ombrière métal seulement (cf. hauteurEgoutOmbriere), bornes de la
            // modale de géométrie (2,5-15 m, ombriere_metal.html).
            if (hauteurEgoutOmbriere() != null && isFinite(p.lowPointHeight)) {
                CM.state.batimentHeightM = Math.min(15, Math.max(2.5, p.lowPointHeight));
            }
            if (VARIANTES_DOUBLE_POTEAUX_METAL.indexOf(p.doublePostBracing) !== -1
                && ombriereTypeFamily() === 'metal') {
                CM.state.ombriereMetalBracingVariant = p.doublePostBracing;
            }
            syncPanelColorFromPatch(p);
            // Entraxe transversal / excentrement -> état canonique (même modèle seulement : un
            // changement de modèle repart des défauts du nouveau). Valeur invalide ignorée, comme
            // l'entraxe longitudinal ; enregistrée seulement si elle diffère de la valeur effective,
            // pour que la simple ouverture de la fenêtre 3D ne fige pas un défaut.
            const P = CM.poteauxOmbriere;
            if (P && !modelChanged && ombriereTypeFamily() === 'metal') {
                const t = P.entraxeTransversal(CM.state);
                if (t && isFinite(p.postSpacing) && Math.abs(p.postSpacing - t.valeur) > 1e-6) {
                    const v = P.validerEntraxeTransversal(t.modele, p.postSpacing);
                    if (v.ok) P.ecrireEntraxeTransversal(CM.state, t.modele, v.valeur);
                }
                const ex = P.excentrement(CM.state);
                if (ex && isFinite(p.postEccentricity)) {
                    // Inversion de pente en vigueur quand la valeur a été envoyée à la fenêtre 3D
                    // (l'éventuelle nouvelle valeur n'est fusionnée dans ombriereParams que plus bas).
                    const inverse = !!(CM.state.ombriereParams || {}).invertSlope;
                    const largeur = (ombrierePlanDims() || {}).panelWidth;
                    const actuel = P.excentrementVers3D(ex, largeur, inverse);
                    if (Math.abs(p.postEccentricity - actuel) > 1e-6) {
                        const v = P.validerExcentrement(P.excentrementDepuis3D(p.postEccentricity, largeur, inverse, ex.cote));
                        if (v.ok) CM.state.ombriereExcentrementM = v.valeur;
                    }
                }
            }
        }

        if (modelChanged) {
            CM.state.ombriereParams = null;
            // Géométrie de toiture (monopente/bipente) alignée sur le nouveau modèle.
            if (typeof CM.syncOmbriereDivision === 'function') CM.syncOmbriereDivision({ suivreModele: true }); // choix explicite en 3D
        } else if (p) {
            // Ne stocker dans ombriereParams QUE les réglages propres à la 3D.
            const only3d = {};
            // postSpacing / postEccentricity : communs quand le modèle métal les utilise (cf. plus
            // haut) ; sinon (bois : postEccentricity propre à ses modèles) ils restent des réglages 3D.
            const P = CM.poteauxOmbriere;
            const communsModele = (P && ombriereTypeFamily() === 'metal')
                ? [].concat(P.entraxeTransversal(CM.state) ? ['postSpacing'] : [],
                    P.excentrement(CM.state) ? ['postEccentricity'] : [])
                : [];
            Object.keys(p).forEach((k) => {
                if (OMBRIERE_COMMON_KEYS.indexOf(k) === -1 && communsModele.indexOf(k) === -1) only3d[k] = p[k];
            });
            CM.state.ombriereParams = Object.assign({}, CM.state.ombriereParams || {}, only3d);
        }
        // Le formulaire 2D (et son miroir PRO) doivent afficher ce que la 3D vient de changer.
        if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
    }

    // --- Petit champ solaire issu du FORMULAIRE 2D (typeMontage 'champ_solaire') --------------------
    // Même principe que l'ombrière : objet de scène synthétique reconstruit à chaque rendu depuis
    // CM.state (modèle + surcharges), calé sur l'emprise du plan. Rendu par window.buildPetitChampSolaire3D.
    const FORM_PETITCHAMP_ID = '__cm_form_petitchamp__';

    function isPetitChampType() {
        const tm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(CM.state.typeMontage) : CM.state.typeMontage;
        return tm === 'champ_solaire';
    }

    // CORRECTIF (bug rapporté : "polygone libre : la 3D ne reprend pas le calepinage dessiné, elle
    // s'appuie sur le modèle d'ombrière") : la 3D répétait N sheds identiques sur toute la longueur
    // de la boîte englobante du contour, sans rapport avec les rangées réellement posées en 2D
    // (rangées de longueurs différentes, découpées par le polygone, orientées selon l'azimut). On
    // reconstruit ici un shed 3D par TABLE du calepinage 2D, à partir des panneaux réellement posés
    // (CM.packPanelsForPan, même source que le rendu 2D) :
    //   - module shed = shedPanelsPerGroup rangées consécutives (jy) ;
    //   - table = suite de colonnes (jx) contiguës dans ce module (un écart plus grand qu'un pas de
    //     panneau — bord du polygone, obstacle, "Esp. groupe de shed" — commence une nouvelle table).
    // Positions en mètres dans le repère local (x = Est, z = Nord), relatives à `origin`.
    // Retourne [] si le calepinage 2D ne produit aucun panneau shed (repli sur l'ancien rendu).
    function computePetitChampShedLayout(origin) {
        // Découpe PARTAGÉE avec l'analyse de terrain de la carte (mêmes tables, même ordre) : la 3D
        // applique ensuite le calage/la garde de chaque table par index (cf.
        // calepinage_maison_terrain_tables.js, calepinage_maison_3d_terrain.js::poserTablesPetitChamp).
        const TT = window.CalepinageMaisonTerrainTables;
        if (TT && typeof TT.tablesDuChamp === 'function') {
            const tables = TT.tablesDuChamp(CM.state);
            const layoutPartage = tables.map((t) => ({
                x: t.centre.x - origin.x, z: t.centre.y - origin.y,
                // Rotation Babylon (autour de Y) qui aligne l'axe X du générateur sur -u et son axe Z
                // (pente montante) sur -v : le côté bas du shed regarde l'azimut.
                rotationY: Math.PI - Math.atan2(t.u.y, t.u.x),
                facadeLength: Math.round(t.longueurM * 1000) / 1000,
                pvCols: t.nbColonnes,
            }));
            return layoutPartage.length <= 200 ? layoutPartage : [];
        }
        const pans = (CM.state.pans || []).filter((pan) => pan && pan.poseMode === 'shed');
        if (!pans.length || typeof CM.packPanelsForPan !== 'function') return [];
        // Même plafond que le moteur de pose (computeCandidatePanelSlots : 1-15) : à 10, un « Nb. PV
        // par shed » de 11 à 15 découpait les tables 3D autrement que le plan 2D.
        const groupSize = Math.max(1, Math.min(15, Number(CM.state.shedPanelsPerGroup) || 1));
        const spacingX = (Number(CM.state.panelSpacingXMm) || 0) / 1000;
        const layout = [];

        pans.forEach((pan) => {
            let panels = [];
            try { panels = CM.packPanelsForPan(pan) || []; } catch (e) { panels = []; }
            if (!panels.length) return;
            const a = panels[0].angle || 0;
            // u : le long de la rangée (égout). La normale v = (-u.y, u.x) pointe vers l'azimut
            // (cf. angleForAzimuth, calepinage_maison_calculs.js) : c'est le côté BAS du shed.
            const u = { x: Math.cos(a), y: Math.sin(a) };
            const w = panels[0].w;

            // Regroupement par module shed, puis par colonne dans le module.
            const modules = new Map();
            panels.forEach((p) => {
                const parts = String(p.panelIndex || '').split('-');
                const jx = parseInt(parts[0], 10), jy = parseInt(parts[1], 10);
                if (!isFinite(jx) || !isFinite(jy)) return;
                const key = Math.floor(jy / groupSize);
                if (!modules.has(key)) modules.set(key, new Map());
                const cols = modules.get(key);
                if (!cols.has(jx)) cols.set(jx, []);
                cols.get(jx).push(p);
            });

            modules.forEach((cols) => {
                const colList = [];
                cols.forEach((list) => {
                    const cx = list.reduce((s, p) => s + p.cx, 0) / list.length;
                    const cy = list.reduce((s, p) => s + p.cy, 0) / list.length;
                    colList.push({ cx, cy, s: cx * u.x + cy * u.y });
                });
                colList.sort((c1, c2) => c1.s - c2.s);

                const maxStep = w + spacingX + 0.05;
                let run = [];
                const flush = () => {
                    if (!run.length) return;
                    const cx = run.reduce((s, c) => s + c.cx, 0) / run.length;
                    const cy = run.reduce((s, c) => s + c.cy, 0) / run.length;
                    const length = (run[run.length - 1].s - run[0].s) + w;
                    layout.push({
                        x: cx - origin.x, z: cy - origin.y,
                        // Rotation Babylon (autour de Y) qui aligne l'axe X du générateur sur -u et
                        // son axe Z (pente montante) sur -v : le côté bas du shed regarde l'azimut.
                        rotationY: Math.PI - Math.atan2(u.y, u.x),
                        facadeLength: Math.round(length * 1000) / 1000,
                        pvCols: run.length,
                    });
                    run = [];
                };
                colList.forEach((c) => {
                    if (run.length && (c.s - run[run.length - 1].s) > maxStep) flush();
                    run.push(c);
                });
                flush();
            });
        });
        // Borne de sûreté (rendu) : au-delà, repli sur l'ancien rendu simplifié.
        return layout.length <= 200 ? layout : [];
    }

    function getFormPetitChampObject() {
        if (!isPetitChampType()) return null;
        const model = CM.state.petitChampModel || 'centre';
        const base = (typeof CM.getPetitChampDefaults === 'function') ? CM.getPetitChampDefaults() : {};
        const dims = ombrierePlanDims(); // { facadeLength: grand côté, panelWidth: petit côté, roofSlope }
        const over = CM.state.petitChampParams || {};

        // Entraxe poteaux (le long de la façade) adapté à la longueur du plan (~6 m/travée).
        const facadeLength = dims.facadeLength || 20;
        const bays = Math.max(1, Math.round(facadeLength / 6));
        const bayLen = Math.round((facadeLength / bays) * 100) / 100;

        // Panneau : dims du calepinage 2D si disponibles, sinon défauts.
        const petitPanelLengthMm = Number(CM.state.panelLengthMm) || base.petitPanelLengthMm || 2382;
        const petitPanelWidthMm = Number(CM.state.panelWidthMm) || base.petitPanelWidthMm || 1134;
        const isPaysage = CM.state.panelOrientation === 'paysage';
        // Nb panneaux dans le rampant d'un shed = "Nb. PV par shed" du calepinage 2D.
        const nbPanelsRampant = Math.max(1, Number(CM.state.shedPanelsPerGroup) || base.nbPanelsRampant || 2);
        const panelSpacingYMm = Number(CM.state.panelSpacingYMm) || base.panelSpacingYMm || 20;
        const shedSpacingPetit = Number(CM.state.shedSpacingM) || base.shedSpacingPetit || 2.5;
        const slopeRad = ((dims.roofSlope || 14) * Math.PI) / 180;

        // Nb de sheds répétés = nb qui tient dans la profondeur (petit côté) du plan. BORNÉ : une
        // bbox surestimée (polygone libre allongé en diagonale) produisait des centaines de sheds ->
        // rendu gelé / invisible (bug rapporté).
        const dimAlongRampantM = (isPaysage ? petitPanelWidthMm : petitPanelLengthMm) / 1000;
        const fieldDepthAlongRampant = nbPanelsRampant * dimAlongRampantM + (nbPanelsRampant - 1) * (panelSpacingYMm / 1000);
        const shedPitch = fieldDepthAlongRampant * Math.cos(slopeRad) + shedSpacingPetit;
        const availDepth = dims.panelWidth || 12;
        const nbShedPetit = Math.min(24, Math.max(1, Math.floor(availDepth / Math.max(0.5, shedPitch)) || 1));

        // Colonnes de panneaux le long de la façade (bornées de la même façon).
        const colDimM = (isPaysage ? petitPanelLengthMm : petitPanelWidthMm) / 1000;
        const pvCols = Math.min(40, Math.max(1, Math.floor(facadeLength / Math.max(0.2, colDimM)) || 1));

        // "Hauteur bas structure" : champ 2D partagé (petitChampLowPointHeightM), sinon défaut.
        const lowPointHeight = Number(CM.state.petitChampLowPointHeightM) || base.lowPointHeight || 0.8;
        const doublePostBracingVariant = CM.state.petitChampBracingVariant || 'v1';

        const bb = roofBBox();
        // Tables shed réellement posées en 2D (positions relatives au point d'ancrage bb.cx/bb.cy).
        const shedLayout = computePetitChampShedLayout({ x: bb.cx, y: bb.cy });
        // Sans table shed posée (pose non shed), la grille répétée reprend celle du plan 2D : même
        // nombre de colonnes, autant de sheds que de modules de rangées (cf. grillePanneauxPlan).
        const grille = shedLayout.length ? null : grillePanneauxPlan();
        const grilleDuPlan = grille ? {
            pvCols: Math.min(40, grille.nbColonnes),
            nbShedPetit: Math.min(24, Math.max(1, Math.round(grille.nbRangees / nbPanelsRampant))),
        } : {};

        const params = Object.assign({}, base, {
            structureType: 'petit_champ_solaire',
            postModelPetit: model,
            facadeLength: facadeLength,
            roofSlope: dims.roofSlope,
            leftOverhang: 0,
            postDistances: bays + '*' + bayLen,
            pvCols: pvCols,
            isPaysage: isPaysage,
            nbPanelsRampant: nbPanelsRampant,
            panelSpacingYMm: panelSpacingYMm,
            petitPanelLengthMm: petitPanelLengthMm,
            petitPanelWidthMm: petitPanelWidthMm,
            shedSpacingPetit: shedSpacingPetit,
            nbShedPetit: nbShedPetit,
            lowPointHeight: lowPointHeight,
        }, over, {
            // Champs COMMUNS aux 2 formulaires : toujours calés sur l'état/plan, jamais surchargés
            // par petitChampParams (nbShedPetit / pvCols / postDistances restent, eux, surchargeables
            // depuis le modal 3D — pas d'équivalent dans le formulaire 2D).
            structureType: 'petit_champ_solaire', postModelPetit: model,
            facadeLength: facadeLength, roofSlope: dims.roofSlope,
            isPaysage: isPaysage, nbPanelsRampant: nbPanelsRampant, shedSpacingPetit: shedSpacingPetit,
            panelSpacingYMm: panelSpacingYMm, petitPanelLengthMm: petitPanelLengthMm,
            petitPanelWidthMm: petitPanelWidthMm, lowPointHeight: lowPointHeight,
            doublePostBracingVariant: doublePostBracingVariant,
            shedLayout: shedLayout,
        }, grilleDuPlan, panelColorOverride());
        return { id: FORM_PETITCHAMP_ID, typeKey: 'petit_champ_solaire_' + model, x: bb.cx, z: bb.cy, rotationDeg: 0, params: params };
    }

    // Champs COMMUNS aux 2 formulaires (2D + modal 3D) : ils vivent dans l'état canonique, PAS dans
    // petitChampParams — sinon les 2 divergent (demande explicite : synchroniser les champs identiques).
    const PETITCHAMP_COMMON_KEYS = [
        'lowPointHeight', 'nbPanelsRampant', 'shedSpacingPetit', 'panelSpacingYMm',
        'petitPanelLengthMm', 'petitPanelWidthMm', 'isPaysage', 'facadeLength', 'roofSlope',
        'structureType', 'postModelPetit', 'leftOverhang', 'doublePostBracingVariant', 'shedLayout',
        // nbShedPetit / pvCols / postDistances : réglages 3D sans équivalent 2D -> restent dans petitChampParams
    ];

    function updateFormPetitChamp(patch) {
        if (!patch) return;
        let modelChanged = false;
        if (typeof patch.typeKey === 'string' && patch.typeKey.indexOf('petit_champ_solaire_') === 0) {
            const pm = patch.typeKey.slice('petit_champ_solaire_'.length);
            if (pm && pm !== CM.state.petitChampModel) {
                modelChanged = true;
                CM.state.petitChampModel = pm;
                const sel = CM.modalBody && CM.modalBody.querySelector('#calepinageMaisonPetitChampModel');
                if (sel && sel.value !== pm) sel.value = pm;
            }
        }

        const p = (patch.params && typeof patch.params === 'object') ? patch.params : null;
        if (p) {
            // Champs communs -> état canonique (le formulaire 2D les lit / affiche).
            const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
            if (isFinite(p.lowPointHeight)) CM.state.petitChampLowPointHeightM = cl(p.lowPointHeight, 0.3, 5); // Hauteur bas PV : 0,3-5 m
            if (isFinite(p.nbPanelsRampant)) CM.state.shedPanelsPerGroup = cl(Math.round(p.nbPanelsRampant), 1, 15);
            if (isFinite(p.shedSpacingPetit)) CM.state.shedSpacingM = cl(p.shedSpacingPetit, 0.3, 10);
            if (isFinite(p.panelSpacingYMm)) CM.state.panelSpacingYMm = cl(Math.round(p.panelSpacingYMm), 0, 500);
            if (isFinite(p.petitPanelLengthMm)) CM.state.panelLengthMm = Math.round(p.petitPanelLengthMm);
            if (isFinite(p.petitPanelWidthMm)) CM.state.panelWidthMm = Math.round(p.petitPanelWidthMm);
            if (typeof p.isPaysage === 'boolean') CM.state.panelOrientation = p.isPaysage ? 'paysage' : 'portrait';
            if (['v1', 'v2', 'v3', 'v4'].indexOf(p.doublePostBracingVariant) !== -1) {
                CM.state.petitChampBracingVariant = p.doublePostBracingVariant;
            }
            syncPanelColorFromPatch(p);
        }

        if (modelChanged) {
            CM.state.petitChampParams = null;
        } else if (p) {
            // Ne stocker dans petitChampParams QUE les réglages propres à la 3D.
            const only3d = {};
            Object.keys(p).forEach((k) => {
                if (PETITCHAMP_COMMON_KEYS.indexOf(k) === -1) only3d[k] = p[k];
            });
            CM.state.petitChampParams = Object.assign({}, CM.state.petitChampParams || {}, only3d);
        }

        if (typeof CM.syncPetitChampFieldsToForm === 'function') CM.syncPetitChampFieldsToForm();
        if (modelChanged && typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
    }

    // --- Obstacles 2D posés / modifiés DEPUIS la vue 3D ---------------------------------------------
    // Demande explicite : pouvoir dessiner les obstacles directement dans la 3D (notamment pour les
    // ombrières / petits champs solaires, sans passer par le canevas 2D). Source UNIQUE : l'obstacle
    // est écrit dans CM.state.obstacles, exactement comme par la palette du canevas 2D
    // (calepinage_maison_dessin.js) — il apparaît donc aussi en 2D, dans la 3D (toiture ou sol, cf.
    // calepinage_maison_3d_geometry.js) et dans le calcul d'ombrage proche.
    // Repère : `pos` = { x, z } en mètres dans le repère local du champ (z = Nord = `.y` du plan).
    function obstacleTypes() {
        const T = CM.OBSTACLE_TYPES || {};
        return Object.keys(T).map((k) => ({ key: k, label: T[k].label || k, color: T[k].color || '#6b7280' }));
    }

    function panContenant(pt) {
        return (CM.state.pans || []).find((p) => typeof CM.pointInPolygon === 'function' && CM.pointInPolygon(pt, p.points || [])) || null;
    }

    function addObstacleFrom3D(type, pos) {
        const def = CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[type];
        if (!def) return null;
        if (!Array.isArray(CM.state.obstacles)) CM.state.obstacles = [];
        const bb = roofBBox();
        const pt = (pos && isFinite(pos.x) && isFinite(pos.z))
            ? { x: bornerPosition(pos.x), y: bornerPosition(pos.z) } : { x: bb.cx, y: bb.cy };
        const pan = panContenant(pt);
        const o = {
            id: `obs_${Date.now()}_${_seq++}`, type, x: pt.x, y: pt.y,
            w: def.defaultW, h: def.defaultH, buffer: def.defaultBuffer,
            elevationM: def.defaultElevationM != null ? def.defaultElevationM : 0.3,
            angle: pan ? (pan.angle || 0) : 0,
            panId: pan ? pan.id : null,
        };
        CM.state.obstacles.push(o);
        CM.state.selectedObstacleId = o.id;
        apresModificationObstacle();
        return o;
    }

    // patch : { x?, z?, w?, h?, elevationM?, angleDeg? } — bornes du type pour la hauteur.
    function updateObstacle3D(id, patch) {
        const o = (CM.state.obstacles || []).find((x) => x.id === id);
        if (!o || !patch) return;
        const num = (v) => (v != null && isFinite(Number(v))) ? Number(v) : null;
        const L = CM.SCENE_LIMITES || { obstacleDimMinM: 0.05, obstacleDimMaxM: 50 };
        const dim = (v) => Math.min(L.obstacleDimMaxM, Math.max(L.obstacleDimMinM, v));
        if (num(patch.x) != null) o.x = bornerPosition(num(patch.x));
        if (num(patch.z) != null) o.y = bornerPosition(num(patch.z));
        if (num(patch.w) != null) o.w = dim(num(patch.w));
        if (num(patch.h) != null) o.h = dim(num(patch.h));
        if (num(patch.elevationM) != null) {
            const def = (CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[o.type]) || {};
            const lo = def.minElevationM != null ? def.minElevationM : 0.02;
            const hi = def.maxElevationM != null ? def.maxElevationM : 30;
            o.elevationM = Math.min(hi, Math.max(lo, num(patch.elevationM)));
        }
        if (num(patch.angleDeg) != null) o.angle = (normaliserDeg(num(patch.angleDeg)) * Math.PI) / 180;
        if (num(patch.x) != null || num(patch.z) != null) {
            const pan = panContenant({ x: o.x, y: o.y });
            o.panId = pan ? pan.id : null;
        }
        apresModificationObstacle();
    }

    function removeObstacle3D(id) {
        if (!Array.isArray(CM.state.obstacles)) return;
        CM.state.obstacles = CM.state.obstacles.filter((o) => o.id !== id);
        if (CM.state.selectedObstacleId === id) CM.state.selectedObstacleId = null;
        apresModificationObstacle();
    }

    // Même enchaînement que le canevas 2D après une pose : panneau de propriétés, calcul (panneaux
    // retirés sous l'obstacle, sauvegarde) et rendu 3D.
    function apresModificationObstacle() {
        if (typeof CM.updateObstaclePropertiesPanel === 'function') {
            try { CM.updateObstaclePropertiesPanel(); } catch (e) { /* panneau 2D absent */ }
        }
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
    }

    // patch : { x?, z?, rotationDeg?, typeKey?, params?: {clé: valeur} }
    function updateSceneObject3D(id, patch) {
        if (id === FORM_OMBRIERE_ID) { updateFormOmbriere(patch); return; }
        if (id === FORM_PETITCHAMP_ID) { updateFormPetitChamp(patch); return; }
        const obj = (CM.state.sceneObjects3D || []).find((o) => o.id === id);
        if (!obj || !patch) return;
        if (patch.x != null && !isNaN(patch.x)) obj.x = bornerPosition(patch.x);
        if (patch.z != null && !isNaN(patch.z)) obj.z = bornerPosition(patch.z);
        if (patch.rotationDeg != null && !isNaN(patch.rotationDeg)) obj.rotationDeg = normaliserDeg(patch.rotationDeg);
        // typeKey : changement de modèle d'ombrière depuis la fenêtre de personnalisation.
        if (typeof patch.typeKey === 'string' && patch.typeKey) obj.typeKey = patch.typeKey;
        if (patch.params && typeof patch.params === 'object') {
            obj.params = Object.assign({}, obj.params, patch.params);
            // Bornes de la bibliothèque (fields[].min/max) — pas pour les ombrières, pilotées par leur
            // propre formulaire.
            if (!isOmbriereKey(obj.typeKey) && typeof window.sanitizeSceneObjectParams === 'function') {
                obj.params = window.sanitizeSceneObjectParams(obj.typeKey, obj.params);
            }
        }
        persistSceneObjects3D();
    }

    Object.assign(CM, {
        getSceneObjectCatalog,
        getOmbriereCatalog,
        addSceneObject3D,
        addBatimentDessine3D,
        contourAutoIntersecte,
        BATIMENT_DESSINE_HAUTEUR,
        removeSceneObject3D,
        clearSceneObjects3D,
        updateSceneObject3D,
        obstacleTypes,
        addObstacleFrom3D,
        updateObstacle3D,
        removeObstacle3D,
        ombrierePlanDims,
        pvLayoutDuPlan,
        FORM_OMBRIERE_ID,
        getFormOmbriereObject,
        updateFormOmbriere,
        FORM_PETITCHAMP_ID,
        getFormPetitChampObject,
        updateFormPetitChamp,
    });
})();
