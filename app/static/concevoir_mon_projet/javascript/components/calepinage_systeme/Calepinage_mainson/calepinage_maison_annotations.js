/**
 * Calepinage sur canevas — matériels électriques (organes, bornes IRVE, câbles) et marqueurs de
 * coordonnées (décimal et DMS), posés directement sur le canevas.
 *
 * Source de vérité UNIQUE : les gestionnaires de la carte principale (drawingControl.
 * localisationMatElec et drawingControl.geocodingMarkerManager). Un élément posé sur le canevas est
 * converti en lat/lng puis créé par ces gestionnaires : il apparaît donc aussi sur la carte, il est
 * sauvegardé comme ceux posés sur la carte (matériels électriques), il figure sur les plans capturés,
 * et inversement tout élément posé sur la carte est redessiné ici. Aucune donnée n'est dupliquée dans
 * CM.state.
 *
 * Gestes (identiques à la carte) : clic = poser (l'outil reste actif), câble = clics successifs puis
 * double-clic pour terminer, glisser = déplacer, clic droit = supprimer, Échap = quitter l'outil.
 * Réservé aux champs PV dessinés sur la carte : une image importée n'a pas de coordonnées réelles.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};

    // Même liste, mêmes couleurs que le sous-menu de la carte (ButtonControl.toggleMatElecMenu).
    const ITEMS_MAT_ELEC = [
        { id: 'IRVE', title: 'Borne IRVE', icon: '🚗', color: '#1E8449' },
        { id: 'PDL', title: 'PDL', icon: '⚡', color: '#FDE047' },
        { id: 'TGBT_Batiment', title: 'TGBT Bâtiment', color: '#EF4444' },
        { id: 'TGBT_PV', title: 'TGBT PV', color: '#EAB308' },
        { id: 'TGBT_IRVE', title: 'TGBT IRVE', color: '#3B82F6' },
        { id: 'TGBT_PV_IRVE', title: 'TGBT PV & IRVE', color: '#8B5CF6' },
        { id: 'Poste_Soutirage', title: 'Poste Soutirage', color: '#F97316' },
        { id: 'Poste_Production', title: 'Poste Production', color: '#10B981' },
        { id: 'CABLE', title: 'Tracer un câble (double-clic pour terminer)', icon: '〰️', color: '#9CA3AF' },
    ];
    const TOGGLES_MAT_ELEC = [
        { id: 'TOGGLE_IRVE', title: 'Afficher/Masquer IRVE', icon: '👁️🚗' },
        { id: 'TOGGLE_ORGANES', title: 'Afficher/Masquer Organes', icon: '👁️⚡' },
        { id: 'TOGGLE_CABLES', title: 'Afficher/Masquer Câbles', icon: '👁️〰️' },
        { id: 'TOGGLE_LABELS', title: 'Afficher/Masquer Labels', icon: '🏷️' },
    ];
    const RAYON_CLIC_PX = 11;
    const COULEUR_ACTIF = '#dc2626';

    // Outil actif : null | {kind:'matelec', type} | {kind:'cable'} | {kind:'coord'}. Transverse (hors
    // CM.state) : un élément posé l'est en lat/lng, indépendamment du champ PV affiché.
    CM.modeAnnotationActif = null;
    let cableEnCours = [];      // google.maps.LatLng[]
    let pointeurCable = null;   // {x,y} mètres locaux (aperçu du segment suivant)
    let glisse = null;          // {kind:'matelec'|'coord', marker}
    let versCanvas = null;      // metersToCanvas du dernier rendu (tests de clic en pixels)

    // ------------------------------------------------------------------------------------------
    // Accès aux gestionnaires de la carte / conversions
    // ------------------------------------------------------------------------------------------
    function gestMatElec() {
        return (window.drawingControl && window.drawingControl.localisationMatElec) || null;
    }
    function gestCoord() {
        return (window.drawingControl && window.drawingControl.geocodingMarkerManager) || null;
    }
    function origine() {
        const s = CM.state;
        return (s && s.sourceType === 'maps' && s.roofLocalOrigin && typeof s.roofLocalOrigin.lat === 'function')
            ? s.roofLocalOrigin : null;
    }
    function positionMarqueur(marker) {
        if (!marker) return null;
        if (typeof marker.getPosition === 'function') return marker.getPosition();
        const p = marker.position;
        if (!p) return null;
        return typeof p.lat === 'function' ? p : new google.maps.LatLng(p.lat, p.lng);
    }
    function versCanvasLatLng(latLng) {
        const o = origine();
        if (!o || !latLng || !versCanvas) return null;
        return versCanvas(CM.latLngToLocal(o, latLng));
    }
    function cheminCable(cable) {
        return (cable && typeof cable.getPath === 'function') ? cable.getPath().getArray() : [];
    }
    function longueurCableM(chemin) {
        const sph = window.google && google.maps.geometry && google.maps.geometry.spherical;
        if (sph && typeof sph.computeLength === 'function') return sph.computeLength(chemin);
        let total = 0;
        for (let i = 1; i < chemin.length; i++) {
            const a = CM.latLngToLocal(chemin[0], chemin[i - 1]);
            const b = CM.latLngToLocal(chemin[0], chemin[i]);
            total += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return total;
    }
    function texteLongueur(m) {
        return m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
    }
    function formatDMS(valeur, estLng) {
        const g = gestCoord();
        if (g && typeof g.formatDMS === 'function') return g.formatDMS(valeur, estLng);
        const dir = valeur < 0 ? (estLng ? 'W' : 'S') : (estLng ? 'E' : 'N');
        const abs = Math.abs(valeur);
        const deg = Math.floor(abs);
        const min = Math.floor((abs - deg) * 60);
        const sec = ((abs - deg - min / 60) * 3600).toFixed(2);
        return `${deg}°${min}'${sec}"${dir}`;
    }
    function lignesCoordonnees(latLng) {
        const lat = latLng.lat(), lng = latLng.lng();
        return [`Long: ${lng.toFixed(6)} (${formatDMS(lng, true)})`, `Lat: ${lat.toFixed(6)} (${formatDMS(lat, false)})`];
    }
    function signaler(message) {
        const modal = window.drawingControl && window.drawingControl.errorModal;
        if (modal && typeof modal.show === 'function') modal.show(message);
        else console.warn('[Calepinage annotations]', message);
    }

    // ------------------------------------------------------------------------------------------
    // Outils
    // ------------------------------------------------------------------------------------------
    function autreOutilActif() {
        const s = CM.state || {};
        return !!(s.tracingContourRect || s.drawingContourPolygon || s.tracingFreeLine || s.tracingRidge
            || s.panToolActive || (s.panelToolMode && s.panelToolMode !== 'none') || CM.pendingObstacleType);
    }

    function desactiverModeAnnotation() {
        CM.modeAnnotationActif = null;
        cableEnCours = [];
        pointeurCable = null;
        majBoutonsUI();
        if (CM.canvas) CM.canvas.style.cursor = 'default';
        if (typeof CM.render === 'function') CM.render();
    }

    function activerModeAnnotation(mode) {
        const courant = CM.modeAnnotationActif;
        const identique = courant && courant.kind === mode.kind && courant.type === mode.type;
        if (identique) { desactiverModeAnnotation(); return; }
        if (!origine()) {
            signaler("Les matériels électriques et les marqueurs de coordonnées se placent sur un champ PV dessiné sur la carte (pas sur une image importée).");
            return;
        }
        if (mode.kind === 'coord' && (!gestCoord() || !window.drawingControl.AdvancedMarkerElement)) {
            signaler('Carte en cours de chargement : réessayez dans un instant.');
            return;
        }
        if (mode.kind !== 'coord' && !gestMatElec()) {
            signaler('Carte en cours de chargement : réessayez dans un instant.');
            return;
        }
        // Un seul outil à la fois sur le canevas.
        const s = CM.state;
        if ((s.tracingContourRect || s.drawingContourPolygon) && typeof CM.cancelContourDraw === 'function') CM.cancelContourDraw();
        s.tracingFreeLine = false; s.freeLineTemp = null;
        s.tracingRidge = false; s.ridgeTemp = null;
        s.panelToolMode = 'none';
        s.panToolActive = false;
        ['updateFreeLineButtonUI', 'updateRidgeButtonUI', 'updatePanelToolButtonsUI', 'updatePanToolUI'].forEach((fn) => {
            try { if (typeof CM[fn] === 'function') CM[fn](); } catch (e) { /* bouton absent */ }
        });
        CM.modeAnnotationActif = mode;
        cableEnCours = [];
        pointeurCable = null;
        majBoutonsUI();
        if (CM.canvas) CM.canvas.style.cursor = 'crosshair';
        if (typeof CM.render === 'function') CM.render();
    }

    // ------------------------------------------------------------------------------------------
    // Tests de clic (pixels canevas)
    // ------------------------------------------------------------------------------------------
    function distanceSegmentPx(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    function trouverAnnotation(meterPt, avecCables) {
        if (!origine() || !versCanvas) return null;
        const p = versCanvas(meterPt);
        const proche = (marker) => {
            const c = versCanvasLatLng(positionMarqueur(marker));
            return c && Math.hypot(c.x - p.x, c.y - p.y) <= RAYON_CLIC_PX;
        };
        const g = gestCoord();
        if (g) {
            const m = g.markers.slice().reverse().find(proche);
            if (m) return { kind: 'coord', marker: m };
        }
        const me = gestMatElec();
        if (me) {
            const organes = me.showOrganes ? me.organeMarkers : [];
            const irve = me.isIrveVisible ? me.irveMarkers : [];
            const m = organes.concat(irve).reverse().find(proche);
            if (m) return { kind: 'matelec', marker: m };
            if (avecCables && me.areCablesVisible) {
                const cable = me.cables.slice().reverse().find((c) => {
                    const pts = cheminCable(c).map(versCanvasLatLng).filter(Boolean);
                    for (let i = 1; i < pts.length; i++) if (distanceSegmentPx(p, pts[i - 1], pts[i]) <= 6) return true;
                    return false;
                });
                if (cable) return { kind: 'cable', cable };
            }
        }
        return null;
    }

    // ------------------------------------------------------------------------------------------
    // Souris (appelés par calepinage_maison_dessin.js ; true = événement consommé)
    // ------------------------------------------------------------------------------------------
    function annotationsMouseDown(e, meterPt) {
        if (e.button !== undefined && e.button !== 0) return false;
        const mode = CM.modeAnnotationActif;
        if (mode && autreOutilActif()) {
            // Un autre outil a été activé depuis : il reprend la main.
            CM.modeAnnotationActif = null;
            cableEnCours = [];
            majBoutonsUI();
            return false;
        }
        if (mode) {
            const o = origine();
            if (!o) { desactiverModeAnnotation(); return true; }
            const latLng = CM.localToLatLng(o, meterPt);
            if (mode.kind === 'matelec') {
                gestMatElec().placeMarker(latLng, mode.type);
            } else if (mode.kind === 'coord') {
                gestCoord().placeMarker(latLng);
            } else if (mode.kind === 'cable') {
                if (e.detail >= 2 && cableEnCours.length) {
                    // 2e clic d'un double-clic : le point a déjà été posé par le 1er clic.
                    if (cableEnCours.length >= 2) {
                        const me = gestMatElec();
                        me.restoreCable(cableEnCours.slice());
                        me.saveData();
                    }
                    cableEnCours = [];
                    pointeurCable = null;
                    desactiverModeAnnotation(); // comme sur la carte : l'outil câble se referme
                } else {
                    cableEnCours.push(latLng);
                }
            }
            return true;
        }
        if (autreOutilActif()) return false;
        const hit = trouverAnnotation(meterPt, false);
        if (hit) {
            glisse = hit;
            if (CM.canvas) CM.canvas.style.cursor = 'grabbing';
            return true;
        }
        return false;
    }

    function annotationsMouseMove(e, meterPt, surCanvas) {
        const o = origine();
        if (glisse && o) {
            const latLng = CM.localToLatLng(o, meterPt);
            if (glisse.kind === 'matelec') {
                glisse.marker.setPosition(latLng);
            } else {
                glisse.marker.position = latLng;
                const label = glisse.marker.content && glisse.marker.content.firstChild;
                if (label) label.innerHTML = lignesCoordonnees(latLng).join('<br>');
            }
            return true;
        }
        const mode = CM.modeAnnotationActif;
        if (mode && mode.kind === 'cable' && cableEnCours.length && surCanvas) {
            pointeurCable = meterPt;
            return true;
        }
        CM.survolAnnotation = false;
        if (mode && surCanvas && CM.canvas) CM.canvas.style.cursor = 'crosshair';
        else if (!mode && surCanvas && CM.canvas && !autreOutilActif() && trouverAnnotation(meterPt, false)) {
            CM.survolAnnotation = true; // lu par dessin.js::majSurvolChampPv (ne pas écraser le curseur)
            CM.canvas.style.cursor = 'grab';
        }
        return false;
    }

    function annotationsMouseUp() {
        if (!glisse) return false;
        if (glisse.kind === 'matelec' && gestMatElec()) gestMatElec().saveData();
        glisse = null;
        if (CM.canvas) CM.canvas.style.cursor = CM.modeAnnotationActif ? 'crosshair' : 'default';
        return true;
    }

    function annotationsContextMenu(e, meterPt) {
        if (CM.modeAnnotationActif && CM.modeAnnotationActif.kind === 'cable' && cableEnCours.length) {
            cableEnCours = [];
            pointeurCable = null;
            return true;
        }
        const hit = trouverAnnotation(meterPt, true);
        if (!hit) return false;
        const me = gestMatElec();
        if (hit.kind === 'coord') {
            hit.marker.map = null;
            const g = gestCoord();
            g.markers = g.markers.filter((m) => m !== hit.marker);
        } else if (hit.kind === 'matelec') {
            hit.marker.setMap(null);
            me.irveMarkers = me.irveMarkers.filter((m) => m !== hit.marker);
            me.organeMarkers = me.organeMarkers.filter((m) => m !== hit.marker);
            me.saveData();
        } else {
            hit.cable.setMap(null);
            if (hit.cable.lengthLabel) hit.cable.lengthLabel.setMap(null);
            me.cables = me.cables.filter((c) => c !== hit.cable);
            me.saveData();
        }
        return true;
    }

    // ------------------------------------------------------------------------------------------
    // Rendu (appelé à la fin de render())
    // ------------------------------------------------------------------------------------------
    function texteContoure(ctx, texte, x, y, couleur, police) {
        ctx.font = police;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fff';
        ctx.strokeText(texte, x, y);
        ctx.fillStyle = couleur;
        ctx.fillText(texte, x, y);
    }

    function dessinerCable(ctx, pts, avecLongueur, chemin, apercu) {
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 3;
        if (apercu) ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!avecLongueur) return;
        // Libellé au milieu du tracé (en longueur écran).
        const longueursPx = [];
        let totalPx = 0;
        for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            longueursPx.push(d);
            totalPx += d;
        }
        let reste = totalPx / 2, milieu = pts[0];
        for (let i = 1; i < pts.length; i++) {
            if (reste <= longueursPx[i - 1]) {
                const t = longueursPx[i - 1] ? reste / longueursPx[i - 1] : 0;
                milieu = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
                break;
            }
            reste -= longueursPx[i - 1];
        }
        texteContoure(ctx, texteLongueur(longueurCableM(chemin)), milieu.x, milieu.y - 6, '#FF0000', 'bold 12px sans-serif');
    }

    function renderAnnotations(ctx, metersToCanvas) {
        versCanvas = metersToCanvas;
        if (!origine()) return;
        const me = gestMatElec();
        if (me) {
            if (me.areCablesVisible) {
                me.cables.forEach((c) => {
                    const chemin = cheminCable(c);
                    dessinerCable(ctx, chemin.map(versCanvasLatLng).filter(Boolean), me.showLabels, chemin, false);
                });
            }
            const marqueurs = (me.showOrganes ? me.organeMarkers : []).concat(me.isIrveVisible ? me.irveMarkers : []);
            marqueurs.forEach((m) => {
                const c = versCanvasLatLng(positionMarqueur(m));
                const cfg = me.ORGANE_TYPES[m.matElecType];
                if (!c || !cfg) return;
                ctx.beginPath();
                if (m.matElecType === 'IRVE') ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
                else ctx.rect(c.x - 7, c.y - 7, 14, 14);
                ctx.fillStyle = cfg.color;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
                if (me.showLabels) texteContoure(ctx, cfg.title, c.x, c.y - 13, cfg.color, 'bold 13px sans-serif');
            });
        }
        if (cableEnCours.length) {
            const pts = cableEnCours.map(versCanvasLatLng).filter(Boolean);
            if (pointeurCable) pts.push(metersToCanvas(pointeurCable));
            const chemin = pointeurCable ? cableEnCours.concat([CM.localToLatLng(origine(), pointeurCable)]) : cableEnCours;
            dessinerCable(ctx, pts, true, chemin, true);
            pts.slice(0, cableEnCours.length).forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = '#FF0000';
                ctx.fill();
            });
        }
        const g = gestCoord();
        if (g) {
            g.markers.forEach((m) => {
                const pos = positionMarqueur(m);
                const c = versCanvasLatLng(pos);
                if (!c) return;
                ctx.beginPath();
                ctx.moveTo(c.x - 6, c.y - 6); ctx.lineTo(c.x + 6, c.y + 6);
                ctx.moveTo(c.x + 6, c.y - 6); ctx.lineTo(c.x - 6, c.y + 6);
                ctx.strokeStyle = '#FF0000';
                ctx.lineWidth = 3;
                ctx.stroke();
                const lignes = lignesCoordonnees(pos);
                ctx.font = 'bold 12px sans-serif';
                const largeur = Math.max(...lignes.map((l) => ctx.measureText(l).width)) + 16;
                const hauteur = 38;
                const x = c.x - largeur / 2, y = c.y - 14 - hauteur;
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#FF0000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.rect(x, y, largeur, hauteur);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#000';
                ctx.textAlign = 'left';
                ctx.fillText(lignes[0], x + 8, y + 16);
                ctx.fillText(lignes[1], x + 8, y + 31);
            });
        }
    }

    /** Masque temporairement sur la carte ce que ce module redessine (capture du fond du canevas). */
    function masquerAnnotationsCarte() {
        const restaurations = [];
        const me = gestMatElec();
        if (me) {
            me.irveMarkers.concat(me.organeMarkers).forEach((m) => {
                const map = m.getMap && m.getMap();
                if (map) { m.setMap(null); restaurations.push(() => m.setMap(map)); }
            });
            me.cables.forEach((c) => {
                const map = c.getMap && c.getMap();
                if (map) { c.setMap(null); restaurations.push(() => c.setMap(map)); }
                const label = c.lengthLabel;
                const mapLabel = label && label.getMap && label.getMap();
                if (mapLabel) { label.setMap(null); restaurations.push(() => label.setMap(mapLabel)); }
            });
        }
        const g = gestCoord();
        if (g) {
            g.markers.forEach((m) => {
                const map = m.map;
                if (map) { m.map = null; restaurations.push(() => { m.map = map; }); }
            });
        }
        return () => restaurations.forEach((fn) => fn());
    }

    // ------------------------------------------------------------------------------------------
    // Barre d'outils du modal
    // ------------------------------------------------------------------------------------------
    function annotationsToolbarHTML() {
        const boutonItem = (it, attr) => {
            const contenu = it.icon
                ? `<span style="color:${it.color || '#333'}; font-size:15px; line-height:1;">${it.icon}</span>`
                : `<span style="display:inline-block; width:14px; height:14px; background:${it.color}; border:1px solid #999; border-radius:2px;"></span>`;
            return `<button type="button" class="cm-btn cm-icon-btn" ${attr}="${it.id}" title="${it.title}" style="flex-shrink:0; width:32px; height:32px; padding:0;">${contenu}</button>`;
        };
        return `
            <div style="position:relative; flex-shrink:0;">
                <button id="cmMatElecMenuBtn" class="cm-btn cm-icon-btn" type="button" title="Matériels électriques (placer sur le canevas)" style="flex-shrink:0;">
                    <img src="/static/concevoir_mon_projet/medias/icons/performance-labels.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">
                </button>
                <div id="cmMatElecMenuPopup" style="display:none; position:absolute; top:38px; left:0; background:#fff; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.15); padding:6px; gap:4px; z-index:1001; align-items:center;">
                    ${ITEMS_MAT_ELEC.map((it) => boutonItem(it, 'data-mat-elec')).join('')}
                    <span style="width:2px; align-self:stretch; background:#ccc; margin:0 4px; border-radius:1px;"></span>
                    ${TOGGLES_MAT_ELEC.map((it) => boutonItem(it, 'data-mat-elec-toggle')).join('')}
                </div>
            </div>
            <button id="cmCoordMarkerBtn" class="cm-btn cm-icon-btn" type="button" title="Placer un marqueur de coordonnées (Décimal et DMS)" style="flex-shrink:0;">
                <img src="/static/concevoir_mon_projet/medias/icons/location-svgrepo-com.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">
            </button>
        `;
    }

    function styleActif(btn, actif) {
        if (!btn) return;
        btn.style.background = actif ? COULEUR_ACTIF : '';
        btn.style.borderColor = actif ? COULEUR_ACTIF : '';
        btn.setAttribute('aria-pressed', actif ? 'true' : 'false');
    }

    function majBoutonsUI() {
        if (!CM.modalBody) return;
        const mode = CM.modeAnnotationActif;
        styleActif(CM.modalBody.querySelector('#cmCoordMarkerBtn'), !!(mode && mode.kind === 'coord'));
        const img = CM.modalBody.querySelector('#cmCoordMarkerBtn img');
        if (img) img.style.filter = mode && mode.kind === 'coord' ? 'brightness(0) invert(1)' : '';
        CM.modalBody.querySelectorAll('[data-mat-elec]').forEach((btn) => {
            const id = btn.getAttribute('data-mat-elec');
            const actif = !!(mode && ((mode.kind === 'cable' && id === 'CABLE') || (mode.kind === 'matelec' && mode.type === id)));
            btn.style.outline = actif ? `2px solid ${COULEUR_ACTIF}` : '';
            btn.setAttribute('aria-pressed', actif ? 'true' : 'false');
        });
        const trigger = CM.modalBody.querySelector('#cmMatElecMenuBtn');
        if (trigger) trigger.style.borderColor = mode && mode.kind !== 'coord' ? COULEUR_ACTIF : '';
    }

    function wireAnnotationsToolbar() {
        if (!CM.modalBody) return;
        const trigger = CM.modalBody.querySelector('#cmMatElecMenuBtn');
        const popup = CM.modalBody.querySelector('#cmMatElecMenuPopup');
        if (trigger && popup) {
            trigger.addEventListener('click', () => {
                popup.style.display = popup.style.display === 'none' ? 'flex' : 'none';
            });
        }
        CM.modalBody.querySelectorAll('[data-mat-elec]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-mat-elec');
                activerModeAnnotation(id === 'CABLE' ? { kind: 'cable' } : { kind: 'matelec', type: id });
            });
        });
        CM.modalBody.querySelectorAll('[data-mat-elec-toggle]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const me = gestMatElec();
                if (!me) return;
                me.toggleVisibility(btn.getAttribute('data-mat-elec-toggle'));
                if (typeof CM.render === 'function') CM.render();
            });
        });
        const coordBtn = CM.modalBody.querySelector('#cmCoordMarkerBtn');
        if (coordBtn) coordBtn.addEventListener('click', () => activerModeAnnotation({ kind: 'coord' }));
        majBoutonsUI();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !CM.modeAnnotationActif) return;
        if (!CM.modal || CM.modal.style.display === 'none') return;
        desactiverModeAnnotation();
    });

    Object.assign(CM, {
        renderAnnotations, annotationsMouseDown, annotationsMouseMove, annotationsMouseUp, annotationsContextMenu,
        annotationsToolbarHTML, wireAnnotationsToolbar, activerModeAnnotation, desactiverModeAnnotation,
        masquerAnnotationsCarte,
    });
})();
