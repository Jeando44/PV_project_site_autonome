/**
 * Calepinage résidentiel — Dessin : rendu canvas 2D, interaction souris (obstacles/panneaux/pan de
 * vue/tracé de contour et de faîtage), capture alignée de la vue carte, rendu du plan de coupe.
 *
 * 2e fichier de la scission de calepinage_maison_indiv.js — cf. calepinage_maison_calculs.js pour
 * le contexte général du namespace partagé window.CalepinageMaisonIndiv (CM).
 *
 * Possède les flags d'interaction souris partagés (CM.isDraggingObstacle, CM.ghostEl, etc.) : ils
 * sont mutés ici mais réinitialisés par orchestrateur (switchToSource), d'où leur exposition en
 * propriétés CM. plutôt qu'en `let` de portée fichier.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // Flags d'interaction canvas (drag obstacle existant, redimensionnement, dépose depuis la
    // palette, pan de la vue, déplacement de panneaux) — CM.xxx car réinitialisés par
    // orchestrateur::switchToSource lors d'un changement de source.
    CM.isDraggingObstacle = false;
    CM.dragOffset = { x: 0, y: 0 };
    CM.isResizingObstacle = false;
    CM.resizeObstacleId = null;
    CM.pendingObstacleType = null;
    CM.ghostEl = null;
    CM.isPanningCanvas = false;
    CM.panStart = null;
    CM.isMovingPanels = false;
    CM.movingPanId = null;
    CM.moveStart = null;
    CM.lastMeterPt = null;
    // NOUVEAU (demande explicite, étude de faisabilité validée : "modifier le rectangle/le polygone
    // directement sur le canva, en modifiant les arêtes") : glissé d'un sommet du CONTOUR (pas un
    // obstacle). Uniquement en divisionMode 'none' (toit pas encore divisé en pans — décision
    // explicite : bloquer sinon, plutôt que ré-diviser automatiquement ou tenter de faire suivre les
    // pans existants).
    CM.isDraggingContourVertex = false;
    CM.draggedVertexIndex = -1;
    // 2026-10-09 : gestes en cours des outils « suppression par rectangle » ({a, b} en mètres
    // locaux, angle de la grille, restaurer) et « déplacer le champ PV » ({depart, dx, dy,
    // geometrie}), null sinon.
    CM.rectSuppression = null;
    CM.deplacementChamp = null;

    // --------------------------------------------------------------------------------------
    // Rendu Canvas 2D
    // --------------------------------------------------------------------------------------
    function metersToCanvas(pt) {
        const d = CM.metersToDisplay(pt);
        const s = CM.state.scale * CM.state.zoomFactor;
        return { x: CM.state.offsetX + d.x * s + CM.state.panOffsetX, y: CM.state.offsetY - d.y * s + CM.state.panOffsetY };
    }
    function canvasToMeters(px) {
        const s = CM.state.scale * CM.state.zoomFactor;
        const d = { x: (px.x - CM.state.panOffsetX - CM.state.offsetX) / s, y: -(px.y - CM.state.panOffsetY - CM.state.offsetY) / s };
        return CM.displayToMeters(d);
    }
    // CORRECTIF (bug rapporté : "la mise à l'échelle n'est pas précise") : ref.p1/p2 (pixels IMAGE,
    // Y vers le BAS — convention standard écran/image) et ref.m1/m2 (mètres locaux, Y vers le HAUT —
    // convention de ce module, cf. metersToCanvas ci-dessus : `offsetY - d.y*s`, un Y croissant
    // remonte visuellement) appartiennent à 2 repères de CHIRALITÉ OPPOSÉE (l'un direct, l'autre
    // indirect). rotateAroundOrigin() n'implémente qu'une rotation (déterminant +1, préserve
    // l'orientation) : appliquée telle quelle entre 2 repères de chiralité opposée, elle ne peut
    // reproduire correctement la relation entre les deux QUE dans le cas particulier où le segment
    // de calibration est horizontal (angle nul des deux côtés, cf. la calibration par image importée
    // ci-dessous — 2 points de référence toujours synthétisés à l'horizontale) ; pour tout autre
    // angle (cas général de la capture de carte, 2 sommets quelconques du contour), elle produit une
    // orientation FAUSSE (un point donné se retrouve à la mauvaise position, jusqu'à un miroir
    // complet selon l'angle réel). Fix : basculer p1/p2/pt dans un repère Y-vers-le-haut (même
    // chiralité que m1/m2) EN NÉGATANT LEUR Y avant tout calcul d'angle/de rotation — une rotation
    // pure entre 2 repères de MÊME chiralité est alors mathématiquement exacte, quel que soit
    // l'angle du segment de calibration.
    function imagePixelToLocalMeters(pt) {
        const ref = CM.state.mapScreenshotRef;
        const p1 = { x: ref.p1.x, y: -ref.p1.y };
        const p2 = { x: ref.p2.x, y: -ref.p2.y };
        const ptUp = { x: pt.x, y: -pt.y };
        const sv = { x: p2.x - p1.x, y: p2.y - p1.y };
        const mv = { x: ref.m2.x - ref.m1.x, y: ref.m2.y - ref.m1.y };
        const scale = Math.hypot(mv.x, mv.y) / (Math.hypot(sv.x, sv.y) || 1);
        const angle = Math.atan2(mv.y, mv.x) - Math.atan2(sv.y, sv.x);
        const rel = CM.rotateAroundOrigin({ x: ptUp.x - p1.x, y: ptUp.y - p1.y }, angle);
        return { x: ref.m1.x + rel.x * scale, y: ref.m1.y + rel.y * scale };
    }

    function computeFit() {
        if (!CM.state.roofLocal.length || !CM.canvas) return;
        let points = CM.state.roofLocal.map(CM.metersToDisplay);
        if (CM.state.showBackgroundImage && CM.state.mapScreenshotImgObj && CM.state.mapScreenshotRef) {
            const img = CM.state.mapScreenshotImgObj;
            const corners = [
                { x: 0, y: 0 }, { x: img.width, y: 0 }, { x: img.width, y: img.height }, { x: 0, y: img.height }
            ].map(imagePixelToLocalMeters).map(CM.metersToDisplay);
            points = points.concat(corners);
        }
        // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue") : en mode
        // d'affichage combiné, le cadrage inclut aussi le contour des autres maisons (déjà
        // reprojetées dans le repère de la maison active par getOtherHousesReprojected).
        if (CM.multiHouseViewActive && typeof CM.getOtherHousesReprojected === 'function') {
            CM.getOtherHousesReprojected().forEach((house) => {
                points = points.concat(house.roofLocal.map(CM.metersToDisplay));
            });
        }
        const bb = CM.boundingBox(points);
        const w = bb.maxX - bb.minX || 1;
        const h = bb.maxY - bb.minY || 1;
        const padding = 40;
        CM.state.scale = Math.min((CM.canvas.width - 2 * padding) / w, (CM.canvas.height - 2 * padding) / h);
        const cx = (bb.minX + bb.maxX) / 2;
        const cy = (bb.minY + bb.maxY) / 2;
        CM.state.offsetX = CM.canvas.width / 2 - cx * CM.state.scale;
        CM.state.offsetY = CM.canvas.height / 2 + cy * CM.state.scale;
        CM.state.zoomFactor = 1;
        CM.state.panOffsetX = 0;
        CM.state.panOffsetY = 0;
    }

    /**
     * NOUVEAU (demande explicite : "pousser le zoom au maximum sur le calepinage en plan, on ne voit
     * pas bien les panneaux").
     *
     * Cadrage SERRÉ sur le bâti, réservé aux captures (rapport, export PDF). computeFit() ci-dessus,
     * qui sert la vue interactive, inclut volontairement les 4 coins de l'image de fond dans son
     * calcul : l'utilisateur voit ainsi le voisinage de sa maison. Mais cette image couvre toute la
     * carte capturée, donc tout l'écran — le contour n'y occupait qu'une fraction de la hauteur, et
     * les panneaux devenaient illisibles une fois l'image réduite à une demi-page de PDF.
     *
     * Ici on cadre sur le seul contour (et sur celui des autres maisons en vue combinée). Le fond de
     * carte reste dessiné : il déborde simplement du cadre, ce qui remplit l'image au lieu de la
     * cerner de blanc.
     *
     * @param {number} [padding=20] marge en pixels autour du contour
     */
    // margeMetres (facultatif, plans DP) : marge exprimée en MÈTRES autour du contour, pour que les
    // cotations (dessinées 1 m à l'extérieur, cf. renderCotations) ne soient jamais rognées, quelle
    // que soit la taille du toit. Sans elle, comportement d'origine (marge fixe en pixels).
    // pointsEnPlus (facultatif) : points du repère local (m) à garder aussi dans le cadre — les
    // cotations de la carte reportées sur le plan de toiture du dossier DP.
    function cadrerSurContour(padding, margeMetres, pointsEnPlus) {
        if (!CM.state.roofLocal.length || !CM.canvas) return;
        let points = CM.state.roofLocal.map(CM.metersToDisplay);
        if (Array.isArray(pointsEnPlus) && pointsEnPlus.length) points = points.concat(pointsEnPlus.map(CM.metersToDisplay));
        if (CM.multiHouseViewActive && typeof CM.getOtherHousesReprojected === 'function') {
            CM.getOtherHousesReprojected().forEach((house) => {
                points = points.concat(house.roofLocal.map(CM.metersToDisplay));
            });
        }
        const marge = padding != null ? padding : 20;
        const bb = CM.boundingBox(points);
        const w = bb.maxX - bb.minX || 1;
        const h = bb.maxY - bb.minY || 1;
        const mm = margeMetres > 0 ? margeMetres : 0;
        CM.state.scale = Math.min((CM.canvas.width - 2 * marge) / (w + 2 * mm), (CM.canvas.height - 2 * marge) / (h + 2 * mm));
        const cx = (bb.minX + bb.maxX) / 2;
        const cy = (bb.minY + bb.maxY) / 2;
        CM.state.offsetX = CM.canvas.width / 2 - cx * CM.state.scale;
        CM.state.offsetY = CM.canvas.height / 2 + cy * CM.state.scale;
        CM.state.zoomFactor = 1;
        CM.state.panOffsetX = 0;
        CM.state.panOffsetY = 0;
    }

    function strokePolygon(ctx, points, color, width, dashed) {
        if (points.length < 2) return;
        ctx.beginPath();
        points.forEach((p, i) => {
            const c = metersToCanvas(p);
            if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (dashed) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // NOUVEAU (édition du contour sur le canevas) : petites poignées aux sommets du contour, visibles
    // uniquement quand l'édition est possible (cf. canEditContourVertices — toit pas encore divisé,
    // aucun autre outil actif) — signal visuel clair : "ces coins se glissent à la souris". Le sommet
    // en cours de glissé (s'il y en a un) est mis en évidence.
    function renderContourVertexHandles(ctx) {
        if (typeof canEditContourVertices !== 'function' || !canEditContourVertices()) return;
        (CM.state.roofLocal || []).forEach((p, i) => {
            const c = metersToCanvas(p);
            const dragging = CM.isDraggingContourVertex && CM.draggedVertexIndex === i;
            ctx.beginPath();
            ctx.arc(c.x, c.y, dragging ? 7 : 5, 0, Math.PI * 2);
            ctx.fillStyle = dragging ? '#dc2626' : '#ffffff';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#1d4ed8';
            ctx.stroke();
        });
    }

    function drawClippedLine(ctx, panPoints, a, b, color, width) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (!CM.pointInPolygon(mid, panPoints)) return;
        const ca = metersToCanvas(a), cb = metersToCanvas(b);
        ctx.beginPath();
        ctx.moveTo(ca.x, ca.y);
        ctx.lineTo(cb.x, cb.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    }

    function renderStructureForPan(ctx, pan, panels) {
        // CORRECTIF (cf. calculs.js::effectiveGridAngle) : même angle que la grille de panneaux — un
        // contour rectangle redérive l'angle de son arête réelle, pour que rails/chevrons/pannes
        // restent alignés sur les panneaux même si pan.angle est devenu obsolète.
        const angle = CM.effectiveGridAngle(pan);
        const localPoints = pan.points.map((p) => CM.rotateAroundOrigin(p, -angle));
        const bb = CM.boundingBox(localPoints);
        const toTrue = (p) => CM.rotateAroundOrigin(p, angle);

        const chevronStep = Math.max(0.05, CM.state.chevronSpacingM || 0.6);
        for (let x = bb.minX; x <= bb.maxX; x += chevronStep) {
            drawClippedLine(ctx, pan.points, toTrue({ x, y: bb.minY }), toTrue({ x, y: bb.maxY }), '#a16207', 1);
        }
        const panneStep = Math.max(0.05, CM.state.panneSpacingM || 1.2);
        for (let y = bb.minY; y <= bb.maxY; y += panneStep) {
            drawClippedLine(ctx, pan.points, toTrue({ x: bb.minX, y }), toTrue({ x: bb.maxX, y }), '#78350f', 2);
        }
        const liteauStep = Math.max(0.02, CM.state.liteauSpacingM || 0.35);
        for (let y = bb.minY; y <= bb.maxY; y += liteauStep) {
            drawClippedLine(ctx, pan.points, toTrue({ x: bb.minX, y }), toTrue({ x: bb.maxX, y }), '#d6d3d1', 0.5);
        }
        panels.forEach((pl) => {
            const isPaysage = CM.state.panelOrientation === 'paysage';
            const hw = pl.w / 2, hl = pl.l / 2;
            [0.2, 0.8].forEach((f) => {
                let aLocal, bLocal;
                if (isPaysage) {
                    const lx = -hw + pl.w * f;
                    aLocal = { x: lx, y: -hl }; bLocal = { x: lx, y: hl };
                } else {
                    const ly = -hl + pl.l * f;
                    aLocal = { x: -hw, y: ly }; bLocal = { x: hw, y: ly };
                }
                const a = CM.rotateAroundOrigin(aLocal, pl.angle);
                a.x += pl.cx; a.y += pl.cy;
                const b = CM.rotateAroundOrigin(bLocal, pl.angle);
                b.x += pl.cx; b.y += pl.cy;
                drawClippedLine(ctx, pan.points, a, b, '#1e293b', 2);
            });
        });
    }

    // NOUVEAU (demande explicite : remplacer la flèche verte par l'icône flèche existante) : même
    // fichier que Polygon.js::updateRoofVisuals (système de calepinage "grands projets"), chargé une
    // seule fois (image mise en cache au niveau du module) et réutilisé à chaque rendu. Un
    // render() est redéclenché au chargement pour éviter une flèche absente le temps que l'image
    // charge (1re ouverture du modal seulement — image ensuite en cache navigateur/mémoire).
    let _slopeArrowImg = null;
    function getSlopeArrowImage() {
        if (!_slopeArrowImg) {
            _slopeArrowImg = new Image();
            _slopeArrowImg.onload = () => { if (typeof CM.render === 'function') CM.render(); };
            _slopeArrowImg.src = '/static/concevoir_mon_projet/medias/icons/arrow.svg';
        }
        return _slopeArrowImg;
    }

    // CORRECTIF (demande explicite : "les labels N° PV et la carte Incl/Azim doivent toujours être
    // parallèles à la flèche, avec l'azimut du rectangle — actuellement orientés plein Sud par
    // défaut") : angle brut (radians, convention canvas), ramené dans [-90°, 90°] pour ne jamais
    // afficher le texte à l'envers — même principe que _normalizeHeadingForLabel (polygon_maison.js)
    // pour les cotations.
    function normalizeCanvasRotationForText(angleRad) {
        let deg = angleRad * 180 / Math.PI;
        while (deg > 90) deg -= 180;
        while (deg < -90) deg += 180;
        return deg * Math.PI / 180;
    }

    // CORRECTIF (2e passe, demande explicite : "labels PV1 / carte Incl-Azim toujours mal orientés") :
    // angle VISUEL de la flèche de pente = EXACTEMENT la formule de rotation de l'icône arrow.svg
    // (cf. renderSlopeArrow : atan2(Δy,Δx) - 90°, la flèche pointant "vers le bas" dans son repère).
    // La 1re tentative utilisait l'axe tail->head brut (sans le -90°) : à l'orientation par défaut
    // (plein Sud, flèche vers le bas) elle donnait 90° => texte vertical. Avec le -90°, l'orientation
    // par défaut donne 0° (texte horizontal) et les labels tournent AVEC le rectangle.
    function slopeArrowVisualAngle(geom) {
        return Math.atan2(geom.head.y - geom.tail.y, geom.head.x - geom.tail.x) - Math.PI / 2;
    }

    // NOUVEAU : reproduit le style du "label PV" existant (cf. Polygon.js::updateRoofVisuals,
    // labelDiv — fond blanc, bordure #1A73E8 1px, texte #333 gras 12px, coins arrondis, légère
    // ombre) — utilisé ici en remplacement du simple texte bleu affiché jusque-là pour l'azimut du
    // pan.
    // CORRECTIF (rotation) : `rotation` (radians) tourne le label autour de son propre centre pour
    // rester parallèle à la flèche de pente (repli 0 = à plat, comportement historique).
    function drawPvStyleLabel(ctx, cc, text, rotation = 0) {
        ctx.save();
        ctx.translate(cc.x, cc.y);
        ctx.rotate(rotation);
        ctx.font = 'bold 12px sans-serif';
        const paddingX = 6;
        const textWidth = ctx.measureText(text).width;
        const boxW = textWidth + paddingX * 2, boxH = 19;
        const x = -boxW / 2, y = -boxH / 2;
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
        ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
        ctx.arcTo(x, y + boxH, x, y, r);
        ctx.arcTo(x, y, x + boxW, y, r);
        ctx.closePath();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#1A73E8';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);
        ctx.restore();
    }

    // NOUVEAU (demande explicite : "placer la valeur de l'azimut et l'inclinaison dans une petite
    // carte... les placer à la verticale") : remplace l'ancien label par-pan (qui n'affichait que
    // l'azimut, un simple "${pan.azimuth}°") par une bulle à 2 lignes empilées verticalement — même
    // style visuel que drawPvStyleLabel() ci-dessus (bulle blanche, bordure bleue, coins arrondis),
    // étendu pour plusieurs lignes de texte.
    // CORRECTIF (rotation) : `rotation` (radians) tourne la carte autour de son propre centre pour
    // rester parallèle à la flèche de pente du pan (repli 0 = à plat/dôme, sans flèche pertinente).
    function drawOrientationCard(ctx, cc, inclDeg, azimDeg, rotation = 0) {
        ctx.save();
        ctx.translate(cc.x, cc.y);
        ctx.rotate(rotation);
        ctx.font = 'bold 11px sans-serif';
        const lines = [`Incl : ${inclDeg}°`, `Azim : ${azimDeg}°`];
        const paddingX = 6, paddingY = 4, lineHeight = 14;
        const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const boxW = textWidth + paddingX * 2, boxH = lineHeight * lines.length + paddingY * 2;
        const x = -boxW / 2, y = -boxH / 2;
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
        ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
        ctx.arcTo(x, y + boxH, x, y, r);
        ctx.arcTo(x, y, x + boxW, y, r);
        ctx.closePath();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#1A73E8';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => {
            ctx.fillText(line, 0, y + paddingY + lineHeight * i + lineHeight / 2 + 1);
        });
        ctx.restore();
    }

    // NOUVEAU : inclinaison effective d'un pan selon son type de pose — réutilise les champs d'état
    // déjà existants (aucune nouvelle saisie), même correspondance que le reste du module
    // (computeCandidatePanelSlots()/getEffectivePanelDims() dans calepinage_maison_calculs.js).
    // 2026-10-09 : `state` optionnel (repli CM.state) — relu aussi par la carte Incl/Azim posée sur
    // les champs PV de la carte Google (polygon_maison.js::_updateRoofVisuals), qui affiche des
    // champs autres que celui ouvert dans le canevas.
    function getEffectiveInclinaisonDeg(pan, state) {
        state = state || CM.state;
        if (pan.poseMode === 'dome') return state.domeTiltDeg || 0;
        if (pan.poseMode === 'plat') {
            // Toiture terrasse : la pente incline la dalle (cf. calepinage_maison_3d_geometry.js) ;
            // sinon un pan 'plat' est vraiment à 0°.
            const isTerrasse = typeof CM.normalizeTypeMontage === 'function'
                && CM.normalizeTypeMontage(state.typeMontage) === 'toiture_terrasse';
            return isTerrasse ? (state.penteDeg || 0) : 0;
        }
        // 'incline', 'shed' (et repli) : pente propre au pan (Pan 2 asym -> penteDeg2).
        return (typeof CM.effectivePenteDegForPan === 'function'
            ? CM.effectivePenteDegForPan(pan, state) : state.penteDeg) || 0;
    }

    // CORRECTIF (bug rapporté : "le label PV tombe sur la flèche") : la géométrie de la flèche
    // (dir/arrowLenM/tailPt/tipPt) est désormais RETOURNÉE (en plus d'être dessinée), pour que
    // render() puisse positionner le label "PV1" à distance du bout "amont" (tailPt) de cette MÊME
    // flèche, plutôt que de dupliquer ce calcul séparément (source de désynchronisation). Retourne
    // `null` quand aucune flèche n'est pertinente (pose plate/dôme).
    function renderSlopeArrow(ctx, pan) {
        if (pan.poseMode === 'plat' || pan.poseMode === 'dome') return null;
        const angle = CM.effectiveGridAngle(pan);
        const localPoints = pan.points.map((p) => CM.rotateAroundOrigin(p, -angle));
        const bb = CM.boundingBox(localPoints);
        const rampantExtentM = bb.maxY - bb.minY;
        const arrowLenM = Math.min(3, Math.max(1, rampantExtentM * 0.4));

        const centroid = CM.polygonCentroid(pan.points);
        const dir = CM.vectorFromHeading(pan.azimuth + 180);
        const tailPt = { x: centroid.x - dir.x * arrowLenM * 0.5, y: centroid.y - dir.y * arrowLenM * 0.5 };
        const tipPt = { x: centroid.x + dir.x * arrowLenM * 0.5, y: centroid.y + dir.y * arrowLenM * 0.5 };
        const tail = metersToCanvas(tailPt);
        const head = metersToCanvas(tipPt);
        // tail/head (coordonnées CANEVAS, pixels écran) exposés en plus de tailPt/tipPt (mètres) —
        // demande explicite : "juste une petite distance verticale" entre le label PV et la flèche,
        // dont l'icône a une taille FIXE EN PIXELS (24px, indépendante du zoom) — un écart en mètres
        // seul (ancien comportement) devient disproportionné à fort zoom. Cf. positionnement du
        // label PV dans render().
        const geom = { dir, arrowLenM, tailPt, tipPt, centroid, tail, head };

        const img = getSlopeArrowImage();
        if (!img.complete || !img.naturalWidth) return geom; // pas encore chargée (cf. onload ci-dessus)

        // arrow.svg pointe par défaut "vers le bas" dans son repère (cf. son path : hampe en haut,
        // pointe en bas) — un décalage de -90° aligne cette orientation par défaut sur l'axe
        // tail->head, exactement comme la rotation CSS appliquée à arrowDiv dans
        // Polygon.js::updateRoofVisuals.
        const midX = (tail.x + head.x) / 2, midY = (tail.y + head.y) / 2;
        const rotation = Math.atan2(head.y - tail.y, head.x - tail.x) - Math.PI / 2;
        const size = 24;
        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(rotation);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
        return geom;
    }

    function renderCotations(ctx) {
        // Masquables depuis le menu horizontal (#cmToggleShowCotationsBtn) : seules les cotations
        // disparaissent, contour, panneaux et étiquettes restent affichés.
        if (CM.state.showCotations === false) return;
        const poly = CM.state.roofLocal;
        if (!poly.length) return;
        const n = poly.length;
        const offsetM = 1.0;
        const centroid = CM.polygonCentroid(poly);

        ctx.strokeStyle = '#6366f1';
        ctx.fillStyle = '#4338ca';
        ctx.font = '11px sans-serif';
        ctx.lineWidth = 1;
        ctx.textAlign = 'center';
        // CORRECTIF (demande explicite : "utiliser une couleur blanche d'arrière-plan pour la
        // cotation du canevas, pour qu'elle reste visible sur la capture d'écran de la carte") :
        // textBaseline='middle' ajouté pour que le rectangle de fond dessiné ci-dessous (dans la
        // boucle) soit exactement centré sur le texte.
        ctx.textBaseline = 'middle';
        const cotationFontSize = 11;

        for (let i = 0; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dir = CM.normalize({ x: b.x - a.x, y: b.y - a.y });
            let normal = { x: -dir.y, y: dir.x };
            const towardOutside = { x: mid.x - centroid.x, y: mid.y - centroid.y };
            if (normal.x * towardOutside.x + normal.y * towardOutside.y < 0) normal = { x: -normal.x, y: -normal.y };

            const aOff = { x: a.x + normal.x * offsetM, y: a.y + normal.y * offsetM };
            const bOff = { x: b.x + normal.x * offsetM, y: b.y + normal.y * offsetM };
            const midOff = { x: mid.x + normal.x * offsetM, y: mid.y + normal.y * offsetM };

            [[a, aOff], [b, bOff]].forEach(([p1, p2]) => {
                const c1 = metersToCanvas(p1), c2 = metersToCanvas(p2);
                ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
            });
            const ca = metersToCanvas(aOff), cb = metersToCanvas(bOff);
            ctx.beginPath(); ctx.moveTo(ca.x, ca.y); ctx.lineTo(cb.x, cb.y); ctx.stroke();

            const cm = metersToCanvas(midOff);
            const label = `${lengthM.toFixed(2)} m`;
            const textWidth = ctx.measureText(label).width;
            const padX = 3, padY = 2;
            // Demande explicite : texte parallèle à son arête (longueur comme largeur), ramené dans
            // [-90°, 90°] pour ne jamais être lu à l'envers.
            let angle = Math.atan2(cb.y - ca.y, cb.x - ca.x);
            if (angle > Math.PI / 2) angle -= Math.PI;
            else if (angle < -Math.PI / 2) angle += Math.PI;
            ctx.save();
            ctx.translate(cm.x, cm.y);
            ctx.rotate(angle);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(
                -textWidth / 2 - padX, -cotationFontSize / 2 - padY,
                textWidth + padX * 2, cotationFontSize + padY * 2
            );
            ctx.fillStyle = '#4338ca';
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
    }

    function fillRing(ctx, outer, inner, color) {
        ctx.beginPath();
        outer.forEach((p, i) => {
            const c = metersToCanvas(p);
            if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.closePath();
        if (inner.length >= 3) {
            inner.forEach((p, i) => {
                const c = metersToCanvas(p);
                if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
            });
            ctx.closePath();
        }
        ctx.fillStyle = color;
        ctx.fill('evenodd');
    }

    /**
     * Zones de dégagement d'un pan (repère local, mètres) telles que le canevas les dessine :
     * `bordure` (espacement bordure, orange) et `faitage` (dégagement de faîtage, violet), chacune
     * { outer, inner } ou null. Lit CM.state (basculer l'état pour un champ non affiché).
     * Partagée avec la carte principale (calepinage_maison_carte_plans.js), qui reporte la zone
     * tampon de bordure dès qu'elle existe ici — mêmes points, donc même dessin des deux côtés.
     */
    function clearanceZoneRings(pan) {
        // Ombrière : pas de zone de dégagement de bordure (forcée à 0, cf. effectiveEdgeClearanceM).
        const e = (typeof CM.effectiveEdgeClearanceM === 'function') ? CM.effectiveEdgeClearanceM() : CM.state.edgeClearanceM;
        const r = CM.state.ridgeClearanceEachSideM;
        const ridgeSet = new Set(pan.ridgeEdgeIndices || []);
        const zones = { bordure: null, faitage: null };
        if (e <= 0 && (CM.state.divisionMode === 'none' || r <= 0 || !ridgeSet.size)) return zones;

        const overhang = (CM.state.overhangRampant + CM.state.overhangLongpan) / 2;
        // CORRECTIF (même bug que computeCandidatePanelSlots) : le porte-à-faux ne déborde jamais du
        // FAÎTAGE — sinon la zone de dégagement dessinée (et la zone de pose) franchit le faîtage.
        const bufferedPoints = overhang
            ? CM.offsetPolygonEdges(
                pan.points,
                pan.points.map((_, i) =>
                    (CM.state.divisionMode !== 'none' && ridgeSet.has(i)) ? 0 : overhang),
                false)
            : pan.points;

        if (e > 0) {
            const borderOnly = pan.points.map((_, i) => (ridgeSet.has(i) ? 0 : e));
            zones.bordure = { outer: bufferedPoints, inner: CM.erodePolygonByEdgeClearances(bufferedPoints, borderOnly) };
        }
        if (CM.state.divisionMode !== 'none' && r > 0 && ridgeSet.size) {
            const ridgeOnly = pan.points.map((_, i) => (ridgeSet.has(i) ? r : 0));
            zones.faitage = { outer: bufferedPoints, inner: CM.erodePolygonByEdgeClearances(bufferedPoints, ridgeOnly) };
        }
        return zones;
    }

    function renderClearanceZones(ctx, pan) {
        const zones = clearanceZoneRings(pan);
        if (zones.bordure) fillRing(ctx, zones.bordure.outer, zones.bordure.inner, 'rgba(249,115,22,0.28)');
        if (zones.faitage) fillRing(ctx, zones.faitage.outer, zones.faitage.inner, 'rgba(168,85,247,0.4)');
    }

    // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue, notamment pour la
    // scène 3D à venir") : dessine les autres maisons (déjà reprojetées dans le repère de la maison
    // active par CM.getOtherHousesReprojected) en gris neutre — contour, panneaux réels de CHAQUE
    // maison, obstacles — pour les distinguer visuellement de la maison active (couleurs habituelles,
    // dessinée juste après par le reste de render()). Lecture seule : aucune interaction souris ne
    // cible ces maisons (onCanvasMouseDown continue de n'agir que sur CM.state, la maison active).
    function renderOtherHouses(ctx) {
        if (!CM.multiHouseViewActive || typeof CM.getOtherHousesReprojected !== 'function') return;
        const others = CM.getOtherHousesReprojected();
        // Contours tels qu'affichés, relus par le clic/survol (champPvSousPointeur) : évite de relancer
        // getOtherHousesReprojected (calcul des panneaux de chaque champ) à chaque mouvement de souris.
        CM.autresChampsAffiches = others.map((house) => ({ sourceId: house.sourceId, roofLocal: house.roofLocal }));

        others.forEach((house) => {
            strokePolygon(ctx, house.roofLocal, '#9ca3af', 1.5, true);

            if (CM.state.showPanels) {
                house.panelsByPan.forEach((panels) => {
                    panels.forEach((pl) => {
                        const corners = CM.panelCornersTrue(pl).map(metersToCanvas);
                        ctx.beginPath();
                        corners.forEach((c, i) => { if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
                        ctx.closePath();
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
                        ctx.strokeStyle = '#6b7280';
                        ctx.lineWidth = 0.5;
                        ctx.fill();
                        ctx.stroke();
                    });
                });
            }

            house.obstacles.forEach((o) => {
                const corners = CM.obstacleCornersTrue(o).map(metersToCanvas);
                ctx.beginPath();
                corners.forEach((c, i) => { if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
                ctx.closePath();
                ctx.fillStyle = 'rgba(156, 163, 175, 0.5)';
                ctx.strokeStyle = '#6b7280';
                ctx.lineWidth = 1;
                ctx.fill();
                ctx.stroke();
            });

            const centroid = CM.polygonCentroid(house.roofLocal);
            const cc = metersToCanvas(centroid);
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(house.sourceId, cc.x, cc.y);
        });
    }

    /**
     * Joints de dilatation d'un pan (ombrières / bâtiment incliné, cf. paramsJointDilatation) :
     * bande rouge hachurée de la largeur réelle du joint (au moins 3 px pour rester visible à
     * faible zoom), axe en tirets et étiquette « JD <largeur> mm ».
     */
    function renderJointsDilatation(ctx, pan) {
        if (typeof CM.jointsDilatationDuPan !== 'function') return;
        const joints = CM.jointsDilatationDuPan(pan);
        joints.forEach((j) => {
            const a = metersToCanvas(j.a), b = metersToCanvas(j.b);
            const longueurPx = Math.hypot(b.x - a.x, b.y - a.y);
            if (longueurPx < 1) return;
            const ux = (b.x - a.x) / longueurPx, uy = (b.y - a.y) / longueurPx;
            const nx = -uy, ny = ux; // normale : sens de la largeur du joint
            const echelle = Math.hypot(metersToCanvas({ x: 1, y: 0 }).x - metersToCanvas({ x: 0, y: 0 }).x,
                metersToCanvas({ x: 1, y: 0 }).y - metersToCanvas({ x: 0, y: 0 }).y);
            const demi = Math.max(1.5, (j.largeurM * echelle) / 2);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(a.x + nx * demi, a.y + ny * demi);
            ctx.lineTo(b.x + nx * demi, b.y + ny * demi);
            ctx.lineTo(b.x - nx * demi, b.y - ny * demi);
            ctx.lineTo(a.x - nx * demi, a.y - ny * demi);
            ctx.closePath();
            ctx.fillStyle = 'rgba(220, 38, 38, 0.35)';
            ctx.fill();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
            // Étiquette horizontale juste au-delà de l'extrémité HAUTE du joint (à l'écran) : le
            // milieu du champ est déjà occupé par le label PVn, la flèche et la carte Incl./Azim.
            const [haut, bas] = a.y <= b.y ? [a, b] : [b, a];
            const lx = (haut.x - bas.x) / longueurPx, ly = (haut.y - bas.y) / longueurPx;
            const texte = `${j.nature === 'separation' ? 'Séparation' : 'JD'} ${Math.round(j.largeurM * 1000)} mm`;
            ctx.translate(haut.x + lx * 12, haut.y + ly * 12);
            ctx.font = 'bold 10px sans-serif';
            const largeurTexte = ctx.measureText(texte).width;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(-largeurTexte / 2 - 3, -7, largeurTexte + 6, 14);
            ctx.fillStyle = '#b91c1c';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(texte, 0, 0);
            ctx.restore();
        });
    }

    // ── Panneaux du canevas : tracés mémorisés en mètres ─────────────────────────────────────────
    // Les contours des panneaux sont construits UNE fois par placement (tableau partagé de
    // panneauxPartagesDuPan), en mètres, puis dessinés à chaque image par une seule transformation
    // du contexte (échelle, zoom, décalage, rotation de la vue alignée) : zoomer ou déplacer la vue
    // ne reparcourt plus les ~25 000 panneaux d'un grand champ. Un tracé par couleur (couleur
    // habituelle + niveaux du terrain cochés dans la légende).
    const tracesParPlacement = new WeakMap();   // panneaux -> { couleurs, normal, terrain, cote }
    function tracesPanneaux(pan, panels) {
        const tc = CM.terrainCarte;
        const avecCouleurs = !!(tc && typeof tc.couleursActives === 'function' ? tc.couleursActives(CM.state.sourceId) : tc);
        const couleurs = avecCouleurs ? panels.map((pl) => tc.couleurPanneau(CM.state.sourceId, pan.id, pl.panelIndex) || '') : null;
        const cleCouleurs = couleurs ? couleurs.join('|') : '';
        let t = tracesParPlacement.get(panels);
        if (t && t.couleurs === cleCouleurs) return t;
        t = { couleurs: cleCouleurs, normal: new Path2D(), terrain: new Map(), cote: Infinity };
        panels.forEach((pl, i) => {
            const couleur = couleurs && couleurs[i];
            let chemin = t.normal;
            if (couleur) {
                chemin = t.terrain.get(couleur);
                if (!chemin) { chemin = new Path2D(); t.terrain.set(couleur, chemin); }
            }
            CM.panelCornersTrue(pl).forEach((c, k) => { if (k === 0) chemin.moveTo(c.x, c.y); else chemin.lineTo(c.x, c.y); });
            chemin.closePath();
            t.cote = Math.min(t.cote, pl.w, pl.l);
        });
        tracesParPlacement.set(panels, t);
        return t;
    }

    function dessinerPanneaux(ctx, pan, panels) {
        if (!panels.length) return;
        const t = tracesPanneaux(pan, panels);
        const s = CM.state.scale * CM.state.zoomFactor;
        if (!(s > 0)) return;
        // Mètres -> canevas, comme metersToCanvas : rotation de la vue alignée, Y vers le haut.
        const th = CM.state.viewMode === 'aligned' ? (CM.state.refAngle || 0) : 0;
        const cs = Math.cos(th) * s, sn = Math.sin(th) * s;
        // Contour seulement si un panneau fait au moins 4 px : en vue éloignée le champ est un aplat.
        const avecContour = t.cote * s >= 4;
        ctx.save();
        ctx.transform(cs, sn, sn, -cs, CM.state.offsetX + CM.state.panOffsetX, CM.state.offsetY + CM.state.panOffsetY);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.5 / s;
        ctx.fill(t.normal);
        if (avecContour) ctx.stroke(t.normal);
        t.terrain.forEach((chemin, couleur) => {
            ctx.save();
            ctx.fillStyle = couleur;
            ctx.globalAlpha = 0.75;
            ctx.fill(chemin);
            ctx.restore();
            if (avecContour) ctx.stroke(chemin);
        });
        ctx.restore();
    }

    // ── Rendus regroupés : au plus un rendu par image d'écran ─────────────────────────────────────
    // La molette et la souris émettent souvent plusieurs événements par image, et chacun relançait
    // un rendu complet. vueSeule (zoom, déplacement de la vue) : le placement des panneaux est figé
    // pendant le geste (CM.avecPlacementFige), puis un rendu complet suit 200 ms après le dernier
    // événement pour repartir d'un calcul à jour.
    let renduPlanifie = 0;
    let renduComplet = false;   // au moins une demande « complète » dans l'image en attente
    let finGesteVue = 0;
    function demanderRendu(vueSeule) {
        if (!vueSeule) renduComplet = true;
        if (!renduPlanifie) {
            const lancer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
            renduPlanifie = lancer(() => {
                renduPlanifie = 0;
                const complet = renduComplet || typeof CM.avecPlacementFige !== 'function';
                renduComplet = false;
                if (complet) render(); else CM.avecPlacementFige(render);
            });
        }
        if (vueSeule) {
            clearTimeout(finGesteVue);
            finGesteVue = setTimeout(() => { finGesteVue = 0; demanderRendu(false); }, 200);
        }
    }

    function render() {
        if (!CM.canvas) return;
        CM.autresChampsAffiches = [];
        CM.contoursAutresChampsCache = null;
        const ctx = CM.canvas.getContext('2d');
        ctx.clearRect(0, 0, CM.canvas.width, CM.canvas.height);
        if (!CM.state.roofLocal.length) return;

        if (CM.state.showBackgroundImage && CM.state.mapScreenshotImgObj && CM.state.mapScreenshotRef) {
            const ref = CM.state.mapScreenshotRef;
            const d1 = metersToCanvas(ref.m1), d2 = metersToCanvas(ref.m2);
            const sv = { x: ref.p2.x - ref.p1.x, y: ref.p2.y - ref.p1.y };
            const dv = { x: d2.x - d1.x, y: d2.y - d1.y };
            const bgScale = Math.hypot(dv.x, dv.y) / (Math.hypot(sv.x, sv.y) || 1);
            const bgAngle = Math.atan2(dv.y, dv.x) - Math.atan2(sv.y, sv.x);
            ctx.save();
            ctx.translate(d1.x, d1.y);
            ctx.rotate(bgAngle);
            ctx.scale(bgScale, bgScale);
            ctx.translate(-ref.p1.x, -ref.p1.y);
            ctx.drawImage(CM.state.mapScreenshotImgObj, 0, 0);
            ctx.restore();
        }

        // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue") : dessinées EN
        // PREMIER (donc en arrière-plan visuel) pour que la maison active reste le point focal,
        // dessinée par-dessus juste après avec ses couleurs habituelles.
        renderOtherHouses(ctx);

        strokePolygon(ctx, CM.state.roofLocal, '#1d4ed8', 2, false);
        renderContourVertexHandles(ctx);
        renderCotations(ctx);

        // CORRECTIF (bugs rapportés : "le label PV1 tombe sur la flèche" / "la carte Incl./Azim. est
        // confondue avec la flèche et le label") : décalages robustes, indépendants de l'orientation
        // du pan :
        // - le label "PV1" est positionné à une distance FIXE EN PIXELS ÉCRAN au-delà du MILIEU du
        //   segment tail→head de la flèche du pan (quand un seul pan existe — cas Monopente par
        //   défaut), côté tail (amont/faîtage). CORRECTIF (bug rapporté : "le label est maintenant
        //   trop éloigné de la flèche") : un premier essai utilisait un écart en MÈTRES — l'icône de
        //   la flèche a pourtant une taille FIXE EN PIXELS (24px, cf. renderSlopeArrow), indépendante
        //   du zoom ; à fort zoom, un écart en mètres devient disproportionné. PV_LABEL_ARROW_GAP_PX
        //   (~28px) dégage tout juste le rayon de l'icône (12px) + la moitié de la hauteur de la
        //   bulle du label (~9-10px) + une petite marge — "juste une petite distance", comme demandé.
        //   Pour une orientation Sud (par défaut), tail→head pointe vers le bas de l'écran (cf.
        //   vectorFromHeading), donc ce décalage (côté tail) place le label au-dessus de la flèche.
        // - la carte Incl./Azim. est décalée d'une CONSTANTE fixe en PIXELS ÉCRAN (indépendante du
        //   zoom ET de l'angle du pan), toujours vers la droite du centroïde du pan — n'a donc plus
        //   aucune raison de coïncider avec la flèche (centrée sur ce même centroïde) ni avec le
        //   label PV (décalé côté opposé, cf. ci-dessus), quelle que soit l'orientation.
        const PV_LABEL_ARROW_GAP_PX = 28;
        const ORIENTATION_CARD_OFFSET_PX = 75;
        let singlePanArrowGeom = null;
        // CORRECTIF (bug rapporté : "le label PV reste plein sud alors que la flèche et le label
        // Incl/Azim ont la bonne orientation") : capture la géométrie de flèche du PREMIER pan qui en
        // a une (indépendamment du nombre total de pans), pour donner un azimut réel au label maison
        // même sur un toit divisé (Bipente/4 pans) — jusqu'ici `houseLabelRotation` restait à 0
        // ("plein sud") dès qu'il y avait plus d'un pan, cf. plus bas.
        let firstPanArrowGeom = null;

        CM.state.pans.forEach((pan) => {
            strokePolygon(ctx, pan.points, '#93c5fd', 1, true);
            // Tableau partagé (lecture seule) : clé du cache des tracés, cf. dessinerPanneaux.
            const panels = CM.panneauxPartagesDuPan ? CM.panneauxPartagesDuPan(pan) : CM.packPanelsForPan(pan);
            if (CM.state.showStructure) renderStructureForPan(ctx, pan, panels);

            if (CM.state.showPanels) {
                renderClearanceZones(ctx, pan);
                ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 0.5;
                dessinerPanneaux(ctx, pan, panels);
                renderJointsDilatation(ctx, pan);

                const arrowGeom = renderSlopeArrow(ctx, pan);
                if (CM.state.pans.length === 1) singlePanArrowGeom = arrowGeom;
                if (!firstPanArrowGeom && arrowGeom) firstPanArrowGeom = arrowGeom;

                // CORRECTIF (demande explicite : "placer azimut et inclinaison dans une petite
                // carte... bouton pour les masquer") : remplace l'ancien label "${pan.azimuth}°"
                // seul par la carte à 2 lignes (Incl./Azim.), conditionnée par le nouveau bouton du
                // menu horizontal (showOrientationCard, orchestrateur.js — visible par défaut).
                if (CM.state.showOrientationCard !== false) {
                    const centroid = CM.polygonCentroid(pan.points);
                    const cc = metersToCanvas(centroid);
                    cc.x += ORIENTATION_CARD_OFFSET_PX;
                    // CORRECTIF (demande explicite : "la carte Incl/Azim doit toujours être parallèle
                    // à la flèche, avec l'azimut du rectangle") : dérivée du même segment tail->head
                    // que la flèche de ce pan (arrowGeom, ci-dessus) — 0 par défaut si aucune flèche
                    // pertinente (pose plate/dôme).
                    const cardRotation = arrowGeom
                        ? normalizeCanvasRotationForText(slopeArrowVisualAngle(arrowGeom))
                        : 0;
                    drawOrientationCard(ctx, cc, getEffectiveInclinaisonDeg(pan), pan.azimuth, cardRotation);
                }
            }
        });

        // CORRECTIF (demande explicite : "le label PV tombe sur la flèche, il doit être posé
        // au-dessus" — orientation Sud par défaut) : dessiné après la boucle des pans (donc toujours
        // par-dessus visuellement), à un point calculé au-delà du bout amont de la flèche du pan
        // unique (cf. singlePanArrowGeom ci-dessus) quand elle est disponible — repli sur le
        // centroïde du toit (comportement historique) pour un toit à plusieurs pans, où l'ambiguïté
        // "quelle flèche éviter" ne se pose pas de la même façon (pans spatialement déjà séparés).
        if (CM.state.sourceId) {
            let houseCc = metersToCanvas(CM.polygonCentroid(CM.state.roofLocal));
            // CORRECTIF (demande explicite : "le label N° PV doit toujours être parallèle à la
            // flèche, avec l'azimut du rectangle") : 0 par défaut (repli toit à plusieurs pans,
            // comportement historique — pas d'ambiguïté "quelle flèche" dans ce cas).
            let houseLabelRotation = 0;
            if (singlePanArrowGeom) {
                const { tail, head } = singlePanArrowGeom;
                const dx = tail.x - head.x, dy = tail.y - head.y;
                const segLen = Math.hypot(dx, dy) || 1;
                const ux = dx / segLen, uy = dy / segLen; // unitaire, du bout "tip" vers le bout "tail" (amont)
                const midCc = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
                houseCc = { x: midCc.x + ux * PV_LABEL_ARROW_GAP_PX, y: midCc.y + uy * PV_LABEL_ARROW_GAP_PX };
                houseLabelRotation = normalizeCanvasRotationForText(slopeArrowVisualAngle(singlePanArrowGeom));
            } else if (firstPanArrowGeom) {
                // CORRECTIF (bug rapporté : "le label PV reste plein sud alors que la flèche et le
                // label Incl/Azim ont la bonne orientation") : toit à plusieurs pans (Bipente/4 pans)
                // — position au centroïde du toit conservée (comportement historique, plusieurs pans
                // spatialement séparés, pas de "bonne" position unique), mais la rotation suit
                // désormais l'azimut du premier pan avec flèche, au lieu de rester figée à 0/plein Sud.
                houseLabelRotation = normalizeCanvasRotationForText(slopeArrowVisualAngle(firstPanArrowGeom));
            }
            drawPvStyleLabel(ctx, houseCc, CM.state.sourceId, houseLabelRotation);
        }

        if (CM.state.ridge) {
            const a = metersToCanvas(CM.state.ridge.a);
            const b = metersToCanvas(CM.state.ridge.b);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        // NOUVEAU (demande explicite : "Diviser en 4 pans symétrique", faîtage ET noue au milieu) :
        // plusieurs lignes typées (divideInto4PansSymmetric, calepinage_maison_calculs.js), là où
        // CM.state.ridge (ci-dessus) n'en porte qu'une seule (Bipente/croupe). Même style rouge que le
        // faîtage pour les 2 lignes "ridge" ; la noue (au milieu) en bleu pour la distinguer visuellement
        // (les 2 se rejoignent physiquement à cette ligne, contrairement à un simple faîtage).
        if (Array.isArray(CM.state.ridgeLines)) {
            CM.state.ridgeLines.forEach((line) => {
                const a = metersToCanvas(line.a);
                const b = metersToCanvas(line.b);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle = line.type === 'valley' ? '#2563eb' : '#dc2626';
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }
        if (CM.state.ridgeTemp) {
            const a = metersToCanvas(CM.state.ridgeTemp);
            ctx.beginPath();
            ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#dc2626';
            ctx.fill();
        }

        // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal) : lignes libres déjà
        // posées (CM.state.freeLines) + longueur réelle affichée en permanence au milieu (demande
        // explicite, même principe que Line.js::updateLineLabel sur la carte principale) ; style
        // neutre (gris), volontairement distinct du rouge du faîtage/contour pour ne pas les confondre.
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        CM.state.freeLines.forEach((ln) => {
            const a = metersToCanvas(ln.p1), b = metersToCanvas(ln.p2);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = '#4b5563';
            ctx.lineWidth = 2;
            ctx.stroke();
            const lengthM = Math.hypot(ln.p2.x - ln.p1.x, ln.p2.y - ln.p1.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            ctx.fillStyle = '#fff';
            const label = `${lengthM.toFixed(2)} m`;
            const w = ctx.measureText(label).width;
            ctx.fillRect(mid.x - w / 2 - 3, mid.y - 13, w + 6, 15);
            ctx.fillStyle = '#374151';
            ctx.fillText(label, mid.x, mid.y - 2);
        });
        if (CM.state.tracingFreeLine && CM.state.freeLineTemp) {
            const a = metersToCanvas(CM.state.freeLineTemp);
            ctx.beginPath();
            ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#4b5563';
            ctx.fill();
            if (CM.lastMeterPt) {
                const b = metersToCanvas(CM.lastMeterPt);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle = '#4b5563';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Aperçu du rectangle à 3 clics : après le 1er clic, seule l'ARÊTE de longueur peut être
        // montrée (la direction n'est pas encore fixée, il n'y a pas encore de rectangle) ; après le
        // 2e, le rectangle complet suit le curseur en profondeur. Même progression que le traçé sur
        // la carte réelle (cf. _updateRectDrawTempPolygon, polygon_maison.js).
        if (CM.state.tracingContourRect && CM.state.contourRectPoints.length && CM.lastMeterPt) {
            const rectPoints = CM.state.contourRectPoints.length === 1
                ? [CM.state.contourRectPoints[0], CM.lastMeterPt]
                : CM.rectFromThreePointsLocal(CM.state.contourRectPoints[0], CM.state.contourRectPoints[1], CM.lastMeterPt);
            if (rectPoints) strokePolygon(ctx, rectPoints, '#dc2626', 2, true);
        }
        if (CM.state.drawingContourPolygon && CM.state.contourPolygonPoints.length) {
            const pts = CM.state.contourPolygonPoints.map(metersToCanvas);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
            if (CM.lastMeterPt) {
                const c = metersToCanvas(CM.lastMeterPt);
                ctx.lineTo(c.x, c.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Le bouton "Terminer le contour" a été retiré (demande explicite) : refermer se fait
            // uniquement en cliquant le PREMIER sommet, comme sur la carte. Cette cible doit donc se
            // voir — dès 3 sommets, le premier est entouré d'un anneau, qui se remplit en vert quand
            // le curseur entre dans son rayon d'accrochage (le même que celui testé au clic,
            // handleRadiusMeters) : l'utilisateur sait avant de cliquer que le contour va se fermer.
            const fermeturePossible = CM.state.contourPolygonPoints.length >= 3;
            const premier = CM.state.contourPolygonPoints[0];
            const surLaCible = fermeturePossible && CM.lastMeterPt
                && Math.hypot(CM.lastMeterPt.x - premier.x, CM.lastMeterPt.y - premier.y) <= handleRadiusMeters();

            pts.forEach((p, i) => {
                const estCible = i === 0 && fermeturePossible;
                ctx.beginPath();
                ctx.arc(p.x, p.y, estCible ? 5 : 4, 0, Math.PI * 2);
                ctx.fillStyle = (estCible && surLaCible) ? '#1E8449' : '#dc2626';
                ctx.fill();
                if (estCible) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
                    ctx.strokeStyle = surLaCible ? '#1E8449' : '#dc2626';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            });
        }

        CM.state.obstacles.forEach((o) => {
            const def = CM.OBSTACLE_TYPES[o.type] || CM.OBSTACLE_TYPES.forme;
            const hw = o.w / 2, hh = o.h / 2;
            const corners = CM.obstacleCornersTrue(o);
            const bufferCorners = CM.obstacleCornersTrue(o, o.buffer);
            strokePolygon(ctx, bufferCorners, '#ef4444', 1, true);

            const canvasCorners = corners.map(metersToCanvas);
            ctx.beginPath();
            canvasCorners.forEach((c, i) => { if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
            ctx.closePath();
            ctx.fillStyle = def.color;
            ctx.strokeStyle = o.id === CM.state.selectedObstacleId ? '#111827' : '#374151';
            ctx.lineWidth = o.id === CM.state.selectedObstacleId ? 2 : 1;
            if (def.shape === 'circle') {
                const centerC = metersToCanvas({ x: o.x, y: o.y });
                const s = CM.state.scale * CM.state.zoomFactor;
                const rotation = (CM.state.viewMode === 'aligned' ? CM.state.refAngle : 0) - (o.angle || 0);
                ctx.beginPath();
                ctx.ellipse(centerC.x, centerC.y, hw * s, hh * s, rotation, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fill();
                ctx.stroke();
            }

            const centerCanvas = metersToCanvas({ x: o.x, y: o.y });
            ctx.fillStyle = '#111827';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(def.label, centerCanvas.x, centerCanvas.y + 3);

            if (o.id === CM.state.selectedObstacleId) {
                const resizeC = metersToCanvas(corners[1]);
                const deleteC = metersToCanvas(corners[3]);
                ctx.fillStyle = '#2563eb';
                ctx.fillRect(resizeC.x - 5, resizeC.y - 5, 10, 10);
                ctx.beginPath();
                ctx.arc(deleteC.x, deleteC.y, 7, 0, Math.PI * 2);
                ctx.fillStyle = '#dc2626';
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillText('×', deleteC.x, deleteC.y + 3);
            }
        });

        // NOUVEAU (demande explicite : "ajoute une rose des vents visible sur le canvas du
        // calepinage") : dessinée en dernier (donc toujours au-dessus), ancrée en pixels écran (coin
        // haut-droit, indépendante du pan/zoom courant) — sa rotation, elle, réutilise
        // metersToCanvas() (donc le pipeline de transformation déjà en place, y compris le mode
        // "Vue Nord-Sud"/CM.state.viewMode) pour rester correcte sans dupliquer sa logique de
        // rotation : la direction canvas du Nord vrai est déduite de l'image de deux points de
        // référence en mètres (convention déjà établie ailleurs dans ce module — cf.
        // polygon_maison.js::latLngToLocal — +Y = Nord, +X = Est).
        // Matériels électriques, câbles et marqueurs de coordonnées (calepinage_maison_annotations.js).
        if (typeof CM.renderAnnotations === 'function') CM.renderAnnotations(ctx, metersToCanvas);

        // 2026-10-09 : rectangle de sélection de la suppression multiple, aux axes de la grille du
        // champ — rouge = suppression, vert = restauration (bouton droit).
        if (CM.rectSuppression) {
            const pts = coinsRectSelection(CM.rectSuppression).map(metersToCanvas);
            const restaurer = CM.rectSuppression.restaurer;
            ctx.save();
            ctx.fillStyle = restaurer ? 'rgba(22, 163, 74, 0.12)' : 'rgba(220, 38, 38, 0.12)';
            ctx.strokeStyle = restaurer ? '#16a34a' : '#dc2626';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        renderWindRose(ctx, CM.canvas.width - 55, 55, 26, metersToCanvas);
    }

    function renderWindRose(ctx, cx, cy, radius, toCanvasFn) {
        const origin = toCanvasFn({ x: 0, y: 0 });
        const northPt = toCanvasFn({ x: 0, y: 1 });
        const northAngle = Math.atan2(northPt.y - origin.y, northPt.x - origin.x);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1;
        ctx.stroke();

        const dirs = [
            { label: 'N', angle: northAngle, color: '#dc2626' },
            { label: 'E', angle: northAngle + Math.PI / 2, color: '#6b7280' },
            { label: 'S', angle: northAngle + Math.PI, color: '#6b7280' },
            { label: 'O', angle: northAngle - Math.PI / 2, color: '#6b7280' },
        ];
        dirs.forEach((d) => {
            const armLen = radius - 6;
            const tipX = cx + Math.cos(d.angle) * armLen, tipY = cy + Math.sin(d.angle) * armLen;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(tipX, tipY);
            ctx.strokeStyle = d.color;
            ctx.lineWidth = d.label === 'N' ? 2 : 1.2;
            ctx.stroke();
            const labelX = cx + Math.cos(d.angle) * (radius + 9), labelY = cy + Math.sin(d.angle) * (radius + 9);
            ctx.fillStyle = d.color;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.label, labelX, labelY);
        });
        ctx.restore();
    }

    // --------------------------------------------------------------------------------------
    // Interaction Canvas
    // --------------------------------------------------------------------------------------
    function getCanvasMeterPos(evt) {
        return canvasToMeters(getCanvasPixelPos(evt));
    }
    function getCanvasPixelPos(evt) {
        const rect = CM.canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) * (CM.canvas.width / rect.width),
            y: (evt.clientY - rect.top) * (CM.canvas.height / rect.height),
        };
    }

    // ── 2026-10-09 : suppression par rectangle et déplacement du champ PV entier ─────────────────
    // Géométrie du champ affiché exprimée dans le repère local : contour, pans, obstacles, faîtages,
    // lignes libres. Restent en place, car posés au SOL : fond de carte, matériels électriques /
    // câbles / marqueurs (lat/lng, cf. calepinage_maison_annotations.js) et objets de la scène 3D.
    // Les panneaux suivent d'eux-mêmes : leur grille est calée sur le pan (même hypothèse que le
    // déplacement rigide depuis la carte, cf. orchestrateur.js::resynchroniserChampSurContour).
    function instantaneGeometrieChamp() {
        const s = CM.state;
        const copie = (p) => (p ? { x: p.x, y: p.y } : p);
        const segment = (l, k1, k2) => (l ? { ...l, [k1]: copie(l[k1]), [k2]: copie(l[k2]) } : l);
        return {
            roofLocal: s.roofLocal.map(copie),
            pans: s.pans.map((pan) => (pan.points || []).map(copie)),
            obstacles: (s.obstacles || []).map((o) => ({ x: o.x, y: o.y })),
            ridge: segment(s.ridge, 'a', 'b'),
            ridgeLines: (s.ridgeLines || []).map((l) => segment(l, 'a', 'b')),
            freeLines: (s.freeLines || []).map((l) => segment(l, 'p1', 'p2')),
        };
    }

    function appliquerTranslationChamp(g, dx, dy) {
        const s = CM.state;
        const t = (p) => (p ? { x: p.x + dx, y: p.y + dy } : p);
        const segment = (l, k1, k2) => (l ? { ...l, [k1]: t(l[k1]), [k2]: t(l[k2]) } : l);
        s.roofLocal = g.roofLocal.map(t);
        s.pans.forEach((pan, i) => { if (g.pans[i]) pan.points = g.pans[i].map(t); });
        // Toit non divisé : le pan unique PARTAGE le tableau du contour (cf. finalizeContourVertexDrag).
        if (s.divisionMode === 'none' && s.pans.length) s.pans[0].points = s.roofLocal;
        (s.obstacles || []).forEach((o, i) => { if (g.obstacles[i]) { o.x = g.obstacles[i].x + dx; o.y = g.obstacles[i].y + dy; } });
        s.ridge = segment(g.ridge, 'a', 'b');
        if (Array.isArray(s.ridgeLines)) s.ridgeLines = g.ridgeLines.map((l) => segment(l, 'a', 'b'));
        if (Array.isArray(s.freeLines)) s.freeLines = g.freeLines.map((l) => segment(l, 'p1', 'p2'));
    }

    // Angle (repère local) de la grille du pan sous le point de départ — repli : 1er pan du champ —,
    // pour que le rectangle de sélection ait l'azimut du champ PV et non les axes Nord-Sud.
    function angleRectSelection(meterPt) {
        const pan = CM.state.pans.find((p) => CM.pointInPolygon(meterPt, p.points)) || CM.state.pans[0];
        return pan && typeof CM.effectiveGridAngle === 'function' ? (CM.effectiveGridAngle(pan) || 0) : 0;
    }

    // Les 4 coins (mètres locaux) du rectangle de diagonale a-b, côtés parallèles aux axes de la grille.
    function coinsRectSelection(sel) {
        const la = CM.rotateAroundOrigin(sel.a, -sel.angle), lb = CM.rotateAroundOrigin(sel.b, -sel.angle);
        return [
            { x: la.x, y: la.y }, { x: lb.x, y: la.y }, { x: lb.x, y: lb.y }, { x: la.x, y: lb.y },
        ].map((p) => CM.rotateAroundOrigin(p, sel.angle));
    }

    function finaliserSuppressionRect(sel) {
        const coins = coinsRectSelection(sel);
        const px = coins.map(metersToCanvas);
        // Simple clic (rectangle quasi nul à l'écran) : rien à supprimer ni à restaurer.
        if (Math.hypot(px[1].x - px[0].x, px[1].y - px[0].y) < 3
            || Math.hypot(px[3].x - px[0].x, px[3].y - px[0].y) < 3) { render(); return; }
        const n = sel.restaurer ? CM.restorePanelsInPolygon(coins) : CM.deletePanelsInPolygon(coins);
        render();
        if (n) CM.recomputeResults();
    }

    // Même recette que finalizeContourVertexDrag : contour répercuté sur le polygone Google Maps
    // vivant (silent : pas de réouverture du modal ni de recadrage), puis totaux + persistance. Le
    // contour réécrit est identique au sol à l'état déjà déplacé : la resynchronisation déclenchée
    // par setPolygonPath n'a donc rien à refaire.
    function finaliserDeplacementChamp(dep) {
        if (Math.hypot(dep.dx, dep.dy) < 0.005) { render(); return; }
        if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && CM.state.roofLocalOrigin && window.MaisonPolygonManagerInstance) {
            const newLatLngs = CM.state.roofLocal.map((pt) => CM.localToLatLng(CM.state.roofLocalOrigin, pt));
            window.MaisonPolygonManagerInstance.setPolygonPath(CM.state.currentPolygonRef, newLatLngs, { silent: true });
        }
        render();
        CM.recomputeResults();
    }

    /**
     * Échap : annule le geste en cours (rectangle de sélection, déplacement du champ) ; sans geste en
     * cours, quitte le mode « suppression par rectangle » / « déplacer le champ PV ».
     * @returns {boolean} true si quelque chose a été annulé
     */
    function annulerOutilChamp() {
        if (CM.rectSuppression) {
            CM.rectSuppression = null;
            render();
            return true;
        }
        if (CM.deplacementChamp) {
            appliquerTranslationChamp(CM.deplacementChamp.geometrie, 0, 0);
            CM.deplacementChamp = null;
            if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
            render();
            return true;
        }
        if (CM.state && (CM.state.panelToolMode === 'deleteRect' || CM.state.panelToolMode === 'moveField')) {
            CM.state.panelToolMode = 'none';
            if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !CM.modal || CM.modal.style.display === 'none') return;
        if (annulerOutilChamp()) e.preventDefault();
    });

    function onCanvasWheel(e) {
        e.preventDefault();
        const rect = CM.canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (CM.canvas.width / rect.width);
        const py = (e.clientY - rect.top) * (CM.canvas.height / rect.height);

        const meterBefore = canvasToMeters({ x: px, y: py });
        const factor = Math.exp(-e.deltaY * 0.0015);
        CM.state.zoomFactor = Math.min(6, Math.max(0.2, CM.state.zoomFactor * factor));

        const afterCanvas = metersToCanvas(meterBefore);
        CM.state.panOffsetX += px - afterCanvas.x;
        CM.state.panOffsetY += py - afterCanvas.y;

        demanderRendu(true);
    }

    function hitTestObstacle(meterPt) {
        for (let i = CM.state.obstacles.length - 1; i >= 0; i--) {
            const o = CM.state.obstacles[i];
            const local = CM.rotateAroundOrigin({ x: meterPt.x - o.x, y: meterPt.y - o.y }, -(o.angle || 0));
            if (Math.abs(local.x) <= o.w / 2 && Math.abs(local.y) <= o.h / 2) {
                return o;
            }
        }
        return null;
    }
    function handleRadiusMeters() { return 10 / (CM.state.scale * CM.state.zoomFactor); }

    // NOUVEAU (édition du contour sur le canevas) : peut-on éditer les sommets du contour EN CE
    // MOMENT ? Décision explicite : bloqué dès que le toit est divisé (2/4 pans) — l'utilisateur doit
    // revenir en Monopente (Réinitialiser la division) avant de redimensionner le contour, pour ne
    // jamais avoir à deviner comment faire suivre des pans déjà découpés.
    function canEditContourVertices() {
        return CM.state.divisionMode === 'none'
            && !CM.state.tracingContourRect && !CM.state.drawingContourPolygon
            && !CM.state.tracingFreeLine && !CM.state.tracingRidge
            && CM.state.panelToolMode === 'none' && !CM.state.panToolActive;
    }
    // Index du sommet de CM.state.roofLocal le plus proche de meterPt (à handleRadiusMeters() près),
    // ou -1. Même tolérance de clic que les autres poignées de ce fichier.
    function hitTestContourVertex(meterPt) {
        if (!canEditContourVertices()) return -1;
        const r = handleRadiusMeters();
        let bestIdx = -1, bestDist = Infinity;
        (CM.state.roofLocal || []).forEach((p, i) => {
            const d = Math.hypot(meterPt.x - p.x, meterPt.y - p.y);
            if (d <= r && d < bestDist) { bestDist = d; bestIdx = i; }
        });
        return bestIdx;
    }

    // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal) : distance point-segment,
    // retourne l'index de la ligne (CM.state.freeLines) la plus proche de meterPt si elle est à moins
    // de handleRadiusMeters() (même tolérance de clic, constante à l'écran, que les autres poignées de
    // ce fichier), sinon -1 — utilisé par le clic droit (onCanvasContextMenu) pour la suppression.
    function hitTestFreeLineIndex(meterPt) {
        const r = handleRadiusMeters();
        let bestIdx = -1, bestDist = Infinity;
        CM.state.freeLines.forEach((ln, idx) => {
            const dx = ln.p2.x - ln.p1.x, dy = ln.p2.y - ln.p1.y;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? ((meterPt.x - ln.p1.x) * dx + (meterPt.y - ln.p1.y) * dy) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const cx = ln.p1.x + t * dx, cy = ln.p1.y + t * dy;
            const dist = Math.hypot(meterPt.x - cx, meterPt.y - cy);
            if (dist <= r && dist < bestDist) { bestDist = dist; bestIdx = idx; }
        });
        return bestIdx;
    }
    function hitTestResizeHandle(meterPt) {
        const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
        if (!o) return false;
        const r = handleRadiusMeters();
        const local = CM.rotateAroundOrigin({ x: meterPt.x - o.x, y: meterPt.y - o.y }, -(o.angle || 0));
        return Math.abs(local.x - o.w / 2) <= r && Math.abs(local.y + o.h / 2) <= r;
    }
    function hitTestDeleteButton(meterPt) {
        const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
        if (!o) return false;
        const r = handleRadiusMeters();
        const local = CM.rotateAroundOrigin({ x: meterPt.x - o.x, y: meterPt.y - o.y }, -(o.angle || 0));
        return Math.abs(local.x + o.w / 2) <= r && Math.abs(local.y - o.h / 2) <= r;
    }

    // Sélection d'un champ PV par clic sur le canevas. En vue « tous les champs PV », on reprend les
    // contours dessinés (renderOtherHouses) ; sinon, les autres champs ne sont visibles que sur la
    // capture de fond de carte : leurs contours sont alors reprojetés sans calcul de panneaux, une fois
    // par rendu (le cache est vidé par render()). Le champ actif, dessiné par-dessus, reste prioritaire.
    function outilActifSurCanevas() {
        return !!(CM.state.panToolActive || CM.state.panelToolMode !== 'none'
            || CM.state.tracingContourRect || CM.state.drawingContourPolygon
            || CM.state.tracingFreeLine || CM.state.tracingRidge || CM.pendingObstacleType
            || CM.modeAnnotationActif);
    }
    function contoursAutresChamps() {
        if (CM.multiHouseViewActive && Array.isArray(CM.autresChampsAffiches) && CM.autresChampsAffiches.length) {
            return CM.autresChampsAffiches;
        }
        if (!CM.contoursAutresChampsCache) {
            try {
                CM.contoursAutresChampsCache = typeof CM.getOtherHouseContoursReprojected === 'function'
                    ? CM.getOtherHouseContoursReprojected() : [];
            } catch (err) {
                CM.contoursAutresChampsCache = [];
            }
        }
        return CM.contoursAutresChampsCache;
    }
    function champPvSousPointeur(meterPt) {
        if (CM.state.roofLocal.length >= 3 && CM.pointInPolygon(meterPt, CM.state.roofLocal)) return null;
        const champ = contoursAutresChamps().find((h) => h.roofLocal.length >= 3 && CM.pointInPolygon(meterPt, h.roofLocal));
        return champ ? champ.sourceId : null;
    }
    function majSurvolChampPv(e) {
        if (!CM.canvas || outilActifSurCanevas() || CM.survolAnnotation) return;
        const sourceId = e.target === CM.canvas ? champPvSousPointeur(getCanvasMeterPos(e)) : null;
        CM.canvas.style.cursor = sourceId ? 'pointer' : 'default';
        CM.canvas.title = sourceId ? `Cliquer pour afficher ${sourceId}` : '';
    }

    function onCanvasMouseDown(e) {
        if (CM.state.panToolActive) {
            const rect = CM.canvas.getBoundingClientRect();
            CM.isPanningCanvas = true;
            CM.panStart = {
                x: e.clientX, y: e.clientY,
                offX: CM.state.panOffsetX, offY: CM.state.panOffsetY,
                scaleX: CM.canvas.width / rect.width, scaleY: CM.canvas.height / rect.height
            };
            CM.canvas.style.cursor = 'grabbing';
            return;
        }

        const meterPt = getCanvasMeterPos(e);

        // Pose / déplacement d'un matériel électrique, d'un câble ou d'un marqueur de coordonnées.
        if (typeof CM.annotationsMouseDown === 'function' && CM.annotationsMouseDown(e, meterPt)) {
            render();
            return;
        }

        if (CM.state.selectedObstacleId && hitTestDeleteButton(meterPt)) {
            CM.state.obstacles = CM.state.obstacles.filter((o) => o.id !== CM.state.selectedObstacleId);
            CM.state.selectedObstacleId = null;
            CM.updateObstaclePropertiesPanel();
            render();
            CM.recomputeResults();
            return;
        }

        if (CM.state.selectedObstacleId && hitTestResizeHandle(meterPt)) {
            CM.isResizingObstacle = true;
            CM.resizeObstacleId = CM.state.selectedObstacleId;
            return;
        }

        if (CM.state.panelToolMode === 'move') {
            const pan = CM.state.pans.find((p) => CM.pointInPolygon(meterPt, p.points));
            if (pan) {
                CM.isMovingPanels = true;
                CM.movingPanId = pan.id;
                const currentOffset = CM.state.gridOffsetByPan.get(pan.id) || { dx: 0, dy: 0 };
                // Même repère que la grille (cf. calculs.js::effectiveGridAngle) : le décalage manuel
                // des panneaux doit suivre les axes réels du rectangle, pas un pan.angle obsolète.
                const angle = CM.effectiveGridAngle(pan);
                const localStart = CM.rotateAroundOrigin(meterPt, -angle);
                CM.moveStart = { localX: localStart.x, localY: localStart.y, angle, startDx: currentOffset.dx, startDy: currentOffset.dy };
            }
            return;
        }
        if (CM.state.panelToolMode === 'delete') {
            const pan = CM.state.pans.find((p) => CM.pointInPolygon(meterPt, p.points));
            if (pan && CM.deletePanelAt(pan, meterPt)) {
                render();
                CM.recomputeResults();
            }
            return;
        }
        // 2026-10-09 : suppression multiple par sélection rectangulaire (cf. finaliserSuppressionRect).
        // Finitions : le rectangle suit les axes de la grille du champ (azimut), et un glissé au
        // bouton DROIT restaure les panneaux supprimés (même convention que la gomme).
        if (CM.state.panelToolMode === 'deleteRect') {
            CM.rectSuppression = {
                a: meterPt, b: meterPt, angle: angleRectSelection(meterPt), restaurer: e.button === 2,
            };
            if (e.button === 2) e.preventDefault();
            return;
        }
        // 2026-10-09 : déplacement du champ PV entier (contour + pans + obstacles + panneaux), saisi
        // à l'intérieur de son contour (cf. finaliserDeplacementChamp).
        if (CM.state.panelToolMode === 'moveField') {
            if (CM.state.roofLocal.length >= 3 && CM.pointInPolygon(meterPt, CM.state.roofLocal)) {
                CM.deplacementChamp = { depart: meterPt, dx: 0, dy: 0, geometrie: instantaneGeometrieChamp() };
                CM.canvas.style.cursor = 'grabbing';
            }
            return;
        }

        if (CM.state.tracingRidge) {
            if (!CM.state.ridgeTemp) {
                CM.state.ridgeTemp = meterPt;
            } else {
                CM.state.ridge = { a: CM.state.ridgeTemp, b: meterPt };
                CM.state.ridgeTemp = null;
                CM.state.tracingRidge = false;
                CM.updateRidgeButtonUI();
            }
            render();
            return;
        }

        // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal, cf. ButtonControl.js) —
        // même geste 2-clics que tracingRidge ci-dessus, mais ACCUMULE (push) au lieu de remplacer :
        // simple trait de mesure/annotation, sans lien avec panneaux/obstacles/contour.
        if (CM.state.tracingFreeLine) {
            if (!CM.state.freeLineTemp) {
                CM.state.freeLineTemp = meterPt;
            } else {
                CM.state.freeLines.push({ p1: CM.state.freeLineTemp, p2: meterPt });
                CM.state.freeLineTemp = null;
                CM.state.tracingFreeLine = false;
                CM.updateFreeLineButtonUI();
            }
            render();
            return;
        }

        // Rectangle de contour en 3 clics (demande explicite : "même comportement que le rectangle
        // dessiné sur la carte Google Map") : clic 1 = origine, clic 2 = fixe la LONGUEUR et la
        // DIRECTION, clic 3 = profondeur perpendiculaire. L'outil était jusqu'ici un rectangle à
        // 2 clics aligné sur les axes du repère local (min/max sur x et y), donc incapable de
        // suivre une toiture en biais. Le 3e clic trop proche de l'arête est ignoré (profondeur
        // nulle : aucun rectangle exploitable), même garde-fou que sur la carte
        // (_handleRectDrawThirdClick, seuil de 0,5 m).
        if (CM.state.tracingContourRect) {
            if (CM.state.contourRectPoints.length < 2) {
                CM.state.contourRectPoints.push(meterPt);
                CM.updateContourDrawButtonsUI();
            } else {
                const rectPoints = CM.rectFromThreePointsLocal(
                    CM.state.contourRectPoints[0], CM.state.contourRectPoints[1], meterPt
                );
                const depth = rectPoints
                    ? Math.hypot(rectPoints[2].x - rectPoints[1].x, rectPoints[2].y - rectPoints[1].y)
                    : 0;
                if (depth >= 0.5) {
                    finalizeContour(rectPoints, 'rect');
                    CM.state.tracingContourRect = false;
                    CM.state.contourRectPoints = [];
                    CM.updateContourDrawButtonsUI();
                }
            }
            render();
            return;
        }
        if (CM.state.drawingContourPolygon) {
            if (CM.state.contourPolygonPoints.length >= 3) {
                const first = CM.state.contourPolygonPoints[0];
                const r = handleRadiusMeters();
                if (Math.hypot(meterPt.x - first.x, meterPt.y - first.y) <= r) {
                    finalizeContour(CM.state.contourPolygonPoints.slice(), 'polygon');
                    CM.state.drawingContourPolygon = false;
                    CM.state.contourPolygonPoints = [];
                    CM.updateContourDrawButtonsUI();
                    render();
                    return;
                }
            }
            CM.state.contourPolygonPoints.push(meterPt);
            CM.updateContourDrawButtonsUI();
            render();
            return;
        }

        // NOUVEAU (édition du contour sur le canevas) : vérifié AVANT le hit-test d'obstacle générique
        // — un sommet du contour a priorité s'il est sous le curseur (typiquement aux coins du
        // rectangle/polygone, rarement superposé à un obstacle en pratique).
        const vertexIdx = hitTestContourVertex(meterPt);
        if (vertexIdx !== -1) {
            CM.isDraggingContourVertex = true;
            CM.draggedVertexIndex = vertexIdx;
            // Contour avant le glissé : rétabli si le sommet déplacé dépasse la surface maximale.
            CM.contourAvantGlisse = CM.state.roofLocal.map((p) => ({ ...p }));
            return;
        }

        const hit = hitTestObstacle(meterPt);
        if (hit) {
            CM.state.selectedObstacleId = hit.id;
            CM.isDraggingObstacle = true;
            CM.dragOffset = { x: meterPt.x - hit.x, y: meterPt.y - hit.y };
            CM.updateObstaclePropertiesPanel();
            render();
            return;
        }

        const champClique = champPvSousPointeur(meterPt);
        if (champClique && typeof CM.switchToSource === 'function') {
            CM.switchToSource(champClique);
            if (CM.canvas) { CM.canvas.style.cursor = 'default'; CM.canvas.title = ''; }
            return;
        }

        CM.state.selectedObstacleId = null;
        CM.updateObstaclePropertiesPanel();
        render();
    }

    function onDocumentMouseMove(e) {
        if (typeof CM.annotationsMouseMove === 'function' && CM.canvas
            && (!CM.modal || CM.modal.style.display !== 'none')
            && CM.annotationsMouseMove(e, getCanvasMeterPos(e), e.target === CM.canvas)) {
            demanderRendu(false);
            return;
        }
        if (CM.isPanningCanvas && CM.panStart) {
            CM.state.panOffsetX = CM.panStart.offX + (e.clientX - CM.panStart.x) * CM.panStart.scaleX;
            CM.state.panOffsetY = CM.panStart.offY + (e.clientY - CM.panStart.y) * CM.panStart.scaleY;
            demanderRendu(true);   // vue seule : placement des panneaux figé pendant le glissé
            return;
        }
        if (CM.rectSuppression) {
            CM.rectSuppression.b = getCanvasMeterPos(e);
            demanderRendu(true);   // seul le rectangle de sélection change
            return;
        }
        if (CM.deplacementChamp) {
            const p = getCanvasMeterPos(e);
            CM.deplacementChamp.dx = p.x - CM.deplacementChamp.depart.x;
            CM.deplacementChamp.dy = p.y - CM.deplacementChamp.depart.y;
            appliquerTranslationChamp(CM.deplacementChamp.geometrie, CM.deplacementChamp.dx, CM.deplacementChamp.dy);
            demanderRendu(false);
            return;
        }
        if (CM.isDraggingContourVertex && CM.draggedVertexIndex !== -1) {
            const meterPt = getCanvasMeterPos(e);
            const pts = CM.state.roofLocal;
            if (pts && pts[CM.draggedVertexIndex]) {
                if (CM.state.contourMode === 'rect' && pts.length === 4) {
                    // Contrainte "reste un rectangle à 90°" : le sommet déplacé + les 3 autres
                    // recalculés en une fois (même algorithme que l'édition sur la carte Google Maps,
                    // cf. polygon_maison.js::squareRectangleFromCorner — ici en mètres locaux).
                    const moved = pts.map((p, i) => (i === CM.draggedVertexIndex ? meterPt : p));
                    const squared = CM.squareRectangleFromLocalCorner(moved, CM.draggedVertexIndex);
                    if (squared) CM.state.roofLocal = squared;
                } else {
                    // Polygone libre : seul le sommet saisi bouge, les autres restent en place.
                    pts[CM.draggedVertexIndex] = meterPt;
                }
                demanderRendu(false);
            }
            return;
        }
        if ((CM.state.tracingContourRect && CM.state.contourRectPoints.length) ||
            (CM.state.drawingContourPolygon && CM.state.contourPolygonPoints.length) ||
            (CM.state.tracingFreeLine && CM.state.freeLineTemp)) {
            CM.lastMeterPt = getCanvasMeterPos(e);
            demanderRendu(false);
            return;
        }
        if (CM.isMovingPanels && CM.moveStart) {
            const meterPt = getCanvasMeterPos(e);
            const localNow = CM.rotateAroundOrigin(meterPt, -CM.moveStart.angle);
            CM.state.gridOffsetByPan.set(CM.movingPanId, {
                dx: CM.moveStart.startDx + (localNow.x - CM.moveStart.localX),
                dy: CM.moveStart.startDy + (localNow.y - CM.moveStart.localY),
            });
            demanderRendu(false);
            return;
        }
        if (CM.pendingObstacleType && CM.ghostEl) {
            CM.ghostEl.style.left = `${e.clientX + 8}px`;
            CM.ghostEl.style.top = `${e.clientY + 8}px`;
            return;
        }
        if (CM.isDraggingObstacle && CM.state.selectedObstacleId) {
            const meterPt = getCanvasMeterPos(e);
            const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
            if (o) {
                o.x = meterPt.x - CM.dragOffset.x;
                o.y = meterPt.y - CM.dragOffset.y;
                demanderRendu(false);
            }
            return;
        }
        if (CM.isResizingObstacle && CM.resizeObstacleId) {
            const meterPt = getCanvasMeterPos(e);
            const o = CM.state.obstacles.find((ob) => ob.id === CM.resizeObstacleId);
            if (o) {
                const local = CM.rotateAroundOrigin({ x: meterPt.x - o.x, y: meterPt.y - o.y }, -(o.angle || 0));
                o.w = Math.max(0.2, 2 * Math.abs(local.x));
                o.h = Math.max(0.2, 2 * Math.abs(local.y));
                CM.updateObstaclePropertiesPanel();
                demanderRendu(false);
            }
            return;
        }
        if (!CM.isDraggingContourVertex) majSurvolChampPv(e);
    }

    // NOUVEAU (édition du contour sur le canevas) : finalise un glissé de sommet — même recette que
    // applyContourDims() (formulaires.js, édition des champs Longueur/Largeur) : pan.points/angle
    // resynchronisés (divisionMode === 'none' garanti ici, seul cas où le glissé est autorisé,
    // cf. canEditContourVertices), contour répercuté sur le polygone Google Maps vivant s'il y en a
    // un, pas de recadrage automatique de la vue (juste une retouche, pas un nouveau tracé).
    function finalizeContourVertexDrag() {
        const avant = CM.contourAvantGlisse;
        CM.contourAvantGlisse = null;
        if (avant && refuserSurfaceContour(CM.state.roofLocal, CM.state.contourMode)) {
            CM.state.roofLocal = avant;
            if (CM.state.divisionMode === 'none' && CM.state.pans.length) CM.state.pans[0].points = CM.state.roofLocal;
            render();
            return;
        }
        if (CM.state.divisionMode === 'none' && CM.state.pans.length) CM.state.pans[0].points = CM.state.roofLocal;
        const refAngle = CM.angleReferenceStable(CM.state, CM.state.roofLocal);
        CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, refAngle));
        if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && CM.state.roofLocalOrigin && window.MaisonPolygonManagerInstance) {
            const newLatLngs = CM.state.roofLocal.map((pt) => CM.localToLatLng(CM.state.roofLocalOrigin, pt));
            // { silent: true } : sans ça, setPolygonPath() appelle _notifyReady() →
            // openCalepinageMaisonModal(), c'est-à-dire une RÉOUVERTURE COMPLÈTE du modal — dont un
            // CM.computeFit() qui remet à zéro l'échelle, le recadrage, zoomFactor et panOffset du
            // canevas. D'où le bug rapporté : à chaque retouche d'arête, l'image de fond (la carte)
            // et le canevas sautaient brutalement à un autre cadrage. La vue doit rester fixe : ce
            // n'est qu'une retouche, pas un nouveau tracé. Le rafraîchissement utile (cotations,
            // résultats, persistance) est fait juste après par l'appelant.
            window.MaisonPolygonManagerInstance.setPolygonPath(CM.state.currentPolygonRef, newLatLngs, { silent: true });
        }
        CM.updateContourDimsUI();
        render();
        CM.recomputeResults();
    }

    function onDocumentMouseUp(e) {
        if (typeof CM.annotationsMouseUp === 'function' && CM.annotationsMouseUp(e)) {
            render();
            return;
        }
        if (CM.rectSuppression) {
            const sel = CM.rectSuppression;
            CM.rectSuppression = null;
            finaliserSuppressionRect(sel);
            return;
        }
        if (CM.deplacementChamp) {
            const dep = CM.deplacementChamp;
            CM.deplacementChamp = null;
            if (typeof CM.updatePanelToolButtonsUI === 'function') CM.updatePanelToolButtonsUI();
            finaliserDeplacementChamp(dep);
            return;
        }
        if (CM.isDraggingContourVertex) {
            CM.isDraggingContourVertex = false;
            CM.draggedVertexIndex = -1;
            finalizeContourVertexDrag();
            return;
        }
        if (CM.isPanningCanvas) {
            CM.isPanningCanvas = false;
            CM.panStart = null;
            if (CM.canvas) CM.canvas.style.cursor = CM.state.panToolActive ? 'grab' : 'default';
            return;
        }
        if (CM.isMovingPanels) {
            CM.isMovingPanels = false;
            CM.movingPanId = null;
            CM.moveStart = null;
            CM.recomputeResults();
            return;
        }
        if (CM.pendingObstacleType) {
            const rect = CM.canvas.getBoundingClientRect();
            const overCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (overCanvas) {
                const meterPt = getCanvasMeterPos(e);
                const def = CM.OBSTACLE_TYPES[CM.pendingObstacleType];
                const id = `obs_${Date.now()}`;
                const containingPan = CM.state.pans.find((p) => CM.pointInPolygon(meterPt, p.points));
                CM.state.obstacles.push({
                    id, type: CM.pendingObstacleType, x: meterPt.x, y: meterPt.y,
                    w: def.defaultW, h: def.defaultH, buffer: def.defaultBuffer,
                    // NOUVEAU (demande explicite) : hauteur physique par défaut de ce type d'obstacle,
                    // utilisée pour son extrusion dans la vue 3D (cf. calepinage_maison_3d_geometry.js).
                    elevationM: def.defaultElevationM != null ? def.defaultElevationM : 0.3,
                    angle: containingPan ? (containingPan.angle || 0) : 0,
                    // Rattachement au champ PV (pan) qui le contient — permet de supprimer les
                    // obstacles avec leur champ PV (cf. demande explicite).
                    panId: containingPan ? containingPan.id : null,
                });
                CM.state.selectedObstacleId = id;
                CM.updateObstaclePropertiesPanel();
                CM.recomputeResults();
            }
            if (CM.ghostEl) { CM.ghostEl.remove(); CM.ghostEl = null; }
            CM.pendingObstacleType = null;
            render();
            return;
        }
        if (CM.isDraggingObstacle) { CM.isDraggingObstacle = false; CM.recomputeResults(); }
        if (CM.isResizingObstacle) { CM.isResizingObstacle = false; CM.resizeObstacleId = null; CM.recomputeResults(); }
    }

    // Restaure le panneau supprimé le plus proche au clic droit (outil "Suppr./Restaurer PV"
    // uniquement) — extrait de l'ancien handler inline `contextmenu` de createModal() pour éviter
    // 4 références cross-fichier dans le fichier formulaires (cf. plan de scission).
    function onCanvasContextMenu(e) {
        const meterPt = getCanvasMeterPos(e);

        // Clic droit sur un matériel électrique, un câble ou un marqueur de coordonnées : suppression
        // (même geste que sur la carte principale).
        if (typeof CM.annotationsContextMenu === 'function' && CM.annotationsContextMenu(e, meterPt)) {
            e.preventDefault();
            render();
            return;
        }

        // 2026-10-09 : outil rectangle — le bouton droit trace le rectangle de RESTAURATION (cf.
        // onCanvasMouseDown) : ni menu du navigateur, ni copie d'obstacle, ni suppression de ligne.
        if (CM.state.panelToolMode === 'deleteRect') {
            e.preventDefault();
            return;
        }

        // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal — "clic droit sur une
        // ligne pour la supprimer") : vérifié avant l'obstacle/panneau, mais seulement hors tracé
        // actif (une ligne en cours de pose ne doit pas se faire supprimer par le clic droit qui la
        // termine potentiellement ailleurs) — inoffensif de toute façon puisque cette zone est vide
        // tant qu'aucune ligne n'a été posée à cet endroit précis.
        if (!CM.state.tracingFreeLine) {
            const lineIdx = hitTestFreeLineIndex(meterPt);
            if (lineIdx !== -1) {
                e.preventDefault();
                CM.state.freeLines.splice(lineIdx, 1);
                render();
                return;
            }
        }

        // NOUVEAU (demande explicite : copier/coller un obstacle) : clic droit SUR un obstacle
        // ouvre une petite fenêtre demandant le nombre de copies — vérifié en premier, avant le
        // mode "Suppr./Restaurer PV" ci-dessous qui ne concerne que les panneaux et ne doit donc
        // jamais intercepter un clic droit destiné à un obstacle.
        const hitObstacle = hitTestObstacle(meterPt);
        if (hitObstacle) {
            e.preventDefault();
            CM.state.selectedObstacleId = hitObstacle.id;
            CM.updateObstaclePropertiesPanel();
            render();
            if (typeof CM.showObstacleCopyPrompt === 'function') {
                CM.showObstacleCopyPrompt(hitObstacle, e.clientX, e.clientY);
            }
            return;
        }

        if (CM.state.panelToolMode !== 'delete') return;
        e.preventDefault();
        const pan = CM.state.pans.find((p) => CM.pointInPolygon(meterPt, p.points));
        if (pan && CM.restoreNearestPanelAt(pan, meterPt)) {
            render();
            CM.recomputeResults();
        }
    }

    function setupPaletteDrag() {
        CM.modalBody.querySelectorAll('[data-obstacle-type]').forEach((item) => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                CM.pendingObstacleType = item.dataset.obstacleType;
                CM.ghostEl = document.createElement('div');
                CM.ghostEl.textContent = CM.OBSTACLE_TYPES[CM.pendingObstacleType].label;
                CM.ghostEl.style.cssText = 'position:fixed; z-index:1000000; pointer-events:none; background:rgba(37,99,235,0.9); color:#fff; padding:4px 8px; border-radius:4px; font-size:0.75rem; box-shadow:0 2px 6px rgba(0,0,0,0.3);';
                document.body.appendChild(CM.ghostEl);
                CM.ghostEl.style.left = `${e.clientX + 8}px`;
                CM.ghostEl.style.top = `${e.clientY + 8}px`;
            });
        });
    }

    /**
     * Conclut un tracé de contour fait au canevas (outils « Rectangle (contour) » / « Polygone libre
     * (contour) »).
     *
     * CORRECTIF (bug rapporté : "dessiner un rectangle ou un polygone libre contour fait disparaître
     * les champs PV1, PV2... initiaux") : sur une source « carte », ces deux outils REMPLAÇAIENT le
     * contour du champ PV ouvert — son calepinage, ses obstacles et sa division étaient perdus
     * (obstacles vidés, resetDivision()). Ils créent désormais un NOUVEAU champ PV (nouveau contour
     * sur la carte + nouvel identifiant PV{n}), ce qui répond à l'usage attendu : "dessiner d'autres
     * champs PV sans avoir à retourner sur la carte". Le champ PV courant est conservé intact
     * (switchToSource() sauvegarde son état avant de basculer).
     *
     * Le comportement historique de remplacement reste celui des sources « image » (photo/plan
     * importé) : elles n'ont aucun référentiel géographique, donc aucun polygone à créer sur la
     * carte, et y tracer le contour de la toiture EST l'usage prévu de ces outils.
     *
     * @param {Array<{x:number,y:number}>} points - sommets du contour, en mètres locaux
     * @param {'rect'|'polygon'} [mode='rect'] - outil utilisé ; fixe CM.state.contourMode, lu par
     *   resetDivision()/le resync d'orientation des pans (en 'polygon', l'angle de référence est une
     *   constante plein sud ; en 'rect', il vient de l'arête de longueur du tracé).
     */
    /**
     * Dépassement de la surface maximale d'un contour en mètres locaux (rectangle 25 000 m²,
     * polygone 50 000 m² par défaut, cf. config.py / polygon_maison.js::surfaceMaxContourM2).
     * contourCourant : `points` est le contour du champ PV affiché (et non un nouveau tracé) — s'il
     * est issu du bouton de décalage de parcelles cadastrales, la limite du polygone s'applique.
     * @returns {{surfaceM2: number, maxM2: number, mode: string}|null}
     */
    function depassementSurfaceContour(points, mode, contourCourant = true, marge = 0) {
        const MPM = window.MaisonPolygonManager;
        if (!MPM || typeof MPM.depassementSurface !== 'function') return null;
        const issuParcelles = contourCourant && CM.state && CM.state.currentPolygonRef && CM.state.currentPolygonRef.origineParcelles;
        const modeLimite = (issuParcelles || mode === 'polygon') ? 'polygon' : 'rect';
        return MPM.depassementSurface(MPM.surfaceLocaleM2(points), modeLimite, marge);
    }

    /** Affiche le refus d'un contour trop grand ; renvoie true si le contour est refusé. */
    function refuserSurfaceContour(points, mode, contourCourant = true) {
        const dep = depassementSurfaceContour(points, mode, contourCourant);
        if (!dep) return false;
        alert(window.MaisonPolygonManager.messageSurfaceDepassee(dep));
        return true;
    }

    function finalizeContour(points, mode = 'rect') {
        if (!points || points.length < 3) return;
        // Nouveau contour trop grand : refusé avant toute création de champ PV ni calcul ; l'appelant
        // termine l'outil de tracé, l'utilisateur reprend le dessin.
        if (refuserSurfaceContour(points, mode, false)) return;

        // Nouveau champ PV sur la carte dès qu'on dispose d'un référentiel géographique pour
        // convertir le tracé du canevas en coordonnées réelles.
        if (CM.state.sourceType === 'maps' && CM.state.roofLocalOrigin && window.MaisonPolygonManagerInstance
            && typeof window.MaisonPolygonManagerInstance.createPolygonFromLatLngs === 'function') {
            const latLngs = points.map((pt) => CM.localToLatLng(CM.state.roofLocalOrigin, pt));
            // CORRECTIF (bug rapporté : « en choisissant un PV dans la liste déroulante, le mode tracé
            // s'affiche, je dois faire Échap alors que je ne dessinais pas ») : createPolygonFromLatLngs()
            // bascule IMMÉDIATEMENT sur le nouveau champ PV (switchToSource) — l'appelant remettait ensuite
            // les indicateurs de tracé à zéro sur ce NOUVEAU champ, tandis que le champ d'origine restait
            // sauvegardé « tracé en cours ». Le tracé est donc terminé sur l'état d'origine AVANT la bascule.
            CM.state.tracingContourRect = false;
            CM.state.contourRectPoints = [];
            CM.state.drawingContourPolygon = false;
            CM.state.contourPolygonPoints = [];
            if (CM.updateContourDrawButtonsUI) CM.updateContourDrawButtonsUI();
            const nouveauPoly = window.MaisonPolygonManagerInstance.createPolygonFromLatLngs(latLngs, mode);
            if (nouveauPoly) {
                // createPolygonFromLatLngs() ouvre déjà le modal sur le nouveau champ PV
                // (_initPolygon -> _notifyReady), qui recalcule cadrage, UI et résultats : rien à
                // faire de plus ici, et surtout rien à toucher sur l'état du champ PV précédent.
                return;
            }
            // Échec de création (tracé inexploitable) : on retombe sur le remplacement ci-dessous
            // plutôt que de perdre silencieusement le geste de l'utilisateur.
        }

        CM.state.roofLocal = points;
        CM.state.refAngle = CM.computeRefAngle(CM.state.roofLocal);
        CM.state.contourMode = mode;
        CM.state.obstacles = [];
        CM.state.selectedObstacleId = null;
        CM.resetDivision();
        if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && CM.state.roofLocalOrigin && window.MaisonPolygonManagerInstance) {
            const newLatLngs = CM.state.roofLocal.map((pt) => CM.localToLatLng(CM.state.roofLocalOrigin, pt));
            // Garde poly.maisonMode synchronisé : sinon la prochaine ouverture du modal (qui
            // resynchronise CM.state.contourMode depuis le polygone vivant, cf.
            // openCalepinageMaisonModal()) écraserait ce choix avec l'ancien mode du polygone.
            CM.state.currentPolygonRef.maisonMode = mode;
            // { silent: true } : _notifyReady() réouvrirait entièrement le modal, alors que ce
            // bloc enchaine déjà lui-même computeFit()/render()/recomputeResults() juste en
            // dessous — double travail, et surtout un second recadrage qui écrase le premier.
            window.MaisonPolygonManagerInstance.setPolygonPath(CM.state.currentPolygonRef, newLatLngs, { silent: true });
        }
        computeFit();
        CM.updateContourDimsUI();
        CM.updateObstaclePropertiesPanel();
        render();
        CM.recomputeResults();
    }

    // Annule proprement un tracé de contour en cours (rectangle ou polygone) — appelé par Échap.
    function cancelContourDraw() {
        CM.state.tracingContourRect = false;
        CM.state.contourRectPoints = [];
        CM.state.drawingContourPolygon = false;
        CM.state.contourPolygonPoints = [];
        CM.updateContourDrawButtonsUI();
        render();
    }

    // --------------------------------------------------------------------------------------
    // Capture alignée de la vue carte (étape "Capturer")
    // --------------------------------------------------------------------------------------
    function isMapUiChrome(node) {
        if (!node || !node.classList) return false;
        // Poignée de rotation du contour (google.maps.Marker rendu en <img src="...sync.svg">, cf.
        // polygon_maison.js::_ensureRotationHandle) : outil d'édition, il ne doit pas se retrouver
        // incrusté dans l'image de fond du canevas (même raison que les étiquettes de cotation,
        // détachées le temps de la capture par captureMapView).
        if (node.tagName === 'IMG' && node.src && node.src.includes('sync.svg')) return true;
        return node.classList.contains('gm-control-active') ||
            node.classList.contains('gmnoprint') ||
            node.classList.contains('gm-style-cc') ||
            node.classList.contains('gm-fullscreen-control') ||
            node.classList.contains('gm-svpc') ||
            node.classList.contains('gm-style-mtc') ||
            node.classList.contains('drawing-control') ||
            node.classList.contains('custom-map-control');
    }

    let _projOverlay = null;
    function getMapContainerProjection() {
        if (!window.map || typeof google === 'undefined') return null;
        if (!_projOverlay) {
            _projOverlay = new google.maps.OverlayView();
            _projOverlay.onAdd = () => {};
            _projOverlay.draw = () => {};
            _projOverlay.onRemove = () => {};
            _projOverlay.setMap(window.map);
        }
        return _projOverlay.getProjection() || null;
    }

    function waitForMapProjection(maxWaitMs = 800) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tryGet = () => {
                const proj = getMapContainerProjection();
                if (proj || Date.now() - start > maxWaitMs) {
                    resolve(proj);
                } else {
                    setTimeout(tryGet, 30);
                }
            };
            tryGet();
        });
    }

    function pickReferenceVertices(poly) {
        if (!poly || poly.length < 2) return null;
        let best = null, bestDist = -1;
        for (let i = 0; i < poly.length; i++) {
            for (let j = i + 1; j < poly.length; j++) {
                const d = Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
                if (d > bestDist) { bestDist = d; best = [poly[i], poly[j]]; }
            }
        }
        return bestDist > 0.1 ? best : null;
    }

    /**
     * CORRECTIF (demande explicite : « la capture d'écran doit couvrir l'intégralité du rectangle ou
     * polygone dessiné sur la carte ») : html2canvas photographie la carte TELLE QU'AFFICHÉE — un contour
     * dont une partie sort du cadre (champ PV en bord de carte, carte déplacée ou zoomée depuis le tracé)
     * était capturé tronqué. Si un sommet sort du cadre (marge de sécurité incluse), la carte est recadrée
     * sur l'emprise complète du contour, puis on attend la fin du recadrage et des tuiles. Retourne la vue
     * précédente (à rétablir après la capture) ou null si aucun recadrage n'a été nécessaire.
     */
    const MARGE_CAPTURE_PX = 40;

    /**
     * Sommets (mètres, repère du champ affiché) que la capture de fond doit couvrir : le contour du champ
     * affiché et, en vue « tous les champs PV », ceux des autres champs — sinon ces derniers tombent hors
     * de l'image et la vue combinée montre la carte décalée à côté des formes.
     */
    function sommetsACapturer() {
        const state = CM.state;
        let points = (state.roofLocal || []).slice();
        if (CM.multiHouseViewActive && typeof CM.getOtherHouseContoursReprojected === 'function') {
            try {
                CM.getOtherHouseContoursReprojected().forEach((c) => { points = points.concat(c.roofLocal); });
            } catch (e) { /* autres champs indisponibles : seul le champ affiché est cadré */ }
        }
        return points;
    }

    function sommetsHorsCadre(projection, mapElement, state) {
        const largeur = mapElement.clientWidth, hauteur = mapElement.clientHeight;
        return sommetsACapturer().some((pt) => {
            const p = projection.fromLatLngToContainerPixel(CM.localToLatLng(state.roofLocalOrigin, pt));
            return !p || p.x < MARGE_CAPTURE_PX || p.y < MARGE_CAPTURE_PX
                || p.x > largeur - MARGE_CAPTURE_PX || p.y > hauteur - MARGE_CAPTURE_PX;
        });
    }

    // Inverse de imagePixelToLocalMeters : position (pixels) d'un point du repère local dans la capture.
    function localMetersToImagePixel(pt) {
        const ref = CM.state.mapScreenshotRef;
        const p1 = { x: ref.p1.x, y: -ref.p1.y };
        const p2 = { x: ref.p2.x, y: -ref.p2.y };
        const sv = { x: p2.x - p1.x, y: p2.y - p1.y };
        const mv = { x: ref.m2.x - ref.m1.x, y: ref.m2.y - ref.m1.y };
        const scale = Math.hypot(mv.x, mv.y) / (Math.hypot(sv.x, sv.y) || 1);
        const angle = Math.atan2(mv.y, mv.x) - Math.atan2(sv.y, sv.x);
        const rel = CM.rotateAroundOrigin({ x: (pt.x - ref.m1.x) / (scale || 1), y: (pt.y - ref.m1.y) / (scale || 1) }, -angle);
        return { x: rel.x + p1.x, y: -(rel.y + p1.y) };
    }

    /**
     * Vue « tous les champs PV » : si un autre champ sort de la capture de fond actuelle, la carte est
     * recapturée en couvrant tous les champs, puis la vue recadrée — la carte reste sous les formes.
     * @returns {Promise<boolean>} true si une nouvelle capture a été faite
     */
    async function assurerFondCarteVueMulti() {
        const state = CM.state;
        if (!CM.multiHouseViewActive || state.sourceType !== 'maps') return false;
        if (!state.roofLocalOrigin || typeof state.roofLocalOrigin.lat !== 'function') return false;
        if (typeof CM.getOtherHouseContoursReprojected !== 'function') return false;
        const autres = CM.getOtherHouseContoursReprojected();
        if (!autres.length) return false;
        const img = state.mapScreenshotImgObj;
        if (img && state.mapScreenshotRef) {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            const tousCouverts = autres.every((c) => c.roofLocal.every((pt) => {
                const p = localMetersToImagePixel(pt);
                return p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
            }));
            if (tousCouverts) return false;
            // Capture « serrée » du champ conservée (meilleure résolution) : rétablie en quittant la vue.
            if (!state.fondAvantVueMulti) state.fondAvantVueMulti = { img, ref: state.mapScreenshotRef };
        }
        await captureMapView();
        if (CM.multiHouseViewActive) {
            computeFit();
            render();
        }
        return true;
    }

    /** Sortie de la vue « tous les champs PV » : rétablit la capture serrée du champ, s'il y en avait une. */
    function restaurerFondAvantVueMulti() {
        const state = CM.state;
        const fond = state && state.fondAvantVueMulti;
        if (!fond) return false;
        state.mapScreenshotToken = (state.mapScreenshotToken || 0) + 1; // invalide une capture en cours
        state.mapScreenshotImgObj = fond.img;
        state.mapScreenshotRef = fond.ref;
        state.fondAvantVueMulti = null;
        return true;
    }

    function attendreEvenementCarte(map, nom, delaiMaxMs) {
        return new Promise((resolve) => {
            let fini = false;
            const terminer = () => { if (!fini) { fini = true; resolve(); } };
            const ecouteur = google.maps.event.addListenerOnce(map, nom, terminer);
            setTimeout(() => { google.maps.event.removeListener(ecouteur); terminer(); }, delaiMaxMs);
        });
    }

    // cadrageSerre : recadre TOUJOURS la carte sur le contour, même s'il est déjà visible. Sans lui,
    // une carte dézoomée donnait un fond couvrant des kilomètres : en 3D, le sol démesuré éloignait la
    // caméra et le champ n'était plus visible (fond demandé par la vue 3D du dossier de plans).
    async function cadrerCarteSurContourPourCapture(mapElement, cadrageSerre) {
        const map = window.map;
        const state = CM.state;
        if (!map || typeof google === 'undefined' || !google.maps || !state || !(state.roofLocal || []).length) return null;
        if (!state.roofLocalOrigin || typeof state.roofLocalOrigin.lat !== 'function') return null;
        const projection = await waitForMapProjection();
        if (!cadrageSerre && projection && !sommetsHorsCadre(projection, mapElement, state)) return null;

        const vuePrecedente = { center: map.getCenter(), zoom: map.getZoom() };
        const emprise = new google.maps.LatLngBounds();
        sommetsACapturer().forEach((pt) => emprise.extend(CM.localToLatLng(state.roofLocalOrigin, pt)));
        const recadrage = attendreEvenementCarte(map, 'idle', 4000);
        map.fitBounds(emprise, MARGE_CAPTURE_PX + 20);
        await recadrage;
        // Délais allongés (bug rapporté : vue aérienne absente de la vue 3D du dossier des ombrières,
        // la photo partait avant la fin du chargement des tuiles).
        await attendreEvenementCarte(map, 'tilesloaded', 6000);
        return vuePrecedente;
    }

    /**
     * Attend que toutes les tuiles (<img>) de la carte soient décodées, borné à `delaiMaxMs`, puis
     * laisse un temps de repaint : `tilesloaded` part parfois avant l'affichage réel des images, et
     * html2canvas photographiait alors des tuiles vides.
     */
    async function attendreImagesCarte(mapElement, delaiMaxMs) {
        const fin = Date.now() + delaiMaxMs;
        while (Date.now() < fin) {
            const images = Array.from(mapElement.querySelectorAll('img'));
            if (images.every((img) => img.complete)) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    /**
     * Capture de carte encore incomplète (bug rapporté : vue aérienne absente du sol 3D des dossiers
     * de plans, « il faut parfois attendre un peu plus ») : tuiles pas encore peintes au moment de la
     * photo. Elles sortent transparentes ou d'un aplat parfaitement uniforme (fond gris de la carte),
     * alors qu'une vraie photo aérienne garde du grain. Échantillonnage au plus proche voisin (le
     * lissage moyennerait ce grain) ; une couleur exacte qui couvre plus du tiers de l'image = capture
     * à refaire. Illisible (canevas protégé) : considérée complète, la capture reste utilisée.
     */
    const ECHANTILLON_CAPTURE_PX = 96;
    function captureCarteIncomplete(canvas) {
        try {
            if (!canvas || !canvas.width || !canvas.height) return true;
            const n = ECHANTILLON_CAPTURE_PX;
            const ech = document.createElement('canvas');
            ech.width = n; ech.height = n;
            const ctx = ech.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(canvas, 0, 0, n, n);
            const data = ctx.getImageData(0, 0, n, n).data;
            const compte = new Map();
            let max = 0;
            for (let i = 0; i < data.length; i += 4) {
                const cle = data[i + 3] < 16 ? -1 : ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
                const c = (compte.get(cle) || 0) + 1;
                compte.set(cle, c);
                if (c > max) max = c;
            }
            return max / (n * n) > 0.35;
        } catch (e) {
            return false;
        }
    }
    const ESSAIS_CAPTURE_CARTE = 3;

    function retablirVueCarte(vue) {
        if (!vue || !window.map) return;
        if (vue.zoom != null) window.map.setZoom(vue.zoom);
        if (vue.center) window.map.setCenter(vue.center);
    }

    async function captureMapView(options) {
        const mapElement = document.getElementById('map');
        if (!mapElement || typeof html2canvas === 'undefined') return;

        let vueAvantCapture = null;
        try {
            vueAvantCapture = await cadrerCarteSurContourPourCapture(mapElement, !!(options && options.cadrageSerre));
        } catch (e) {
            console.warn('[captureMapView] Recadrage de la carte sur le contour impossible, capture de la vue actuelle.', e);
        }
        // Panneaux, matériels électriques et marqueurs reportés sur la carte : retirés de la capture de
        // fond, sinon ils y figeraient une copie qui ne suivrait plus le calepinage dessiné par-dessus.
        let retablirElementsCarte = null;
        // Contours des champs PV (remplissage bleu, trait orange, sommets) : retirés eux aussi — sinon
        // ils restent imprimés dans la photo, visibles sur le sol et sur les toits de la vue 3D
        // (demande explicite). Le canevas redessine déjà le contour par-dessus le fond.
        let retablirContours = null;
        try {
            const mgr = window.MaisonPolygonManagerInstance;
            if (mgr && typeof mgr.setAllPolygonsVisible === 'function') retablirContours = mgr.setAllPolygonsVisible(false);
        } catch (e) {
            retablirContours = null;
        }
        try {
            if (typeof CM.masquerElementsCarteCalepinage === 'function') {
                retablirElementsCarte = CM.masquerElementsCarteCalepinage();
            }
        } catch (e) {
            retablirElementsCarte = null;
        }
        // Laisse à Google Maps le temps de redessiner la carte sans ces éléments.
        if (retablirElementsCarte || retablirContours) await new Promise((resolve) => setTimeout(resolve, 150));
        await attendreImagesCarte(mapElement, 5000);
        try {
            await capturerVueCarteCadree(mapElement);
        } finally {
            if (retablirElementsCarte) retablirElementsCarte();
            if (retablirContours) { try { retablirContours(); } catch (e) { /* noop */ } }
            retablirVueCarte(vueAvantCapture);
        }
    }

    async function capturerVueCarteCadree(mapElement) {
        const projection = await waitForMapProjection();
        const refPts = pickReferenceVertices(CM.state.roofLocal);
        // roofLocalOrigin doit être une vraie google.maps.LatLng (méthode .lat) — il N'EST PAS
        // persisté (cf. PERSISTED_STATE_FIELDS) : sur un projet rechargé sans réouverture du polygone
        // il vaut null -> localToLatLng() planterait / donnerait des pixels aberrants. Dans ce cas on
        // bascule sur l'aperçu simple (pas de fond calé sur la carte).
        const originOk = CM.state.roofLocalOrigin && typeof CM.state.roofLocalOrigin.lat === 'function';
        let p1 = (refPts && projection && originOk) ? projection.fromLatLngToContainerPixel(CM.localToLatLng(CM.state.roofLocalOrigin, refPts[0])) : null;
        let p2 = (refPts && projection && originOk) ? projection.fromLatLngToContainerPixel(CM.localToLatLng(CM.state.roofLocalOrigin, refPts[1])) : null;
        // Garde-fou d'échelle : si les 2 sommets de référence (plusieurs mètres d'écart réel)
        // retombent à quelques pixels l'un de l'autre, la projection est inexploitable (carte
        // dézoomée, masquée, projection périmée...) — poser un fond calé dessus donnerait une image
        // démesurée (bug rapporté). On refuse alors le calage et on montre l'aperçu simple.
        if (p1 && p2) {
            const pxDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const realDist = Math.hypot(refPts[1].x - refPts[0].x, refPts[1].y - refPts[0].y);
            const pxPerM = pxDist / (realDist || 1);
            // Projection corrompue -> px/m proche de 0. Un vrai calepinage se fait à px/m >= ~1
            // (zoom ~18+). Seuil bas (0.5) : ne rejette que les cas manifestement cassés.
            if (pxDist < 12 || (realDist > 3 && pxPerM < 0.5)) {
                console.warn('[captureMapView] projection carte inexploitable (px/m =', pxPerM.toFixed(3), ') — fond non calé, aperçu simple.');
                p1 = null; p2 = null;
            }
        }

        const token = ++CM.state.mapScreenshotToken;
        // CORRECTIF (bug rapporté : "les cotations du polygone s'affichent de manière trouble sur la
        // capture d'écran") : isMapUiChrome ne filtre que les contrôles Google Maps génériques, jamais
        // les étiquettes de cotation (AdvancedMarkerElement posées par polygon_maison.js) — détachées
        // temporairement de la carte (non détruites) le temps de la capture html2canvas, systématiquement
        // remises en place ensuite (y compris en cas d'erreur).
        const maisonMgr = window.MaisonPolygonManagerInstance;
        if (maisonMgr) {
            maisonMgr.setAllDimensionLabelsVisible(false);
            // Labels PV / flèches d'azimut / bouton de configuration : même sort que les
            // cotations pendant une capture. Garde de présence : une instance restaurée d'une
            // version antérieure du module n'a pas encore cette méthode.
            if (typeof maisonMgr.setAllRoofVisualsVisible === 'function') maisonMgr.setAllRoofVisualsVisible(false);
        }
        let canvasCapture;
        try {
            // Tuiles pas encore peintes : nouvel essai après une attente supplémentaire (borné). La
            // carte ne bouge pas entre deux essais : p1/p2 restent valables.
            for (let essai = 1; ; essai++) {
                canvasCapture = await html2canvas(mapElement, { useCORS: true, allowTaint: true, ignoreElements: isMapUiChrome, scale: 1 });
                if (essai >= ESSAIS_CAPTURE_CARTE || !captureCarteIncomplete(canvasCapture)) break;
                console.warn('[captureMapView] Carte pas encore entièrement chargée, nouvel essai (' + (essai + 1) + '/' + ESSAIS_CAPTURE_CARTE + ').');
                if (window.map && typeof google !== 'undefined' && google.maps) {
                    await attendreEvenementCarte(window.map, 'tilesloaded', 3000);
                }
                await attendreImagesCarte(mapElement, 3000);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        } finally {
            if (maisonMgr) {
                maisonMgr.setAllDimensionLabelsVisible(true);
                if (typeof maisonMgr.setAllRoofVisualsVisible === 'function') maisonMgr.setAllRoofVisualsVisible(true);
            }
        }
        if (token !== CM.state.mapScreenshotToken) return;

        const dataUrl = canvasCapture.toDataURL('image/jpeg', 0.9);
        if (p1 && p2) {
            const img = new Image();
            // CORRECTIF (bug rapporté : "j'ai dû cliquer 2 fois pour avoir la capture d'écran dans les
            // plans") : le décodage d'une image est asynchrone, même pour une data URL. Cette fonction
            // rendait la main AVANT que `onload` ne se déclenche, donc avant que le fond ne soit posé
            // sur l'état : tout appelant qui enchaînait sur un rendu (l'export PDF, le rapport)
            // travaillait sur une maison encore sans fond de carte. Au clic suivant l'image était
            // chargée, d'où le fond qui n'apparaissait qu'au second essai. On attend désormais la fin
            // du chargement — borné, pour ne jamais bloquer un export si l'image ne se décode pas.
            const imageChargee = new Promise((resolve) => {
                let regle = false;
                const finir = () => { if (!regle) { regle = true; resolve(); } };
                img.onload = finir;
                img.onerror = finir;
                setTimeout(finir, 5000);
            });
            img.src = dataUrl;
            await imageChargee;
            CM.state.mapScreenshotRef = { m1: refPts[0], m2: refPts[1], p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } };
            CM.state.showBackgroundImage = true;
            if (token === CM.state.mapScreenshotToken && img.naturalWidth) CM.state.mapScreenshotImgObj = img;
            const bgCheckbox = CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox');
            if (bgCheckbox) bgCheckbox.checked = true;
        } else {
            CM.previewImg.src = dataUrl;
            CM.previewImg.style.display = 'block';
            const bgCheckbox = CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox');
            if (bgCheckbox) bgCheckbox.checked = true;
            CM.state.showBackgroundImage = true;
        }
        if (CM.updateVisibilityToggleButtonsUI) CM.updateVisibilityToggleButtonsUI();
        render();
        // Vue 3D affichée pour ce champ (bouton « Vue 3D » de la palette : le modal s'ouvre
        // directement en 3D, AVANT la fin de la capture automatique de la carte) : sol reconstruit
        // avec la vue aérienne dès qu'elle est disponible (demande explicite).
        if (CM.state.view3DMode && typeof CM.refresh3DView === 'function') CM.refresh3DView();
    }

    /**
     * NOUVEAU (demande explicite : "ajouter un bouton Export... PDF avec une capture d'écran du
     * calepinage uniquement sur le canva et une autre capture canva et carte") : réutilise
     * l'élément canvas RÉELLEMENT affiché (CM.canvas, la maison actuellement ouverte — pas de
     * re-rendu hors-écran nécessaire, contrairement à captureRoofDiagramImage() qui sert un tout
     * autre cas : capturer une AUTRE maison que celle affichée à l'écran) + une capture html2canvas
     * de la carte sous-jacente (même appel que captureMapView() ci-dessus, sans sa logique de point
     * de référence propre à un tout autre usage — fixer l'image de fond du canevas). Ce modal doit
     * être masqué le temps de cette 2e capture, sinon c'est lui (et non la carte) qui serait capturé.
     *
     * options.sourceId (facultatif) : champ PV à exporter, ouvert ou non dans ce modal (palette des
     * exports du pompage solaire). Le document s'ouvre dans l'aperçu avant téléchargement
     * (services/PdfPreview.js). Renvoie true si le PDF a été produit.
     */
    async function exportCanvasEtCartePdf(options) {
        const sourceIdDemande = options && options.sourceId;
        if (sourceIdDemande && !options.fondCarteAssure) {
            // Fond de carte du plan : capture de la vue aérienne gardée en mémoire seulement après
            // l'ouverture du champ dans la session — absente si on exporte sans l'avoir ouvert. Même
            // préparation que les captures du rapport pompage (ensureMapBackground), fond affiché le
            // temps de l'export puis réglage de l'utilisateur rétabli.
            const etatFond = typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(sourceIdDemande) : null;
            const fondAffiche = etatFond ? etatFond.showBackgroundImage : undefined;
            if (etatFond && await ensureMapBackground(sourceIdDemande)) etatFond.showBackgroundImage = true;
            try {
                return await exportCanvasEtCartePdf(Object.assign({}, options, { fondCarteAssure: true }));
            } finally {
                if (etatFond) etatFond.showBackgroundImage = fondAffiche;
            }
        }
        if (sourceIdDemande && !(CM.canvas && CM.state && CM.state.sourceId === sourceIdDemande)) {
            // Champ non affiché : état basculé le temps de l'export, comme captureRoofDiagramImage,
            // sur un canevas de brouillon pour ne jamais redessiner le champ affiché à l'écran.
            const etat = typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(sourceIdDemande) : null;
            if (!etat) {
                console.warn('[exportCanvasEtCartePdf] Champ PV inconnu :', sourceIdDemande);
                return false;
            }
            const canvasAffiche = CM.canvas;
            const etatAffiche = CM.state;
            const brouillon = document.createElement('canvas');
            brouillon.width = 1400;
            brouillon.height = 1000;
            CM.canvas = brouillon;
            CM.state = etat;
            try {
                return await exportCanvasEtCartePdf(options);
            } finally {
                CM.canvas = canvasAffiche;
                CM.state = etatAffiche;
            }
        }
        if (!CM.canvas || typeof html2canvas === 'undefined' || !window.jspdf) {
            console.warn('[exportCanvasEtCartePdf] canvas, html2canvas ou jsPDF indisponible.');
            return false;
        }

        // 1. Plan du calepinage.
        // CORRECTIF (demande explicite : "pousser le zoom au maximum sur le calepinage en plan, on ne
        // voit pas bien les panneaux") : re-rendu hors écran avec un cadrage SERRÉ sur le bâti plutôt
        // que la reprise du canvas affiché, dont le cadrage inclut toute l'image de fond (le
        // voisinage) et réduit donc les panneaux à peu de pixels une fois la vue posée dans le PDF.
        // Repli sur le canvas affiché si ce rendu échoue.
        let canvasDataUrl = CM.canvas.toDataURL('image/png');
        let canvasW = CM.canvas.width, canvasH = CM.canvas.height;
        try {
            const sourceIdPlan = CM.state && CM.state.sourceId;
            if (sourceIdPlan) {
                const serre = await captureRoofDiagramImage(sourceIdPlan, 1400, 1000);
                if (serre) {
                    canvasDataUrl = serre.toDataURL('image/png');
                    canvasW = serre.width; canvasH = serre.height;
                }
            }
        } catch (e) {
            console.warn('[exportCanvasEtCartePdf] Rendu serré du plan impossible, reprise du canvas affiché.', e);
        }

        // 2. Capture de la carte : masque temporairement ce modal (sinon capturé à la place de la
        // carte), restaure systématiquement son affichage ensuite (bloc finally).
        const mapElement = document.getElementById('map');
        let mapDataUrl = null, mapW = 0, mapH = 0;
        const wasModalVisible = !!(CM.modal && CM.modal.style.display !== 'none');
        // CORRECTIF (bug rapporté : "les cotations du polygone s'affichent de manière trouble sur la
        // capture d'écran") : même correctif que captureMapView() — étiquettes de cotation détachées
        // temporairement de la carte (non détruites) le temps de la capture, remises en place dans le
        // bloc finally existant.
        const maisonMgr = window.MaisonPolygonManagerInstance;
        if (maisonMgr) {
            maisonMgr.setAllDimensionLabelsVisible(false);
            // Labels PV / flèches d'azimut / bouton de configuration : même sort que les
            // cotations pendant une capture. Garde de présence : une instance restaurée d'une
            // version antérieure du module n'a pas encore cette méthode.
            if (typeof maisonMgr.setAllRoofVisualsVisible === 'function') maisonMgr.setAllRoofVisualsVisible(false);
        }
        let vueAvantExport = null;
        try {
            if (mapElement) {
                // Contour entier dans la vue aérienne (même recadrage que captureMapView).
                try {
                    vueAvantExport = await cadrerCarteSurContourPourCapture(mapElement);
                } catch (e) {
                    console.warn('[exportCanvasEtCartePdf] Recadrage de la carte impossible.', e);
                }
                if (wasModalVisible) {
                    CM.modal.style.setProperty('display', 'none', 'important');
                    if (CM.backdrop) CM.backdrop.style.setProperty('display', 'none', 'important');
                    await new Promise((resolve) => setTimeout(resolve, 250)); // laisse le repaint se faire
                }
                const mapCanvas = await html2canvas(mapElement, { useCORS: true, allowTaint: true, ignoreElements: isMapUiChrome, scale: 1 });
                mapDataUrl = mapCanvas.toDataURL('image/jpeg', 0.9);
                mapW = mapCanvas.width; mapH = mapCanvas.height;
            }
        } finally {
            if (wasModalVisible && CM.modal) {
                CM.modal.style.setProperty('display', 'flex', 'important');
                if (CM.backdrop) CM.backdrop.style.setProperty('display', 'block', 'important');
            }
            if (maisonMgr) {
                maisonMgr.setAllDimensionLabelsVisible(true);
                if (typeof maisonMgr.setAllRoofVisualsVisible === 'function') maisonMgr.setAllRoofVisualsVisible(true);
            }
            retablirVueCarte(vueAvantExport);
        }

        // 3. Assemblage du PDF (2 pages) — même moteur (jsPDF UMD global) que ExportService.js
        // (this.jsPDF = window.jspdf).
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
        const margin = 10;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const usableWidth = pageWidth - 2 * margin;
        const usableHeight = pageHeight - 2 * margin - 6;

        // Même logique de conservation du ratio/ajustement à la boîte disponible que
        // ExportService.js::addTwoCapturedImagesSideBySide()/addCapturedImage().
        const placeCentered = (dataUrl, format, w, h, x, boxWidth, y, boxHeight) => {
            const ratio = h / w;
            let drawW = boxWidth, drawH = drawW * ratio;
            if (drawH > boxHeight) { drawH = boxHeight; drawW = drawH / ratio; }
            const xCentered = x + (boxWidth - drawW) / 2;
            const yCentered = y + (boxHeight - drawH) / 2;
            doc.addImage(dataUrl, format, xCentered, yCentered, drawW, drawH, undefined, 'FAST');
        };

        // Puissance du projet et nombre de panneaux (tous les champs PV), rappelés à droite du titre
        // de chaque page (demande explicite) ; le champ exporté est détaillé s'il y en a plusieurs.
        let resumeProjet = '';
        try {
            const resume = typeof CM.computeAllHousesResultsSummary === 'function' ? CM.computeAllHousesResultsSummary() : null;
            if (resume) {
                const kwc = (v) => Number(v || 0).toFixed(2).replace('.', ',');
                resumeProjet = `Puissance du projet : ${kwc(resume.totalPowerKwc)} kWc  |  Nombre de panneaux : ${resume.totalCount}`;
                const champId = CM.state && CM.state.sourceId;
                if (resume.houseCount > 1 && champId) {
                    const pansDuChamp = resume.perPan.filter((p) => p.sourceId === champId);
                    const nbChamp = pansDuChamp.reduce((s, p) => s + p.count, 0);
                    const kwcChamp = pansDuChamp.reduce((s, p) => s + p.powerKwc, 0);
                    resumeProjet += `  (${champId} : ${kwc(kwcChamp)} kWc, ${nbChamp} panneaux)`;
                }
            }
        } catch (e) {
            console.warn('[exportCanvasEtCartePdf] Puissance du projet indisponible.', e);
        }
        const titrePage = (titre) => {
            doc.setFontSize(12);
            doc.text(titre, margin, margin);
            if (resumeProjet) {
                // Juste après le titre (demande explicite : rapproché vers la gauche).
                const finTitre = margin + doc.getTextWidth(titre);
                doc.setFontSize(10);
                doc.text(resumeProjet, finTitre + 12, margin);
            }
        };

        titrePage('Plan de calepinage');
        placeCentered(canvasDataUrl, 'PNG', canvasW, canvasH, margin, usableWidth, margin + 6, usableHeight);

        if (mapDataUrl) {
            doc.addPage();
            titrePage('Plan de calepinage + vue aérienne');
            const gap = 6;
            const halfWidth = (usableWidth - gap) / 2;
            const boxY = margin + 6;
            placeCentered(canvasDataUrl, 'PNG', canvasW, canvasH, margin, halfWidth, boxY, usableHeight);
            placeCentered(mapDataUrl, 'JPEG', mapW, mapH, margin + halfWidth + gap, halfWidth, boxY, usableHeight);
        }

        // NOUVEAU (demande explicite : "ajouter les captures d'écran 2D et 3D dans la page PDF du
        // modal calepinage, on doit d'abord tester que cela fonctionne avant de les mettre dans le
        // rapport") : ces 2 pages sont EXACTEMENT ce que le rapport résidentiel produira, avec les
        // mêmes appels (captureVue3DImage en isométrique puis en isométrique opposée, diagramme 2D
        // déjà capturé plus haut). Ce bouton sert donc de banc d'essai : si ces pages sortent
        // correctement ici, le rapport les sortira aussi.
        //
        // Chaque capture est bornée dans le temps et son échec est sans conséquence : le PDF est
        // enregistré dans tous les cas, avec les pages qui ont pu être produites.
        const sourceId = CM.state && CM.state.sourceId;
        if (sourceId && typeof CM.captureVue3DImage === 'function') {
            // La capture prise par l'utilisateur (appareil photo de la barre 3D) remplace la vue Iso
            // automatique quand elle existe — même règle que le rapport (cf. captureVue3DImage). Elle
            // est enregistrée en JPEG 1600 x 1100 : le format jsPDF est déduit de la data URL.
            const captureUtilisateur = typeof CM.getCapture3DUtilisateur === 'function'
                ? CM.getCapture3DUtilisateur(sourceId) : null;
            const vueIso = await CM.captureVue3DImage(sourceId, { mode: 'iso', width: 1600, height: 1100 });
            if (vueIso) {
                doc.addPage();
                titrePage(captureUtilisateur ? 'Vue 3D' : 'Vue 3D isométrique');
                const formatIso = String(vueIso).indexOf('data:image/jpeg') === 0 ? 'JPEG' : 'PNG';
                placeCentered(vueIso, formatIso, 1600, 1100, margin, usableWidth, margin + 6, usableHeight);
            } else {
                console.warn('[exportCanvasEtCartePdf] Vue 3D isométrique indisponible — page omise.');
            }

            const vueIsoOpposee = await CM.captureVue3DImage(sourceId, { mode: 'iso-oppose', width: 1600, height: 1100 });
            if (vueIsoOpposee) {
                doc.addPage();
                titrePage('Vue calepinage (plan 2D + vue 3D côté opposé)');
                const gap2 = 6;
                const halfWidth2 = (usableWidth - gap2) / 2;
                const boxY2 = margin + 6;
                placeCentered(canvasDataUrl, 'PNG', canvasW, canvasH, margin, halfWidth2, boxY2, usableHeight);
                placeCentered(vueIsoOpposee, 'PNG', 1600, 1100, margin + halfWidth2 + gap2, halfWidth2, boxY2, usableHeight);
            } else {
                console.warn('[exportCanvasEtCartePdf] Vue 3D opposée indisponible — page omise.');
            }
        } else {
            console.warn('[exportCanvasEtCartePdf] Capture 3D indisponible (maison inconnue ou viewer 3D non chargé).');
        }

        const houseName = (CM.state && CM.state.sourceLabel) || 'maison';
        const nomFichier = `calepinage-${houseName}.pdf`.replace(/\s+/g, '_');
        if (typeof window.ouvrirApercuPdf === 'function') window.ouvrirApercuPdf(doc.output('blob'), nomFichier);
        else doc.save(nomFichier);
        return true;
    }

    /**
     * NOUVEAU (rapport PDF résidentiel — "Plan de calepinage", demande explicite : 2 captures côte
     * à côte, "les panneaux issus du canva" + la capture aérienne existante) : redessine le
     * diagramme toiture/panneaux d'une maison (identifiée par sourceId) sur un canvas HORS-ÉCRAN,
     * sans jamais ouvrir son modal — bascule temporaire de CM.canvas/CM.state (synchrone, restaurée
     * dans le `finally`, aucun effet de bord sur la maison actuellement affichée à l'écran). Renvoie
     * le <canvas> hors-écran (même contrat que ExportService.js::captureByCoordinates()), ou null
     * si la maison est inconnue. Consommé par ExportService.js::handlePage2().
     */
    // options.margeMetres / options.pointsLocaux (facultatifs) : cf. cadrerSurContour — utilisés par
    // le dossier de Déclaration préalable pour garder toutes les cotations dans le plan de toiture.
    // Le canvas rendu porte alors `localVersPixels(pt)` : repère local (m) -> pixels du canvas, pour
    // y superposer des tracés (cotations de la carte, limite de parcelle).
    async function captureRoofDiagramImage(sourceId, targetWidth, targetHeight, options) {
        if (typeof CM.getHouseStateById !== 'function') return null;
        const state = CM.getHouseStateById(sourceId);
        if (!state) return null;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetWidth || 1200;
        offCanvas.height = targetHeight || 800;

        // CORRECTIF (effet de bord rapporté par investigation : "la vue live se désajuste après un
        // export PDF") : getHouseStateById() peut renvoyer l'objet CM.state EXACT en cours (maison
        // actuellement ouverte, pas une copie) — computeFit() ci-dessous mutera alors directement ses
        // champs de cadrage pour la taille hors-écran (1200x800 par défaut), désajustant la vue
        // réellement affichée jusqu'au prochain recadrage explicite. Sauvegardés ici et restaurés
        // dans le finally, que `state` soit ou non le même objet que CM.state (sans effet si ce n'est
        // pas le cas, l'objet reconstruit étant de toute façon jeté après cet appel).
        const savedFit = {
            scale: state.scale, offsetX: state.offsetX, offsetY: state.offsetY,
            zoomFactor: state.zoomFactor, panOffsetX: state.panOffsetX, panOffsetY: state.panOffsetY,
        };

        const previousCanvas = CM.canvas;
        const previousState = CM.state;
        CM.canvas = offCanvas;
        CM.state = state;
        try {
            // Cadrage serré sur le bâti (et non computeFit(), qui inclut toute l'image de fond) :
            // c'est ce qui rend les panneaux lisibles une fois la vue réduite dans le PDF.
            cadrerSurContour(20, options && options.margeMetres, options && options.pointsLocaux);
            render();
            const repere = {
                s: state.scale * state.zoomFactor,
                ox: state.offsetX + state.panOffsetX,
                oy: state.offsetY + state.panOffsetY,
                aligne: state.viewMode === 'aligned',
                refAngle: state.refAngle,
            };
            offCanvas.localVersPixels = (pt) => {
                const d = repere.aligne ? CM.rotateAroundOrigin(pt, -repere.refAngle) : pt;
                return { x: repere.ox + d.x * repere.s, y: repere.oy - d.y * repere.s };
            };
            return offCanvas;
        } finally {
            CM.canvas = previousCanvas;
            CM.state = previousState;
            Object.assign(state, savedFit);
        }
    }

    // --------------------------------------------------------------------------------------
    // Plan de coupe (étape 5) — rendu canvas uniquement (la coquille du modal vit dans formulaires.js)
    // --------------------------------------------------------------------------------------
    function drawTiltedPanel(ctx, x, y, lengthPx, thicknessPx, tiltRad) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-tiltRad);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, -thicknessPx, lengthPx, thicknessPx);
        ctx.strokeStyle = '#0f172a';
        ctx.strokeRect(0, -thicknessPx, lengthPx, thicknessPx);
        ctx.restore();
    }

    function drawInclinedDimension(ctx, p1, p2, offsetPx, label) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const sign = ny <= 0 ? 1 : -1;
        const off = { x: nx * offsetPx * sign, y: ny * offsetPx * sign };

        const a = { x: p1.x + off.x, y: p1.y + off.y };
        const b = { x: p2.x + off.x, y: p2.y + off.y };

        ctx.save();
        ctx.strokeStyle = '#0891b2';
        ctx.fillStyle = '#0e7490';
        ctx.lineWidth = 1;
        [[p1, a], [p2, b]].forEach(([q1, q2]) => {
            ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
        });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        let textAngle = Math.atan2(dy, dx);
        if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
        ctx.translate(midX, midY);
        ctx.rotate(textAngle);
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, -4);
        ctx.restore();
    }

    function getPanRampantPlanWidthM(pan) {
        if (!pan || !pan.points || !pan.points.length) return 8;
        const angle = CM.effectiveGridAngle(pan);
        const localPoints = pan.points.map((p) => CM.rotateAroundOrigin(p, -angle));
        const bb = CM.boundingBox(localPoints);
        return Math.max(0.1, bb.maxY - bb.minY);
    }

    function renderCoupe() {
        if (!CM.coupeCanvas) return;
        const ctx = CM.coupeCanvas.getContext('2d');
        const canvasW = CM.coupeCanvas.width, canvasH = CM.coupeCanvas.height;
        ctx.clearRect(0, 0, canvasW, canvasH);

        const pan = CM.state.pans[CM.state.coupePanIndex] || CM.state.pans[0];
        const poseMode = pan ? pan.poseMode : CM.state.poseMode;
        // Pente propre au pan affiché en coupe (Pan 2 d'une toiture asym -> penteDeg2).
        const panPenteDeg = (pan && typeof CM.effectivePenteDegForPan === 'function')
            ? CM.effectivePenteDegForPan(pan) : CM.state.penteDeg;
        const marginX = 40;
        const groundY = canvasH - 50;

        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(marginX, groundY);
        ctx.lineTo(canvasW - marginX, groundY);
        ctx.stroke();

        const roofLenPxBudget = canvasW - 2 * marginX;
        const planWidthM = getPanRampantPlanWidthM(pan);
        const tiltRadForScale = (panPenteDeg * Math.PI) / 180;
        const trueSlopeLenM = planWidthM / (Math.cos(tiltRadForScale) || 1);
        const pxPerMeter = roofLenPxBudget / trueSlopeLenM;
        const panelLenPx = CM.panelLengthM() * pxPerMeter;
        const roofLenPx = roofLenPxBudget;

        if (poseMode === 'plat') {
            ctx.beginPath();
            ctx.moveTo(marginX, groundY - 6);
            ctx.lineTo(canvasW - marginX, groundY - 6);
            ctx.stroke();

            const tiltRad = (15 * Math.PI) / 180;
            let x = marginX + 20;
            while (x + panelLenPx * Math.cos(tiltRad) < canvasW - marginX) {
                ctx.beginPath();
                ctx.moveTo(x, groundY - 6);
                ctx.lineTo(x, groundY - 26);
                ctx.lineTo(x + 15, groundY - 6);
                ctx.strokeStyle = '#6b7280';
                ctx.lineWidth = 1;
                ctx.stroke();
                drawTiltedPanel(ctx, x, groundY - 26, panelLenPx, 8, tiltRad);
                x += panelLenPx + 30;
            }
        } else if (poseMode === 'shed') {
            const tiltRad = (panPenteDeg * Math.PI) / 180;
            let x = marginX;
            const y = groundY - 60;
            while (x + panelLenPx * Math.cos(tiltRad) < canvasW - marginX) {
                drawTiltedPanel(ctx, x, y, panelLenPx, 8, tiltRad);
                const nextX = x + panelLenPx * Math.cos(tiltRad);
                const nextY = y - panelLenPx * Math.sin(tiltRad);
                ctx.beginPath();
                ctx.moveTo(nextX, nextY);
                ctx.lineTo(nextX, y);
                ctx.strokeStyle = '#9ca3af';
                ctx.lineWidth = 1;
                ctx.stroke();
                x = nextX;
            }
        } else if (poseMode === 'dome') {
            const tiltRad = (CM.state.domeTiltDeg * Math.PI) / 180;
            const gapPx = (CM.state.domePanelSpacingM || 0) * pxPerMeter;
            const domeSpacingPx = (CM.state.domeSpacingM || 0) * pxPerMeter;
            // Moitié des panneaux de la rangée de chaque côté du faîtage (CM.domePanelsPerRow).
            const parCote = CM.domePanelsPerRow() / 2;
            const pasX = panelLenPx * Math.cos(tiltRad), pasY = panelLenPx * Math.sin(tiltRad);
            const largeurDome = 2 * parCote * pasX + (2 * parCote - 1) * gapPx;
            let x = marginX;
            while (x + largeurDome < canvasW - marginX) {
                let px = x, py = groundY - 40;
                for (let k = 0; k < parCote; k++) {
                    drawTiltedPanel(ctx, px, py, panelLenPx, 8, tiltRad);
                    px += pasX + gapPx; py -= pasY;
                }
                for (let k = 0; k < parCote; k++) {
                    drawTiltedPanel(ctx, px, py, panelLenPx, 8, -tiltRad);
                    px += pasX + gapPx; py += pasY;
                }
                x += largeurDome + domeSpacingPx;
            }
        } else {
            const tiltRad = (panPenteDeg * Math.PI) / 180;
            const ridgeX = marginX + roofLenPx * Math.cos(tiltRad);
            const ridgeY = groundY - roofLenPx * Math.sin(tiltRad);
            ctx.beginPath();
            ctx.moveTo(marginX, groundY);
            ctx.lineTo(ridgeX, ridgeY);
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth = 2;
            ctx.stroke();

            if (CM.state.showCotations !== false) {
                drawInclinedDimension(
                    ctx, { x: marginX, y: groundY }, { x: ridgeX, y: ridgeY }, 16,
                    `${(roofLenPx / pxPerMeter).toFixed(2)} m`
                );
            }

            if (CM.state.showStructure) {
                ctx.beginPath();
                ctx.moveTo(marginX, groundY + 6);
                ctx.lineTo(ridgeX, ridgeY + 6);
                ctx.strokeStyle = '#a16207';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            let dPx = 0;
            while (dPx + panelLenPx <= roofLenPx) {
                const x = marginX + dPx * Math.cos(tiltRad);
                const y = groundY - dPx * Math.sin(tiltRad);
                drawTiltedPanel(ctx, x, y, panelLenPx, 8, tiltRad);
                dPx += panelLenPx + 4;
            }
        }

        const groundSpanPx = planWidthM * pxPerMeter;
        const dimY = groundY + 22;
        ctx.strokeStyle = '#6366f1';
        ctx.fillStyle = '#4338ca';
        ctx.lineWidth = 1;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.beginPath(); ctx.moveTo(marginX, groundY + 6); ctx.lineTo(marginX, dimY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(marginX + groundSpanPx, groundY + 6); ctx.lineTo(marginX + groundSpanPx, dimY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(marginX, dimY); ctx.lineTo(marginX + groundSpanPx, dimY); ctx.stroke();
        ctx.fillText(`${planWidthM.toFixed(2)} m (projetée)`, marginX + groundSpanPx / 2, dimY + 14);

        ctx.fillStyle = '#374151';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        const poseLabel = { incline: 'Incliné', plat: 'À plat', shed: 'Shed', dome: 'Dôme' }[poseMode] || poseMode;
        ctx.fillText(`Pente : ${panPenteDeg}° — Mode : ${poseLabel}`, marginX, 20);
    }

    // CORRECTIF (demande explicite : "supprimer le bouton Angles 90°") : toggleOrthoMode() retirée
    // — le choix rectangle/polygone se fait désormais en amont du tracé, cf.
    // polygon_maison.js::startDraw(mode)/_initPolygon(poly, mode).

    // --------------------------------------------------------------------------------------
    // Export vers le namespace partagé (fonctions appelées depuis formulaires.js / orchestrateur.js)
    // --------------------------------------------------------------------------------------
    /**
     * NOUVEAU (rapport PDF résidentiel, demande explicite : "une vue en plan du canva avec la carte
     * en arrière-plan") : garantit qu'une maison dispose de son fond de carte avant que le rapport
     * ne capture son diagramme.
     *
     * La capture de la carte n'est jamais enregistrée (ni en base ni en cache local : une image de
     * plusieurs centaines de kilo-octets, dont le calage est de toute façon exprimé en pixels écran,
     * donc périmé au rechargement). Après un rechargement de page, une maison n'a donc aucun fond,
     * et le rapport aurait sorti son diagramme sur fond blanc. On la prend ici à la demande.
     *
     * Bascule temporaire de CM.state, comme captureRoofDiagramImage() juste au-dessus, et modal créé
     * s'il ne l'est pas encore : captureMapView() écrit dans plusieurs éléments de son DOM. Le modal
     * reste masqué. Échec silencieux : le rapport se contente alors du diagramme sans fond.
     *
     * @param {string} sourceId maison concernée (ex. "PV1")
     * @returns {Promise<boolean>} true si un fond de carte est disponible à la sortie
     */
    // options.cadrageSerre : cf. cadrerCarteSurContourPourCapture.
    // options.forcer : recapture même si un fond existe (vue 3D de tous les champs : le fond doit les
    // couvrir tous, pas seulement le champ de référence).
    async function ensureMapBackground(sourceId, options) {
        try {
            if (typeof CM.getHouseStateById !== 'function') return false;
            const state = CM.getHouseStateById(sourceId);
            if (!state) return false;
            if (state.mapScreenshotImgObj && !(options && options.forcer)) return true; // déjà capturé dans cette session
            if (state.sourceType !== 'maps') return false;       // source image : pas de carte dessous
            if (!CM.modal && typeof CM.createModal === 'function') CM.createModal();
            if (!CM.modalBody) return false;

            const previousState = CM.state;
            try {
                CM.state = state;
                await captureMapView(options);
            } finally {
                CM.state = previousState;
            }
            // captureMapView() peut refuser de poser un fond calé (carte trop dézoomée, projection
            // inexploitable) : on le signale à l'appelant plutôt que de le laisser croire au succès.
            return !!state.mapScreenshotImgObj;
        } catch (e) {
            console.warn('[Calepinage maison] Fond de carte indisponible pour le rapport.', e);
            return false;
        }
    }

    Object.assign(CM, {
        computeFit, render, clearanceZoneRings, onCanvasWheel, onCanvasMouseDown, onDocumentMouseMove,
        onDocumentMouseUp, onCanvasContextMenu, setupPaletteDrag, finalizeContour,
        depassementSurfaceContour, refuserSurfaceContour,
        cancelContourDraw, getMapContainerProjection, captureMapView, renderCoupe,
        captureRoofDiagramImage, exportCanvasEtCartePdf, ensureMapBackground, cadrerSurContour,
        assurerFondCarteVueMulti, restaurerFondAvantVueMulti, getEffectiveInclinaisonDeg,
    });
})();
