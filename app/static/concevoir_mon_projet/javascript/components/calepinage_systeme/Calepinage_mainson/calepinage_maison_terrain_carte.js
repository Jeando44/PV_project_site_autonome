/**
 * Calepinage résidentiel — TERRAIN des petits champs solaires sur la carte principale et le canevas.
 *
 * Les niveaux des tables viennent du calcul unique calepinage_maison_terrain_tables.js (le même que
 * la 3D). Ce module ne fait qu'afficher et piloter :
 * - Carte : un contour coloré par table signalée (clic = détail), au-dessus des panneaux ;
 * - Carte des pentes : dégradé de couleur sur l'emprise du champ + flèches dans le sens de la
 *   descente, pour repérer les zones à éviter AVANT de poser les tables (même grille de terrain) ;
 * - Légende (bas gauche) : par champ, seuils réglables (garde min en % de la hauteur bas
 *   structure, pente max en %), synthèse, « Retirer les tables hors seuils », « Proposer un
 *   ajustement » (aperçu des panneaux retirés, Appliquer / Annuler), « Restaurer » ;
 * - Canevas du calepinage : panneaux des tables signalées colorés (calepinage_maison_dessin.js lit
 *   CM.terrainCarte.couleurPanneau).
 * Analyse relancée à chaque resynchronisation des panneaux (calepinage_maison_carte_plans.js).
 * Affichages activables (cases de la légende, mémorisées dans le navigateur).
 */
(function () {
    const CM = (window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {});
    const CLE_AFFICHAGE = 'calepinageTerrainAffiche';
    const CLE_PENTES = 'calepinageCartePentes';
    const PAS_MAX_CELLULES = 160;      // cellules par côté de la carte des pentes
    const FENETRE_PENTE_MIN_M = 2.5;   // demi-fenêtre de calcul : pente jugée sur ≥ 5 m
    const PENTE_FLECHE_MIN_PCT = 1;

    const overlaysParSource = new Map();   // sourceId -> [google.maps.Polygon]
    const pentesParSource = new Map();     // sourceId -> { cle, overlay, fleches: [Polyline], donnees }
    const apercuParSource = new Map();     // sourceId -> { proposition, polys }
    let infoBulle = null;
    let legende = null;                    // { racine, zoneTitre, replier, corps }
    let masqueTemporaire = false;
    let modeSuppression = null;            // { sourceId, portee: 'table' | 'rangee' } ou null
    let selection = [];                    // [{ table, poly }] : tables cliquables du mode suppression

    function TT() { return window.CalepinageMaisonTerrainTables || null; }
    function carte() { return window.map || (window.drawingControl && window.drawingControl.map) || null; }
    function gmaps() { return !!(window.google && window.google.maps); }

    // Préférences relues en mémoire : couleurPanneau() les consulte pour CHAQUE panneau du canevas à
    // chaque rendu, une lecture du stockage du navigateur à chaque fois coûtait cher sur un champ.
    const prefs = new Map();   // clé -> true | false | null (jamais enregistrée)
    function lirePref(cle, defaut) {
        if (!prefs.has(cle)) {
            let v = null;
            try { const s = localStorage.getItem(cle); v = s === null ? null : s !== '0'; } catch (e) { /* navigation privée */ }
            prefs.set(cle, v);
        }
        const v = prefs.get(cle);
        return v === null ? defaut : v;
    }
    function ecrirePref(cle, actif) {
        prefs.set(cle, !!actif);
        try { localStorage.setItem(cle, actif ? '1' : '0'); } catch (e) { /* navigation privée */ }
    }
    const affichageActif = () => lirePref(CLE_AFFICHAGE, true);
    const pentesActives = () => lirePref(CLE_PENTES, true);
    // Couleurs de la légende cochables une à une (carte, canevas et 3D) : décochées par défaut.
    const CLE_NIVEAU = 'calepinageTerrainNiveau_';
    const niveauAffiche = (niveau) => lirePref(CLE_NIVEAU + niveau, false);

    function champ(sourceId) {
        try {
            return (CM.listerChampsCarte ? CM.listerChampsCarte() : []).find((c) => c.sourceId === sourceId) || null;
        } catch (e) {
            return null;
        }
    }

    function estChampAuSol(c) {
        if (!c || !c.state) return false;
        const tm = typeof CM.normalizeTypeMontage === 'function' ? CM.normalizeTypeMontage(c.state.typeMontage) : c.state.typeMontage;
        return tm === 'champ_solaire';
    }

    function libelleChamp(sourceId) {
        const c = champ(sourceId);
        return (c && c.state && c.state.sourceLabel) || sourceId;
    }

    const fmt = (n, d) => (Number.isFinite(n) ? n.toFixed(d == null ? 1 : d).replace('.', ',') : '—');
    const plat = (ll) => ({ lat: typeof ll.lat === 'function' ? ll.lat() : ll.lat, lng: typeof ll.lng === 'function' ? ll.lng() : ll.lng });

    function ligneGarde(libelle, p, refLibelle) {
        if (!p || !Number.isFinite(p.minM)) return '';
        const pct = p.refM > 0 ? (p.minM / p.refM) * 100 : NaN;
        return `<div style="margin-left:8px">· ${libelle} : <b>${fmt(p.minM, 2)} m</b>, soit ${fmt(pct, 0)} % ${refLibelle}
            (${fmt(p.refM, 2)} m sur terrain plat)</div>`;
    }

    function detailTable(t) {
        const a = t.analyse;
        const N = TT().NIVEAUX;
        const g = a.garde;
        const s = TT().seuils(t.sourceId);
        const po = a.poteaux;
        const liste = (v) => v.map((h) => fmt(h, 2)).join(' / ');
        return `<div style="font:13px/1.6 system-ui,'Segoe UI',sans-serif;max-width:320px">
            <div style="font-weight:600;margin-bottom:2px">${libelleChamp(t.sourceId)} — table ${t.index + 1}</div>
            <div style="color:${N[t.niveau].couleur || '#166534'};margin-bottom:4px">● ${N[t.niveau].libelle}</div>
            <div>Pente du terrain : <b>${fmt(a.pentes.totalePct)} %</b>
            (le long de la rangée ${fmt(Math.abs(a.pentes.longPct))} %, en travers ${fmt(Math.abs(a.pentes.traversPct))} %)</div>
            <div style="margin-top:4px">Garde au sol (seuil ${fmt(s.gardePct, 0)} % de chacune) :</div>
            ${ligneGarde('sous le bas des panneaux', g.pv, 'de la hauteur bas PV')}
            ${ligneGarde('sous la traverse', g.structure, 'de la hauteur de passage')}
            ${po ? `<div style="margin-top:4px">Poteaux verticaux posés sur le sol :</div>
            <div style="margin-left:8px">· hors sol : ${liste(po.horsSolM)} m</div>
            <div style="margin-left:8px">· enterrés : ${fmt(po.ancrageM, 2)} m pour chaque poteau</div>
            <div style="margin-left:8px">· longueur totale : ${liste(po.longueurM)} m</div>` : ''}
        </div>`;
    }

    // ── Carte des pentes (calcul pur, testé par tests/terrain/test_terrain_tables.js) ───────────

    function dansPolygone(p, poly) {
        let dedans = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans;
        }
        return dedans;
    }

    /**
     * Pente du terrain sur l'emprise d'un contour (repère local, mètres ; +y = nord).
     * solLocal(x, y) -> altitude ou null ; opts.resolutionM = pas natif du MNT (1 m IGN, ~30 m
     * Copernicus). La pente est une différence centrée sur une demi-fenêtre h ≥ max(2,5 m, pas,
     * résolution / 2) : à l'échelle d'une table, pas d'un talus de 1 m.
     * -> { minX, maxY, pas, nx, ny, pct: Float32Array (NaN hors contour), descente: [{x, y, dx, dy, pct}] }
     */
    function calculerPentes(contour, solLocal, opts) {
        if (!contour || contour.length < 3) return null;
        const xs = contour.map((p) => p.x), ys = contour.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const etendue = Math.max(maxX - minX, maxY - minY);
        const pas = Math.max(1, etendue / PAS_MAX_CELLULES);
        const h = Math.max(FENETRE_PENTE_MIN_M, pas, ((opts && opts.resolutionM) || 1) / 2);
        const nx = Math.max(1, Math.ceil((maxX - minX) / pas)), ny = Math.max(1, Math.ceil((maxY - minY) / pas));
        const pct = new Float32Array(nx * ny).fill(NaN);
        const gradient = (x, y) => {
            const zE = solLocal(x + h, y), zO = solLocal(x - h, y), zN = solLocal(x, y + h), zS = solLocal(x, y - h);
            if (![zE, zO, zN, zS].every(Number.isFinite)) return null;
            return { gx: (zE - zO) / (2 * h), gy: (zN - zS) / (2 * h) };
        };
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const p = { x: minX + (i + 0.5) * pas, y: maxY - (j + 0.5) * pas };   // ligne 0 = nord
                if (!dansPolygone(p, contour)) continue;
                const g = gradient(p.x, p.y);
                if (g) pct[j * nx + i] = Math.hypot(g.gx, g.gy) * 100;
            }
        }
        // Flèches de descente sur une grille plus lâche (~10 par côté, ≥ 6 m).
        const pasFleche = Math.max(6, etendue / 10);
        const descente = [];
        for (let y = maxY - pasFleche / 2; y > minY; y -= pasFleche) {
            for (let x = minX + pasFleche / 2; x < maxX; x += pasFleche) {
                if (!dansPolygone({ x, y }, contour)) continue;
                const g = gradient(x, y);
                if (!g) continue;
                const n = Math.hypot(g.gx, g.gy);
                if (n * 100 < PENTE_FLECHE_MIN_PCT) continue;
                descente.push({ x, y, dx: -g.gx / n, dy: -g.gy / n, pct: n * 100 });
            }
        }
        return { minX, maxY, pas, nx, ny, pct, descente, pasFleche };
    }

    /** Couleur RGBA d'une pente : vert (0) -> jaune (3 %) -> orange (seuil) -> rouge (2 x seuil). */
    function couleurPente(pct, seuilPct) {
        if (!Number.isFinite(pct)) return [0, 0, 0, 0];
        const arrets = [[0, [22, 163, 74]], [3, [250, 204, 21]], [seuilPct, [249, 115, 22]], [2 * seuilPct, [185, 28, 28]]]
            .sort((a, b) => a[0] - b[0]);
        let c = arrets[arrets.length - 1][1];
        for (let k = 1; k < arrets.length; k++) {
            if (pct <= arrets[k][0]) {
                const [p0, c0] = arrets[k - 1], [p1, c1] = arrets[k];
                const t = p1 > p0 ? (pct - p0) / (p1 - p0) : 1;
                c = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
                break;
            }
        }
        return [c[0], c[1], c[2], 150];
    }

    function imagePentes(d, seuilPct) {
        const toile = document.createElement('canvas');
        toile.width = d.nx;
        toile.height = d.ny;
        const ctx = toile.getContext('2d');
        const img = ctx.createImageData(d.nx, d.ny);
        for (let k = 0; k < d.pct.length; k++) img.data.set(couleurPente(d.pct[k], seuilPct), k * 4);
        ctx.putImageData(img, 0, 0);
        return toile.toDataURL('image/png');
    }

    // Jeton par champ, incrémenté à chaque retrait : un calcul de pentes lancé avant (grille MNT en
    // cours de chargement) est abandonné au lieu d'afficher une carte orpheline — cas d'un champ
    // supprimé pendant le chargement, dont l'image et les flèches restaient sur la carte.
    const jetonsPentes = new Map();

    function retirerPentes(sourceId) {
        jetonsPentes.set(sourceId, (jetonsPentes.get(sourceId) || 0) + 1);
        const e = pentesParSource.get(sourceId);
        if (!e) return;
        if (e.overlay) e.overlay.setMap(null);
        (e.fleches || []).forEach((f) => f.setMap(null));
        pentesParSource.delete(sourceId);
    }

    /** (Re)calcule et affiche la carte des pentes d'un champ au sol (grille chargée au besoin). */
    async function synchroniserPentes(sourceId) {
        const c = champ(sourceId);
        const map = carte();
        const T = window.CalepinageMaisonTerrain;
        if (!c || !c.origin || !map || !gmaps() || !T || !estChampAuSol(c) || !(c.state.roofLocal || []).length) {
            retirerPentes(sourceId);
            return;
        }
        const contour = c.state.roofLocal;
        const seuil = TT() ? TT().seuilsDuChamp(c.state).pentePct : 5;
        const cle = JSON.stringify([contour.map((p) => [p.x.toFixed(1), p.y.toFixed(1)]), seuil]);
        let e = pentesParSource.get(sourceId);
        if (!e || e.cle !== cle) {
            retirerPentes(sourceId);
            const jeton = jetonsPentes.get(sourceId);
            let grille;
            try {
                grille = await T.grillePourPoints(contour.map((p) => plat(CM.localToLatLng(c.origin, p))), { margeM: 10 });
            } catch (err) {
                return;   // pas de terrain : pas de carte des pentes
            }
            // Champ supprimé, renuméroté ou recalculé pendant le chargement de la grille : abandon.
            if (jetonsPentes.get(sourceId) !== jeton || !champ(sourceId)) return;
            const resolutionM = grille.geographique ? (grille.resY || 0) * 111320 : (grille.res || 1);
            const solLocal = (x, y) => {
                const ll = plat(CM.localToLatLng(c.origin, { x, y }));
                return grille.altitude(ll.lat, ll.lng);
            };
            const d = calculerPentes(contour, solLocal, { resolutionM });
            if (!d) return;
            const sw = plat(CM.localToLatLng(c.origin, { x: d.minX, y: d.maxY - d.ny * d.pas }));
            const ne = plat(CM.localToLatLng(c.origin, { x: d.minX + d.nx * d.pas, y: d.maxY }));
            const overlay = new google.maps.GroundOverlay(imagePentes(d, seuil),
                new google.maps.LatLngBounds(sw, ne), { opacity: 0.85, clickable: false });
            const fleches = d.descente.map((f) => {
                const lg = d.pasFleche * 0.55;
                const a = CM.localToLatLng(c.origin, { x: f.x - (f.dx * lg) / 2, y: f.y - (f.dy * lg) / 2 });
                const b = CM.localToLatLng(c.origin, { x: f.x + (f.dx * lg) / 2, y: f.y + (f.dy * lg) / 2 });
                return new google.maps.Polyline({
                    path: [a, b], strokeColor: '#1f2937', strokeOpacity: 0.9, strokeWeight: 1.5, zIndex: 12,
                    clickable: false,
                    icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.2, fillOpacity: 1 }, offset: '100%' }],
                });
            });
            e = { cle, overlay, fleches, donnees: d, resolutionM };
            pentesParSource.set(sourceId, e);
        }
        const visible = affichageActif() && pentesActives() && !masqueTemporaire && panneauxVisibles(sourceId);
        e.overlay.setMap(visible ? map : null);
        e.fleches.forEach((f) => f.setMap(visible ? map : null));
        majLegende();
    }

    // ── Tables signalées ──────────────────────────────────────────────────────────────────────

    function retirerOverlays(sourceId) {
        (overlaysParSource.get(sourceId) || []).forEach((p) => p.setMap(null));
        overlaysParSource.delete(sourceId);
    }

    function panneauxVisibles(sourceId) {
        return !(typeof CM.panneauxCarteVisibles === 'function' && !CM.panneauxCarteVisibles(sourceId));
    }

    function visible(sourceId) {
        return affichageActif() && !masqueTemporaire && panneauxVisibles(sourceId);
    }

    /** Redessine les tables signalées d'un champ sur la carte (+ canevas s'il est affiché). */
    function synchroniser(sourceId) {
        const map = carte();
        retirerOverlays(sourceId);
        const r = TT() && TT().resultat(sourceId);
        const c = champ(sourceId);
        if (map && gmaps() && r && c && c.origin) {
            const N = TT().NIVEAUX;
            const polys = [];
            r.tables.forEach((t) => {
                if (!t.analyse || t.niveau === 'ok' || !N[t.niveau] || !N[t.niveau].couleur) return;
                if (!niveauAffiche(t.niveau)) return;
                const poly = new google.maps.Polygon({
                    paths: t.coins.map((p) => CM.localToLatLng(c.origin, p)),
                    strokeColor: N[t.niveau].couleur, strokeOpacity: 1, strokeWeight: 2.5,
                    fillColor: N[t.niveau].couleur, fillOpacity: 0.35, zIndex: 11, clickable: true,
                    map: visible(sourceId) ? map : null,
                });
                poly.addListener('click', (e) => {
                    if (!infoBulle) infoBulle = new google.maps.InfoWindow();
                    infoBulle.setContent(detailTable(Object.assign({ sourceId }, t)));
                    infoBulle.setPosition(e.latLng);
                    infoBulle.open(map);
                });
                polys.push(poly);
            });
            overlaysParSource.set(sourceId, polys);
        }
        synchroniserApercu(sourceId);
        if (modeSuppression && modeSuppression.sourceId === sourceId) synchroniserSelection();
        if (CM.state && CM.state.sourceId === sourceId && typeof CM.render === 'function') {
            try { CM.render(); } catch (e) { /* canevas fermé */ }
        }
        majLegende();
    }

    /** Le canevas a-t-il des panneaux à colorer pour ce champ (aperçu en cours ou niveau coché) ? */
    function couleursActives(sourceId) {
        if (!affichageActif() || !TT()) return false;
        if (apercuParSource.has(sourceId)) return true;
        if (!TT().resultat(sourceId)) return false;
        return Object.keys(TT().NIVEAUX).some((k) => TT().NIVEAUX[k].couleur && niveauAffiche(k));
    }

    /** Couleur de remplissage d'un panneau du canevas (null = couleur habituelle). */
    function couleurPanneau(sourceId, panId, idxKey) {
        if (!affichageActif() || !TT()) return null;
        const apercu = apercuParSource.get(sourceId);
        if (apercu && apercu.retires.has(panId + '|' + idxKey)) return '#64748b';
        const niveau = TT().niveauPanneau(sourceId, panId, idxKey);
        const n = niveau && TT().NIVEAUX[niveau];
        return n && n.couleur && niveauAffiche(niveau) ? n.couleur : null;
    }

    // ── Aperçu d'un ajustement (panneaux qui seraient retirés) ─────────────────────────────────

    function retirerApercu(sourceId) {
        const a = apercuParSource.get(sourceId);
        if (a) (a.polys || []).forEach((p) => p.setMap(null));
        apercuParSource.delete(sourceId);
    }

    function synchroniserApercu(sourceId) {
        const a = apercuParSource.get(sourceId);
        const c = champ(sourceId);
        const map = carte();
        if (!a || !c || !map || !gmaps()) return;
        (a.polys || []).forEach((p) => p.setMap(null));
        a.polys = [];
        a.proposition.tables.forEach((t) => {
            const retires = new Set(t.panneauxRetires);
            (t.table.colonnes || []).forEach((col) => col.list.forEach((p) => {
                if (!retires.has(p.panelIndex) || typeof CM.panelCornersTrue !== 'function') return;
                a.polys.push(new google.maps.Polygon({
                    paths: CM.panelCornersTrue(p).map((q) => CM.localToLatLng(c.origin, q)),
                    strokeColor: '#0f172a', strokeOpacity: 0.9, strokeWeight: 1, fillColor: '#64748b',
                    fillOpacity: 0.75, zIndex: 13, clickable: false, map: visible(sourceId) ? map : null,
                }));
            }));
        });
    }

    function proposer(sourceId) {
        const proposition = TT().proposerAjustement(sourceId);
        retirerApercu(sourceId);
        if (!proposition || !proposition.tables.length) { majLegende(); return; }
        const retires = new Set();
        proposition.tables.forEach((t) => t.panneauxRetires.forEach((k) => retires.add(t.panId + '|' + k)));
        apercuParSource.set(sourceId, { proposition, retires, polys: [] });
        synchroniser(sourceId);
    }

    function appliquer(sourceId) {
        const a = apercuParSource.get(sourceId);
        retirerApercu(sourceId);
        if (a) TT().appliquerAjustement(a.proposition);
        majLegende();
    }

    function annuler(sourceId) {
        retirerApercu(sourceId);
        synchroniser(sourceId);
    }

    /** Masque tout le temps d'une capture de la carte ; renvoie la restauration. */
    function masquerTemporairement() {
        masqueTemporaire = true;
        overlaysParSource.forEach((polys) => polys.forEach((p) => p.setMap(null)));
        pentesParSource.forEach((e) => { e.overlay.setMap(null); e.fleches.forEach((f) => f.setMap(null)); });
        apercuParSource.forEach((a) => (a.polys || []).forEach((p) => p.setMap(null)));
        retirerSelection();
        const legendeAffichee = legende && legende.racine.style.display !== 'none';
        if (legende) legende.racine.style.display = 'none';
        return () => {
            masqueTemporaire = false;
            if (legende && legendeAffichee) legende.racine.style.display = '';
            Array.from(overlaysParSource.keys()).forEach(synchroniser);
            Array.from(pentesParSource.keys()).forEach((id) => synchroniserPentes(id));
            synchroniserSelection();
        };
    }

    // ── Suppression manuelle d'une table ou d'une rangée (mode activé dans la légende) ───────────
    // Mode actif : chaque table du champ devient cliquable (contour fin) ; survol = table ou rangée
    // visée en rouge ; clic = suppression (réversible : « Annuler la dernière », « Restaurer »).
    // Échap ou un nouveau clic sur le bouton actif quitte le mode.

    function retirerSelection() {
        selection.forEach((it) => it.poly.setMap(null));
        selection = [];
    }

    const STYLE_SELECTION = { strokeColor: '#0f172a', strokeOpacity: 0.85, strokeWeight: 1.5, fillColor: '#ffffff', fillOpacity: 0.08 };
    const STYLE_VISEE = { strokeColor: '#991b1b', strokeOpacity: 1, strokeWeight: 2.5, fillColor: '#dc2626', fillOpacity: 0.45 };

    function synchroniserSelection() {
        retirerSelection();
        if (!modeSuppression || masqueTemporaire || !TT()) return;
        const { sourceId, portee } = modeSuppression;
        const c = champ(sourceId);
        const map = carte();
        if (!c || !c.origin || !map || !gmaps()) return;
        const tables = TT().tablesPosees(sourceId);
        selection = tables.map((t) => ({
            table: t,
            poly: new google.maps.Polygon(Object.assign({
                paths: t.coins.map((p) => CM.localToLatLng(c.origin, p)), zIndex: 15, clickable: true, map,
            }, STYLE_SELECTION)),
        }));
        const surligner = (t, actif) => TT().tablesVisees(tables, t, portee).forEach((v) => {
            const it = selection.find((s) => s.table === v);
            if (it) it.poly.setOptions(actif ? STYLE_VISEE : STYLE_SELECTION);
        });
        selection.forEach(({ table, poly }) => {
            poly.addListener('mouseover', () => surligner(table, true));
            poly.addListener('mouseout', () => surligner(table, false));
            poly.addListener('click', () => {
                if (TT().supprimerTable(sourceId, table, portee)) synchroniserSelection();
                majLegende();
            });
        });
    }

    function basculerSuppression(sourceId, portee) {
        const memeMode = modeSuppression && modeSuppression.sourceId === sourceId && modeSuppression.portee === portee;
        modeSuppression = memeMode ? null : { sourceId, portee };
        if (infoBulle) infoBulle.close();
        synchroniserSelection();
        majLegende();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modeSuppression) basculerSuppression(modeSuppression.sourceId, modeSuppression.portee);
    });

    // ── Légende / réglages (fenêtre flottante déplaçable sur la carte) ───────────────────────────

    const CLE_POSITION = 'calepinageTerrainLegendePos';
    const CLE_REPLIEE = 'calepinageTerrainLegendeRepliee';

    function bouton(texte, titre, action, style) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = texte;
        b.title = titre;
        const styles = {
            danger: 'border:1px solid #b91c1c;background:#fee2e2;color:#7f1d1d',
            actif: 'border:1px solid #b91c1c;background:#b91c1c;color:#fff',
            normal: 'border:1px solid #cbd5e1;background:#fff;color:#1e293b',
        };
        b.style.cssText = 'padding:4px 10px;font-size:12.5px;line-height:1.3;border-radius:5px;cursor:pointer;'
            + (styles[style] || styles.normal);
        b.addEventListener('click', (e) => { e.stopPropagation(); action(); });
        return b;
    }

    function rangeeBoutons(boutons) {
        const d = document.createElement('div');
        d.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
        boutons.forEach((b) => d.appendChild(b));
        return d;
    }

    function caseACocher(texte, coche, surChangement) {
        const l = document.createElement('label');
        l.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = coche;
        c.style.margin = '0';
        c.addEventListener('change', () => surChangement(c.checked));
        l.append(c, document.createTextNode(texte));
        return l;
    }

    function champSeuil(libelle, valeur, unite, min, max, pas, titre, surChangement) {
        const l = document.createElement('label');
        l.title = titre;
        l.style.cssText = 'display:grid;grid-template-columns:1fr auto 22px;align-items:center;gap:8px;margin:6px 0';
        const i = document.createElement('input');
        i.type = 'number';
        i.min = String(min);
        i.max = String(max);
        i.step = String(pas);
        i.value = String(valeur);
        i.style.cssText = 'width:72px;font-size:13px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;text-align:right';
        // 'change' (validation, flèches) et non 'input' : la légende se reconstruit après chaque
        // changement, ce qui ferait perdre la saisie en cours.
        i.addEventListener('change', () => surChangement(Number(i.value)));
        i.addEventListener('click', (e) => e.stopPropagation());
        const u = document.createElement('span');
        u.textContent = unite;
        u.style.color = '#475569';
        l.append(document.createTextNode(libelle), i, u);
        return l;
    }

    function sousTitre(texte) {
        const d = document.createElement('div');
        d.textContent = texte;
        d.style.cssText = 'margin-top:12px;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#64748b';
        return d;
    }

    function champsAuSol() {
        try {
            return (CM.listerChampsCarte ? CM.listerChampsCarte() : []).filter(estChampAuSol).map((c) => c.sourceId);
        } catch (e) {
            return [];
        }
    }

    function lirePosition() {
        try { return JSON.parse(localStorage.getItem(CLE_POSITION) || 'null'); } catch (e) { return null; }
    }

    /** Place la fenêtre en (left, top) px dans la carte, sans qu'elle en sorte. */
    function placer(racine, left, top) {
        const parent = racine.parentElement;
        if (!parent) return;
        const maxL = Math.max(0, parent.clientWidth - racine.offsetWidth);
        const maxT = Math.max(0, parent.clientHeight - Math.min(racine.offsetHeight, parent.clientHeight));
        racine.style.left = Math.min(maxL, Math.max(0, left)) + 'px';
        racine.style.top = Math.min(maxT, Math.max(0, top)) + 'px';
        racine.style.bottom = 'auto';
    }

    /** Déplacement à la souris par la barre de titre ; position mémorisée dans le navigateur. */
    function rendreDeplacable(racine, poignee) {
        let depart = null;
        poignee.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.target.closest && e.target.closest('input,button,label'))) return;
            depart = { x: e.clientX, y: e.clientY, left: racine.offsetLeft, top: racine.offsetTop };
            try { poignee.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
            e.preventDefault();
        });
        poignee.addEventListener('pointermove', (e) => {
            if (!depart) return;
            placer(racine, depart.left + e.clientX - depart.x, depart.top + e.clientY - depart.y);
        });
        const fin = (e) => {
            if (!depart) return;
            depart = null;
            try { poignee.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ }
            try {
                localStorage.setItem(CLE_POSITION, JSON.stringify({ left: racine.offsetLeft, top: racine.offsetTop }));
            } catch (err) { /* navigation privée */ }
        };
        poignee.addEventListener('pointerup', fin);
        poignee.addEventListener('pointercancel', fin);
    }

    function creerLegende(map) {
        // Hôte positionné sur la carte ; le contenu vit dans un Shadow DOM : les styles globaux de la
        // page (labels en gras/agrandis, grilles, largeurs imposées) ne s'y appliquent plus.
        const racine = document.createElement('div');
        racine.style.cssText = 'position:absolute;left:10px;bottom:30px;z-index:5;max-width:calc(100% - 20px)';
        const ombre = typeof racine.attachShadow === 'function' ? racine.attachShadow({ mode: 'open' }) : racine;
        const style = document.createElement('style');
        style.textContent = STYLE_FENETRE;
        const fenetre = document.createElement('div');
        fenetre.className = 'fenetre';
        ombre.append(style, fenetre);
        // La carte ne doit ni se déplacer ni zoomer quand on agit dans la fenêtre.
        ['mousedown', 'pointerdown', 'dblclick', 'wheel', 'touchstart', 'contextmenu'].forEach((ev) =>
            racine.addEventListener(ev, (e) => e.stopPropagation()));
        const entete = document.createElement('div');
        entete.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;'
            + 'border-bottom:1px solid #e2e8f0;border-radius:8px 8px 0 0;cursor:move;user-select:none;flex:none';
        entete.title = 'Glisser pour déplacer la fenêtre';
        const poignee = document.createElement('span');
        poignee.textContent = '⠿';
        poignee.style.cssText = 'color:#94a3b8;font-size:15px';
        const zoneTitre = document.createElement('div');
        zoneTitre.style.cssText = 'flex:1;font-weight:600';
        const replier = document.createElement('button');
        replier.type = 'button';
        replier.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:15px;color:#475569;padding:0 4px';
        replier.addEventListener('click', (e) => {
            e.stopPropagation();
            ecrirePref(CLE_REPLIEE, !lirePref(CLE_REPLIEE, false));
            majLegende();
        });
        entete.append(poignee, zoneTitre, replier);
        const corps = document.createElement('div');
        corps.style.cssText = 'padding:4px 14px 14px;overflow-y:auto;overflow-x:hidden;min-height:0;flex:1 1 auto';
        fenetre.append(entete, corps);
        map.getDiv().appendChild(racine);
        rendreDeplacable(racine, entete);
        const pos = lirePosition();
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            // Taille connue seulement une fois le contenu posé : placement au prochain cycle.
            setTimeout(() => placer(racine, pos.left, pos.top), 0);
        }
        return { racine, fenetre, zoneTitre, replier, corps };
    }

    // Styles de la fenêtre (Shadow DOM) : :host remet à zéro ce que la page ferait hériter.
    const STYLE_FENETRE = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .fenetre { width: 380px; max-width: 100%; display: flex; flex-direction: column; background: #fff;
            border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.3); color: #1e293b;
            font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left; }
        div, span, label { font: inherit; color: inherit; margin: 0; padding: 0; float: none; width: auto;
            text-transform: none; letter-spacing: normal; white-space: normal; }
        label { font-weight: 400; }
        input[type=checkbox] { width: 15px; height: 15px; margin: 0; flex: none; }
        input[type=number] { font: inherit; }
        button { font: inherit; }
    `;

    function blocChamp(id, cles, N) {
        const r = TT().resultat(id);
        const c = champ(id);
        const s = TT().seuilsDuChamp(c && c.state);
        const bloc = document.createElement('div');
        bloc.style.cssText = 'border-top:1px solid #e2e8f0;padding-top:10px;margin-top:12px';
        const entete = document.createElement('div');
        entete.style.cssText = 'font-weight:600;font-size:14px';
        entete.textContent = libelleChamp(id);
        bloc.appendChild(entete);

        bloc.appendChild(sousTitre('Seuils'));
        bloc.appendChild(champSeuil('Garde min (bas PV et traverse)', s.gardePct, '%', 0, 100, 5,
            'Garde au sol minimale, en % de la hauteur prévue sur terrain plat : sous le bas des panneaux '
            + '(hauteur bas PV) et sous la traverse (hauteur de passage). En dessous, la table est hors seuil.',
            (v) => TT().definirSeuils(id, { gardePct: v })));
        bloc.appendChild(champSeuil('Pente max du terrain', s.pentePct, '%', 0.5, 30, 0.5,
            'Pente du terrain sous la table au-delà de laquelle la table est hors seuil',
            (v) => { TT().definirSeuils(id, { pentePct: v }); synchroniserPentes(id); }));
        bloc.appendChild(champSeuil('Ancrage enterré des poteaux', s.ancrageM, 'm', 0, 5, 0.1,
            'Partie du poteau enfoncée dans le sol, identique pour tous les poteaux quelle que soit la pente',
            (v) => TT().definirSeuils(id, { ancrageM: v })));

        bloc.appendChild(sousTitre('Analyse'));
        const resume = document.createElement('div');
        resume.style.marginTop = '4px';
        if (r) {
            const p = r.synthese.parNiveau;
            const morceaux = cles.filter((k) => p[k]).map((k) => `${p[k]} ${N[k].libelle.toLowerCase()}`);
            resume.innerHTML = `<div>${r.synthese.nbAnalysees} table(s) : ${morceaux.length ? morceaux.join(', ') : 'toutes conformes'}</div>`
                + `<div style="color:#475569">Pente max ${fmt(r.synthese.penteMaxPct)} % · garde min ${fmt(r.synthese.gardeMinM, 2)} m`
                + ` · ${r.source === 'ign' ? 'IGN' : r.source === 'copernicus' ? 'Copernicus 30 m' : r.source}</div>`;
        } else {
            resume.innerHTML = '<div style="color:#475569">Terrain non disponible pour ce champ.</div>';
        }
        bloc.appendChild(resume);

        if (r) {
            const p = r.synthese.parNiveau;
            const horsSeuils = TT().HORS_SEUILS.reduce((n, k) => n + (p[k] || 0), 0);
            const apercu = apercuParSource.get(id);
            if (apercu) {
                const pr = apercu.proposition;
                const raccourcies = pr.tables.filter((t) => t.colonnesGardees > 0).length;
                const info = document.createElement('div');
                info.style.cssText = 'margin-top:8px;padding:8px 10px;background:#f1f5f9;border-radius:6px';
                info.innerHTML = `<div><b>Ajustement proposé</b> (panneaux en gris)</div>`
                    + `<div>${raccourcies} table(s) raccourcie(s) ou scindée(s), ${pr.tables.length - raccourcies} retirée(s).</div>`
                    + `<div>${pr.panneauxRetires} panneau(x) retiré(s) au lieu de ${pr.panneauxSiRetraitComplet} en retirant les tables entières.</div>`;
                info.appendChild(rangeeBoutons([
                    bouton('Appliquer', 'Retire les panneaux en gris (réversible : Restaurer)', () => appliquer(id), 'danger'),
                    bouton('Annuler', 'Abandonne la proposition', () => annuler(id)),
                ]));
                bloc.appendChild(info);
            } else if (horsSeuils) {
                bloc.appendChild(rangeeBoutons([
                    bouton(`Retirer les tables hors seuils (${horsSeuils})`,
                        'Supprime les panneaux des tables enfoncées, en pente ou à garde insuffisante (réversible)',
                        () => TT().retirerTables(id), 'danger'),
                    bouton('Proposer un ajustement',
                        'Raccourcit ou scinde les tables hors seuils pour en garder le plus possible (aperçu avant application)',
                        () => proposer(id)),
                ]));
            }
        }

        bloc.appendChild(sousTitre('Supprimer à la main'));
        const actifIci = modeSuppression && modeSuppression.sourceId === id ? modeSuppression.portee : null;
        bloc.appendChild(rangeeBoutons([
            bouton(actifIci === 'table' ? 'Suppression de table : active' : 'Supprimer une table',
                'Active le mode puis cliquez une table sur la carte pour la supprimer (Échap pour quitter)',
                () => basculerSuppression(id, 'table'), actifIci === 'table' ? 'actif' : 'normal'),
            bouton(actifIci === 'rangee' ? 'Suppression de rangée : active' : 'Supprimer une rangée de sheds',
                'Active le mode puis cliquez une table : toute sa rangée de sheds est supprimée (Échap pour quitter)',
                () => basculerSuppression(id, 'rangee'), actifIci === 'rangee' ? 'actif' : 'normal'),
        ]));
        if (actifIci) {
            const aide = document.createElement('div');
            aide.style.cssText = 'margin-top:6px;color:#7f1d1d';
            aide.textContent = actifIci === 'table'
                ? 'Cliquez une table sur la carte pour la supprimer. Échap ou le bouton rouge pour arrêter.'
                : 'Cliquez une table sur la carte : toute sa rangée est supprimée. Échap ou le bouton rouge pour arrêter.';
            bloc.appendChild(aide);
        }
        const boutonsRetour = [];
        if (TT().nbSuppressionsAnnulables(id)) {
            boutonsRetour.push(bouton('Annuler la dernière suppression', 'Remet la dernière table ou rangée supprimée à la main',
                () => { TT().annulerDerniereSuppression(id); synchroniserSelection(); majLegende(); }));
        }
        const nbRetires = c && Array.isArray(c.state.terrainTablesRetirees) ? c.state.terrainTablesRetirees.length : 0;
        if (nbRetires) {
            boutonsRetour.push(bouton(`Restaurer (${nbRetires} panneaux)`,
                'Remet tous les panneaux retirés depuis cette fenêtre (tables hors seuils, ajustement, suppressions à la main)',
                () => { retirerApercu(id); TT().restaurerTables(id); synchroniserSelection(); majLegende(); }));
        }
        if (boutonsRetour.length) bloc.appendChild(rangeeBoutons(boutonsRetour));
        return bloc;
    }

    function majLegende() {
        const map = carte();
        if (!map || !gmaps() || !TT() || typeof map.getDiv !== 'function') return;
        const ids = champsAuSol().filter((id) => TT().resultat(id) || pentesParSource.has(id) || TT().tablesPosees(id).length);
        if (modeSuppression && !ids.includes(modeSuppression.sourceId)) { modeSuppression = null; retirerSelection(); }
        if (!legende) legende = creerLegende(map);
        legende.racine.style.display = ids.length && !masqueTemporaire ? '' : 'none';
        if (!ids.length) return;
        // Hauteur bornée à la carte : au-delà, le contenu défile dans la fenêtre au lieu de déborder.
        const hauteurCarte = map.getDiv().clientHeight || 600;
        legende.fenetre.style.maxHeight = Math.max(220, Math.round(hauteurCarte * 0.85) - 20) + 'px';
        const N = TT().NIVEAUX;

        legende.zoneTitre.innerHTML = '';
        legende.zoneTitre.appendChild(caseACocher('Terrain des champs solaires', affichageActif(), (v) => {
            ecrirePref(CLE_AFFICHAGE, v);
            if (!v && modeSuppression) { modeSuppression = null; retirerSelection(); }
            champsAuSol().forEach((id) => { synchroniser(id); synchroniserPentes(id); });
        }));
        const repliee = lirePref(CLE_REPLIEE, false);
        legende.replier.textContent = repliee ? '▸' : '▾';
        legende.replier.title = repliee ? 'Déplier' : 'Replier';
        const corps = legende.corps;
        corps.innerHTML = '';
        corps.style.display = repliee || !affichageActif() ? 'none' : '';
        if (repliee || !affichageActif()) return;

        const cles = ['enfoncee', 'pente_forte', 'garde_faible', 'pente_moyenne'];
        const toutCoche = pentesActives() && cles.every((k) => niveauAffiche(k));
        const enTeteAffichage = document.createElement('div');
        enTeteAffichage.style.cssText = 'display:flex;align-items:flex-end;justify-content:space-between;gap:8px';
        enTeteAffichage.appendChild(sousTitre('Affichage'));
        const boutonTout = bouton(toutCoche ? 'Tout désélectionner' : 'Tout sélectionner',
            toutCoche ? 'Masque la carte des pentes et toutes les catégories de tables'
                : 'Affiche la carte des pentes et toutes les catégories de tables',
            () => {
                const v = !toutCoche;
                ecrirePref(CLE_PENTES, v);
                cles.forEach((k) => ecrirePref(CLE_NIVEAU + k, v));
                champsAuSol().forEach((id) => { synchroniser(id); synchroniserPentes(id); });
                if (typeof CM.refresh3DView === 'function') {
                    try { CM.refresh3DView(); } catch (e) { /* 3D fermée */ }
                }
                majLegende();
            });
        boutonTout.style.padding = '2px 8px';
        boutonTout.style.fontSize = '11.5px';
        enTeteAffichage.appendChild(boutonTout);
        corps.appendChild(enTeteAffichage);
        const cases = document.createElement('div');
        cases.style.marginTop = '6px';
        cases.appendChild(caseACocher('Carte des pentes (couleurs + sens de la descente)', pentesActives(), (v) => {
            ecrirePref(CLE_PENTES, v);
            champsAuSol().forEach((id) => synchroniserPentes(id));
        }));
        corps.appendChild(cases);

        const ligneLegende = document.createElement('div');
        ligneLegende.style.cssText = 'margin-top:8px;display:grid;gap:4px';
        cles.forEach((k) => {
            const ligne = caseACocher(N[k].libelle, niveauAffiche(k), (v) => {
                ecrirePref(CLE_NIVEAU + k, v);
                champsAuSol().forEach((id) => synchroniser(id));
                if (typeof CM.refresh3DView === 'function') {
                    try { CM.refresh3DView(); } catch (e) { /* 3D fermée */ }
                }
            });
            const pastille = document.createElement('span');
            pastille.style.cssText = `flex:none;width:14px;height:14px;background:${N[k].couleur};border-radius:3px`;
            ligne.insertBefore(pastille, ligne.lastChild);
            ligneLegende.appendChild(ligne);
        });
        if (pentesActives()) {
            ligneLegende.insertAdjacentHTML('beforeend', '<div style="display:flex;align-items:center;gap:8px;margin-top:2px">Pente : 0 %'
                + '<span style="flex:1;max-width:150px;height:10px;border-radius:3px;'
                + 'background:linear-gradient(90deg,#16a34a,#facc15 30%,#f97316 50%,#b91c1c)"></span>2 × seuil</div>');
        }
        corps.appendChild(ligneLegende);

        ids.forEach((id) => corps.appendChild(blocChamp(id, cles, N)));
        // Fenêtre déplacée : le contenu a pu grandir, on la garde entière dans la carte.
        if (legende.racine.style.top && legende.racine.style.top !== 'auto') {
            placer(legende.racine, legende.racine.offsetLeft, legende.racine.offsetTop);
        }
    }

    document.addEventListener('terrainTablesAnalysees', (e) => {
        const id = e && e.detail && e.detail.sourceId;
        if (!id || !TT()) return;
        // Tables modifiées ou seuils changés : un aperçu calculé avant n'est plus valable.
        retirerApercu(id);
        if (!TT().resultat(id)) {   // champ sans table / terrain indisponible : on nettoie
            retirerOverlays(id);
            majLegende();
            if (CM.state && CM.state.sourceId === id && typeof CM.render === 'function') {
                try { CM.render(); } catch (err) { /* noop */ }
            }
            return;
        }
        synchroniser(id);
        // 3D ouverte sur ce champ : nouveaux seuils -> nouvelles couleurs des tables.
        if (e.detail.seuils && CM.state && CM.state.sourceId === id && typeof CM.refresh3DView === 'function') {
            try { CM.refresh3DView(); } catch (err) { /* 3D fermée */ }
        }
    });

    /**
     * Retire tout ce qui est affiché pour un champ qui n'existe plus (pentes, tables signalées,
     * aperçu) — filet après une suppression ou une renumérotation de champs PV.
     */
    function purgerChampsDisparus() {
        let presents;
        try {
            presents = new Set((CM.listerChampsCarte ? CM.listerChampsCarte() : []).map((c) => c.sourceId));
        } catch (e) {
            return;
        }
        const ids = new Set([...pentesParSource.keys(), ...overlaysParSource.keys(), ...apercuParSource.keys()]);
        let retire = false;
        ids.forEach((id) => {
            if (presents.has(id)) return;
            retirerOverlays(id); retirerPentes(id); retirerApercu(id);
            retire = true;
        });
        if (retire) majLegende();
    }

    // Après la suppression (et la renumérotation différée qui la suit) d'un champ PV.
    ['maisonShapeRemoved', 'maisonShapesRenumbered'].forEach((nom) => {
        document.addEventListener(nom, () => setTimeout(purgerChampsDisparus, 150));
    });

    CM.terrainCarte = {
        synchroniser, synchroniserPentes, couleurPanneau, couleursActives, niveauAffiche, masquerTemporairement,
        retirer: (sourceId) => { retirerOverlays(sourceId); retirerPentes(sourceId); retirerApercu(sourceId); majLegende(); },
        planifier: (sourceId) => {
            if (TT()) TT().planifier(sourceId);
            synchroniserPentes(sourceId).catch(() => { /* pas de terrain */ });
        },
        _pur: { calculerPentes, couleurPente, dansPolygone },
    };
})();
