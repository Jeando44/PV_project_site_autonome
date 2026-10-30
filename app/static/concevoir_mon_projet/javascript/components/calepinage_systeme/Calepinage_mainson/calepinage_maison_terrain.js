/**
 * Calepinage résidentiel — terrain (MNT) : profils altimétriques automatiques des plans de façade
 * et de coupe d'un champ PV, et source unique des altitudes pour la 3D.
 *
 * ── Sources ───────────────────────────────────────────────────────────────────────────────────
 * - France (window.ACTIVE_PROJECT_PAYS === 'France', ou inconnu) : grille IGN RGE ALTI servie par
 *   POST /api/terrain/grille (app/routes/terrain_routes.py, cache disque côté serveur). UNE grille
 *   par champ : toutes les lignes (façades, coupe) y sont interpolées, donc cohérentes entre elles
 *   et avec la 3D. Altitudes NGF-IGN69, mention « © IGN – RGE ALTI® ».
 * - Hors France, DROM, ou IGN indisponible : Copernicus DEM GLO-30 (libre, pas de 30 m, modèle de
 *   SURFACE), même route avec `source: 'copernicus'`, grille en lat/lng (cf. copernicus.py). Une
 *   grille par champ comme l'IGN, donc relief 3D aussi hors de France.
 * - Dernier recours (Copernicus indisponible ou en mer) : Google Elevation
 *   (google.maps.ElevationService), une requête par ligne, gardée en MÉMOIRE seulement (les
 *   conditions Google en limitent le stockage). Hors IGN, `altitudesNGF` vaut false.
 *
 * ── Géométrie ─────────────────────────────────────────────────────────────────────────────────
 * Les rangées viennent de CalepinageMaisonDimensionsPetitChamp.mesurerSheds() (grille réellement
 * posée), dans le repère REDRESSÉ (u le long des rangées, v en travers, +v = côté où regardent les
 * panneaux = bord bas « avant »).
 * - Façade d'une rangée : ligne le long de u, à v = axe central de la table (défaut), ou bord
 *   avant / arrière (option `ligneFacade`, avec un `retraitM` éventuel vers l'intérieur).
 * - Coupe : ligne le long de v, à l'abscisse u qui traverse le PLUS de rangées ; à égalité, la
 *   plus proche du milieu du champ.
 *
 * - Lignes TRACÉES par l'utilisateur (outil « Profil altimétrique » de la carte, bouton « Utiliser
 *   pour les plans ») : `state.terrainLignesPlans = { coupe: {a, b, nom}, facade: {a, b, nom} }`,
 *   persisté avec le champ. Si présente, elle REMPLACE la ligne automatique du plan ; la position des
 *   rangées le long de la ligne est obtenue par projection (ligne éventuellement oblique).
 *
 * La conversion WGS84 -> Lambert-93 est faite ici (formules IGN, ellipsoïde GRS80) : parité avec
 * pyproj vérifiée par tests/terrain/test_terrain_js.py (< 1 mm).
 *
 * Point d'entrée : window.CalepinageMaisonTerrain
 *   { versLambert93, GrilleMNT, decoderGrille, interpolerProfil, penteSurFenetre, sourcePreferee,
 *     grillePourPoints, profil, profils, lignesChamp, profilsChamp, viderCache,
 *     champsDisponibles, lignesPerso, affecterLigne, retirerLigne }
 */
(function () {
    const CM = (window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {});

    const URL_GRILLE = '/concevoir_mon_projet/api/terrain/grille';
    const MARGE_GRILLE_M = 20;
    const ATTRIBUTION_IGN = '© IGN – RGE ALTI®';
    const GOOGLE_MAX_ECHANTILLONS = 512;
    const CODES_REPLI = ['hors_domaine_ign', 'donnees_absentes', 'ign_indisponible',
        'copernicus_indisponible', 'emprise_trop_grande'];
    const M_PAR_DEGRE = 111320;   // = copernicus.py, CM.latLngToLocal

    // ── Lambert-93 (IGN, notes techniques ALG0001/ALG0003 ; constantes publiées de la projection)
    const L93 = {
        e: 0.0818191910428158,
        n: 0.725607765053267,
        C: 11754255.426096,
        lambda0: (3 * Math.PI) / 180,
        Xs: 700000,
        Ys: 12655612.049876,
    };

    function versLambert93(lat, lng) {
        const phi = (lat * Math.PI) / 180;
        const esin = L93.e * Math.sin(phi);
        const L = Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - esin) / (1 + esin), L93.e / 2));
        const r = L93.C * Math.exp(-L93.n * L);
        const gamma = L93.n * ((lng * Math.PI) / 180 - L93.lambda0);
        return { x: L93.Xs + r * Math.sin(gamma), y: L93.Ys - r * Math.cos(gamma) };
    }

    // ── Grille (miroir de app/services/terrain/mnt.py::GrilleMNT) ─────────────────────────────
    /**
     * z[ligne * largeur + colonne], ligne 0 = bord NORD ; valeur au CENTRE du pixel ; NaN = sans
     * donnée. Axes Lambert-93 (IGN, `res` en m) ou géographiques (crs 'EPSG:4326', Copernicus :
     * x = lng, y = lat, `resX`/`resY` en degrés, miroir de copernicus.py::GrilleGeo).
     */
    class GrilleMNT {
        constructor(opts) {
            this.z = opts.z;
            this.largeur = opts.largeur;
            this.hauteur = opts.hauteur;
            this.xmin = opts.xmin;
            this.ymax = opts.ymax;
            this.crs = opts.crs || 'EPSG:2154';
            this.res = opts.res;
            this.resX = opts.resX || opts.res;
            this.resY = opts.resY || opts.res;
            this.source = opts.source || 'ign';
            this.attribution = opts.attribution || (this.source === 'ign' ? ATTRIBUTION_IGN : '');
        }

        get geographique() { return this.crs === 'EPSG:4326'; }
        get xmax() { return this.xmin + this.largeur * this.resX; }
        get ymin() { return this.ymax - this.hauteur * this.resY; }

        /** {lat, lng} -> coordonnées de la grille. */
        projeter(lat, lng) {
            return this.geographique ? { x: lng, y: lat } : versLambert93(lat, lng);
        }

        /** Le point est-il dans la grille, avec au moins `margeM` de marge ? */
        couvre(lat, lng, margeM) {
            const p = this.projeter(lat, lng);
            let mx = margeM || 0, my = mx;
            if (this.geographique) {
                my = mx / M_PAR_DEGRE;
                mx = mx / (M_PAR_DEGRE * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
            }
            return p.x >= this.xmin + mx && p.x <= this.xmax - mx && p.y >= this.ymin + my && p.y <= this.ymax - my;
        }

        /** Interpolation bilinéaire entre centres de pixels, en coordonnées de la grille ; null hors
         *  grille ou sans donnée. */
        altitudeXY(x, y) {
            let c = (x - this.xmin) / this.resX - 0.5;
            let l = (this.ymax - y) / this.resY - 0.5;
            if (c < -0.5 || l < -0.5 || c > this.largeur - 0.5 || l > this.hauteur - 0.5) return null;
            c = Math.min(Math.max(c, 0), this.largeur - 1);
            l = Math.min(Math.max(l, 0), this.hauteur - 1);
            const c0 = Math.floor(c), l0 = Math.floor(l);
            const c1 = Math.min(c0 + 1, this.largeur - 1), l1 = Math.min(l0 + 1, this.hauteur - 1);
            const fc = c - c0, fl = l - l0;
            const v00 = this.z[l0 * this.largeur + c0], v01 = this.z[l0 * this.largeur + c1];
            const v10 = this.z[l1 * this.largeur + c0], v11 = this.z[l1 * this.largeur + c1];
            if (![v00, v01, v10, v11].every(Number.isFinite)) return null;
            const haut = v00 * (1 - fc) + v01 * fc;
            const bas = v10 * (1 - fc) + v11 * fc;
            return haut * (1 - fl) + bas * fl;
        }

        /** Grille IGN : altitude au point Lambert-93 (x, y). */
        altitudeL93(x, y) {
            return this.altitudeXY(x, y);
        }

        altitude(lat, lng) {
            const p = this.projeter(lat, lng);
            return this.altitudeXY(p.x, p.y);
        }

        /** Profil a -> b ({lat, lng}) : [{s (m depuis a), z (m ou null)}], un point tous les `pas` m. */
        profil(a, b, pas) {
            const pa = this.projeter(a.lat, a.lng), pb = this.projeter(b.lat, b.lng);
            // Géographique : longueur en m sur le plan tangent (segments de quelques centaines de m).
            const kx = this.geographique ? M_PAR_DEGRE * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) : 1;
            const ky = this.geographique ? M_PAR_DEGRE : 1;
            const longueur = Math.hypot((pb.x - pa.x) * kx, (pb.y - pa.y) * ky);
            const n = Math.max(1, Math.ceil(longueur / (pas || 1) - 1e-6));
            const stations = [];
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                stations.push({
                    s: longueur * t,
                    z: this.altitudeXY(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t),
                });
            }
            return stations;
        }
    }

    function base64VersOctets(b64) {
        const bin = atob(b64);
        const octets = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
        return octets;
    }

    /** Réponse de /api/terrain/grille -> GrilleMNT (cf. grille_cache.py::encoder_grille). */
    function decoderGrille(json) {
        const n = json.largeur * json.hauteur;
        const vue = new DataView(base64VersOctets(json.donnees).buffer);
        const z = new Float64Array(n);
        if (json.encodage === 'u16cm') {
            for (let i = 0; i < n; i++) {
                const v = vue.getUint16(i * 2, true);
                z[i] = v === 65535 ? NaN : json.zmin + v / 100;
            }
        } else if (json.encodage === 'f32') {
            for (let i = 0; i < n; i++) z[i] = vue.getFloat32(i * 4, true);
        } else {
            throw new Error('Encodage de grille inconnu : ' + json.encodage);
        }
        return new GrilleMNT({
            z, largeur: json.largeur, hauteur: json.hauteur, xmin: json.xmin, ymax: json.ymax,
            crs: json.crs, res: json.res, resX: json.res_x, resY: json.res_y,
            source: json.source, attribution: json.attribution,
        });
    }

    // ── Outils de profil ───────────────────────────────────────────────────────────────────────
    /** Altitude à l'abscisse s (interpolation linéaire entre stations valides) ; null si hors profil. */
    function interpolerProfil(stations, s) {
        const valides = stations.filter((p) => Number.isFinite(p.z));
        if (!valides.length || s < valides[0].s - 1e-9 || s > valides[valides.length - 1].s + 1e-9) return null;
        for (let i = 1; i < valides.length; i++) {
            if (s <= valides[i].s) {
                const a = valides[i - 1], b = valides[i];
                const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
                return a.z + (b.z - a.z) * t;
            }
        }
        return valides[valides.length - 1].z;
    }

    /**
     * Pente max (en %) mesurée entre deux points distants de `fenetreM` (ex. l'entraxe des poteaux
     * ou la longueur d'une table). À 1 m, un talus ou un fossé donne 50-70 % ; c'est à l'échelle de
     * la structure que se juge la tolérance de 3-5 %.
     */
    function penteSurFenetre(stations, fenetreM) {
        const valides = stations.filter((p) => Number.isFinite(p.z));
        if (valides.length < 2 || !(fenetreM > 0)) return null;
        const fin = valides[valides.length - 1].s;
        let max = { penteMaxPct: 0, s: valides[0].s };
        valides.forEach((p) => {
            if (p.s + fenetreM > fin + 1e-9) return;
            const z2 = interpolerProfil(valides, p.s + fenetreM);
            const pente = Math.abs(z2 - p.z) / fenetreM * 100;
            if (pente > max.penteMaxPct) max = { penteMaxPct: pente, s: p.s };
        });
        return max;
    }

    // ── Choix de la source ─────────────────────────────────────────────────────────────────────
    /** Pays du projet ACTIF (context processor serveur, cf. parametre.html) ; vide = inconnu -> IGN tenté. */
    function sourcePreferee() {
        const pays = String(window.ACTIVE_PROJECT_PAYS || '').trim();
        return !pays || pays === 'France' ? 'ign' : 'google';
    }

    // ── Grilles IGN (cache mémoire au-dessus du cache disque serveur) ─────────────────────────
    let grilles = [];
    const enCours = new Map();

    function erreurTerrain(code, message) {
        const e = new Error(message || code);
        e.code = code;
        return e;
    }

    /**
     * Grille couvrant les points : IGN en France (repli Copernicus si hors domaine / indisponible),
     * Copernicus ailleurs. options.source force une source ('ign' | 'copernicus').
     */
    async function grillePourPoints(points, options) {
        const forcee = options && options.source;
        if (forcee) return grilleDeSource(points, options, forcee);
        if (sourcePreferee() === 'ign') {
            try {
                return await grilleDeSource(points, options, 'ign');
            } catch (e) {
                if (!CODES_REPLI.includes(e.code)) throw e;
            }
        }
        return grilleDeSource(points, options, 'copernicus');
    }

    async function grilleDeSource(points, options, source) {
        const marge = (options && options.margeM) != null ? options.margeM : MARGE_GRILLE_M;
        // Une grille déjà chargée qui couvre tout (avec au moins la moitié de la marge) suffit.
        const connue = grilles.find((g) => g.source === source && points.every((p) => g.couvre(p.lat, p.lng, marge / 2)));
        if (connue) return connue;

        const cle = source + '|' + JSON.stringify(points.map((p) => [p.lat.toFixed(6), p.lng.toFixed(6)])) + '|' + marge;
        if (enCours.has(cle)) return enCours.get(cle);
        const promesse = (async () => {
            let rep;
            try {
                rep = await fetch(URL_GRILLE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ points: points.map((p) => ({ lat: p.lat, lng: p.lng })), marge_m: marge, source }),
                });
            } catch (e) {
                throw erreurTerrain(source + '_indisponible', 'Service de terrain injoignable.');
            }
            const json = await rep.json().catch(() => ({}));
            if (!rep.ok) throw erreurTerrain(json.code || 'erreur_serveur', json.error);
            const grille = decoderGrille(json);
            grilles.push(grille);
            if (grilles.length > 12) grilles = grilles.slice(-12);
            return grille;
        })();
        enCours.set(cle, promesse);
        try {
            return await promesse;
        } finally {
            enCours.delete(cle);
        }
    }

    // ── Google Elevation (repli ; mémoire seulement) ───────────────────────────────────────────
    const cacheGoogle = new Map();

    function distanceM(a, b) {
        const R = 6371008.8, rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function profilGoogle(a, b, pas) {
        const longueur = distanceM(a, b);
        const n = Math.min(GOOGLE_MAX_ECHANTILLONS, Math.max(2, Math.ceil(longueur / (pas || 1) - 1e-6) + 1));
        const cle = [a.lat, a.lng, b.lat, b.lng].map((v) => v.toFixed(7)).join(',') + '|' + n;
        if (cacheGoogle.has(cle)) return cacheGoogle.get(cle);
        const promesse = new Promise((resolve, reject) => {
            const gm = window.google && window.google.maps;
            if (!gm || !gm.ElevationService) {
                reject(erreurTerrain('google_indisponible', 'Service altimétrique non chargé.'));
                return;
            }
            new gm.ElevationService().getElevationAlongPath({ path: [a, b], samples: n }, (resultats, statut) => {
                if (statut !== 'OK' || !resultats) {
                    reject(erreurTerrain('google_indisponible', 'Service altimétrique indisponible (' + statut + ').'));
                    return;
                }
                resolve(resultats.map((r, i) => ({ s: (longueur * i) / (n - 1), z: r.elevation })));
            });
        });
        cacheGoogle.set(cle, promesse);
        promesse.catch(() => cacheGoogle.delete(cle));
        return promesse;
    }

    function resultatGoogle(stations) {
        return { source: 'google', altitudesNGF: false, attribution: '', stations };
    }

    /**
     * Profils de plusieurs lignes [{a, b}] depuis la MÊME source : une seule grille (IGN ou
     * Copernicus) pour toutes, ou en dernier recours une requête Google par ligne.
     * -> { source, altitudesNGF, attribution, profils: [stations] }
     */
    async function profils(lignes, options) {
        const pas = (options && options.pasM) || 1;
        try {
            const extremites = [];
            lignes.forEach((l) => extremites.push(l.a, l.b));
            const grille = await grillePourPoints(extremites, options);
            return {
                source: grille.source, altitudesNGF: grille.source === 'ign', attribution: grille.attribution,
                profils: lignes.map((l) => grille.profil(l.a, l.b, pas)),
            };
        } catch (e) {
            if (!CODES_REPLI.includes(e.code)) throw e;
        }
        const stations = await Promise.all(lignes.map((l) => profilGoogle(l.a, l.b, pas)));
        return Object.assign(resultatGoogle(null), { profils: stations });
    }

    async function profil(a, b, options) {
        const r = await profils([{ a, b }], options);
        return { source: r.source, altitudesNGF: r.altitudesNGF, attribution: r.attribution, stations: r.profils[0] };
    }

    // ── Lignes de façade et de coupe d'un champ ────────────────────────────────────────────────
    function origineDuChamp(sourceId) {
        if (typeof CM.listerChampsCarte === 'function') {
            const champ = CM.listerChampsCarte().find((c) => c.sourceId === sourceId);
            if (champ && champ.origin) return champ.origin;
        }
        return CM.state && CM.state.sourceId === sourceId ? CM.state.roofLocalOrigin : null;
    }

    function versLatLng(origine, pt) {
        const ll = CM.localToLatLng(origine, pt);
        return { lat: typeof ll.lat === 'function' ? ll.lat() : ll.lat, lng: typeof ll.lng === 'function' ? ll.lng() : ll.lng };
    }

    function redresse(u, v, angle) {
        const c = Math.cos(angle), s = Math.sin(angle);
        return { x: u * c - v * s, y: u * s + v * c };
    }

    /** Abscisse u traversant le plus de rangées ; à égalité, la plus proche du milieu du champ. */
    function abscisseCoupe(rangees) {
        const bornes = [];
        rangees.forEach((r) => bornes.push(r.uMinM, r.uMaxM));
        bornes.sort((x, y) => x - y);
        const milieu = (bornes[0] + bornes[bornes.length - 1]) / 2;
        let meilleur = null;
        for (let i = 0; i < bornes.length - 1; i++) {
            const g = bornes[i], d = bornes[i + 1];
            if (d - g < 1e-9) continue;
            const traversees = rangees.filter((r) => r.uMinM <= (g + d) / 2 && r.uMaxM >= (g + d) / 2).map((r) => r.index);
            const u = Math.min(Math.max(milieu, g), d);
            const candidat = { u, traversees, ecart: Math.abs(u - milieu) };
            if (!meilleur || traversees.length > meilleur.traversees.length
                || (traversees.length === meilleur.traversees.length && candidat.ecart < meilleur.ecart)) {
                meilleur = candidat;
            }
        }
        return meilleur || { u: milieu, traversees: rangees.map((r) => r.index) };
    }

    /**
     * Lignes de façade (une par rangée) et de coupe d'un champ PV, en {lat, lng}.
     * options : ligneFacade 'centre' (défaut) | 'avant' | 'arriere' ; margeFacadeM (prolongement des
     * façades, 0 par défaut) ; retraitM (depuis le bord, vers
     * l'intérieur, pour avant/arrière) ; margeCoupeM (prolongement de la coupe au-delà du champ, 3 m).
     * -> null si le champ n'a aucun panneau posé ou pas d'origine sur la carte.
     */
    function lignesChamp(sourceId, options) {
        const opts = Object.assign({ ligneFacade: 'centre', retraitM: 0, margeCoupeM: 3, margeFacadeM: 0 }, options || {});
        const dims = window.CalepinageMaisonDimensionsPetitChamp;
        const mesure = dims && typeof dims.mesurerSheds === 'function' ? dims.mesurerSheds(sourceId) : null;
        const origine = origineDuChamp(mesure ? mesure.sourceId : sourceId);
        if (!mesure || !origine || !mesure.rangees.length || !Number.isFinite(mesure.rangees[0].vMinM)) return null;
        const angle = mesure.angleGrilleRad || 0;
        const point = (u, v) => versLatLng(origine, redresse(u, v, angle));

        const facades = mesure.rangees.map((r) => {
            let v = (r.vMinM + r.vMaxM) / 2;
            if (opts.ligneFacade === 'avant') v = r.vMaxM - opts.retraitM;
            else if (opts.ligneFacade === 'arriere') v = r.vMinM + opts.retraitM;
            // Prolongée de margeFacadeM de chaque côté : le plan dessine le sol au-delà des poteaux
            // d'extrémité. La rangée elle-même occupe [sDebut, sFin] le long de la ligne.
            const m = opts.margeFacadeM;
            return {
                index: r.index, libelle: r.libelle, ligne: opts.ligneFacade,
                a: point(r.uMinM - m, v), b: point(r.uMaxM + m, v), longueurM: r.uMaxM - r.uMinM + 2 * m,
                sDebut: m, sFin: m + r.uMaxM - r.uMinM,
            };
        });

        const choix = abscisseCoupe(mesure.rangees);
        const vMin = Math.min.apply(null, mesure.rangees.map((r) => r.vMinM)) - opts.margeCoupeM;
        const vMax = Math.max.apply(null, mesure.rangees.map((r) => r.vMaxM)) + opts.margeCoupeM;
        // Sens de parcours : de l'arrière (vMin) vers l'avant (vMax) ; s = 0 à l'arrière.
        const coupe = {
            a: point(choix.u, vMin), b: point(choix.u, vMax), longueurM: vMax - vMin,
            rangeesTraversees: choix.traversees,
            // Position des rangées le long de la coupe (s en m depuis a), pour caler les sheds du plan.
            rangees: mesure.rangees.map((r) => ({ index: r.index, sDebut: r.vMinM - vMin, sFin: r.vMaxM - vMin })),
        };
        const resultat = { sourceId: mesure.sourceId, angleGrilleRad: angle, facades, coupe, lignesPerso: {} };
        appliquerLignesPerso(resultat, mesure, origine, angle);
        return resultat;
    }

    // ── Lignes tracées par l'utilisateur ──────────────────────────────────────────────────────
    function etatChamp(pvId) {
        if (CM.state && CM.state.sourceId === pvId) return CM.state;
        return typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(pvId) : null;
    }

    /** Champs PV de la carte ayant des panneaux posés : [{ pvId, libelle }]. */
    function champsDisponibles() {
        if (typeof CM.listerChampsCarte !== 'function') return [];
        return CM.listerChampsCarte().map((c) => ({ pvId: c.sourceId, libelle: c.state.sourceLabel || c.sourceId }));
    }

    function lignesPerso(pvId) {
        const st = etatChamp(pvId);
        return (st && st.terrainLignesPlans) || {};
    }

    function notifier(pvId, plan) {
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'terrainLignesPlans');
        document.dispatchEvent(new CustomEvent('terrainLignesPlansModifiees', { detail: { pvId, plan } }));
    }

    /** Affecte une ligne tracée ({lat, lng} x 2) au plan 'coupe' ou 'facade' d'un champ. */
    function affecterLigne(pvId, plan, a, b, nom) {
        if (plan !== 'coupe' && plan !== 'facade') throw new Error('Plan inconnu : ' + plan);
        const st = etatChamp(pvId);
        if (!st) throw new Error('Champ PV introuvable : ' + pvId);
        if (!(distanceM(a, b) > 1)) throw new Error('Ligne trop courte (moins de 1 m).');
        st.terrainLignesPlans = Object.assign({}, st.terrainLignesPlans || {}, {
            [plan]: { a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng }, nom: nom || '' },
        });
        notifier(pvId, plan);
        return true;
    }

    function retirerLigne(pvId, plan) {
        const st = etatChamp(pvId);
        if (!st || !st.terrainLignesPlans || !st.terrainLignesPlans[plan]) return false;
        const copie = Object.assign({}, st.terrainLignesPlans);
        delete copie[plan];
        st.terrainLignesPlans = copie;
        notifier(pvId, plan);
        return true;
    }

    function versLocal(origine, p) {
        const oLat = typeof origine.lat === 'function' ? origine.lat() : origine.lat;
        const oLng = typeof origine.lng === 'function' ? origine.lng() : origine.lng;
        const mLat = 111320, mLng = mLat * Math.cos((oLat * Math.PI) / 180);   // = CM.latLngToLocal
        return { x: (p.lng - oLng) * mLng, y: (p.lat - oLat) * mLat };
    }

    /**
     * Remplace coupe / façades par les lignes tracées du champ. Rangées placées le long de la ligne
     * par intersection avec leur axe (coupe : v = centre de la rangée ; façade : u = bords de la
     * rangée) ; ligne orientée pour que s croisse comme la ligne automatique (+v pour la coupe,
     * +u pour la façade). Ligne inutilisable (parallèle aux rangées pour une coupe, perpendiculaire
     * pour une façade) : ignorée, la ligne automatique reste.
     */
    function appliquerLignesPerso(resultat, mesure, origine, angle) {
        const perso = lignesPerso(mesure.sourceId);
        const enUV = (p) => {
            const l = versLocal(origine, p), c = Math.cos(-angle), s = Math.sin(-angle);
            return { u: l.x * c - l.y * s, v: l.x * s + l.y * c };
        };
        const ecartDeg = (du, dv, axe) => {
            const deg = Math.abs(Math.atan2(axe === 'v' ? du : dv, axe === 'v' ? dv : du)) * 180 / Math.PI;
            return Math.min(deg, 180 - deg);
        };
        if (perso.coupe) {
            let A = enUV(perso.coupe.a), B = enUV(perso.coupe.b);
            let a = perso.coupe.a, b = perso.coupe.b;
            if (B.v < A.v) { [A, B] = [B, A]; [a, b] = [b, a]; }
            const L = Math.hypot(B.u - A.u, B.v - A.v);
            const dv = (B.v - A.v) / L;
            if (dv > 0.05) {
                resultat.coupe = {
                    a, b, longueurM: L, perso: true, nom: perso.coupe.nom || '',
                    ecartAngleDeg: ecartDeg(B.u - A.u, B.v - A.v, 'v'),
                    rangeesTraversees: mesure.rangees.map((r) => r.index),
                    rangees: mesure.rangees.map((r) => {
                        const sc = ((r.vMinM + r.vMaxM) / 2 - A.v) / dv;
                        const demi = (r.vMaxM - r.vMinM) / 2 / dv;
                        return { index: r.index, sDebut: sc - demi, sFin: sc + demi };
                    }),
                };
                resultat.lignesPerso.coupe = { nom: perso.coupe.nom || '', ecartAngleDeg: resultat.coupe.ecartAngleDeg };
            }
        }
        if (perso.facade) {
            let A = enUV(perso.facade.a), B = enUV(perso.facade.b);
            let a = perso.facade.a, b = perso.facade.b;
            if (B.u < A.u) { [A, B] = [B, A]; [a, b] = [b, a]; }
            const L = Math.hypot(B.u - A.u, B.v - A.v);
            const du = (B.u - A.u) / L;
            if (du > 0.05) {
                const ecart = ecartDeg(B.u - A.u, B.v - A.v, 'u');
                resultat.facades = mesure.rangees.map((r) => ({
                    index: r.index, libelle: r.libelle, ligne: 'perso', perso: true, nom: perso.facade.nom || '',
                    a, b, longueurM: L, ecartAngleDeg: ecart,
                    sDebut: (r.uMinM - A.u) / du, sFin: (r.uMaxM - A.u) / du,
                }));
                resultat.lignesPerso.facade = { nom: perso.facade.nom || '', ecartAngleDeg: ecart };
            }
        }
    }

    /** lignesChamp + profils altimétriques de chaque ligne (même source pour toutes). */
    async function profilsChamp(sourceId, options) {
        const lignes = lignesChamp(sourceId, options);
        if (!lignes) return null;
        const r = await profils(lignes.facades.concat([lignes.coupe]), options);
        lignes.facades.forEach((f, i) => { f.stations = r.profils[i]; });
        lignes.coupe.stations = r.profils[r.profils.length - 1];
        return Object.assign(lignes, { source: r.source, altitudesNGF: r.altitudesNGF, attribution: r.attribution });
    }

    function viderCache() {
        grilles = [];
        cacheGoogle.clear();
    }

    window.CalepinageMaisonTerrain = {
        versLambert93, GrilleMNT, decoderGrille, interpolerProfil, penteSurFenetre, sourcePreferee,
        grillePourPoints, profil, profils, lignesChamp, profilsChamp, viderCache,
        champsDisponibles, lignesPerso, affecterLigne, retirerLigne,
        _abscisseCoupe: abscisseCoupe,
    };
})();
