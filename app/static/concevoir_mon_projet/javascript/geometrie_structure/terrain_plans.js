/**
 * Terrain automatique des plans de coupe et de façade — côté CONFIGURATEURS (pages chargées en
 * iframe par geometrieModal.js : petit champ solaire, puis ombrières et bâtiment).
 *
 * Les profils viennent de la page parente (window.CalepinageMaisonTerrain, cf.
 * Calepinage_mainson/calepinage_maison_terrain.js) : une grille IGN par champ PV en France, Google
 * ailleurs. Le configurateur les TIRE (même patron que calepinage_ombriere.js::
 * synchroniserDepuisModuleResidentiel : on remonte les fenêtres parentes pour trouver le service et
 * le pvId passé dans l'URL de la modale), puis redessine quand ils arrivent.
 *
 * Réglages (champs `.all-inputs`, donc sauvegardés et relus comme les autres) :
 *   #terrainAuto         case « Terrain automatique » (cochée par défaut) ; décochée = saisie
 *                        manuelle historique (dénivelé + altitude au point 0) ;
 *   #terrainLigneFacade  ligne de poteaux du plan de façade : centre (défaut) | avant | arriere
 *                        (<select> caché, piloté par les boutons .terrain-ligne-btn).
 * Affichage : #terrainAutoInfo (source, dénivelé, pente, alertes, lignes tracées sur la carte avec
 * un lien « Revenir à l'automatique »).
 * Lignes TRACÉES sur la carte (outil Profil altimétrique, bouton 📐) : si le champ en a une pour la
 * coupe ou la façade, le service la renvoie à la place de la ligne automatique (`perso: true`).
 *
 * Conventions des fonctions de sol renvoyées :
 *   xM = abscisse horizontale du DESSIN en mètres (0 = repère du dessin, cf. chaque plan) ;
 *   zRel(xM) = altitude du sol RELATIVE au sol en xM = 0, en mètres, POSITIVE VERS LE HAUT
 *              (le dessin, dont l'axe Y descend, utilise -zRel * échelle) ;
 *   zAbs(xM) = altitude absolue (NGF si IGN).
 *
 * Point d'entrée : window.TerrainPlans
 */
(function () {
    const SEUIL_PENTE_ATTENTION_PCT = 3;
    const SEUIL_PENTE_ALERTE_PCT = 5;
    const MARGE_FACADE_M = 3;

    // ── Calculs purs (testés par tests/terrain/test_terrain_plans.js) ──────────────────────────
    function interpoler(stations, s) {
        const v = stations.filter((p) => Number.isFinite(p.z));
        if (!v.length) return null;
        if (s <= v[0].s) return v[0].z;                 // au-delà du profil : sol prolongé à plat
        if (s >= v[v.length - 1].s) return v[v.length - 1].z;
        let g = 0, d = v.length - 1;
        while (d - g > 1) {
            const m = (g + d) >> 1;
            if (v[m].s <= s) g = m; else d = m;
        }
        const t = v[d].s > v[g].s ? (s - v[g].s) / (v[d].s - v[g].s) : 0;
        return v[g].z + (v[d].z - v[g].z) * t;
    }

    /** Fonction de sol à partir d'un profil et d'une correspondance affine s = s0 + sens * xM. */
    function fabriquerSol(stations, s0, sens) {
        const z0 = interpoler(stations, s0);
        if (z0 === null) return null;
        const zAbs = (xM) => interpoler(stations, s0 + sens * xM);
        return { zAbs, zRel: (xM) => zAbs(xM) - z0, sDeX: (xM) => s0 + sens * xM };
    }

    /**
     * Sol du plan de COUPE. Le sens est imposé par la toiture dessinée : le bord HAUT d'une table est
     * son arrière (les panneaux regardent l'avant, +v). invertSlope=false : la toiture monte vers la
     * droite, donc l'arrière est à droite ; le shed 0 (à gauche) est la rangée la plus en avant.
     * coupe = { stations, rangees: [{index, sDebut, sFin}] } (s = 0 à l'arrière, cf. lignesChamp).
     */
    function solCoupe(coupe, opts) {
        if (!coupe || !coupe.stations || !coupe.rangees || !coupe.rangees.length) return null;
        const centres = coupe.rangees.map((r) => (r.sDebut + r.sFin) / 2);
        const inverse = !!(opts && opts.invertSlope);
        const sens = inverse ? 1 : -1;
        const s0 = inverse ? Math.min.apply(null, centres) : Math.max.apply(null, centres);
        return fabriquerSol(coupe.stations, s0, sens);
    }

    /** Vecteur unitaire (Est, Nord) d'une ligne {a, b} en {lat, lng}. */
    function directionMonde(a, b) {
        const dx = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
        const dy = b.lat - a.lat;
        const n = Math.hypot(dx, dy) || 1;
        return { x: dx / n, y: dy / n };
    }

    const NORMALES = { Nord: { x: 0, y: 1 }, Sud: { x: 0, y: -1 }, Est: { x: 1, y: 0 }, Ouest: { x: -1, y: 0 } };

    /**
     * Sol du plan de FAÇADE d'une rangée, vue depuis `orientation` (Est/Ouest/Nord/Sud = côté où se
     * tient l'observateur). Sa droite = direction de regard tournée de -90° ; la gauche du dessin
     * (xM = 0) est le début du groupe de sheds, et le dessin (longueurDessinM) est centré sur la rangée.
     * facade = { stations, a, b, sDebut, sFin } (s = 0 en a, rangée entre sDebut et sFin).
     */
    function solFacade(facade, opts) {
        if (!facade || !facade.stations || !facade.a || !facade.b) return null;
        const n = NORMALES[(opts && opts.orientation) || 'Sud'] || NORMALES.Sud;
        const regard = { x: -n.x, y: -n.y };
        const droite = { x: regard.y, y: -regard.x };
        const e = directionMonde(facade.a, facade.b);
        const croissant = e.x * droite.x + e.y * droite.y >= 0;
        const longueurRangee = facade.sFin - facade.sDebut;
        const longueurDessin = (opts && opts.longueurDessinM) > 0 ? opts.longueurDessinM : longueurRangee;
        const debordement = (longueurRangee - longueurDessin) / 2;
        const s0 = croissant ? facade.sDebut + debordement : facade.sFin - debordement;
        return fabriquerSol(facade.stations, s0, croissant ? 1 : -1);
    }

    /**
     * Calage d'une table RIGIDE (droite) au-dessus de pieds de poteaux posés sur un terrain réel.
     * postes = [{ x, zSol }] ; mode 'pente' (la table suit la pente moyenne entre le premier et le
     * dernier poteau) ou 'horizontal' ; hauteurMin = garde au sol voulue sous la table AU POTEAU LE
     * PLUS CONTRAINT (aucun poteau n'a moins). -> { zTable(x), pente, hauteurs: [h par poteau] }.
     * Sur un terrain en ligne droite, le mode 'pente' redonne des poteaux tous égaux (comportement
     * historique) ; le mode 'horizontal' se cale sur le point haut.
     */
    function calerTable(postes, mode, hauteurMin) {
        const p = postes.filter((q) => Number.isFinite(q.zSol)).sort((u, v) => u.x - v.x);
        if (!p.length) return null;
        const premier = p[0], dernier = p[p.length - 1];
        const pente = mode === 'pente' && dernier.x > premier.x
            ? (dernier.zSol - premier.zSol) / (dernier.x - premier.x)
            : 0;
        const decalage = Math.max.apply(null, p.map((q) => q.zSol - pente * q.x)) + hauteurMin;
        const zTable = (x) => decalage + pente * x;
        return { zTable, pente, hauteurs: postes.map((q) => zTable(q.x) - q.zSol) };
    }

    /** Pente max (%) mesurée sur une fenêtre de `fenetreM` (entraxe / longueur de table). */
    function penteMax(stations, fenetreM, sDebut, sFin) {
        const v = stations.filter((p) => Number.isFinite(p.z) && p.s >= sDebut - 1e-9 && p.s <= sFin + 1e-9);
        if (v.length < 2 || !(fenetreM > 0)) return null;
        const f = Math.min(fenetreM, v[v.length - 1].s - v[0].s);
        if (!(f > 0)) return null;
        let max = 0;
        v.forEach((q) => {
            if (q.s + f > v[v.length - 1].s + 1e-9) return;
            max = Math.max(max, Math.abs(interpoler(v, q.s + f) - q.z) / f * 100);
        });
        return max;
    }

    function niveauPente(pct) {
        if (!Number.isFinite(pct)) return 'inconnu';
        if (pct > SEUIL_PENTE_ALERTE_PCT) return 'alerte';
        if (pct > SEUIL_PENTE_ATTENTION_PCT) return 'attention';
        return 'ok';
    }

    /**
     * Dessine le SOL d'un plan (remplissage + contour + hachure) entre xDebut et xFin (unités du
     * dessin), en suivant `solY(x)` (Y du sol dans le repère courant). Terrain réel : polyligne
     * échantillonnée ; terrain plat/droite : 2 points. La hachure est découpée par le sol
     * (ctx.clip), ce que l'enregistreur d'export sait reproduire.
     * opts : { solY, xDebut, xFin, profondeur, pasEchantillon, remplissage, contour, hachure }
     */
    function dessinerSol(ctx, opts) {
        const solY = opts.solY || (() => 0);
        const pas = opts.pasEchantillon > 0 ? opts.pasEchantillon : (opts.xFin - opts.xDebut);
        const points = [];
        for (let x = opts.xDebut; x < opts.xFin; x += pas) points.push({ x, y: solY(x) });
        points.push({ x: opts.xFin, y: solY(opts.xFin) });
        const chemin = new Path2D();
        points.forEach((q, i) => (i ? chemin.lineTo(q.x, q.y) : chemin.moveTo(q.x, q.y)));
        for (let i = points.length - 1; i >= 0; i--) chemin.lineTo(points[i].x, points[i].y + opts.profondeur);
        chemin.closePath();
        ctx.save();
        ctx.fillStyle = opts.remplissage || '#f0f0f0';
        ctx.fill(chemin);
        ctx.strokeStyle = opts.contour || '#374151';
        ctx.lineWidth = 2;
        ctx.stroke(chemin);
        hachurer(ctx, chemin, points, opts.profondeur, opts.xDebut, opts.xFin, opts.hachure);
        ctx.restore();
        return points;
    }

    /**
     * Hachures du sol en VRAIS traits (à 45°, tous les 10 px) découpés par le contour du sol : à la
     * différence d'un motif (createPattern), elles passent dans l'enregistreur vectoriel des exports
     * (coupe ET façade des configurateurs, dossiers de plans).
     */
    function hachurer(ctx, chemin, points, profondeur, xDebut, xFin, couleur) {
        ctx.save();
        ctx.clip(chemin);
        ctx.strokeStyle = couleur || '#cccccc';
        ctx.lineWidth = 1;
        const yMin = Math.min.apply(null, points.map((q) => q.y)) - 5;
        const yMax = Math.max.apply(null, points.map((q) => q.y)) + profondeur + 5;
        const portee = yMax - yMin;
        for (let i = xDebut - portee; i < xFin; i += 10) {
            ctx.beginPath(); ctx.moveTo(i, yMax); ctx.lineTo(i + portee, yMin); ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * Zones d'un plan où le TERRAIN passe au-dessus du BAS DE LA STRUCTURE (repère du dessin, Y vers
     * le bas : sol au-dessus <=> solY(x) < dessousY(x)). Bornes des zones interpolées au croisement.
     * -> [{ points: polygone (sol à l'aller, bas de structure au retour), profondeurMax (unités du
     *       dessin), xMax (abscisse de l'enfoncement maximal) }]
     */
    function zonesEnfoncement(xDebut, xFin, solY, dessousY, pas) {
        const n = Math.max(2, Math.ceil((xFin - xDebut) / (pas > 0 ? pas : (xFin - xDebut) / 50)));
        const ech = [];
        for (let i = 0; i <= n; i++) {
            const x = xDebut + ((xFin - xDebut) * i) / n;
            const s = solY(x), b = dessousY(x);
            if (Number.isFinite(s) && Number.isFinite(b)) ech.push({ x, s, b, e: b - s });
        }
        const zones = [];
        let courant = null;
        const croisement = (p, q) => {
            const t = p.e / (p.e - q.e);
            return { x: p.x + (q.x - p.x) * t, y: p.s + (q.s - p.s) * t };
        };
        const fermer = () => {
            if (courant && courant.haut.length >= 2) {
                zones.push({
                    points: courant.haut.concat(courant.bas.reverse()),
                    profondeurMax: courant.max, xMax: courant.xMax,
                });
            }
            courant = null;
        };
        ech.forEach((p, i) => {
            const prec = ech[i - 1];
            if (p.e > 0) {
                if (!courant) {
                    courant = { haut: [], bas: [], max: 0, xMax: p.x };
                    if (prec && prec.e <= 0) { const c = croisement(prec, p); courant.haut.push(c); courant.bas.push(c); }
                }
                courant.haut.push({ x: p.x, y: p.s });
                courant.bas.push({ x: p.x, y: p.b });
                if (p.e > courant.max) { courant.max = p.e; courant.xMax = p.x; }
            } else if (courant) {
                const c = croisement(prec, p);
                courant.haut.push(c);
                courant.bas.push(c);
                fermer();
            }
        });
        fermer();
        return zones;
    }

    /**
     * Dessine les zones d'enfoncement (remplissage rouge translucide, contour, hachure croisée en
     * vrais traits — reprise par l'enregistreur des exports PDF/DXF) et la profondeur maximale.
     * opts : { echelle (unités du dessin par mètre), taillePolice, libelle (défaut : oui) }
     */
    function dessinerEnfoncements(ctx, zones, opts) {
        const o = opts || {};
        zones.forEach((z) => {
            const chemin = new Path2D();
            z.points.forEach((p, i) => (i ? chemin.lineTo(p.x, p.y) : chemin.moveTo(p.x, p.y)));
            chemin.closePath();
            ctx.save();
            ctx.fillStyle = 'rgba(220, 38, 38, 0.25)';
            ctx.fill(chemin);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.5;
            ctx.stroke(chemin);
            ctx.save();
            ctx.clip(chemin);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 0.75;
            const xs = z.points.map((p) => p.x), ys = z.points.map((p) => p.y);
            const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
            const y0 = Math.min.apply(null, ys) - 2, y1 = Math.max.apply(null, ys) + 2;
            const portee = y1 - y0;
            for (let i = x0 - portee; i < x1 + portee; i += 6) {
                ctx.beginPath(); ctx.moveTo(i, y1); ctx.lineTo(i + portee, y0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(i, y0); ctx.lineTo(i + portee, y1); ctx.stroke();
            }
            ctx.restore();
            if (o.libelle !== false && o.echelle > 0) {
                const taille = o.taillePolice || 12;
                ctx.fillStyle = '#b91c1c';
                ctx.font = `bold ${taille}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('Terrain au-dessus du bas de structure : ' + fmt(z.profondeurMax / o.echelle, 2) + ' m',
                    z.xMax, Math.min.apply(null, ys) - 4);
            }
            ctx.restore();
        });
        return zones.length;
    }

    /**
     * Niveau (Y du dessin) auquel ramener le sol pour qu'une structure dessinée à Y = 0 garde sa
     * hauteur réglée partout : le point le PLUS HAUT du terrain sous son emprise. Renvoie 0 sans
     * terrain automatique (dessin historique inchangé).
     */
    function niveauSolStructure(sol, demiEmpriseM) {
        if (!sol) return 0;
        let haut = -Infinity;
        for (let x = -demiEmpriseM; x <= demiEmpriseM; x += 0.25) haut = Math.max(haut, sol.zRel(x));
        return Number.isFinite(haut) ? haut : 0;
    }

    // ── Liaison avec la page parente ───────────────────────────────────────────────────────────
    let resultat = null;
    let statut = 'inactif';          // inactif | chargement | ok | indisponible
    let message = '';
    let ligneChargee = null;
    let surChangement = null;
    let jeton = 0;

    function trouverService() {
        let pvId = null, service = null, tables = null, fen = window;
        for (let i = 0; i < 5 && fen; i++) {
            try {
                if (!pvId) pvId = new URLSearchParams(fen.location.search).get('pvId');
                if (!service && fen.CalepinageMaisonTerrain) service = fen.CalepinageMaisonTerrain;
                if (!tables && fen.CalepinageMaisonTerrainTables) tables = fen.CalepinageMaisonTerrainTables;
            } catch (e) {
                break;   // fenêtre d'une autre origine
            }
            if (fen === fen.parent) break;
            fen = fen.parent;
        }
        return { pvId, service, tables };
    }

    /** Synthèse des tables du champ (calcul unique carte + 3D, page parente) ; null si absente. */
    function syntheseTables() {
        const { pvId, tables } = trouverService();
        const r = tables && pvId ? tables.resultat(pvId) : null;
        return r ? Object.assign({ seuils: r.seuils }, r.synthese) : null;
    }

    function champ(id) { return document.getElementById(id); }

    function autoDemande() {
        const c = champ('terrainAuto');
        return !c || c.checked;
    }

    function ligneFacadeDemandee() {
        const s = champ('terrainLigneFacade');
        const v = s && s.value;
        return v === 'avant' || v === 'arriere' ? v : 'centre';
    }

    /** Charge (ou recharge si la ligne de façade a changé) les profils du champ. Idempotent. */
    function actualiser(forcer) {
        if (!autoDemande()) { afficherInfo(); return Promise.resolve(null); }
        const ligne = ligneFacadeDemandee();
        if (!forcer && ligne === ligneChargee && (statut === 'ok' || statut === 'chargement')) return Promise.resolve(resultat);
        const { pvId, service } = trouverService();
        if (!service) {
            statut = 'indisponible';
            message = 'Terrain automatique indisponible hors du projet (saisie manuelle utilisée).';
            afficherInfo();
            return Promise.resolve(null);
        }
        const moi = ++jeton;
        statut = 'chargement';
        ligneChargee = ligne;
        afficherInfo();
        return service.profilsChamp(pvId || undefined, { ligneFacade: ligne, margeFacadeM: MARGE_FACADE_M })
            .then((r) => {
                if (moi !== jeton) return resultat;
                resultat = r;
                statut = r ? 'ok' : 'indisponible';
                message = r ? '' : 'Aucun panneau posé sur ce champ : saisie manuelle utilisée.';
                afficherInfo();
                if (typeof surChangement === 'function') surChangement();
                return r;
            })
            .catch((e) => {
                if (moi !== jeton) return resultat;
                resultat = null;
                statut = 'indisponible';
                message = 'Terrain indisponible (' + (e && (e.code || e.message) || 'erreur') + ') : saisie manuelle utilisée.';
                afficherInfo();
                if (typeof surChangement === 'function') surChangement();
                return null;
            });
    }

    /** true si les plans doivent utiliser le terrain automatique (demandé ET chargé). */
    function actif() {
        return autoDemande() && statut === 'ok' && !!resultat;
    }

    function rangeeCourante() {
        const s = champ('facadeRowSelector');
        const n = s && s.value !== '' ? parseInt(s.value, 10) : NaN;
        return Number.isFinite(n) ? n : 0;
    }

    function facadeDeRangee(index) {
        if (!resultat) return null;
        const i = index == null ? rangeeCourante() : index;
        return resultat.facades.find((f) => f.index === i) || resultat.facades[0] || null;
    }

    function solCoupeActif(opts) {
        return actif() ? solCoupe(resultat.coupe, opts) : null;
    }

    function solFacadeActif(opts) {
        if (!actif()) return null;
        return solFacade(facadeDeRangee(opts && opts.indexRangee), opts);
    }

    function libelleAltitude() {
        return resultat && resultat.altitudesNGF ? 'Ngf' : 'm (alt. approx.)';
    }

    function synchroniserBoutonsLigne() {
        const valeur = ligneFacadeDemandee();
        const persoFacade = !!(resultat && resultat.lignesPerso && resultat.lignesPerso.facade);
        document.querySelectorAll('.terrain-ligne-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.ligne === valeur);
            b.disabled = !autoDemande() || persoFacade;
            b.style.opacity = b.disabled ? '0.5' : '';
            b.title = persoFacade ? 'Façade relevée sur la ligne tracée sur la carte' : (b.dataset.titre || b.title);
        });
    }

    function libelleLignePerso(plan, info) {
        const nom = info.nom ? ` « ${info.nom} »` : '';
        const oblique = info.ecartAngleDeg > 15
            ? ` <span style="color:#b45309">(ligne oblique : ${fmt(info.ecartAngleDeg, 0)}° avec l'axe)</span>` : '';
        return `${plan === 'coupe' ? 'Coupe' : 'Façade'} : ligne tracée sur la carte${nom}${oblique} — `
            + `<a href="#" data-terrain-retirer="${plan}" style="color:#2563eb; text-decoration:underline;">revenir à l'automatique</a>`;
    }

    function fmt(n, d) {
        return Number(n).toFixed(d == null ? 2 : d).replace('.', ',');
    }

    /** Synthèse affichée sous les réglages : source, dénivelés, pentes, alertes 3-5 %. */
    function afficherInfo() {
        const el = champ('terrainAutoInfo');
        const ligneSel = champ('terrainLigneFacade');
        if (ligneSel) ligneSel.disabled = !autoDemande();
        synchroniserBoutonsLigne();
        ['groundSlopeFacade', 'baseAltimetry', 'facadeGroundSlope', 'facadeBaseAltimetry'].forEach((id) => {
            const c = champ(id);
            if (!c) return;
            c.readOnly = autoDemande() && statut === 'ok';
            c.classList.toggle('bg-gray-100', c.readOnly);
            c.title = c.readOnly ? 'Calculé automatiquement depuis le terrain : décochez « Terrain automatique » pour saisir.' : '';
        });
        if (!el) return;
        if (!autoDemande()) { el.innerHTML = 'Saisie manuelle du dénivelé et de l\'altitude.'; el.style.color = '#4b5563'; return; }
        if (statut === 'chargement') { el.innerHTML = 'Chargement du terrain…'; el.style.color = '#4b5563'; return; }
        if (statut !== 'ok') { el.innerHTML = message; el.style.color = '#b45309'; return; }
        const f = facadeDeRangee();
        const lignes = [];
        const source = resultat.source === 'ign' ? (resultat.attribution || 'IGN')
            : resultat.source === 'copernicus' ? 'Copernicus DEM GLO-30, pas de 30 m (altitudes non NGF, modèle de surface)'
                : 'Google Elevation (altitudes non NGF)';
        lignes.push('Source : ' + source);
        const perso = resultat.lignesPerso || {};
        ['coupe', 'facade'].forEach((plan) => { if (perso[plan]) lignes.push(libelleLignePerso(plan, perso[plan])); });
        const c = resultat.coupe;
        const zc = c.stations.filter((p) => Number.isFinite(p.z)).map((p) => p.z);
        if (zc.length) lignes.push('Coupe : dénivelé ' + fmt(Math.max.apply(null, zc) - Math.min.apply(null, zc)) + ' m');
        let niveau = 'ok';
        if (f) {
            const zf = f.stations.filter((p) => Number.isFinite(p.z) && p.s >= f.sDebut && p.s <= f.sFin).map((p) => p.z);
            const pTable = penteMax(f.stations, f.sFin - f.sDebut, f.sDebut, f.sFin);
            const pLocale = penteMax(f.stations, 5, f.sDebut, f.sFin);
            if (zf.length) lignes.push(f.libelle + ' : dénivelé ' + fmt(Math.max.apply(null, zf) - Math.min.apply(null, zf)) + ' m');
            if (pTable !== null) {
                niveau = niveauPente(pTable);
                lignes.push('Pente le long de la rangée : ' + fmt(pTable, 1) + ' % (max. local sur 5 m : ' + fmt(pLocale, 1) + ' %)');
            }
        }
        // Tables du calepinage (même calcul que la carte et la 3D) : enfoncement / garde au sol.
        const st = syntheseTables();
        if (st && st.nbAnalysees) {
            const p = st.parNiveau || {};
            const morceaux = [];
            const seuils = st.seuils || { gardePct: 50, pentePct: SEUIL_PENTE_ALERTE_PCT };
            if (p.enfoncee) morceaux.push(p.enfoncee + ' enfoncée(s) dans le sol');
            if (p.pente_forte) morceaux.push(p.pente_forte + ' en pente > ' + fmt(seuils.pentePct, 1) + ' %');
            if (p.garde_faible) morceaux.push(p.garde_faible + ' à garde < ' + fmt(seuils.gardePct, 0) + ' % de la hauteur bas');
            lignes.push('Tables du champ (' + st.nbAnalysees + ') : ' + (morceaux.length ? morceaux.join(', ') : 'conformes')
                + ' — garde au sol min ' + fmt(st.gardeMinM, 2) + ' m');
            if (morceaux.length) niveau = 'alerte';
        }
        if (niveau === 'alerte') lignes.push('⚠ Tables hors seuils : voir la carte (tables colorées, réglage des seuils, retrait ou ajustement) et la 3D.');
        else if (niveau === 'attention') lignes.push('Pente entre ' + SEUIL_PENTE_ATTENTION_PCT + ' et ' + SEUIL_PENTE_ALERTE_PCT + ' % : vérifier la tolérance du fabricant.');
        el.innerHTML = lignes.join('<br>');
        el.style.color = niveau === 'alerte' ? '#b91c1c' : (niveau === 'attention' ? '#b45309' : '#374151');
    }

    /**
     * À appeler une fois par configurateur, après son initialisation. `rafraichir` = sa fonction
     * de redessin (ex. scheduleUpdate). Les changements de réglages relancent chargement + dessin.
     */
    function demarrer(rafraichir) {
        surChangement = rafraichir;
        const auto = champ('terrainAuto');
        const ligne = champ('terrainLigneFacade');
        if (auto) auto.addEventListener('change', () => { actualiser(false); afficherInfo(); if (rafraichir) rafraichir(); });
        if (ligne) ligne.addEventListener('change', () => actualiser(true));
        const rangee = champ('facadeRowSelector');
        if (rangee) rangee.addEventListener('change', () => afficherInfo());
        document.querySelectorAll('.terrain-ligne-btn').forEach((b) => {
            b.dataset.titre = b.title;
            b.addEventListener('click', (e) => {
                e.preventDefault();
                if (!ligne || b.disabled) return;
                ligne.value = b.dataset.ligne;
                // 'input' : redessin (écouteur .all-inputs du configurateur) ; 'change' : rechargement.
                ligne.dispatchEvent(new Event('input', { bubbles: true }));
                ligne.dispatchEvent(new Event('change', { bubbles: true }));
                synchroniserBoutonsLigne();
            });
        });
        const info = champ('terrainAutoInfo');
        if (info) info.addEventListener('click', (e) => {
            const plan = e.target && e.target.dataset && e.target.dataset.terrainRetirer;
            if (!plan) return;
            e.preventDefault();
            const { pvId, service } = trouverService();
            if (service && typeof service.retirerLigne === 'function') service.retirerLigne(pvId, plan);
            actualiser(true);
        });
        // Restauration des réglages sauvegardés (storage_manager_geometrie_structure.js, ~1,5 s après
        // le chargement) : la ligne de façade peut changer sans événement -> rechargement.
        window.addEventListener('geometrieStructureRestauree', () => actualiser(true));
        document.addEventListener('geometrieStructureRestauree', () => actualiser(true));
        // Ligne affectée / retirée depuis la carte pendant que le configurateur est ouvert.
        try {
            const { service } = trouverService();
            let fen = window;
            while (fen.parent && fen.parent !== fen && !fen.CalepinageMaisonTerrain) fen = fen.parent;
            if (service && fen.document) fen.document.addEventListener('terrainLignesPlansModifiees', () => actualiser(true));
        } catch (e) { /* autre origine */ }
        // Le calepinage peut changer pendant que la modale est ouverte (injection en 2 passes,
        // cf. geometrieModal.js) : un rechargement différé suffit, la grille est en cache.
        actualiser(true);
        setTimeout(() => actualiser(true), 2500);
    }

    window.TerrainPlans = {
        demarrer, actualiser, actif, solCoupe: solCoupeActif, solFacade: solFacadeActif, libelleAltitude,
        // true pendant le chargement du profil (le dossier de plans attend la fin avant de capturer).
        enChargement: () => statut === 'chargement',
        altitudesNGF: () => !!(resultat && resultat.altitudesNGF),
        facadeDeRangee, niveauPente,
        SEUIL_PENTE_ATTENTION_PCT, SEUIL_PENTE_ALERTE_PCT,
        dessinerSol, niveauSolStructure, hachurer, zonesEnfoncement, dessinerEnfoncements,
        // Calculs purs, exposés pour les tests et pour les autres configurateurs.
        _pur: { interpoler, fabriquerSol, solCoupe, solFacade, calerTable, penteMax, directionMonde, niveauSolStructure,
            zonesEnfoncement },
        calerTable,
    };
})();
