document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL VARIABLES & APP STATE ---
    let map;
    let appState = {
        postModel: 'inclinedPost',
        traversePosition: 'top',
        overhangType: 'sym',
        dimensionColor: '#0000FF',
        invertSlope: false,
        parsedDistances: [],
        offsetPostSide: 'center',
        showBraceLeft: true,
        showBraceRight: true,
        doublePostBracing: 'v1',
        showDoubleBracing: true,
        hideCentralPost: false,
       showFoundations: false,
    };
    let isUpdateScheduled = false;
    let lastValidPostDistances = document.getElementById('postDistances').value;
    // Calcul automatique de l'implantation des poteaux (cf. autoFillOptimalEntraxe) : le champ
    // reste éditable, mais n'est recalculé automatiquement que tant que l'utilisateur ne l'a
    // pas modifié lui-même (isAutoFillingPostDistances évite de confondre une écriture
    // programmatique avec une saisie utilisateur).
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

            // MOD 1.1: Vue par défaut (Modèle N - Double Poteau)
            const defaultModelBtn = document.getElementById('modelInclinedPost') || document.getElementById('modelDoublePost');
            if (defaultModelBtn) defaultModelBtn.click();

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
        console.error("Éléments du modal de lancement non trouvés !");
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

    function drawCoupe(canvas, ctx, viewManager, values) {
        const { width, height } = setupCanvas(canvas);
        if (width === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- GESTION ERREUR GABARIT ---
        const errorDiv = document.getElementById('model-filter-error');
        if (errorDiv && !errorDiv.classList.contains('hidden')) {
            ctx.save();
            ctx.fillStyle = '#fef2f2';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("Configuration calepinage non conforme aux gabarits existants des ombrières Solumbra.", canvas.width / 2, canvas.height / 2 - 12);
            ctx.fillText("Veuillez contacter le fabricant de l’ombrière pour la prise en compte de votre calepinage hors catalogue.", canvas.width / 2, canvas.height / 2 + 12);
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY);
        ctx.scale(viewManager.zoom, viewManager.zoom);

        // Paramètres
        const panelWidth = values.panelWidth || 0;
        const postHeight = values.postHeight || 0;
        const passageHeight = values.passageHeight || 0;
        const lowPointHeight = values.lowPointHeight || 0;
        const highPointHeightValue = values.high_point_height || values.highPointHeight || 0;
        const beamLength = values.beamLength || panelWidth;
        const beamHeight = values.beamHeight || 0.4;
        const purlinHeight = values.purlinHeight || 0.2;
        const integrationHeight = values.integrationSystemHeight || 0.05;
        const panelThickness = values.panelThickness || 0.05;
        const postWidth = values.postWidth || 0.4;
        const ecc = values.postEccentricity || 0;
        const roofSlope = values.roofSlope || 0;
        const invertSlope = values.invertSlope || false;
        const slopeRad = roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1);
        const postModel = values.postModel || 'single';
        const traversePosition = values.traversePosition || 'top';
        const heightUnderBrace = values.heightUnderBrace || 2.0;
        const bracePercent = (values.braceFixPercentage || 70) / 100;
        const purlinCount = values.purlinCount || 6;
        const reinforcementType = values.reinforcementType || 'bracons';

        const oL = values.overhangL !== undefined ? values.overhangL : 0;
        const oH = values.overhangH !== undefined ? values.overhangH : 0;
        let panelOffset = (postModel === 'y_shape') ? 0 : (invertSlope ? (oH - oL) / 2 : (oL - oH) / 2);
        
        // Forcer l'alignement strict de la toiture (V1 et V2 : toujours affleurant à gauche / décalé vers la droite)
        if (postModel === 'offset') {
            panelOffset = (panelWidth - beamLength) / 2;
        } else if (postModel === 'double') {
            // Forcer le centrage strict de la toiture et de l'intégration sur la traverse
            panelOffset = 0;
        }

        // Échelle et centrage
        const totalDrawingHeight = highPointHeightValue + 2;
        const scale = Math.min(width / (panelWidth + 4), height / totalDrawingHeight) * 1;
        if (window.__dxfCapture) window.__dxfCapture.scale = scale; // enregistreur vectoriel (dossier de plans)
        const groundYView = height * 0.8;
        ctx.translate(width / 2, groundYView);
        
        // Dessin du Sol
        // Terrain automatique (geometrie_structure/terrain_plans.js) : profil réel sous la coupe.
        // L'ombrière est UNE structure : elle reste à niveau (Y = 0), les poteaux s'allongent. Le sol
        // est ramené à son point le PLUS HAUT sous l'emprise, pour qu'aucun poteau ne soit plus court
        // que sa hauteur réglée.
        const TP = window.TerrainPlans;
        const solCoupeAuto = (TP && typeof TP.solCoupe === 'function') ? TP.solCoupe({ invertSlope: !!values.invertSlope }) : null;
        const demiEmpriseCoupeM = Math.max(1, (values.panelWidth || 0) / 2 + 1);
        const solRefCoupeM = (TP && solCoupeAuto) ? TP.niveauSolStructure(solCoupeAuto, demiEmpriseCoupeM) : 0;
        const solCoupeY = solCoupeAuto
            ? (xScaled) => -(solCoupeAuto.zRel(xScaled / scale) - solRefCoupeM) * scale
            : () => 0;
        const coteSol = { echelle: scale };
        const coteAuPied = { echelle: scale, mesure: 'cible' };
        // Sol local sous l'abscisse x (m), en mètres (positif = plus bas que le niveau de référence).
        const solLocalM = (x) => solCoupeY(x * scale) / scale;

        const groundRectDepth = 1.40 * scale;
        // Terrain réel (profil) ou bande plate historique.
        const solDebutX = window.__dxfCapture ? -(demiEmpriseCoupeM + 2) * scale : -width * 4 / viewManager.zoom;
        const solFinX = window.__dxfCapture ? (demiEmpriseCoupeM + 2) * scale : width * 4 / viewManager.zoom;
        if (TP && typeof TP.dessinerSol === 'function') {
            TP.dessinerSol(ctx, { solY: solCoupeY, xDebut: solDebutX, xFin: solFinX, profondeur: groundRectDepth,
                                  pasEchantillon: solCoupeAuto ? 0.5 * scale : 0 });
        } else {
            ctx.fillStyle = "#f0f0f0"; ctx.fillRect(solDebutX, 0, solFinX - solDebutX, groundRectDepth);
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.strokeRect(solDebutX, 0, solFinX - solDebutX, groundRectDepth);
            ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
            for (let i = solDebutX - groundRectDepth; i < solFinX; i += 10) {
                ctx.beginPath(); ctx.moveTo(i, groundRectDepth); ctx.lineTo(i + groundRectDepth, 0); ctx.stroke();
            }
        }

        // Helpers
        const rotatePt = (x, y, cx, cy, angle) => ({
            x: Math.cos(angle) * (x - cx) - Math.sin(angle) * (y - cy) + cx,
            y: Math.sin(angle) * (x - cx) + Math.cos(angle) * (y - cy) + cy
        });

        // Repère : Centre de la Traverse = X:0. Sol = Y:0
        let beamCenterY = postModel === 'y_shape' ? -postHeight + beamHeight / 2 : (traversePosition === 'top' ? -postHeight - beamHeight / 2 : -postHeight);
        const postX = -ecc; // Position du poteau par rapport à la traverse

        // 1. Poteaux & Massifs
        ctx.fillStyle = '#9ca3af'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
        const drawPostRect = (cx) => {
            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                activeSlope = (cx - postX) > 0.01 ? -slopeRad : ((cx - postX) < -0.01 ? slopeRad : 0);
            }
            
            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset') {
                c_b = c_b0;
            }

            const leftX = cx - postWidth / 2;
            const rightX = cx + postWidth / 2;
            
            let leftY = m_b * leftX + c_b;
            let rightY = m_b * rightX + c_b;

            if (postModel === 'y_shape' && Math.abs(cx - postX) < 0.01) {
                leftY = vertIntersectionY;
                rightY = vertIntersectionY;
            }

            // Pied posé sur le sol LOCAL du poteau (terrain réel).
            const solPiedY = solCoupeY(cx * scale);
            ctx.beginPath();
            ctx.moveTo(leftX * scale, solPiedY);
            ctx.lineTo(rightX * scale, solPiedY);
            ctx.lineTo(rightX * scale, rightY * scale);
            ctx.lineTo(leftX * scale, leftY * scale);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            
            // Massif béton
            if (appState.showFoundations) {
                ctx.fillStyle = '#d1d5db';
                ctx.beginPath(); ctx.rect((cx - postWidth) * scale, solCoupeY(cx * scale), postWidth * 2 * scale, 0.6 * scale);
                ctx.fill(); ctx.stroke(); 
                ctx.fillStyle = '#9ca3af';
            }
        };

        const getVertIntersectionY = () => {
            // Pour les modèles où le poteau n'est pas au centre de rotation de la traverse (double, offset),
            // on ajoute postX * tan(slope) pour coller exactement au bas de la traverse inclinée.
            // Pour y_shape (postX ≈ 0) et inclinedPost (postX ≈ 0), le terme s'annule.
            const activeSlope = postModel === 'y_shape' ? Math.abs(slopeRad) : slopeRad;
            return beamCenterY + postX * Math.tan(activeSlope) + (beamHeight / 2) / Math.cos(activeSlope);
        };
        const vertIntersectionY = getVertIntersectionY();

        const getExactIntersection = (baseX, angleDeg, targetX) => {
            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                const dxBase = baseX - postX;
                activeSlope = dxBase > 0 ? -slopeRad : slopeRad;
            }
            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset') {
                c_b = c_b0;
            }

            const forceOutward = (postModel === 'inclinedPost' || postModel === 'y_shape' || postModel === 'double' || postModel === 'offset');
            const angleRad = (forceOutward ? Math.abs(angleDeg) : -Math.abs(angleDeg)) * Math.PI / 180;
            const dir = baseX < targetX ? 1 : -1;
            const tanA = Math.tan(angleRad);
            
            let topX, topY;
            if (Math.abs(tanA) < 0.001) {
                topX = baseX;
                topY = m_b * topX + c_b;
            } else {
                const m_p = tanA / dir;
                topX = (c_b + m_p * baseX) / (m_p - m_b);
                topY = m_p * (topX - baseX);
            }
            return { topX, topY };
        };

        const drawInclinedPoleExact = (baseX, angleDeg, targetX) => {
            const { topX, topY } = getExactIntersection(baseX, angleDeg, targetX);
            const dx = postWidth / 2;

            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                activeSlope = (baseX - postX) > 0 ? -slopeRad : slopeRad;
            }
            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset') {
                c_b = c_b0;
            }

            const leftX = topX - dx;
            const rightX = topX + dx;
            const leftY = m_b * leftX + c_b;
            const rightY = m_b * rightX + c_b;

            // Pied posé sur le sol LOCAL (terrain réel), comme drawPostRect : sans ce décalage, le
            // poteau s'arrêtait au niveau de référence, au-dessus de son massif (bug rapporté).
            const piedY = solCoupeY(baseX * scale);
            ctx.beginPath();
            ctx.moveTo((baseX - dx) * scale, piedY); ctx.lineTo((baseX + dx) * scale, piedY);
            ctx.lineTo(rightX * scale, rightY * scale); ctx.lineTo(leftX * scale, leftY * scale);
            ctx.closePath(); ctx.fill(); ctx.stroke();

            if (appState.showFoundations) {
                ctx.fillStyle = '#d1d5db'; ctx.fillRect((baseX - postWidth) * scale, piedY, postWidth * 2 * scale, 0.6 * scale);
                ctx.strokeRect((baseX - postWidth) * scale, piedY, postWidth * 2 * scale, 0.6 * scale); ctx.fillStyle = '#9ca3af';
            }
        };

        const braceThickness = (values.braceThickness || 25) / 100;
        const drawObliqueBar = (x1, y1, x2, y2) => {
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const dx = (braceThickness / 2) * Math.sin(angle);
            const dy = (braceThickness / 2) * Math.cos(angle);
            ctx.fillStyle = '#6b7280'; ctx.strokeStyle = '#374151';
            ctx.beginPath();
            // Bornée au sol LOCAL (terrain réel) et non plus au niveau de référence.
            ctx.moveTo((x1 - dx) * scale, Math.min(solLocalM(x1 - dx), y1 + dy) * scale);
            ctx.lineTo((x1 + dx) * scale, Math.min(solLocalM(x1 + dx), y1 - dy) * scale);
            ctx.lineTo((x2 + dx) * scale, Math.min(solLocalM(x2 + dx), y2 - dy) * scale);
            ctx.lineTo((x2 - dx) * scale, Math.min(solLocalM(x2 - dx), y2 + dy) * scale);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#9ca3af';
        };

        const bracingPos = (values.bracing_position !== undefined ? values.bracing_position : 80) / 100.0;
        const incLeft = values.post_inclination_left !== undefined ? values.post_inclination_left : 65;
        const incRight = values.post_inclination_right !== undefined ? values.post_inclination_right : 65;

        if (postModel === 'inclinedPost') { // Modèle W 6 rangées Sud
            const distExt = (values.postSpacingInclined !== undefined ? values.postSpacingInclined : 3.24) / 2;
            drawObliqueBar(postX, vertIntersectionY * bracingPos, postX - distExt, solLocalM(postX - distExt)); // Z-index derrière
            drawObliqueBar(postX, vertIntersectionY * bracingPos, postX + distExt, solLocalM(postX + distExt));
            if (!appState.hideCentralPost) {
                drawPostRect(postX);
            }
            drawInclinedPoleExact(postX - distExt, incLeft, postX);
            drawInclinedPoleExact(postX + distExt, incRight, postX);
            drawDimensionLine(ctx, (postX - distExt) * scale, 0, (postX + distExt) * scale, 0, `Entraxe = ${(distExt * 2).toFixed(2)}m`, 20);
        } else if (postModel === 'y_shape') { // Modèle W 3 rangées EST-OUEST
            const distExt = (values.postSpacingInclined !== undefined ? values.postSpacingInclined : 3.23) / 2;
            drawObliqueBar(postX, vertIntersectionY * bracingPos, postX - distExt, solLocalM(postX - distExt));
            drawObliqueBar(postX, vertIntersectionY * bracingPos, postX + distExt, solLocalM(postX + distExt));
            drawPostRect(postX);
            drawInclinedPoleExact(postX - distExt, incLeft, postX);
            drawInclinedPoleExact(postX + distExt, incRight, postX);
            drawDimensionLine(ctx, (postX - distExt) * scale, 0, (postX + distExt) * scale, 0, `Entraxe = ${(distExt * 2).toFixed(2)}m`, 20);
        } else if (postModel === 'double' || postModel === 'offset') {
            const isV2 = (appState.doublePostBracing === 'v2');
            const dist = values.postSpacing !== undefined ? values.postSpacing : 1.61;
            
            let vertX, inclX;
            if (postModel === 'double') {
                if (isV2) {
                    vertX = (panelOffset - panelWidth / 2) + 1.45;
                    inclX = vertX + dist;
                } else {
                    vertX = postX;
                    inclX = postX + dist;
                }
            } else if (postModel === 'offset') {
                // Poteau vertical pile sous l'extrémité gauche de la traverse
                vertX = -beamLength / 2 + postWidth / 2;
                
                inclX = vertX + dist; // Toujours à droite, sous la traverse
            }
            
            const m_b = Math.tan(slopeRad);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(slopeRad);
            const vertIntersectionYExact = m_b * vertX + c_b0;
            
            drawObliqueBar(vertX, vertIntersectionYExact * bracingPos, inclX, solLocalM(inclX));
            drawPostRect(vertX);
            drawInclinedPoleExact(inclX, incLeft, vertX);
            drawDimensionLine(ctx, Math.min(vertX, inclX) * scale, 0, Math.max(vertX, inclX) * scale, 0, `Entraxe = ${dist.toFixed(2)}m`, 20);
        } else {
            drawPostRect(postX);
        }

        const drawRotatedRect = (cx, cy, w, h, angle, fillStyle, strokeStyle = '#374151') => {
            ctx.save(); ctx.translate(cx * scale, cy * scale); ctx.rotate(angle);
            ctx.fillStyle = fillStyle; ctx.strokeStyle = strokeStyle;
            ctx.beginPath(); ctx.rect(-w / 2 * scale, -h / 2 * scale, w * scale, h * scale);
            ctx.fill(); ctx.stroke(); ctx.restore();
        };

        // 3. Traverse, 4. Pannes, 5. Panneaux
        // Pannes fixées latéralement (dans la traverse) pour TOUS les modèles
        let purlinLocalY = 0; 

        const sides = postModel === 'y_shape' ? [1, -1] : [1];
        sides.forEach(side => {
            const currentSlope = postModel === 'y_shape' ? -slopeRad * side : slopeRad; // Pente en V
            // beamLength reçu du serveur est déjà la longueur d'un demi-rampant pour y_shape
            // (= panel_width/2 - overhang). On NE divise PAS à nouveau par 2.
            const currentBeamLength = beamLength;
            const currentPanelWidth = postModel === 'y_shape' ? (values.half_panel_width !== undefined ? values.half_panel_width : panelWidth / 2) : panelWidth;
            
            ctx.save();
            ctx.translate(0, beamCenterY * scale); // Rotation centrée au faîtage
            ctx.rotate(currentSlope);
            
            const offsetX = postModel === 'y_shape' ? side * (currentBeamLength / 2) : 0;
            const offsetPanelX = postModel === 'y_shape' ? side * (currentPanelWidth / 2) : panelOffset;

            // Traverse
            ctx.fillStyle = '#d1d5db'; ctx.strokeStyle = '#374151';
            ctx.beginPath(); ctx.rect((offsetX - currentBeamLength/2)*scale, -beamHeight/2*scale, currentBeamLength*scale, beamHeight*scale);
            ctx.fill(); ctx.stroke();

            // Pannes
            const pCount = postModel === 'y_shape' ? Math.max(2, Math.floor(purlinCount/2)) : purlinCount;
            let purlinCentersX = pCount === 1 ? [0] : Array.from({length: pCount}, (_, i) => -currentBeamLength/2 + i * (currentBeamLength / (pCount - 1)));
            purlinCentersX.forEach(px => {
                ctx.fillStyle = '#9ca3af';
                ctx.beginPath(); ctx.rect((offsetX + px - 0.05)*scale, (purlinLocalY - purlinHeight/2)*scale, 0.1*scale, purlinHeight*scale);
                ctx.fill(); ctx.stroke();
            });

            // Intégration
            const topOfStructureLocalY = -beamHeight / 2; // Sommet de la traverse
            const systemLocalY = topOfStructureLocalY - integrationHeight / 2;
            ctx.fillStyle = '#4b5563';
            ctx.beginPath(); ctx.rect((offsetPanelX - currentPanelWidth/2)*scale, (systemLocalY - integrationHeight/2)*scale, currentPanelWidth*scale, integrationHeight*scale);
            ctx.fill();

            // Panneaux
            const panelLocalY = systemLocalY - integrationHeight / 2 - panelThickness / 2;
            ctx.fillStyle = 'rgba(30, 41, 59, 1)'; ctx.strokeStyle = '#0f172a';
            ctx.beginPath(); ctx.rect((offsetPanelX - currentPanelWidth/2)*scale, (panelLocalY - panelThickness/2)*scale, currentPanelWidth*scale, panelThickness*scale);
            ctx.fill(); ctx.stroke();

            // Afficher la cotation Pente parallèle à la toiture
            ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(`Pente = ${roofSlope}°`, offsetPanelX * scale, (panelLocalY - panelThickness / 2) * scale - 10);

            ctx.restore();
        });

        // 6. Cotations
        ctx.save();
        const topOfStructureY = -beamHeight / 2;
        const panelLocalY = topOfStructureY - integrationHeight - panelThickness / 2;
        ctx.translate(0, (beamCenterY + panelLocalY - 0.7) * scale); 
        ctx.rotate(postModel === 'y_shape' ? -Math.abs(slopeRad) : slopeRad);
        if (postModel === 'y_shape') {
            // Chaque pan = panel_width / 2 ; afficher un seul pan (de l'apex vers l'extérieur)
            drawDimensionLine(ctx, 0, 0, panelWidth / 2 * scale, 0, `Larg. par pan = ${(panelWidth / 2).toFixed(2)}m`, 0);
        } else {
            drawDimensionLine(ctx, -panelWidth / 2 * scale, 0, panelWidth / 2 * scale, 0, `Larg. Rampant = ${panelWidth.toFixed(2)}m`, 0);
        }
        ctx.restore();

        const pt1 = rotatePt(-beamLength / 2, beamCenterY + beamHeight / 2, 0, beamCenterY, slopeRad);
        const pt2 = rotatePt(beamLength / 2, beamCenterY + beamHeight / 2, 0, beamCenterY, slopeRad);
        const lowestPoint = pt1.y > pt2.y ? pt1 : pt2;
        drawVerticalDimensionWithLeader(ctx, lowestPoint.x * scale, lowestPoint.y * scale, (lowestPoint.x + (Math.sign(slopeRad) >= 0 ? 1 : -1)) * scale, `H. Pass = ${passageHeight.toFixed(2)}m`, 0);

        // drawVerticalDimensionWithLeader(ctx, postX * scale, -postHeight * scale, (postX + postWidth / 2 + 0.8) * scale, `H. Poteau = ${postHeight.toFixed(2)}m`, 0);

        const pt3 = rotatePt(-panelWidth / 2, beamCenterY + panelLocalY, 0, beamCenterY, slopeRad);
        const pt4 = rotatePt(panelWidth / 2, beamCenterY + panelLocalY, 0, beamCenterY, slopeRad);
        const highestPoint = pt3.y < pt4.y ? pt3 : pt4;
        drawVerticalDimensionWithLeader(ctx, highestPoint.x * scale, highestPoint.y * scale, (highestPoint.x + (Math.sign(slopeRad) >= 0 ? -1 : 1)) * scale, `H. Max = ${highPointHeightValue.toFixed(2)}m`, 0);


        ctx.restore();

        const marginMeters = 1.0;
        return {
            minX: -panelWidth / 2 - marginMeters - Math.abs(ecc),
            maxX: panelWidth / 2 + marginMeters + Math.abs(ecc),
            minY: -highPointHeightValue - marginMeters,
            maxY: marginMeters
        };
    }

    function drawFacade(canvas, ctx, viewManager, values) {
        // Logique de dessin de la façade (conservée intégralement)
        const { postHeight, facadeLength, leftOverhang, rightOverhang, groundSlopeFacade, postWidth, panelWidth, roofSlope, invertSlope, lowPointHeight, alignRoof, pvLayout, baseAltimetry, purlinHeight } = values;
        const { width, height } = setupCanvas(canvas);
        if (width === 0 || height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- GESTION ERREUR GABARIT ---
        const errorDiv = document.getElementById('model-filter-error');
        if (errorDiv && !errorDiv.classList.contains('hidden')) {
            ctx.save();
            ctx.fillStyle = '#fef2f2';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("Configuration calepinage non conforme aux gabarits existants des ombrières Solumbra.", canvas.width / 2, canvas.height / 2 - 12);
            ctx.fillText("Veuillez contacter le fabricant de l’ombrière pour la prise en compte de votre calepinage hors catalogue.", canvas.width / 2, canvas.height / 2 + 12);
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);
        const distances = appState.parsedDistances;
        if (!distances) { ctx.restore(); return; }
        const effectivePanelWidth = appState.postModel === 'y_shape' ? panelWidth / 2 : panelWidth;
        const roofApparentHeight = Math.abs(effectivePanelWidth * Math.sin(roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1)));

        const totalDrawingWidth = facadeLength;
        // Terrain automatique : profil réel sous la façade (vue depuis le Sud par défaut).
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
        // Table RIGIDE calée sur les poteaux (cf. TerrainPlans.calerTable) : « Alignement toiture »
        // coché = horizontale, sinon elle suit la pente ; le poteau le plus contraint garde sa hauteur.
        const zSolFacadeM = (xM) => -getScaledGroundY(xM * scale) / scale;
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
        const calageFacade = (TPF && typeof TPF.calerTable === 'function')
            ? TPF.calerTable(postPositions.map((xPos) => ({ x: xPos, zSol: zSolFacadeM(xPos) })),
                             useRoofAlignment ? 'horizontal' : 'pente', 0)
            : null;
        const zTableFacadeM = calageFacade ? calageFacade.zTable : zSolFacadeM;
        const postTopY_at_0 = -(zTableFacadeM(0) + postHeight) * scale;
        postPositions.forEach(xPos => {
            const groundY = getScaledGroundY(xPos * scale);
            let postTopY, postH;
            postTopY = -(zTableFacadeM(xPos) + postHeight) * scale;
            postH = groundY - postTopY;
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
        let highPointHeightValue_Right = useRoofAlignment ? highPointHeightValue_Left - groundSlopeFacade : highPointHeightValue_Left;

        const dimOffsetLeft = (-2) * scale;
        const dimOffsetRight = facadeLength * scale + (2) * scale;

        drawVerticalDimensionWithLeader(ctx, 0, roofTopStartY, dimOffsetLeft, `${highPointHeightValue_Left.toFixed(2)}m`, getScaledGroundY(0));
        drawVerticalDimensionWithLeader(ctx, facadeLength * scale, roofTopEndY, dimOffsetRight, `${highPointHeightValue_Right.toFixed(2)}m`, getScaledGroundY(facadeLength * scale));

        // CORRECTIF (comme ombriere_metal.js) : en terrain automatique, altitudes du profil réel. Ces
        // deux champs passent alors en lecture seule et getFormValues les laisse en TEXTE : `.toFixed`
        // levait une exception qui arrêtait la façade avant ses repères altimétriques (erreur avalée
        // par scheduleUpdate), et `baseAltimetry + groundSlopeFacade` concaténait deux chaînes.
        const altimetryLeft = solFacadeAuto ? solFacadeAuto.zAbs(0) : (Number(baseAltimetry) || 0);
        const deniveleDroite = solFacadeAuto ? solFacadeAuto.zRel(facadeLength) : (Number(groundSlopeFacade) || 0);
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
        const minHeight = -postHeight - Math.abs(groundSlopeFacade) - 1.0;

        return {
            minX: postMinX - marginMeters,
            maxX: postMaxX + marginMeters,
            minY: -maxHeight - marginMeters, // Max Y (haut du dessin)
            maxY: 1.0 + Math.abs(groundSlopeFacade) + marginMeters // Min Y (bas du dessin)
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

        // --- GESTION ERREUR GABARIT ---
        const errorDiv = document.getElementById('model-filter-error');
        if (errorDiv && !errorDiv.classList.contains('hidden')) {
            ctx.save();
            ctx.fillStyle = '#fef2f2';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("Configuration calepinage non conforme aux gabarits existants des ombrières Solumbra.", canvas.width / 2, canvas.height / 2 - 12);
            ctx.fillText("Veuillez contacter le fabricant de l’ombrière pour la prise en compte de votre calepinage hors catalogue.", canvas.width / 2, canvas.height / 2 + 12);
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);

        // MOD 6.5: Utilisation de totalProjectionWidth
        const projectionWidth = totalProjectionWidth || panelWidth || 10;
        const absRoofSlopeRad = Math.abs(roofSlope * Math.PI / 180);

        const scale = Math.min(width / (facadeLength + 2), height / (projectionWidth + 2)) * 0.9;

        ctx.translate(-facadeLength * scale / 2, -projectionWidth * scale / 2);

        const midY = projectionWidth * scale / 2;

        // MOD 6.5: Dessin de l'implantation pour Y
        let spacing = 1.61;
        if (appState.postModel === 'inclinedPost' || appState.postModel === 'y_shape') {
            spacing = values.postSpacingInclined !== undefined ? values.postSpacingInclined : (appState.postModel === 'y_shape' ? 3.23 : 3.24);
        } else {
            spacing = values.postSpacing !== undefined ? values.postSpacing : 1.61;
        }

        let poleYCoords = [];
        if (appState.postModel === 'inclinedPost') {
            if (appState.hideCentralPost) {
                poleYCoords = [midY - (spacing - postWidth) * scale / 2, midY + (spacing - postWidth) * scale / 2];
            } else {
                poleYCoords = [midY - (spacing - postWidth) * scale / 2, midY, midY + (spacing - postWidth) * scale / 2];
            }
        } else if (appState.postModel === 'y_shape') {
            poleYCoords = [midY - (spacing - postWidth) * scale / 2, midY, midY + (spacing - postWidth) * scale / 2];
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 3;
            ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale / 2);
            ctx.strokeRect(0, projectionWidth * scale / 2, facadeLength * scale, projectionWidth * scale / 2);
        } else if (appState.postModel === 'double') {
            const sign = appState.doublePostBracing === 'v2' ? -1 : 1;
            poleYCoords = [midY, midY + sign * spacing * scale];
        } else if (appState.postModel === 'offset') {
            const sign = appState.doublePostBracing === 'v2' ? -1 : 1;
            poleYCoords = [midY, midY + sign * (spacing - postWidth) * scale];
        } else {
            poleYCoords = [midY];
        }

        if (appState.postModel !== 'y_shape') {
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale);
        }

        const postPositions = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang];

        ctx.save(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        const axisExtension = 80;

        poleYCoords.forEach(py => {
            ctx.beginPath(); ctx.moveTo(-axisExtension, py); ctx.lineTo(facadeLength * scale + axisExtension, py); ctx.stroke();
        });

        postPositions.forEach(xPos => { ctx.beginPath(); ctx.moveTo(xPos * scale, -axisExtension); ctx.lineTo(xPos * scale, projectionWidth * scale + axisExtension); ctx.stroke(); });
        ctx.restore();

        const postSize = postWidth * scale; ctx.fillStyle = '#6b7280';
        postPositions.forEach(xPos => {
            poleYCoords.forEach(py => {
                ctx.fillRect(xPos * scale - postSize / 2, py - postSize / 2, postSize, postSize);
            });
        });
        
        if (poleYCoords.length > 1) {
            const firstPostX = postPositions[0] * scale;
            const dimOffset = -30 - postSize;
            const min_y = Math.min(...poleYCoords);
            const max_y = Math.max(...poleYCoords);
            drawDimensionLine(ctx, firstPostX, min_y, firstPostX, max_y, `${((max_y - min_y)/scale).toFixed(2)}m`, dimOffset, true);
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
            expression = "1*7.5";
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
                    for (let i = 0; i < count; i++) distances.push(value);
                } else {
                    const val = parseFloat(seg);
                    if (isNaN(val)) throw new Error(`Valeur non numérique: "${seg}"`);
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
    /* ====   ALGORITHME DE CALCUL AUTOMATIQUE DE L'IMPLANTATION DES POTEAUX      ==== */
    /* ================================================================================ */
    /*
     * Détermine automatiquement le nombre de poteaux et leur entraxe le long de la
     * façade, à partir de la longueur totale de façade. Règles métier :
     *   - Porte-à-faux gauche ET droit fixes à 0.46 m (PAF_FIXE, cf. `paf` dans updateAppLogic).
     *   - Seuls les entraxes 5.3 / 7.2 / 7.5 / 7.8 / 8 m sont autorisés (plages de saisie
     *     valides : 4.9-5.7 m et 7.2-8.4 m).
     *   - PRIORITÉ : on maximise d'abord le nombre d'entraxes de 7.5 m, puis (à défaut) de
     *     7.2 m, puis de 5.3 m, puis de 7.8 m, puis de 8 m.
     *
     * Le résultat alimente le champ existant "Entraxes poteaux" (#postDistances, ex:
     * "5*7.5 + 1*5.3"), interprété tel quel par parsePostDistances()/updateAppLogic() :
     * aucune modification du pipeline de dessin n'est nécessaire.
     */
    const ENTRAXE_PRIORITY = [7.5, 7.2, 5.3, 7.8, 8];
    const PAF_FIXE = 0.46; // Porte-à-faux gauche ET droit, fixe (cf. champs cachés leftOverhang/rightOverhang)

    function computeOptimalPostLayout(facadeLength) {
        const EPS = 1e-6;
        let remaining = facadeLength - 2 * PAF_FIXE;
        const counts = {};
        if (remaining < -EPS) return { feasible: false, counts, missing: 0 };

        ENTRAXE_PRIORITY.forEach((val) => {
            const c = Math.max(0, Math.floor((remaining + EPS) / val));
            if (c > 0) counts[val] = c;
            remaining -= c * val;
        });

        return { feasible: true, counts, missing: Math.max(0, remaining) };
    }

    // Construit l'expression "Entraxes poteaux" (ex: "5*7.5 + 1*5.3") à partir du résultat
    // de computeOptimalPostLayout, dans l'ordre de priorité ENTRAXE_PRIORITY.
    function formatPostDistancesExpr(layout) {
        const parts = ENTRAXE_PRIORITY
            .filter((val) => layout.counts[val] > 0)
            .map((val) => `${layout.counts[val]}*${val}`);
        return parts.length ? parts.join(' + ') : '';
    }

    // Recalcule et remplit automatiquement le champ "Entraxes poteaux" avec l'entraxe optimal,
    // SAUF si l'utilisateur a lui-même déjà modifié ce champ (il reste alors éditable et sous
    // son contrôle : le champ ne doit jamais écraser une saisie manuelle).
    function autoFillOptimalEntraxe(facadeLength) {
        if (userEditedPostDistances) return;
        const postDistancesInput = document.getElementById('postDistances');
        if (!postDistancesInput) return;

        const layout = computeOptimalPostLayout(facadeLength);
        const expr = formatPostDistancesExpr(layout);
        if (!expr) return;

        if (postDistancesInput.value !== expr) {
            isAutoFillingPostDistances = true;
            postDistancesInput.value = expr;
            isAutoFillingPostDistances = false;
        }
        lastValidPostDistances = postDistancesInput.value;
    }

    function calculateOmbriereSolumbraLocal(data) {
        const postModel = data.post_model || "inclinedPost";
        const overhangType = data.overhang_type || "sym";
        let invertSlope = !!data.invert_slope;
        const offsetPostSide = data.offset_post_side || "center";

        let passageHeight = safeFloat(data.passage_height);
        let beamHeight = safeFloat(data.beam_height);
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

        let doublePostBracing = data.double_post_bracing || "v1";

        if (postModel === "inclinedPost") passageHeight = 3.0;
        else if (postModel === "y_shape") passageHeight = 2.60;

        if (["double", "simple_azelan", "simple_travolta", "simple_travolta_2"].includes(postModel)) {
            if (overhangSymValue === 0) overhangSymValue = 0.5;
            if (doublePostBracing === "v2") { passageHeight = 2.60; invertSlope = true; }
            else { passageHeight = 2.38; invertSlope = false; }
        } else if (postModel === "offset") {
            passageHeight = 2.60;
            invertSlope = (doublePostBracing === "v2");
        }

        let overhangH, overhangL;
        if (overhangType === "sym" || postModel === "y_shape") {
            overhangH = overhangL = overhangSymValue;
        } else {
            overhangH = overhangAsymHigh;
            overhangL = overhangAsymLow;
        }

        let beamLength = (postModel === "y_shape") ? (panelWidth / 2.0 - overhangSymValue) : (panelWidth - overhangH - overhangL);

        if (postModel === "offset") {
            let offsetVal = safeFloat(data.post_eccentricity, 2.0);
            let isLow = (offsetPostSide === "low");
            postEccentricity = (invertSlope ? isLow : !isLow) ? (beamLength / 2) - offsetVal : -(beamLength / 2) + offsetVal;
        } else if (postModel === "double") {
            postEccentricity = invertSlope ? -(panelWidth / 2) + 1.45 + (postWidth / 2) : (panelWidth / 2) - 1.45 - (postWidth / 2);
        } else {
            postEccentricity = 0;
        }

        let roofSlopeRadians = roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1);
        let newPostHeight = 0.0, beamCenterY = 0.0;

        let yLowestBeamPointRel = ((beamLength / 2) * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
        beamCenterY = -passageHeight - yLowestBeamPointRel;
        newPostHeight = -(beamCenterY + beamHeight / 2);

        let y1 = (-panelWidth / 2) * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);
        let y2 = (panelWidth / 2) * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);

        let totalProjectionWidth = panelWidth * Math.cos(Math.abs(roofSlopeRadians));
        let postSpacing = Math.min(safeFloat(data.post_spacing), Math.max(0.0, totalProjectionWidth - postWidth));
        let postSpacingInclined = Math.min(safeFloat(data.post_spacing_inclined), Math.max(0.0, totalProjectionWidth - postWidth));

        let distResult = parsePostDistances(data.post_distances_expr, facadeLength, leftOverhang, rightOverhang);

        let coupe_entraxe = 1.92;
        if (postModel === "inclinedPost") coupe_entraxe = 2.30;
        else if (postModel === "y_shape") coupe_entraxe = 2.54;

        return {
            ...data,
            low_point_height: -(beamCenterY + Math.max(y1, y2)),
            post_height: newPostHeight,
            high_point_height: -(beamCenterY + Math.min(y1, y2)),
            beam_length: beamLength,
            total_projection_width: totalProjectionWidth,
            post_eccentricity_clamped: postEccentricity,
            eccentricity_error: "",
            post_distances: distResult.distances,
            post_positions_x: distResult.positions_x,
            post_distances_error: distResult.error,
            post_distances_warning: distResult.warning,
            right_overhang: distResult.right_overhang !== undefined ? distResult.right_overhang : rightOverhang,
            coupe_entraxe: coupe_entraxe,
            post_spacing: postSpacing,
            post_spacing_inclined: postSpacingInclined,
            invert_slope: invertSlope
        };
    }

    async function updateAppLogic() {
        let values = getFormValues();
        let currentValuesStr = JSON.stringify(values);

        // --- LOCAL CALCULATION FOR FACADE ---
        const facadeLength = parseFloat(document.getElementById('facadeLength')?.value) || 0;
        autoFillOptimalEntraxe(facadeLength); // Implantation auto des poteaux (sauf si l'utilisateur a déjà édité le champ)
        const postDistancesStr = document.getElementById('postDistances')?.value || "";
        let sumEntraxes = 0, isValidFormat = true, entraxes = [], postPositionsX = [];
        
        if (postDistancesStr.trim() !== "") {
            try {
                postDistancesStr.replace(/,/g, '+').split('+').forEach(p => {
                    p = p.trim(); if(!p) return;
                    if(p.includes('*')) {
                        const [c, v] = p.split('*').map(s => s.trim());
                        const count = parseInt(c), val = parseFloat(v);
                        if(isNaN(count) || isNaN(val)) throw new Error("Format invalide");
                        sumEntraxes += count * val;
                        for(let i=0; i<count; i++) entraxes.push(val);
                    } else {
                        const val = parseFloat(p); if(isNaN(val)) throw new Error("Format invalide");
                        sumEntraxes += val; entraxes.push(val);
                    }
                });
            } catch(e) { isValidFormat = false; }
        }

        let entraxeError = entraxes.reduce((err, v) => err || (!((v >= 4.9 && v <= 5.7) || (v >= 7.2 && v <= 8.4)) ? `L'entraxe de ${v}m est hors plage.` : ""), "");
        
        const paf = 0.46; // Porte-à-faux fixe et absolu à 0.46m
        let pafError = (sumEntraxes > facadeLength) ? "Somme entraxes > longueur totale." : "";

        // 3. Affichage du calcul des entraxes et longueur manquante
        const infoDiv = document.getElementById('postDistancesInfo');
        if (infoDiv) {
            if (isValidFormat) {
                const missingLength = facadeLength - sumEntraxes - (2 * paf);
                infoDiv.innerHTML = `Calcul : ${facadeLength.toFixed(2)}m (Total) - 2 × ${paf.toFixed(2)}m (PAF) - ${sumEntraxes.toFixed(2)}m (Entraxes) = <strong>${missingLength.toFixed(2)}m (Manquant)</strong>`;
            } else {
                infoDiv.innerHTML = "";
            }
        }

        const validationErrorDiv = document.getElementById('validationError');
        const facadeErrors = [!isValidFormat ? "Format d'entraxes invalide." : "", entraxeError, pafError].filter(Boolean);
        if (facadeErrors.length > 0) {
            if (validationErrorDiv) { validationErrorDiv.innerHTML = facadeErrors.join('<br>'); validationErrorDiv.style.display = 'block'; }
            if (currentCalculatedValues) return currentCalculatedValues; // Block update on error
        } else {
            if (validationErrorDiv) { validationErrorDiv.style.display = 'none'; }
        }

        if (isValidFormat && paf >= 0) {
            let current_x = paf;
            postPositionsX.push(current_x);
            entraxes.forEach(d => { current_x += d; postPositionsX.push(current_x); });
        }
        appState.parsedDistances = entraxes;
        appState.postPositionsX = postPositionsX;
        
        values.leftOverhang = paf;
        values.rightOverhang = paf;
        const pafDisplayEl = document.getElementById('paf_display');
        if (pafDisplayEl) pafDisplayEl.value = paf.toFixed(2);
        // --- END LOCAL CALCULATION ---

        if (currentValuesStr === lastFormValuesStr && currentCalculatedValues) return currentCalculatedValues;
        lastFormValuesStr = currentValuesStr;
        
        let incLeft = 68, incRight = 68;
        if (appState.postModel === 'inclinedPost' || appState.postModel === 'y_shape') {
            incLeft = parseFloat(document.getElementById('postInclinationLeft')?.value) || 68;
            incRight = parseFloat(document.getElementById('postInclinationRight')?.value) || 68;
        } else {
            const incSingle = parseFloat(document.getElementById('postInclinationSingle')?.value) || 68;
            incLeft = incSingle;
            incRight = incSingle;
        }

        // Appel API pour tous les calculs
        let _r;
        try {
            _r = calculateOmbriereSolumbraLocal({
                post_model:               appState.postModel,
                traverse_position:        appState.traversePosition,
                overhang_type:            appState.overhangType,
                invert_slope:             appState.invertSlope,
                hide_central_post:        appState.hideCentralPost,
                offset_post_side:         appState.offsetPostSide,
                double_post_bracing:      appState.doublePostBracing,
                show_double_bracing:      appState.showDoubleBracing,
                passage_height:           values.passageHeight,
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
                post_inclination_left:    incLeft,
                post_inclination_right:   incRight,
                bracing_position:         parseFloat(document.getElementById('bracingPosition')?.value) || 80,
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
                braceThickness:           values.braceThickness,
            });

            // Réinitialiser le message d'erreur si tout est OK
            const errorDiv = document.getElementById('validationError');
            if (errorDiv) errorDiv.textContent = '';

        } catch (_e) {
            console.error('Erreur API ombriere/calculate:', _e);
            // Définition de valeurs de secours pour éviter le plantage du dessin
            // si le backend Python n'est pas allumé ou injoignable
            values.lowPointHeight = parseFloat(values.lowPointHeight) || 0;
            values.postHeight = parseFloat(values.postHeight) || 0;
            values.beamLength = appState.postModel === 'y_shape' ? (values.panelWidth / 2) - (values.overhangSymValue || 0.5) : values.panelWidth;
            values.totalProjectionWidth = values.panelWidth || 0;
            values.overhangH = values.overhangSymValue || 0;
            values.overhangL = values.overhangSymValue || 0;
            values.postModel = appState.postModel;
            currentCalculatedValues = values;
            return values;
        }

        // Mise à jour des champs readonly dans le DOM (seulement si succès)
        document.getElementById('lowPointHeight').value = _r.low_point_height.toFixed(2);
        values.lowPointHeight = _r.low_point_height;

        document.getElementById('postHeight').value = _r.post_height.toFixed(2);
        values.postHeight = _r.post_height;

        // Mise à jour erreur excentrement
        const _eccErr = document.getElementById('postEccentricityError');
        if (_eccErr) _eccErr.textContent = _r.eccentricity_error || '';

        if (appState.postModel === 'offset' || appState.postModel === 'double') {
            if (_r.post_eccentricity_clamped !== undefined) {
                values.postEccentricity = _r.post_eccentricity_clamped;
            }
        }

        if (_r.invert_slope !== undefined) {
            appState.invertSlope = _r.invert_slope;
            values.invertSlope = _r.invert_slope;
            const btnInvert = document.getElementById('toolInvertSlope');
            if (btnInvert) btnInvert.classList.toggle('active', appState.invertSlope);
            
            const btnD = document.getElementById('btnInvertSlopeDouble');
            if (btnD) btnD.classList.toggle('active', appState.invertSlope);
            
            const btnO = document.getElementById('btnInvertSlopeOffset');
            if (btnO) btnO.classList.toggle('active', appState.invertSlope);
        }

        // Résultats géométriques
        values.beamLength           = _r.beam_length;
        values.post_inclination_left = _r.post_inclination_left;
        values.post_inclination_right = _r.post_inclination_right;
        values.bracing_position     = _r.bracing_position;
        values.totalProjectionWidth = _r.total_projection_width;
        values.overhangH            = _r.overhang_h;
        values.overhangL            = _r.overhang_l;
        values.high_point_height    = _r.high_point_height;
        values.drawing              = _r.drawing;
        
        values.postModel            = _r.post_model || appState.postModel;
        values.coupe_entraxe        = _r.coupe_entraxe;
        values.half_panel_width     = _r.half_panel_width;

        values.heightUnderBrace = parseFloat(document.getElementById('heightUnderBrace').value);


        currentCalculatedValues = values;
        return values;
    }

    async function runAllDrawings() {
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
            const ctx = tmp.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tmp.width, tmp.height);
            ctx.drawImage(c, 0, 0);
            // CORRECTIF : rogner les marges blanches (cf. getCroppedCanvas, déjà utilisée par
            // l'export PDF autonome) avant sauvegarde dans geometriePlansData — sinon l'image
            // conservait de larges marges vides autour du contenu réel, qui apparaissait alors en
            // miniature une fois mise à l'échelle dans le rapport global (ExportService.js).
            const cropped = getCroppedCanvas(tmp) || tmp;
            return cropped.toDataURL('image/jpeg', 0.85);
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
            ombriereType: 'solumbra',         // ← 'bois' dans ombriere_bois.js, 'solumbra' dans ombriere_solumbra.js
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

    const heightUnderBraceInput = document.getElementById('heightUnderBrace');

    const coupeViewManager = new ViewManager(document.getElementById('coupeCanvas'), drawCoupe);
    const facadeViewManager = new ViewManager(document.getElementById('facadeCanvas'), drawFacade);
    const implantationViewManager = new ViewManager(document.getElementById('implantationCanvas'), drawImplantation);
    // Dossier de plans « Ombrières » (geometrie_structure/ombrieres/dossier_plans/iframe/
    // pont_dossier_ombriere.js) : fonctions de dessin rejouées par l'enregistreur vectoriel
    // (enregistreur_vectoriel.js), et redessin complet à la demande.
    window.__ombriereExports = {
        type: 'solumbra', drawCoupe, drawFacade, coupeViewManager, facadeViewManager, appState,
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

    document.querySelectorAll('.all-inputs').forEach(input => input.addEventListener('input', (e) => {
        
        // 2. Entraxes poteaux : la validation stricte (avec rejet) se fait au 'change' (voir plus
        // bas, listener dédié sur #postDistances), pas ici sur 'input'. Rejeter dès l'événement
        // 'input' bloquait la saisie en cours de frappe : ex. taper "7.50" passe par l'état
        // intermédiaire "7", qui est hors des deux plages autorisées (4.9-5.7 / 7.2-8.4) et se
        // faisait donc effacer avant même que l'utilisateur ait fini de taper.
        if (input.id === 'postDistances') {
            if (!isAutoFillingPostDistances) userEditedPostDistances = true;
        }

        // 1. Validation stricte du Dénivelé du terrain
        if (input.id === 'groundSlopeFacade') {
            const val = parseFloat(input.value);
            if (val < -3 || val > 3) {
                input.setCustomValidity("Le dénivelé du terrain doit être compris entre -3 et +3 m.");
                input.reportValidity();
                input.value = input.defaultValue; // Rejet strict : on force le retour à la valeur par défaut
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    scheduleUpdate();
                    setTimeout(adjustCanvasHeights, 50);
                }, 300);
                return; // Bloque le redessin si la valeur est invalide
            } else {
                input.setCustomValidity('');
            }
        }

        // 2. Validation stricte de l'Altimétrie
        if (input.id === 'baseAltimetry') {
            const val = parseFloat(input.value);
            if (val < 0 || val >= 1800) {
                input.setCustomValidity("L'altimétrie doit être supérieure ou égale à 0 et strictement inférieure à 1800 m.");
                input.reportValidity();
                input.value = input.defaultValue; // Rejet strict : on force le retour à la valeur par défaut
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    scheduleUpdate();
                    setTimeout(adjustCanvasHeights, 50);
                }, 300);
                return; // Bloque le redessin si la valeur est invalide
            } else {
                input.setCustomValidity('');
            }
        }
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            scheduleUpdate();
            setTimeout(adjustCanvasHeights, 50);
        }, 300);
    }));

    // Validation stricte des entraxes poteaux, au 'change' (blur / Entrée / fin de saisie) :
    // rejet si un terme est hors des plages autorisées (4.9-5.7 ou 7.2-8.4), avec retour à la
    // DERNIÈRE VALEUR VALIDE (lastValidPostDistances) plutôt qu'à la valeur par défaut figée du
    // HTML, pour ne pas perdre la saisie de l'utilisateur en cours de session.
    const postDistancesEl = document.getElementById('postDistances');
    if (postDistancesEl) {
        postDistancesEl.addEventListener('change', () => {
            const val = postDistancesEl.value || "";
            let isOutOfRange = false;
            if (val.trim() !== "") {
                try {
                    val.replace(/,/g, '+').split('+').forEach(p => {
                        p = p.trim(); if (!p) return;
                        let v = NaN;
                        if (p.includes('*')) {
                            const parts = p.split('*').map(s => s.trim());
                            v = parseFloat(parts[1]);
                        } else {
                            v = parseFloat(p);
                        }
                        if (!isNaN(v) && !((v >= 4.9 && v <= 5.7) || (v >= 7.2 && v <= 8.4))) {
                            isOutOfRange = true;
                        }
                    });
                } catch (e) {}
            }
            if (isOutOfRange) {
                postDistancesEl.setCustomValidity("L'entraxe de poteaux doit être dans les plages définies (4.9-5.7 ou 7.2-8.4).");
                postDistancesEl.reportValidity();
                postDistancesEl.value = lastValidPostDistances;
            } else {
                postDistancesEl.setCustomValidity('');
                lastValidPostDistances = val;
            }
            scheduleUpdate();
            setTimeout(adjustCanvasHeights, 50);
        });
    }

    document.querySelectorAll('.project-inputs').forEach(input => input.addEventListener('input', () => {
        // Pas de redessin nécessaire pour les champs de projet
    }));

    const toggleSlope = (e) => {
        if (e) e.preventDefault();
        appState.invertSlope = !appState.invertSlope;
        
        const btnInvert = document.getElementById('toolInvertSlope');
        if (btnInvert) btnInvert.classList.toggle('active', appState.invertSlope);
        
        const btnD = document.getElementById('btnInvertSlopeDouble');
        if (btnD) btnD.classList.toggle('active', appState.invertSlope);
        
        const btnO = document.getElementById('btnInvertSlopeOffset');
        if (btnO) btnO.classList.toggle('active', appState.invertSlope);
        
        scheduleUpdate();
    };
    
    document.getElementById('toolInvertSlope').addEventListener('click', toggleSlope);
    const btnSlopeD = document.getElementById('btnInvertSlopeDouble');
    if (btnSlopeD) btnSlopeD.addEventListener('click', toggleSlope);
    const btnSlopeO = document.getElementById('btnInvertSlopeOffset');
    if (btnSlopeO) btnSlopeO.addEventListener('click', toggleSlope);

    document.getElementById('toolPosTraverseTop').addEventListener('click', () => { appState.traversePosition = 'top'; document.getElementById('toolPosTraverseTop').classList.add('active'); document.getElementById('toolPosTraverseSide').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolPosTraverseSide').addEventListener('click', () => { appState.traversePosition = 'side'; document.getElementById('toolPosTraverseSide').classList.add('active'); document.getElementById('toolPosTraverseTop').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolDimColors').addEventListener('click', (e) => {
        const btn = e.target.closest('.dim-color-btn'); if (!btn) return;
        appState.dimensionColor = btn.dataset.color;
        document.querySelectorAll('.dim-color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); scheduleUpdate();
    });

    document.getElementById('toggleBraceLeft').addEventListener('click', e => { appState.showBraceLeft = !appState.showBraceLeft; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toggleBraceRight').addEventListener('click', e => { appState.showBraceRight = !appState.showBraceRight; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });

    document.querySelectorAll('#offset-variant-group button').forEach(btn => btn.addEventListener('click', e => {
        appState.doublePostBracing = e.currentTarget.id.replace('offsetBracing', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#offset-variant-group button'));
        
        if (appState.postModel === 'offset') {
            const isV2 = (appState.doublePostBracing === 'v2');
            const asymBtn = document.getElementById('overhangAsym');
            if (asymBtn && !asymBtn.classList.contains('active')) asymBtn.click();
            
            const oH = document.getElementById('overhangAsymHigh');
            const oL = document.getElementById('overhangAsymLow');
            if (oH && oL) {
                oH.value = isV2 ? 0.45 : 0;
                oL.value = isV2 ? 0 : 0.45;
                oH.dispatchEvent(new Event('input', { bubbles: true }));
                oL.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        
        scheduleUpdate();
    }));
    document.querySelectorAll('#bracing-variant-group button').forEach(btn => btn.addEventListener('click', e => {
        appState.doublePostBracing = e.currentTarget.id.replace('bracing', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#bracing-variant-group button'));
        
        if (appState.postModel === 'double') {
            const isV2 = (appState.doublePostBracing === 'v2');
            
            // Inverser la pente de la toiture
            if (appState.invertSlope !== isV2) {
                appState.invertSlope = isV2;
                const btnInvert = document.getElementById('toolInvertSlope');
                if (btnInvert) btnInvert.classList.toggle('active', appState.invertSlope);
                const btnD = document.getElementById('btnInvertSlopeDouble');
                if (btnD) btnD.classList.toggle('active', appState.invertSlope);
                const btnO = document.getElementById('btnInvertSlopeOffset');
                if (btnO) btnO.classList.toggle('active', appState.invertSlope);
            }
            
            // Ajuster les asymétries de toiture
            const asymBtn = document.getElementById('overhangAsym');
            if (asymBtn && !asymBtn.classList.contains('active')) asymBtn.click();
            
            const oH = document.getElementById('overhangAsymHigh');
            const oL = document.getElementById('overhangAsymLow');
            if (oH && oL) {
                oH.value = isV2 ? 0 : 0.45;
                oL.value = isV2 ? 0.45 : 0;
                oH.dispatchEvent(new Event('input', { bubbles: true }));
                oL.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        
        scheduleUpdate();
    }));

    document.getElementById('showDoubleBracing').addEventListener('change', e => { appState.showDoubleBracing = e.target.checked; scheduleUpdate(); });

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
    
    const setDefaultsParModeles = () => {
        const beamHeightEl = document.getElementById('beamHeight'); if(beamHeightEl) beamHeightEl.value = 0.3;
        const purlinHeightEl = document.getElementById('purlinHeight'); if(purlinHeightEl) purlinHeightEl.value = 0.3;
        const overhangSymEl = document.getElementById('overhangSymValue'); if(overhangSymEl) overhangSymEl.value = 0.5;
        const bracingPosEl = document.getElementById('bracingPosition'); if(bracingPosEl) bracingPosEl.value = 80;
        const incLeftEl = document.getElementById('postInclinationLeft'); if (incLeftEl) incLeftEl.value = 68;
        const incRightEl = document.getElementById('postInclinationRight'); if (incRightEl) incRightEl.value = 68;
        const incSingleEl = document.getElementById('postInclinationSingle'); if (incSingleEl) incSingleEl.value = 68;
        const incInclinedEl = document.getElementById('postInclinationInclined'); if (incInclinedEl) incInclinedEl.value = 68;
    };

    const updateFieldVisibility = (model) => {
        const dualGroup = document.getElementById('dual-inclination-group');
        const singleGroup = document.getElementById('single-inclination-group');
        if (dualGroup) dualGroup.style.display = 'none';
        if (singleGroup) singleGroup.style.display = 'none';
    };

    // --- MODÈLES STANDARDS ---
    [
        document.getElementById('modelInclinedPost'),
        document.getElementById('modelOffsetPost'),
        document.getElementById('modelDoublePost')
    ].filter(Boolean).forEach(btn => { // filter(Boolean) empêche le JS de crasher si un bouton HTML est supprimé

        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.id;
            let targetModel = 'double'; // Fallback par défaut
            if (id === 'modelOffsetPost') {
                targetModel = 'offset';
                appState.offsetPostSide = 'low'; // Force la position sur Bas par défaut
                const psInput = document.getElementById('postSpacing'); if (psInput) psInput.value = 1.61;
                setTimeout(() => {
                    const asymBtn = document.getElementById('overhangAsym');
                    if (asymBtn && !asymBtn.classList.contains('active')) asymBtn.click();
                    const isV2 = (appState.doublePostBracing === 'v2');
                    const oH = document.getElementById('overhangAsymHigh');
                    const oL = document.getElementById('overhangAsymLow');
                    if (oH && oL) {
                        oH.value = isV2 ? 0.45 : 0;
                        oL.value = isV2 ? 0 : 0.45;
                        oH.dispatchEvent(new Event('input', { bubbles: true }));
                        oL.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, 50);
            }

            if (id === 'modelDoublePost') { targetModel = 'double'; const psInput = document.getElementById('postSpacing'); if (psInput) psInput.value = 1.61; }
            if (id === 'modelInclinedPost') { targetModel = 'inclinedPost'; const psiInput = document.getElementById('postSpacingInclined'); if (psiInput) psiInput.value = 3.24; }

            appState.postModel = targetModel;

            if (targetModel === 'offset') {
                document.getElementById('postEccentricity').value = 2.0;
                appState.doublePostBracing = 'v1';
                const _obv1 = document.getElementById('offsetBracingV1');
                const _obv2 = document.getElementById('offsetBracingV2');
                if (_obv1) _obv1.classList.add('active');
                if (_obv2) _obv2.classList.remove('active');
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls]);
            } else if (targetModel === 'double') {
                document.getElementById('postEccentricity').value = 0;
                setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
            } else if (targetModel === 'inclinedPost') {
                document.getElementById('postEccentricity').value = 0;
                document.getElementById('postInclinationInclined').value = 65;
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('inclinedPostControls'), inclinedPostCanvasControls], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);
            } else {
                document.getElementById('postEccentricity').value = 0;
                setupToggleButton(e.currentTarget, allModelButtons, null, [...allModelControls, document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
            }

            setDefaultsParModeles();
            updateFieldVisibility(targetModel);
            if (targetModel === 'double') {
                const overhangSymEl = document.getElementById('overhangSymValue'); if(overhangSymEl) overhangSymEl.value = 0.5;
            }
            setOverhangControlsEnabled(true);
            scheduleUpdate().then(adjustCanvasHeights);
        });
    });
    document.getElementById('modelDoublePost').addEventListener('click', (e) => {
        appState.postModel = 'double';

        document.getElementById('postEccentricity').value = 0;
        // SUPPRIMÉ : document.getElementById('panelWidth').value = 12.40;
        setDefaultsParModeles();
        updateFieldVisibility('double');
        
        setTimeout(() => {
            const asymBtn = document.getElementById('overhangAsym');
            if (asymBtn && !asymBtn.classList.contains('active')) asymBtn.click();
            const oH = document.getElementById('overhangAsymHigh');
            if (oH) {
                oH.value = 0.45;
                oH.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 50);

        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
        scheduleUpdate().then(adjustCanvasHeights);
    });

    document.getElementById('modelInclinedPost').addEventListener('click', (e) => {
        appState.postModel = 'inclinedPost';
        const psInput = document.getElementById('postSpacing'); if (psInput) psInput.value = 1.61;
        const psiInput = document.getElementById('postSpacingInclined'); if (psiInput) psiInput.value = 3.24;

        document.getElementById('postEccentricity').value = 0;
        
        // MOD: Valeurs par défaut demandées pour W 6 rangées
        const panelWidthEl = document.getElementById('panelWidth'); if (panelWidthEl) panelWidthEl.value = 10.57;
        const roofSlopeEl = document.getElementById('roofSlope'); if (roofSlopeEl) roofSlopeEl.value = 8;
        const passageHeightEl = document.getElementById('passageHeight'); if (passageHeightEl) passageHeightEl.value = 2.62;
        
        setDefaultsParModeles();
        updateFieldVisibility('inclinedPost');
        document.getElementById('overhangSym').click();

        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('inclinedPostControls'), inclinedPostCanvasControls], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);

        heightUnderBraceInput.value = "2.0";

        scheduleUpdate().then(adjustCanvasHeights);
    });
    document.getElementById('modelYShape').addEventListener('click', (e) => {
        appState.postModel = 'y_shape';
        document.getElementById('postEccentricity').value = 0;
        const psiInput = document.getElementById('postSpacingInclined'); if (psiInput) psiInput.value = 3.23;

        // MOD: Valeurs par défaut pour W 3 rangées E-O
        const panelWidthEl = document.getElementById('panelWidth'); if (panelWidthEl) panelWidthEl.value = 10.57;
        const roofSlopeEl = document.getElementById('roofSlope'); if (roofSlopeEl) roofSlopeEl.value = 8;
        const passageHeightEl = document.getElementById('passageHeight'); if (passageHeightEl) passageHeightEl.value = 2.62;
        
        setDefaultsParModeles();
        updateFieldVisibility('y_shape');
        document.getElementById('overhangSym').click();

        appState.traversePosition = 'side';
        document.getElementById('toolPosTraverseSide').classList.add('active');
        document.getElementById('toolPosTraverseTop').classList.remove('active');

        heightUnderBraceInput.value = "2.0";
        heightUnderBraceInput.readOnly = false;

        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        setOverhangControlsEnabled(false);

        setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('offsetBraceControls'), document.getElementById('inclinedPostControls')], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), inclinedPostCanvasControls]);
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
    document.getElementById('tabPlanMasse').addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget, e.isTrusted));
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

        // Implantation initiale des poteaux : calcul automatique à partir de la longueur de
        // façade courante (le champ reste éditable, cf. autoFillOptimalEntraxe).
        const postDistancesInput = document.getElementById('postDistances');
        if (postDistancesInput && !postDistancesInput.value) {
            const facadeLengthAtLoad = parseFloat(document.getElementById('facadeLength')?.value) || 0;
            autoFillOptimalEntraxe(facadeLengthAtLoad);
        }
        lastValidPostDistances = postDistancesInput ? postDistancesInput.value : lastValidPostDistances;

        document.querySelector('.dim-color-btn[data-color="#0000FF"]').classList.add('active');

        // Supprimer les boutons de types de renfort (si toujours présents dans le HTML)
        const reinforceBraconsBtn = document.getElementById('reinforceBracons');
        const reinforceJarretsBtn = document.getElementById('reinforceJarrets');
        if (reinforceBraconsBtn) reinforceBraconsBtn.remove();
        if (reinforceJarretsBtn) reinforceJarretsBtn.remove();

        // Placer le bouton "6 rangées sud" (modelInclinedPost) avant "Simples 3 rangées" (modelOffsetPost)
        const modelInclinedPostBtn = document.getElementById('modelInclinedPost');
        const modelOffsetPostBtn = document.getElementById('modelOffsetPost');
        if (modelInclinedPostBtn && modelOffsetPostBtn && modelInclinedPostBtn.parentNode === modelOffsetPostBtn.parentNode) {
            modelOffsetPostBtn.parentNode.insertBefore(modelInclinedPostBtn, modelOffsetPostBtn);
        }

        // 2. FORCER LE MODÈLE PAR DÉFAUT
        const btnDouble = document.getElementById('modelInclinedPost') || document.getElementById('modelDoublePost');
        if (btnDouble) btnDouble.click();
        updateFieldVisibility(appState.postModel);

        // 3. Forcer l'onglet Plan de coupe au démarrage (CORRECTIF, demande explicite : anciennement
        // Calepinage — "Plan de coupe" est désormais l'onglet actif par défaut).
        const tabCoupeDefault3 = document.getElementById('tabCoupe');
        if (tabCoupeDefault3) {
            switchTab('.tab-group-1', '.tab-content-1', tabCoupeDefault3);
        }
        // ---------------------------------------------

        document.getElementById('overhangSym').click();
        adjustCanvasHeights();

        // Gestion du masquage poteau central
        const checkPanel = document.getElementById('hideCentralPost');
        const checkCanvas = document.getElementById('hideCentralPostCanvas');
        if (checkPanel && checkCanvas) {
            checkPanel.checked = appState.hideCentralPost;
            checkCanvas.checked = appState.hideCentralPost;
            checkPanel.addEventListener('change', () => { checkCanvas.checked = checkPanel.checked; appState.hideCentralPost = checkPanel.checked; scheduleUpdate(); });
            checkCanvas.addEventListener('change', () => {
                checkPanel.checked = checkCanvas.checked;
                appState.hideCentralPost = checkCanvas.checked;
                scheduleUpdate();
            });
        }

        // Bouton afficher/masquer les fondations
        const toggleFoundationsBtn = document.getElementById('toggleFoundations');
        if (toggleFoundationsBtn) {
            toggleFoundationsBtn.addEventListener('click', (e) => {
                appState.showFoundations = !appState.showFoundations;
                if (appState.showFoundations) {
                    e.currentTarget.textContent = "Masquer les fondations";
                    e.currentTarget.classList.add('bg-red-600', 'hover:bg-red-700');
                    e.currentTarget.classList.remove('bg-gray-400', 'hover:bg-gray-500');
                } else {
                    e.currentTarget.textContent = "Afficher les fondations";
                    e.currentTarget.classList.remove('bg-red-600', 'hover:bg-red-700');
                    e.currentTarget.classList.add('bg-gray-400', 'hover:bg-gray-500');
                }
                const btnCanvas = document.getElementById('toggleFoundationsCanvas');
                if (btnCanvas) btnCanvas.classList.toggle('active', !appState.showFoundations);
                scheduleUpdate();
            });
        }

        const toggleFoundationsCanvasBtn = document.getElementById('toggleFoundationsCanvas');
        if (toggleFoundationsCanvasBtn) {
            toggleFoundationsCanvasBtn.addEventListener('click', (e) => {
                appState.showFoundations = !appState.showFoundations;
                e.currentTarget.classList.toggle('active', !appState.showFoundations);
                
                const toggleFoundationsBtn = document.getElementById('toggleFoundations');
                if (toggleFoundationsBtn) {
                    if (appState.showFoundations) {
                        toggleFoundationsBtn.textContent = "Masquer les fondations";
                        toggleFoundationsBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                        toggleFoundationsBtn.classList.remove('bg-gray-400', 'hover:bg-gray-500');
                    } else {
                        toggleFoundationsBtn.textContent = "Afficher les fondations";
                        toggleFoundationsBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
                        toggleFoundationsBtn.classList.add('bg-gray-400', 'hover:bg-gray-500');
                    }
                }
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
        const _pvIdSolumbra = new URLSearchParams(window.location.search).get('pvId');
        const roofSlopeEl = document.getElementById('roofSlope');
        if (roofSlopeEl) {
            roofSlopeEl.addEventListener('input', function () {
                const val = parseFloat(this.value);
                if (!isNaN(val) && window.parent !== window) {
                    window.parent.postMessage({ action: 'updateCalepinageField', fieldName: 'inclinaison', value: val, pvId: _pvIdSolumbra }, '*');
                    const iframe = document.getElementById('iframeCalepinage');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({ type: 'SET_INCLINAISON', value: val }, '*');
                    }
                }
            });
        }
    })();

});