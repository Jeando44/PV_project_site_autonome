/**
 * Calepinage multi-typologie — palette d'outils contextuelle posée sur le champ PV (canevas 2D).
 *
 * Demande explicite (2026-11-04) : un bouton d'accès sur chaque champ PV (milieu de l'arête du haut
 * à l'écran) ouvre une petite palette regroupant les actions sur le champ, sans aller les chercher
 * dans la barre d'outils (qui garde tous ses boutons).
 *
 * - Bouton et palette sont des éléments HTML SUPERPOSÉS au canevas (calque #cmPaletteChampCalque),
 *   jamais dessinés dedans : les exports (toDataURL du canevas, captures html2canvas de la carte)
 *   ne peuvent donc pas les contenir. Le calque porte en plus data-html2canvas-ignore.
 * - Les 5 outils existants ne sont PAS réimplémentés : la palette déclenche le clic du bouton
 *   d'origine (même id, même câblage dans calepinage_maison_formulaires.js). Icône et infobulle
 *   sont relues dans CalepinageMaisonToolbarConfig quand le bouton y figure.
 * - 6e outil (nouveau) : rotation libre du champ PV à la souris (mode panelToolMode 'rotateField',
 *   gestes branchés dans calepinage_maison_dessin.js). En fin de geste, le contour du polygone de
 *   la carte principale est réécrit (même recette que « Déplacer le champ PV »).
 * - Palette : bascule au clic sur le bouton d'accès uniquement ; reste ouverte après un outil.
 * - Option « Afficher/masquer » dans la barre d'outils (#cmTogglePaletteChampBtn), mémorisée dans
 *   le navigateur (préférence d'affichage, pas une donnée du projet).
 *
 * Positionnement recalculé à chaque rendu du canevas (CM.apresRenduCanevas, appelé par render()) et
 * au redimensionnement du canevas : le bouton suit déplacements, rotations, zoom et vue Nord-Sud.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    const CLE_VISIBLE = 'skv_cm_palette_champ_visible';
    const TAILLE_BOUTON = 30;   // px CSS
    const PAS_ROTATION_DEG = 1; // pas du geste de rotation (Maj : PAS_ROTATION_MAJ_DEG)
    const PAS_ROTATION_MAJ_DEG = 15;

    let calque = null;          // conteneur superposé au canevas
    const boutonsAcces = new Map(); // clé 'actif' ou sourceId d'un autre champ -> bouton (réemployé)
    let palette = null;
    let badgeRotation = null;
    let paletteOuverte = false;
    let observateur = null;

    // Outils de la palette. `id` = bouton existant dont on déclenche le clic ; `mode` = valeur de
    // CM.state.panelToolMode qui allume l'outil (surbrillance comme dans la barre d'outils).
    const OUTILS = [
        { id: 'cmMoveFieldBtn', mode: 'moveField' },
        { id: 'cmDeletePanelsBtn', mode: 'delete' },
        { id: 'cmDeletePanelsRectBtn', mode: 'deleteRect' },
        { id: 'cmFlipAzimuthBtn' },
        {
            id: 'calepinageMaisonInverserFaitageBtn',
            icone: '<i class="fas fa-exchange-alt"></i>',
            infobulle: "Inverser le faîtage : le tracer sur l'autre axe du rectangle (toiture divisée en pans uniquement)",
            indisponible: () => !CM.state || CM.state.divisionMode === 'none',
            actif: () => !!(CM.state && CM.state.ridgeAxisSwapped),
        },
        {
            action: 'rotation', mode: 'rotateField',
            icone: '<i class="fas fa-sync-alt"></i>',
            infobulle: 'Rotation du champ PV : cliquer-glisser autour du champ pour le faire pivoter (pas de 1°, Maj enfoncée = pas de 15°) — Échap pour annuler',
        },
    ];

    function estVisible() {
        try { return localStorage.getItem(CLE_VISIBLE) !== '0'; } catch (e) { return true; }
    }
    function memoriserVisible(v) {
        try { localStorage.setItem(CLE_VISIBLE, v ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
    }

    function configBarre(id) {
        const cfg = window.CalepinageMaisonToolbarConfig;
        if (!cfg || !Array.isArray(cfg.groups)) return null;
        for (const g of cfg.groups) {
            const b = (g.buttons || []).find((x) => x.id === id);
            if (b) return b;
        }
        return null;
    }

    function iconeOutil(outil) {
        if (outil.icone) return outil.icone;
        const b = configBarre(outil.id);
        if (!b) return '';
        return b.iconType === 'fa'
            ? `<i class="fas ${b.icon}"></i>`
            : `<img src="/static/concevoir_mon_projet/medias/icons/${b.icon}.svg" alt="" style="width:16px; height:16px; vertical-align:middle;">`;
    }
    function infobulleOutil(outil) {
        if (outil.infobulle) return outil.infobulle;
        const b = configBarre(outil.id);
        return b ? b.tooltip : '';
    }

    // ── Calque superposé au canevas ─────────────────────────────────────────────────────────
    function assurerCalque() {
        const canvas = CM.canvas;
        if (!canvas || !canvas.parentElement) return null;
        if (calque && calque.parentElement === canvas.parentElement) return calque;
        const parent = canvas.parentElement;
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        boutonsAcces.clear();
        calque = document.createElement('div');
        calque.id = 'cmPaletteChampCalque';
        calque.setAttribute('data-html2canvas-ignore', 'true');
        calque.style.cssText = 'position:absolute; left:0; top:0; width:0; height:0; overflow:visible; z-index:30; pointer-events:none;';
        parent.appendChild(calque);

        palette = document.createElement('div');
        palette.id = 'cmPaletteChamp';
        palette.style.cssText = 'position:absolute; display:none; gap:4px; padding:5px; background:#fff; border:1px solid #d1d5db; border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.18); pointer-events:auto; white-space:nowrap;';
        palette.innerHTML = OUTILS.map((o, i) => `
            <button type="button" class="cm-btn cm-icon-btn" data-outil-palette="${i}" title="${infobulleOutil(o).replace(/"/g, '&quot;')}"
                    style="width:30px; height:30px; padding:0; display:inline-flex; align-items:center; justify-content:center;">${iconeOutil(o)}</button>`).join('');
        palette.addEventListener('mousedown', (e) => e.stopPropagation());
        palette.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-outil-palette]');
            if (!btn || btn.disabled) return;
            e.stopPropagation();
            executerOutil(OUTILS[Number(btn.getAttribute('data-outil-palette'))]);
        });
        calque.appendChild(palette);

        badgeRotation = document.createElement('div');
        badgeRotation.style.cssText = 'position:absolute; display:none; padding:2px 6px; background:#111827; color:#fff; font-size:12px; border-radius:4px; pointer-events:none;';
        calque.appendChild(badgeRotation);

        if (typeof ResizeObserver === 'function') {
            if (observateur) observateur.disconnect();
            observateur = new ResizeObserver(() => positionner());
            observateur.observe(canvas);
        }
        return calque;
    }

    // Point canevas (pixels internes) -> pixels CSS dans le repère du calque.
    function versCalque(pt) {
        const canvas = CM.canvas;
        const rc = canvas.getBoundingClientRect();
        const rp = canvas.parentElement.getBoundingClientRect();
        const k = rc.width / (canvas.width || 1);
        return {
            x: rc.left - rp.left + canvas.parentElement.scrollLeft + pt.x * k,
            y: rc.top - rp.top + canvas.parentElement.scrollTop + pt.y * (rc.height / (canvas.height || 1)),
            bornes: { gauche: rc.left - rp.left, haut: rc.top - rp.top, largeur: rc.width, hauteur: rc.height },
        };
    }

    // Milieu de l'arête la plus HAUTE à l'écran du contour (emplacement demandé sur la capture).
    function ancreContour(roofLocal) {
        if (!roofLocal || roofLocal.length < 3 || typeof CM.metersToCanvas !== 'function') return null;
        const px = roofLocal.map(CM.metersToCanvas);
        let meilleur = null;
        px.forEach((a, i) => {
            const b = px[(i + 1) % px.length];
            const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
            if (!meilleur || m.y < meilleur.y) meilleur = m;
        });
        return meilleur;
    }

    function creerBoutonAcces(estActif, sourceId) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-palette-champ-acces';
        b.title = estActif
            ? "Outils du champ PV (cliquer pour ouvrir/fermer la palette)"
            : `Afficher ${sourceId} et ouvrir ses outils`;
        b.innerHTML = '<i class="fas fa-toolbox"></i>';
        b.style.cssText = `position:absolute; width:${TAILLE_BOUTON}px; height:${TAILLE_BOUTON}px; margin:0; padding:0; border-radius:50%;`
            + ' border:2px solid #fff; background:#dc2626; color:#fff; font-size:13px; cursor:pointer; pointer-events:auto;'
            + ' box-shadow:0 2px 6px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center;'
            + (estActif ? '' : ' opacity:0.75;');
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (b.dataset.actif === '1') {
                paletteOuverte = !paletteOuverte;
                positionner();
            } else if (typeof CM.switchToSource === 'function') {
                CM.switchToSource(b.dataset.sourceId);
                paletteOuverte = true;
                positionner();
            }
        });
        return b;
    }

    function canevasAffiche() {
        const c = CM.canvas;
        return !!(c && c.isConnected && c.style.display !== 'none' && c.getClientRects().length
            && (!CM.modal || CM.modal.style.display !== 'none') && !(CM.state && CM.state.view3DMode));
    }

    function borner(v, min, max) { return Math.max(min, Math.min(max, v)); }

    /** Repositionne bouton(s) d'accès et palette ; appelé après chaque rendu du canevas. */
    function positionner() {
        if (!assurerCalque()) return;
        const champActif = CM.state && (CM.state.roofLocal || []).length >= 3;
        if (!estVisible() || !canevasAffiche() || !champActif) {
            boutonsAcces.forEach((b) => { b.style.display = 'none'; });
            palette.style.display = 'none';
            majEtats();
            return;
        }

        const champs = [{ roofLocal: CM.state.roofLocal, actif: true, sourceId: CM.state.sourceId }];
        if (CM.multiHouseViewActive && Array.isArray(CM.autresChampsAffiches)) {
            CM.autresChampsAffiches.forEach((h) => champs.push({ roofLocal: h.roofLocal, actif: false, sourceId: h.sourceId }));
        }
        let posActif = null;
        const utilises = new Set();
        champs.forEach((ch) => {
            const a = ancreContour(ch.roofLocal);
            if (!a) return;
            const cle = ch.actif ? 'actif' : `autre:${ch.sourceId}`;
            utilises.add(cle);
            const p = versCalque(a);
            const bn = p.bornes;
            const demi = TAILLE_BOUTON / 2;
            // Toujours lisible : ramené dans le cadre du canevas si le champ en déborde (zoom).
            const x = borner(p.x, bn.gauche + demi, bn.gauche + bn.largeur - demi);
            const y = borner(p.y, bn.haut + demi, bn.haut + bn.hauteur - demi);
            let b = boutonsAcces.get(cle);
            if (!b) {
                b = creerBoutonAcces(ch.actif, ch.sourceId);
                b.dataset.actif = ch.actif ? '1' : '0';
                b.dataset.sourceId = ch.sourceId || '';
                calque.appendChild(b);
                boutonsAcces.set(cle, b);
            }
            b.style.display = 'flex';
            b.style.left = `${x - demi}px`;
            b.style.top = `${y - demi}px`;
            if (ch.actif) { posActif = { x, y, bornes: bn }; b.style.background = paletteOuverte ? '#991b1b' : '#dc2626'; }
        });

        boutonsAcces.forEach((b, cle) => { if (!utilises.has(cle)) b.style.display = 'none'; });

        if (paletteOuverte && posActif) {
            palette.style.display = 'flex';
            const w = palette.offsetWidth, h = palette.offsetHeight;
            const bn = posActif.bornes;
            let top = posActif.y - TAILLE_BOUTON / 2 - 6 - h;            // au-dessus du bouton
            if (top < bn.haut) top = posActif.y + TAILLE_BOUTON / 2 + 6; // sinon en dessous
            const left = borner(posActif.x - w / 2, bn.gauche, bn.gauche + bn.largeur - w);
            palette.style.left = `${left}px`;
            palette.style.top = `${top}px`;
        } else {
            palette.style.display = 'none';
        }
        majEtats();
    }

    /** Surbrillance des outils actifs + état du bouton de la barre d'outils. */
    function majEtats() {
        const btnBarre = CM.modalBody && CM.modalBody.querySelector('#cmTogglePaletteChampBtn');
        if (btnBarre) {
            const v = estVisible();
            btnBarre.style.background = v ? '#dc2626' : '#f5f5f5';
            btnBarre.style.color = v ? '#fff' : '#333';
        }
        if (!palette || !CM.state) return;
        palette.querySelectorAll('[data-outil-palette]').forEach((btn) => {
            const o = OUTILS[Number(btn.getAttribute('data-outil-palette'))];
            // Outil propre à la palette (rotation) : pas de bouton d'origine à chercher dans le modal.
            const indispo = o.indisponible ? o.indisponible()
                : (o.id ? !(CM.modalBody && CM.modalBody.querySelector(`#${o.id}`)) : false);
            const actif = o.actif ? o.actif() : (o.mode && CM.state.panelToolMode === o.mode);
            btn.disabled = !!indispo;
            btn.style.opacity = indispo ? '0.4' : '';
            btn.style.cursor = indispo ? 'not-allowed' : 'pointer';
            btn.style.background = actif ? '#dc2626' : '#f5f5f5';
            btn.style.color = actif ? '#fff' : '#333';
            const img = btn.querySelector('img');
            if (img) img.style.filter = actif ? 'invert(1)' : '';
        });
    }

    function executerOutil(outil) {
        if (!CM.state) return;
        if (outil.action === 'rotation') {
            CM.state.panelToolMode = CM.state.panelToolMode === 'rotateField' ? 'none' : 'rotateField';
            if (CM.state.panelToolMode !== 'none' && CM.state.panToolActive) {
                CM.state.panToolActive = false;
                if (typeof CM.updatePanToolUI === 'function') CM.updatePanToolUI();
            }
            if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
        } else {
            const original = CM.modalBody && CM.modalBody.querySelector(`#${outil.id}`);
            if (original) original.click();
        }
        majEtats();
    }

    // ── Outil n° 6 : rotation du champ PV ──────────────────────────────────────────────────
    // Même principe que le déplacement du champ (calepinage_maison_dessin.js) : instantané de la
    // géométrie au début du geste, transformation rejouée depuis l'instantané à chaque mouvement,
    // contour reporté sur la carte principale à la fin. Restent en place, car posés au sol : fond
    // de carte, matériels électriques / câbles / marqueurs, objets de la scène 3D.
    function instantane() {
        const s = CM.state;
        const copie = (p) => (p ? { x: p.x, y: p.y } : p);
        const segment = (l, k1, k2) => (l ? { ...l, [k1]: copie(l[k1]), [k2]: copie(l[k2]) } : l);
        return {
            roofLocal: s.roofLocal.map(copie),
            pans: s.pans.map((pan) => ({ points: (pan.points || []).map(copie), angle: pan.angle, azimuth: pan.azimuth })),
            obstacles: (s.obstacles || []).map((o) => ({ x: o.x, y: o.y, angle: o.angle })),
            ridge: segment(s.ridge, 'a', 'b'),
            ridgeLines: (s.ridgeLines || []).map((l) => segment(l, 'a', 'b')),
            freeLines: (s.freeLines || []).map((l) => segment(l, 'p1', 'p2')),
            polygonAzimuthDeg: s.polygonAzimuthDeg,
        };
    }

    function centreContour(pts) {
        const n = pts.length || 1;
        return pts.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n }), { x: 0, y: 0 });
    }

    function normaliserAzimut(az) {
        let a = ((az + 180) % 360 + 360) % 360 - 180;
        if (a === -180) a = 180;
        return Math.round(a * 10) / 10;
    }

    function appliquerRotation(g, centre, theta) {
        const s = CM.state;
        const r = (p) => {
            if (!p) return p;
            const q = CM.rotateAroundOrigin({ x: p.x - centre.x, y: p.y - centre.y }, theta);
            return { x: q.x + centre.x, y: q.y + centre.y };
        };
        const segment = (l, k1, k2) => (l ? { ...l, [k1]: r(l[k1]), [k2]: r(l[k2]) } : l);
        s.roofLocal = g.roofLocal.map(r);
        s.pans.forEach((pan, i) => {
            const gp = g.pans[i];
            if (!gp) return;
            pan.points = gp.points.map(r);
            pan.angle = gp.angle;
            pan.azimuth = gp.azimuth;
        });
        (s.obstacles || []).forEach((o, i) => {
            const go = g.obstacles[i];
            if (!go) return;
            const c = r(go);
            o.x = c.x; o.y = c.y;
            o.angle = (go.angle || 0) + theta;
        });
        s.ridge = segment(g.ridge, 'a', 'b');
        if (Array.isArray(s.ridgeLines)) s.ridgeLines = g.ridgeLines.map((l) => segment(l, 'a', 'b'));
        if (Array.isArray(s.freeLines)) s.freeLines = g.freeLines.map((l) => segment(l, 'p1', 'p2'));

        if (s.divisionMode === 'none' && s.pans.length) {
            // Toit non divisé : le pan unique PARTAGE le tableau du contour (cf. dessin.js).
            s.pans[0].points = s.roofLocal;
            // Polygone libre : l'azimut des panneaux est une référence absolue -> tourné avec le champ
            // (rotation trigonométrique, Nord en haut : l'azimut Sud=0/Ouest=90 diminue).
            if (s.contourMode === 'polygon') {
                s.polygonAzimuthDeg = normaliserAzimut((g.polygonAzimuthDeg || 0) - (theta * 180) / Math.PI);
                if (CM.polygonAzimuthInput) CM.polygonAzimuthInput.value = s.polygonAzimuthDeg;
            }
            const ref = CM.angleReferenceStable(s, s.roofLocal);
            CM.applyReferenceAngleToPan(s.pans[0], ref);
        } else {
            s.pans.forEach((pan) => { if (theta) CM.applyReferenceAngleToPan(pan, (pan.angle || 0) + theta); });
        }
    }

    function afficherBadge(e, deg) {
        if (!badgeRotation || !CM.canvas) return;
        const rp = CM.canvas.parentElement.getBoundingClientRect();
        badgeRotation.textContent = `Rotation : ${deg > 0 ? '+' : ''}${deg}°`;
        badgeRotation.style.left = `${e.clientX - rp.left + CM.canvas.parentElement.scrollLeft + 14}px`;
        badgeRotation.style.top = `${e.clientY - rp.top + CM.canvas.parentElement.scrollTop + 14}px`;
        badgeRotation.style.display = 'block';
    }

    /** Début du geste (mousedown sur le canevas en mode 'rotateField'). */
    function debutRotationChamp(e, meterPt) {
        if (!CM.state || (CM.state.roofLocal || []).length < 3 || e.button !== 0) return false;
        const centre = centreContour(CM.state.roofLocal);
        if (Math.hypot(meterPt.x - centre.x, meterPt.y - centre.y) < 1e-3) return false;
        CM.rotationChamp = {
            centre,
            angleDepart: Math.atan2(meterPt.y - centre.y, meterPt.x - centre.x),
            theta: 0,
            geometrie: instantane(),
        };
        if (CM.canvas) CM.canvas.style.cursor = 'grabbing';
        return true;
    }

    function suiviRotationChamp(e, meterPt) {
        const rot = CM.rotationChamp;
        if (!rot) return;
        const brut = Math.atan2(meterPt.y - rot.centre.y, meterPt.x - rot.centre.x) - rot.angleDepart;
        const pas = e.shiftKey ? PAS_ROTATION_MAJ_DEG : PAS_ROTATION_DEG;
        let deg = Math.round(((brut * 180) / Math.PI) / pas) * pas;
        deg = ((deg + 180) % 360 + 360) % 360 - 180;
        rot.theta = (deg * Math.PI) / 180;
        appliquerRotation(rot.geometrie, rot.centre, rot.theta);
        afficherBadge(e, -deg); // affiché dans le sens horaire (sens de lecture d'un azimut)
    }

    function finRotationChamp() {
        const rot = CM.rotationChamp;
        CM.rotationChamp = null;
        if (badgeRotation) badgeRotation.style.display = 'none';
        if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
        if (!rot) return;
        if (Math.abs(rot.theta) < 1e-6) { CM.render(); return; }
        // Contour reporté sur le polygone de la carte principale (silent : pas de réouverture du
        // modal ni de recadrage). Contour identique au sol à l'état déjà tourné : la
        // resynchronisation déclenchée par setPolygonPath n'a rien à refaire.
        const s = CM.state;
        if (s.sourceType === 'maps' && s.currentPolygonRef && s.roofLocalOrigin && window.MaisonPolygonManagerInstance) {
            const latLngs = s.roofLocal.map((pt) => CM.localToLatLng(s.roofLocalOrigin, pt));
            window.MaisonPolygonManagerInstance.setPolygonPath(s.currentPolygonRef, latLngs, { silent: true });
        }
        if (typeof CM.updateContourDimsUI === 'function') CM.updateContourDimsUI();
        CM.render();
        CM.recomputeResults();
    }

    /** Échap : annule le geste en cours. @returns {boolean} true si un geste a été annulé. */
    function annulerRotationChamp() {
        const rot = CM.rotationChamp;
        if (!rot) return false;
        appliquerRotation(rot.geometrie, rot.centre, 0);
        CM.rotationChamp = null;
        if (badgeRotation) badgeRotation.style.display = 'none';
        if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
        CM.render();
        return true;
    }

    // ── Option de la barre d'outils + rafraîchissement des états ──────────────────────────
    document.addEventListener('click', (e) => {
        const t = e.target && e.target.closest ? e.target.closest('#cmTogglePaletteChampBtn') : null;
        if (t) {
            memoriserVisible(!estVisible());
            positionner();
            return;
        }
        // Outil choisi depuis la barre d'outils (ou autre action du modal) : surbrillance à jour.
        if (palette && CM.modal && CM.modal.contains(e.target)) setTimeout(majEtats, 0);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && palette) setTimeout(majEtats, 0);
    });

    Object.assign(CM, {
        apresRenduCanevas: positionner,
        debutRotationChamp, suiviRotationChamp, finRotationChamp, annulerRotationChamp,
    });
    CM.rotationChamp = null;
})();
