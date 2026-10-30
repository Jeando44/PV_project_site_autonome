/**
 * Import & mise à l'échelle d'une image (photo/plan de toiture) — composant volontairement LIMITÉ à
 * l'import de fichier et à la calibration d'échelle (2 points cliqués + distance réelle saisie).
 *
 * CORRECTIF ARCHITECTURE : la version précédente incluait aussi un outil de tracé de forme libre sur
 * l'image, dont le résultat était converti en contour puis transmis au moteur principal — l'image
 * elle-même était ensuite jetée, jamais affichée dans le canevas de calepinage. Ce fichier ne dessine
 * plus AUCUNE forme : une fois l'image importée et calibrée, il transmet directement l'image + son
 * échelle à `calepinage_maison_indiv.js` (cf. useThisImage()), qui l'affiche comme fond PERSISTANT de
 * son propre canevas — en réutilisant le mécanisme déjà existant pour "Capturer" (fond de carte Google
 * Maps, cf. state.mapScreenshotImgObj/mapScreenshotRef/showBackgroundImage dans ce même fichier —
 * générique, indépendant de la provenance de l'image). Zéro duplication de l'outil de dessin des
 * panneaux : ce composant ne fait qu'importer + calibrer, tout le reste (contour, pans, obstacles,
 * modes de pose, structure, plan de coupe) reste 100% dans le moteur principal existant.
 *
 * Déclenchement : clic DROIT sur le bouton toolbar existant "Calepinage résidentiel"
 * (#draw-maison-polygon-button, cf. ButtonControl.js — non modifié) ; le clic gauche garde son
 * comportement actuel (tracé sur la carte via MaisonPolygonManagerInstance.startDraw()). Egalement
 * accessible via un bouton "Importer une image" à l'intérieur du modal principal de calepinage.
 *
 * Volontairement PAS persisté en localStorage : une photo de toiture peut peser plusieurs Mo, et
 * plusieurs images cumulées dépasseraient vite le quota (~5-10 Mo/origine) et casseraient tout le
 * localStorage du projet (y compris des données métier sans rapport). Les images restent en mémoire
 * JS pour la durée de la session — perdues au rechargement de page (annoncé dans l'UI du modal).
 */
(function () {
    'use strict';

    const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 Mo

    let modal = null, backdrop = null, canvas = null, ctx = null;
    let fileInput = null, hintEl = null;
    let calibrateBtn = null, panBtn = null, finishBtn = null;
    let zoomInBtn = null, zoomOutBtn = null, fitBtn = null;
    let scaleRow = null, scaleValueInput = null, scaleHelpEl = null;
    let magnifierEl = null, magnifierCtx = null;

    let img = null; // Image() chargée depuis le dataURL importé
    let imageScalePxPerM = null; // ratio pixels-image / mètre réel, défini par la calibration
    let mode = 'idle'; // 'idle' | 'calibrating' | 'pan'
    let calibrationPoints = []; // 0 ou 1 point en attente (coordonnées PIXELS IMAGE)
    let lastCalibrationSegment = null; // [p1,p2] dernier segment de calibration validé, pour affichage

    // Cadrage/zoom/pan du canevas d'édition (mêmes principes que computeFit/metersToCanvas du moteur
    // principal, mais ici en pixels image bruts — pas de notion de mètres avant la calibration).
    let view = { scale: 1, offsetX: 0, offsetY: 0, zoomFactor: 1, panOffsetX: 0, panOffsetY: 0 };
    let isPanning = false;
    let panStart = null;

    let sourceCounter = 0;

    function imageToCanvas(pt) {
        const s = view.scale * view.zoomFactor;
        return { x: view.offsetX + pt.x * s + view.panOffsetX, y: view.offsetY + pt.y * s + view.panOffsetY };
    }

    function canvasToImage(pt) {
        const s = view.scale * view.zoomFactor;
        return { x: (pt.x - view.offsetX - view.panOffsetX) / s, y: (pt.y - view.offsetY - view.panOffsetY) / s };
    }

    function getCanvasImagePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
        const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
        return canvasToImage({ x: px, y: py });
    }

    function computeFit() {
        if (!img || !canvas) return;
        const padding = 30;
        view.scale = Math.min((canvas.width - 2 * padding) / img.width, (canvas.height - 2 * padding) / img.height);
        view.offsetX = (canvas.width - img.width * view.scale) / 2;
        view.offsetY = (canvas.height - img.height * view.scale) / 2;
        view.zoomFactor = 1;
        view.panOffsetX = 0;
        view.panOffsetY = 0;
    }

    function resetTool() {
        mode = 'idle';
        calibrationPoints = [];
        updateHint();
        updateButtonStates();
        updateScaleDisplay();
        hideMagnifier();
        draw();
    }

    function updateHint() {
        if (!hintEl) return;
        if (!img) {
            hintEl.textContent = "Importez une image pour commencer.";
        } else if (mode === 'calibrating') {
            hintEl.textContent = calibrationPoints.length === 0
                ? "Calibration : cliquez un 1er point de référence sur l'image. Zoomez (molette ou boutons +/-) pour cliquer précisément — la précision de l'échelle en dépend directement."
                : "Calibration : cliquez un 2e point (distance connue depuis le 1er). Zoomez si besoin pour viser précisément.";
        } else if (mode === 'pan') {
            hintEl.textContent = "Déplacer la vue : cliquez-glissez sur l'image.";
        } else if (!imageScalePxPerM) {
            hintEl.textContent = "Calibrez l'échelle (2 points + distance réelle) avant d'utiliser cette image.";
        } else {
            hintEl.textContent = "Échelle calibrée. Cliquez \"Utiliser cette image\" pour l'ouvrir dans le calepinage.";
        }
    }

    // CORRECTIF : les boutons "Calibrer l'échelle"/"Déplacer la vue"/zoom/"Utiliser cette image"
    // étaient auparavant toujours cliquables mais ne faisaient rien tant qu'aucune image n'était
    // chargée (garde silencieuse `if (!img) return;`) — désormais visuellement désactivés jusqu'à ce
    // que l'action soit effectivement possible, pour guider l'utilisateur dans le bon ordre.
    function updateButtonStates() {
        const hasImage = !!img;
        const hasScale = !!imageScalePxPerM;
        if (calibrateBtn) calibrateBtn.disabled = !hasImage;
        if (panBtn) panBtn.disabled = !hasImage;
        if (zoomInBtn) zoomInBtn.disabled = !hasImage;
        if (zoomOutBtn) zoomOutBtn.disabled = !hasImage;
        if (fitBtn) fitBtn.disabled = !hasImage;
        if (finishBtn) finishBtn.disabled = !(hasImage && hasScale);
    }

    // Affiche la valeur d'échelle mesurée (pixels par mètre) avant que l'utilisateur ne valide — lui
    // permet de vérifier/ajuster la mesure plutôt que de découvrir le résultat après coup. Le champ
    // reste éditable : une modification manuelle met à jour imageScalePxPerM directement, sans repasser
    // par les 2 clics de calibration.
    function updateScaleDisplay() {
        if (!scaleRow) return;
        if (!imageScalePxPerM) {
            scaleRow.style.display = 'none';
            return;
        }
        scaleRow.style.display = 'flex';
        scaleValueInput.value = imageScalePxPerM.toFixed(2);
        scaleHelpEl.textContent = `(1 mètre = ${imageScalePxPerM.toFixed(1)} px sur l'image importée)`;
    }

    function draw() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!img) return;

        const topLeft = imageToCanvas({ x: 0, y: 0 });
        const s = view.scale * view.zoomFactor;
        ctx.drawImage(img, topLeft.x, topLeft.y, img.width * s, img.height * s);

        // Points de calibration + segment entre eux.
        if (calibrationPoints.length) {
            ctx.fillStyle = '#2563eb';
            calibrationPoints.forEach((p) => {
                const c = imageToCanvas(p);
                ctx.beginPath();
                ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // NOUVEAU (demande explicite : "ajouter un élément de ligne pour que l'utilisateur puisse
        // vérifier la longueur de référence sur l'image après la mise à l'échelle") : le segment de
        // calibration validé reste affiché en permanence (pas seulement pendant le clic), avec ses 2
        // extrémités marquées et un LIBELLÉ affichant sa longueur réelle — recalculée à partir de
        // imageScalePxPerM (pas d'une valeur figée au moment de la calibration), pour rester exacte
        // si l'utilisateur corrige ensuite la valeur d'échelle à la main (cf. #cisScaleValueInput) :
        // c'est justement CETTE cohérence que l'utilisateur doit pouvoir vérifier visuellement,
        // directement sur l'image, contre un élément dont il connaît la vraie longueur.
        if (imageScalePxPerM && lastCalibrationSegment) {
            const a = imageToCanvas(lastCalibrationSegment[0]);
            const b = imageToCanvas(lastCalibrationSegment[1]);
            const segPxImage = Math.hypot(
                lastCalibrationSegment[1].x - lastCalibrationSegment[0].x,
                lastCalibrationSegment[1].y - lastCalibrationSegment[0].y
            );
            const segM = segPxImage / imageScalePxPerM;

            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Extrémités marquées (repères visuels francs, comme pendant la calibration elle-même).
            ctx.fillStyle = '#2563eb';
            [a, b].forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });

            // Étiquette de longueur, décalée perpendiculairement au segment (jamais superposée à la
            // ligne elle-même, quelle que soit son orientation à l'écran).
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const perp = { x: -dy / len, y: dx / len };
            const OFFSET = 16;
            const label = `${segM.toFixed(2)} m`;
            ctx.font = 'bold 13px sans-serif';
            const textW = ctx.measureText(label).width;
            const lx = mid.x + perp.x * OFFSET, ly = mid.y + perp.y * OFFSET;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(lx - textW / 2 - 5, ly - 10, textW + 10, 20);
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1;
            ctx.strokeRect(lx - textW / 2 - 5, ly - 10, textW + 10, 20);
            ctx.fillStyle = '#1d4ed8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, lx, ly + 1);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }

    function onFileSelected(file) {
        if (!file) return;
        if (file.size > MAX_FILE_SIZE_BYTES) {
            alert(`Image trop volumineuse (${(file.size / 1_000_000).toFixed(1)} Mo, max 8 Mo).`);
            return;
        }
        // Pattern déjà utilisé dans app/static/concevoir_mon_projet/javascript/fichier.js : FileReader
        // + dataURL (pas d'URL.createObjectURL, absent du reste du repo).
        const reader = new FileReader();
        reader.onload = () => loadImage(reader.result);
        reader.readAsDataURL(file);
    }

    function loadImage(dataUrl) {
        const newImg = new Image();
        newImg.onload = () => {
            img = newImg;
            imageScalePxPerM = null;
            lastCalibrationSegment = null;
            resetTool();
            computeFit();
            draw();
        };
        newImg.onerror = () => alert("Impossible de charger cette image.");
        newImg.src = dataUrl;
    }

    // CORRECTIF (précision) : la calibration se fait souvent en vue "ajustée" (fortement dézoomée pour
    // une grande photo) — quelques pixels-écran d'imprecision de clic se traduisent alors en plusieurs %
    // d'erreur réelle sur l'échelle (ex. 10m mesurés à 8.39m). Un zoom minimum au démarrage de la
    // calibration réduit ce ratio pixels-écran/pixels-image, donc l'imprécision réelle induite par un
    // même écart de clic. L'utilisateur peut aussi zoomer/dézoomer davantage pendant la calibration
    // (boutons/molette déjà actifs dans ce mode, non désactivés par updateButtonStates).
    const MIN_CALIBRATION_ZOOM = 2.5;

    function startCalibrate() {
        if (!img) return;
        if (view.zoomFactor < MIN_CALIBRATION_ZOOM) {
            zoomByFactor(MIN_CALIBRATION_ZOOM / view.zoomFactor);
        }
        mode = 'calibrating';
        calibrationPoints = [];
        updateHint();
        draw();
    }

    // CORRECTIF (précision, suite) : le zoom minimum ne suffit pas toujours pour une très grande photo
    // (plusieurs pixels-image restent sous 1 pixel-écran même zoomé) — loupe flottante affichant un
    // agrandissement ×MAGNIFIER_ZOOM de la zone sous le curseur pendant la calibration, avec réticule au
    // centre, pour viser le pixel exact indépendamment du niveau de zoom du canevas principal. Purement
    // visuel : ne change rien au calcul du point cliqué (toujours getCanvasImagePos/onCanvasClick).
    const MAGNIFIER_SIZE = 160;
    const MAGNIFIER_ZOOM = 8;

    function updateMagnifier(evt, imgPos) {
        if (!magnifierEl || !magnifierCtx) return;
        if (mode !== 'calibrating' || !img) {
            magnifierEl.style.display = 'none';
            return;
        }
        const srcSize = MAGNIFIER_SIZE / MAGNIFIER_ZOOM;
        const srcX = imgPos.x - srcSize / 2, srcY = imgPos.y - srcSize / 2;
        magnifierCtx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
        magnifierCtx.imageSmoothingEnabled = false;
        magnifierCtx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
        magnifierCtx.strokeStyle = '#dc2626';
        magnifierCtx.lineWidth = 1;
        magnifierCtx.beginPath();
        magnifierCtx.moveTo(MAGNIFIER_SIZE / 2, 0);
        magnifierCtx.lineTo(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE);
        magnifierCtx.moveTo(0, MAGNIFIER_SIZE / 2);
        magnifierCtx.lineTo(MAGNIFIER_SIZE, MAGNIFIER_SIZE / 2);
        magnifierCtx.stroke();
        magnifierEl.style.display = 'block';
        magnifierEl.style.left = `${evt.clientX + 24}px`;
        magnifierEl.style.top = `${evt.clientY - MAGNIFIER_SIZE - 24}px`;
    }

    function hideMagnifier() {
        if (magnifierEl) magnifierEl.style.display = 'none';
    }

    function togglePan() {
        if (!img) return;
        mode = mode === 'pan' ? 'idle' : 'pan';
        updateHint();
    }

    // CORRECTIF (bug rapporté : "la mise à l'échelle n'est pas précise") : parseFloat() ne comprend
    // que le point décimal ('.') — un utilisateur francophone tapant "8,45" (virgule, convention
    // française) dans le prompt() ci-dessous se voyait sa saisie tronquée SILENCIEUSEMENT à "8"
    // (parseFloat s'arrête au premier caractère non numérique, sans lever d'erreur ni renvoyer NaN),
    // ce qui passait la validation `distM > 0` sans aucun message alors que la distance réelle
    // utilisée pour calculer imageScalePxPerM était fausse — source directe et silencieuse
    // d'imprécision (jusqu'à plusieurs % d'erreur selon la partie décimale perdue). Remplace la
    // virgule par un point avant l'analyse.
    function parseDistanceInput(raw) {
        if (raw == null) return NaN;
        return parseFloat(String(raw).trim().replace(',', '.'));
    }

    function onCanvasClick(pt) {
        if (mode === 'calibrating') {
            calibrationPoints.push(pt);
            if (calibrationPoints.length === 2) {
                const distPx = Math.hypot(
                    calibrationPoints[1].x - calibrationPoints[0].x,
                    calibrationPoints[1].y - calibrationPoints[0].y
                );
                const input = prompt('Distance réelle entre les 2 points (mètres) :', '5');
                const distM = parseDistanceInput(input);
                if (distM > 0 && distPx > 0) {
                    imageScalePxPerM = distPx / distM;
                    lastCalibrationSegment = [calibrationPoints[0], calibrationPoints[1]];
                } else if (input !== null) {
                    alert('Distance invalide — calibration non appliquée.');
                }
                mode = 'idle';
                calibrationPoints = [];
                updateHint();
                updateButtonStates();
                updateScaleDisplay();
                hideMagnifier();
            }
            draw();
        }
    }

    // Transmet l'image chargée + son échelle calibrée au moteur de calepinage principal, qui l'affiche
    // comme fond persistant de SON propre canevas (cf. state.mapScreenshotImgObj/mapScreenshotRef/
    // showBackgroundImage dans calepinage_maison_indiv.js — mécanisme déjà existant, réutilisé tel
    // quel, pas de duplication de l'outil de dessin des panneaux ici).
    function useThisImage() {
        if (!img) {
            alert("Importez d'abord une image.");
            return;
        }
        if (!imageScalePxPerM) {
            alert("Calibrez d'abord l'échelle (2 points + distance réelle).");
            return;
        }
        if (typeof window.openCalepinageMaisonModal !== 'function') {
            alert("Le module de calepinage résidentiel n'est pas chargé.");
            return;
        }
        sourceCounter += 1;
        const sourceId = `IMG${sourceCounter}`;
        closeModal();
        window.openCalepinageMaisonModal({ type: 'image', sourceId, label: sourceId, imageEl: img, imageScalePxPerM });
    }

    // --- Interaction canevas (clic = calibration selon le mode, molette = zoom, pan dédié) ---
    function onCanvasMouseDown(e) {
        if (mode === 'pan') {
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY, offX: view.panOffsetX, offY: view.panOffsetY };
            canvas.style.cursor = 'grabbing';
            return;
        }
        onCanvasClick(getCanvasImagePos(e));
    }

    function onCanvasMouseMove(e) {
        if (isPanning && panStart) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
            view.panOffsetX = panStart.offX + (e.clientX - panStart.x) * scaleX;
            view.panOffsetY = panStart.offY + (e.clientY - panStart.y) * scaleY;
            draw();
            return;
        }
        if (mode === 'calibrating') {
            updateMagnifier(e, getCanvasImagePos(e));
        }
    }

    function onCanvasMouseUp() {
        if (isPanning) {
            isPanning = false;
            panStart = null;
            canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
        }
    }

    function onCanvasWheel(e) {
        if (!img) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (canvas.width / rect.width);
        const py = (e.clientY - rect.top) * (canvas.height / rect.height);
        const imgBefore = canvasToImage({ x: px, y: py });

        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        view.zoomFactor = Math.min(8, Math.max(0.2, view.zoomFactor * factor));

        const imgAfterCanvas = imageToCanvas(imgBefore);
        view.panOffsetX += px - imgAfterCanvas.x;
        view.panOffsetY += py - imgAfterCanvas.y;
        draw();
    }

    // Zoom par bouton (pas de position de curseur disponible) : centré sur le centre du canevas —
    // même formule que le zoom à la molette (onCanvasWheel), juste un point de pivot fixe.
    function zoomByFactor(factor) {
        if (!img || !canvas) return;
        const px = canvas.width / 2, py = canvas.height / 2;
        const imgBefore = canvasToImage({ x: px, y: py });
        view.zoomFactor = Math.min(8, Math.max(0.2, view.zoomFactor * factor));
        const imgAfterCanvas = imageToCanvas(imgBefore);
        view.panOffsetX += px - imgAfterCanvas.x;
        view.panOffsetY += py - imgAfterCanvas.y;
        draw();
    }

    // CORRECTIF : boutons dédiés (en plus du zoom à la molette, moins découvrable) pour zoomer/
    // dézoomer et revenir à une vue montrant l'image entière — l'utilisateur ne pouvait pas voir toute
    // l'image dans le canevas sans savoir qu'il pouvait molette-zoomer, ni revenir en arrière facilement.
    function zoomIn() { zoomByFactor(1.25); }
    function zoomOut() { zoomByFactor(1 / 1.25); }
    function fitToView() { computeFit(); draw(); }

    function onKeyDown(e) {
        if (e.key !== 'Escape' || !modal || modal.style.display === 'none') return;
        if (mode === 'calibrating') {
            mode = 'idle';
            calibrationPoints = [];
            updateHint();
            hideMagnifier();
            draw();
        }
    }

    // ------------------------------------------------------------------------------------------
    // Modal (léger — même famille visuelle que les autres modals JS-only du calepinage résidentiel)
    // ------------------------------------------------------------------------------------------
    function createModal() {
        backdrop = document.createElement('div');
        // CORRECTIF (superposition) : doit s'afficher AU-DESSUS du modal principal de calepinage
        // (z-index:999998, cf. calepinage_maison_indiv.js::createModal) — nécessaire depuis l'ajout du
        // bouton "Importer une image" À L'INTÉRIEUR de ce modal principal (avant, ce modal d'import
        // n'était jamais ouvert pendant que le modal principal l'était, l'ordre importait peu).
        backdrop.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:999998;';

        modal = document.createElement('div');
        modal.style.cssText = 'display:none; flex-direction:column; position:fixed; top:6vh; left:50%; transform:translateX(-50%); width:900px; max-width:96vw; max-height:88vh; background:#fff; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:2px solid #dc2626; z-index:999999; overflow:hidden; font-family:sans-serif;';

        modal.innerHTML = `
            <div style="background:#dc2626; color:#fff; padding:12px 20px; display:flex; justify-content:space-between; align-items:center;">
                <h2 style="margin:0; font-size:16px; font-weight:600; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-image"></i> Calepinage sur image importée
                </h2>
                <button id="cisCloseBtn" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer; line-height:1; padding:0;">&times;</button>
            </div>
            <div style="padding:12px 20px; display:flex; flex-direction:column; gap:10px; overflow:hidden; flex-grow:1; min-height:0;">
                <p style="margin:0; font-size:0.75rem; color:#6b7280;">Image non sauvegardée : valable pour cette session de navigation uniquement.</p>
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    <input id="cisFileInput" type="file" accept="image/*" style="display:none;" />
                    <button id="cisImportBtn" class="cis-btn" style="background:#dc2626; color:#fff; border-color:#dc2626;">Importer une image</button>
                    <button id="cisCalibrateBtn" class="cis-btn" disabled>Calibrer l'échelle</button>
                    <button id="cisPanBtn" class="cis-btn" disabled>Déplacer la vue</button>
                    <button id="cisZoomInBtn" class="cis-btn" disabled title="Zoom avant"><i class="fas fa-search-plus"></i></button>
                    <button id="cisZoomOutBtn" class="cis-btn" disabled title="Zoom arrière"><i class="fas fa-search-minus"></i></button>
                    <button id="cisFitBtn" class="cis-btn" disabled title="Ajuster l'image à la fenêtre">Ajuster à l'image</button>
                    <button id="cisFinishBtn" class="cis-btn" style="background:#1E8449; color:#fff; border-color:#1E8449;" disabled>Utiliser cette image</button>
                </div>
                <div id="cisScaleRow" style="display:none; align-items:center; gap:8px; font-size:0.8rem; color:#374151;">
                    <label for="cisScaleValueInput" style="font-weight:600; white-space:nowrap;">Échelle mesurée (pixels par mètre) :</label>
                    <input id="cisScaleValueInput" type="number" min="0.01" step="0.01" style="width:110px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px;" />
                    <span id="cisScaleHelp" style="color:#6b7280; font-size:0.75rem;"></span>
                </div>
                <div id="cisHint" style="font-size:0.8rem; color:#374151; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:6px 10px;"></div>
                <canvas id="cisCanvas" width="1000" height="620" style="width:100%; height:auto; background:#f3f4f6; border:1px solid #d1d5db; border-radius:6px; cursor:crosshair; flex-shrink:0;"></canvas>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `.cis-btn { padding:6px 10px; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer; background:#f5f5f5; color:#333; border:1px solid #ddd; }
            .cis-btn:hover:not(:disabled) { filter:brightness(0.95); }
            .cis-btn:disabled { opacity:0.5; cursor:not-allowed; }`;
        document.head.appendChild(style);

        magnifierEl = document.createElement('canvas');
        magnifierEl.id = 'cisMagnifier';
        magnifierEl.width = MAGNIFIER_SIZE;
        magnifierEl.height = MAGNIFIER_SIZE;
        magnifierEl.style.cssText = `display:none; position:fixed; width:${MAGNIFIER_SIZE}px; height:${MAGNIFIER_SIZE}px; border:2px solid #dc2626; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.35); background:#fff; z-index:1000000; pointer-events:none;`;
        magnifierCtx = magnifierEl.getContext('2d');

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        document.body.appendChild(magnifierEl);

        canvas = modal.querySelector('#cisCanvas');
        ctx = canvas.getContext('2d');
        hintEl = modal.querySelector('#cisHint');
        fileInput = modal.querySelector('#cisFileInput');
        calibrateBtn = modal.querySelector('#cisCalibrateBtn');
        panBtn = modal.querySelector('#cisPanBtn');
        finishBtn = modal.querySelector('#cisFinishBtn');
        zoomInBtn = modal.querySelector('#cisZoomInBtn');
        zoomOutBtn = modal.querySelector('#cisZoomOutBtn');
        fitBtn = modal.querySelector('#cisFitBtn');
        scaleRow = modal.querySelector('#cisScaleRow');
        scaleValueInput = modal.querySelector('#cisScaleValueInput');
        scaleHelpEl = modal.querySelector('#cisScaleHelp');

        modal.querySelector('#cisCloseBtn').addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
        modal.querySelector('#cisImportBtn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => onFileSelected(e.target.files[0]));
        calibrateBtn.addEventListener('click', startCalibrate);
        panBtn.addEventListener('click', togglePan);
        finishBtn.addEventListener('click', useThisImage);
        zoomInBtn.addEventListener('click', zoomIn);
        zoomOutBtn.addEventListener('click', zoomOut);
        fitBtn.addEventListener('click', fitToView);
        // Édition manuelle de la valeur d'échelle mesurée : permet de vérifier/corriger sans redevoir
        // recliquer les 2 points de calibration.
        scaleValueInput.addEventListener('change', (e) => {
            const v = parseFloat(e.target.value);
            if (v > 0) {
                imageScalePxPerM = v;
                updateButtonStates();
                updateScaleDisplay();
            } else {
                updateScaleDisplay(); // revert à la dernière valeur valide si saisie invalide
            }
            // NOUVEAU : la ligne/étiquette de référence recalcule sa longueur à partir
            // d'imageScalePxPerM à chaque dessin — la redessiner ici rend immédiatement visible
            // l'effet d'une correction manuelle de l'échelle sur la longueur vérifiable à l'écran.
            draw();
        });

        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        window.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
        document.addEventListener('keydown', onKeyDown);
    }

    function openImageSourceModal() {
        if (!modal) createModal();
        resetTool();
        updateHint();
        modal.style.display = 'flex';
        backdrop.style.display = 'block';
    }

    function closeModal() {
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        hideMagnifier();
    }

    // Clic droit sur le bouton toolbar existant "Calepinage résidentiel" : ouvre ce modal. Le clic
    // gauche garde son comportement actuel (MaisonPolygonManagerInstance.startDraw()), ButtonControl.js
    // n'est pas modifié.
    // CORRECTIF : le bouton est créé dynamiquement par ButtonControl.createControls(), lui-même appelé
    // depuis DrawingControl à l'intérieur de GoogleMaps.js::initMap() — une fonction ASYNCHRONE qui
    // n'aboutit qu'après le chargement de l'API Google Maps (réseau), donc bien APRÈS que
    // 'DOMContentLoaded' se soit déjà déclenché. Un attachement direct sur le bouton au DOMContentLoaded
    // ne trouvait donc jamais l'élément (il n'existait pas encore) et n'attachait rien — le clic droit
    // ne faisait alors rigoureusement rien. Délégation sur `document` : fonctionne quel que soit le
    // moment où le bouton apparaît dans le DOM, avant ou après cet appel.
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('#draw-maison-polygon-button')) {
            e.preventDefault();
            openImageSourceModal();
        }
    });

    window.openCalepinageImageSourceModal = openImageSourceModal;
})();
