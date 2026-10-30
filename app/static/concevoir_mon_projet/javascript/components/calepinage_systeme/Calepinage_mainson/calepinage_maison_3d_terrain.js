/**
 * Calepinage résidentiel — TERRAIN de la scène 3D (Babylon) : relief réel sous le champ PV, issu de
 * la MÊME grille d'altitudes que les plans 2D (window.CalepinageMaisonTerrain : IGN en France,
 * Google ailleurs). Coupes, façades et 3D montrent donc exactement le même terrain.
 *
 * Repères (cf. calepinage_maison_3d_geometry.js) :
 *   - scène Babylon : X = Est, Y = altitude, Z = Nord, recentrée sur `model.center` (mètres locaux) ;
 *   - mètres locaux : {x, y} par rapport à `origin` (roofLocalOrigin du champ), +x Est, +y Nord.
 * Altitudes rendues RELATIVES au sol sous le centre du modèle : la structure posée à Y = 0 garde sa
 * place, et le terrain monte/descend autour d'elle.
 *
 * Conversion par sommet : Babylon -> mètres locaux -> lat/lng -> grille (Lambert-93 IGN ou lat/lng Copernicus, bilinéaire).
 * On ne suppose PAS que le Nord local et l'axe Y du Lambert-93 coïncident (convergence des méridiens
 * jusqu'à ~3° en France, soit plusieurs mètres d'erreur au bord d'un grand champ).
 *
 * Point d'entrée : window.CalepinageMaison3DTerrain
 *   { charger, solDepuisGrille, coinsZone, construireMaillage, poserPoteauxSurTerrain, viderCache }
 */
(function () {
    const CM = (window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {});

    const MARGE_M = 15;              // terrain visible au-delà de l'emprise
    const MAX_SOMMETS_COTE = 160;    // plafond de finesse du maillage (160 x 160 = 25 600 sommets)
    const PAS_MIN_M = 1;             // la grille IGN est à 1 m : inutile d'aller plus fin
    const COULEUR_SOL_NU = [0.82, 0.84, 0.80];   // terrain sans capture de carte
    const COULEUR_HORS_CAPTURE = [1, 1, 1];      // terrain au-delà de la capture : blanc (demande explicite)
    const MARGE_TEXTURE_PX = 8;                  // bordure blanche ajoutée autour de la capture

    function origineDuChamp(sourceId) {
        if (typeof CM.listerChampsCarte === 'function') {
            const champ = CM.listerChampsCarte().find((c) => !sourceId || c.sourceId === sourceId);
            if (champ && champ.origin) return champ.origin;
        }
        return (CM.state && CM.state.roofLocalOrigin) || null;
    }

    function versLatLng(origine, pt) {
        const oLat = typeof origine.lat === 'function' ? origine.lat() : origine.lat;
        const oLng = typeof origine.lng === 'function' ? origine.lng() : origine.lng;
        const mLat = 111320, mLng = mLat * Math.cos((oLat * Math.PI) / 180);
        return { lat: oLat + pt.y / mLat, lng: oLng + pt.x / mLng };
    }

    /** Demi-côté (m) de la zone de terrain autour du centre du modèle. */
    function demiZone(model) {
        const span = (model && model.span) ? model.span : 20;
        return Math.max(10, span + MARGE_M);
    }

    /** Coins {lat, lng} de la zone de terrain d'un modèle (pour demander la grille). */
    function coinsZone(model, origine) {
        const d = demiZone(model);
        const c = (model && model.center) || { x: 0, z: 0 };
        return [[-d, -d], [d, -d], [d, d], [-d, d]]
            .map(([dx, dz]) => versLatLng(origine, { x: c.x + dx, y: c.z + dz }));
    }

    /**
     * Fonction d'altitude de la scène à partir d'une grille MNT.
     * -> { altitudeEn(x, z) (m, relative au centre du modèle ; 0 hors donnée), zCentre (m absolus),
     *      source, altitudesNGF, amplitude(x0, z0, d) }
     */
    function solDepuisGrille(grille, model, origine) {
        const c = (model && model.center) || { x: 0, z: 0 };
        const T = window.CalepinageMaisonTerrain;
        const brut = (x, z) => {
            const ll = versLatLng(origine, { x: c.x + x, y: c.z + z });
            return grille.altitude(ll.lat, ll.lng);   // IGN (Lambert-93) ou Copernicus (lat/lng)
        };
        const zCentre = brut(0, 0);
        if (zCentre === null) return null;
        return {
            zCentre,
            source: grille.source,
            altitudesNGF: grille.source === 'ign',
            altitudeEn(x, z) {
                const v = brut(x, z);
                return v === null ? 0 : v - zCentre;
            },
        };
    }

    // ── Maillage ──────────────────────────────────────────────────────────────────────────────
    /**
     * Sommets/indices/UV d'un carré de terrain centré sur l'origine de la scène, `n` x `n` sommets.
     * `uv(x, z)` (optionnelle) place la texture (capture de carte) ; sans elle, UV planaires.
     * Fonction PURE (testée hors navigateur) : renvoie des tableaux prêts pour BABYLON.VertexData.
     */
    function donneesMaillage(altitudeEn, demi, n, uv) {
        const positions = [], indices = [], uvs = [];
        const pas = (2 * demi) / (n - 1);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const x = -demi + i * pas;
                const z = -demi + j * pas;
                positions.push(x, altitudeEn(x, z), z);
                const t = uv ? uv(x, z) : { u: i / (n - 1), v: j / (n - 1) };
                uvs.push(t.u, t.v);
            }
        }
        for (let j = 0; j < n - 1; j++) {
            for (let i = 0; i < n - 1; i++) {
                const a = j * n + i, b = a + 1, c2 = a + n, d = c2 + 1;
                indices.push(a, c2, b, b, c2, d);
            }
        }
        return { positions, indices, uvs, pas };
    }

    /** Nombre de sommets par côté pour une zone de `2*demi` m (pas >= PAS_MIN_M, plafonné). */
    function nbSommets(demi) {
        return Math.max(2, Math.min(MAX_SOMMETS_COTE, Math.round((2 * demi) / PAS_MIN_M) + 1));
    }

    /**
     * Coordonnées de texture d'un point (x, z) dans le quadrilatère de la capture de carte
     * (model.groundImage.corners, ordre : pixel (0,0), (w,0), (w,h), (0,h)). Le quad est un
     * parallélogramme (transformation affine) : on résout dans sa base (u le long du haut, v le long
     * du côté gauche). Hors image -> UV hors [0,1] (texture en mode CLAMP côté appelant).
     */
    function texteurDepuisQuad(corners) {
        const p0 = corners[0], p1 = corners[1], p3 = corners[3];
        const ex = { x: p1.x - p0.x, z: p1.z - p0.z };
        const ey = { x: p3.x - p0.x, z: p3.z - p0.z };
        const det = ex.x * ey.z - ex.z * ey.x;
        if (!det) return null;
        return (x, z) => {
            const rx = x - p0.x, rz = z - p0.z;
            const u = (rx * ey.z - rz * ey.x) / det;
            const v = (ex.x * rz - ex.z * rx) / det;
            // v = 0 en haut de l'image (pixel y = 0) -> UV Babylon (v vers le haut) : 1 - v.
            return { u, v: 1 - v };
        };
    }

    /** `[r, g, b]` (0-1) -> couleur CSS, pour le canevas de la texture. */
    function couleurCss(rgb) {
        return 'rgb(' + rgb.map((v) => Math.round(v * 255)).join(', ') + ')';
    }

    /**
     * CORRECTIF (bug rapporté : « la couleur de la photo est projetée sur les zones que la capture
     * ne couvre pas, ce n'est pas joli ») : en mode CLAMP, les pixels du BORD de la capture sont
     * étirés à l'infini sur tout le terrain non couvert (longues traînées colorées). On drape donc
     * la capture recopiée au centre d'un canevas rempli de BLANC : le CLAMP prolonge désormais
     * cette bordure uniforme, et le terrain hors capture reste blanc, comme avant le relief 3D.
     *
     * L'image n'occupant plus tout le canevas, `uScale/uOffset` la replacent exactement là où les UV
     * l'attendent (coordonnée échantillonnée = u * uScale + uOffset) : aucun calcul d'UV à changer.
     * Renvoie null si la capture n'est pas dessinable (appelant : texture simple, comme avant).
     */
    function textureCaptureBordee(BABYLON, scene, image) {
        const src = image.element;
        const w = Math.round(Number(image.w) || (src && (src.naturalWidth || src.width)) || 0);
        const h = Math.round(Number(image.h) || (src && (src.naturalHeight || src.height)) || 0);
        if (!src || !w || !h || typeof BABYLON.DynamicTexture !== 'function') return null;
        try {
            const p = MARGE_TEXTURE_PX, W = w + 2 * p, H = h + 2 * p;
            const tex = new BABYLON.DynamicTexture('terrainCapture', { width: W, height: H }, scene, true);
            const ctx = tex.getContext();
            ctx.fillStyle = couleurCss(COULEUR_HORS_CAPTURE);
            ctx.fillRect(0, 0, W, H);
            ctx.drawImage(src, p, p, w, h);
            tex.update();
            tex.uScale = w / W; tex.uOffset = p / W;
            tex.vScale = h / H; tex.vOffset = p / H;
            return tex;
        } catch (e) {
            return null;    // capture non dessinable (image d'une autre origine…) : repli
        }
    }

    /** Construit (ou reconstruit) le maillage de terrain dans la scène. Renvoie le mesh, ou null. */
    function construireMaillage(BABYLON, scene, sol, model, options) {
        const opts = options || {};
        const demi = demiZone(model);
        const n = nbSommets(demi);
        const image = model && model.groundImage && model.groundImage.url ? model.groundImage : null;
        const uv = image ? texteurDepuisQuad(image.corners) : null;
        const d = donneesMaillage((x, z) => sol.altitudeEn(x, z), demi, n, uv);

        const normals = [];
        BABYLON.VertexData.ComputeNormals(d.positions, d.indices, normals);
        const vd = new BABYLON.VertexData();
        vd.positions = d.positions; vd.indices = d.indices; vd.normals = normals; vd.uvs = d.uvs;
        const mesh = new BABYLON.Mesh('terrainMNT', scene);
        vd.applyToMesh(mesh);

        const mat = new BABYLON.StandardMaterial('terrainMNTMat', scene);
        let tex = null;
        if (image) {
            // Hors de la capture : blanc (bordure du canevas), et non les pixels du bord de la
            // photo étirés ; repli sur la capture brute si le canevas est impossible.
            tex = textureCaptureBordee(BABYLON, scene, image) || new BABYLON.Texture(image.url, scene);
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            mat.diffuseTexture = tex;
            mat.emissiveTexture = tex;
            mat.emissiveColor = new BABYLON.Color3(0.55, 0.55, 0.55);
        } else {
            mat.diffuseColor = new BABYLON.Color3(COULEUR_SOL_NU[0], COULEUR_SOL_NU[1], COULEUR_SOL_NU[2]);
        }
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.backFaceCulling = false;
        mesh.material = mat;
        mesh.receiveShadows = true;
        if (opts.aJeter) opts.aJeter.push(mesh, mat, tex);
        return mesh;
    }

    // ── Poteaux de longueur variable ──────────────────────────────────────────────────────────
    // Les générateurs 3D (geometrie_3D/…) nomment tous leurs poteaux avec "post" (post_1,
    // postLeft_, postInclined_, petitCentrePost_…). On les reconnaît par leur nom plutôt que de
    // modifier les 20 générateurs : chacun est ensuite allongé/raccourci jusqu'au sol réel.
    const NOM_POTEAU = /post|poteau/i;
    const ALLONGEMENT_MAX_M = 6;     // garde-fou : au-delà, on laisse le poteau tel quel
    const TOLERANCE_M = 0.01;

    /**
     * Allonge (ou raccourcit) un maillage vertical pour que son BAS atteigne `cibleY`, sa tête
     * restant exactement où elle est. Procède par itérations : pour un poteau incliné, un
     * allongement le long de son axe ne descend pas d'autant en vertical.
     */
    function etirerJusquAuSol(mesh, cibleY) {
        for (let essai = 0; essai < 3; essai++) {
            mesh.computeWorldMatrix(true);
            const boite = mesh.getBoundingInfo().boundingBox;
            const bas = boite.minimumWorld.y;
            const haut = boite.maximumWorld.y;
            const hauteur = haut - bas;
            const ecart = bas - cibleY;                    // > 0 : terrain plus bas -> allonger
            if (!(hauteur > 1e-6) || Math.abs(ecart) < TOLERANCE_M) return;
            if (Math.abs(ecart) > ALLONGEMENT_MAX_M) return;
            const facteur = (hauteur + ecart) / hauteur;
            if (!Number.isFinite(facteur) || facteur < 0.05) return;
            mesh.scaling.y *= facteur;
            mesh.computeWorldMatrix(true);
            // La tête ne doit pas bouger : on compense la moitié de l'allongement, le long de l'axe
            // propre du poteau (poteau redressé sous une table inclinée : rotation.z seule).
            const delta = haut - mesh.getBoundingInfo().boundingBox.maximumWorld.y;
            const rz = (mesh.rotation && !mesh.rotation.x && !mesh.rotation.y && mesh.rotation.z) || 0;
            mesh.position.x -= Math.sin(rz) * delta;
            mesh.position.y += Math.cos(rz) * delta;
        }
    }

    const NOM_ANCRAGE = /anchor/i;
    const PORTEE_ANCRAGE_M = 0.35;   // un plot sous le pied d'un poteau (distance horizontale)

    /**
     * Pose une structure (ombrière, petit champ…) sur le relief : chaque POTEAU descend jusqu'au
     * terrain sous sa propre position, la table et les panneaux ne bougent pas. `altitudeEn(x, z)`
     * = altitude du terrain dans le repère de la scène. options.ancrageM : partie ENTERRÉE du
     * poteau, la même pour tous quelle que soit la pente (petit champ ; 0 par défaut). Les plots
     * d'ancrage de surface (maillages « …Anchor… », case « Afficher les ancrages ») sont reposés
     * sur le sol sous eux ; un poteau qui a un plot s'arrête sur son dessus (rien d'enterré).
     * Renvoie le nombre de poteaux ajustés.
     */
    function poserPoteauxSurTerrain(root, altitudeEn, options) {
        if (!root || typeof altitudeEn !== 'function' || typeof root.getChildMeshes !== 'function') return 0;
        const ancrageM = Math.max(0, Number(options && options.ancrageM) || 0);
        const maillages = root.getChildMeshes();
        const position = (m) => (typeof m.getAbsolutePosition === 'function' ? m.getAbsolutePosition() : m.position);
        // Plots de surface : bas sur le terrain, mémorisés pour les poteaux qu'ils portent.
        const plots = [];
        maillages.filter((m) => NOM_ANCRAGE.test(m.name || '') && !NOM_POTEAU.test(m.name || '')).forEach((mesh) => {
            try {
                const p = position(mesh);
                const sol = altitudeEn(p.x, p.z);
                if (!Number.isFinite(sol) || typeof mesh.getBoundingInfo !== 'function') return;
                if (typeof mesh.computeWorldMatrix === 'function') mesh.computeWorldMatrix(true);
                const boite = mesh.getBoundingInfo().boundingBox;
                const decalage = sol - boite.minimumWorld.y;
                if (Math.abs(decalage) <= ALLONGEMENT_MAX_M) mesh.position.y += decalage;
                plots.push({ x: p.x, z: p.z, dessus: boite.maximumWorld.y + decalage });
            } catch (e) { /* plot fautif ignoré */ }
        });
        const poteaux = maillages.filter((m) => NOM_POTEAU.test(m.name || ''));
        let ajustes = 0;
        poteaux.forEach((mesh) => {
            try {
                const p = position(mesh);
                const sol = altitudeEn(p.x, p.z);
                if (!Number.isFinite(sol)) return;
                const plot = plots.find((q) => Math.hypot(q.x - p.x, q.z - p.z) <= PORTEE_ANCRAGE_M);
                etirerJusquAuSol(mesh, plot ? plot.dessus : sol - ancrageM);
                ajustes++;
            } catch (e) { /* un poteau fautif ne casse pas la scène */ }
        });
        return ajustes;
    }

    /**
     * Poteaux VERTICAUX sous une table inclinée : le pivot de la table tourne de `inclinaison`
     * autour de son axe Z local (le long de la rangée), ce qui pencherait aussi les poteaux droits.
     * Chaque poteau droit (sans rotation propre en X/Y) reçoit la rotation inverse, sa TÊTE restant
     * au même point de la table. État d'origine mémorisé (__poseOrigine) : répétable.
     */
    function redresserPoteaux(pivot, inclinaison) {
        if (!pivot || typeof pivot.getChildMeshes !== 'function') return 0;
        let n = 0;
        pivot.getChildMeshes().forEach((m) => {
            if (!NOM_POTEAU.test(m.name || '') || !m.position || !m.rotation) return;
            if (!m.__poseOrigine) {
                m.__poseOrigine = {
                    x: m.position.x, y: m.position.y, rz: m.rotation.z || 0,
                    sy: m.scaling ? m.scaling.y : 1,
                };
            }
            const o = m.__poseOrigine;
            m.position.x = o.x;
            m.position.y = o.y;
            m.rotation.z = o.rz;
            if (m.scaling) m.scaling.y = o.sy;
            if (Math.abs(m.rotation.x || 0) > 1e-9 || Math.abs(m.rotation.y || 0) > 1e-9 || Math.abs(o.rz) > 1e-9) return;
            if (!inclinaison) return;
            let demi = 0;
            try {
                const b = m.getBoundingInfo().boundingBox;
                demi = ((b.maximum.y - b.minimum.y) * (m.scaling ? m.scaling.y : 1)) / 2;
            } catch (e) { return; }
            // Axe du poteau dans le repère de la table après rotation -φ : (sin φ, cos φ) ;
            // tête gardée : centre décalé de demi · (−sin φ, 1 − cos φ).
            m.rotation.z = -inclinaison;
            m.position.x = o.x - demi * Math.sin(inclinaison);
            m.position.y = o.y + demi * (1 - Math.cos(inclinaison));
            n++;
        });
        return n;
    }

    // ── Tables de petit champ solaire : calage, garde, couleur (calcul PARTAGÉ avec la carte) ──
    const NOM_TABLE = /^petitChampTable_(\d+)$/;

    /** Rotation Babylon autour de Y : x' = x cos + z sin, z' = -x sin + z cos. */
    function tournerY(p, th) {
        const c = Math.cos(th || 0), s = Math.sin(th || 0);
        return { x: p.x * c + p.z * s, z: -p.x * s + p.z * c };
    }

    /** Point (lx, lz) du repère d'une table (pivot) -> (x, z) scène, avant toute inclinaison. */
    function versScene(maitre, pivot, lx, lz) {
        const dansPivot = tournerY({ x: lx, z: lz }, pivot.rotation.y);
        const dansMaitre = tournerY({ x: pivot.position.x + dansPivot.x, z: pivot.position.z + dansPivot.z }, maitre.rotation.y);
        return { x: maitre.position.x + dansMaitre.x, z: maitre.position.z + dansMaitre.z };
    }

    /** Profondeur HORIZONTALE d'une table (miroir de computePetitChampCommon : panelWidth · cos). */
    function profondeurTable(params) {
        const dim = (params.isPaysage ? (params.petitPanelWidthMm || 1134) : (params.petitPanelLengthMm || 2382)) / 1000;
        const n = Math.max(1, Math.round(params.nbPanelsRampant || 2));
        const largeur = n * dim + (n - 1) * ((params.panelSpacingYMm != null ? params.panelSpacingYMm : 20) / 1000);
        return largeur * Math.cos(((params.roofSlope != null ? params.roofSlope : 14) * Math.PI) / 180);
    }

    /** La racine d'un petit champ porte-t-elle des tables posables une à une ? */
    function aDesTables(maitre) {
        return !!maitre && typeof maitre.getChildren === 'function'
            && maitre.getChildren().some((p) => NOM_TABLE.test(p.name || ''));
    }

    /**
     * Pose chaque table d'un petit champ (pivots `petitChampTable_i` sous la racine : calepinage réel
     * ou sheds répétés de la bibliothèque) sur le terrain avec la règle commune
     * (CalepinageMaisonTerrainTables.analyserTable) : la table suit la pente le long de la rangée,
     * calée sur le poteau le plus contraint. Les panneaux gardent leur couleur par défaut (demande
     * explicite : pas de couleur de niveau terrain en 3D, la carte et le canevas la montrent).
     * RÉPÉTABLE (glisser-déposer) : la hauteur d'origine du pivot est mémorisée au premier appel.
     * À appeler APRÈS le positionnement et la rotation de la racine, AVANT poserPoteauxSurTerrain
     * (qui allonge ensuite les poteaux). `altitudeEn(x, z)` = altitude du terrain dans la scène ;
     * `seuils` = { gardePct, pentePct } du champ (défaut 50 % / 5 %).
     * -> { tables: [analyse | null], synthese } ou null (pas de tables / pas de calcul partagé).
     */
    function poserTablesPetitChamp(maitre, params, altitudeEn, seuils) {
        const TT = window.CalepinageMaisonTerrainTables;
        if (!maitre || !TT || !params || typeof altitudeEn !== 'function') return null;
        const layout = Array.isArray(params.shedLayout) ? params.shedLayout : [];
        const pivots = (typeof maitre.getChildren === 'function' ? maitre.getChildren() : [])
            .filter((p) => NOM_TABLE.test(p.name || ''));
        if (!pivots.length) return null;
        const D = profondeurTable(params);
        const pente = ((params.roofSlope != null ? params.roofSlope : 14) * Math.PI) / 180;
        const dimRampant = (params.isPaysage ? (params.petitPanelWidthMm || 1134) : (params.petitPanelLengthMm || 2382)) / 1000;
        const fractionPorteAFaux = Math.min(0.5, Math.max(0, (params.overhangPct != null ? Number(params.overhangPct) : 20) / 100));
        const geoBase = {
            profondeurM: D,
            porteAFauxM: fractionPorteAFaux * dimRampant * Math.cos(pente),   // = computePetitChampCommon.overhangM, horizontal
            epaisseurPanneauM: params.panelThickness != null ? Number(params.panelThickness) : 0.03,
            epaisseurStructureM: (params.beamHeight != null ? Number(params.beamHeight) : 0.10)
                + (params.purlinHeight != null ? Number(params.purlinHeight) : 0.10)
                + (params.panelThickness != null ? Number(params.panelThickness) : 0.03),
            hBasM: Number(params.lowPointHeight) || 0.8,
            tanInclinaison: Math.tan(((params.roofSlope != null ? params.roofSlope : 14) * Math.PI) / 180),
            bipente: params.postModelPetit === 'bipente',
            mode: 'pente',
        };
        const analyses = [];
        pivots.forEach((pivot) => {
            const i = Number(NOM_TABLE.exec(pivot.name)[1]);
            // Calepinage réel : longueur de CETTE table ; sheds répétés : longueur commune.
            const L = layout.length ? (layout[i] && layout[i].facadeLength) : Number(params.facadeLength);
            if (!(L > 0)) return;
            if (pivot.__terrainBaseY === undefined) pivot.__terrainBaseY = pivot.position.y;
            pivot.position.y = pivot.__terrainBaseY;
            pivot.rotation.z = 0;
            redresserPoteaux(pivot, 0);   // poteaux remis à leur état d'origine (pose répétable)
            // Repère de la table : X le long de la rangée (centré), Z vers l'ARRIÈRE (pente montante),
            // bord bas (avant) en Z = -D/2 ; d = distance depuis ce bord.
            const geo = Object.assign({ longueurM: L }, geoBase);
            // Sheds de la bibliothèque : poteaux saisis par l'utilisateur (entraxes), comme le générateur.
            if (!layout.length && params.postDistances && typeof window.parsePostDistancesSimple === 'function') {
                const xs = window.parsePostDistancesSimple(params.postDistances, Number(params.leftOverhang) || 0);
                if (Array.isArray(xs) && xs.length) geo.postesU = xs;
            }
            const sol = (uRel, d) => {
                const p = versScene(maitre, pivot, uRel, -D / 2 + d);
                const z = altitudeEn(p.x, p.z);
                return Number.isFinite(z) ? z : null;
            };
            const a = TT.analyserTable(geo, sol, seuils);
            analyses[i] = a ? Object.assign({ niveau: a.niveau }, a) : null;
            if (!a) return;
            pivot.position.y = pivot.__terrainBaseY + a.calage.zCentre;
            pivot.rotation.z = Math.atan(a.calage.pente);   // X local monte pour une pente > 0
            redresserPoteaux(pivot, pivot.rotation.z);      // la table penche, les poteaux restent d'aplomb
        });
        return { tables: analyses, synthese: TT.synthese(analyses.filter(Boolean).map((a) => ({ analyse: a, niveau: a.niveau }))) };
    }

    // ── Chargement (une grille par champ, mémorisée) ──────────────────────────────────────────
    let cache = { cle: null, sol: null };

    /**
     * Charge le terrain du champ affiché et renvoie sa fonction d'altitude (ou null : pas de service,
     * pas de contour, ou terrain indisponible — la scène garde alors son sol plat).
     */
    async function charger(model, sourceId) {
        const T = window.CalepinageMaisonTerrain;
        if (!T || !model) return null;
        const origine = origineDuChamp(sourceId);
        if (!origine) return null;
        const cle = [sourceId || (CM.state && CM.state.sourceId) || '', Math.round(demiZone(model)),
            Math.round((model.center || {}).x || 0), Math.round((model.center || {}).z || 0)].join('|');
        if (cache.cle === cle) return cache.sol;
        let grille = null;
        try {
            grille = await T.grillePourPoints(coinsZone(model, origine), { margeM: 10 });
        } catch (e) {
            cache = { cle, sol: null };   // hors France, IGN indisponible… : sol plat, sans réessai en boucle
            return null;
        }
        const sol = solDepuisGrille(grille, model, origine);
        cache = { cle, sol };
        return sol;
    }

    function viderCache() { cache = { cle: null, sol: null }; }

    window.CalepinageMaison3DTerrain = {
        charger, viderCache, solDepuisGrille, coinsZone, construireMaillage, poserPoteauxSurTerrain,
        poserTablesPetitChamp, aDesTables,
        // Réutilisés par le viewer pour draper la capture sur les pans de toiture.
        texteurDepuisQuad, textureCaptureBordee,
        _pur: { donneesMaillage, texteurDepuisQuad, nbSommets, demiZone, versLatLng, etirerJusquAuSol, redresserPoteaux, versScene, profondeurTable,
            textureCaptureBordee },
    };
})();
