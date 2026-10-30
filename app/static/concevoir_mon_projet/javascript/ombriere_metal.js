document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL VARIABLES & APP STATE ---
    let map;
    let appState = {
        postModel: 'single', // MOD 1.1: Sera réglé sur 'single' au lancement
        traversePosition: 'top',
        overhangType: 'sym',
        dimensionColor: '#0000FF',
        invertSlope: false,
        parsedDistances: [],
        reinforcementType: 'bracons',
        offsetPostSide: 'center',
        showBraceLeft: true,
        showBraceRight: true,
        doublePostBracing: 'v1',
        showDoubleBracing: true,
        showFoundation: false, // Désélectionné par défaut
    };
    window.appState = appState; // Exposé pour ombriere_liasonnee.js
    let isUpdateScheduled = false;
    let lastValidPostDistances = document.getElementById('postDistances').value;
    // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : tant que l'utilisateur n'a pas
    // modifié lui-même le champ "Entraxes poteaux", celui-ci reste recalculé automatiquement.
    let userEditedPostDistances = false;
    let isAutoFillingPostDistances = false;


    // --- MODAL MANAGEMENT ---
    const modal = document.getElementById('app-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalHeader = document.getElementById('modal-header');

    // Logique pour le nouveau modal de lancement
    const welcomeOverlay = document.getElementById('welcome-modal-overlay');
    const launchBtn = document.getElementById('launch-btn');

    if (welcomeOverlay && launchBtn) {
        launchBtn.addEventListener('click', () => {
            welcomeOverlay.style.display = 'none'; // Cache le modal de bienvenue

            // Ouvre le modal principal
            modal.classList.remove('hidden');
            modalOverlay.classList.remove('hidden');

            // MOD 1.1: Vue par défaut "poteaux centrés"
            // Le clic active le bouton ET lance le scheduleUpdate via son listener
            document.getElementById('modelSinglePost').click();

            // --- AJOUTEZ LE CODE ICI ---
            const tabCoupeDefault = document.getElementById('tabCoupe');
            if (tabCoupeDefault) {
                switchTab('.tab-group-1', '.tab-content-1', tabCoupeDefault);
            }
            // ---------------------------

        // CORRECTIF (demande explicite) : "Plan de coupe" est désormais l'onglet actif par défaut,
        // avant "Plan de calepinage".
        switchTab('.tab-group-1', '.tab-content-1', document.getElementById('tabCoupe'));

            // Lancement initial
            scheduleUpdate().then(() => {

                // MOD 1.0: Lancer l'ajustement de hauteur
                adjustCanvasHeights();
            });
        });
    } else {
        // Pas de modal de bienvenue — initialiser directement
        const modelBtn = document.getElementById('modelSinglePost');
        if (modelBtn) modelBtn.click();
        // CORRECTIF (demande explicite) : "Plan de coupe" par défaut, avant "Plan de calepinage".
        const tabCoupeDefault2 = document.getElementById('tabCoupe');
        if (tabCoupeDefault2) switchTab('.tab-group-1', '.tab-content-1', tabCoupeDefault2);
        scheduleUpdate().then(() => adjustCanvasHeights());
    }

    // MOD 1.6 & 1.7: Logique de fermeture du modal principal corrigée
    document.getElementById('close-modal-btn').addEventListener('click', (e) => {
        modal.classList.add('hidden');
        modalOverlay.classList.add('hidden');

        // MOD 1.7: Ré-afficher l'écran d'accueil
        if (welcomeOverlay) {
            welcomeOverlay.style.display = 'flex';
        }
    });

    // MOD 1.5: Logique pour masquer/afficher le formulaire
    document.getElementById('toggle-form-btn').addEventListener('click', () => {
        const appModal = document.getElementById('app-modal');
        appModal.classList.toggle('form-hidden');
        // Nous devons déclencher une redimension/redessin après la transition
        setTimeout(() => {
            scheduleUpdate();
            if (map) map.invalidateSize();
            adjustCanvasHeights(); // Ajuster la hauteur après la transition
        }, 350); // 300ms transition + 50ms buffer
    });

    let isDragging = false,
        offsetX, offsetY;
    modalHeader.addEventListener('mousedown', (e) => {
        // Ne pas glisser si on clique sur un bouton
        if (e.target.closest('button')) return;

        isDragging = true;
        offsetX = e.clientX - modal.offsetLeft;
        offsetY = e.clientY - modal.offsetTop;
        modal.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            modal.style.left = `${e.clientX - offsetX}px`;
            modal.style.top = `${e.clientY - offsetY}px`;
        }
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        modal.style.cursor = 'default';
    });

    document.getElementById('reset-modal-btn').addEventListener('click', () => {
        modal.style.width = '';
        modal.style.height = '';
        modal.style.top = '';
        modal.style.left = '';
        modal.offsetHeight; // Force reflow
        adjustCanvasHeights(); // Recalculer les hauteurs
        scheduleUpdate();
    });

    // --- VIEW MANAGER CLASS (ZOOM/PAN) ---
    class ViewManager {
        constructor(canvas, drawFunction) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.drawFunction = drawFunction;
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.isPanning = false;
            this.lastX = 0;
            this.lastY = 0;
            this.panMode = false;
            this.addEventListeners();
        }
        addEventListeners() {
            this.canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const scaleAmount = 1.1;
                const mouseX = e.clientX - this.canvas.getBoundingClientRect().left;
                const mouseY = e.clientY - this.canvas.getBoundingClientRect().top;
                const zoomFactor = (e.deltaY < 0 ? scaleAmount : 1 / scaleAmount);
                this.panX = mouseX - (mouseX - this.panX) * zoomFactor;
                this.panY = mouseY - (mouseY - this.panY) * zoomFactor;
                this.zoom *= zoomFactor;
                this.draw();
            });
            this.canvas.addEventListener('mousedown', (e) => {
                if (this.panMode) {
                    this.isPanning = true;
                    this.lastX = e.clientX;
                    this.lastY = e.clientY;
                    this.canvas.classList.add('grabbing');
                }
            });
            this.canvas.addEventListener('mousemove', (e) => {
                if (this.isPanning && this.panMode) {
                    const dx = e.clientX - this.lastX;
                    const dy = e.clientY - this.lastY;
                    this.panX += dx;
                    this.panY += dy;
                    this.lastX = e.clientX;
                    this.lastY = e.clientY;
                    this.draw();
                }
            });
            this.canvas.addEventListener('mouseup', () => {
                this.isPanning = false;
                this.canvas.classList.remove('grabbing');
            });
            this.canvas.addEventListener('mouseleave', () => this.isPanning = false);
        }
        zoomIn() { this.zoom *= 1.25; this.draw(); }
        zoomOut() { this.zoom /= 1.25; this.draw(); }
        reset() { this.zoom = 1; this.panX = 0; this.panY = 0; this.draw(); }
        togglePanMode(button) {
            this.panMode = !this.panMode;
            button.classList.toggle('active', this.panMode);
            this.canvas.style.cursor = this.panMode ? 'grab' : 'default';
        }
        draw(calculatedValues = null) {
            // Mémorise les dernières valeurs reçues depuis l'API
            if (calculatedValues) this._lastValues = calculatedValues;
            const valuesToUse = this._lastValues;
            if (!valuesToUse) return; // pas encore de données disponibles
            this.drawFunction(this.canvas, this.ctx, this, valuesToUse);
        }
    }

    // --- UTILITY FUNCTIONS ---
    function setupCanvas(canvasEl) {
        const dpr = window.devicePixelRatio || 1;
        let rect = canvasEl.getBoundingClientRect();
        
        let w = rect.width;
        let h = rect.height;

        if (w === 0 || h === 0) {
            // Si on génère un PDF, on force une taille pour éviter de capturer un canvas vide
            if (window.isGeneratingPDF) {
                w = 1200;
                h = 800;
            } else {
                return { width: 0, height: 0, dpr };
            }
        }
        canvasEl.width = w * dpr;
        canvasEl.height = h * dpr;
        const ctx = canvasEl.getContext('2d');
        ctx.scale(dpr, dpr);
        return { width: w, height: h, dpr };
    }

    function drawDimensionLine(context, x1, y1, x2, y2, text, offset = 0, isVertical = false) {
        context.save();
        context.strokeStyle = appState.dimensionColor;
        context.fillStyle = appState.dimensionColor;
        context.lineWidth = 1;
        context.font = '12px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const perpAngle = angle + Math.PI / 2;
        const offsetX = offset * Math.cos(perpAngle);
        const offsetY = offset * Math.sin(perpAngle);
        const p1 = { x: x1 + offsetX, y: y1 + offsetY };
        const p2 = { x: x2 + offsetX, y: y2 + offsetY };
        context.beginPath(); context.moveTo(p1.x, p1.y); context.lineTo(p2.x, p2.y); context.stroke();
        const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2;
        const tickSize = 5;
        context.beginPath(); context.moveTo(p1.x - tickSize * Math.cos(perpAngle), p1.y - tickSize * Math.sin(perpAngle)); context.lineTo(p1.x + tickSize * Math.cos(perpAngle), p1.y + tickSize * Math.sin(perpAngle)); context.stroke();
        context.beginPath(); context.moveTo(p2.x - tickSize * Math.cos(perpAngle), p2.y - tickSize * Math.sin(perpAngle)); context.lineTo(p2.x + tickSize * Math.cos(perpAngle), p2.y + tickSize * Math.sin(perpAngle)); context.stroke();
        context.save();
        context.translate(midX, midY);
        let textAngle = isVertical ? -Math.PI / 2 : (angle > Math.PI / 2 || angle < -Math.PI / 2) ? angle - Math.PI : angle;
        context.rotate(textAngle);
        const textMetrics = context.measureText(text); const textWidth = textMetrics.width; const textHeight = 14;
        context.fillStyle = '#FFFFFF'; context.fillRect(-(textWidth / 2) - 2, -(textHeight / 2), textWidth + 4, textHeight);
        context.fillStyle = appState.dimensionColor; context.fillText(text, 0, 0);
        context.restore(); context.restore();
    }
    window.drawDimensionLine = drawDimensionLine; // Exposé pour ombriere_liasonnee.js (cotation d'entraxe)

    /**
     * Cotation verticale jusqu'au SOL (cf. geometrie_structure/terrain_plans.js) :
     * - groundY : Y du sol, nombre ou FONCTION x -> Y (terrain réel) ;
     * - options.mesure : 'ligne' (défaut) = jusqu'au sol sous la ligne de cote ; 'cible' = depuis le
     *   sol au droit du point coté (pied de poteau), reporté par une ligne de rappel ;
     * - text null + options.echelle (px/m) : valeur MESURÉE sur le dessin.
     */
    function drawVerticalDimensionWithLeader(context, x_target, y_target, x_dim_line, text, groundY = 0, options = {}) {
        const solEn = typeof groundY === 'function' ? groundY : () => groundY;
        const xPied = options.mesure === 'cible' ? x_target : x_dim_line;
        const yPied = solEn(xPied);
        const libelle = (text == null && options.echelle > 0) ? `${((yPied - y_target) / options.echelle).toFixed(2)}m` : text;
        context.save();
        context.strokeStyle = appState.dimensionColor; context.fillStyle = appState.dimensionColor; context.lineWidth = 1; context.font = '12px Arial';
        context.beginPath(); context.setLineDash([2, 3]); context.moveTo(x_target, y_target); context.lineTo(x_dim_line, y_target); context.stroke();
        if (xPied !== x_dim_line) {
            context.beginPath(); context.moveTo(x_target, yPied); context.lineTo(x_dim_line, yPied); context.stroke();
        }
        context.setLineDash([]); drawDimensionLine(context, x_dim_line, yPied, x_dim_line, y_target, libelle, 0, true);
        context.restore();
    }

    const intersect = (p1, p2, p3, p4) => {
        const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
        if (den === 0) return null;
        const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
        // const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;

        return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
    };

    // --- CORE DRAWING FUNCTIONS ---
    function drawCoupe(canvas, ctx, viewManager, values) {
        const { width, height } = setupCanvas(canvas);
        if (width === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY);
        ctx.scale(viewManager.zoom, viewManager.zoom);

        // Récupération de toutes les valeurs
        const { postHeight = 0, lowPointHeight = 0, passageHeight = 0, roofSlope = 0, purlinCount = 6, postWidth = 0.4, beamHeight = 0.2, panelWidth = 0, panelThickness = 0.05, purlinHeight = 0.2, integrationSystemHeight = 0.1, overhangSymValue = 0, overhangAsymHigh = 0, overhangAsymLow = 0, heightUnderBrace = 2.0, braceFixPercentage = 70, postSpacing = 0, postEccentricity = 0, postSpacingInclined = 0, postInclinationInclined = 65, braceWidth = 0.15, beamLength = 0 } = values;

        let localInvertSlope = appState.invertSlope;

        const roofSlopeRadians = roofSlope * Math.PI / 180;
        const angle = roofSlopeRadians * (localInvertSlope ? 1 : -1);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // La logique du porte-à-faux (overhang) est gérée dans updateAppLogic
        // beamLength est maintenant la longueur calculée de la traverse (MOD 6.5)

        // Logique de beamOffset (MOD 7) est correcte, elle n'impacte pas le poteau
        const oL = values.overhangL || 0;
        const oH = values.overhangH || 0;
        const beamOffset = (appState.postModel === 'y_shape' || appState.overhangType === 'sym') ? 0 : (oL - oH) / 2;

        // CORRECTIF (cohérence Toiture Y / Bipente, demande explicite) : panelWidth représente désormais
        // directement la largeur d'UN bras pour y_shape/doubleYShape (saisie depuis PV1.1 d'un calepinage
        // Bipente symétrique, déjà à la largeur d'un bras — cf. getRealRoofGeometryType() dans le HTML) —
        // ne plus diviser par 2 ici (l'ancienne hypothèse "panelWidth = largeur totale monopente" ne
        // s'applique plus, puisque ces modèles ne sont désormais accessibles qu'en Bipente symétrique).
        const effectiveWidthForHeight = panelWidth;
        const highPointHeightValue = lowPointHeight + Math.abs(effectiveWidthForHeight * Math.sin(roofSlopeRadians));
        const totalDrawingHeight = highPointHeightValue + 2;

        // Le modèle "Double toiture Y" s'étend sur plusieurs poteaux espacés de postSpacing : la largeur
        // réelle du dessin dépasse largement panelWidth. Sans ce correctif, l'échelle restait calée sur un
        // seul panneau et les changements d'entraxe devenaient visuellement imperceptibles (vue trop zoomée).
        let widthForScale = panelWidth;
        if (appState.postModel === 'doubleYShape') {
            const doubleYShapePanelCount = Math.max(2, values.doubleYShapePanelsCount || 2);
            widthForScale = (doubleYShapePanelCount - 1) * postSpacing + panelWidth;
        }

        const scale = Math.min(width / (widthForScale + 4), height / totalDrawingHeight) * 1;
        if (window.__dxfCapture) window.__dxfCapture.scale = scale; // enregistreur vectoriel (dossier de plans)

        // Terrain automatique (geometrie_structure/terrain_plans.js) : profil réel sous la coupe.
        // L'ombrière est UNE structure : elle reste à niveau (Y = 0) et ce sont les poteaux qui
        // s'allongent. Le sol est donc ramené à son point le PLUS HAUT sous l'emprise, pour
        // qu'aucun poteau ne soit plus court que sa hauteur réglée.
        const TP = window.TerrainPlans;
        const solCoupeAuto = (TP && typeof TP.solCoupe === 'function') ? TP.solCoupe({ invertSlope: localInvertSlope }) : null;
        const demiEmpriseCoupeM = Math.max(1, (values.panelWidth || 0) / 2 + 1);
        const solRefCoupeM = (TP && solCoupeAuto) ? TP.niveauSolStructure(solCoupeAuto, demiEmpriseCoupeM) : 0;
        const solCoupeY = solCoupeAuto
            ? (xScaled) => -(solCoupeAuto.zRel(xScaled / scale) - solRefCoupeM) * scale
            : () => 0;

        const coteSol = { echelle: scale };
        const coteAuPied = { echelle: scale, mesure: 'cible' };

        const groundYView = height * 0.8;
        ctx.translate(width / 2, groundYView);

        const postWidthScaled = postWidth * scale;
        const beamHeightScaled = beamHeight * scale;
        const beamLengthScaled = beamLength * scale; // beamLength est la longueur de la traverse
        const beamOffsetScaled = beamOffset * scale;
        let postHeightScaled = postHeight * scale;
        const panelWidthScaled = panelWidth * scale;

        let beamCenterY;

        if (appState.postModel === 'y_shape') {
            const cosA_Y = Math.cos(Math.abs(roofSlopeRadians)); // Angle for Y
            // MOD 6.1: postHeightScaled est maintenant calculé pour s'aligner sur le HAUT de la traverse
            // beamCenterY est la coord Y du centre de la traverse
            beamCenterY = -postHeightScaled + (beamHeightScaled / 2) * cosA_Y;
        } else if (appState.traversePosition === 'top') {
            beamCenterY = -postHeightScaled - beamHeightScaled / 2;
        } else {
            // Traverse 'side'
            beamCenterY = -postHeightScaled;
        }

        const purlinHeightScaled = purlinHeight * scale;
        const integrationSystemHeightScaled = integrationSystemHeight * scale;
        const panelThicknessScaled = panelThickness * scale;

        // CORRECTION Y-SHAPE & Général: Panneaux/intégration commencent au-dessus des pannes.
        const structureTopY = -beamHeightScaled / 2 - purlinHeightScaled;
        const integrationSystemY = structureTopY - integrationSystemHeightScaled;
        const panelY = integrationSystemY - panelThicknessScaled;

        const lineLength = (width + height) * 4 / viewManager.zoom;
        const getBeamLine = (y_offset, localAngle = angle, localBeamOffset = beamOffsetScaled, localCenterY = beamCenterY) => {
            const localCos = Math.cos(localAngle);
            const localSin = Math.sin(localAngle);
            const p1_rot = { x: -lineLength, y: y_offset };
            const p2_rot = { x: lineLength, y: y_offset };
            return {
                p1: { x: localBeamOffset + p1_rot.x * localCos - p1_rot.y * localSin, y: localCenterY + p1_rot.x * localSin + p1_rot.y * localCos },
                p2: { x: localBeamOffset + p2_rot.x * localCos - p2_rot.y * localSin, y: localCenterY + p2_rot.x * localSin + p2_rot.y * localCos }
            };
        };

        // Lignes de la traverse (dans le système de coordonnées du dessin)
        const beamTopLine = getBeamLine(-beamHeightScaled / 2);
        const beamBottomLine = getBeamLine(beamHeightScaled / 2);

        // Ligne de référence pour l'intersection poteau/traverse
        const beamIntersectLine = (appState.traversePosition === 'side' && appState.postModel !== 'y_shape') ? beamTopLine : beamBottomLine;

        const drawTheReinforcements = () => {
            // Seuls les modèles 'single', 'offset', 'y_shape' et 'double' gèrent les renforts ici.
            // 'inclinedPost' n'a plus de jarrets, juste l'option barre au sol (dessinée plus bas).
            if ((appState.postModel === 'single' || appState.postModel === 'offset' || appState.postModel === 'y_shape') && appState.reinforcementType !== 'none') {
                let basePostX = 0;
                if (appState.postModel === 'offset' && appState.offsetPostSide !== 'center') {
                    const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                    if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                    if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                }
                const postCenterX = basePostX + (values.postEccentricity * scale);

                // Le jarret est fixé à 0,35 m sous la traverse : il ne dépend pas de la hauteur sous renfort
                // (seul le bracon s'y accroche). Le comparer à heightUnderBrace (3,20 m par défaut) le masquait
                // dès que le poteau faisait moins de 3,20 m, cas courant depuis que l'égout est saisi (3 m).
                const shouldDrawSinglePostBrace = appState.reinforcementType === 'jarrets'
                    ? postHeight > 0.35
                    : postHeight > heightUnderBrace;

                if (shouldDrawSinglePostBrace) {
                    if (appState.showBraceLeft || appState.postModel === 'y_shape') drawReinforcement('left', postCenterX, values);
                    if (appState.showBraceRight || appState.postModel === 'y_shape') drawReinforcement('right', postCenterX, values);
                }
            } else if (appState.postModel === 'double' && appState.showDoubleBracing) {
                drawDoublePostReinforcementSet(postWidthScaled, values);
            }
        }

        // Massif de fondation (0.50m hauteur x 0.60m largeur), posé sur le sol ; le poteau vient par-dessus.
        // Dessiné en surcouche sur les derniers 0.50m du poteau : aucune modification des calculs de hauteur/intersection.
        const drawFoundation = (postCenterX) => {
            ctx.save();
            const foundationHeightScaled = 0.50 * scale;
            const foundationWidthScaled = 0.60 * scale;
            ctx.fillStyle = '#9ca3af';
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 1.5;
            // Massif posé sur le sol LOCAL du poteau (terrain réel).
            const solMassifY = solCoupeY(postCenterX);
            ctx.fillRect(postCenterX - foundationWidthScaled / 2, solMassifY - foundationHeightScaled, foundationWidthScaled, foundationHeightScaled);
            ctx.strokeRect(postCenterX - foundationWidthScaled / 2, solMassifY - foundationHeightScaled, foundationWidthScaled, foundationHeightScaled);
            ctx.restore();
        };

        const drawThePosts = () => {
            ctx.fillStyle = '#f3f4f6';
            ctx.strokeStyle = '#374151';

            let isPostInFront = (appState.traversePosition === 'side' && appState.postModel !== 'y_shape') ||
                (appState.traversePosition === 'top' && appState.postModel === 'inclinedPost');
            ctx.lineWidth = isPostInFront ? 2.5 : 1.5;

            if (appState.postModel === 'single' || appState.postModel === 'offset' || appState.postModel === 'y_shape') {
                let basePostX = 0;
                if (appState.postModel === 'offset' && appState.offsetPostSide !== 'center') {
                    const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                    if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                    if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                }
                const postCenterX = basePostX + (values.postEccentricity * scale);

                let postTopY;
                if (appState.postModel === 'y_shape') {
                    postTopY = -postHeightScaled;
                } else {
                    const postLine = { p1: { x: postCenterX, y: lineLength }, p2: { x: postCenterX, y: -lineLength } };
                    const intersectionPoint = intersect(postLine.p1, postLine.p2, beamIntersectLine.p1, beamIntersectLine.p2);
                    postTopY = intersectionPoint ? intersectionPoint.y : beamCenterY;
                }

                ctx.fillRect(postCenterX - postWidthScaled / 2, postTopY, postWidthScaled, solCoupeY(postCenterX) - postTopY);
                ctx.strokeRect(postCenterX - postWidthScaled / 2, postTopY, postWidthScaled, solCoupeY(postCenterX) - postTopY);
                if (appState.showFoundation) drawFoundation(postCenterX);

            } else {
                const isInclined = appState.postModel === 'inclinedPost';
                const spacing = (isInclined ? postSpacingInclined : postSpacing) * scale / 2;

                [-1, 1].forEach(sign => {
                    const postX = sign * spacing;
                    if (isInclined) {
                        const inclination = postInclinationInclined;
                        const angleFromVertical = (90 - inclination) * Math.PI / 180;
                        const vx = sign * Math.sin(angleFromVertical);
                        const vy = -Math.cos(angleFromVertical); // Négatif car monte

                        const postAxisLine = {
                            p1: { x: postX, y: 0 },
                            p2: { x: postX + vx * lineLength, y: vy * lineLength }
                        };

                        // Jonction Poteau Incliné / Traverse
                        const intersectTop = intersect(postAxisLine.p1, postAxisLine.p2, beamTopLine.p1, beamTopLine.p2);
                        const intersectBottom = intersect(postAxisLine.p1, postAxisLine.p2, beamBottomLine.p1, beamBottomLine.p2);

                        const topCenter = (appState.traversePosition === 'top') ? intersectBottom : intersectTop;
                        if (!topCenter || !intersectBottom || !intersectTop) return;

                        const perpAngle = Math.atan2(vy, vx) + Math.PI / 2;
                        const dx_perp = Math.cos(perpAngle) * (postWidthScaled / 2);
                        const dy_perp = Math.sin(perpAngle) * (postWidthScaled / 2);

                        const leftSideLine = {
                            p1: { x: topCenter.x - dx_perp, y: topCenter.y - dy_perp },
                            p2: { x: (topCenter.x - dx_perp) + vx * lineLength, y: (topCenter.y - dy_perp) + vy * lineLength }
                        };
                        const rightSideLine = {
                            p1: { x: topCenter.x + dx_perp, y: topCenter.y + dy_perp },
                            p2: { x: (topCenter.x + dx_perp) + vx * lineLength, y: (topCenter.y + dy_perp) + vy * lineLength }
                        };

                        // Poteau incliné : sol pris au droit du poteau (ligne horizontale à ce niveau).
                        const groundLine = { p1: { x: -lineLength, y: solCoupeY(postX) }, p2: { x: lineLength, y: solCoupeY(postX) } };
                        const bottomLeft = intersect(leftSideLine.p1, leftSideLine.p2, groundLine.p1, groundLine.p2);
                        const bottomRight = intersect(rightSideLine.p1, rightSideLine.p2, groundLine.p1, groundLine.p2);

                        const traverseAngle = angle;
                        const cosT = Math.cos(traverseAngle);
                        const sinT = Math.sin(traverseAngle);
                        const topCutLine = {
                            p1: { x: topCenter.x - cosT * lineLength, y: topCenter.y - sinT * lineLength },
                            p2: { x: topCenter.x + cosT * lineLength, y: topCenter.y + sinT * lineLength }
                        };

                        const topLeft = intersect(topCutLine.p1, topCutLine.p2, leftSideLine.p1, leftSideLine.p2);
                        const topRight = intersect(topCutLine.p1, topCutLine.p2, rightSideLine.p1, rightSideLine.p2);

                        if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
                            console.error("Échec du calcul de la coupe du poteau incliné.");
                        } else {
                            // Dessin précis par intersection
                            ctx.beginPath();
                            ctx.moveTo(bottomLeft.x, bottomLeft.y);
                            ctx.lineTo(topLeft.x, topLeft.y);
                            ctx.lineTo(topRight.x, topRight.y);
                            ctx.lineTo(bottomRight.x, bottomRight.y);
                            ctx.closePath();
                        }

                        ctx.fill();
                        ctx.stroke();
                        if (appState.showFoundation && bottomLeft && bottomRight) {
                            drawFoundation((bottomLeft.x + bottomRight.x) / 2);
                        }

                    } else { // Vertical Double Post
                        const postLine = { p1: { x: postX, y: solCoupeY(postX) }, p2: { x: postX, y: -lineLength } };
                        let postTopY;

                        // Intersection de la ligne du poteau avec la ligne de la traverse
                        const intersectionPoint = intersect(postLine.p1, postLine.p2, beamIntersectLine.p1, beamIntersectLine.p2);
                        if (!intersectionPoint) return;
                        postTopY = intersectionPoint.y;

                        // CORRECTIONS V3, V4, V5 et V6
                        if (appState.reinforcementType === 'bracons') {

                            // V3: Les deux poteaux vont jusqu'à la traverse (selon demande)
                            if (appState.doublePostBracing === 'v3') {
                                // postTopY est déjà l'intersection avec beamIntersectLine
                            }

                            // V4/V5: Les deux poteaux doivent aller jusqu'à la traverse (MODIFICATION DEMANDÉE)
                            else if (appState.doublePostBracing === 'v4' || appState.doublePostBracing === 'v5') {
                                // Les deux poteaux (sign=-1 et sign=1) vont jusqu'à la traverse
                                // postTopY est déjà l'intersection avec beamIntersectLine
                            }

                            // V6: Les deux poteaux sont limités à l'intersection avec le bracon.
                            else if (appState.doublePostBracing === 'v6') {
                                const braceHeight = -heightUnderBrace * scale;
                                postTopY = braceHeight;
                            }
                        }

                        ctx.fillRect(postX - postWidthScaled / 2, postTopY, postWidthScaled, solCoupeY(postX) - postTopY);
                        ctx.strokeRect(postX - postWidthScaled / 2, postTopY, postWidthScaled, solCoupeY(postX) - postTopY);
                        if (appState.showFoundation) drawFoundation(postX);
                    }
                });

                if (isInclined && values.showInclinedGroundBar) {
                    const innerSpacing = postSpacingInclined * scale - postWidthScaled;
                    const startX = -spacing + postWidthScaled / 2;
                    const yBarre = solCoupeY(0) - postWidthScaled / 2;
                    ctx.fillRect(startX, yBarre, innerSpacing, postWidthScaled);
                    ctx.strokeRect(startX, yBarre, innerSpacing, postWidthScaled);
                }
            }
        };

        const drawDoublePostBracingBar = (p1, p2, postWidthScaled, values) => {
            if (!p1 || !p2) return;

            if (appState.reinforcementType === 'jarrets') {
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                return; // Ne pas dessiner le rectangle
            }

            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const perpAngle = angle + Math.PI / 2;

            let halfW = (values.braceWidth * scale) / 2;

            // CORRECTION V6: La barre horizontale remonte au niveau de la jonction des poteaux
            if (appState.doublePostBracing === 'v6') {
                const braceHeight = -heightUnderBrace * scale;
                p1 = { x: p1.x, y: braceHeight };
                p2 = { x: p2.x, y: braceHeight };
            }

            const c1 = { x: p1.x + halfW * Math.cos(perpAngle), y: p1.y + halfW * Math.sin(perpAngle) };
            const c2 = { x: p2.x + halfW * Math.cos(perpAngle), y: p2.y + halfW * Math.sin(perpAngle) };
            const c3 = { x: p2.x - halfW * Math.cos(perpAngle), y: p2.y - halfW * Math.sin(perpAngle) };
            const c4 = { x: p1.x - halfW * Math.cos(perpAngle), y: p1.y - halfW * Math.sin(perpAngle) };

            // Dessin précis
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
        };

        const drawDoublePostReinforcementSet = (postWidthScaled, values) => {
            ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
            const spacing = postSpacing * scale / 2;
            const braceHeight = -heightUnderBrace * scale;
            const inclinationRad = 0;
            const tanAngle = Math.tan(inclinationRad);
            const x_offset_at_brace_height = -braceHeight * tanAngle;

            // Points de départ sur le bord intérieur des poteaux
            const p_start_left = { x: (-spacing + postWidthScaled / 2) + x_offset_at_brace_height, y: braceHeight };
            const p_start_right = { x: (spacing - postWidthScaled / 2) - x_offset_at_brace_height, y: braceHeight };
            // Points de départ sur le bord extérieur des poteaux
            const p_outer_start_left = { x: -spacing - postWidthScaled / 2, y: braceHeight };
            const p_outer_start_right = { x: spacing + postWidthScaled / 2, y: braceHeight };

            // Barre Horizontale (V1, V2, V5, V6)
            if (appState.doublePostBracing === 'v1' || appState.doublePostBracing === 'v2' || appState.doublePostBracing === 'v5' || appState.doublePostBracing === 'v6') {
                // Pour V6, les points sont ajustés dans drawDoublePostBracingBar
                drawDoublePostBracingBar(p_start_left, p_start_right, postWidthScaled, values);
            }

            // Bracon Diagonal Intérieur V2 (CORRECTION)
            if (appState.doublePostBracing === 'v2') {
                // Le bracon part du coin supérieur/intérieur de la barre horizontale gauche
                const p_start_diag = { x: p_start_left.x, y: p_start_left.y - (values.braceWidth * scale) / 2 };

                // Il se termine sur le bord intérieur du poteau droit au niveau de la barre horizontale
                const p_end_diag = { x: p_start_right.x, y: p_start_right.y };

                // Dessine en utilisant les points ajustés (le bracon est horizontal si on utilise start_right comme point de fin, mais doit être diagonal)
                // Point d'arrivée: Jonction du poteau Droit avec la traverse inférieure (intersectionPoint.y de drawThePosts)
                const postLineRight = { p1: { x: spacing, y: 0 }, p2: { x: spacing, y: -lineLength } };
                const beamBottomCenter_untrimmed = { x: beamOffsetScaled, y: beamCenterY + beamHeightScaled / 2 * cosA };
                const top_right_post_on_beam = intersect(postLineRight.p1, postLineRight.p2, beamBottomLine.p1, beamBottomLine.p2);

                drawDoublePostReinforcement(p_start_diag, top_right_post_on_beam, postWidthScaled, values, true);
            }

            // Bracons Extérieurs (V1, V2, V3, V6, V4, V5)
            if (appState.doublePostBracing === 'v1' || appState.doublePostBracing === 'v2' || appState.doublePostBracing === 'v3' || appState.doublePostBracing === 'v6' || appState.doublePostBracing === 'v4' || appState.doublePostBracing === 'v5') {

                const braceAttachDist = (beamLengthScaled / 2) * (braceFixPercentage / 100);
                const p_end_left_rot = { x: -braceAttachDist, y: beamHeightScaled / 2 };
                const p_end_right_rot = { x: braceAttachDist, y: beamHeightScaled / 2 };

                const p_end_left_untrimmed = { x: beamOffsetScaled + p_end_left_rot.x * cosA - p_end_left_rot.y * sinA, y: beamCenterY + p_end_left_rot.x * sinA + p_end_left_rot.y * cosA };
                const p_end_right_untrimmed = { x: beamOffsetScaled + p_end_right_rot.x * cosA - p_end_right_rot.y * sinA, y: beamCenterY + p_end_right_rot.x * sinA + p_end_right_rot.y * cosA };

                // Correction V6: Le point d'attache sur le poteau est le centre du bracon (post-width)
                let start_left = p_outer_start_left;
                let start_right = p_outer_start_right;
                if (appState.doublePostBracing === 'v6') {
                    start_left = { x: -spacing, y: braceHeight };
                    start_right = { x: spacing, y: braceHeight };
                }

                const p_end_left = intersect(start_left, p_end_left_untrimmed, beamBottomLine.p1, beamBottomLine.p2);
                const p_end_right = intersect(start_right, p_end_right_untrimmed, beamBottomLine.p1, beamBottomLine.p2);

                drawDoublePostReinforcement(p_outer_start_left, p_end_left, postWidthScaled, values);
                drawDoublePostReinforcement(p_outer_start_right, p_end_right, postWidthScaled, values);
            }

            // Bracons Intérieurs (V4 et V5 - va du poteau au centre de la traverse)
            if (appState.doublePostBracing === 'v4' || appState.doublePostBracing === 'v5') {
                const beamBottomCenter_untrimmed = { x: beamOffsetScaled, y: beamCenterY + beamHeightScaled / 2 * cosA };

                const beamBottomCenter_left = intersect(p_start_left, beamBottomCenter_untrimmed, beamBottomLine.p1, beamBottomLine.p2);
                const beamBottomCenter_right = intersect(p_start_right, beamBottomCenter_untrimmed, beamBottomLine.p1, beamBottomLine.p2);

                drawDoublePostReinforcement(p_start_left, beamBottomCenter_left, postWidthScaled, values);
                drawDoublePostReinforcement(p_start_right, beamBottomCenter_right, postWidthScaled, values);
            }
        };

        const drawDoublePostReinforcement = (start, end, postWidthScaled, values, isV2Inner = false) => {
            if (!start || !end) return;

            if (appState.reinforcementType === 'jarrets') {
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
                return; // Ne pas dessiner le rectangle
            }

            let braceWidthScaled;
            if (appState.doublePostBracing === 'v6') {
                braceWidthScaled = values.postWidth * scale; // Épaisseur poteau
            } else {
                braceWidthScaled = values.braceWidth * scale; // Épaisseur bracon par défaut
            }

            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const perpAngle = angle + Math.PI / 2;
            const halfW = braceWidthScaled / 2;

            // Lignes directrices du bracon (haut et bas)
            const lineTop = {
                p1: { x: start.x + halfW * Math.cos(perpAngle), y: start.y + halfW * Math.sin(perpAngle) },
                p2: { x: end.x + halfW * Math.cos(perpAngle), y: end.y + halfW * Math.sin(perpAngle) }
            };
            const lineBottom = {
                p1: { x: start.x - halfW * Math.cos(perpAngle), y: start.y - halfW * Math.sin(perpAngle) },
                p2: { x: end.x - halfW * Math.cos(perpAngle), y: end.y - halfW * Math.sin(perpAngle) }
            };

            // Ligne de bord du poteau
            const spacing = values.postSpacing * scale / 2;
            let postEdgeX;
            let isLeftPost = start.x < 0;

            if (appState.doublePostBracing === 'v6') {
                // V6: Bracon centré sur le poteau
                postEdgeX = isLeftPost ? -spacing : spacing;
            } else if (isV2Inner) {
                // V2 Inner: Bracon part du bord intérieur de la barre horizontale (à la position x du poteau gauche)
                // Le point de départ "start" a déjà été ajusté en Y pour V2
                postEdgeX = isLeftPost ? -spacing + postWidthScaled / 2 : spacing - postWidthScaled / 2;
            } else if (appState.doublePostBracing === 'v4' || appState.doublePostBracing === 'v5') {
                // V4/V5 intérieur: Bracon part du bord intérieur du poteau
                postEdgeX = isLeftPost ? -spacing + postWidthScaled / 2 : spacing - postWidthScaled / 2;
            } else if (isLeftPost) {
                // Bracon extérieur gauche: part du bord extérieur gauche
                postEdgeX = -spacing - postWidthScaled / 2;
            } else {
                // Bracon extérieur droit: part du bord extérieur droit
                postEdgeX = spacing + postWidthScaled / 2;
            }
            const postEdgeLine = { p1: { x: postEdgeX, y: -lineLength }, p2: { x: postEdgeX, y: lineLength } };

            // p1 et p4 sont sur le poteau
            const p1 = intersect(lineTop.p1, lineTop.p2, postEdgeLine.p1, postEdgeLine.p2);
            const p4 = intersect(lineBottom.p1, lineBottom.p2, postEdgeLine.p1, postEdgeLine.p2);

            // p2 et p3 sont sur la traverse (beamBottomLine)
            const p2 = intersect(lineTop.p1, lineTop.p2, beamBottomLine.p1, beamBottomLine.p2);
            const p3 = intersect(lineBottom.p1, lineBottom.p2, beamBottomLine.p1, beamBottomLine.p2);

            if (p1 && p2 && p3 && p4) {
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            }
        };

        const drawReinforcement = (side, postCenterX, values) => {
            // Correction chirurgicale : recalcul de la position réelle du poteau pour le modèle excentré
            if (appState.postModel === 'offset' && appState.offsetPostSide !== 'center') {
                const localInvertSlope = appState.invertSlope;
                const roofSlopeRadians = values.roofSlope * Math.PI / 180;
                const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                let basePostX = 0;
                if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                postCenterX = basePostX + (values.postEccentricity * scale);
            } else if (isNaN(postCenterX)) {
                postCenterX = values.postEccentricity * scale;
            }

            const sign = (side === 'right') ? 1 : -1;
            const postEdgeX = postCenterX + sign * postWidthScaled / 2;
            const braceAttachOnPostY = solCoupeY(postCenterX) - heightUnderBrace * scale;

            let currentBeamBottomLine = beamBottomLine;
            let currentBeamOffset = beamOffsetScaled;
            let currentAngle = angle;
            let currentBeamLength = beamLengthScaled;

            if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                currentBeamLength = beamLengthScaled;
                currentAngle = (side === 'left' ? 1 : -1) * Math.abs(roofSlopeRadians);
                if (localInvertSlope) currentAngle *= -1;
                currentBeamBottomLine = getBeamLine(beamHeightScaled / 2, currentAngle, 0, beamCenterY);
            }
            const currentCosA = Math.cos(currentAngle);
            const currentSinA = Math.sin(currentAngle);

            ctx.fillStyle = '#f3f4f6';
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 1;

            let braceLineP1;
            if (appState.postModel === 'inclinedPost') {
                // Pas de renforts dans le modèle actuel pour poteaux inclinés
                return;
            } else {
                braceLineP1 = { x: postEdgeX, y: braceAttachOnPostY };
            }

            let braceAttachDist;
            if (appState.postModel === 'single' || appState.postModel === 'offset' || appState.postModel === 'linked') {
                braceAttachDist = (currentBeamLength / 2) * (braceFixPercentage / 100);
            } else { // Y-Shape
                braceAttachDist = currentBeamLength * (braceFixPercentage / 100);
            }

            const braceEndRotated = {
                x: sign * braceAttachDist,
                y: beamHeightScaled / 2
            };

            let finalBeamOffset = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') ? 0 : currentBeamOffset;

            const braceEndOnBeamBottom = {
                x: finalBeamOffset + braceEndRotated.x * currentCosA - braceEndRotated.y * currentSinA,
                y: beamCenterY + braceEndRotated.x * currentSinA + braceEndRotated.y * currentCosA
            };

            if (appState.reinforcementType === 'bracons') {
                const braceWidthScaled = values.braceWidth * scale;

                const braceAngle = Math.atan2(braceEndOnBeamBottom.y - braceLineP1.y, braceEndOnBeamBottom.x - braceLineP1.x);
                const perpAngle = braceAngle + Math.PI / 2;
                const halfW = braceWidthScaled / 2;

                // Jonctions parfaites Bracons
                const lineTop = {
                    p1: { x: braceLineP1.x + halfW * Math.cos(perpAngle), y: braceLineP1.y + halfW * Math.sin(perpAngle) },
                    p2: { x: braceEndOnBeamBottom.x + halfW * Math.cos(perpAngle), y: braceEndOnBeamBottom.y + halfW * Math.sin(perpAngle) }
                };
                const lineBottom = {
                    p1: { x: braceLineP1.x - halfW * Math.cos(perpAngle), y: braceLineP1.y - halfW * Math.sin(perpAngle) },
                    p2: { x: braceEndOnBeamBottom.x - halfW * Math.cos(perpAngle), y: braceEndOnBeamBottom.y - halfW * Math.sin(perpAngle) }
                };

                const postEdgeLine = { p1: { x: postEdgeX, y: -lineLength }, p2: { x: postEdgeX, y: lineLength } };

                const p1 = intersect(lineTop.p1, lineTop.p2, postEdgeLine.p1, postEdgeLine.p2);
                const p2 = intersect(lineTop.p1, lineTop.p2, currentBeamBottomLine.p1, currentBeamBottomLine.p2);
                const p3 = intersect(lineBottom.p1, lineBottom.p2, currentBeamBottomLine.p1, currentBeamBottomLine.p2);
                const p4 = intersect(lineBottom.p1, lineBottom.p2, postEdgeLine.p1, postEdgeLine.p2);

                if (p1 && p2 && p3 && p4) {
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.lineTo(p3.x, p3.y);
                    ctx.lineTo(p4.x, p4.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }

            } else { // Jarrets

                const jarretHeight = 0.35 * scale;
                let postOnBeamBottom;
                let jarretAttachY;

                if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                    postOnBeamBottom = intersect(braceLineP1, { x: braceLineP1.x, y: -lineLength }, currentBeamBottomLine.p1, currentBeamBottomLine.p2);
                    jarretAttachY = -postHeightScaled + jarretHeight;
                } else {
                    postOnBeamBottom = intersect(braceLineP1, { x: braceLineP1.x, y: -lineLength }, currentBeamBottomLine.p1, currentBeamBottomLine.p2);
                    jarretAttachY = postOnBeamBottom.y + jarretHeight;
                }

                const postEdgeLine = { p1: { x: postEdgeX, y: lineLength }, p2: { x: postEdgeX, y: -lineLength } };

                if (postOnBeamBottom) {
                    ctx.beginPath();
                    ctx.moveTo(postEdgeX, jarretAttachY);
                    ctx.lineTo(braceEndOnBeamBottom.x, braceEndOnBeamBottom.y);
                    ctx.lineTo(postOnBeamBottom.x, postOnBeamBottom.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
            }
        };

        const drawRoofStructure = (localAngle, localBeamOffset, localCenterY, half = false, eaveExtensionScaled = 0, overrideArmLength = null) => {
            ctx.save();
            ctx.translate(localBeamOffset, localCenterY);
            ctx.rotate(localAngle);

            const isYShapeArm = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') && half;

            // Calcul de la position de la traverse
            let startX;
            if (isYShapeArm) {
                startX = (localAngle > 0 ? -postWidthScaled / 2 : postWidthScaled / 2);
            } else {
                startX = -beamLengthScaled / 2;
            }

            // overrideArmLength : utilisé par "Double toiture Y" pour étirer un bras intérieur (traverse +
            // pannes + panneau, tous cohérents puisqu'ils dérivent de currentBeamLength) jusqu'au faîtage
            // commun avec le poteau voisin. Ne s'applique qu'aux bras "Toiture Y" ; tous les autres modèles
            // (et le bras "Toiture Y" standard, quand overrideArmLength vaut null) sont inchangés.
            const effectiveArmLength = (isYShapeArm && overrideArmLength !== null) ? overrideArmLength : beamLengthScaled;
            const currentBeamLength = isYShapeArm ? (localAngle > 0 ? -effectiveArmLength : effectiveArmLength) : effectiveArmLength;

            ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;

            let beamDrawX = isYShapeArm ? (localAngle > 0 ? startX + currentBeamLength : startX) : startX;
            let beamDrawWidth = isYShapeArm ? Math.abs(currentBeamLength) : currentBeamLength;

            // Prolongement de la traverse jusqu'à l'aplomb du bord de toiture côté égout ("Poteaux centrés
            // liaisonnés", à partir de la 2e ombrière). Le côté égout est déterminé dynamiquement par le signe
            // de sin(localAngle) — même convention que "offsetPostSide === 'low'" ailleurs dans ce fichier — donc
            // ça reste correct si la pente est inversée. Les pannes (calculées plus bas à partir de startX/
            // currentBeamLength, non modifiés) et le panneau (panelStartX, non modifié) ne bougent pas : seule
            // la traverse s'allonge, du côté qui touche réellement le bord de toiture existant.
            let beamDrawXDisplay = beamDrawX;
            let beamDrawWidthDisplay = beamDrawWidth;
            if (!isYShapeArm && eaveExtensionScaled > 0) {
                if (Math.sin(localAngle) >= 0) {
                    beamDrawWidthDisplay = beamDrawWidth + eaveExtensionScaled;
                } else {
                    beamDrawXDisplay = beamDrawX - eaveExtensionScaled;
                    beamDrawWidthDisplay = beamDrawWidth + eaveExtensionScaled;
                }
            }

            ctx.fillRect(beamDrawXDisplay, -beamHeightScaled / 2, beamDrawWidthDisplay, beamHeightScaled);
            ctx.strokeRect(beamDrawXDisplay, -beamHeightScaled / 2, beamDrawWidthDisplay, beamHeightScaled);

            ctx.fillStyle = '#e5e7eb';
            const purlinSize = 0.08 * scale;
            const purlinEffectiveLength = Math.abs(currentBeamLength) - purlinSize;
            const purlinCountSide = isYShapeArm ? Math.ceil(purlinCount / 2) : purlinCount;
            const purlinSpacing = purlinCountSide > 1 ? purlinEffectiveLength / (purlinCountSide - 1) : 0;

            for (let i = 0; i < purlinCountSide; i++) {
                const xPos = purlinCountSide === 1 ? startX + currentBeamLength / 2 : startX + (currentBeamLength > 0 ? (purlinSize / 2 + i * purlinSpacing) : (-purlinSize / 2 - i * purlinSpacing));
                ctx.fillRect(xPos - purlinSize / 2, -beamHeightScaled / 2 - purlinHeightScaled, purlinSize, purlinHeightScaled);
                ctx.strokeRect(xPos - purlinSize / 2, -beamHeightScaled / 2 - purlinHeightScaled, purlinSize, purlinHeightScaled);
            }

            const overhangScaled = values.overhangSymValue * scale;

            let panelStartX, panelDrawWidth;

            if (isYShapeArm) {
                // CORRECTION Y-SHAPE: Début sur la panne sablière (bord de la traverse) et fin au porte-à-faux (côté haut)
                const isJunctionArm = overrideArmLength !== null;

                if (isJunctionArm) {
                    // Bras de jonction ("Double toiture Y", côté qui rejoint le poteau voisin) : la traverse
                    // a déjà été étirée (effectiveArmLength) jusqu'au faîtage commun. Le porte-à-faux ne doit
                    // pas s'y ajouter : la toiture doit se terminer exactement à l'aplomb de l'extrémité de
                    // la traverse (alignement traverse/toiture), le porte-à-faux restant réservé aux bras
                    // extérieurs qui ne concernent pas la jonction.
                    panelStartX = beamDrawX;
                    panelDrawWidth = Math.abs(currentBeamLength);
                } else {
                    // La panne sablière est au bord de la traverse.
                    panelStartX = currentBeamLength < 0 ? (beamDrawX - overhangScaled) : beamDrawX;
                    panelDrawWidth = Math.abs(currentBeamLength) + overhangScaled;
                }

            } else {
                // Cas général (Single, Double, Offset, Inclined, Linked)
                // En porte-à-faux asymétrique, la toiture n'est pas centrée sur la traverse : le bord bas
                // (égout) déborde de overhangL au-delà du bord bas de la traverse, le bord haut (faîtage)
                // déborde de overhangH au-delà du bord haut de la traverse. Le côté bas (égout) correspond
                // au signe de sin(localAngle) — même convention que "eaveOnRight" dans ombriere_liasonnee.js
                // et "offsetPostSide" plus haut dans ce fichier. En symétrique, overhangL = overhangH =
                // overhangSymValue et ce calcul redonne exactement l'ancien comportement centré.
                const overhangLScaled = (values.overhangL || 0) * scale;
                const overhangHScaled = (values.overhangH || 0) * scale;
                const eaveOnRight = Math.sin(localAngle) >= 0;
                const overhangLeftScaled = eaveOnRight ? overhangHScaled : overhangLScaled;
                const overhangRightScaled = eaveOnRight ? overhangLScaled : overhangHScaled;
                panelStartX = -beamLengthScaled / 2 - overhangLeftScaled;
                panelDrawWidth = beamLengthScaled + overhangLeftScaled + overhangRightScaled;
            }

            const integrationSystemY = -beamHeightScaled / 2 - purlinHeightScaled - integrationSystemHeightScaled;
            const panelY = integrationSystemY - panelThicknessScaled;

            // Dessin de l'intégration et des panneaux
            ctx.fillStyle = '#d1d5db';
            ctx.fillRect(panelStartX, integrationSystemY, panelDrawWidth, integrationSystemHeightScaled);
            ctx.strokeRect(panelStartX, integrationSystemY, panelDrawWidth, integrationSystemHeightScaled);

            ctx.fillStyle = 'rgba(30, 41, 59, 1)';
            ctx.fillRect(panelStartX, panelY, panelDrawWidth, panelThicknessScaled);
            ctx.strokeRect(panelStartX, panelY, panelDrawWidth, panelThicknessScaled);

            if (isYShapeArm) {
                ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.fillText(`Pente = ${values.roofSlope}°`, panelStartX + panelDrawWidth / 2, panelY - 20);

                const p_panel_inner = { x: panelStartX, y: panelY };
                const p_panel_outer_x = panelStartX + panelDrawWidth;
                const p_panel_outer = { x: p_panel_outer_x, y: panelY };

                drawDimensionLine(ctx, p_panel_inner.x, p_panel_inner.y, p_panel_outer.x, p_panel_outer.y, `${(Math.abs(panelDrawWidth) / scale).toFixed(2)}m`, -45, false);
            }

            ctx.restore();
        };

        // Ensemble complet des cotations du modèle "Poteaux centrés" (et modèles apparentés).
        // Extrait en fonction réutilisable pour pouvoir être rejoué tel quel sur un module du modèle "linked".
        const drawStandardDimensions = () => {
            // panelWidthScaled est la largeur totale du champ PV (ex: 12.40)
            // Extrémités du panneau : en asymétrique la toiture n'est pas centrée sur la traverse (même
            // logique que dans drawRoofStructure), donc on ne peut plus se baser sur -panelWidthScaled/2.
            const overhangLScaledDim = (values.overhangL || 0) * scale;
            const overhangHScaledDim = (values.overhangH || 0) * scale;
            const eaveOnRightDim = Math.sin(angle) >= 0;
            const overhangLeftScaledDim = eaveOnRightDim ? overhangHScaledDim : overhangLScaledDim;
            const overhangRightScaledDim = eaveOnRightDim ? overhangLScaledDim : overhangHScaledDim;
            const panelCorners = [{ x: -beamLengthScaled / 2 - overhangLeftScaledDim, y: panelY }, { x: beamLengthScaled / 2 + overhangRightScaledDim, y: panelY }]
                .map(p => ({ x: p.x * cosA - p.y * sinA + beamOffsetScaled, y: beamCenterY + p.x * sinA + p.y * cosA }));
            const panelLowest = panelCorners.reduce((max, p) => p.y > max.y ? p : max, panelCorners[1]);
            const panelHighest = panelCorners.reduce((min, p) => p.y < min.y ? p : min, panelCorners[0]);

            // beamLengthScaled est la longueur de la traverse (ex: 11.40)
            const beamCorners = [{ x: -beamLengthScaled / 2, y: beamHeightScaled / 2 }, { x: beamLengthScaled / 2, y: beamHeightScaled / 2 }].map(p => ({ x: p.x + beamOffsetScaled, y: p.y })).map(p => ({ x: p.x * cosA - p.y * sinA, y: beamCenterY + p.x * sinA + p.y * cosA }));
            const structureLowestY = beamCorners.reduce((max, p) => p.y > max.y ? p : max, beamCorners[0]).y;

            const dimOffsetLeft = -5.5 * scale;
            const dimOffsetRight = postWidthScaled / 2 + (3 * scale);
            const structureMinX = Math.min(...panelCorners.map(p => p.x), -postWidthScaled / 2, ...beamCorners.map(p => p.x));


            // --- DEBUT BLOC COTATIONS VERTICALES ---

            if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                const angle_L = roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const angle_R = -roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const cos_L = Math.cos(angle_L); const sin_L = Math.sin(angle_L);
                const cos_R = Math.cos(angle_R); const sin_R = Math.sin(angle_R);

                // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidthScaled représente déjà un bras.
                const panelWidthForY = panelWidthScaled;

                const panelTop_L_rel = {
                    x: (-postWidthScaled / 2) + (-panelWidthForY) * cos_L - panelY * sin_L,
                    y: beamCenterY + (-panelWidthForY) * sin_L + panelY * cos_L
                };
                const panelTop_R_rel = {
                    x: (+postWidthScaled / 2) + (panelWidthForY) * cos_R - panelY * sin_R,
                    y: beamCenterY + (panelWidthForY) * sin_R + panelY * cos_R
                };

                const panelHighestY = Math.min(panelTop_L_rel.y, panelTop_R_rel.y);
                const structureHighestY = panelHighestY;
                const structureHighestHeight = -structureHighestY / scale;

                let braceLowestY;
                if (appState.reinforcementType === 'jarrets') {
                    braceLowestY = -values.heightUnderBrace * scale; // Jarret hauteur
                } else {
                    braceLowestY = -values.heightUnderBrace * scale; // Bracon hauteur
                }

                const structureLowestHeight = -braceLowestY / scale;

                const dimLineX_L = panelTop_L_rel.x - 0.1 * scale;
                const dimLineX_R = panelTop_R_rel.x + 0.1 * scale;

                drawVerticalDimensionWithLeader(ctx, panelTop_L_rel.x, structureHighestY, dimLineX_L, null, solCoupeY, coteSol);
                drawVerticalDimensionWithLeader(ctx, panelTop_R_rel.x, structureHighestY, dimLineX_R, null, solCoupeY, coteSol);

                const leaderStartX_L = -postWidthScaled / 2;
                drawVerticalDimensionWithLeader(ctx, leaderStartX_L, braceLowestY, dimLineX_L + 5 * scale, null, solCoupeY, coteAuPied);
                const leaderStartX_R = postWidthScaled / 2;
                drawVerticalDimensionWithLeader(ctx, leaderStartX_R, braceLowestY, dimLineX_R - 5 * scale, null, solCoupeY, coteAuPied);

            } else {
                // Cotations verticales pour les autres modèles
                drawVerticalDimensionWithLeader(ctx, beamCorners[0].x, structureLowestY, beamCorners[0].x, null, solCoupeY, coteAuPied);
                drawVerticalDimensionWithLeader(ctx, panelLowest.x, panelLowest.y, panelLowest.x - 1.0 * scale, null, solCoupeY, coteSol);

                if (appState.postModel !== 'double' && appState.postModel !== 'inclinedPost' && appState.postModel !== 'single') {
                    let basePostX = 0;
                    if (appState.postModel === 'offset' && appState.offsetPostSide !== 'center') {
                        const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                        if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                        if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                    }
                    const postCenterX = basePostX + (values.postEccentricity * scale);
                    // Ajustement de l'offset pour que la cote ne sorte pas de l'écran
                    const adjustedDimOffset = (postCenterX > 0) ? -dimOffsetRight : dimOffsetRight;
                    drawVerticalDimensionWithLeader(ctx, postCenterX, -postHeightScaled, postCenterX + adjustedDimOffset, null, solCoupeY, coteAuPied);
                }

                drawVerticalDimensionWithLeader(ctx, panelHighest.x, panelHighest.y, panelHighest.x + 1.0 * scale, null, solCoupeY, coteSol);
            }

            // --- FIN BLOC COTATIONS VERTICALES ---


            // Cotation "Hauteur sous renfort" (pour modèles non-Y et non-inclined), mesurée depuis
            // le sol AU POTEAU (terrain réel).
            const braceAttachAu = (xPoteau) => solCoupeY(xPoteau) - heightUnderBrace * scale;

            if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape' && appState.postModel !== 'inclinedPost' && (appState.reinforcementType === 'bracons' || (appState.postModel === 'double' && appState.showDoubleBracing))) {
                let dimLineX = -1.0 * scale;
                let leaderStartX = 0;

                if (appState.postModel === 'single' || appState.postModel === 'linked') {
                    leaderStartX = postWidthScaled / 2;
                    dimLineX = -postWidthScaled / 2 - 1.0 * scale;
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCoupeY, coteAuPied);

                } else if (appState.postModel === 'offset') {
                    let basePostX = 0;
                    if (appState.offsetPostSide !== 'center') {
                        const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                        if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                        if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                    }
                    const postCenterX = basePostX + (values.postEccentricity * scale);
                    leaderStartX = postCenterX + (appState.showBraceRight ? postWidthScaled / 2 : -postWidthScaled / 2);
                    dimLineX = postCenterX - postWidthScaled / 2 - 1.0 * scale;
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCoupeY, coteAuPied);

                } else if (appState.postModel === 'double') {
                    const spacing = postSpacing * scale / 2;
                    leaderStartX = -spacing - postWidthScaled / 2; // Bord extérieur du poteau gauche
                    dimLineX = leaderStartX - 1.0 * scale;
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCoupeY, coteAuPied);
                }

            }

            // --- DEBUT BLOC COTATIONS HORIZONTALES ---

            if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                const angle_L = roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const angle_R = -roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const cos_L = Math.cos(angle_L); const sin_L = Math.sin(angle_L);
                const cos_R = Math.cos(angle_R); const sin_R = Math.sin(angle_R);

                // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidthScaled représente déjà un bras.
                const panelWidthForY = panelWidthScaled;

                const p_left_end = {
                    x: (-postWidthScaled / 2) + (-panelWidthForY) * cos_L - panelY * sin_L,
                    y: beamCenterY + (-panelWidthForY) * sin_L + panelY * cos_L
                };

                const p_right_end = {
                    x: (+postWidthScaled / 2) + (panelWidthForY) * cos_R - panelY * sin_R,
                    y: beamCenterY + (panelWidthForY) * sin_R + panelY * cos_R
                };

                const totalProjWidth = values.totalProjectionWidth;

                const projY = 0.5 * scale;
                drawDimensionLine(ctx, p_left_end.x, projY, p_right_end.x, projY, `${totalProjWidth.toFixed(2)}m`, 0, false);

            } else {
                // Cotations horizontales pour les autres modèles
                const projectionHorizontale = values.totalProjectionWidth;
                const projMinX = Math.min(...panelCorners.map(p => p.x));
                const projMaxX = Math.max(...panelCorners.map(p => p.x));

                let projDimY = 0.8 * scale;
                if (appState.postModel === 'double' || appState.postModel === 'inclinedPost' || appState.postModel === 'offset') {
                    projDimY = 1.1 * scale;
                }

                if (appState.postModel === 'offset' && (appState.offsetPostSide !== 'center' || postEccentricity !== 0)) {
                    let basePostX = 0;
                    if (appState.offsetPostSide !== 'center') {
                        const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                        if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                        if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                    }
                    const postCenterX = basePostX + (values.postEccentricity * scale);
                    const totalProj = (projMaxX - projMinX) / scale;

                    const dimY_L1 = projDimY - 0.5 * scale;
                    const val1 = (postCenterX - projMinX) / scale;
                    const val2 = (projMaxX - postCenterX) / scale;

                    drawDimensionLine(ctx, projMinX, dimY_L1, postCenterX, dimY_L1, `${Math.abs(val1).toFixed(2)}m`, 0, false);
                    drawDimensionLine(ctx, postCenterX, dimY_L1, projMaxX, dimY_L1, `${Math.abs(val2).toFixed(2)}m`, 0, false);

                    drawDimensionLine(ctx, projMinX, projDimY, projMaxX, projDimY, `${totalProj.toFixed(2)}m`, 0, false);

                    const structuralCenterX = (projMinX + projMaxX) / 2;
                    if (Math.abs(postCenterX - structuralCenterX) > 0.01 * scale) {
                        const dimY_L3 = projDimY + 0.3 * scale;
                        drawDimensionLine(ctx, structuralCenterX, dimY_L3, postCenterX, dimY_L3, `${Math.abs(values.postEccentricity).toFixed(2)}m`, 0, false);
                    }

                } else if (appState.postModel === 'single' || appState.postModel === 'linked') {
                    projDimY += 0.2 * scale;
                    const dimY_L1 = projDimY - 0.6 * scale;
                    const postCenterX = 0;

                    const halfProj = projectionHorizontale / 2;
                    drawDimensionLine(ctx, projMinX, dimY_L1, postCenterX, dimY_L1, `${halfProj.toFixed(2)}m`, 0, false);
                    drawDimensionLine(ctx, postCenterX, dimY_L1, projMaxX, dimY_L1, `${halfProj.toFixed(2)}m`, 0, false);

                    drawDimensionLine(ctx, projMinX, projDimY, projMaxX, projDimY, `${projectionHorizontale.toFixed(2)}m`, 0, false);

                } else { // Pour double, inclined
                    drawDimensionLine(ctx, projMinX, projDimY, projMaxX, projDimY, `${projectionHorizontale.toFixed(2)}m`, 0, false);
                }

                drawDimensionLine(ctx, panelCorners[0].x, panelCorners[0].y, panelCorners[1].x, panelCorners[1].y, `${values.panelWidth.toFixed(2)}m`, -40, false);
            }

            // --- FIN BLOC COTATIONS HORIZONTALES ---


            if (appState.postModel === 'double' || appState.postModel === 'inclinedPost') {
                const spacingValue = (appState.postModel === 'double') ? postSpacing : postSpacingInclined;
                const spacing = spacingValue * scale / 2;
                const dimY = 0.5 * scale;
                drawDimensionLine(ctx, -spacing, dimY, spacing, dimY, `${spacingValue.toFixed(2)}m`, 0, false);
            }
        };

        // --- DRAWING ORDER ---
        let linkedDrawResult = null;
        let doubleYShapeDrawResult = null;
        if (appState.postModel === 'linked') {
            // Modèle "Poteaux centrés liaisonnés" : logique encapsulée dans ombriere_liasonnee.js.
            // On expose les helpers locaux nécessaires (closures de drawCoupe) au fichier dédié.
            window.drawReinforcement = drawReinforcement;
            window.drawRoofStructure = drawRoofStructure;
            window.drawFoundation = drawFoundation;
            linkedDrawResult = drawOmbriereLiasonee(ctx, values, scale, angle, cosA, sinA);
        } else if (appState.postModel === 'doubleYShape') {
            // Modèle "Double toiture Y" : logique encapsulée dans ombriere_liasonnee.js.
            window.drawReinforcement = drawReinforcement;
            window.drawRoofStructure = drawRoofStructure;
            window.drawFoundation = drawFoundation;
            doubleYShapeDrawResult = drawDoubleYShapeOmbriere(ctx, values, scale, angle, cosA, sinA);
        } else {
            drawTheReinforcements();

            if (appState.postModel === 'y_shape') {
                drawThePosts();
                drawRoofStructure(roofSlopeRadians * (localInvertSlope ? -1 : 1), 0, beamCenterY, true); // Bras 1
                drawRoofStructure(-roofSlopeRadians * (localInvertSlope ? -1 : 1), 0, beamCenterY, true); // Bras 2
            } else {
                // Ordre de dessin Poteaux Inclinés
                let isPostInFront = (appState.traversePosition === 'side' && appState.postModel !== 'y_shape') ||
                    (appState.traversePosition === 'top' && appState.postModel === 'inclinedPost');

                if (isPostInFront) {
                    drawRoofStructure(angle, beamOffsetScaled, beamCenterY);
                    drawThePosts();
                } else { // 'top' position for 'single', 'offset', 'double'
                    drawThePosts();
                    drawRoofStructure(angle, beamOffsetScaled, beamCenterY);
                }
            }
        }

        const groundRectDepth = 1.40 * scale; // Profondeur hachure de 1.40m
        // Terrain réel (profil) ou bande plate historique — tracé identique dans les deux cas.
        const solDebutX = window.__dxfCapture ? -(demiEmpriseCoupeM + 2) * scale : -width * 4 / viewManager.zoom;
        const solFinX = window.__dxfCapture ? (demiEmpriseCoupeM + 2) * scale : width * 4 / viewManager.zoom;
        if (TP && typeof TP.dessinerSol === 'function') {
            TP.dessinerSol(ctx, {
                solY: solCoupeY, xDebut: solDebutX, xFin: solFinX, profondeur: groundRectDepth,
                pasEchantillon: solCoupeAuto ? 0.5 * scale : 0,
            });
        } else {
            ctx.save();
            ctx.fillStyle = "#f0f0f0"; ctx.fillRect(solDebutX, 0, solFinX - solDebutX, groundRectDepth);
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.strokeRect(solDebutX, 0, solFinX - solDebutX, groundRectDepth);
            ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
            for (let i = solDebutX - groundRectDepth; i < solFinX; i += 10) {
                ctx.beginPath(); ctx.moveTo(i, groundRectDepth); ctx.lineTo(i + groundRectDepth, 0); ctx.stroke();
            }
            ctx.restore();
        }

        // --- Dimensions ---
        if (appState.postModel !== 'linked' && appState.postModel !== 'doubleYShape') {
            drawStandardDimensions();
        } else if (appState.postModel === 'linked' && linkedDrawResult && linkedDrawResult.linkPoints && linkedDrawResult.linkPoints.length > 0) {
            // Cotations standard rejouées sur chaque ombrière liaisonnée (toutes identiques),
            // puis cotation de l'entraxe entre chaque paire de poteaux.
            linkedDrawResult.linkPoints.forEach(pt => {
                ctx.save();
                ctx.translate(pt.center.x, 0);
                drawStandardDimensions();
                ctx.restore();
            });
            drawLinkedEntraxeDimensions(ctx, linkedDrawResult.linkPoints, linkedDrawResult.safePostSpacing, scale);
        } else if (appState.postModel === 'doubleYShape' && doubleYShapeDrawResult && doubleYShapeDrawResult.postPositions && doubleYShapeDrawResult.postPositions.length > 0) {
            // Cotations du modèle "Toiture Y" rejouées sur le premier poteau (tous identiques).
            ctx.save();
            ctx.translate(doubleYShapeDrawResult.postPositions[0], 0);
            drawStandardDimensions();
            ctx.restore();
        }

        ctx.save();
        ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape') {
            ctx.translate(beamOffsetScaled, beamCenterY); ctx.rotate(angle);
            ctx.fillText(`Pente = ${roofSlope}°`, 0, panelY - 10);
        }
        ctx.restore();
        ctx.restore();

        // Return boundary box for PDF cropping (in meters/drawing units)
        // We define the drawing units relative to the scale (1 unit = 1m in real life)
        const marginMeters = 1.0;
        if (appState.postModel === 'linked') {
            const linkedPanelCount = Math.max(2, values.linkedPanelsCount || 2);
            const totalWidthMeters = (linkedPanelCount - 1) * (values.postSpacing || 0);
            return {
                minX: -(totalWidthMeters / 2) - (values.panelWidth / 2) - marginMeters,
                maxX: (totalWidthMeters / 2) + (values.panelWidth / 2) + marginMeters,
                minY: -values.postHeight - marginMeters,
                maxY: marginMeters
            };
        }
        if (appState.postModel === 'doubleYShape') {
            // N poteaux espacés de postSpacing (calculé), le premier et le dernier ayant chacun
            // un bras extérieur standard de panelWidth (un bras, cf. correctif Bipente) qui dépasse
            // vers l'extérieur.
            const doubleYShapePanelCount = Math.max(2, values.doubleYShapePanelsCount || 2);
            const totalWidthMeters = (doubleYShapePanelCount - 1) * (values.postSpacing || 0);
            const outerArmMeters = values.panelWidth || 0;
            return {
                minX: -(totalWidthMeters / 2) - outerArmMeters - marginMeters,
                maxX: (totalWidthMeters / 2) + outerArmMeters + marginMeters,
                minY: -values.postHeight - marginMeters,
                maxY: marginMeters
            };
        }
        if (appState.postModel === 'y_shape') {
            // CORRECTIF (cohérence Toiture Y / Bipente) : branche dédiée, séparée du fallback partagé
            // ci-dessous (single/offset/double/inclinedPost, sans rapport avec ce sujet, qui doivent
            // garder leur division par 2). panelWidth représente déjà un seul bras.
            const armMeters = values.panelWidth || 0;
            return {
                minX: -armMeters - marginMeters,
                maxX: armMeters + marginMeters,
                minY: -values.postHeight - marginMeters,
                maxY: marginMeters
            };
        }
        return {
            minX: -(values.panelWidth / 2) - marginMeters,
            maxX: values.panelWidth / 2 + marginMeters,
            minY: -values.postHeight - marginMeters,
            maxY: marginMeters // Just above the ground line (Y=0)
        };
    }

    function drawFacade(canvas, ctx, viewManager, values) {
        // Logique de dessin de la façade (conservée intégralement)
        const { postHeight, facadeLength, leftOverhang, rightOverhang, groundSlopeFacade, postWidth, panelWidth, roofSlope, invertSlope, lowPointHeight, alignRoof, pvLayout, baseAltimetry, purlinHeight } = values;
        const { width, height } = setupCanvas(canvas);
        if (width === 0 || height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);
        const distances = appState.parsedDistances;
        if (!distances) { ctx.restore(); return; }
        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth représente déjà un bras pour y_shape.
        const effectivePanelWidth = panelWidth;
        const roofApparentHeight = Math.abs(effectivePanelWidth * Math.sin(roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1)));

        const totalDrawingWidth = facadeLength;
        // Terrain automatique (geometrie_structure/terrain_plans.js) : profil réel sous la façade,
        // lu dans le sens de la vue (par défaut depuis le Sud). null -> droite manuelle historique.
        const TPF = window.TerrainPlans;
        const solFacadeAuto = (TPF && typeof TPF.solFacade === 'function')
            ? TPF.solFacade({ orientation: 'Sud', longueurDessinM: facadeLength })
            : null;
        let deniveleDessinM = Math.abs(groundSlopeFacade);
        if (solFacadeAuto) {
            let zMin = 0, zMax = 0;
            for (let x = 0; x <= facadeLength; x += 0.5) {
                const z = solFacadeAuto.zRel(x);
                zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
            }
            deniveleDessinM = zMax - zMin;
        }
        const totalDrawingHeight = postHeight + deniveleDessinM + roofApparentHeight + 5;
        const scale = Math.min(width / (totalDrawingWidth + 4), height / (totalDrawingHeight + 4)) * 0.9;
        if (window.__dxfCapture) window.__dxfCapture.scale = scale; // enregistreur vectoriel (dossier de plans)

        const originX = -totalDrawingWidth * scale / 2;
        const groundYAtOrigin = (postHeight * scale + roofApparentHeight * scale) / 2;
        ctx.translate(originX, groundYAtOrigin);

        const getScaledGroundY = solFacadeAuto
            ? (x) => -solFacadeAuto.zRel(x / scale) * scale
            : (x) => (facadeLength > 0 ? (x / (facadeLength * scale)) * (-groundSlopeFacade * scale) : 0);
        const coteSolFacade = { echelle: scale };
        const groundPath = new Path2D();
        const groundDepth = 1.40 * scale; // Profondeur hachure de 1.40m
        // Sous l'enregistreur vectoriel (dossier de plans), sol borné à la façade ± 3 m : étendu sur 4
        // largeurs d'écran, il imposait une petite échelle (1/300 à 1/400) qui écrasait la structure.
        const startX = window.__dxfCapture ? -3 * scale : -width * 2 / viewManager.zoom;
        const endX = window.__dxfCapture ? (facadeLength + 3) * scale : width * 2 / viewManager.zoom;
        const pasSolFacade = solFacadeAuto ? 0.5 * scale : (endX - startX);
        const solPointsFacade = [];
        for (let x = startX; x < endX; x += pasSolFacade) solPointsFacade.push({ x, y: getScaledGroundY(x) });
        solPointsFacade.push({ x: endX, y: getScaledGroundY(endX) });
        solPointsFacade.forEach((q, i) => (i ? groundPath.lineTo(q.x, q.y) : groundPath.moveTo(q.x, q.y)));
        for (let i = solPointsFacade.length - 1; i >= 0; i--) groundPath.lineTo(solPointsFacade[i].x, solPointsFacade[i].y + groundDepth);
        groundPath.closePath();
        ctx.fillStyle = "#f9f9f9"; ctx.fill(groundPath);
        const patternCanvas = document.createElement('canvas'); const patternCtx = patternCanvas.getContext('2d');
        patternCanvas.width = 10; patternCanvas.height = 10;
        patternCtx.strokeStyle = '#cccccc'; patternCtx.lineWidth = 1;
        patternCtx.beginPath(); patternCtx.moveTo(0, 10); patternCtx.lineTo(10, 0); patternCtx.stroke();
        const pattern = ctx.createPattern(patternCanvas, 'repeat');
        ctx.fillStyle = pattern; ctx.fill(groundPath);
        // Exports vectoriels (dossier de plans) : le motif ci-dessus n'y a pas d'équivalent, le sol
        // sortait sans hachures — mêmes hachures en traits que la coupe (TerrainPlans.hachurer).
        if (window.__dxfCapture && window.TerrainPlans && typeof window.TerrainPlans.hachurer === 'function') {
            window.TerrainPlans.hachurer(ctx, groundPath, solPointsFacade, groundDepth, startX, endX);
        }
        ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke(groundPath);

        const postPositions = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang];
        const postWidthScaled = Math.max(postWidth * scale, 2);
        ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;

        const useRoofAlignment = alignRoof;
        // Calage de la table RIGIDE (cf. TerrainPlans.calerTable) : « Alignement toiture » coché =
        // table horizontale, sinon elle suit la pente entre le premier et le dernier poteau ; dans
        // les deux cas le poteau le plus contraint garde exactement postHeight. Sur la droite
        // manuelle, le mode pente redonne le dessin historique (poteaux tous égaux).
        const zSolFacadeM = (xM) => -getScaledGroundY(xM * scale) / scale;
        const calageFacade = (TPF && typeof TPF.calerTable === 'function')
            ? TPF.calerTable(postPositions.map((xPos) => ({ x: xPos, zSol: zSolFacadeM(xPos) })),
                             useRoofAlignment ? 'horizontal' : 'pente', 0)
            : null;
        const zTableFacadeM = calageFacade ? calageFacade.zTable : zSolFacadeM;
        postPositions.forEach(xPos => {
            const groundY = getScaledGroundY(xPos * scale);
            const postTopY = -(zTableFacadeM(xPos) + postHeight) * scale;
            const postH = groundY - postTopY;
            ctx.fillRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
            ctx.strokeRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
        });

        const roofThicknessScaled = roofApparentHeight * scale;
        const structureBottomY_at_0 = -(zTableFacadeM(0) + lowPointHeight) * scale;
        let roofBottomStartY, roofBottomEndY, roofTopStartY, roofTopEndY;
        roofBottomStartY = structureBottomY_at_0;
        if (useRoofAlignment) {
            roofBottomEndY = roofBottomStartY;
        } else {
            roofBottomEndY = -(zTableFacadeM(facadeLength) + lowPointHeight) * scale;
        }
        roofTopStartY = roofBottomStartY - roofThicknessScaled;
        roofTopEndY = roofBottomEndY - roofThicknessScaled;

        // Dessin "façade/panneaux"
        const roofPath = new Path2D();
        roofPath.moveTo(0, roofBottomStartY); roofPath.lineTo(facadeLength * scale, roofBottomEndY);
        roofPath.lineTo(facadeLength * scale, roofTopEndY); roofPath.lineTo(0, roofTopStartY);
        roofPath.closePath();
        ctx.fillStyle = 'rgba(30, 41, 59, 1)'; ctx.fill(roofPath); ctx.stroke(roofPath);

        const slopeRad = roofSlope * Math.PI / 180;
        const panneFacadeHeight = purlinHeight - (Math.sin(slopeRad) * purlinHeight);
        const panneFacadeHeightScaled = panneFacadeHeight * scale;

        const pannePath = new Path2D();
        pannePath.moveTo(0, roofBottomStartY); // Haut-gauche
        pannePath.lineTo(facadeLength * scale, roofBottomEndY); // Haut-droit
        pannePath.lineTo(facadeLength * scale, roofBottomEndY + panneFacadeHeightScaled); // Bas-droit
        pannePath.lineTo(0, roofBottomStartY + panneFacadeHeightScaled); // Bas-gauche
        pannePath.closePath();

        ctx.fillStyle = '#e5e7eb'; // Gris clair (comme pannes en coupe)
        ctx.fill(pannePath);
        ctx.strokeStyle = '#a0aec0'; // Bordure grise
        ctx.lineWidth = 1;
        ctx.stroke(pannePath);

        try {
            let rows = NaN, cols = NaN;
            const cleanedLayout = pvLayout.toLowerCase().replace(/\s/g, '');
            const parts = cleanedLayout.split('x');
            if (parts.length === 2) {
                const part1 = parts[0]; const part2 = parts[1];
                if (part1.includes('l') && part2.includes('c')) { rows = parseInt(part1); cols = parseInt(part2); }
                else if (part1.includes('c') && part2.includes('l')) { cols = parseInt(part1); rows = parseInt(part2); }
                else { [rows, cols] = parts.map(Number); }
            }
            if (!isNaN(rows) && !isNaN(cols) && rows > 0 && cols > 0) {
                const p1 = { x: 0, y: roofBottomStartY };
                const p2 = { x: facadeLength * scale, y: roofBottomEndY };
                const p4 = { x: 0, y: roofTopStartY };
                const v_width = { x: p2.x - p1.x, y: p2.y - p1.y };
                const v_height = { x: p4.x - p1.x, y: p4.y - p1.y };
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 0.5;
                for (let i = 0; i < rows; i++) {
                    for (let j = 0; j < cols; j++) {
                        const c1x = p1.x + (j / cols) * v_width.x + (i / rows) * v_height.x;
                        const c1y = p1.y + (j / cols) * v_width.y + (i / rows) * v_height.y;
                        const c2x = p1.x + ((j + 1) / cols) * v_width.x + (i / rows) * v_height.x;
                        const c2y = p1.y + ((j + 1) / cols) * v_width.y + (i / rows) * v_height.y;
                        const c3x = p1.x + ((j + 1) / cols) * v_width.x + ((i + 1) / rows) * v_height.x;
                        const c3y = p1.y + ((j + 1) / cols) * v_width.y + ((i + 1) / rows) * v_height.y;
                        const c4x = p1.x + (j / cols) * v_width.x + ((i + 1) / rows) * v_height.x;
                        const c4y = p1.y + (j / cols) * v_width.y + ((i + 1) / rows) * v_height.y;
                        ctx.beginPath();
                        ctx.moveTo(c1x, c1y); ctx.lineTo(c2x, c2y); ctx.lineTo(c3x, c3y); ctx.lineTo(c4x, c4y);
                        ctx.closePath(); ctx.stroke();
                    }
                }
            }
        } catch (e) { console.error("Format de calepinage PV invalide.", e); }

        const highestRoofPointY = Math.min(roofTopStartY, roofTopEndY);
        const dimLineY1 = highestRoofPointY - 30; const dimLineY2 = highestRoofPointY - 60;
        drawDimensionLine(ctx, 0, dimLineY1, postPositions[0] * scale, dimLineY1, `${leftOverhang.toFixed(1)}m`, 0, false);
        for (let i = 0; i < distances.length; i++) {
            drawDimensionLine(ctx, postPositions[i] * scale, dimLineY1, postPositions[i + 1] * scale, dimLineY1, `${distances[i].toFixed(2)}m`);
        }
        drawDimensionLine(ctx, postPositions[postPositions.length - 1] * scale, dimLineY1, facadeLength * scale, dimLineY1, `${rightOverhang.toFixed(1)}m`, 0, false);
        drawDimensionLine(ctx, 0, dimLineY2, facadeLength * scale, dimLineY2, `${facadeLength.toFixed(2)}m`, 0, false);

        const highPointHeightValue_Left = lowPointHeight + roofApparentHeight;
        // (hauteurs désormais mesurées sur le dessin, cf. cotations ci-dessous)

        const dimOffsetLeft = (-2) * scale;
        const dimOffsetRight = facadeLength * scale + (2) * scale;

        drawVerticalDimensionWithLeader(ctx, 0, roofTopStartY, dimOffsetLeft, null, getScaledGroundY, coteSolFacade);
        drawVerticalDimensionWithLeader(ctx, facadeLength * scale, roofTopEndY, dimOffsetRight, null, getScaledGroundY, coteSolFacade);

        const altimetryLeft = solFacadeAuto ? solFacadeAuto.zAbs(0) : baseAltimetry;
        const deniveleDroite = solFacadeAuto ? solFacadeAuto.zRel(facadeLength) : groundSlopeFacade;
        const altimetryRight = altimetryLeft + deniveleDroite;
        const uniteAltFacade = (solFacadeAuto && TPF.altitudesNGF && !TPF.altitudesNGF()) ? 'm (alt. approx.)' : 'm (NGF)';
        const groundRefPoints = [{ x: 0, refText: `+0.00m`, altText: `${altimetryLeft.toFixed(2)}${uniteAltFacade}` }, { x: facadeLength * scale, refText: `${deniveleDroite.toFixed(2)}m`, altText: `${altimetryRight.toFixed(2)}${uniteAltFacade}` }];
        groundRefPoints.forEach(point => {
            const y = getScaledGroundY(point.x);
            ctx.save(); ctx.fillStyle = appState.dimensionColor; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom'; ctx.fillText(point.refText, point.x, y - 4);
            ctx.textBaseline = 'top'; ctx.font = '12px Arial'; ctx.fillText(point.altText, point.x, y + 4);
            ctx.strokeStyle = appState.dimensionColor; ctx.lineWidth = 1.5; const crossSize = 4;
            ctx.beginPath(); ctx.moveTo(point.x - crossSize, y); ctx.lineTo(point.x + crossSize, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(point.x, y - crossSize); ctx.lineTo(point.x, y + crossSize); ctx.stroke();
            ctx.restore();
        });
        ctx.restore();

        // Return boundary box for PDF cropping (in meters/drawing units)
        const marginMeters = 1.0;
        const postMinX = -leftOverhang - postWidth / 2;
        const postMaxX = facadeLength + rightOverhang + postWidth / 2;
        const maxHeight = values.postHeight + roofApparentHeight + 1.0;
        const minHeight = -postHeight - deniveleDessinM - 1.0;

        return {
            minX: postMinX - marginMeters,
            maxX: postMaxX + marginMeters,
            minY: -maxHeight - marginMeters, // Max Y (haut du dessin)
            maxY: 1.0 + deniveleDessinM + marginMeters // Min Y (bas du dessin)
        };
    }

    function drawImplantation(canvas, ctx, viewManager, values) {
        // MOD 6.5: Récupération de totalProjectionWidth
        const { facadeLength, panelWidth, roofSlope, leftOverhang, rightOverhang, postWidth, postEccentricity, totalProjectionWidth } = values;
        const distances = appState.parsedDistances;
        if (!distances) return;

        const { width, height } = setupCanvas(canvas);
        if (width === 0 || height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);

        // MOD 6.5: Utilisation de totalProjectionWidth
        const projectionWidth = totalProjectionWidth;
        const absRoofSlopeRad = Math.abs(roofSlope * Math.PI / 180);

        const scale = Math.min(width / (facadeLength + 2), height / (projectionWidth + 2)) * 0.9;

        ctx.translate(-facadeLength * scale / 2, -projectionWidth * scale / 2);

        // MOD 6.5: Dessin de l'implantation pour Y
        if (appState.postModel === 'y_shape') {
            // CORRECTIF (cohérence Toiture Y / Bipente) : values.panelWidth représente déjà un bras.
            const projWidthOneSide = (values.panelWidth * Math.cos(absRoofSlopeRad)) * scale;
            const postWidthScaled = values.postWidth * scale;

            ctx.strokeStyle = '#374151'; ctx.lineWidth = 3;
            // Dessiner la section de gauche (haut)
            ctx.strokeRect(0, 0, facadeLength * scale, projWidthOneSide);
            // Dessiner la section de droite (bas)
            ctx.strokeRect(0, projWidthOneSide + postWidthScaled, facadeLength * scale, projWidthOneSide);

        } else {
            // Dessin standard pour les autres modèles
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 3;
            ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale);
        }

        const midY = projectionWidth * scale / 2;
        const postPositions = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang];

        ctx.save(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        const axisExtension = 80;

        if (appState.postModel === 'double' || appState.postModel === 'inclinedPost') {
            const spacing = (appState.postModel === 'double' ? values.postSpacing : values.postSpacingInclined) * scale / 2;
            ctx.beginPath(); ctx.moveTo(-axisExtension, midY - spacing); ctx.lineTo(facadeLength * scale + axisExtension, midY - spacing); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-axisExtension, midY + spacing); ctx.lineTo(facadeLength * scale + axisExtension, midY + spacing); ctx.stroke();
        } else if (appState.postModel === 'offset') {
            const eccentricityScaled = values.postEccentricity * scale; // Utilise valeur clampée
            ctx.beginPath(); ctx.moveTo(-axisExtension, midY + eccentricityScaled); ctx.lineTo(facadeLength * scale + axisExtension, midY + eccentricityScaled); ctx.stroke();
        } else { // Single et Y
            ctx.beginPath(); ctx.moveTo(-axisExtension, midY); ctx.lineTo(facadeLength * scale + axisExtension, midY); ctx.stroke();
        }

        postPositions.forEach(xPos => { ctx.beginPath(); ctx.moveTo(xPos * scale, -axisExtension); ctx.lineTo(xPos * scale, projectionWidth * scale + axisExtension); ctx.stroke(); });
        ctx.restore();

        const postSize = postWidth * scale; ctx.fillStyle = '#6b7280';
        postPositions.forEach(xPos => {
            if (appState.postModel === 'double' || appState.postModel === 'inclinedPost') {
                const spacing = (appState.postModel === 'double' ? values.postSpacing : values.postSpacingInclined) * scale / 2;
                ctx.fillRect(xPos * scale - postSize / 2, midY - spacing - postSize / 2, postSize, postSize);
                ctx.fillRect(xPos * scale - postSize / 2, midY + spacing - postSize / 2, postSize, postSize);
            } else if (appState.postModel === 'offset') {
                const eccentricityScaled = values.postEccentricity * scale; // Utilise valeur clampée
                ctx.fillRect(xPos * scale - postSize / 2, midY + eccentricityScaled - postSize / 2, postSize, postSize);
            } else { // Single et Y
                ctx.fillRect(xPos * scale - postSize / 2, midY - postSize / 2, postSize, postSize);
            }
        });
        if (appState.postModel === 'double' || appState.postModel === 'inclinedPost' || (appState.postModel === 'offset' && postEccentricity !== 0)) {
            const firstPostX = postPositions[0] * scale;
            const dimOffset = -30 - postSize;
            if (appState.postModel === 'double' || appState.postModel === 'inclinedPost') {
                const spacingValue = (appState.postModel === 'double' ? values.postSpacing : values.postSpacingInclined);
                const spacing = spacingValue * scale;
                drawDimensionLine(ctx, firstPostX, midY - spacing / 2, firstPostX, midY + spacing / 2, `${spacingValue.toFixed(2)}m`, dimOffset, true);
            }
            if (appState.postModel === 'offset' && postEccentricity !== 0) {
                const eccentricityScaled = values.postEccentricity * scale; // Utilise valeur clampée
                drawDimensionLine(ctx, firstPostX, midY, firstPostX, midY + eccentricityScaled, `${values.postEccentricity.toFixed(2)}m`, dimOffset, true);
            }
        }
        drawDimensionLine(ctx, 0, 0, facadeLength * scale, 0, `${facadeLength.toFixed(2)}m`, -30, false);
        const interPostDimY = projectionWidth * scale + 30;
        drawDimensionLine(ctx, 0, interPostDimY, leftOverhang * scale, interPostDimY, `${leftOverhang.toFixed(2)}m`, 0, false);
        drawDimensionLine(ctx, (facadeLength - rightOverhang) * scale, interPostDimY, facadeLength * scale, interPostDimY, `${rightOverhang.toFixed(2)}m`, 0, false);
        for (let i = 0; i < postPositions.length - 1; i++) { drawDimensionLine(ctx, postPositions[i] * scale, interPostDimY, postPositions[i + 1] * scale, interPostDimY, `${distances[i].toFixed(2)}m`); }

        // MOD 6.5: Cotation de la projection horizontale totale (11.75m ou similaire)
        drawDimensionLine(ctx, facadeLength * scale, 0, facadeLength * scale, projectionWidth * scale, `${projectionWidth.toFixed(2)}m`, 30, true);
        ctx.restore();

        // Return boundary box for PDF cropping (in meters/drawing units)
        const marginMeters = 1.0;
        return {
            minX: -marginMeters,
            maxX: facadeLength + marginMeters,
            minY: -marginMeters,
            maxY: projectionWidth + marginMeters
        };
    }

    // --- LOGIC & EVENT HANDLERS ---
    function getFormValues() {
        const values = {};
        document.querySelectorAll('.all-inputs').forEach(el => {
            if (!el.id) return;
            let val = (el.type === 'checkbox') ? el.checked : el.value;
            if (el.type === 'number' && !el.readOnly) val = parseFloat(val) || 0;
            values[el.id] = val;
        });
        document.querySelectorAll('.project-inputs').forEach(el => {
            if (!el.id) return;
            values[el.id] = el.value;
        });
        return values;
    }

    let lastFormValuesStr = "";
    let currentCalculatedValues = null;

    // --- LOCAL CALCULATION LOGIC (MIGRÉ DEPUIS PYTHON) ---
    function safeFloat(val, defaultVal = 0.0) {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? defaultVal : parsed;
    }

    function parsePostDistances(expression, facadeLength, leftOverhang, rightOverhang) {
        let error = "";
        let distances = [];
        let positions_x = [];
        let warning = "";

        if (!expression || expression.trim() === "") {
            expression = "3*10 + 7.50";
        }

        try {
            const segments = expression.replace(/,/g, "+").split("+");
            for (let seg of segments) {
                seg = seg.trim();
                if (seg === "") continue;
                if (seg.includes("*")) {
                    const parts = seg.split("*");
                    if (parts.length !== 2) throw new Error(`Format invalide: "${seg}"`);
                    const count = parseInt(parts[0].trim(), 10);
                    const value = parseFloat(parts[1].trim());
                    if (isNaN(count) || isNaN(value) || count < 0) throw new Error(`Valeurs invalides: "${seg}"`);
                    if (value < 5 || value > 15) throw new Error(`Entraxe invalide "${value}" : doit être compris entre 5 et 15 m`);
                    for (let i = 0; i < count; i++) distances.push(value);
                } else {
                    const val = parseFloat(seg);
                    if (isNaN(val)) throw new Error(`Valeur non numérique: "${seg}"`);
                    if (val < 5 || val > 15) throw new Error(`Entraxe invalide "${val}" : doit être compris entre 5 et 15 m`);
                    distances.push(val);
                }
            }
        } catch (e) {
            return { distances: [], positions_x: [], error: e.message, warning: "", right_overhang: rightOverhang };
        }

        const totalDistance = distances.reduce((a, b) => a + b, 0);
        const calculatedLength = leftOverhang + totalDistance + rightOverhang;
        let newRightOverhang = rightOverhang;

        if (Math.abs(calculatedLength - facadeLength) > 0.01) {
            newRightOverhang = facadeLength - leftOverhang - totalDistance;
            warning = `Attention : Somme entraxes (${totalDistance.toFixed(2)}m) + p-à-f (${leftOverhang.toFixed(2)}m + ${rightOverhang.toFixed(2)}m) = ${calculatedLength.toFixed(2)}m ≠ longueur totale (${facadeLength.toFixed(2)}m). Le porte-à-faux droit a été ajusté à ${newRightOverhang.toFixed(2)}m.`;
        }

        let current_x = leftOverhang;
        positions_x.push(current_x);
        for (let d of distances) {
            current_x += d;
            positions_x.push(current_x);
        }

        return { distances, positions_x, error, warning, right_overhang: newRightOverhang };
    }

    /* ================================================================================ */
    /* ====   ALGORITHME DE CALCUL AUTOMATIQUE DE L'IMPLANTATION DES POTEAUX (V2)   ==== */
    /* ================================================================================ */
    /*
     * Détermine automatiquement le nombre de poteaux et leur entraxe le long de la
     * façade, à partir de la longueur totale de façade et du porte-à-faux gauche
     * (saisis par l'utilisateur). Règles métier strictes :
     *   - Porte-à-faux gauche (fixe, saisi) ET porte-à-faux droit (résultat calculé)
     *     doivent rester compris entre 0 et 3 m.
     *   - Seuls les entraxes de 10 m, 7.5 m et 5 m sont autorisés.
     *   - PRIORITÉ ABSOLUE : on maximise d'abord le nombre d'entraxes de 10 m, puis
     *     (seulement à défaut) de 7.5 m, puis (seulement à défaut) de 5 m.
     *
     * Exemple : façade = 53 m, porte-à-faux gauche = 1 m => il reste 52 m à couvrir ;
     * 5 entraxes de 10 m (= 50 m) + porte-à-faux droit de 2 m = 52 m. (1 + 2 + 50 = 53)
     *
     * Le résultat de cet algorithme alimente le champ existant "Entraxes poteaux"
     * (#postDistances, ex: "5*10"), qui est ensuite interprété tel quel par la fonction
     * parsePostDistances() ci-dessus (déjà utilisée pour dessiner dynamiquement les
     * poteaux sur la façade et l'implantation, et pour ajuster le porte-à-faux droit
     * affiché) : aucune modification du pipeline de dessin n'est nécessaire.
     */
    function computeOptimalPostLayout(facadeLength, leftOverhang) {
        const EPS = 1e-6;
        const target = facadeLength - leftOverhang; // Longueur restant à couvrir par les entraxes + le PF droit
        if (target < -EPS) {
            return { feasible: false, n10: 0, n75: 0, n5: 0, rightOverhang: 0 };
        }

        // Recherche prioritaire : nombre MAX d'entraxes 10 m, puis (à défaut) MAX de 7.5 m,
        // puis (à défaut) MAX de 5 m, tel que le porte-à-faux droit résultant reste dans [0, 3] m.
        const maxN10 = Math.max(0, Math.floor((target + EPS) / 10));
        for (let n10 = maxN10; n10 >= 0; n10--) {
            const remAfter10 = target - n10 * 10;
            const maxN75 = Math.max(0, Math.floor((remAfter10 + EPS) / 7.5));
            for (let n75 = maxN75; n75 >= 0; n75--) {
                const remAfter75 = remAfter10 - n75 * 7.5;
                const n5 = Math.max(0, Math.floor((remAfter75 + EPS) / 5));
                const rightOverhang = remAfter75 - n5 * 5;
                if (rightOverhang >= -EPS && rightOverhang <= 3 + EPS) {
                    return { feasible: true, n10, n75, n5, rightOverhang: Math.max(0, rightOverhang) };
                }
            }
        }

        // Repli (cas extrêmes, ex: façade très courte) : remplissage glouton standard
        // (10 puis 7.5 puis 5) sans garantie que le porte-à-faux droit reste dans [0, 3] m ;
        // l'anomalie sera alors signalée par la validation existante du champ rightOverhang.
        let n10 = maxN10, rem = target - n10 * 10;
        let n75 = Math.floor((rem + EPS) / 7.5); rem -= n75 * 7.5;
        let n5 = Math.floor((rem + EPS) / 5); rem -= n5 * 5;
        return { feasible: false, n10, n75, n5, rightOverhang: Math.max(0, rem) };
    }

    // Construit l'expression "Entraxes poteaux" (ex: "5*10" ou "4*10 + 1*7.5 + 1*5") à partir
    // du résultat de computeOptimalPostLayout, dans l'ordre décroissant 10 > 7.5 > 5.
    function formatPostDistancesExpr(layout) {
        const parts = [];
        if (layout.n10 > 0) parts.push(`${layout.n10}*10`);
        if (layout.n75 > 0) parts.push(`${layout.n75}*7.5`);
        if (layout.n5 > 0) parts.push(`${layout.n5}*5`);
        return parts.length ? parts.join(' + ') : '1*5';
    }

    // Recalcule et remplit automatiquement le champ "Entraxes poteaux" avec l'entraxe optimal,
    // SAUF si l'utilisateur a lui-même déjà modifié ce champ (il reste alors éditable et sous
    // son contrôle, conformément à la consigne : le champ ne doit jamais écraser une saisie
    // manuelle en cours).
    function autoFillOptimalEntraxe() {
        if (userEditedPostDistances) return;
        const postDistancesInput = document.getElementById('postDistances');
        const facadeLengthInput = document.getElementById('facadeLength');
        const leftOverhangInput = document.getElementById('leftOverhang');
        if (!postDistancesInput || !facadeLengthInput || !leftOverhangInput) return;

        const facadeLength = parseFloat(facadeLengthInput.value) || 0;
        const leftOverhang = parseFloat(leftOverhangInput.value) || 0;
        const layout = computeOptimalPostLayout(facadeLength, leftOverhang);
        const expr = formatPostDistancesExpr(layout);

        if (postDistancesInput.value !== expr) {
            isAutoFillingPostDistances = true;
            postDistancesInput.value = expr;
            isAutoFillingPostDistances = false;
        }
    }
    /* ================================================================================ */
    /* ====================   FIN ALGORITHME AUTOMATIQUE POTEAUX   ==================== */
    /* ================================================================================ */

    function calculateOmbriereMetalLocal(data) {
        const postModel = data.post_model || "single";
        const traversePosition = data.traverse_position || "top";
        const overhangType = data.overhang_type || "sym";
        let invertSlope = !!data.invert_slope;
        const offsetPostSide = data.offset_post_side || "center";

        let lowPointHeightInput = safeFloat(data.low_point_height);
        let beamHeight = safeFloat(data.beam_height);
        let purlinHeight = safeFloat(data.purlin_height);
        let integrationSystemHeight = safeFloat(data.integration_system_height);
        let panelThickness = safeFloat(data.panel_thickness);
        let panelWidth = safeFloat(data.panel_width);
        let roofSlope = safeFloat(data.roof_slope);
        let overhangSymValue = safeFloat(data.overhang_sym_value);
        let overhangAsymHigh = safeFloat(data.overhang_asym_high);
        let overhangAsymLow = safeFloat(data.overhang_asym_low);
        let postEccentricity = safeFloat(data.post_eccentricity);
        let postWidth = safeFloat(data.post_width);
        let facadeLength = safeFloat(data.facade_length);
        let leftOverhang = safeFloat(data.left_overhang);
        let rightOverhang = safeFloat(data.right_overhang);

        let overhangH, overhangL;
        if (overhangType === "sym" || postModel === "y_shape" || postModel === "doubleYShape") {
            overhangH = overhangL = overhangSymValue;
        } else {
            overhangH = overhangAsymHigh;
            overhangL = overhangAsymLow;
        }

        // Hauteur libre de passage = hauteur bas structure (saisie utilisateur) - épaisseur (traverse+panne+
        // système d'intégration+panneau) + porte-à-faux bas/égout x sin(pente). La hauteur bas structure est
        // désormais la donnée d'entrée (l'utilisateur la saisit directement) ; la hauteur libre de passage en
        // est déduite (relation fournie par l'utilisateur).
        // CORRECTIF (bug rapporté : 3,00 m saisis -> 2,98 m cotés sur le plan, pente 15°) : l'empilement
        // est dessiné PERPENDICULAIREMENT à la pente (cf. drawStandardDimensions : panelCorners tournés
        // de l'angle), sa hauteur verticale vaut donc empilement x cos(pente) et non l'empilement brut.
        // Avec l'ancienne formule, le point bas coté perdait empilement x (1 - cos(pente)) — 2 cm pour
        // 0,58 m à 15°. Désormais la cote du point bas redonne exactement la valeur saisie.
        const lowPointThicknessStack = beamHeight + purlinHeight + integrationSystemHeight + panelThickness;
        const roofSlopeRadAbs = roofSlope * Math.PI / 180;
        let passageHeight = lowPointHeightInput - lowPointThicknessStack * Math.cos(roofSlopeRadAbs) + overhangL * Math.sin(roofSlopeRadAbs);

        // CORRECTIF (cohérence Toiture Y / Bipente, demande explicite) : panelWidth représente désormais
        // directement la largeur d'un bras (calepinage Bipente symétrique, PV1.1 déjà à cette largeur) —
        // ne plus diviser par 2 ici. Calcul structurel central de la longueur de traverse.
        let beamLength = (postModel === "y_shape" || postModel === "doubleYShape") ? (panelWidth - overhangSymValue) : (panelWidth - overhangH - overhangL);

        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth déjà un bras pour y_shape/doubleYShape
        // (valeur exposée dans max_eccentricity, cf. retour de cette fonction, même si postEccentricity
        // est par ailleurs forcé à 0 pour ces modèles — cf. plus bas).
        let maxEccentricity = ((postModel === "y_shape" || postModel === "doubleYShape") ? panelWidth : panelWidth / 2) * Math.cos(roofSlope * Math.PI / 180);
        let eccentricityError = "";

        if (postModel === "offset") {
            let offsetVal = safeFloat(data.post_eccentricity, 2.0);
            let isLow = (offsetPostSide === "low");
            // postEccentricity est ajouté à basePostX (= ±(panelWidth/2)*cos(pente), le bord du panneau déjà
            // projeté horizontalement — cf. drawThePosts/drawReinforcement/drawStandardDimensions). Il doit
            // donc représenter uniquement le déplacement vers l'intérieur depuis ce bord (= offsetVal, avec le
            // signe qui ramène vers le centre), et non un second bord recalculé à partir de beamLength/2 :
            // l'ancienne formule mélangeait bord du panneau (basePostX) et demi-longueur de traverse
            // (beamLength/2 ≠ panelWidth/2 dès qu'il y a un porte-à-faux), ce qui pouvait placer le poteau
            // en dehors de la traverse.
            postEccentricity = (invertSlope ? isLow : !isLow) ? -offsetVal : offsetVal;

            let minLimit, maxLimit;
            if (offsetPostSide === "low") {
                minLimit = overhangL;
                maxLimit = panelWidth - overhangH;
            } else {
                minLimit = overhangH;
                maxLimit = panelWidth - overhangL;
            }
            if (offsetVal < minLimit || offsetVal > maxLimit) {
                eccentricityError = `Erreur: Poteau hors traverse ! (Limites: ${minLimit.toFixed(2)}m - ${maxLimit.toFixed(2)}m)`;
            }
            maxEccentricity = 9999;
        } else if (postModel === "double") {
            postEccentricity = 0;
            maxEccentricity = 9999;
        } else if (postModel === "y_shape" || postModel === "doubleYShape") {
            postEccentricity = 0;
        } else if (postModel === "inclinedPost") {
            postEccentricity = 0;
            maxEccentricity = 9999;
        }

        if (Math.abs(postEccentricity) > maxEccentricity && postModel === "single") {
            eccentricityError = `(Limite auto: ±${maxEccentricity.toFixed(2)}m)`;
            postEccentricity = Math.sign(postEccentricity) * maxEccentricity;
        }

        let roofSlopeRadians = roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1);
        let newPostHeight = 0.0, beamCenterY = 0.0;

        if (postModel === "y_shape" || postModel === "doubleYShape") {
            let yLowestBeamPointRel = ((beamLength / 2) * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
            beamCenterY = (-passageHeight - yLowestBeamPointRel);
            newPostHeight = -(beamCenterY - (beamHeight / 2) * Math.cos(roofSlopeRadians));
        } else {
            let yLowestBeamPointRel = ((beamLength / 2) * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
            if (traversePosition === 'side') {
                beamCenterY = -passageHeight - yLowestBeamPointRel + beamHeight / 2;
                newPostHeight = -beamCenterY + beamHeight / 2;
            } else {
                beamCenterY = -passageHeight - yLowestBeamPointRel;
                newPostHeight = -(beamCenterY + beamHeight / 2);
            }
        }

        // CORRECTIF (cohérence Toiture Y / Bipente) : demi-largeur "un bras" pour y_shape/doubleYShape
        // (panelWidth déjà un bras), demi-largeur classique pour les autres modèles (panelWidth
        // toujours total) — high_point_height (retourné plus bas) en dépend pour tous les modèles.
        let halfPanelForY = (postModel === "y_shape" || postModel === "doubleYShape") ? panelWidth : panelWidth / 2;
        let y1 = (-halfPanelForY) * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);
        let y2 = halfPanelForY * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);

        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth = largeur d'UN bras désormais (au lieu
        // de la largeur totale monopente d'avant) — la projection totale (les deux bras + le poteau)
        // doit donc désormais compter panelWidth deux fois (×2), pas une seule.
        let totalProjectionWidth = (postModel === "y_shape" || postModel === "doubleYShape") ? ((panelWidth * 2) * Math.cos(Math.abs(roofSlopeRadians))) + postWidth : panelWidth * Math.cos(Math.abs(roofSlopeRadians));
        // Modèle "linked" : l'entraxe doit pouvoir dépasser la largeur d'une ombrière (poteaux non partagés sous le même panneau),
        // donc pas de plafonnement à (totalProjectionWidth - postWidth) comme pour le double poteau.
        // Modèle "doubleYShape" : étape de diagnostic — entraxe redevenu un champ libre (comme "linked")
        // pour vérifier que le déplacement de la 2e ombrière répond bien à ce champ. Pas de plafonnement,
        // l'entraxe doit pouvoir dépasser la largeur d'une ombrière.
        let postSpacing;
        if (postModel === "doubleYShape") {
            postSpacing = safeFloat(data.post_spacing, 12.58);
        } else if (postModel === "linked") {
            postSpacing = safeFloat(data.post_spacing, 15.0);
        } else {
            postSpacing = Math.min(safeFloat(data.post_spacing, 5.0), Math.max(0.0, totalProjectionWidth - postWidth));
        }
        let postSpacingInclined = Math.min(safeFloat(data.post_spacing_inclined, 6.0), Math.max(0.0, totalProjectionWidth - postWidth));

        let distResult = parsePostDistances(data.post_distances_expr, facadeLength, leftOverhang, rightOverhang);

        return {
            ...data,
            low_point_height: lowPointHeightInput,
            passage_height: passageHeight,
            post_height: newPostHeight,
            high_point_height: -(beamCenterY + Math.min(y1, y2)),
            beam_length: beamLength,
            overhang_h: overhangH,
            overhang_l: overhangL,
            total_projection_width: totalProjectionWidth,
            post_eccentricity_clamped: postEccentricity,
            max_eccentricity: maxEccentricity,
            eccentricity_error: eccentricityError,
            post_distances: distResult.distances,
            post_positions_x: distResult.positions_x,
            post_distances_error: distResult.error,
            post_distances_warning: distResult.warning,
            right_overhang: distResult.right_overhang !== undefined ? distResult.right_overhang : rightOverhang,
            post_spacing: postSpacing,
            post_spacing_inclined: postSpacingInclined
        };
    }

    async function updateAppLogic() {
        let values = getFormValues();
        // Valeur brute saisie par l'utilisateur pour l'entraxe, capturée avant que calculateOmbriereMetalLocal
        // ne la plafonne silencieusement (cf. bloc "Sécurité anti-chevauchement" plus bas, modèle "double").
        const rawPostSpacingInput = parseFloat(document.getElementById('postSpacing') ? document.getElementById('postSpacing').value : NaN);
        // Le cache doit aussi dépendre des champs d'appState réellement passés à calculateOmbriereMetalLocal :
        // changer de modèle (ex: "Toiture Y" -> "Double toiture Y") ne modifie pas forcément un champ du
        // formulaire (postEccentricity/postInclinationInclined peuvent déjà avoir la même valeur), auquel cas
        // l'ancien code renvoyait à tort les valeurs calculées du modèle précédent (ex: un entraxe périmé).
        let currentValuesStr = JSON.stringify(values) + JSON.stringify({
            postModel: appState.postModel,
            traversePosition: appState.traversePosition,
            overhangType: appState.overhangType,
            invertSlope: appState.invertSlope,
            offsetPostSide: appState.offsetPostSide,
            reinforcementType: appState.reinforcementType,
            doublePostBracing: appState.doublePostBracing,
            showDoubleBracing: appState.showDoubleBracing,
        });

        if (currentValuesStr === lastFormValuesStr && currentCalculatedValues) {
            return currentCalculatedValues;
        }
        lastFormValuesStr = currentValuesStr;

        // Appel API pour tous les calculs
        let _r;
        try {
            _r = calculateOmbriereMetalLocal({
                post_model:               appState.postModel,
                traverse_position:        appState.traversePosition,
                overhang_type:            appState.overhangType,
                invert_slope:             appState.invertSlope,
                offset_post_side:         appState.offsetPostSide,
                reinforcement_type:       appState.reinforcementType,
                double_post_bracing:      appState.doublePostBracing,
                show_double_bracing:      appState.showDoubleBracing,
                low_point_height:         values.lowPointHeight,
                beam_height:              values.beamHeight,
                purlin_height:            values.purlinHeight,
                integration_system_height:values.integrationSystemHeight,
                panel_thickness:          values.panelThickness,
                panel_width:              values.panelWidth,
                roof_slope:               values.roofSlope,
                overhang_sym_value:       values.overhangSymValue,
                overhang_asym_high:       values.overhangAsymHigh,
                overhang_asym_low:        values.overhangAsymLow,
                post_eccentricity:        values.postEccentricity,
                post_width:               values.postWidth,
                post_spacing:             values.postSpacing,
                post_spacing_inclined:    values.postSpacingInclined,
                post_inclination_inclined:values.postInclinationInclined,
                height_under_brace:       values.heightUnderBrace,
                brace_fix_percentage:     values.braceFixPercentage,
                purlin_count:             values.purlinCount,
                facade_length:            values.facadeLength,
                left_overhang:            values.leftOverhang,
                right_overhang:           values.rightOverhang,
                ground_slope_facade:      values.groundSlopeFacade,
                base_altimetry:           values.baseAltimetry,
                post_distances_expr:      values.postDistances || '',
                align_roof:               values.alignRoof,
                pv_layout:                values.pvLayout,
            });

            // Réinitialiser le message d'erreur si tout est OK
            const errorDiv = document.getElementById('validationError');
            if (errorDiv) errorDiv.textContent = '';

        } catch (_e) {
            console.error('Erreur API ombriere/calculate:', _e);
            // Définition de valeurs de secours pour éviter le plantage du dessin
            // si le backend Python n'est pas allumé ou injoignable
            values.lowPointHeight = parseFloat(values.lowPointHeight) || 0;
            values.passageHeight = parseFloat(values.passageHeight) || 0;
            values.postHeight = parseFloat(values.postHeight) || 0;
            values.beamLength = values.panelWidth || 0;
            values.totalProjectionWidth = values.panelWidth || 0;
            values.overhangH = values.overhangSymValue || 0;
            values.overhangL = values.overhangSymValue || 0;
            currentCalculatedValues = values;
            return values;
        }

        // Mise à jour des champs readonly dans le DOM (seulement si succès)
        // "Hauteur bas structure" (lowPointHeight) est maintenant une saisie utilisateur : on ne réécrit
        // pas sa valeur DOM pour ne pas perturber la frappe, on garde juste values.lowPointHeight en nombre.
        values.lowPointHeight = _r.low_point_height;

        document.getElementById('passageHeight').value = _r.passage_height.toFixed(2);
        values.passageHeight = _r.passage_height;
        if (typeof validateHeightUnderBrace === 'function') validateHeightUnderBrace();

        document.getElementById('postHeight').value = _r.post_height.toFixed(2);
        values.postHeight = _r.post_height;

        // Mise à jour erreur excentrement
        const _eccErr = document.getElementById('postEccentricityError');
        if (_eccErr) _eccErr.textContent = _r.eccentricity_error || '';

        // Clamp eccentricity si offset
        if (appState.postModel === 'offset') {
            values.postEccentricity = _r.post_eccentricity_clamped;
        }

        // Résultats géométriques
        values.beamLength           = _r.beam_length;
        values.totalProjectionWidth = _r.total_projection_width;
        values.overhangH            = _r.overhang_h;
        values.overhangL            = _r.overhang_l;

        values.heightUnderBrace = parseFloat(document.getElementById('heightUnderBrace').value);

        // Parse des distances (validé côté backend)
        const _distErr = document.getElementById('postDistancesError');
        if (_distErr) _distErr.innerHTML = _r.post_distances_warning || _r.post_distances_error || '';
        appState.parsedDistances = _r.post_distances || [];
        appState.postPositionsX = _r.post_positions_x || [];

        // Plafonnement interne de l'entraxe pour la sécurité du dessin (posteaux qui ne doivent pas sortir
        // de la traverse) : ne touche jamais au champ affiché, seulement à la valeur utilisée en interne
        // pour les calculs géométriques — la saisie de l'utilisateur n'est jamais modifiée (cf. modal de
        // rejet plus bas, qui l'avertit sans corriger le champ à sa place).
        if (_r.post_spacing !== undefined) {
            values.postSpacing = _r.post_spacing;
        }
        if (_r.post_spacing_inclined !== undefined) {
            values.postSpacingInclined = _r.post_spacing_inclined;
            const psiInput = document.getElementById('postSpacingInclined');
            if (psiInput && parseFloat(psiInput.value) !== _r.post_spacing_inclined) psiInput.value = _r.post_spacing_inclined.toFixed(2);
        }

        // MOD : Ajustement dynamique du porte-à-faux droit
        if (_r.right_overhang !== undefined) {
            values.rightOverhang = _r.right_overhang;
            const roInput = document.getElementById('rightOverhang');
            if (roInput && Math.abs(parseFloat(roInput.value) - _r.right_overhang) > 0.01) {
                roInput.value = _r.right_overhang.toFixed(2);
            }
        }

        // Sécurité anti-chevauchement pour le modèle "Poteaux centrés liaisonnés" :
        // l'entraxe doit être strictement supérieur à la largeur projetée d'une ombrière.
        const entraxeErrorDiv = document.getElementById('entraxeError');
        if (appState.postModel === 'linked' && typeof validateLinkedSpacing === 'function') {
            const spacingCheck = validateLinkedSpacing(values);
            if (entraxeErrorDiv) entraxeErrorDiv.textContent = spacingCheck.message;
            if (!spacingCheck.valid) {
                // Valeur interne (dessin) uniquement : le champ affiché garde la saisie de l'utilisateur.
                values.postSpacing = spacingCheck.minSpacing + 0.01;
            }
        } else if (appState.postModel === 'double') {
            // L'entraxe doit rester dans la plage possible compte tenu de la longueur de traverse (les 2
            // poteaux ne peuvent pas sortir de la largeur projetée du panneau, moins la largeur du poteau).
            const maxDoubleSpacing = Math.max(0, values.totalProjectionWidth - values.postWidth);
            if (!isNaN(rawPostSpacingInput) && rawPostSpacingInput > maxDoubleSpacing + 0.001) {
                if (entraxeErrorDiv) entraxeErrorDiv.textContent = `Entraxe invalide : ${rawPostSpacingInput.toFixed(2)} m dépasse la plage possible (max ${maxDoubleSpacing.toFixed(2)} m compte tenu de la longueur de traverse).`;
            } else if (entraxeErrorDiv) {
                entraxeErrorDiv.textContent = '';
            }
        } else if (entraxeErrorDiv) {
            entraxeErrorDiv.textContent = '';
        }

        currentCalculatedValues = values;
        return values;
    }

    async function runAllDrawings() {
        // Analyse de la saisie AVANT tout dessin : si un champ est hors intervalle (ou incohérent avec
        // la géométrie actuelle), on rejette catégoriquement et on ne dessine rien — le dernier dessin
        // valide reste affiché tel quel tant que l'utilisateur n'a pas corrigé sa saisie.
        const violation = (typeof getFieldRangeViolation === 'function') ? getFieldRangeViolation() : null;
        if (violation) {
            // CORRECTIF (modal de validation qui semble ne jamais se fermer) : runAllDrawings() est
            // déclenché depuis une trentaine de points différents (scheduleUpdate), y compris un
            // écouteur postMessage 'CALEPINAGE_UPDATE' qui rappelle scheduleUpdate() à chaque message
            // reçu de l'iframe de calepinage, sans condition. Tant que le champ en violation garde
            // exactement la même valeur, cliquer sur OK ne le corrige pas — un de ces déclenchements
            // en arrière-plan pouvait donc rouvrir le modal une fraction de seconde après sa fermeture,
            // donnant l'impression qu'il ne se fermait jamais. On ne réaffiche donc le modal que si la
            // violation (champ + valeur) diffère de la dernière déjà acquittée par l'utilisateur.
            const violationKey = `${violation.el.id}::${violation.el.value}`;
            if (violationKey !== lastAcknowledgedViolationKey) {
                showFieldViolationModal(violation, violationKey);
            }
            return;
        }
        // Une fois un dessin valide effectué, on oublie l'acquittement précédent : si l'utilisateur
        // ressaisit plus tard exactement la même valeur invalide, l'avertissement doit réapparaître.
        lastAcknowledgedViolationKey = null;
        const calculatedValues = await updateAppLogic();
        coupeViewManager.draw(calculatedValues);
        facadeViewManager.draw(calculatedValues);
        implantationViewManager.draw(calculatedValues);

        // Sauvegarde automatique des canvas dans localStorage pour l'export PDF
        try {
            const _toB64 = (canvasId) => {
            const c = document.getElementById(canvasId);
            if (!c || c.width === 0 || c.height === 0) return null;
            const tmp = document.createElement('canvas');
            tmp.width = c.width; tmp.height = c.height;
            const ctx = tmp.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tmp.width, tmp.height);
            ctx.drawImage(c, 0, 0);
            return tmp.toDataURL('image/jpeg', 0.85);
            };
            const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';
            const existing = (() => {
            try { return JSON.parse(localStorage.getItem('geometriePlansData') || '{}'); }
            catch(e) { return {}; }
            })();
            // Écraser seulement ce PV, préserver les autres
            existing[pvId] = {
            coupe:        _toB64('coupeCanvas'),
            facade:       _toB64('facadeCanvas'),
            implantation: _toB64('implantationCanvas'),
            ombriereType: 'métal',         // ← 'bois' dans ombriere_bois.js, 'solumbra' dans ombriere_solumbra.js
            savedAt: new Date().toISOString()
            };
            existing.savedAt = new Date().toISOString();
            localStorage.setItem('geometriePlansData', JSON.stringify(existing));
        } catch(e) { console.warn('[Metal] Sauvegarde canvas localStorage échouée:', e); }
    }

    function adjustCanvasHeights() {
        const appModal = document.getElementById('app-modal');
        const canvasColumn = document.getElementById('canvas-column');
        const coupeContainer = document.getElementById('coupe-container');
        const facadeContainer = document.getElementById('facade-block-container');

        // NOUVEAU : Si on est en mode calepinage, on laisse le CSS gérer (100% hauteur)
        // On sort de la fonction pour éviter que le JS n'écrase les styles
        if (appModal.classList.contains('calepinage-full')) {
            coupeContainer.style.height = '100%';
            coupeContainer.style.flex = '1 1 100%';
            return;
        }

        const geometryTitle = document.getElementById('geometry-title');
        const actionsTitle = document.getElementById('actions-title');

        if (!canvasColumn || !coupeContainer || !facadeContainer || !geometryTitle || !actionsTitle) {
            if (coupeContainer) {
                coupeContainer.style.height = '50%';
                coupeContainer.style.flex = '1 1 50%';
            }
            if (facadeContainer) {
                facadeContainer.style.height = '50%';
                facadeContainer.style.flex = '1 1 50%';
            }
            return;
        }

        const controlsContainer = document.getElementById('controls-container');
        const controlsRect = controlsContainer.getBoundingClientRect();
        const columnRect = canvasColumn.getBoundingClientRect();
        const columnTop = columnRect.top;

        const geometryTitleTop = geometryTitle.getBoundingClientRect().top;
        const actionsTitleTop = actionsTitle.getBoundingClientRect().top;

        const gap = parseFloat(window.getComputedStyle(canvasColumn).gap) || 0;

        let height1 = geometryTitleTop - columnTop;
        let height2 = (actionsTitleTop - geometryTitleTop) - gap;

        if (height1 <= 0 || height2 <= 0 || controlsRect.width === 0) {
            coupeContainer.style.height = '50%';
            coupeContainer.style.flex = '1 1 50%';
            facadeContainer.style.height = '50%';
            facadeContainer.style.flex = '1 1 50%';
            return;
        }

        coupeContainer.style.height = `${height1}px`;
        coupeContainer.style.flex = `0 0 ${height1}px`;
        facadeContainer.style.height = `${height2}px`;
        facadeContainer.style.flex = `0 0 ${height2}px`;
    }

    function scheduleUpdate() {
        return new Promise(resolve => {
            if (isUpdateScheduled) { resolve(); return; }
            isUpdateScheduled = true;
            requestAnimationFrame(async () => {
                try {
                    await runAllDrawings();
                    adjustCanvasHeights();
                } catch (e) { console.error("Drawing error:", e); }
                isUpdateScheduled = false; resolve();
            });
        });
    }

    function setupToggleButton(activeBtn, buttonGroupNodeList, containerToShow, containersToHide) {
        buttonGroupNodeList.forEach(btn => btn.classList.remove('active'));
        if (activeBtn) activeBtn.classList.add('active');
        if (containerToShow) { (Array.isArray(containerToShow) ? containerToShow : [containerToShow]).forEach(c => { if (c) c.classList.remove('hidden'); }); }
        if (containersToHide) { (Array.isArray(containersToHide) ? containersToHide : [containersToHide]).forEach(c => { if (c) c.classList.add('hidden'); }); }
    }

    // Le champ "Entraxe (m)" (#entraxeControl) est partagé entre les modèles "double", "linked" et
    // "doubleYShape". Centralisé ici pour éviter de dupliquer cette règle dans chaque gestionnaire de clic modèle.
    function updateLinkedAndDoubleSharedControls() {
        const entraxeControl = document.getElementById('entraxeControl');
        const linkedControls = document.getElementById('linkedPostControls');
        const doubleYShapeControls = document.getElementById('doubleYShapePostControls');
        const showEntraxe = (appState.postModel === 'double' || appState.postModel === 'linked' || appState.postModel === 'doubleYShape');
        if (entraxeControl) entraxeControl.classList.toggle('hidden', !showEntraxe);
        if (linkedControls) linkedControls.classList.toggle('hidden', appState.postModel !== 'linked');
        if (doubleYShapeControls) doubleYShapeControls.classList.toggle('hidden', appState.postModel !== 'doubleYShape');
    }

    const heightUnderBraceInput = document.getElementById('heightUnderBrace');

    const coupeViewManager = new ViewManager(document.getElementById('coupeCanvas'), drawCoupe);
    const facadeViewManager = new ViewManager(document.getElementById('facadeCanvas'), drawFacade);
    const implantationViewManager = new ViewManager(document.getElementById('implantationCanvas'), drawImplantation);
    // Dossier de plans « Ombrières » (geometrie_structure/ombrieres/dossier_plans/iframe/
    // pont_dossier_ombriere.js) : fonctions de dessin rejouées par l'enregistreur vectoriel
    // (enregistreur_vectoriel.js), et redessin complet à la demande.
    window.__ombriereExports = {
        type: 'metal', drawCoupe, drawFacade, coupeViewManager, facadeViewManager, appState,
        redessiner: () => scheduleUpdate(),
    };
    const managers = {
        Coupe: coupeViewManager,
        Facade: facadeViewManager,
        Implantation: implantationViewManager
    };

    let debounceTimeout;
    // Terrain automatique (profils IGN/Google du champ PV, cf. geometrie_structure/terrain_plans.js) :
    // chargé depuis la page parente, redessine à son arrivée.
    if (window.TerrainPlans) window.TerrainPlans.demarrer(() => scheduleUpdate());

    document.querySelectorAll('.all-inputs').forEach(input => input.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            scheduleUpdate();
            setTimeout(adjustCanvasHeights, 50);
        }, 300);
    }));
    document.querySelectorAll('.project-inputs').forEach(input => input.addEventListener('input', () => {
        // Pas de redessin nécessaire pour les champs de projet
    }));

    // Bornes de saisie strictes : rejet catégorique, jamais de correction silencieuse de la saisie de
    // l'utilisateur. getFieldRangeViolation() est appelée par runAllDrawings() AVANT tout dessin (donc à
    // chaque tentative de mise à jour, pas seulement au blur) : si un champ est hors intervalle, aucun
    // dessin n'est effectué et un modal explicatif s'affiche ; le champ garde exactement ce que
    // l'utilisateur a tapé, et reprend le focus (texte sélectionné) une fois le modal fermé.
    let validationModalOpen = false;
    // CORRECTIF : dernière violation (champ + valeur) déjà acquittée par un clic sur OK — cf.
    // runAllDrawings(), évite de rouvrir le modal en boucle tant que la valeur fautive est inchangée.
    let lastAcknowledgedViolationKey = null;

    function showValidationModal(message) {
        return new Promise(resolve => {
            const overlay = document.getElementById('validation-modal-overlay');
            const msgEl = document.getElementById('validation-modal-message');
            const okBtn = document.getElementById('validation-modal-ok');
            if (!overlay || !msgEl || !okBtn) { resolve(); return; }
            msgEl.textContent = message;
            overlay.classList.add('visible');
            // { once: true } : garantit un seul déclenchement même si un appel précédent avait laissé
            // un écouteur non nettoyé, plutôt que de dépendre uniquement du removeEventListener manuel.
            okBtn.addEventListener('click', () => {
                overlay.classList.remove('visible');
                resolve();
            }, { once: true });
        });
    }

    function showFieldViolationModal(violation, violationKey) {
        if (validationModalOpen) return;
        validationModalOpen = true;
        showValidationModal(violation.message).then(() => {
            validationModalOpen = false;
            // Mémorise cette violation comme acquittée : tant que le champ garde cette même valeur,
            // les redessins déclenchés en arrière-plan (postMessage, resize, etc.) ne rouvriront plus
            // le modal — cf. runAllDrawings(). Un vrai changement de valeur (par l'utilisateur) donnera
            // une clé différente et réaffichera l'avertissement normalement si toujours invalide.
            lastAcknowledgedViolationKey = violationKey;
            if (violation.el) { violation.el.focus(); violation.el.select(); }
        });
    }

    const SIMPLE_RANGE_FIELDS = [
        ['lowPointHeight', 2.5, 15, 'Hauteur structure égout (m)'],
        ['heightUnderBrace', 1.50, 10, 'Hauteur sous renfort (m)'],
        ['overhangSymValue', 0, 1, 'Porte-à-faux (m)'],
        ['overhangAsymHigh', 0, 1, 'Porte-à-faux Haut (m)'],
        ['overhangAsymLow', 0, 1, 'Porte-à-faux Bas (m)'],
        ['postEccentricity', 0, 30, 'Excentrement (m)'],
        ['leftOverhang', 0, 3, 'Porte-à-faux Gauche (m)'],
        // 'rightOverhang' est volontairement absent d'ici : c'est une valeur recalculée dynamiquement
        // (cf. parsePostDistances), validée séparément plus bas sur sa valeur À VENIR plutôt que sur
        // sa valeur encore affichée (voir commentaire dans getFieldRangeViolation).
        ['groundSlopeFacade', -3, 3, 'Dénivelé du terrain (m)'],
        ['baseAltimetry', 0, 1500, 'Altimétrie au point +0.00m (m)'],
    ];
    SIMPLE_RANGE_FIELDS.forEach(([id, min, max]) => {
        const el = document.getElementById(id);
        if (el) { el.min = min; el.max = max; }
    });

    const INTEGER_RANGE_FIELDS = [
        ['linkedPanelsCount', 1, 50, 'Nbre de pan de toitures'],
        ['doubleYShapePanelsCount', 1, 50, 'Nbre d\'ombrières'],
    ];
    INTEGER_RANGE_FIELDS.forEach(([id, min, max]) => {
        const el = document.getElementById(id);
        if (el) { el.min = min; el.max = max; el.step = 1; }
    });

    // Vérifie tous les champs à bornes strictes ainsi que l'entraxe (dépendant du modèle actif) et
    // renvoie la première violation trouvée ({el, message}), ou null si tout est valide.
    function getFieldRangeViolation() {
        for (const [id, lo, hi, label] of SIMPLE_RANGE_FIELDS) {
            const el = document.getElementById(id);
            if (!el || el.offsetParent === null || el.value === '') continue;
            const v = parseFloat(el.value);
            if (isNaN(v)) continue;
            if (v < lo || v > hi) {
                return { el, message: `${label} : la valeur doit être comprise entre ${lo} et ${hi}. Veuillez saisir une nouvelle valeur.` };
            }
        }

        // "Porte-à-faux Droit" (#rightOverhang) n'est PAS validé ici par une borne bloquante : c'est
        // une valeur dérivée de "Entraxes poteaux" / longueur de façade / porte-à-faux gauche (cf.
        // parsePostDistances), recalculée et réaffichée automatiquement à chaque changement. Tant que
        // l'entraxe saisi par l'utilisateur reste dans sa propre plage valide (vérifiée par
        // parsePostDistances), le porte-à-faux droit qui en résulte doit être accepté tel quel — un
        // dépassement de [0, 3] y est déjà signalé par un avertissement non bloquant (post_distances_warning),
        // sans empêcher le redessin.

        for (const [id, lo, hi, label] of INTEGER_RANGE_FIELDS) {
            const el = document.getElementById(id);
            if (!el || el.offsetParent === null || el.value === '') continue;
            const v = parseFloat(el.value);
            if (isNaN(v)) continue;
            if (!Number.isInteger(v) || v <= lo || v >= hi) {
                return { el, message: `${label} : la valeur doit être un nombre entier strictement compris entre ${lo} et ${hi}. Veuillez saisir une nouvelle valeur.` };
            }
        }

        // "Entraxe (m)" (postSpacing) est partagé entre "Double Poteaux", "Centrés liaisonnés" et "Double
        // toiture Y" : la borne dure et la contrainte anti-chevauchement (doit dépasser la largeur
        // projetée d'une ombrière) dépendent du modèle actif.
        const psEl = document.getElementById('postSpacing');
        if (psEl && psEl.offsetParent !== null && psEl.value !== '') {
            const v = parseFloat(psEl.value);
            if (!isNaN(v)) {
                const panelWidthVal = parseFloat(document.getElementById('panelWidth').value) || 0;
                const postWidthVal = parseFloat(document.getElementById('postWidth').value) || 0;
                const roofSlopeVal = parseFloat(document.getElementById('roofSlope').value) || 0;
                const slopeRad = Math.abs(roofSlopeVal) * Math.PI / 180;
                const panelProjection = panelWidthVal * Math.cos(slopeRad);
                const totalProjection = panelProjection + postWidthVal;

                if (appState.postModel === 'linked') {
                    if (v < 5 || v > 30 || v <= panelProjection) {
                        return { el: psEl, message: `Entraxe (m) : la valeur doit être comprise entre 5 et 30 m, et strictement supérieure à la largeur projetée d'une ombrière (${panelProjection.toFixed(2)} m). Veuillez saisir une nouvelle valeur.` };
                    }
                } else if (appState.postModel === 'doubleYShape') {
                    if (v < 5 || v > 30 || v <= totalProjection) {
                        return { el: psEl, message: `Entraxe (m) : la valeur doit être comprise entre 5 et 30 m, et strictement supérieure à la largeur projetée d'une ombrière (${totalProjection.toFixed(2)} m). Veuillez saisir une nouvelle valeur.` };
                    }
                } else if (appState.postModel === 'double') {
                    const maxDoubleSpacing = Math.max(0, panelProjection - postWidthVal);
                    if (v < 0 || v > 30 || v > maxDoubleSpacing) {
                        return { el: psEl, message: `Entraxe entre poteaux (m) : la valeur doit être comprise entre 0 et 30 m, et rester dans la plage possible compte tenu de la longueur de traverse (max ${maxDoubleSpacing.toFixed(2)} m ici). Veuillez saisir une nouvelle valeur.` };
                    }
                }
            }
        }

        return null;
    }

    // "Entraxes poteaux" : ne conserver que chiffres, *, +, . et espaces au fil de la frappe (rejet actif
    // des autres caractères) ; la validation numérique (5-15 m par terme) est faite dans parsePostDistances.
    const postDistancesInput = document.getElementById('postDistances');
    if (postDistancesInput) {
        postDistancesInput.addEventListener('input', () => {
            const filtered = postDistancesInput.value.replace(/[^0-9*+.\s]/g, '');
            if (filtered !== postDistancesInput.value) {
                postDistancesInput.value = filtered;
            }
            // Le champ reste éditable manuellement : dès que l'utilisateur y touche lui-même
            // (par opposition à un remplissage automatique via autoFillOptimalEntraxe), on cesse
            // de l'écraser automatiquement à chaque changement de longueur de façade / PF gauche.
            if (!isAutoFillingPostDistances) userEditedPostDistances = true;
        });
    }

    // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : recalcule l'entraxe optimal par
    // défaut dès que la longueur de façade ou le porte-à-faux gauche changent.
    ['facadeLength', 'leftOverhang'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', autoFillOptimalEntraxe);
    });

    document.getElementById('toolInvertSlope').addEventListener('click', (e) => { appState.invertSlope = !appState.invertSlope; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toolFoundation').addEventListener('click', (e) => { appState.showFoundation = !appState.showFoundation; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toolPosTraverseTop').addEventListener('click', () => { appState.traversePosition = 'top'; document.getElementById('toolPosTraverseTop').classList.add('active'); document.getElementById('toolPosTraverseSide').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolPosTraverseSide').addEventListener('click', () => { appState.traversePosition = 'side'; document.getElementById('toolPosTraverseSide').classList.add('active'); document.getElementById('toolPosTraverseTop').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolDimColors').addEventListener('click', (e) => {
        const btn = e.target.closest('.dim-color-btn'); if (!btn) return;
        appState.dimensionColor = btn.dataset.color;
        document.querySelectorAll('.dim-color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); scheduleUpdate();
    });

    document.getElementById('toggleBraceLeft').addEventListener('click', e => { appState.showBraceLeft = !appState.showBraceLeft; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toggleBraceRight').addEventListener('click', e => { appState.showBraceRight = !appState.showBraceRight; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });

    document.querySelectorAll('#offsetPostControls .toggle-btn-group button').forEach(btn => btn.addEventListener('click', e => {
        appState.offsetPostSide = e.currentTarget.id.replace('offsetPos', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#offsetPostControls .toggle-btn-group button'));
        scheduleUpdate();
    }));
    document.querySelectorAll('#bracing-variant-group button').forEach(btn => btn.addEventListener('click', e => {
        appState.doublePostBracing = e.currentTarget.id.replace('bracing', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#bracing-variant-group button'));
        scheduleUpdate();
    }));

    document.getElementById('showDoubleBracing').addEventListener('change', e => { appState.showDoubleBracing = e.target.checked; scheduleUpdate(); });

    document.getElementById('reinforceBracons').addEventListener('click', () => {
        appState.reinforcementType = 'bracons';
        setupToggleButton(document.getElementById('reinforceBracons'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
        heightUnderBraceInput.readOnly = false;
        if (appState.postModel === 'y_shape') {
            heightUnderBraceInput.value = "2.0";
        } else {
            heightUnderBraceInput.value = "2.0";
        }
        scheduleUpdate();
    });
    document.getElementById('reinforceJarrets').addEventListener('click', () => {
        appState.reinforcementType = 'jarrets';
        setupToggleButton(document.getElementById('reinforceJarrets'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
        heightUnderBraceInput.readOnly = false;
        if (appState.postModel === 'y_shape') {
            heightUnderBraceInput.value = "3.20";
        } else {
            heightUnderBraceInput.value = "3.20";
        }
        scheduleUpdate();
    });

    document.getElementById('overhangSym').addEventListener('click', () => {
        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        scheduleUpdate();
    });
    document.getElementById('overhangAsym').addEventListener('click', () => {
        appState.overhangType = 'asym';
        setupToggleButton(document.getElementById('overhangAsym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangAsymContainer'), document.getElementById('overhangSymContainer'));
        scheduleUpdate();
    });

    const allModelButtons = document.querySelectorAll('#model-btn-group button');
    const allModelControls = [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls')];
    const inclinedPostCanvasControls = document.getElementById('inclinedPostCanvasControls');
    const overhangSymBtn = document.getElementById('overhangSym');
    const overhangAsymBtn = document.getElementById('overhangAsym');

    const setOverhangControlsEnabled = (enabled) => {
        overhangSymBtn.disabled = !enabled;
        overhangAsymBtn.disabled = !enabled;
    };

    // Les modèles "Toiture Y" / "Double toiture Y" imposent une traverse "Côté" (pas de position "Dessus"
    // possible pour eux). On mémorise la position choisie par l'utilisateur avant d'entrer dans l'un de ces
    // 2 modèles, pour la restaurer telle quelle en revenant sur un autre modèle (au lieu de laisser "Côté" fuiter).
    let traversePositionBeforeYShape = null;
    const restoreTraversePositionIfNeeded = () => {
        if (traversePositionBeforeYShape === null) return;
        appState.traversePosition = traversePositionBeforeYShape;
        if (traversePositionBeforeYShape === 'top') {
            document.getElementById('toolPosTraverseTop').classList.add('active');
            document.getElementById('toolPosTraverseSide').classList.remove('active');
        } else {
            document.getElementById('toolPosTraverseSide').classList.add('active');
            document.getElementById('toolPosTraverseTop').classList.remove('active');
        }
        traversePositionBeforeYShape = null;
    };

    // --- MODÈLES STANDARDS (Correction du bug de division) ---
    [document.getElementById('modelSinglePost'),
    document.getElementById('modelOffsetPost'),
    document.getElementById('modelDoublePost'),
    document.getElementById('modelInclinedPost')].forEach(btn => {

        btn.addEventListener('click', (e) => {
            restoreTraversePositionIfNeeded();
            const id = e.currentTarget.id;
            let targetModel = 'single';
            if (id === 'modelOffsetPost') {
                targetModel = 'offset';
                appState.offsetPostSide = 'low'; // Force la position sur Bas par défaut
                document.getElementById('offsetPosLow').classList.add('active');
                document.getElementById('offsetPosHigh').classList.remove('active');
            }

            if (id === 'modelDoublePost') targetModel = 'double';
            if (id === 'modelInclinedPost') targetModel = 'inclinedPost';

            appState.postModel = targetModel;

            if (targetModel === 'offset') {
                document.getElementById('postEccentricity').value = 2.0;
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls]);
            } else if (targetModel === 'double') {
                document.getElementById('postEccentricity').value = 0;
                document.getElementById('postSpacing').min = '0.5';
                document.getElementById('postSpacing').value = 3;
                setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
            } else if (targetModel === 'inclinedPost') {
                document.getElementById('postEccentricity').value = 0;
                document.getElementById('postInclinationInclined').value = 65;
                document.getElementById('postSpacingInclined').value = 2;
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('inclinedPostControls'), inclinedPostCanvasControls], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);
            } else {
                document.getElementById('postEccentricity').value = 0;
                setupToggleButton(e.currentTarget, allModelButtons, null, [...allModelControls, document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
            }

            setOverhangControlsEnabled(true);
            updateLinkedAndDoubleSharedControls();
            scheduleUpdate().then(adjustCanvasHeights);
        });
    });
    document.getElementById('modelDoublePost').addEventListener('click', (e) => {
        appState.postModel = 'double';

        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postInclinationInclined').value = 90;
        document.getElementById('postSpacing').min = '0.5';
        document.getElementById('postSpacing').value = 3;
        // SUPPRIMÉ : document.getElementById('panelWidth').value = 12.40;
        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });

    document.getElementById('modelInclinedPost').addEventListener('click', (e) => {
        appState.postModel = 'inclinedPost';

        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postInclinationInclined').value = 65;
        document.getElementById('postSpacingInclined').value = 2;
        // SUPPRIMÉ : document.getElementById('panelWidth').value = 12.40;
        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('inclinedPostControls'), inclinedPostCanvasControls], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);

        appState.reinforcementType = 'bracons';
        setupToggleButton(document.getElementById('reinforceBracons'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
        heightUnderBraceInput.value = "2.0";

        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });
    document.getElementById('modelYShape').addEventListener('click', (e) => {
        if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape') {
            traversePositionBeforeYShape = appState.traversePosition;
        }
        appState.postModel = 'y_shape';
        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postInclinationInclined').value = 90;

        appState.traversePosition = 'side';
        document.getElementById('toolPosTraverseSide').classList.add('active');
        document.getElementById('toolPosTraverseTop').classList.remove('active');

        appState.reinforcementType = 'bracons';
        setupToggleButton(document.getElementById('reinforceBracons'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
        heightUnderBraceInput.value = "2.0";
        heightUnderBraceInput.readOnly = false;

        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        setOverhangControlsEnabled(false);

        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('offsetBraceControls'), [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls]);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });
    document.getElementById('modelDoubleYShape').addEventListener('click', (e) => {
        if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape') {
            traversePositionBeforeYShape = appState.traversePosition;
        }
        appState.postModel = 'doubleYShape';
        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postInclinationInclined').value = 90;

        // Entraxe par défaut = largeur projetée au sol d'une ombrière (même formule que
        // total_projection_width dans calculateOmbriereMetalLocal : largeur du pan de toiture projetée
        // + largeur du poteau), recalculée dynamiquement à partir des champs actuels plutôt que figée.
        const panelWidthVal = parseFloat(document.getElementById('panelWidth').value) || 0;
        const postWidthVal = parseFloat(document.getElementById('postWidth').value) || 0;
        const roofSlopeVal = parseFloat(document.getElementById('roofSlope').value) || 0;
        const projectedSpacing = panelWidthVal * Math.cos(Math.abs(roofSlopeVal * Math.PI / 180)) + postWidthVal;
        document.getElementById('postSpacing').min = '0.5';
        document.getElementById('postSpacing').value = projectedSpacing.toFixed(2);

        appState.traversePosition = 'side';
        document.getElementById('toolPosTraverseSide').classList.add('active');
        document.getElementById('toolPosTraverseTop').classList.remove('active');

        appState.reinforcementType = 'bracons';
        setupToggleButton(document.getElementById('reinforceBracons'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
        heightUnderBraceInput.value = "2.0";
        heightUnderBraceInput.readOnly = false;

        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        setOverhangControlsEnabled(false);

        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doubleYShapePostControls'), [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('linkedPostControls'), document.getElementById('offsetBraceControls')]);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });
    document.getElementById('modelLinkedPost').addEventListener('click', (e) => {
        restoreTraversePositionIfNeeded();
        appState.postModel = 'linked';

        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postSpacing').min = '5';
        document.getElementById('postSpacing').value = 15;
        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('linkedPostControls'), [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });

    // --- GESTION TYPE DE STRUCTURE (SORTI DE L'ECOUTEUR Y-SHAPE) ---
    document.querySelectorAll('#structure-type-group button').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('#structure-type-group button').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            appState.structureType = e.currentTarget.id;
            console.log("Structure sélectionnée : " + e.currentTarget.innerText);
        });
    });


    document.getElementById('geometry-title').addEventListener('click', () => {
        const inputs = document.getElementById('geometry-inputs');
        const title = document.getElementById('geometry-title');
        inputs.classList.toggle('collapsed');
        title.classList.toggle('collapsed');

        setTimeout(() => {
            adjustCanvasHeights();
            scheduleUpdate();
        }, 350);
    });

    // Avertissement à fermer obligatoirement à la première consultation du plan de façade :
    // l'implantation des poteaux y est générée automatiquement (sommaire), sans tenir compte des
    // contraintes spécifiques du projet.
    let facadeDisclaimerShown = false;
    function showFacadeDisclaimerOnce() {
        if (facadeDisclaimerShown) return;
        facadeDisclaimerShown = true;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.5); z-index: 100000;
            display: flex; align-items: center; justify-content: center;
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            background: #fff; border-radius: 8px; padding: 24px; max-width: 480px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3); text-align: center;
        `;
        box.innerHTML = `
            <p style="margin: 0 0 16px; color: #1f2937; font-size: 0.95rem; line-height: 1.5;">
                Veuillez adapter le plan d'implantation des poteaux à votre projet. Il s'agit d'une
                implantation sommaire générée automatiquement par le logiciel pour l'affichage du
                modèle, qui ne tient pas compte de vos contraintes spécifiques.
            </p>
            <button id="facade-disclaimer-close-btn" style="
                background-color: #DC2626; color: white; border: none; padding: 8px 20px;
                border-radius: 4px; cursor: pointer; font-weight: 600;
            ">Fermer</button>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        box.querySelector('#facade-disclaimer-close-btn').addEventListener('click', () => overlay.remove());
    }

    async function switchTab(groupClass, contentClass, tabButton, isTrusted = false) {
        const appModal = document.getElementById('app-modal');

        document.querySelectorAll(groupClass).forEach(t => t.classList.remove('active'));
        tabButton.classList.add('active');

        document.querySelectorAll(contentClass).forEach(c => c.classList.add('hidden'));
        const targetView = document.getElementById(tabButton.id.replace('tab', 'view'));
        if (targetView) targetView.classList.remove('hidden');

        // CORRECTIF : le plan de façade est l'onglet actif par défaut au sein de son groupe — il
        // ne reçoit donc jamais lui-même de clic tant que l'utilisateur ne clique pas
        // explicitement dessus. C'est le clic sur "Plan de coupe" qui révèle réellement la zone
        // contenant Façade/Implantation (masquée par défaut, cf. calepinage-full) : le message
        // doit donc aussi apparaître à ce moment-là. Ne s'affiche que sur une action RÉELLE de
        // l'utilisateur (isTrusted, pas un changement d'onglet déclenché par le code au
        // chargement), et seulement si l'utilisateur n'a pas déjà personnalisé lui-même
        // l'implantation des poteaux (postDistances) — dans ce cas l'avertissement n'a plus lieu d'être.
        if ((tabButton.id === 'tabFacade' || tabButton.id === 'tabCoupe') && isTrusted && !userEditedPostDistances) {
            showFacadeDisclaimerOnce();
        }

        if (tabButton.id === 'tabCalepinage') {
            appModal.classList.add('form-hidden');
            appModal.classList.add('calepinage-full');
        } else {
            // On ne retire les classes que si on clique sur un onglet du groupe principal
            if (groupClass === '.tab-group-1') {
                appModal.classList.remove('form-hidden');
                appModal.classList.remove('calepinage-full');
            }
        }

        await new Promise(resolve => requestAnimationFrame(resolve));
        adjustCanvasHeights();
        await scheduleUpdate();
    }

    document.getElementById('tabCoupe').addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget, e.isTrusted));
    document.getElementById('tabCalepinage').addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget, e.isTrusted));
    const tabPlanMasseBtn = document.getElementById('tabPlanMasse');
    if (tabPlanMasseBtn) tabPlanMasseBtn.addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget, e.isTrusted));
    document.querySelectorAll('.tab-group-2').forEach(tab => tab.addEventListener('click', e => switchTab('.tab-group-2', '.tab-content-2', e.currentTarget, e.isTrusted)));

    ['Coupe', 'Facade', 'Implantation'].forEach(view => {
        const manager = managers[view];
        if (manager) {
            document.getElementById(`zoomIn${view}`).addEventListener('click', () => manager.zoomIn());
            document.getElementById(`zoomOut${view}`).addEventListener('click', () => manager.zoomOut());
            document.getElementById(`reset${view}`).addEventListener('click', () => manager.reset());
            document.getElementById(`pan${view}`).addEventListener('click', (e) => manager.togglePanMode(e.currentTarget));
        }
    });

    // --- NOUVELLE LOGIQUE EXPORT PDF (JS & PYTHON) ---

    // 1. Masquage des anciens boutons PNG qui peuvent être inutiles visuellement
    ['exportCoupeBtn', 'exportFacadeBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Construit les lignes d'annotation "Données techniques calepinage" à partir des valeurs déjà
    // synchronisées et affichées dans l'iframe de calepinage (mêmes valeurs que les cartes
    // #dim-results-overlay / #orientation-overlay / #ref-pv-si-overlay), pour garantir la cohérence
    // avec l'écran et éviter de mal réinterpréter le format brut des données du localStorage
    // (ex: les dimensions panneaux, qui ne s'affichaient pas avec l'ancienne version basée sur
    // formData.dimensionsPanneaux).
    function buildCalepinageAnnotationLines(iframeDoc) {
        try {
            if (!iframeDoc) return null;
            const getVal = (id) => {
                const el = iframeDoc.getElementById(id);
                if (!el) return '';
                const v = (el.value !== undefined && el.value !== '') ? el.value : el.textContent;
                return (v || '').toString().trim();
            };

            const nbPanneaux = getVal('npv-detail') || 'N/A';
            const puissance = getVal('current-power-overlay') || 'N/A';
            const refPanneau = getVal('panel_ref') || 'N/A';
            const pente = getVal('pente-value') || 'N/A';
            const azimut = getVal('azimut-value') || 'N/A';
            const refSI = getVal('ref-si-overlay') || 'N/A';
            const dimPanneaux = getVal('dim-pv-detail') || 'N/A';

            return [
                `Nbre panneaux : ${nbPanneaux} | Puissance : ${puissance} | Réf panneau : ${refPanneau}`,
                `Pente : ${pente} | Azimut : ${azimut} | Réf SI : ${refSI} | Dim panneaux : ${dimPanneaux}`
            ];
        } catch (e) {
            console.warn('Erreur génération annotation calepinage:', e);
            return null;
        }
    }

    // Helper : Rogne l'image pour éviter les marges blanches tout en protégeant les hachures
    function getCroppedCanvas(sourceCanvas) {
        if (!sourceCanvas) return null;
        const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        if (w === 0 || h === 0) return null;

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        let minX = w, minY = h, maxX = 0, maxY = 0;
        let hasContent = false;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const alpha = data[i + 3];
                const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
                if (alpha > 0 && (r < 250 || g < 250 || b < 250)) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    hasContent = true;
                }
            }
        }
        if (!hasContent) return sourceCanvas;

        const padding = 20; // Padding important pour ne pas couper la hachure de 1.40m qui peut se situer aux extrêmités
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(w, maxX + padding);
        maxY = Math.min(h, maxY + padding);

        const cropW = maxX - minX;
        const cropH = maxY - minY;

        const cropped = document.createElement('canvas');
        cropped.width = cropW; cropped.height = cropH;
        cropped.getContext('2d').putImageData(ctx.getImageData(minX, minY, cropW, cropH), 0, 0);
        return cropped;
    }

    // Capture asynchrone des canvas
    const safeCapture = async (canvasId, isIframe = false) => {
        let targetEl;
        if (isIframe) {
            const iframe = document.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                // #drawing-zone (panneaux + toiture + cotations uniquement, sans les cartes d'infos
                // de la barre latérale #overlays-sidebar) plutôt que #pdf-capture-area (qui inclut la
                // barre latérale).
                targetEl = iframe.contentWindow.document.getElementById('drawing-zone') || iframe.contentWindow.document.getElementById('pv-canvas');
            }
            if (!targetEl) {
                targetEl = document.getElementById('drawing-zone') || document.getElementById('pv-canvas');
            }
        } else {
            targetEl = document.getElementById(canvasId);
        }
        if (!targetEl) return null;
        if (targetEl.tagName === 'CANVAS' && (targetEl.width === 0 || targetEl.height === 0)) return null;

        try {
            if (targetEl.tagName === 'CANVAS') {
                // Traitement direct du canvas (beaucoup plus fiable que html2canvas)
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = targetEl.width;
                tempCanvas.height = targetEl.height;
                const tCtx = tempCanvas.getContext('2d');
                tCtx.fillStyle = '#ffffff'; // On force un fond blanc pour le JPEG
                tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                tCtx.drawImage(targetEl, 0, 0);
                return getCroppedCanvas(tempCanvas) || tempCanvas;
            } else {
                const captured = await html2canvas(targetEl, { scale: 2, backgroundColor: '#ffffff' });
                return getCroppedCanvas(captured) || captured;
            }
        } catch (e) {
            console.warn(`Échec capture ${canvasId}`, e);
            return null;
        }
    };

    // Remplacement du bouton PDF standard (JS)
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', async () => {
            const originalText = exportPdfBtn.innerHTML;
            exportPdfBtn.disabled = true;
            exportPdfBtn.innerHTML = "Génération du PDF...";

            window.isGeneratingPDF = true;
            const views = document.querySelectorAll('.tab-content-1');
            const originalStates = Array.from(views).map(v => ({ 
                el: v, 
                hidden: v.classList.contains('hidden'), 
                display: v.style.display,
                position: v.style.position,
                visibility: v.style.visibility,
                top: v.style.top,
                left: v.style.left,
                zIndex: v.style.zIndex,
                width: v.style.width,
                height: v.style.height
            }));
            views.forEach(v => {
                v.classList.remove('hidden');
                v.style.display = 'flex';
                v.style.position = 'absolute';
                v.style.visibility = 'visible';
                v.style.top = '0';
                v.style.left = '0';
                v.style.zIndex = '-10'; // Masqué visuellement derrière le reste
                v.style.width = '1200px';
                v.style.height = '800px';
            });

            try {
                await runAllDrawings();
                const iframe = document.querySelector('iframe');
                if (iframe && iframe.contentWindow && typeof iframe.contentWindow.calculateAndDraw === 'function') {
                    await iframe.contentWindow.calculateAndDraw();
                } else if (typeof window.calculateAndDraw === 'function') {
                    await window.calculateAndDraw();
                }
                await new Promise(resolve => setTimeout(resolve, 500));

                // Neutraliser temporairement la bordure de #drawing-zone et ses boutons de zoom/pan :
                // ces éléments touchent les bords du conteneur et empêchaient le recadrage
                // (getCroppedCanvas) de se resserrer sur les panneaux/toiture/cotations réellement
                // utiles (l'image capturée prenait alors tout le canvas).
                let _dzBorderBackup = null, _dzControls = null;
                try {
                    const ifrDoc = iframe?.contentWindow?.document;
                    const dz = ifrDoc?.getElementById('drawing-zone');
                    if (dz) { _dzBorderBackup = dz.style.border; dz.style.border = 'none'; }
                    _dzControls = ifrDoc?.querySelector('#drawing-zone > div:not(#canvas-pan-zoom-wrapper):not(#north-pointer)');
                    if (_dzControls) _dzControls.style.display = 'none';
                } catch (e) {}

                const [coupeImg, facadeImg, implantationImg, calepinageImg] = await Promise.all([
                    safeCapture('coupeCanvas'),
                    safeCapture('facadeCanvas'),
                    safeCapture('implantationCanvas'),
                    safeCapture('pv-canvas', true)
                ]);

                try {
                    if (_dzControls) _dzControls.style.display = '';
                    const ifrDoc = iframe?.contentWindow?.document;
                    const dz = ifrDoc?.getElementById('drawing-zone');
                    if (dz) dz.style.border = _dzBorderBackup || '';
                } catch (e) {}

                const { jsPDF } = window.jspdf;
                const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

                const A3_W = 420; const A3_H = 297; const margin = 15;
                const gridW = (A3_W - 3 * margin) / 2;
                const gridH = (A3_H - 45) / 2;

                doc.setFontSize(20);
                doc.setFont('helvetica', 'bold');
                doc.text("Rapport Ombrière - Plans de conception", A3_W / 2, margin, { align: 'center' });

                const images = [
                    { title: "1. Plan de Coupe", data: coupeImg ? coupeImg.toDataURL('image/jpeg', 0.95) : null, x: margin, y: 25 },
                    { title: "2. Plan de Façade", data: facadeImg ? facadeImg.toDataURL('image/jpeg', 0.95) : null, x: margin * 2 + gridW, y: 25 },
                    { title: "3. Plan de Calepinage", data: calepinageImg ? calepinageImg.toDataURL('image/jpeg', 0.95) : null, x: margin, y: 25 + gridH + 10, annotation: buildCalepinageAnnotationLines(iframe?.contentWindow?.document) },
                    { title: "4. Plan d'Implantation", data: implantationImg ? implantationImg.toDataURL('image/jpeg', 0.95) : null, x: margin * 2 + gridW, y: 25 + gridH + 10 }
                ];

                images.forEach(img => {
                    doc.setFontSize(14);
                    doc.setFont('helvetica', 'bold');
                    doc.text(img.title, img.x, img.y + 5);
                    doc.setDrawColor(150); doc.setLineWidth(0.5);
                    doc.rect(img.x, img.y, gridW, gridH);

                    // Annotation des données techniques du calepinage (remplace les cartes d'infos
                    // retirées de l'image capturée : Nbre panneaux, Puissance, Pente, Azimut, Réf SI, Dim panneaux).
                    let contentTopOffset = 10;
                    if (img.annotation && img.annotation.length) {
                        doc.setFontSize(8);
                        doc.setFont('helvetica', 'normal');
                        doc.setTextColor(60, 60, 60);
                        img.annotation.forEach((line, i) => {
                            doc.text(line, img.x + 3, img.y + contentTopOffset + (i * 3.5));
                        });
                        doc.setTextColor(0, 0, 0);
                        contentTopOffset += img.annotation.length * 3.5 + 2;
                    }

                    if (img.data) {
                        const imgProps = doc.getImageProperties(img.data);
                        const ratio = imgProps.width / imgProps.height;
                        const availW = gridW - 10; const availH = gridH - contentTopOffset - 5;
                        let finalW = availW; let finalH = availW / ratio;
                        if (finalH > availH) { finalH = availH; finalW = availH * ratio; }
                        const drawX = img.x + (gridW - finalW) / 2;
                        const drawY = img.y + contentTopOffset + (availH - finalH) / 2;
                        doc.addImage(img.data, 'JPEG', drawX, drawY, finalW, finalH);
                    } else {
                        doc.setFontSize(12); doc.setTextColor(255, 0, 0);
                        doc.text("Plan non disponible", img.x + gridW/2, img.y + gridH/2, { align: 'center' });
                        doc.setTextColor(0, 0, 0);
                    }
                });

                doc.save('Rapport_A3_JS.pdf');
            } catch (e) {
                console.error("Erreur Export JS:", e);
                alert("Erreur lors de la génération du rapport JS.");
            } finally {
                originalStates.forEach(s => {
                    if (s.hidden) s.el.classList.add('hidden');
                    s.el.style.display = s.display;
                    s.el.style.position = s.position;
                    s.el.style.visibility = s.visibility;
                    s.el.style.top = s.top;
                    s.el.style.left = s.left;
                    s.el.style.zIndex = s.zIndex;
                    s.el.style.width = s.width;
                    s.el.style.height = s.height;
                });
                window.isGeneratingPDF = false;
                exportPdfBtn.disabled = false;
                exportPdfBtn.innerHTML = originalText;
            }
        });
    }

    // Remplacement du bouton Python
    async function exportRapportA4() {
        const btn = document.getElementById('exportRapportA4Btn');
        if (btn) { btn.disabled = true; btn.textContent = "Génération du rapport..."; }

        window.isGeneratingPDF = true;
        const views = document.querySelectorAll('.tab-content-1');
        const originalStates = Array.from(views).map(v => ({ 
            el: v, 
            hidden: v.classList.contains('hidden'), 
            display: v.style.display,
            position: v.style.position,
            visibility: v.style.visibility,
            top: v.style.top,
            left: v.style.left,
            zIndex: v.style.zIndex,
            width: v.style.width,
            height: v.style.height
        }));
        views.forEach(v => {
            v.classList.remove('hidden');
            v.style.display = 'flex';
            v.style.position = 'absolute';
            v.style.visibility = 'visible';
            v.style.top = '0';
            v.style.left = '0';
            v.style.zIndex = '-10';
            v.style.width = '1200px';
            v.style.height = '800px';
        });

        try {
            await runAllDrawings();
            const iframe = document.querySelector('iframe');
            if (iframe && iframe.contentWindow && typeof iframe.contentWindow.calculateAndDraw === 'function') {
                await iframe.contentWindow.calculateAndDraw();
            } else if (typeof window.calculateAndDraw === 'function') {
                await window.calculateAndDraw();
            }
            await new Promise(resolve => setTimeout(resolve, 500));

            const getRawDataUrl = async (canvasId, isIframe = false) => {
                let targetEl;
                if (isIframe) {
                    const ifr = document.querySelector('iframe');
                    if (ifr && ifr.contentWindow) {
                        targetEl = ifr.contentWindow.document.getElementById('drawing-zone') || ifr.contentWindow.document.getElementById('pv-canvas');
                    }
                    if (!targetEl) {
                        targetEl = document.getElementById('drawing-zone') || document.getElementById('pv-canvas');
                    }
                } else {
                    targetEl = document.getElementById(canvasId);
                }
                if (!targetEl) return null;
                
                if (targetEl.tagName === 'CANVAS') {
                    if (targetEl.width === 0 || targetEl.height === 0) return null;
                    return targetEl.toDataURL('image/png');
                } else {
                    try {
                        const captured = await html2canvas(targetEl, { scale: 2, backgroundColor: '#ffffff' });
                        const cropped = getCroppedCanvas(captured) || captured;
                        return cropped.toDataURL('image/png');
                    } catch (e) {
                        return null;
                    }
                }
            };

            const images = {
                coupe: await getRawDataUrl('coupeCanvas'),
                facade: await getRawDataUrl('facadeCanvas'),
                implantation: await getRawDataUrl('implantationCanvas'),
                calepinage: await getRawDataUrl('pv-canvas', true)
            };

            const response = await fetch('/concevoir_mon_projet/api/ombriere/export-python-a3', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(images)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Rapport_A3.pdf';
            a.click();
            URL.revokeObjectURL(url);

        } catch (err) {
            console.error('Erreur export Python :', err);
            alert(`Erreur lors de la génération du rapport : ${err.message}`);
        } finally {
            originalStates.forEach(s => {
                if (s.hidden) s.el.classList.add('hidden');
                s.el.style.display = s.display;
                s.el.style.position = s.position;
                s.el.style.visibility = s.visibility;
                s.el.style.top = s.top;
                s.el.style.left = s.left;
                s.el.style.zIndex = s.zIndex;
                s.el.style.width = s.width;
                s.el.style.height = s.height;
            });
            window.isGeneratingPDF = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Exporter le rapport A3'; }
        }
    }

    const actionsDiv = document.querySelector('#actions-title + .span-2');
    if (actionsDiv && !document.getElementById('exportRapportA4Btn')) {
        const rapportBtn = document.createElement('button');
        rapportBtn.id = 'exportRapportA4Btn';
        rapportBtn.className = 'w-full bg-purple-600 text-white font-bold py-2 px-4 rounded-md hover:bg-purple-700 mt-2';
       // rapportBtn.textContent = 'Exporter le rapport A3';
        rapportBtn.style.display = 'none'; // Masquer le bouton de l'interface
        rapportBtn.addEventListener('click', exportRapportA4);
        actionsDiv.appendChild(rapportBtn);
    }
    // --- FIN NOUVELLE LOGIQUE EXPORT PDF ---

    // --- INITIALIZATION ---
    window.addEventListener('load', () => {
        // 1. Activer les styles visuels par défaut
        ['toggleBraceLeft', 'toggleBraceRight', 'toolPosTraverseTop'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('active');
        });

        // Entraxe par défaut calculé automatiquement (voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE
        // DES POTEAUX" plus haut), à la place de l'ancienne valeur statique "3*10 + 7.50".
        autoFillOptimalEntraxe();

        document.querySelector('.dim-color-btn[data-color="#0000FF"]').classList.add('active');

        // 2. FORCER LE MODÈLE PAR DÉFAUT (Poteaux Centrés)
        // Cela initialise l'appState et corrige les décalages de calcul
        const btnCentres = document.getElementById('modelSinglePost');
        if (btnCentres) {
            btnCentres.click();
        }

        // 3. Forcer l'onglet Plan de coupe au démarrage (CORRECTIF, demande explicite : anciennement
        // Calepinage — "Plan de coupe" est désormais l'onglet actif par défaut).
        const tabCoupeDefault3 = document.getElementById('tabCoupe');
        if (tabCoupeDefault3) {
            switchTab('.tab-group-1', '.tab-content-1', tabCoupeDefault3);
        }
        // ---------------------------------------------

        document.getElementById('overhangSym').click();
        adjustCanvasHeights();

        // Gestion de la barre au sol pour poteaux inclinés
        const checkPanel = document.getElementById('showInclinedGroundBar');
        const checkCanvas = document.getElementById('showInclinedGroundBarCanvas');
        if (checkPanel && checkCanvas) {
            checkCanvas.checked = checkPanel.checked;
            checkPanel.addEventListener('change', () => { checkCanvas.checked = checkPanel.checked; });
            checkCanvas.addEventListener('change', () => {
                checkPanel.checked = checkCanvas.checked;
                scheduleUpdate();
            });
        }

        // Ajustement final de la mise en page
        adjustCanvasHeights();
    });

    let lastObservedWidth = 0;
    let lastObservedHeight = 0;
    const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            if (Math.abs(width - lastObservedWidth) > 2 || Math.abs(height - lastObservedHeight) > 2) {
                lastObservedWidth = width;
                lastObservedHeight = height;
                adjustCanvasHeights();
                        // Remplacement : On redessine localement sans appeler l'API pour éviter la boucle infinie
                        requestAnimationFrame(() => {
                            if (typeof coupeViewManager !== 'undefined' && coupeViewManager) coupeViewManager.draw();
                            if (typeof facadeViewManager !== 'undefined' && facadeViewManager) facadeViewManager.draw();
                            if (typeof implantationViewManager !== 'undefined' && implantationViewManager) implantationViewManager.draw();
                        });
            }
        }
    });
    const appModalEl = document.getElementById('app-modal');

    if (appModalEl) {
        resizeObserver.observe(appModalEl);
    }

    // Icônes 👁️/✂️ « un seul plan dans le canevas » (geometrie_structure/geometrie_plans_toggle.js) :
    // le conteneur qui reste visible change de hauteur, mais #app-modal (seul élément observé par le
    // ResizeObserver ci-dessus) garde la sienne — d'où cet événement pour remesurer et redessiner.
    document.addEventListener('geometrie:plansVisibilityChanged', () => {
        adjustCanvasHeights();
        scheduleUpdate();
    });

    const controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
        controlsContainer.addEventListener('scroll', () => {
            adjustCanvasHeights();
        });
    }

    // === GESTION DU MESSAGE DE SYNCHRONISATION DU CALEPINAGE ===
    window.addEventListener('message', function (event) {
        // Bloquer l'écrasement des données pendant l'export du PDF (garde les données utilisateurs fixes)
        if (window.isGeneratingPDF) return;

        const data = event.data;
        if (data.type === 'CALEPINAGE_UPDATE') {
            // facadeLength et panelWidth sont définis par updateDimensionsFromStorage() (gridInfo du PV)
            // Le calepinage interne déclenche uniquement un recalcul du dessin
            if (typeof scheduleUpdate === 'function') {
                scheduleUpdate();
            }
        }
    });

    // === SYNCHRONISATION INCLINAISON roofSlope → calepinage.html ===
    (function () {
        const _pvIdMetal = new URLSearchParams(window.location.search).get('pvId');
        const roofSlopeEl = document.getElementById('roofSlope');
        if (roofSlopeEl) {
            roofSlopeEl.addEventListener('input', function () {
                const val = parseFloat(this.value);
                if (!isNaN(val) && window.parent !== window) {
                    window.parent.postMessage({ action: 'updateCalepinageField', fieldName: 'inclinaison', value: val, pvId: _pvIdMetal }, '*');
                    const iframe = document.getElementById('iframeCalepinage');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({ type: 'SET_INCLINAISON', value: val }, '*');
                    }
                }
            });
        }
    })();





    // ==================== PATCH POUR INTÉGRATION DANS LE RAPPORT GLOBAL ====================
    window._ombriereType = 'metal';
    window._ombriereReady = true;

    window.appendOmbriereMetalPages = async (doc) => {
        console.log('🔄 [Metal] appendOmbriereMetalPages appelé');
 
        // ── 1. Sauvegarder l'état des onglets ──────────────────────────────
        const views = document.querySelectorAll('.tab-content-1');
        const originalStates = Array.from(views).map(v => ({
            el: v,
            hidden:     v.classList.contains('hidden'),
            display:    v.style.display,
            position:   v.style.position,
            visibility: v.style.visibility,
            top:        v.style.top,
            left:       v.style.left,
            zIndex:     v.style.zIndex,
            width:      v.style.width,
            height:     v.style.height
        }));
 
        // ── 2. Révéler tous les onglets pour capture (hors-écran) ──────────
        views.forEach(v => {
            v.classList.remove('hidden');
            v.style.display    = 'flex';
            v.style.position   = 'absolute';
            v.style.visibility = 'visible';
            v.style.top        = '0';
            v.style.left       = '0';
            v.style.zIndex     = '-10';
            v.style.width      = '1200px';
            v.style.height     = '800px';
        });
 
        // Garde l'ancien flag pour le restaurer
        const prevFlag = window.isGeneratingPDF;
        window.isGeneratingPDF = true;
 
        try {
            // ── 3. Forcer le redessin ──────────────────────────────────────
            console.log('🔄 [Metal] runAllDrawings...');
            await runAllDrawings();
            console.log('✅ [Metal] runAllDrawings OK');
 
            // Redessiner le calepinage dans l'iframe interne
            const calepIframe = document.querySelector('iframe');
            if (calepIframe?.contentWindow?.calculateAndDraw) {
                await calepIframe.contentWindow.calculateAndDraw();
            } else if (typeof window.calculateAndDraw === 'function') {
                await window.calculateAndDraw();
            }
            await new Promise(r => setTimeout(r, 500));
 
            // ── 4. Capturer les 4 plans via la safeCapture ORIGINALE ───────
            //    (définie ligne ~1954, dans la même closure DOMContentLoaded)
            const coupeCanvas    = await safeCapture('coupeCanvas');
            const facadeCanvas   = await safeCapture('facadeCanvas');
            const implantCanvas  = await safeCapture('implantationCanvas');
            const calepCanvas    = await safeCapture('pv-canvas', true);
 
            console.log('📸 [Metal] Canvas capturés :', {
                coupe:        coupeCanvas    ? `${coupeCanvas.width}x${coupeCanvas.height}`    : 'null',
                facade:       facadeCanvas   ? `${facadeCanvas.width}x${facadeCanvas.height}`   : 'null',
                implantation: implantCanvas  ? `${implantCanvas.width}x${implantCanvas.height}` : 'null',
                calepinage:   calepCanvas    ? `${calepCanvas.width}x${calepCanvas.height}`     : 'null'
            });
 
            // ── 5. Ajouter une page A3 paysage au doc du parent ───────────
            const A3_W = 420, A3_H = 297, margin = 15;
            const gridW = (A3_W - 3 * margin) / 2;   // ~127.5 mm
            const gridH = (A3_H - 45) / 2;            // ~126 mm
 
            doc.addPage([A3_W, A3_H], 'landscape');
            console.log('✅ [Metal] Page A3 ajoutée – total pages :', doc.getNumberOfPages());
 
            // Titre de la page
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text("Plans d'Exécution – Ombrière Métal", A3_W / 2, margin, { align: 'center' });
 
            // ── 6. Dessiner les 4 cadres ──────────────────────────────────
            const addPlanImage = (canvas, title, x, y) => {
                // Titre du cadre
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(title, x, y + 5);

                // Bordure du cadre
                doc.setDrawColor(150);
                doc.setLineWidth(0.5);
                doc.rect(x, y, gridW, gridH);

                if (canvas) {
                    try {
                        const imgData  = canvas.toDataURL('image/jpeg', 0.95);
                        const imgProps = doc.getImageProperties(imgData);
                        const ratio    = imgProps.width / imgProps.height;
                        const availW   = gridW - 10;
                        const availH   = gridH - 15;
                        let fw = availW, fh = availW / ratio;
                        if (fh > availH) { fh = availH; fw = availH * ratio; }
                        const drawX = x + (gridW - fw) / 2;
                        const drawY = y + 10 + (availH - fh) / 2;
                        doc.addImage(imgData, 'JPEG', drawX, drawY, fw, fh);
                    } catch (imgErr) {
                        console.warn(`⚠️ [Metal] Erreur addImage "${title}":`, imgErr);
                        doc.setFontSize(10); doc.setTextColor(200, 0, 0);
                        doc.text('Erreur image', x + gridW / 2, y + gridH / 2, { align: 'center' });
                        doc.setTextColor(0, 0, 0);
                    }
                } else {
                    doc.setFontSize(12); doc.setTextColor(200, 0, 0);
                    doc.text('Plan non disponible', x + gridW / 2, y + gridH / 2, { align: 'center' });
                    doc.setTextColor(0, 0, 0);
                }
            };

            addPlanImage(coupeCanvas,   '1. Plan de Coupe',        margin,             25);
            addPlanImage(facadeCanvas,  '2. Plan de Façade',        margin * 2 + gridW, 25);
            addPlanImage(calepCanvas,   '3. Plan de Calepinage',    margin,             25 + gridH + 10);
            addPlanImage(implantCanvas, "4. Plan d'Implantation",   margin * 2 + gridW, 25 + gridH + 10);
 
            console.log('✅ [Metal] Tous les plans ajoutés au document global');
 
        } catch (err) {
            console.error('❌ [Metal] Erreur dans appendOmbriereMetalPages :', err);
            // Page d'erreur pour ne pas laisser le rapport sans mention des plans
            doc.addPage([420, 297], 'landscape');
            doc.setFontSize(14); doc.setTextColor(200, 0, 0);
            doc.text(
                'Erreur lors de la génération des plans Ombrière Métal.',
                210, 148, { align: 'center' }
            );
            doc.setTextColor(0, 0, 0);
 
        } finally {
            // ── 7. Restaurer l'état original des onglets ──────────────────
            originalStates.forEach(s => {
                if (s.hidden) s.el.classList.add('hidden');
                s.el.style.display    = s.display;
                s.el.style.position   = s.position;
                s.el.style.visibility = s.visibility;
                s.el.style.top        = s.top;
                s.el.style.left       = s.left;
                s.el.style.zIndex     = s.zIndex;
                s.el.style.width      = s.width;
                s.el.style.height     = s.height;
            });
            window.isGeneratingPDF = prevFlag || false;
        }
    };
});