/**
 * Calepinage résidentiel — textures de toiture de la vue 3D (menu « Toit » de la barre 3D).
 *
 * Textures PROCÉDURALES (dessinées sur un canevas, aucune image externe) : ardoise, tuile, bac
 * acier, membrane bitumineuse, gravillons. Chaque texture représente un carreau de `tailleU` x
 * `tailleV` mètres, répété sur le pan. Le repère de chaque pan (repereDePan) est déduit de son plan
 * 3D : u le long de l'égout (horizontal), v en remontant la pente — les rangs de tuiles/ardoises
 * restent donc parallèles à l'égout et les nervures du bac acier suivent la pente, quel que soit
 * l'azimut du pan.
 *
 * Convention canevas : haut du canevas = amont (v croissant, texture Babylon invertY par défaut).
 *
 * Les fonctions « pures » (repereDePan, resoudreTexture, textureParDefaut) ne dépendent ni de
 * Babylon ni du DOM : tests/calepinage_maison/test_textures_toit_3d.js.
 */
(function () {
    'use strict';

    // Carreau de texture en pixels (puissance de 2 : mipmaps propres, pas de moiré de loin).
    const TAILLE_PX = 512;

    /** Générateur pseudo-aléatoire déterministe (même texture à chaque ouverture). */
    function aleatoire(graine) {
        let s = graine >>> 0;
        return () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const bornerOctet = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const rgb = (c, k) => `rgb(${bornerOctet(c[0] * k)},${bornerOctet(c[1] * k)},${bornerOctet(c[2] * k)})`;

    /** Grain fin (±amplitude) ajouté pixel à pixel — évite l'aspect « aplat » des matériaux. */
    function grain(ctx, W, H, rand, amplitude) {
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const n = (rand() - 0.5) * 2 * amplitude;
            d[i] = bornerOctet(d[i] + n);
            d[i + 1] = bornerOctet(d[i + 1] + n);
            d[i + 2] = bornerOctet(d[i + 2] + n);
        }
        ctx.putImageData(img, 0, 0);
    }

    // --- Dessins (ctx, W, H) ------------------------------------------------------------------
    // Ardoise : 4 ardoises de 30 cm par rang, pureau 22 cm, rangs décalés d'une demi-ardoise.
    function dessinerArdoise(ctx, W, H) {
        const rand = aleatoire(11);
        const base = [62, 66, 72];                            // gris ardoise foncé
        const nbCol = 4, nbRang = 4;
        const lw = W / nbCol, lh = H / nbRang;
        ctx.fillStyle = rgb(base, 0.55);                      // joints
        ctx.fillRect(0, 0, W, H);
        for (let r = 0; r < nbRang; r++) {
            const decalage = (r % 2) * lw / 2;
            for (let c = -1; c <= nbCol; c++) {
                const x = c * lw + decalage;
                const y = r * lh;
                const k = 0.90 + rand() * 0.20;
                // Dégradé vertical : bas de l'ardoise (aval) plus sombre, recouvrement du rang inférieur.
                const g = ctx.createLinearGradient(0, y, 0, y + lh);
                g.addColorStop(0, rgb(base, k * 1.06));
                g.addColorStop(0.85, rgb(base, k));
                g.addColorStop(1, rgb(base, k * 0.72));
                ctx.fillStyle = g;
                ctx.fillRect(x + 1.5, y + 1.5, lw - 3, lh - 3);
            }
        }
        grain(ctx, W, H, rand, 6);
    }

    // Tuile (romane / canal) : ondes de 20 cm, rangs de 35 cm, ombre de recouvrement en bas de rang.
    function dessinerTuile(ctx, W, H) {
        const rand = aleatoire(23);
        const base = [214, 104, 48];                          // terre cuite, tirant sur l'orange
        const nbOnde = 5, nbRang = 3;
        const lw = W / nbOnde, lh = H / nbRang;
        const img = ctx.createImageData(W, H);
        const d = img.data;
        const teinte = [];
        for (let r = 0; r < nbRang; r++) {
            teinte.push([]);
            for (let c = 0; c < nbOnde; c++) teinte[r].push(0.90 + rand() * 0.16);
        }
        for (let y = 0; y < H; y++) {
            const r = Math.floor(y / lh);
            const fy = (y - r * lh) / lh;                      // 0 = haut du rang, 1 = bas (aval)
            const ombre = fy > 0.9 ? 0.72 : (1 - 0.08 * fy);
            for (let x = 0; x < W; x++) {
                const c = Math.floor(x / lw);
                const fx = (x - c * lw) / lw;
                const courbe = 0.80 + 0.24 * Math.sin(Math.PI * fx); // bombé de la tuile
                const k = teinte[r][c] * courbe * ombre;
                const i = (y * W + x) * 4;
                d[i] = bornerOctet(base[0] * k);
                d[i + 1] = bornerOctet(base[1] * k);
                d[i + 2] = bornerOctet(base[2] * k);
                d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        grain(ctx, W, H, rand, 7);
    }

    // Bac acier : nervures trapézoïdales tous les 33 cm, parallèles à la pente (constantes en v).
    function dessinerBacAcier(ctx, W, H) {
        const rand = aleatoire(37);
        const base = [206, 209, 213];                         // acier galvanisé / gris clair
        const nbNervure = 3;
        const pas = W / nbNervure;
        // Profil d'une onde : plage basse, flanc éclairé, sommet, flanc à l'ombre.
        const profil = [
            [0.00, 0.97], [0.55, 0.97], [0.62, 1.08], [0.70, 1.03], [0.82, 1.03], [0.90, 0.82], [1.00, 0.97],
        ];
        const g = ctx.createLinearGradient(0, 0, pas, 0);
        profil.forEach(([t, k]) => g.addColorStop(t, rgb(base, k)));
        for (let n = 0; n < nbNervure; n++) {
            ctx.save();
            ctx.translate(n * pas, 0);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, pas, H);
            ctx.restore();
        }
        grain(ctx, W, H, rand, 3);
    }

    // Membrane bitumineuse : gris anthracite granuleux, lés de 1 m avec recouvrement (bande claire).
    function dessinerMembrane(ctx, W, H) {
        const rand = aleatoire(41);
        const base = [52, 54, 57];                            // bitume anthracite
        ctx.fillStyle = rgb(base, 1);
        ctx.fillRect(0, 0, W, H);
        const lRecouvrement = Math.max(4, Math.round(W * 0.08));
        ctx.fillStyle = rgb(base, 1.18);
        ctx.fillRect(W - lRecouvrement, 0, lRecouvrement, H);
        ctx.fillStyle = rgb(base, 0.7);
        ctx.fillRect(W - lRecouvrement - 2, 0, 2, H);          // bord du lé supérieur
        grain(ctx, W, H, rand, 14);
    }

    // Gravillons (lestage de toiture terrasse) : lit serré de petits cailloux roulés aux
    // teintes naturelles variées (beige, gris, ocre, blanc cassé), interstices sombres.
    function dessinerGravillons(ctx, W, H) {
        const rand = aleatoire(53);
        const pierres = [[196, 186, 166], [168, 162, 152], [212, 204, 188], [150, 138, 118],
            [226, 222, 212], [182, 164, 136], [128, 124, 120]];
        ctx.fillStyle = 'rgb(92,86,78)';
        ctx.fillRect(0, 0, W, H);
        const n = Math.round(W * H / 38);
        for (let i = 0; i < n; i++) {
            const x = rand() * W, y = rand() * H;
            const r = 3 + rand() * 4.5;                          // Ø ~6 à 15 mm (carreau de 0,5 m)
            const c = pierres[Math.floor(rand() * pierres.length)];
            const k = 0.9 + rand() * 0.18;
            const a = rand() * Math.PI;
            // Galet éclairé par le haut : dégradé du clair (haut) vers le sombre (bas).
            const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
            g.addColorStop(0, rgb(c, k * 1.12));
            g.addColorStop(1, rgb(c, k * 0.78));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * (0.65 + rand() * 0.35), a, 0, 2 * Math.PI);
            ctx.fill();
        }
        grain(ctx, W, H, rand, 5);
    }

    /**
     * Textures types. `speculaire` : reflet (bac acier légèrement brillant, le reste mat).
     * Couleurs calées sur les matériaux réels (demande explicite) : tuile terre cuite orangée,
     * bac acier gris clair, ardoise gris foncé, gravillons aux teintes de petits cailloux.
     */
    const TEXTURES = {
        ardoise: { label: 'Ardoise', tailleU: 1.20, tailleV: 0.88, speculaire: 0.10, dessiner: dessinerArdoise },
        tuile: { label: 'Tuile', tailleU: 1.00, tailleV: 1.05, speculaire: 0.04, dessiner: dessinerTuile },
        bac_acier: { label: 'Bac acier', tailleU: 1.00, tailleV: 1.00, speculaire: 0.30, dessiner: dessinerBacAcier },
        membrane: { label: 'Membrane bitumineuse', tailleU: 1.00, tailleV: 1.00, speculaire: 0.05, dessiner: dessinerMembrane },
        gravillons: { label: 'Gravillons', tailleU: 0.50, tailleV: 0.50, speculaire: 0.02, dessiner: dessinerGravillons },
    };

    /** Texture type par défaut selon le type de structure (typeMontage normalisé). */
    function textureParDefaut(typeMontage) {
        if (typeMontage === 'toiture_terrasse') return 'membrane';
        if (typeMontage === 'toiture_inclinee') return 'bac_acier';
        return 'tuile';
    }

    /**
     * Texture effective d'un pan. `choix` : null/'auto', 'photo', 'uni' ou une clé de TEXTURES.
     * Auto et photo : photo si la capture de carte couvre le pan, sinon la texture type du bâtiment.
     * @returns {'photo'|'uni'|string} clé de TEXTURES sinon
     */
    function resoudreTexture(choix, typeMontage, photoCouvre) {
        if (choix === 'uni') return 'uni';
        if (TEXTURES[choix]) return choix;
        return photoCouvre ? 'photo' : textureParDefaut(typeMontage);
    }

    /**
     * Repère de texture d'un pan (points {x, y, z}, y vertical) : renvoie p -> {u, v} en MÈTRES,
     * u horizontal le long de l'égout, v en remontant la pente (longueur vraie, pas projetée).
     * Pan plat (terrasse) : u le long de la plus longue arête. null si le polygone est dégénéré.
     */
    function repereDePan(pts) {
        if (!pts || pts.length < 3) return null;
        // Normale de Newell (robuste pour un polygone non triangulaire).
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            nx += (a.y - b.y) * (a.z + b.z);
            ny += (a.z - b.z) * (a.x + b.x);
            nz += (a.x - b.x) * (a.y + b.y);
        }
        let ln = Math.hypot(nx, ny, nz);
        if (!ln) return null;
        nx /= ln; ny /= ln; nz /= ln;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }            // normale vers le ciel

        let e;                                                    // axe u (horizontal, unitaire)
        const lh = Math.hypot(nx, nz);
        if (lh > 1e-3) {
            // La composante horizontale de la normale pointe vers l'aval ; u lui est perpendiculaire.
            e = { x: -nz / lh, y: 0, z: nx / lh };
        } else {
            let best = null, bestL = 0;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const l = Math.hypot(b.x - a.x, b.z - a.z);
                if (l > bestL) { bestL = l; best = { x: (b.x - a.x) / l, y: 0, z: (b.z - a.z) / l }; }
            }
            if (!best) return null;
            e = best;
        }
        // Axe v = n x e (dans le plan, perpendiculaire à u), orienté vers l'amont (y croissant).
        let s = { x: ny * e.z - nz * e.y, y: nz * e.x - nx * e.z, z: nx * e.y - ny * e.x };
        if (s.y < 0) s = { x: -s.x, y: -s.y, z: -s.z };
        const o = pts[0];
        return (p) => {
            const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
            return { u: dx * e.x + dy * e.y + dz * e.z, v: dx * s.x + dy * s.y + dz * s.z };
        };
    }

    /**
     * Matériau Babylon d'une texture type (cache par scène : dessiner 512² pixels à chaque
     * reconstruction de la scène serait inutile). Les UV du maillage sont en « carreaux ».
     * L'appelant ne doit PAS libérer ce matériau avec ses maillages (il est partagé et réutilisé) ;
     * s'il l'est quand même, il est redessiné à la demande suivante.
     */
    const cacheMateriaux = { scene: null, parCle: {} };
    function materiauTexture(BABYLON, scene, cle) {
        const def = TEXTURES[cle];
        if (!def) return null;
        if (cacheMateriaux.scene !== scene) {
            cacheMateriaux.scene = scene;
            cacheMateriaux.parCle = {};
        }
        const deja = cacheMateriaux.parCle[cle];
        if (deja && !deja.isDisposed) return deja.materiau;
        const tex = new BABYLON.DynamicTexture('toitTex_' + cle, { width: TAILLE_PX, height: TAILLE_PX }, scene, true);
        def.dessiner(tex.getContext(), TAILLE_PX, TAILLE_PX);
        tex.update();
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = 8;
        const m = new BABYLON.StandardMaterial('toitMat_' + cle, scene);
        m.diffuseTexture = tex;
        m.specularColor = new BABYLON.Color3(def.speculaire, def.speculaire, def.speculaire);
        // Émissif MODULÉ par la texture (et non un gris uniforme qui délave) : la teinte du matériau
        // reste fidèle même sur un pan peu éclairé, tout en gardant le modelé dû au soleil.
        m.emissiveTexture = tex;
        m.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
        m.backFaceCulling = false;
        const entree = { materiau: m, isDisposed: false };
        m.onDisposeObservable.add(() => { entree.isDisposed = true; });
        cacheMateriaux.parCle[cle] = entree;
        return m;
    }

    window.CalepinageMaison3DTexturesToit = {
        TEXTURES, textureParDefaut, resoudreTexture, repereDePan, materiauTexture,
    };
})();
