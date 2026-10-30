// ============================================================================================
// Enregistreur vectoriel des plans de coupe / façade (partagé petit champ solaire + ombrières)
// ============================================================================================
// Extrait de plan_coupe_petit_champ_solaire.js (inchangé sur le fond) pour servir aussi aux
// configurateurs d'ombrière métal, bois et Solumbra (dossier de plans « Ombrières »).
//
// Principe : rejouer les MÊMES fonctions de dessin (drawCoupe/drawFacade) avec un faux contexte
// canvas qui enregistre chaque primitive (ligne, rectangle, texte) avec ses coordonnées absolues
// déjà transformées. Le résultat est une liste d'entités en mètres réels, Y vers le haut.
// Contrat côté dessin : `if (window.__dxfCapture) window.__dxfCapture.scale = scale;` juste après
// le calcul du facteur d'échelle interne (px/mètre).
//
// window.EnregistreurVectoriel = { captureDxfEntities(drawFn, values) }

(function () {
    'use strict';
    // ---- Algèbre matricielle 2x3 : [a, b, c, d, e, f] tel que x' = a*x + c*y + e ; y' = b*x + d*y + f
    // (même convention que CanvasRenderingContext2D.transform/setTransform).
    const IDENTITY = [1, 0, 0, 1, 0, 0];

    function multiplyMatrix(m1, m2) {
        const [a1, b1, c1, d1, e1, f1] = m1;
        const [a2, b2, c2, d2, e2, f2] = m2;
        return [
            a1 * a2 + c1 * b2,
            b1 * a2 + d1 * b2,
            a1 * c2 + c1 * d2,
            b1 * c2 + d1 * d2,
            a1 * e2 + c1 * f2 + e1,
            b1 * e2 + d1 * f2 + f1
        ];
    }
    function applyMatrix(m, x, y) {
        return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
    }
    function matrixRotationRad(m) { return Math.atan2(m[1], m[0]); }
    function matrixScaleFactor(m) { return Math.hypot(m[0], m[1]); }

    // ---- Découpe d'un segment par un polygone QUELCONQUE (simple, éventuellement concave) ----
    // Le sol du terrain automatique (profil réel, cf. terrain_plans.js) n'est plus un rectangle
    // convexe : l'ancienne découpe convexe (Cyrus-Beck) y laissait des morceaux de hachure hors du sol ou en supprimait.
    // Ici : intersections avec toutes les arêtes, puis on garde les morceaux dont le milieu est
    // intérieur (règle pair-impair). Renvoie une liste de segments (vide si hors polygone).
    function pointDansPolygone(x, y, poly) {
        let dedans = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) dedans = !dedans;
        }
        return dedans;
    }
    function clipSegmentToPolygon(p0, p1, polygon) {
        if (!polygon || polygon.length < 3) return [];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const ts = [0, 1];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i], b = polygon[(i + 1) % polygon.length];
            const ex = b.x - a.x, ey = b.y - a.y;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((a.x - p0.x) * ey - (a.y - p0.y) * ex) / den;
            const u = ((a.x - p0.x) * dy - (a.y - p0.y) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
        ts.sort((m, n) => m - n);
        const morceaux = [];
        for (let k = 0; k < ts.length - 1; k++) {
            const t0 = ts[k], t1 = ts[k + 1];
            if (t1 - t0 < 1e-9) continue;
            const tm = (t0 + t1) / 2;
            if (!pointDansPolygone(p0.x + tm * dx, p0.y + tm * dy, polygon)) continue;
            const dernier = morceaux[morceaux.length - 1];
            if (dernier && Math.abs(dernier.t1 - t0) < 1e-9) dernier.t1 = t1;   // morceaux contigus fusionnés
            else morceaux.push({ t0, t1 });
        }
        return morceaux.map(({ t0, t1 }) => ({
            x1: p0.x + t0 * dx, y1: p0.y + t0 * dy, x2: p0.x + t1 * dx, y2: p0.y + t1 * dy,
        }));
    }

    // Couleurs déjà sémantiques dans petit_champ_solaire.js -> calques DXF, pour une meilleure
    // organisation en CAO (l'apparence exacte est de toute façon préservée via la vraie couleur
    // RGB, transmise en plus sur chaque entité).
    const COLOR_LAYER_MAP = {
        '#374151': 'STRUCTURE',
        '#dc2626': 'LIMITE_PARCELLAIRE',
        '#000000': 'REPERES',
        '#000': 'REPERES',
        '#f0f0f0': 'TERRAIN',
        '#f9f9f9': 'TERRAIN',
        '#cccccc': 'TERRAIN', // hachurage diagonal du sol
        // Palette de #dimension-color-group (5 options, cf. petit_champ_solaire.html) : toutes les
        // cotations/repères altimétriques utilisent appState.dimensionColor, quelle que soit la
        // couleur choisie par l'utilisateur — regroupées sur un même calque CAO "COTATIONS".
        '#0000ff': 'COTATIONS',
        '#ff0000': 'COTATIONS',
        '#ff00ff': 'COTATIONS',
        '#4169e1': 'COTATIONS',
        // Panneaux PV (strokeStyle utilisé dans petit_champ_solaire.js) - absent jusqu'ici, ce qui
        // les faisait tomber dans le calque générique DIVERS.
        '#93c5fd': 'PANNEAUX',
        // CORRECTIF (demande explicite : "les panneaux doivent être visibles sur le plan de façade"
        // du PDF vectoriel) : la bande de panneaux de la façade est remplie en rgba(67,56,202,1) —
        // couleur absente de cette table, donc calque DIVERS, et seul PANNEAUX exporte son
        // remplissage (cf. captureDxfEntities) : la bande sortait vide, et la grille des panneaux
        // (traits blancs) devenait invisible sur la page blanche. Clés écrites SANS espaces (cf.
        // _colorFor, qui normalise).
        'rgba(67,56,202,1)': 'PANNEAUX',
        'rgba(67,56,202,0.8)': 'PANNEAUX',
        'rgba(67,56,202,0.7)': 'PANNEAUX', // façade des ombrières métal/bois/Solumbra
        // Couleur actuelle des panneaux en façade/coupe (demande explicite : même teinte que la carte,
        // le canevas 2D et la 3D — #1e293b) ; les clés indigo ci-dessus restent pour les anciens dessins.
        'rgba(30,41,59,1)': 'PANNEAUX',
        'rgba(255,255,255,0.5)': 'PANNEAUX'
    };

    function hexToRgb(hex) {
        if (typeof hex !== 'string') return null;
        let h = hex.trim();
        // Certains remplissages du dessin (ex: panneaux PV) utilisent rgb()/rgba() plutôt qu'un hex
        // (cf. fillStyle = 'rgba(67, 56, 202, 0.8)' dans petit_champ_solaire.js) - sans ce cas, ils
        // retombaient sur [0,0,0] (noir) faute de correspondre à la regex hex ci-dessous.
        const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(h);
        if (rgbMatch) return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
        if (h[0] === '#') h = h.slice(1);
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    // ---- Path2D "enregistreur" : clone minimal (seules moveTo/lineTo/closePath sont utilisées
    // dans petit_champ_solaire.js, pour des quadrilatères simples — pas de courbes/arcs à gérer).
    class DxfPathRecorder {
        constructor() {
            this.points = []; // {x, y, move: bool} en coordonnées LOCALES (pré-transformation)
            // Indices (dans recorder.entities) des entités déjà émises pour ce chemin, si un fill()
            // a eu lieu avant un éventuel stroke() — cf. item 5 : le stroke() qui suit doit RECOLORER
            // ces entités (couleur de contour) plutôt que la couleur de remplissage clair d'origine.
            this._entityIndices = null;
        }
        moveTo(x, y) { this.points.push({ x, y, move: true }); }
        lineTo(x, y) { this.points.push({ x, y, move: false }); }
        closePath() { /* la fermeture est gérée via le flag "closed" au moment de l'émission */ }
        rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); }
    }

    // ---- Context2D "enregistreur" : clone minimal du sous-ensemble d'API réellement utilisé par
    // drawCoupe/drawFacade (cf. plan). Au lieu de peindre, mémorise des entités vectorielles
    // absolues (mètres réels + repère Y-up, une fois converties par captureDxfEntities).
    class DxfContextRecorder {
        constructor() {
            this.matrixStack = [];
            this.matrix = IDENTITY.slice();
            this.clipPolygon = null;   // polygone de découpe actif (points absolus), ou null
            this.clipStack = [];
            this._fillStyle = '#000000';
            this._strokeStyle = '#000000';
            this.font = '12px Arial';
            this.textAlign = 'start';
            this.textBaseline = 'alphabetic';
            this.lineWidth = 1;
            this._subpaths = [];       // chemin courant (beginPath/moveTo/lineTo) : liste de sous-chemins, points ABSOLUS déjà transformés
            this._activeSubpath = null;
            this._lastRect = null;     // dernier fillRect (x,y,w,h,indices) en attente d'un strokeRect identique (cf. item 5)
            this.entities = [];        // sortie brute (unités canvas = "scale" px/mètre, Y vers le bas) — convertie ensuite par captureDxfEntities
        }

        // fillStyle/strokeStyle : accepte les chaînes hex ; ignore silencieusement les patterns
        // (CanvasPattern retourné par createPattern) en gardant la dernière couleur connue.
        set fillStyle(v) { if (typeof v === 'string') this._fillStyle = v; }
        get fillStyle() { return this._fillStyle; }
        set strokeStyle(v) { if (typeof v === 'string') this._strokeStyle = v; }
        get strokeStyle() { return this._strokeStyle; }

        save() { this.matrixStack.push(this.matrix.slice()); this.clipStack.push(this.clipPolygon); }
        restore() {
            if (this.matrixStack.length) this.matrix = this.matrixStack.pop();
            if (this.clipStack.length) this.clipPolygon = this.clipStack.pop();
        }
        translate(tx, ty) { this.matrix = multiplyMatrix(this.matrix, [1, 0, 0, 1, tx, ty]); }
        rotate(rad) { const c = Math.cos(rad), s = Math.sin(rad); this.matrix = multiplyMatrix(this.matrix, [c, s, -s, c, 0, 0]); }
        scale(sx, sy) { this.matrix = multiplyMatrix(this.matrix, [sx, 0, 0, sy, 0, 0]); }
        // Découpe géométrique réelle (item 4, hachurage du sol) : le polygone de clip (toujours un
        // simple quadrilatère ici) est mémorisé ; chaque ligne tracée ensuite est découpée contre
        // lui dans _emitPolyline (cf. clipSegmentToPolygon), au lieu d'être ignorée.
        clip(path) {
            if (path instanceof DxfPathRecorder) {
                const subpaths = this._resolvePath2D(path);
                if (subpaths.length && subpaths[0].length >= 3) this.clipPolygon = subpaths[0];
            }
        }

        beginPath() { this._subpaths = []; this._activeSubpath = null; }
        moveTo(x, y) { this._activeSubpath = { points: [applyMatrix(this.matrix, x, y)], closed: false }; this._subpaths.push(this._activeSubpath); }
        lineTo(x, y) {
            if (!this._activeSubpath) { this.moveTo(x, y); return; }
            this._activeSubpath.points.push(applyMatrix(this.matrix, x, y));
        }
        closePath() { if (this._activeSubpath) this._activeSubpath.closed = true; }
        // rect() : sous-chemin fermé (utilisé par les configurateurs d'ombrière bois et Solumbra).
        rect(x, y, w, h) {
            this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
            this.closePath();
        }

        _colorFor(hex) {
            const rgb = hexToRgb(hex) || [0, 0, 0];
            const layer = (typeof hex === 'string' && COLOR_LAYER_MAP[hex.toLowerCase().replace(/\s+/g, '')]) || 'DIVERS';
            return { rgb, layer };
        }
        // Émet un polyligne ; si un polygone de clip est actif, découpe chaque segment contre lui
        // (plusieurs entités LINE en sortie) au lieu de l'ignorer. Retourne l'indice de l'entité
        // émise dans `entities` (pour un éventuel recolorage ultérieur, cf. item 5), ou null si rien
        // n'a été émis (hors champ) ou si la découpe a produit plusieurs morceaux (non recolorable).
        _emitPolyline(points, closed, hex) {
            if (!points || points.length < 2) return null;
            const { rgb, layer } = this._colorFor(hex);
            if (this.clipPolygon) {
                const segments = [];
                for (let i = 0; i < points.length - 1; i++) segments.push([points[i], points[i + 1]]);
                if (closed && points.length > 2) segments.push([points[points.length - 1], points[0]]);
                segments.forEach(([p0, p1]) => {
                    clipSegmentToPolygon(p0, p1, this.clipPolygon).forEach((seg) => {
                        this.entities.push({ type: 'LWPOLYLINE', points: [{ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }], closed: false, rgb, layer });
                    });
                });
                return null;
            }
            this.entities.push({ type: 'LWPOLYLINE', points: points.map(p => ({ x: p.x, y: p.y })), closed: !!closed, rgb, layer });
            return this.entities.length - 1;
        }

        _resolvePath2D(path2d) {
            // Transforme les points LOCAUX du Path2D par la matrice ACTUELLE (au moment du fill/
            // stroke) — un Path2D est indépendant du contexte tant qu'il n'est pas dessiné, comme
            // en vrai Canvas2D.
            const subpaths = [];
            let current = null;
            path2d.points.forEach(p => {
                if (p.move || !current) { current = []; subpaths.push(current); }
                current.push(applyMatrix(this.matrix, p.x, p.y));
            });
            return subpaths;
        }

        // Recolore en place une liste d'entités déjà émises (indices) — utilisé quand un stroke()
        // suit un fill() sur la même forme (cf. item 5). Ne touche que la couleur de CONTOUR
        // (rgb) : fillRgb (mémorisée par fill()/fillRect() ci-dessous, cf. _rememberFill) est
        // volontairement préservée, pour que l'export garde le remplissage ET le contour (ex:
        // panneau PV rempli en bleu clair avec une bordure plus sombre), au lieu de perdre le
        // remplissage comme le faisait l'ancienne version (v1, contour uniquement).
        _recolor(indices, hex) {
            const { rgb, layer } = this._colorFor(hex);
            (indices || []).forEach(idx => {
                const ent = this.entities[idx];
                if (!ent) return;
                ent.rgb = rgb;
                // Ne réattribue le calque que si l'entité n'a pas déjà un calque thématique reconnu
                // depuis son fill() d'origine (ex: le rectangle de sol est rempli en TERRAIN puis
                // bordé d'un contour gris '#374151' qui, sans cette garde, le reclassait par erreur
                // en STRUCTURE — lui faisant perdre l'exclusion de bbox de l'échelle auto, cf. item
                // "échelle 1/1000 illisible"). Seul le repli générique DIVERS (couleur de remplissage
                // non reconnue, ex: poteaux/panneaux dessinés dans des teintes hors palette) cède la
                // place au calque du contour.
                if (ent.layer === 'DIVERS') ent.layer = layer;
            });
        }

        // Mémorise la couleur de remplissage d'une entité tout juste émise par fill()/fillRect(),
        // AVANT qu'un éventuel stroke()/strokeRect() sur la même forme ne recolore `rgb` (contour).
        _rememberFill(indices) {
            (indices || []).forEach(idx => {
                const ent = this.entities[idx];
                if (ent && ent.fillRgb === undefined) ent.fillRgb = ent.rgb;
            });
        }

        stroke(path) {
            if (path instanceof DxfPathRecorder) {
                if (path._entityIndices) { this._recolor(path._entityIndices, this._strokeStyle); return; }
                path._entityIndices = this._resolvePath2D(path).map(pts => this._emitPolyline(pts, true, this._strokeStyle)).filter(i => i !== null);
                return;
            }
            this._subpaths.forEach(sp => this._emitPolyline(sp.points, sp.closed, this._strokeStyle));
        }
        fill(path) {
            // Un "fill" émet l'entité avec sa couleur de remplissage (mémorisée dans `fillRgb`, cf.
            // _rememberFill) ET sert de contour provisoire. Émission différée/recolorable : si un
            // stroke() suit sur le même Path2D, il RECOLORE `rgb` (contour) sans toucher `fillRgb` —
            // la couleur de contour l'emporte sur le remplissage pour le TRAIT, mais le remplissage
            // (ex: panneau PV) est conservé pour l'export (cf. captureDxfEntities -> champ `fill`).
            if (path instanceof DxfPathRecorder) {
                if (path._entityIndices) return; // déjà émis par un fill()/stroke() précédent sur ce chemin
                path._entityIndices = this._resolvePath2D(path).map(pts => this._emitPolyline(pts, true, this._fillStyle)).filter(i => i !== null);
                this._rememberFill(path._entityIndices);
                return;
            }
            const indices = this._subpaths.map(sp => this._emitPolyline(sp.points, true, this._fillStyle)).filter(i => i !== null);
            this._rememberFill(indices);
        }

        fillRect(x, y, w, h) {
            const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => applyMatrix(this.matrix, px, py));
            const idx = this._emitPolyline(pts, true, this._fillStyle);
            this._rememberFill([idx]);
            this._lastRect = { x, y, w, h, idx };
        }
        strokeRect(x, y, w, h) {
            const r = this._lastRect;
            if (r && r.x === x && r.y === y && r.w === w && r.h === h && r.idx !== null && r.idx !== undefined) {
                this._recolor([r.idx], this._strokeStyle);
                this._lastRect = null;
                return;
            }
            const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => applyMatrix(this.matrix, px, py));
            this._emitPolyline(pts, true, this._strokeStyle);
        }

        fillText(text, x, y) {
            const pos = applyMatrix(this.matrix, x, y);
            const fontSizeMatch = /(\d+(?:\.\d+)?)px/.exec(this.font);
            const fontPx = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 12;
            const { rgb, layer } = this._colorFor(this._fillStyle);
            this.entities.push({
                type: 'TEXT',
                x: pos.x, y: pos.y,
                text: String(text),
                rotationRad: matrixRotationRad(this.matrix), // signe appliqué une seule fois, au moment du flip Y global (cf. captureDxfEntities)
                heightPx: fontPx * matrixScaleFactor(this.matrix),
                align: this.textAlign, baseline: this.textBaseline,
                rgb, layer
            });
        }

        // No-ops volontaires : cosmétiques côté canvas, sans équivalent DXF utile ici.
        clearRect() {}
        setLineDash() {}
        measureText(text) { return { width: String(text).length * 6 }; }
        createPattern() { return null; }
    }

    /**
     * Rejoue drawFn (drawCoupe ou drawFacade) avec un contexte enregistreur, puis convertit les
     * primitives capturées (unités canvas, Y vers le bas) en mètres réels + repère Y vers le haut
     * (attendu par les logiciels CAO).
     */
    function captureDxfEntities(drawFn, values) {
        const recorder = new DxfContextRecorder();
        const fakeViewManager = { panX: 0, panY: 0, zoom: 1 };
        // Canvas de secours, jamais visible : drawCoupe/drawFacade appellent setupCanvas(canvas), qui
        // redimensionne canvas.width/height (ce qui EFFACE le contenu d'un <canvas> réel) et lit
        // ctx.scale(dpr,dpr) sur le VRAI contexte 2D de l'élément — passer le vrai canvas affiché à
        // l'écran effaçait donc l'aperçu après chaque export. On utilise un canvas dédié, hors-écran
        // (position fixe hors du viewport) avec une taille CSS raisonnable et fixe (1200x800, comme
        // les tuiles de la grille PDF existante) : juste assez pour que getBoundingClientRect() soit
        // non nul (setupCanvas a besoin d'une vraie taille), sans dépendre du filet de secours
        // "isGeneratingPDF" (3600x2400) qui multiplierait inutilement le nombre de lignes de
        // hachurage du sol (son pas est fixé en pixels canvas, pas en mètres).
        const scratchCanvas = document.createElement('canvas');
        scratchCanvas.style.position = 'fixed';
        scratchCanvas.style.left = '-99999px';
        scratchCanvas.style.top = '0';
        scratchCanvas.style.width = '1200px';
        scratchCanvas.style.height = '800px';
        document.body.appendChild(scratchCanvas);
        const originalPath2D = window.Path2D;
        window.Path2D = DxfPathRecorder;
        window.__dxfCapture = { scale: null };
        try {
            drawFn(scratchCanvas, recorder, fakeViewManager, values);
        } finally {
            window.Path2D = originalPath2D;
            scratchCanvas.remove();
        }
        const scale = window.__dxfCapture && window.__dxfCapture.scale;
        window.__dxfCapture = null;
        if (!scale || !Number.isFinite(scale) || scale <= 0) {
            throw new Error("Échelle introuvable (le plan n'a pas encore été calculé) : ouvrez d'abord le plan concerné.");
        }

        return recorder.entities.map(e => {
            if (e.type === 'LWPOLYLINE') {
                return {
                    type: 'LWPOLYLINE',
                    closed: e.closed,
                    layer: e.layer,
                    color: e.rgb,
                    // Remplissage plein exporté UNIQUEMENT pour les panneaux PV (seul "fond de couleur"
                    // demandé) : fillRgb est mémorisé pour TOUTE forme fill()+stroke() (poteaux, pannes,
                    // sol...), mais le propager sans filtre remplirait aussi ces formes en DXF/PDF, ce qui
                    // casserait le rendu "contour uniquement" déjà établi pour la structure (cf. ombrière
                    // métal : seul PANEL_FILL_RGB a droit à un HATCH, la structure reste en traits).
                    fill: (e.layer === 'PANNEAUX' && e.fillRgb) || null,
                    points: e.points.map(p => ({ x: p.x / scale, y: -p.y / scale }))
                };
            }
            // TEXT
            return {
                type: 'TEXT',
                layer: e.layer,
                color: e.rgb,
                x: e.x / scale,
                y: -e.y / scale,
                text: e.text,
                height: Math.max(e.heightPx / scale, 0.01),
                rotationDeg: -(e.rotationRad * 180 / Math.PI),
                align: e.align,
                baseline: e.baseline
            };
        });
    }

    window.EnregistreurVectoriel = { captureDxfEntities };
})();
