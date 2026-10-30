document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL VARIABLES & APP STATE ---
    let map;
    let appState = {
        postModel: 'inclinedPost',
        purlinsPosition: 'side',
        overhangType: 'sym',
        dimensionColor: '#0000FF',
        invertSlope: false,
        parsedDistances: [],
        offsetPostSide: 'center',
        showBraceLeft: true,
        showBraceRight: true,
        doublePostBracing: 'v1',
        showDoubleBracing: true,
        hideCentralPost: true,
        isAncrageActive: true,
        fabricant: 'piveteau',
    };
    let isUpdateScheduled = false;
    let lastValidPostDistances = document.getElementById('postDistances').value;
    // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : tant que l'utilisateur n'a pas
    // lui-même modifié #postDistances, ce champ est recalculé automatiquement (cf. ombriere_metal.js).
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
        console.warn("Éléments du modal de lancement non trouvés ! Affichage forcé de l'interface.");
        // Si le modal de bienvenue n'existe pas, on affiche l'app par défaut pour que les Canvas aient une dimension
        if (modal) modal.classList.remove('hidden');
        if (modalOverlay) modalOverlay.classList.remove('hidden');
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
        const purlinsPosition = values.purlinsPosition || 'side';
        const heightUnderBrace = values.heightUnderBrace || 2.0;
        const bracePercent = (values.braceFixPercentage || 70) / 100;
        const purlinCount = values.purlinCount || 6;
        const reinforcementType = values.reinforcementType || 'bracons';
        const braceThickness = (values.braceThickness || 25) / 100;

        // Échelle et centrage
        const totalDrawingHeight = highPointHeightValue + 2;
        const scale = Math.min(width / (panelWidth + 4), height / totalDrawingHeight) ;
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
        let postHeightForDrawing = postHeight;
        if (appState.isAncrageActive) {
            postHeightForDrawing += 0.12;
        }
        let beamCenterY = postModel === 'y_shape' ? -postHeightForDrawing + beamHeight / 2 : -postHeightForDrawing - beamHeight / 2;
        const postX = -ecc; // Position du poteau par rapport à la traverse

        // 1. Poteaux & Massifs
        ctx.fillStyle = '#A0522D'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;

        const getAncragePolys = (cx) => {
            if (!appState.isAncrageActive) return;
            ctx.save();
            ctx.translate(0, solCoupeY(cx * scale));   // ancrage posé sur le sol local
            ctx.fillStyle = '#4b5563';
            ctx.fillRect((cx - 0.2) * scale, -0.02 * scale, 0.4 * scale, 0.02 * scale);
            ctx.fillStyle = '#9ca3af';
            ctx.fillRect((cx - 0.075) * scale, -0.12 * scale, 0.15 * scale, 0.10 * scale);
            ctx.strokeStyle = '#374151';
            ctx.strokeRect((cx - 0.2) * scale, -0.02 * scale, 0.4 * scale, 0.02 * scale);
            ctx.strokeRect((cx - 0.075) * scale, -0.12 * scale, 0.15 * scale, 0.10 * scale);
            ctx.restore();
            ctx.fillStyle = '#A0522D';
        };

        const drawPostRect = (cx) => {
            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                activeSlope = (cx - postX) > 0.01 ? -slopeRad : ((cx - postX) < -0.01 ? slopeRad : 0);
            }

            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset' || postModel === 'simple_azelan' || postModel === 'simple_travolta' || postModel === 'simple_travolta_2') {
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
            let base_y = appState.isAncrageActive ? -0.12 : 0;
            const solPiedY = solCoupeY(cx * scale);
            ctx.beginPath();
            ctx.moveTo(leftX * scale, base_y * scale + solPiedY);
            ctx.lineTo(rightX * scale, base_y * scale + solPiedY);
            ctx.lineTo(rightX * scale, rightY * scale);
            ctx.lineTo(leftX * scale, leftY * scale);
            ctx.closePath();
            ctx.fill(); ctx.stroke();

            getAncragePolys(cx);
        };

        const getVertIntersectionY = () => {
            // Pour les modèles où le poteau n'est pas au centre de rotation de la traverse (double, offset),
            // on ajoute postX * tan(slope) pour coller exactement au bas de la traverse inclinée.
            // Pour y_shape (postX ≈ 0) et inclinedPost (postX ≈ 0), le terme s'annule.
            const activeSlope = postModel === 'y_shape' ? Math.abs(slopeRad) : slopeRad;
            return beamCenterY + postX * Math.tan(activeSlope) + (beamHeight / 2) / Math.cos(activeSlope);
        };
        const vertIntersectionY = getVertIntersectionY();

        const getTraverseYAtX = (cx) => {
            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                activeSlope = (cx - postX) > 0.01 ? -slopeRad : ((cx - postX) < -0.01 ? slopeRad : 0);
            }
            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset' || postModel === 'simple_azelan' || postModel === 'simple_travolta' || postModel === 'simple_travolta_2') {
                c_b = c_b0;
            }
            return m_b * cx + c_b;
        };

        const drawInclinedPoleExact = (baseX, angleDeg, targetX) => {
            let activeSlope = slopeRad;
            if (postModel === 'y_shape') {
                activeSlope = (baseX - postX) > 0 ? -slopeRad : slopeRad;
            }
            const m_b = Math.tan(activeSlope);
            const c_b0 = beamCenterY + (beamHeight / 2) / Math.cos(activeSlope);
            let c_b = c_b0 - m_b * postX;

            if (postModel === 'double' || postModel === 'offset' || postModel === 'simple_azelan' || postModel === 'simple_travolta' || postModel === 'simple_travolta_2') {
                c_b = c_b0;
            }

            const forceOutward = (postModel === 'inclinedPost' || postModel === 'y_shape' || postModel === 'double' || postModel === 'offset');
            const angleRad = (forceOutward ? Math.abs(angleDeg) : -Math.abs(angleDeg)) * Math.PI / 180;
            const dir = baseX < targetX ? 1 : -1;
            const tanA = Math.tan(angleRad);

            let m_p = null;
            if (Math.abs(tanA) >= 0.001) {
                m_p = tanA / dir;
            }

            let dx_ground = postWidth / 2;
            if (m_p !== null) {
                dx_ground = (postWidth / 2) / Math.sin(Math.abs(angleRad));
            }

            let origLeftBaseX = baseX - dx_ground;
            let origRightBaseX = baseX + dx_ground;

            let leftBaseX = origLeftBaseX;
            let rightBaseX = origRightBaseX;
            let base_y = appState.isAncrageActive ? -0.12 : 0;
            // Pied posé sur le sol LOCAL (terrain réel), comme drawPostRect : sans ce décalage, le
            // poteau s'arrêtait au niveau de référence, au-dessus de son ancrage (bug rapporté).
            // Le haut du poteau n'est pas déplacé.
            let leftBaseY = base_y + solLocalM(baseX);
            let rightBaseY = base_y + solLocalM(baseX);

            // Clipping du pied de poteau pour éviter les dépassements
            let vertWidthAtBase = 0;
            if (postModel === 'inclinedPost' || postModel === 'y_shape') {
                vertWidthAtBase = braceThickness;
            } else if (postModel === 'simple_travolta' || postModel === 'simple_azelan') {
                vertWidthAtBase = postWidth;
            }
            if (vertWidthAtBase > 0) {
                const clipMinX = baseX - vertWidthAtBase / 2;
                const clipMaxX = baseX + vertWidthAtBase / 2;
                if (leftBaseX < clipMinX) leftBaseX = clipMinX;
                if (rightBaseX > clipMaxX) rightBaseX = clipMaxX;
            }

            let topLeftX, topLeftY, topRightX, topRightY;

            if (m_p === null) {
                topLeftX = origLeftBaseX;
                topLeftY = m_b * topLeftX + c_b;
                topRightX = origRightBaseX;
                topRightY = m_b * topRightX + c_b;
            } else {
                topLeftX = (c_b + m_p * origLeftBaseX - base_y) / (m_p - m_b);
                topLeftY = m_b * topLeftX + c_b;
                topRightX = (c_b + m_p * origRightBaseX - base_y) / (m_p - m_b);
                topRightY = m_b * topRightX + c_b;

                // Clipping du haut du poteau au centre de l'intersection (targetX)
                if (postModel !== 'simple_travolta') {
                    if (dir === 1) {
                        if (topRightX > targetX) {
                            topRightX = targetX;
                            topRightY = m_p * (targetX - origRightBaseX) + base_y;
                            if (topRightY < m_b * topRightX + c_b) topRightY = m_b * topRightX + c_b;
                        }
                        if (topLeftX > targetX) {
                            topLeftX = targetX;
                            topLeftY = m_p * (targetX - origLeftBaseX) + base_y;
                            if (topLeftY < m_b * topLeftX + c_b) topLeftY = m_b * topLeftX + c_b;
                        }
                    } else {
                        if (topLeftX < targetX) {
                            topLeftX = targetX;
                            topLeftY = m_p * (targetX - origLeftBaseX) + base_y;
                            if (topLeftY < m_b * topLeftX + c_b) topLeftY = m_b * topLeftX + c_b;
                        }
                        if (topRightX < targetX) {
                            topRightX = targetX;
                            topRightY = m_p * (targetX - origRightBaseX) + base_y;
                            if (topRightY < m_b * topRightX + c_b) topRightY = m_b * topRightX + c_b;
                        }
                    }
                }
            }

            ctx.beginPath();
            ctx.moveTo(leftBaseX * scale, leftBaseY * scale);
            ctx.lineTo(rightBaseX * scale, rightBaseY * scale);
            ctx.lineTo(topRightX * scale, topRightY * scale);
            ctx.lineTo(topLeftX * scale, topLeftY * scale);
            ctx.closePath(); ctx.fill(); ctx.stroke();

            getAncragePolys(baseX);
        };

        const drawObliqueBar = (x1, y1, x2, y2) => {
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const dx = (braceThickness / 2) * Math.sin(angle);
            const dy = (braceThickness / 2) * Math.cos(angle);
            ctx.fillStyle = '#A0522D'; ctx.strokeStyle = '#374151';
            ctx.beginPath();
            // Bornée au sol LOCAL (terrain réel) et non plus au niveau de référence.
            ctx.moveTo((x1 - dx) * scale, Math.min(solLocalM(x1 - dx), y1 + dy) * scale);
            ctx.lineTo((x1 + dx) * scale, Math.min(solLocalM(x1 + dx), y1 - dy) * scale);
            ctx.lineTo((x2 + dx) * scale, Math.min(solLocalM(x2 + dx), y2 - dy) * scale);
            ctx.lineTo((x2 - dx) * scale, Math.min(solLocalM(x2 - dx), y2 + dy) * scale);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#A0522D';
        };

        const bracingPos = (values.bracing_position !== undefined ? values.bracing_position : 80) / 100.0;
        const incLeft = values.post_inclination_left !== undefined ? values.post_inclination_left : 65;
        const incRight = values.post_inclination_right !== undefined ? values.post_inclination_right : 65;

        if (postModel === 'inclinedPost') { // Modèle W 6 rangées Sud
            const distExt = (values.coupe_entraxe !== undefined ? values.coupe_entraxe : 2.30) / 2;
            const yLeft = getTraverseYAtX(postX - distExt);
            const yRight = getTraverseYAtX(postX + distExt);
            let base_y = appState.isAncrageActive ? -0.12 : 0;
            drawInclinedPoleExact(postX - distExt, incLeft, postX);
            drawInclinedPoleExact(postX + distExt, incRight, postX);
            drawObliqueBar(postX - distExt, base_y + solLocalM(postX - distExt), postX - distExt, yLeft); // Dessiné après = devant
            getAncragePolys(postX - distExt);
            drawObliqueBar(postX + distExt, base_y + solLocalM(postX + distExt), postX + distExt, yRight);
            getAncragePolys(postX + distExt);
            if (!appState.hideCentralPost) {
                drawPostRect(postX);
            }
            drawDimensionLine(ctx, (postX - distExt) * scale, 0, (postX + distExt) * scale, 0, `Entraxe = ${(distExt * 2).toFixed(2)}m`, 20);
        } else if (postModel === 'y_shape') { // Modèle W 3 rangées EST-OUEST
            const distExt = (values.coupe_entraxe !== undefined ? values.coupe_entraxe : 2.54) / 2;
            const yLeft = getTraverseYAtX(postX - distExt);
            const yRight = getTraverseYAtX(postX + distExt);
            let base_y = appState.isAncrageActive ? -0.12 : 0;
            drawInclinedPoleExact(postX - distExt, incLeft, postX);
            drawInclinedPoleExact(postX + distExt, incRight, postX);
            drawObliqueBar(postX - distExt, base_y + solLocalM(postX - distExt), postX - distExt, yLeft);
            getAncragePolys(postX - distExt);
            drawObliqueBar(postX + distExt, base_y + solLocalM(postX + distExt), postX + distExt, yRight);
            getAncragePolys(postX + distExt);
            if (!appState.hideCentralPost) {
                drawPostRect(postX);
            }
            drawDimensionLine(ctx, (postX - distExt) * scale, 0, (postX + distExt) * scale, 0, `Entraxe = ${(distExt * 2).toFixed(2)}m`, 20);
        } else if (postModel === 'double') { // Modèle N 4 rangées
            const isV2 = (appState.doublePostBracing === 'v2');
            const dist = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            const baseX = postX + (isV2 ? -1 : 1) * dist;
            const yEcc = getTraverseYAtX(postX);
            const yBase = getTraverseYAtX(baseX);
            const shortestY = Math.max(yEcc, yBase);
            const topY = shortestY;
            const centerY = shortestY * bracingPos;
            let botY = 2 * centerY - topY;
            if (botY > 0) botY = 0;
            drawObliqueBar(postX, topY, baseX, botY);
            drawInclinedPoleExact(baseX, incLeft, postX);
            drawPostRect(postX);
            drawDimensionLine(ctx, Math.min(postX, baseX) * scale, 0, Math.max(postX, baseX) * scale, 0, `Entraxe = ${Math.abs(baseX - postX).toFixed(2)}m`, 20);
        } else if (postModel === 'offset') { // Modèle N 3 rangées (Poteaux excentrés)
            const isV2 = (appState.doublePostBracing === 'v2');
            const dist = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.80;
            const baseX = postX + (isV2 ? -1 : 1) * dist;
            const yEcc = getTraverseYAtX(postX);
            const yBase = getTraverseYAtX(baseX);
            const shortestY = Math.max(yEcc, yBase);
            const topY = shortestY;
            const centerY = shortestY * bracingPos;
            let botY = 2 * centerY - topY;
            if (botY > 0) botY = 0;
            drawObliqueBar(postX, topY, baseX, botY);
            drawInclinedPoleExact(baseX, incLeft, postX);
            drawPostRect(postX);
            drawDimensionLine(ctx, Math.min(postX, baseX) * scale, 0, Math.max(postX, baseX) * scale, 0, `Entraxe = ${Math.abs(baseX - postX).toFixed(2)}m`, 20);
        } else if (postModel === 'simple_azelan') { // Modèle Simple Azélan
            const dist = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            const coupledX = postX;
            const sign = coupledX < 0 ? 1 : -1; // Oriente toujours le deuxième poteau vers le centre de la traverse
            const standaloneX = coupledX + sign * dist;

            const yCoupled = getTraverseYAtX(coupledX);
            const yStandalone = getTraverseYAtX(standaloneX);
            const shortestY = Math.max(yCoupled, yStandalone);
            const topY = shortestY;
            const centerY = shortestY * bracingPos;
            let botY = 2 * centerY - topY;
            if (botY > 0) botY = 0;

            drawInclinedPoleExact(coupledX, incLeft, standaloneX);
            
            if (Math.abs(botY - topY) > 0.01) {
                drawObliqueBar(coupledX, topY, standaloneX, botY);
            }

            drawPostRect(coupledX);
            drawPostRect(standaloneX);
            drawDimensionLine(ctx, Math.min(coupledX, standaloneX) * scale, 0, Math.max(coupledX, standaloneX) * scale, 0, `Entraxe = ${Math.abs(standaloneX - coupledX).toFixed(2)}m`, 20);
        } else if (postModel === 'simple_travolta') { // Modèle Simple Travolta
            const dist = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            const leftBase = postX - dist / 2;
            const rightBase = postX + dist / 2;

            const yLeft = getTraverseYAtX(leftBase);
            const yRight = getTraverseYAtX(rightBase);
            const shortestY = Math.max(yLeft, yRight);
            const topY = shortestY;
            const centerY = shortestY * bracingPos;
            let botY = 2 * centerY - topY;
            if (botY > 0) botY = 0;

            drawInclinedPoleExact(leftBase, incLeft, rightBase);
            drawInclinedPoleExact(rightBase, incRight, leftBase);
            
            if (Math.abs(botY - topY) > 0.01) {
                drawObliqueBar(leftBase, topY, rightBase, botY);
            }

            drawPostRect(leftBase);
            drawPostRect(rightBase);
            drawDimensionLine(ctx, leftBase * scale, 0, rightBase * scale, 0, `Entraxe = ${dist.toFixed(2)}m`, 20);
        } else if (postModel === 'simple_travolta_2') { // Modèle Simple Travolta-2
            const dist = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            const leftBase = postX - dist / 2;
            const rightBase = postX + dist / 2;

            const yLeft = getTraverseYAtX(leftBase);
            const yRight = getTraverseYAtX(rightBase);
            const shortestY = Math.max(yLeft, yRight);
            const topY = shortestY;
            const crossY = shortestY * bracingPos;

            let botY = 2 * crossY - topY;
            if (botY > 0) botY = 0;

            drawObliqueBar(leftBase, botY, rightBase, topY);
            drawObliqueBar(rightBase, botY, leftBase, topY);

            drawPostRect(leftBase);
            drawPostRect(rightBase);

            drawDimensionLine(ctx, leftBase * scale, 0, rightBase * scale, 0, `Entraxe = ${dist.toFixed(2)}m`, 20);
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
        // Positionnement des pannes (0 = centré/encastré, -beamHeight/2 - purlinHeight/2 = posées sur la traverse)
        let purlinLocalY = purlinsPosition === 'top' ? -beamHeight / 2 - purlinHeight / 2 : 0;

        const sides = postModel === 'y_shape' ? [1, -1] : [1];
        sides.forEach(side => {
            const currentSlope = postModel === 'y_shape' ? -slopeRad * side : slopeRad; // Pente en V
            // beamLength reçu du serveur est déjà la longueur d'un demi-rampant pour y_shape
            // (= panel_width/2 - overhang). On NE divise PAS à nouveau par 2.
            let currentBeamLength = beamLength;
            // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth (et half_panel_width, cf. sa
            // définition plus bas) représentent désormais déjà la largeur d'un bras — ne plus diviser.
            const currentPanelWidth = postModel === 'y_shape' ? (values.half_panel_width !== undefined ? values.half_panel_width : panelWidth) : panelWidth;

            // Sécurité additionnelle si l'API a crashé : on force la traverse à ne pas dépasser le demi-pan
            if (postModel === 'y_shape' && currentBeamLength >= currentPanelWidth) {
                // CORRECTIF (cohérence Toiture Y / Bipente) : currentPanelWidth est déjà la largeur d'un
                // bras (cf. sa définition ci-dessus) — ne plus la diviser à nouveau ici.
                currentBeamLength = currentPanelWidth - (values.overhangSymValue || 0.5);
            }

            ctx.save();
            ctx.translate(0, beamCenterY * scale); // Rotation centrée au faîtage
            ctx.rotate(currentSlope);

            const offsetX = postModel === 'y_shape' ? side * (currentBeamLength / 2) : 0;
            const offsetPanelX = postModel === 'y_shape' ? side * (currentPanelWidth / 2) : 0;

            // Traverse
            let beamStartX = (offsetX - currentBeamLength / 2);
            let actualBeamLength = currentBeamLength;

            ctx.fillStyle = '#A0522D'; ctx.strokeStyle = '#374151';
            ctx.beginPath(); ctx.rect(beamStartX * scale, -beamHeight / 2 * scale, actualBeamLength * scale, beamHeight * scale);
            ctx.fill(); ctx.stroke();

            // Pannes
            const pCount = postModel === 'y_shape' ? Math.max(2, Math.floor(purlinCount / 2)) : purlinCount;
            const purlinWidthVis = 0.1; // Largeur visuelle de la panne (10cm)
            const startPx = beamStartX + purlinWidthVis / 2;
            const spanPx = actualBeamLength - purlinWidthVis;
            let purlinCentersX = pCount === 1 ? [beamStartX + actualBeamLength / 2] : Array.from({ length: pCount }, (_, i) => startPx + i * (spanPx / (pCount - 1)));
            purlinCentersX.forEach(px => {
                ctx.fillStyle = '#A0522D';
                ctx.beginPath(); ctx.rect((offsetX + px - purlinWidthVis / 2) * scale, (purlinLocalY - purlinHeight / 2) * scale, purlinWidthVis * scale, purlinHeight * scale);
                ctx.beginPath(); ctx.rect((px - purlinWidthVis / 2) * scale, (purlinLocalY - purlinHeight / 2) * scale, purlinWidthVis * scale, purlinHeight * scale);
                ctx.fill(); ctx.stroke();
            });

            // Intégration
            const topOfStructureLocalY = purlinsPosition === 'top' ? -beamHeight / 2 - purlinHeight : -beamHeight / 2; // Base du système d'intégration
            const systemLocalY = topOfStructureLocalY - integrationHeight / 2;
            ctx.fillStyle = '#4b5563';
            ctx.beginPath(); ctx.rect((offsetPanelX - currentPanelWidth / 2) * scale, (systemLocalY - integrationHeight / 2) * scale, currentPanelWidth * scale, integrationHeight * scale);
            ctx.fill();

            // Panneaux
            const panelLocalY = systemLocalY - integrationHeight / 2 - panelThickness / 2;
            ctx.fillStyle = 'rgba(30, 41, 59, 1)'; ctx.strokeStyle = '#0f172a';
            ctx.beginPath(); ctx.rect((offsetPanelX - currentPanelWidth / 2) * scale, (panelLocalY - panelThickness / 2) * scale, currentPanelWidth * scale, panelThickness * scale);
            ctx.fill(); ctx.stroke();

            ctx.restore();
        });

        // 6. Cotations
        ctx.save();
        const topOfStructureY = purlinsPosition === 'top' ? -beamHeight / 2 - purlinHeight : -beamHeight / 2;
        const panelLocalY = topOfStructureY - integrationHeight - panelThickness / 2;
        ctx.translate(0, (beamCenterY + panelLocalY - 0.5) * scale);
        ctx.rotate(postModel === 'y_shape' ? -Math.abs(slopeRad) : slopeRad);
        if (postModel === 'y_shape') {
            // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth = largeur d'un pan désormais.
            drawDimensionLine(ctx, 0, 0, panelWidth * scale, 0, `Larg. par pan = ${panelWidth.toFixed(2)}m`, 0);
        } else {
            drawDimensionLine(ctx, -panelWidth / 2 * scale, 0, panelWidth / 2 * scale, 0, `Larg. Rampant = ${panelWidth.toFixed(2)}m`, 0);
        }
        ctx.restore();

        const pt1 = rotatePt(-beamLength / 2, beamCenterY + beamHeight / 2, 0, beamCenterY, slopeRad);
        const pt2 = rotatePt(beamLength / 2, beamCenterY + beamHeight / 2, 0, beamCenterY, slopeRad);
        const lowestPoint = pt1.y > pt2.y ? pt1 : pt2;
        drawVerticalDimensionWithLeader(ctx, lowestPoint.x * scale, lowestPoint.y * scale, (lowestPoint.x + (Math.sign(slopeRad) >= 0 ? 1 : -1)) * scale, `H. Pass = ${passageHeight.toFixed(2)}m`, 0);

        // CORRECTIF (cohérence Toiture Y / Bipente) : demi-largeur "un bras" pour y_shape (panelWidth
        // déjà un bras), demi-largeur classique pour les autres modèles (panelWidth toujours total).
        const halfPanelForEdge = postModel === 'y_shape' ? panelWidth : panelWidth / 2;
        const pt3 = rotatePt(-halfPanelForEdge, beamCenterY + panelLocalY, 0, beamCenterY, slopeRad);
        const pt4 = rotatePt(halfPanelForEdge, beamCenterY + panelLocalY, 0, beamCenterY, slopeRad);
        const highestPoint = pt3.y < pt4.y ? pt3 : pt4;
        drawVerticalDimensionWithLeader(ctx, highestPoint.x * scale, highestPoint.y * scale, (highestPoint.x + (Math.sign(slopeRad) >= 0 ? -1 : 1)) * scale, `H. Max = ${highPointHeightValue.toFixed(2)}m`, 0);

        if (ecc !== 0 && postModel === 'offset') {
            drawDimensionLine(ctx, postX * scale, -20, 0, -20, `Excentrement = ${Math.abs(ecc).toFixed(2)}m`, 0, false);
        }

        ctx.restore();

        const marginMeters = 1.0;
        // CORRECTIF (cohérence Toiture Y / Bipente) : réutilise halfPanelForEdge (déjà "un bras" pour
        // y_shape, demi-largeur classique sinon) au lieu de re-diviser panelWidth ici.
        return {
            minX: -halfPanelForEdge - marginMeters - Math.abs(ecc),
            maxX: halfPanelForEdge + marginMeters + Math.abs(ecc),
            minY: -highPointHeightValue - marginMeters,
            maxY: marginMeters
        };
    }

    function drawFacade(canvas, ctx, viewManager, values) {
        // Logique de dessin de la façade (conservée intégralement)
        const { postHeight, facadeLength, leftOverhang, rightOverhang, groundSlopeFacade, postWidth, panelWidth, roofSlope, invertSlope, lowPointHeight, alignRoof, pvLayout, baseAltimetry, purlinHeight, postBracePercent, purlinBracePercent, braceWidth } = values;
        const { width, height } = setupCanvas(canvas);
        if (width === 0 || height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);
        const distances = appState.parsedDistances;
        if (!distances) { ctx.restore(); return; }
        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth représente déjà un bras pour y_shape,
        // même valeur à utiliser pour les autres modèles — plus de distinction nécessaire ici.
        const effectivePanelWidth = panelWidth;
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

        // CORRECTIF : repli sur [leftOverhang] uniquement (un seul poteau visible) si
        // appState.postPositionsX est vide (ex. distances vidées par une erreur de calcul/
        // validation) était trompeur — on affiche au moins les deux poteaux d'extrémité.
        const postPositions = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang, Math.max(leftOverhang, facadeLength - rightOverhang)];
        const postWidthScaled = Math.max(postWidth * scale, 2);
        ctx.fillStyle = '#A0522D'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;

        const useRoofAlignment = alignRoof;
        const calageFacade = (TPF && typeof TPF.calerTable === 'function')
            ? TPF.calerTable(postPositions.map((xPos) => ({ x: xPos, zSol: zSolFacadeM(xPos) })),
                             useRoofAlignment ? 'horizontal' : 'pente', 0)
            : null;
        const zTableFacadeM = calageFacade ? calageFacade.zTable : zSolFacadeM;
        const postTopY_at_0 = -(zTableFacadeM(0) + postHeight) * scale;

        // --- 1. Dessin des Renforts (Bracons) DERRIÈRE les poteaux ---
        if ((postBracePercent || 0) > 0 && (purlinBracePercent || 0) > 0) {
            ctx.save();
            ctx.fillStyle = '#A0522D'; // Couleur bois/structure
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 1;

            const postHeightMeters = postHeight || 0;
            const postBraceY_Meters_FromGround = postHeightMeters * ((100 - postBracePercent) / 100);

            const purlinBraceXPercent = (purlinBracePercent || 0) / 100;
            const postCount = postPositions.length;
            const braceWidthScaled = (braceWidth || 0.1) * scale;

            let roofBottomStartY = postTopY_at_0;
            let roofBottomEndY;

            roofBottomEndY = -(zTableFacadeM(facadeLength || 0) + (lowPointHeight || 0)) * scale;

            const getPanneBottomY_structure = (x_scaled) => {
                const xRatio = x_scaled / ((facadeLength || 1) * scale);
                const roofBottomY_at_x = roofBottomStartY + xRatio * (roofBottomEndY - roofBottomStartY);
                // Modification : on retourne directement la base du toit pour que le renfort traverse la panne
                return roofBottomY_at_x;
            };

            for (let i = 0; i < postCount - 1; i++) {
                const currentDistance = distances[i];
                if (currentDistance === undefined || currentDistance <= 0) continue;

                const x1 = postPositions[i] * scale;
                const x2 = postPositions[i + 1] * scale;

                const groundY1 = getScaledGroundY(x1);
                const groundY2 = getScaledGroundY(x2);

                const pointA_Y = groundY1 - (postBraceY_Meters_FromGround * scale);
                const pointB_Y = groundY2 - (postBraceY_Meters_FromGround * scale);

                const braceEnd_X_Offset = currentDistance * purlinBraceXPercent * scale;
                const braceEnd_X_Left = x1 + braceEnd_X_Offset;
                const braceEnd_X_Right = x2 - braceEnd_X_Offset;

                const pointC_Y = getPanneBottomY_structure(braceEnd_X_Left);
                const pointD_Y = getPanneBottomY_structure(braceEnd_X_Right);

                const postCenter1 = x1;
                const postCenter2 = x2;

                const angle1 = Math.atan2(pointD_Y - pointA_Y, braceEnd_X_Right - postCenter1);
                const angle2 = Math.atan2(pointC_Y - pointB_Y, braceEnd_X_Left - postCenter2);

                // Dessin du bracon 1 (Rectangulaire)
                ctx.beginPath();
                ctx.moveTo(postCenter1 - braceWidthScaled / 2 * Math.sin(angle1), pointA_Y + braceWidthScaled / 2 * Math.cos(angle1));
                ctx.lineTo(postCenter1 + braceWidthScaled / 2 * Math.sin(angle1), pointA_Y - braceWidthScaled / 2 * Math.cos(angle1));
                ctx.lineTo(braceEnd_X_Right + braceWidthScaled / 2 * Math.sin(angle1), pointD_Y - braceWidthScaled / 2 * Math.cos(angle1));
                ctx.lineTo(braceEnd_X_Right - braceWidthScaled / 2 * Math.sin(angle1), pointD_Y + braceWidthScaled / 2 * Math.cos(angle1));
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Dessin du bracon 2 (Rectangulaire)
                ctx.beginPath();
                ctx.moveTo(postCenter2 - braceWidthScaled / 2 * Math.sin(angle2), pointB_Y + braceWidthScaled / 2 * Math.cos(angle2));
                ctx.lineTo(postCenter2 + braceWidthScaled / 2 * Math.sin(angle2), pointB_Y - braceWidthScaled / 2 * Math.cos(angle2));
                ctx.lineTo(braceEnd_X_Left + braceWidthScaled / 2 * Math.sin(angle2), pointC_Y - braceWidthScaled / 2 * Math.cos(angle2));
                ctx.lineTo(braceEnd_X_Left - braceWidthScaled / 2 * Math.sin(angle2), pointC_Y + braceWidthScaled / 2 * Math.cos(angle2));
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }

        postPositions.forEach(xPos => {
            const groundY = getScaledGroundY(xPos * scale);
            let postTopY, postH, postHeightForDrawing = postHeight;
            if (appState.isAncrageActive) {
                postHeightForDrawing += 0.12;
            }

            postTopY = -(zTableFacadeM(xPos) + postHeightForDrawing) * scale;
            postH = groundY - postTopY;

            if (appState.isAncrageActive) {
                postH -= 0.12 * scale;
                ctx.fillStyle = '#4b5563';
                ctx.fillRect(xPos * scale - 0.2 * scale, groundY - 0.02 * scale, 0.4 * scale, 0.02 * scale);
                ctx.fillStyle = '#9ca3af';
                ctx.fillRect(xPos * scale - 0.075 * scale, groundY - 0.12 * scale, 0.15 * scale, 0.10 * scale);

                ctx.strokeStyle = '#374151';
                ctx.strokeRect(xPos * scale - 0.2 * scale, groundY - 0.02 * scale, 0.4 * scale, 0.02 * scale);
                ctx.strokeRect(xPos * scale - 0.075 * scale, groundY - 0.12 * scale, 0.15 * scale, 0.10 * scale);
            }

            ctx.fillStyle = '#A0522D';
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

        ctx.fillStyle = '#A0522D'; // Couleur bois/structure
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

        let postHeightForDrawing = values.postHeight;
        if (appState.isAncrageActive) {
            postHeightForDrawing += 0.12;
        }
        const maxHeight = postHeightForDrawing + roofApparentHeight + 1.0;
        const minHeight = -postHeightForDrawing - Math.abs(groundSlopeFacade) - 1.0;

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
        let poleYCoords = [];
        if (appState.postModel === 'inclinedPost') {
            const entraxe = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 2.30;
            if (appState.hideCentralPost) {
                poleYCoords = [midY - (entraxe - postWidth) * scale / 2, midY + (entraxe - postWidth) * scale / 2];
            } else {
                poleYCoords = [midY - (entraxe - postWidth) * scale / 2, midY, midY + (entraxe - postWidth) * scale / 2];
            }
        } else if (appState.postModel === 'y_shape') {
            const entraxe = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 2.54;
            if (appState.hideCentralPost) {
                poleYCoords = [midY - (entraxe - postWidth) * scale / 2, midY + (entraxe - postWidth) * scale / 2];
            } else {
                poleYCoords = [midY - (entraxe - postWidth) * scale / 2, midY, midY + (entraxe - postWidth) * scale / 2];
            }
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 3;
            ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale / 2);
            ctx.strokeRect(0, projectionWidth * scale / 2, facadeLength * scale, projectionWidth * scale / 2);
        } else if (appState.postModel === 'double') {
            const sign = appState.doublePostBracing === 'v2' ? -1 : 1;
            poleYCoords = [midY, midY + sign * 1.447 * scale];
        } else if (appState.postModel === 'offset') {
            const sign = appState.doublePostBracing === 'v2' ? -1 : 1;
            poleYCoords = [midY, midY + sign * (1.915 - postWidth) * scale];
        } else if (appState.postModel === 'simple_azelan') {
            let sign = appState.doublePostBracing === 'v2' ? -1 : 1;
            if (appState.offsetPostSide === 'high') sign = -sign;
            const entraxe = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            poleYCoords = [midY, midY + sign * entraxe * scale];
        } else if (appState.postModel === 'simple_travolta' || appState.postModel === 'simple_travolta_2') {
            const entraxe = values.coupe_entraxe !== undefined ? values.coupe_entraxe : 1.92;
            poleYCoords = [midY - entraxe / 2 * scale, midY + entraxe / 2 * scale];
        } else {
            poleYCoords = [midY];
        }

        if (appState.postModel !== 'y_shape') {
            ctx.strokeStyle = '#374151'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale);
        }

        const postPositions = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang, Math.max(leftOverhang, facadeLength - rightOverhang)];

        ctx.save(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        const axisExtension = 80;

        poleYCoords.forEach(py => {
            ctx.beginPath(); ctx.moveTo(-axisExtension, py); ctx.lineTo(facadeLength * scale + axisExtension, py); ctx.stroke();
        });

        postPositions.forEach(xPos => { ctx.beginPath(); ctx.moveTo(xPos * scale, -axisExtension); ctx.lineTo(xPos * scale, projectionWidth * scale + axisExtension); ctx.stroke(); });
        ctx.restore();

        const postSize = postWidth * scale; ctx.fillStyle = '#A0522D';
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
            drawDimensionLine(ctx, firstPostX, min_y, firstPostX, max_y, `${((max_y - min_y) / scale).toFixed(2)}m`, dimOffset, true);
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

    /* ================================================================================ */
    /* ====   ALGORITHME DE CALCUL AUTOMATIQUE DE L'IMPLANTATION DES POTEAUX        ==== */
    /* ================================================================================ */
    /*
     * Adapté de l'algorithme équivalent d'ombriere_metal.js, avec des contraintes propres à
     * l'ombrière bois :
     *   - Entraxe de référence autorisé : 7.5 m uniquement.
     *   - Porte-à-faux gauche (fixe, saisi) ET porte-à-faux droit (résultat calculé) doivent
     *     rester compris entre 0 et 1 m pour le fabricant Piveteau, et entre 0 et 2.5 m pour
     *     Moduland, Azélan et les autres fabricants (cf. appState.fabricant).
     */
    const POST_SPACING_REFS_BOIS = [7.5];

    // Porte-à-faux max autorisé, dépendant du fabricant sélectionné (cf. #fabricant-group).
    function getMaxOverhangBois() {
        return appState.fabricant === 'piveteau' ? 1 : 2.5;
    }

    function computeOptimalPostLayoutBois(facadeLength, leftOverhang) {
        const EPS = 1e-6;
        const maxOverhang = getMaxOverhangBois();
        const target = facadeLength - leftOverhang; // Longueur restant à couvrir par les entraxes + le PF droit
        if (target < -EPS) {
            return { feasible: false, counts: {}, rightOverhang: 0 };
        }

        // Recherche du nombre maximal d'entraxes de 7.5 m tel que le porte-à-faux droit
        // résultant reste dans [0, maxOverhang] m.
        function search(remaining, idx) {
            if (idx >= POST_SPACING_REFS_BOIS.length) {
                if (remaining >= -EPS && remaining <= maxOverhang + EPS) {
                    return { counts: {}, rightOverhang: Math.max(0, remaining) };
                }
                return null;
            }
            const ref = POST_SPACING_REFS_BOIS[idx];
            const maxN = Math.max(0, Math.floor((remaining + EPS) / ref));
            for (let n = maxN; n >= 0; n--) {
                const result = search(remaining - n * ref, idx + 1);
                if (result) {
                    result.counts[ref] = n;
                    return result;
                }
            }
            return null;
        }

        const found = search(target, 0);
        if (found) return { feasible: true, counts: found.counts, rightOverhang: found.rightOverhang };

        // Repli (cas extrêmes, ex: façade très courte) : remplissage glouton standard, sans
        // garantie que le porte-à-faux droit reste dans [0, maxOverhang] m ; l'anomalie sera
        // alors signalée par la validation existante du champ rightOverhang.
        let rem = target;
        const counts = {};
        POST_SPACING_REFS_BOIS.forEach(ref => {
            const n = Math.floor((rem + EPS) / ref);
            counts[ref] = n;
            rem -= n * ref;
        });
        return { feasible: false, counts, rightOverhang: Math.max(0, rem) };
    }

    // Construit l'expression "Entraxes poteaux" (ex: "4*7.5") à partir du résultat de
    // computeOptimalPostLayoutBois.
    function formatPostDistancesExprBois(layout) {
        const parts = [];
        [...POST_SPACING_REFS_BOIS].sort((a, b) => b - a).forEach(ref => {
            const n = layout.counts[ref] || 0;
            if (n > 0) parts.push(`${n}*${ref}`);
        });
        return parts.length ? parts.join(' + ') : `1*${POST_SPACING_REFS_BOIS[0]}`;
    }

    // Recalcule et remplit automatiquement le champ "Entraxes poteaux" avec l'entraxe optimal,
    // SAUF si l'utilisateur a lui-même déjà modifié ce champ (il reste alors éditable et sous
    // son contrôle, conformément à la consigne : le champ ne doit jamais écraser une saisie
    // manuelle en cours).
    function autoFillOptimalEntraxeBois() {
        if (userEditedPostDistances) return;
        const postDistancesInput = document.getElementById('postDistances');
        const facadeLengthInput = document.getElementById('facadeLength');
        const leftOverhangInput = document.getElementById('leftOverhang');
        if (!postDistancesInput || !facadeLengthInput || !leftOverhangInput) return;

        const facadeLength = parseFloat(facadeLengthInput.value) || 0;
        const leftOverhang = parseFloat(leftOverhangInput.value) || 0;
        const layout = computeOptimalPostLayoutBois(facadeLength, leftOverhang);
        const expr = formatPostDistancesExprBois(layout);

        if (postDistancesInput.value !== expr) {
            isAutoFillingPostDistances = true;
            postDistancesInput.value = expr;
            lastValidPostDistances = expr;
            isAutoFillingPostDistances = false;
        }
    }
    /* ================================================================================ */
    /* ====================   FIN ALGORITHME AUTOMATIQUE POTEAUX   ==================== */
    /* ================================================================================ */

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

    // --- LOCAL CALCULATION LOGIC (MIGRÉ DEPUIS PYTHON) ---
    function safeFloat(val, defaultVal = 0.0) {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? defaultVal : parsed;
    }

    function parsePostDistancesBois(expression, facadeLength, leftOverhang, rightOverhang, limitSpacingActive = false, maxSpacingLimit = 7.5) {
        let error = "";
        let distances = [];
        let positions_x = [];
        let warning = "";

        if (!expression || expression.trim() === "") {
            expression = "4*7.5+7";
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

        // CORRECTIF (bug rapporté : « les poteaux intermédiaires ne s'affichent pas pour l'ombrière
        // bois ») : un entraxe au-dessus de la limite levait une ERREUR qui vidait toutes les
        // positions — la façade et l'implantation retombaient alors sur les deux seuls poteaux
        // d'extrémité (p-à-f droit de 14 m). Le dépassement reste signalé, mais les poteaux sont
        // dessinés là où l'utilisateur les a placés.
        let limitWarning = "";
        if (limitSpacingActive) {
            const tropGrand = distances.find((d) => d > maxSpacingLimit + 1e-9);
            if (tropGrand !== undefined) limitWarning = `Entraxe de ${tropGrand}m supérieur à la limite de ${maxSpacingLimit}m.`;
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

        if (limitWarning) warning = warning ? `${limitWarning} ${warning}` : limitWarning;
        return { distances, positions_x, error, warning, right_overhang: newRightOverhang };
    }

    function validateAndSetEccentricityBois(overhangH, overhangL, panelWidth, roofSlope, postEccentricity, postModel, offsetPostSide, overhangSymValue) {
        // CORRECTIF (cohérence Toiture Y / Bipente, demande explicite) : panelWidth représente désormais
        // directement la largeur d'un bras (calepinage Bipente symétrique, PV1.1 déjà à cette largeur).
        let beamLength = (postModel === "y_shape") ? panelWidth - overhangSymValue : panelWidth - (overhangH + overhangL);
        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth représente déjà un bras pour y_shape
        // (contrairement aux autres modèles ci-dessous, dont la sémantique de panelWidth est inchangée).
        let maxEccentricity = (postModel === "y_shape" ? panelWidth : panelWidth / 2) * Math.cos(roofSlope * Math.PI / 180);
        let errorText = "";

        if (["offset", "simple_azelan", "simple_travolta", "simple_travolta_2"].includes(postModel)) {
            if (postModel !== "simple_travolta_2") {
                let minLimit, maxLimit;
                if (offsetPostSide === "low") {
                    minLimit = overhangL;
                    maxLimit = panelWidth - overhangH;
                } else {
                    minLimit = overhangH;
                    maxLimit = panelWidth - overhangL;
                }
                if (postEccentricity < minLimit || postEccentricity > maxLimit) {
                    errorText = `Erreur: Poteau hors traverse ! (Limites: ${minLimit.toFixed(2)}m - ${maxLimit.toFixed(2)}m)`;
                }
            }
            maxEccentricity = 9999;
        } else {
            errorText = `(Limite auto: ±${maxEccentricity.toFixed(2)}m)`;
        }
        return { beam_length: beamLength, max_eccentricity: maxEccentricity, error_text: errorText };
    }

    function calculateOmbriereBoisLocal(data) {
        const postModel = data.post_model || "single";
        const purlinsPosition = data.purlins_position || "side";
        const overhangType = data.overhang_type || "sym";
        let invertSlope = !!data.invert_slope;
        const offsetPostSide = data.offset_post_side || "center";

        let passageHeight = safeFloat(data.passage_height);
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
        let postDistancesExpr = data.post_distances_expr || "";
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

        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth représente déjà un bras.
        let beamLengthComputed = (postModel === "y_shape") ? (panelWidth - overhangSymValue) : (panelWidth - overhangH - overhangL);

        if (postModel === "offset") {
            let offsetVal = safeFloat(data.post_eccentricity, 2.0);
            let isLow = (offsetPostSide === "low");
            postEccentricity = (invertSlope ? isLow : !isLow) ? (beamLengthComputed / 2) - offsetVal : -(beamLengthComputed / 2) + offsetVal;
        } else if (postModel === "simple_azelan") {
            let offsetVal = postWidth / 2.0; // Poteau placé exactement au ras de la traverse
            let isLow = (offsetPostSide === "low");
            postEccentricity = (invertSlope ? isLow : !isLow) ? -(beamLengthComputed / 2) + offsetVal : (beamLengthComputed / 2) - offsetVal;
        } else if (postModel === "simple_travolta") {
            let offsetVal = safeFloat(data.post_offset_travolta, 3.0);
            let dist = safeFloat(data.post_spacing_travolta, 1.92);
            if (offsetPostSide === "center") {
                postEccentricity = offsetVal;
            } else {
                let isLow = (offsetPostSide === "low");
                postEccentricity = (invertSlope ? isLow : !isLow) ? (beamLengthComputed / 2) - offsetVal : -(beamLengthComputed / 2) + offsetVal;
            }
            // Clamping strict sous la traverse
            let clampMargin = (dist / 2) + (postWidth / 2);
            let maxEcc = (beamLengthComputed / 2) - clampMargin;
            if (maxEcc < 0) maxEcc = 0;
            if (postEccentricity > maxEcc) postEccentricity = maxEcc;
            if (postEccentricity < -maxEcc) postEccentricity = -maxEcc;
        } else if (postModel === "simple_travolta_2") {
            let offsetVal = safeFloat(data.post_eccentricity, 0.0);
            let dist = safeFloat(data.post_spacing_offset, 1.92);
            let isLow = (offsetPostSide === "low");

            if (offsetPostSide === "center") {
                postEccentricity = offsetVal;
            } else {
                postEccentricity = (invertSlope ? isLow : !isLow) ? (beamLengthComputed / 2) - offsetVal - (dist / 2) : -(beamLengthComputed / 2) + offsetVal + (dist / 2);
            }

            // Clamping strict sous la traverse
            let clampMargin = (dist / 2) + (postWidth / 2);
            let maxEcc = (beamLengthComputed / 2) - clampMargin;
            if (maxEcc < 0) maxEcc = 0;
            if (postEccentricity > maxEcc) postEccentricity = maxEcc;
            if (postEccentricity < -maxEcc) postEccentricity = -maxEcc;

        } else if (postModel === "double") {
            postEccentricity = invertSlope ? -(panelWidth / 2) + 1.45 + (postWidth / 2) : (panelWidth / 2) - 1.45 - (postWidth / 2);
        }

        let ecResult = validateAndSetEccentricityBois(overhangH, overhangL, panelWidth, roofSlope, postEccentricity, postModel, offsetPostSide, overhangSymValue);
        let roofSlopeRadians = roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1);
        let newPostHeight = 0.0, beamCenterY = 0.0;

        // --- APPLICATION DES LIMITES MAX DE TRAVERSE ET CALCUL DES PORTE-A-FAUX ---
        let maxBeamLength = 9999;
        if (postModel === "inclinedPost") maxBeamLength = 12.0;
        else if (postModel === "simple_travolta" || postModel === "simple_travolta_2") maxBeamLength = 6.0;
        else if (postModel === "y_shape") maxBeamLength = 6.5; // Par pan

        if (postModel === "y_shape") {
            overhangH = overhangAsymHigh;
            overhangL = 0; // Fixé à 0 pour la pente basse sur ce modèle
            // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth représente déjà un bras.
            if (panelWidth - overhangH > maxBeamLength) {
                overhangH = panelWidth - maxBeamLength;
                const ohEl = document.getElementById('overhangAsymHigh');
                if (ohEl && document.activeElement !== ohEl) ohEl.value = overhangH.toFixed(2);
            }
            ecResult.beam_length = panelWidth - overhangH;
        } else {
            if (overhangType === "sym") {
                overhangH = overhangSymValue;
                overhangL = overhangSymValue;
            } else {
                overhangH = overhangAsymHigh;
                overhangL = overhangAsymLow;
            }

            if (panelWidth - overhangH - overhangL > maxBeamLength) {
                let reqTotalOverhang = panelWidth - maxBeamLength;
                if (overhangType === "sym") {
                    overhangSymValue = reqTotalOverhang / 2;
                    overhangH = overhangSymValue;
                    overhangL = overhangSymValue;
                    const osEl = document.getElementById('overhangSymValue');
                    if (osEl && document.activeElement !== osEl) osEl.value = overhangSymValue.toFixed(2);
                } else {
                    overhangL = reqTotalOverhang - overhangH;
                    if (overhangL < 0) {
                        overhangH = reqTotalOverhang;
                        overhangL = 0;
                        const ohEl = document.getElementById('overhangAsymHigh');
                        if (ohEl && document.activeElement !== ohEl) ohEl.value = overhangH.toFixed(2);
                    }
                    const olEl = document.getElementById('overhangAsymLow');
                    if (olEl && document.activeElement !== olEl) olEl.value = overhangL.toFixed(2);
                }
            }
            ecResult.beam_length = panelWidth - overhangH - overhangL;
        }
        // --- FIN LOGIQUE DES LIMITES ---

        if (postModel === "y_shape") {
            let yLowestBeamPointRel = ((ecResult.beam_length / 2) * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
            beamCenterY = (-passageHeight - yLowestBeamPointRel) - 0.03;
            newPostHeight = -(beamCenterY - (beamHeight / 2) * Math.cos(roofSlopeRadians));
        } else {
            let yLowestBeamPointRel = ((ecResult.beam_length / 2) * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
            beamCenterY = -passageHeight - yLowestBeamPointRel;
            newPostHeight = -(beamCenterY + beamHeight / 2);
        }
        if (data.is_ancrage_active !== false) newPostHeight -= 0.12;

        let topSurfaceLocalY = -(beamHeight / 2 + (purlinsPosition === "top" ? purlinHeight : 0) + integrationSystemHeight + panelThickness);
        let slopeForCalc = (postModel === "y_shape") ? -Math.abs(roofSlopeRadians) : roofSlopeRadians;
        // CORRECTIF (cohérence Toiture Y / Bipente) : demi-largeur "un bras" pour y_shape (panelWidth
        // déjà un bras), demi-largeur classique pour les autres modèles (panelWidth toujours total) —
        // low_point_height/high_point_height (retournés plus bas) en dépendent pour tous les modèles.
        let halfPanelForY = (postModel === "y_shape") ? panelWidth : panelWidth / 2;
        let y1 = (-halfPanelForY) * Math.sin(slopeForCalc) + topSurfaceLocalY * Math.cos(slopeForCalc);
        let y2 = halfPanelForY * Math.sin(slopeForCalc) + topSurfaceLocalY * Math.cos(slopeForCalc);

        // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth = largeur d'UN bras désormais — la
        // projection totale (les deux bras + le poteau) doit donc compter panelWidth deux fois (×2).
        let totalProjectionWidth = (postModel === "y_shape") ? ((panelWidth * 2) * Math.cos(Math.abs(roofSlopeRadians))) + postWidth : panelWidth * Math.cos(Math.abs(roofSlopeRadians));
        let postSpacing = Math.min(safeFloat(data.post_spacing), Math.max(0.0, totalProjectionWidth - postWidth));
        let postSpacingInclined = Math.min(safeFloat(data.post_spacing_inclined), Math.max(0.0, totalProjectionWidth - postWidth));

        let distResult = parsePostDistancesBois(postDistancesExpr, facadeLength, leftOverhang, rightOverhang, data.limitSpacingCheck !== undefined ? !!data.limitSpacingCheck : true, safeFloat(data.maxSpacingLimit, 7.8));

        let coupe_entraxe = 1.92;
        if (postModel === "inclinedPost") {
            coupe_entraxe = safeFloat(data.post_spacing_inclined, 2.30) || 2.30;
        } else if (postModel === "y_shape") {
            coupe_entraxe = safeFloat(data.post_spacing_inclined, 2.54) || 2.54;
        } else if (postModel === "simple_travolta") {
            let dist = safeFloat(data.post_spacing_travolta, 1.92) || 1.92;
            let maxDist = beamLengthComputed - postWidth;
            if (maxDist < 0.01) maxDist = 0.01;
            if (dist > maxDist) dist = maxDist;
            coupe_entraxe = dist;
        } else if (postModel === "simple_travolta_2") {
            let dist = safeFloat(data.post_spacing_offset, 1.92) || 1.92;
            let maxDist = beamLengthComputed - postWidth;
            if (maxDist < 0.01) maxDist = 0.01;
            if (dist > maxDist) dist = maxDist;
            coupe_entraxe = dist;
        } else if (postModel === "double") {
            coupe_entraxe = safeFloat(data.post_spacing, 1.92) || 1.92;
        } else if (postModel === "simple_azelan") {
            let dist = safeFloat(data.post_spacing_azelan, 1.92) || 1.92;
            let offsetVal = postWidth / 2.0;
            let maxDist = beamLengthComputed - offsetVal - (postWidth / 2.0);
            if (maxDist < 0.01) maxDist = 0.01;
            if (dist > maxDist) dist = maxDist;
            coupe_entraxe = dist;
        } else if (postModel === "offset") {
            coupe_entraxe = safeFloat(data.post_spacing_offset, 1.80) || 1.80;
        }

        return {
            ...data,
            low_point_height: -(beamCenterY + Math.max(y1, y2)),
            post_height: newPostHeight,
            high_point_height: -(beamCenterY + Math.min(y1, y2)),
            beam_length: ecResult.beam_length,
            total_projection_width: totalProjectionWidth,
            post_eccentricity_clamped: postEccentricity,
            max_eccentricity: ecResult.max_eccentricity,
            eccentricity_error: ecResult.error_text,
            post_distances: distResult.distances,
            post_positions_x: distResult.positions_x,
            post_distances_error: distResult.error,
            post_distances_warning: distResult.warning,
            right_overhang: distResult.right_overhang !== undefined ? distResult.right_overhang : rightOverhang,
            coupe_entraxe: coupe_entraxe,
            // CORRECTIF (cohérence Toiture Y / Bipente) : panelWidth = largeur d'un bras désormais.
            half_panel_width: postModel === "y_shape" ? panelWidth : undefined,
            post_spacing: postSpacing,
            post_spacing_inclined: postSpacingInclined
        };
    }

    async function updateAppLogic() {
        let formHasErrors = false;
        let blockingFields = [];
        document.querySelectorAll('.all-inputs').forEach(el => {
            el.classList.remove('border-red-500', 'ring-red-500');
            // "rightOverhang" est volontairement exclu de ce blocage : c'est une valeur dérivée,
            // recalculée et réécrite automatiquement dans le DOM à chaque appel (cf. parsePostDistancesBois
            // + réécriture plus bas), pas une saisie que l'utilisateur contrôle directement. La bloquer ici
            // créerait un verrouillage définitif dès que l'entraxe saisi produit un p-à-f droit hors bornes :
            // le champ serait alors mis à jour avec une valeur invalide, ce qui ferait échouer cette même
            // vérification à la prochaine frappe et empêcherait tout recalcul futur (cf. ombriere_metal.js,
            // qui exclut "rightOverhang" de sa validation bloquante pour la même raison).
            if (el.id === 'rightOverhang') return;
            // Vérifie que la valeur respecte les contraintes et que le champ est visible
            if (el.offsetParent !== null && !el.checkValidity()) {
                formHasErrors = true;
                blockingFields.push(el.previousElementSibling?.textContent || el.id);
                el.classList.add('border-red-500', 'ring-red-500');
                console.warn(`Validation échouée sur le champ : ${el.id} (Valeur: ${el.value}) - ${el.validationMessage}`);
            }
        });
        if (formHasErrors) {
            const errDiv = document.getElementById('validationError');
            if (errDiv) errDiv.textContent = `Calcul bloqué. Valeurs invalides : ${blockingFields.join(', ')}`;
            throw new Error(`Calcul bloqué : valeurs hors plage dans le formulaire (${blockingFields.join(', ')}).`);
        } else {
            const errDiv = document.getElementById('validationError');
            if (errDiv && errDiv.textContent.includes('Calcul bloqué')) errDiv.textContent = '';
        }

        let values = getFormValues();

        let incLeft = 70, incRight = 70;
        if (appState.postModel === 'inclinedPost' || appState.postModel === 'y_shape' || appState.postModel === 'simple_travolta') {
            incLeft = parseFloat(document.getElementById('postInclinationLeft')?.value) || 70;
            incRight = parseFloat(document.getElementById('postInclinationRight')?.value) || 70;
        } else {
            const incSingle = parseFloat(document.getElementById('postInclinationSingle')?.value) || 70;
            incLeft = incSingle;
            incRight = incSingle;
        }

        // Calcul entièrement migré en local (JS) pour zéro appel serveur
        let _r;
        try {
            _r = calculateOmbriereBoisLocal({
                post_model: appState.postModel,
                purlins_position: appState.purlinsPosition,
                overhang_type: appState.overhangType,
                invert_slope: appState.invertSlope,
                hide_central_post: appState.hideCentralPost,
                offset_post_side: appState.offsetPostSide,
                double_post_bracing: appState.doublePostBracing,
                show_double_bracing: appState.showDoubleBracing,
                passage_height: values.passageHeight,
                beam_height: values.beamHeight,
                purlin_height: values.purlinHeight,
                integration_system_height: values.integrationSystemHeight,
                panel_thickness: values.panelThickness,
                panel_width: values.panelWidth,
                roof_slope: values.roofSlope,
                overhang_sym_value: values.overhangSymValue,
                overhang_asym_high: values.overhangAsymHigh,
                overhang_asym_low: values.overhangAsymLow,
                post_eccentricity: values.postEccentricity,
                post_width: values.postWidth,
                post_spacing: values.postSpacing,
                post_spacing_azelan: parseFloat(document.getElementById('postSpacingAzelan')?.value) || 1.92,
                post_spacing_offset: parseFloat(document.getElementById('postSpacingOffset')?.value) || 1.92,
                post_offset_azelan: parseFloat(document.getElementById('postOffsetAzelan')?.value) || 1.5,
                post_spacing_inclined: values.postSpacingInclined,
                post_spacing_travolta: parseFloat(document.getElementById('postSpacingTravolta')?.value) || 1.92,
                post_offset_travolta: parseFloat(document.getElementById('postOffsetTravolta')?.value) || 3.0,
                post_inclination_left: incLeft,
                post_inclination_right: incRight,
                limitSpacingCheck: values.limitSpacingCheck !== undefined ? values.limitSpacingCheck : true,
                maxSpacingLimit: values.maxSpacingLimit || 7.8, // = maximum de saisie bois du formulaire PRO
                bracing_position: parseFloat(document.getElementById('bracingPosition')?.value) || 80,
                post_inclination_inclined: values.postInclinationInclined,
                height_under_brace: values.heightUnderBrace,
                brace_fix_percentage: values.braceFixPercentage,
                purlin_count: values.purlinCount,
                facade_length: values.facadeLength,
                left_overhang: values.leftOverhang,
                right_overhang: values.rightOverhang,
                is_ancrage_active: appState.isAncrageActive,
                ground_slope_facade: values.groundSlopeFacade,
                base_altimetry: values.baseAltimetry,
                post_distances_expr: values.postDistances || '',
                align_roof: values.alignRoof,
                pv_layout: values.pvLayout,
                braceThickness: values.braceThickness,
                post_brace_percent: values.postBracePercent,
                purlin_brace_percent: values.purlinBracePercent,
                brace_width: values.braceWidth,
            });

            const errorDiv = document.getElementById('validationError');
            if (errorDiv) {
                if (_r.post_distances_error) {
                    errorDiv.textContent = _r.post_distances_error;
                } else {
                    errorDiv.textContent = '';
                }
            }
        } catch (_e) {
            console.error('Erreur Calcul Local:', _e);
            values.lowPointHeight = parseFloat(values.lowPointHeight) || 0;
            values.postHeight = parseFloat(values.postHeight) || 0;
            values.beamLength = values.panelWidth || 0;
            values.totalProjectionWidth = values.panelWidth || 0;
            values.overhangH = values.overhangSymValue || 0;
            values.overhangL = values.overhangSymValue || 0;
            values.postModel = appState.postModel;
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

        // Clamp eccentricity si offset ou double pour mettre l'input à jour silencieusement
        if (['offset', 'double', 'simple_azelan', 'simple_travolta', 'simple_travolta_2'].includes(appState.postModel)) {
            values.postEccentricity = _r.post_eccentricity_clamped;
            const eccInput = document.getElementById('postEccentricity');
            if (eccInput && appState.postModel === 'simple_travolta_2') {
                if (Math.abs(parseFloat(eccInput.value || 0) - _r.post_eccentricity_clamped) > 0.001) {
                    eccInput.value = _r.post_eccentricity_clamped.toFixed(2);
                }
            }
        }

        // Force l'état d'inversion si le backend (ex: Variante V2) le contraint physiquement
        if (_r.invert_slope !== undefined) {
            appState.invertSlope = _r.invert_slope;
            values.invertSlope = _r.invert_slope;
            const btnInvert = document.getElementById('toolInvertSlope');
            if (btnInvert) {
                if (appState.invertSlope) btnInvert.classList.add('active');
                else btnInvert.classList.remove('active');
            }
        }

        // Résultats géométriques
        values.beamLength = _r.beam_length;
        values.post_inclination_left = _r.post_inclination_left;
        values.post_inclination_right = _r.post_inclination_right;
        values.bracing_position = _r.bracing_position;
        values.totalProjectionWidth = _r.total_projection_width;
        values.overhangH = _r.overhang_h;
        values.overhangL = _r.overhang_l;
        values.high_point_height = _r.high_point_height;
        values.drawing = _r.drawing;

        values.postModel = _r.post_model || appState.postModel;
        values.postOffsetAzelan = parseFloat(document.getElementById('postOffsetAzelan')?.value) || 1.5;
        values.purlinsPosition = _r.purlins_position || appState.purlinsPosition;
        values.coupe_entraxe = _r.coupe_entraxe;
        values.half_panel_width = _r.half_panel_width;
        values.postBracePercent = _r.post_brace_percent;
        values.purlinBracePercent = _r.purlin_brace_percent;
        values.braceWidth = _r.brace_width;

        values.heightUnderBrace = parseFloat(document.getElementById('heightUnderBrace')?.value) || 2.0;

        // Parse des distances (validé côté backend)
        const _distErr = document.getElementById('postDistancesError');
        if (_distErr) _distErr.innerHTML = _r.post_distances_warning || _r.post_distances_error || '';
        appState.parsedDistances = _r.post_distances || [];
        appState.postPositionsX = _r.post_positions_x || [];

        // Plafonnement interne de l'entraxe pour la sécurité du dessin (poteaux qui ne doivent pas sortir
        // de la traverse) : ne touche jamais au champ affiché, seulement à la valeur utilisée en interne
        // pour les calculs géométriques — la saisie de l'utilisateur n'est jamais modifiée (cf. logique
        // équivalente dans ombriere_metal.js).
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

        return values;
    }

    async function runAllDrawings() {
        const calculatedValues = await updateAppLogic();
        coupeViewManager.draw(calculatedValues);
        facadeViewManager.draw(calculatedValues);
        implantationViewManager.draw(calculatedValues);



        // Sauvegarde automatique des canvas dans localStorage pour l'export PDF Global, ajout JJD
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
                catch (e) { return {}; }
            })();
            // Écraser seulement ce PV, préserver les autres
            existing[pvId] = {
                coupe: _toB64('coupeCanvas'),
                facade: _toB64('facadeCanvas'),
                implantation: _toB64('implantationCanvas'),
                ombriereType: 'bois',
                savedAt: new Date().toISOString()
            };
            existing.savedAt = new Date().toISOString();
            localStorage.setItem('geometriePlansData', JSON.stringify(existing));
        } catch (e) { console.warn('[Bois] Sauvegarde canvas localStorage échouée:', e); }
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

    // Données fabricant charpente bois
    document.querySelectorAll('#fabricant-group button').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('#fabricant-group button').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            appState.fabricant = e.currentTarget.id.replace('fab', '').toLowerCase();

            const roofSlopeEl = document.getElementById('roofSlope');
            if (roofSlopeEl) {
                if (appState.fabricant === 'piveteau') {
                    roofSlopeEl.value = 6;
                } else {
                    roofSlopeEl.value = 10;
                }
            }

            // Le porte-à-faux max autorisé dépend du fabricant (cf. getMaxOverhangBois()) : on
            // ramène leftOverhang dans la nouvelle plage si besoin, puis on relance l'entraxe
            // automatique (sauf saisie manuelle de #postDistances déjà en cours).
            const maxOverhang = getMaxOverhangBois();
            const leftOverhangEl = document.getElementById('leftOverhang');
            if (leftOverhangEl && parseFloat(leftOverhangEl.value) > maxOverhang) {
                leftOverhangEl.value = maxOverhang;
            }
            autoFillOptimalEntraxeBois();

            scheduleUpdate();
        });
    });

    const coupeViewManager = new ViewManager(document.getElementById('coupeCanvas'), drawCoupe);
    const facadeViewManager = new ViewManager(document.getElementById('facadeCanvas'), drawFacade);
    const implantationViewManager = new ViewManager(document.getElementById('implantationCanvas'), drawImplantation);
    // Dossier de plans « Ombrières » (geometrie_structure/ombrieres/dossier_plans/iframe/
    // pont_dossier_ombriere.js) : fonctions de dessin rejouées par l'enregistreur vectoriel
    // (enregistreur_vectoriel.js), et redessin complet à la demande.
    window.__ombriereExports = {
        type: 'bois', drawCoupe, drawFacade, coupeViewManager, facadeViewManager, appState,
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

        // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : toute saisie manuelle de
        // #postDistances désactive définitivement l'auto-remplissage, tandis qu'une modification
        // de la longueur de façade ou du porte-à-faux gauche recalcule l'entraxe optimal (sauf
        // si l'auto-remplissage lui-même est à l'origine de cet évènement 'input').
        if (input.id === 'postDistances' && !isAutoFillingPostDistances) {
            userEditedPostDistances = true;
        } else if (input.id === 'facadeLength' || input.id === 'leftOverhang') {
            autoFillOptimalEntraxeBois();
        }

        // Validation de la saisie pour 'postDistances'
        if (input.id === 'postDistances') {
            const filtered = input.value.replace(/[^0-9*+.\s]/g, '');
            if (filtered !== input.value) {
                input.value = filtered;
            }
            if (!isAutoFillingPostDistances) {
                userEditedPostDistances = true;
            }
        }


        if (input.type === 'number') {
            const val = parseFloat(input.value);
            let errorMsg = '';
            const id = input.id;

            if (!isNaN(val)) {
                if (['postWidth', 'purlinHeight', 'panelThickness', 'integrationSystemHeight', 'beamHeight', 'beamWidth', 'braceWidth'].includes(id)) {
                    if (val <= 0 || val > 2) errorMsg = 'Valeur non acceptée : Doit être > 0 et <= 2.';
                } else if (id === 'braceThickness') {
                    if (val <= 0 || val > 200) errorMsg = 'Valeur non acceptée : Doit être > 0 et <= 200.';
                } else if (['braceFixPercentage', 'postBracePercent', 'purlinBracePercent'].includes(id)) {
                    if (val <= 0 || val > 100) errorMsg = 'Valeur non acceptée : Doit être > 0 et <= 100.';
                } else if (id === 'purlinCount') {
                    if (val <= 0 || val > 50) errorMsg = 'Valeur non acceptée : Doit être > 0 et <= 50.';
                } else if (id === 'facadeLength') {
                    if (val <= 0 || val > 500) errorMsg = 'Valeur non acceptée : Doit être > 0 et <= 500.';
                } else if (['leftOverhang', 'rightOverhang'].includes(id)) {
                    // Plage dépendante du fabricant : 0-1 m pour Piveteau, 0-2.5 m pour
                    // Moduland/Azélan/autres (cf. appState.fabricant, getMaxOverhangBois()).
                    const maxOverhang = getMaxOverhangBois();
                    if (val < 0 || val > maxOverhang) errorMsg = `Valeur non acceptée : Doit être >= 0 et <= ${maxOverhang}.`;
                } else if (['groundSlopeFacade', 'baseAltimetry'].includes(id)) {
                    if (val < -10 || val > 10) errorMsg = 'Valeur non acceptée : Doit être comprise entre -10 et 10.';
                } else if (id === 'passageHeight') {
                    if (val <= 0 || val > 15) errorMsg = 'Valeur non acceptée : Hauteur libre devant être comprise entre > 0 et 15m.';
                } else if (id.startsWith('postSpacing')) {
                    if (val <= 0 || val > 20) errorMsg = 'Valeur non acceptée : Entraxe doit être > 0 et <= 20m.';
                } else if (val < 0 && !['groundSlopeFacade', 'baseAltimetry', 'postEccentricity', 'bracingPosition', 'roofSlope', 'overhangSymValue', 'overhangAsymHigh', 'overhangAsymLow', 'postInclinationLeft', 'postInclinationRight', 'postInclinationSingle', 'postInclinationInclined', 'postOffsetAzelan', 'postOffsetTravolta'].includes(id)) {
                    errorMsg = 'Valeur non acceptée : Doit être positive (>= 0).';
                }
            }

            input.setCustomValidity(errorMsg);
            input.reportValidity();

            // Bloque le lancement du calcul si la saisie en cours est invalide
            if (errorMsg !== '') {
                clearTimeout(debounceTimeout);
                return;
            }
        }

        let formHasErrors = false;
        document.querySelectorAll('.all-inputs').forEach(el => {
            if (el.offsetParent !== null && !el.checkValidity()) formHasErrors = true;
        });

        // Rejette totalement l'exécution s'il y a la moindre erreur ailleurs dans le formulaire
        if (formHasErrors) {
            clearTimeout(debounceTimeout);
            return;
        }

        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            scheduleUpdate();
            setTimeout(adjustCanvasHeights, 50);
        }, 300);
    }));
    document.querySelectorAll('.project-inputs').forEach(input => input.addEventListener('input', () => {
        // Pas de redessin nécessaire pour les champs de projet
    }));

    document.getElementById('toolInvertSlope').addEventListener('click', (e) => { e.preventDefault(); appState.invertSlope = !appState.invertSlope; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toolPosPannesTop').addEventListener('click', (e) => { e.preventDefault(); appState.purlinsPosition = 'top'; document.getElementById('toolPosPannesTop').classList.add('active'); document.getElementById('toolPosPannesSide').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolPosPannesSide').addEventListener('click', (e) => { e.preventDefault(); appState.purlinsPosition = 'side'; document.getElementById('toolPosPannesSide').classList.add('active'); document.getElementById('toolPosPannesTop').classList.remove('active'); scheduleUpdate(); });
    document.getElementById('toolDimColors').addEventListener('click', (e) => {
        e.preventDefault();
        const btn = e.target.closest('.dim-color-btn'); if (!btn) return;
        appState.dimensionColor = btn.dataset.color;
        document.querySelectorAll('.dim-color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); scheduleUpdate();
    });

    document.getElementById('toggleBraceLeft').addEventListener('click', e => { e.preventDefault(); appState.showBraceLeft = !appState.showBraceLeft; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toggleBraceRight').addEventListener('click', e => { e.preventDefault(); appState.showBraceRight = !appState.showBraceRight; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });

    document.querySelectorAll('#offset-position-group button').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault();
        appState.offsetPostSide = e.currentTarget.id.replace('offsetPos', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#offset-position-group button'));
        scheduleUpdate();
    }));
    document.querySelectorAll('#offset-variant-group button').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault();
        appState.doublePostBracing = e.currentTarget.id.replace('offsetBracing', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#offset-variant-group button'));
        scheduleUpdate();
    }));
    document.querySelectorAll('#bracing-variant-group button').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault();
        appState.doublePostBracing = e.currentTarget.id.replace('bracing', '').toLowerCase();
        setupToggleButton(e.currentTarget, document.querySelectorAll('#bracing-variant-group button'));
        scheduleUpdate();
    }));

    document.getElementById('showDoubleBracing').addEventListener('change', e => { appState.showDoubleBracing = e.target.checked; scheduleUpdate(); });

    document.getElementById('overhangSym').addEventListener('click', (e) => {
        e.preventDefault();
        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        scheduleUpdate();
    });
    document.getElementById('overhangAsym').addEventListener('click', (e) => {
        e.preventDefault();
        appState.overhangType = 'asym';
        setupToggleButton(document.getElementById('overhangAsym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangAsymContainer'), document.getElementById('overhangSymContainer'));
        scheduleUpdate();
    });

    const allModelButtons = document.querySelectorAll('#model-btn-group button');
    const allModelControls = [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('simpleTravoltaControls'), document.getElementById('simpleAzelanControls')];
    const inclinedPostCanvasControls = document.getElementById('inclinedPostCanvasControls');
    const overhangSymBtn = document.getElementById('overhangSym');
    const overhangAsymBtn = document.getElementById('overhangAsym');

    const setOverhangControlsEnabled = (enabled) => {
        overhangSymBtn.disabled = !enabled;
        overhangAsymBtn.disabled = !enabled;
    };

    const setDefaultsParModeles = (model) => {
        const setVal = (elId, val) => {
            const el = document.getElementById(elId);
            if (el) { el.value = val; el.setCustomValidity(''); el.classList.remove('border-red-500', 'ring-red-500'); }
        };

        setVal('beamHeight', 0.3);
        setVal('purlinHeight', 0.3);

        setVal('overhangSymValue', 0.5);

        if (model === 'simple_travolta_2') {
            setVal('bracingPosition', 80);
        } else if (model === 'double') {
            setVal('bracingPosition', 53);
        } else {
            setVal('bracingPosition', 100);
        }

        setVal('postInclinationLeft', 55);
        setVal('postInclinationRight', 55);
        setVal('postInclinationSingle', 55);
        setVal('postInclinationInclined', 55);
    };

    const updateFieldVisibility = (model) => {
        const dualGroup = document.getElementById('dual-inclination-group');
        const singleGroup = document.getElementById('single-inclination-group');
        if (model === 'inclinedPost' || model === 'y_shape' || model === 'simple_travolta') {
            if (dualGroup) { dualGroup.style.display = 'block'; dualGroup.classList.remove('hidden'); }
            if (singleGroup) { singleGroup.style.display = 'none'; singleGroup.classList.add('hidden'); }
        } else if (model === 'double' || model === 'offset' || model === 'simple_azelan' || model === 'simple_travolta_2') {
            if (dualGroup) { dualGroup.style.display = 'none'; dualGroup.classList.add('hidden'); }
            if (singleGroup) { singleGroup.style.display = 'block'; singleGroup.classList.remove('hidden'); }
        }

        // Masquer la position de contreventement pour Azélan et Simple Travolta
        const bracingContainer = document.getElementById('bracingPositionContainer');
        if (bracingContainer) {
            if (model === 'simple_azelan' || model === 'simple_travolta') {
                bracingContainer.style.display = 'none';
            } else {
                bracingContainer.style.display = '';
            }
        } else {
            // Fallback au cas où le HTML n'est pas encore mis à jour
            const bracingPosInput = document.getElementById('bracingPosition');
            if (bracingPosInput) {
                const container = bracingPosInput.closest('.form-group') || bracingPosInput.closest('div[class*="col-"]') || bracingPosInput.parentElement;
                if (model === 'simple_azelan' || model === 'simple_travolta') {
                    container.style.display = 'none';
                } else {
                    container.style.display = '';
                }
            }
        }
    };

    // --- MODÈLES STANDARDS ---
    [
        document.getElementById('modelSinglePost'),
        document.getElementById('modelInclinedPost'),
        document.getElementById('modelDoublePost'),
        // document.getElementById('modelOffsetPost'),
        document.getElementById('modelSimpleAzelan'),
        document.getElementById('modelSimpleTravolta'),
        document.getElementById('modelSimpleTravolta2'),
        document.getElementById('modelYShape')
    ].filter(Boolean).forEach(btn => { // filter(Boolean) empêche le JS de crasher si un bouton HTML est supprimé

        btn.addEventListener('click', (e) => {
            e.preventDefault(); // Empêche le rechargement de la page si le bouton est dans un <form>

            // NOUVEAU: Purge préventive des erreurs de validation
            // Empêche le blocage silencieux (freeze) lors du changement de modèle
            document.querySelectorAll('.all-inputs').forEach(el => {
                if (el.offsetParent !== null && !el.checkValidity()) {
                    el.value = el.defaultValue || el.getAttribute('min') || 0;
                    el.setCustomValidity('');
                    el.classList.remove('border-red-500', 'ring-red-500');
                }
            });

            const id = e.currentTarget.id;
            let targetModel = 'single'; // Fallback par défaut sur le modèle simple

            const setVal = (elId, val) => {
                const el = document.getElementById(elId);
                if (el) { el.value = val; el.setCustomValidity(''); el.classList.remove('border-red-500', 'ring-red-500'); }
            };

            if (id === 'modelOffsetPost') {
                targetModel = 'offset';
                appState.offsetPostSide = 'low'; // Force la position sur Bas par défaut
                const elLow = document.getElementById('offsetPosLow'); if (elLow) elLow.classList.add('active');
                const elHigh = document.getElementById('offsetPosHigh'); if (elHigh) elHigh.classList.remove('active');
                const elCenter = document.getElementById('offsetPosCenter'); if (elCenter) elCenter.classList.remove('active');
            } else if (id === 'modelDoublePost') {
                targetModel = 'double';
            } else if (id === 'modelInclinedPost') {
                targetModel = 'inclinedPost';
                setVal('roofSlope', 5.7);
                setVal('passageHeight', 3.0);
                appState.hideCentralPost = true;
                const checkPanel = document.getElementById('hideCentralPost'); if (checkPanel) checkPanel.checked = true;
                const checkCanvas = document.getElementById('hideCentralPostCanvas'); if (checkCanvas) checkCanvas.checked = true;
            } else if (id === 'modelYShape') {
                targetModel = 'y_shape';
                setVal('roofSlope', 5.7);
                setVal('passageHeight', 2.60);
                appState.hideCentralPost = true;
                const checkPanel = document.getElementById('hideCentralPost'); if (checkPanel) checkPanel.checked = true;
                const checkCanvas = document.getElementById('hideCentralPostCanvas'); if (checkCanvas) checkCanvas.checked = true;
            } else if (id === 'modelSimpleAzelan') {
                targetModel = 'simple_azelan';
                appState.offsetPostSide = 'low';
                const elLow = document.getElementById('offsetPosLow'); if (elLow) elLow.classList.add('active');
                const elHigh = document.getElementById('offsetPosHigh'); if (elHigh) elHigh.classList.remove('active');
                const elCenter = document.getElementById('offsetPosCenter'); if (elCenter) elCenter.classList.remove('active');
            } else if (id === 'modelSimpleTravolta') {
                targetModel = 'simple_travolta';
                appState.offsetPostSide = 'center';
                const elLow = document.getElementById('offsetPosLow'); if (elLow) elLow.classList.remove('active');
                const elHigh = document.getElementById('offsetPosHigh'); if (elHigh) elHigh.classList.remove('active');
                const elCenter = document.getElementById('offsetPosCenter'); if (elCenter) elCenter.classList.add('active');
                setVal('postOffsetTravolta', 3.0);
            } else if (id === 'modelSimpleTravolta2') {
                targetModel = 'simple_travolta_2';
                appState.offsetPostSide = 'center';
            } else if (id === 'modelSinglePost') {
                targetModel = 'single';
            }

            // Logique ciblée de masquage pour les sous-composants de offsetPostControls
            const varCont = document.getElementById('offsetVariantContainer');
            const eccCont = document.getElementById('offsetEccentricityContainer');
            const centerBtn = document.getElementById('offsetPosCenter');

            if (targetModel === 'offset') {
                if (varCont) varCont.classList.remove('hidden');
                if (eccCont) eccCont.classList.remove('hidden');
                if (centerBtn) centerBtn.style.display = 'none';
            } else if (targetModel === 'simple_azelan') {
                if (varCont) varCont.classList.remove('hidden');
                if (eccCont) eccCont.classList.add('hidden');
                if (centerBtn) centerBtn.style.display = 'none';
            } else if (targetModel === 'simple_travolta') {
                if (varCont) varCont.classList.add('hidden');
                if (eccCont) eccCont.classList.add('hidden');
                if (centerBtn) centerBtn.style.display = 'inline-block';
            } else if (targetModel === 'simple_travolta_2') {
                if (varCont) varCont.classList.add('hidden');
                if (eccCont) eccCont.classList.remove('hidden');
                if (centerBtn) centerBtn.style.display = 'inline-block';
            }

            appState.postModel = targetModel;

            const elSpc = document.getElementById('azelanSpacingContainer');
            if (elSpc) {
                if (targetModel === 'simple_azelan') {
                    elSpc.classList.remove('hidden');
                } else {
                    elSpc.classList.add('hidden');
                }
            }

            if (targetModel === 'offset') {
                setVal('postEccentricity', 2.0);
                appState.doublePostBracing = 'v1';
                const _obv1 = document.getElementById('offsetBracingV1');
                const _obv2 = document.getElementById('offsetBracingV2');
                if (_obv1) _obv1.classList.add('active');
                if (_obv2) _obv2.classList.remove('active');
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('simpleTravoltaControls'), document.getElementById('simpleAzelanControls')]);
            } else if (targetModel === 'simple_azelan') {
                setVal('postEccentricity', 0);
                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('simpleAzelanControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('simpleTravoltaControls')]);
            } else if (targetModel === 'double' || targetModel === 'simple_travolta' || targetModel === 'simple_travolta_2') {
                setVal('postEccentricity', 0);
                if (targetModel === 'simple_travolta') {
                    setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('simpleTravoltaControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('simpleAzelanControls')]);
                } else if (targetModel === 'simple_travolta_2') {
                    setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('simpleTravoltaControls'), document.getElementById('doublePostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('simpleAzelanControls')]);
                } else {
                    setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), document.getElementById('offsetBraceControls'), inclinedPostCanvasControls, document.getElementById('simpleTravoltaControls'), document.getElementById('simpleAzelanControls')]);
                }
            } else if (targetModel === 'inclinedPost') {
                setVal('postEccentricity', 0);

                const spcContainer = document.getElementById('postSpacingInclinedContainer');
                if (spcContainer) spcContainer.style.display = 'none';

                setupToggleButton(e.currentTarget, allModelButtons, [document.getElementById('inclinedPostControls'), inclinedPostCanvasControls], [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls'), document.getElementById('simpleTravoltaControls'), document.getElementById('simpleAzelanControls')]);
            } else if (targetModel === 'y_shape') {
                setVal('postEccentricity', 0);
                const spcContainer = document.getElementById('postSpacingInclinedContainer');
                if (spcContainer) spcContainer.style.display = 'block';
                setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('offsetBraceControls'), [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls'), document.getElementById('inclinedPostControls'), inclinedPostCanvasControls, document.getElementById('simpleTravoltaControls'), document.getElementById('simpleAzelanControls')]);
            } else {
                setVal('postEccentricity', 0);

                const spcContainer = document.getElementById('postSpacingInclinedContainer');
                if (spcContainer) spcContainer.style.display = 'block';

                setupToggleButton(e.currentTarget, allModelButtons, null, [...allModelControls, document.getElementById('offsetBraceControls'), inclinedPostCanvasControls]);
            }

            setDefaultsParModeles(targetModel);
            updateFieldVisibility(targetModel);

            if (targetModel === 'double' || targetModel === 'inclinedPost' || targetModel === 'y_shape') {
                setVal('overhangSymValue', 0.5);
                const btnSym = document.getElementById('overhangSym'); if (btnSym) btnSym.click();
            } else if (targetModel === 'simple_travolta_2') {
                setVal('overhangSymValue', 0.5);
                const btnSym = document.getElementById('overhangSym'); if (btnSym) btnSym.click();
            } else if (targetModel === 'simple_travolta') {
                setVal('overhangAsymHigh', 0.5);
                setVal('overhangAsymLow', 0.5);
                const btnAsym = document.getElementById('overhangAsym'); if (btnAsym) btnAsym.click();
            }

            if (targetModel === 'y_shape') {
                appState.traversePosition = 'side';
                const toolPosTraverseSide = document.getElementById('toolPosTraverseSide');
                const toolPosTraverseTop = document.getElementById('toolPosTraverseTop');
                if (toolPosTraverseSide) toolPosTraverseSide.classList.add('active');
                if (toolPosTraverseTop) toolPosTraverseTop.classList.remove('active');

                appState.overhangType = 'sym';
                const btnAsym = document.getElementById('overhangAsym');
                if (btnAsym) btnAsym.click();

                const overhangSymBtn = document.getElementById('overhangSym');
                if (overhangSymBtn) overhangSymBtn.disabled = true;

                const lowOh = document.getElementById('overhangAsymLow');
                if (lowOh) { lowOh.style.display = 'none'; }

                const heightUnderBraceInput = document.getElementById('heightUnderBrace');
                if (heightUnderBraceInput) {
                    heightUnderBraceInput.value = "2.0";
                    heightUnderBraceInput.setCustomValidity('');
                    heightUnderBraceInput.readOnly = false;
                }
            } else {
                setOverhangControlsEnabled(true);
                const lowOh = document.getElementById('overhangAsymLow');
                if (lowOh) { lowOh.style.display = 'block'; }
            }

            if (targetModel === 'inclinedPost') {
                const heightUnderBraceInput = document.getElementById('heightUnderBrace');
                if (heightUnderBraceInput) {
                    heightUnderBraceInput.value = "2.0";
                    heightUnderBraceInput.setCustomValidity('');
                }
            }

            scheduleUpdate().then(adjustCanvasHeights);
        });
    });

    // --- GESTION TYPE DE STRUCTURE (SORTI DE L'ECOUTEUR Y-SHAPE) ---
    document.querySelectorAll('#structure-type-group button').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault(); // Empêche le rechargement
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

        setTimeout(() => {
            adjustCanvasHeights();
            scheduleUpdate();
        }, 50); // Ce délai garantit que le canvas n'est pas redessiné avec une hauteur/largeur de 0
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
                        doc.text("Plan non disponible", img.x + gridW / 2, img.y + gridH / 2, { align: 'center' });
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
        rapportBtn.textContent = 'Exporter le rapport A3';
        rapportBtn.style.display = 'none'; // Masquer le bouton de l'interface
        rapportBtn.addEventListener('click', exportRapportA4);
        actionsDiv.appendChild(rapportBtn);
    }
    // --- FIN NOUVELLE LOGIQUE EXPORT PDF ---

    // --- INITIALIZATION ---
    window.addEventListener('load', () => {
        // 1. Activer les styles visuels par défaut
        ['toggleBraceLeft', 'toggleBraceRight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('active');
        });
        // Activer le bouton de position des pannes sur Côté (encastré) par défaut
        const elPannesSide = document.getElementById('toolPosPannesSide');
        if (elPannesSide) elPannesSide.classList.add('active');

        // Entraxe par défaut calculé automatiquement (voir bloc "ALGORITHME DE CALCUL
        // AUTOMATIQUE DES POTEAUX" plus haut), à la place de l'ancienne valeur statique "4*7.5+7".
        autoFillOptimalEntraxeBois();

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

        // Bouton afficher/masquer les ancrages
        const toggleAncrageBtn = document.getElementById('toggleAncrage');
        if (toggleAncrageBtn) {
            toggleAncrageBtn.addEventListener('click', (e) => {
                appState.isAncrageActive = !appState.isAncrageActive;
                if (appState.isAncrageActive) {
                    e.currentTarget.textContent = "Masquer l'ancrage";
                    e.currentTarget.classList.add('bg-red-600', 'hover:bg-red-700');
                    e.currentTarget.classList.remove('bg-gray-400', 'hover:bg-gray-500');
                } else {
                    e.currentTarget.textContent = "Afficher l'ancrage";
                    e.currentTarget.classList.remove('bg-red-600', 'hover:bg-red-700');
                    e.currentTarget.classList.add('bg-gray-400', 'hover:bg-gray-500');
                }
                const btnCanvas = document.getElementById('toggleAncrageCanvas');
                if (btnCanvas) btnCanvas.classList.toggle('active', !appState.isAncrageActive);
                scheduleUpdate();
            });
        }

        const toggleAncrageCanvasBtn = document.getElementById('toggleAncrageCanvas');
        if (toggleAncrageCanvasBtn) {
            toggleAncrageCanvasBtn.addEventListener('click', (e) => {
                appState.isAncrageActive = !appState.isAncrageActive;
                e.currentTarget.classList.toggle('active', !appState.isAncrageActive);

                const toggleAncrageBtn = document.getElementById('toggleAncrage');
                if (toggleAncrageBtn) {
                    if (appState.isAncrageActive) {
                        toggleAncrageBtn.textContent = "Masquer l'ancrage";
                        toggleAncrageBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                        toggleAncrageBtn.classList.remove('bg-gray-400', 'hover:bg-gray-500');
                    } else {
                        toggleAncrageBtn.textContent = "Afficher l'ancrage";
                        toggleAncrageBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
                        toggleAncrageBtn.classList.add('bg-gray-400', 'hover:bg-gray-500');
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
                // Redessin local sans appeler l'API pour éviter la boucle infinie
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
            // 1. Mise à jour de la largeur champ PV (Plan de coupe)
            const panelWidthInput = document.getElementById('panelWidth');
            if (panelWidthInput) panelWidthInput.value = data.width.toFixed(2); // width = largeur du champ PV

            // 2. Mise à jour de la longueur de l'ombrière (Plan de façade)
            const facadeLengthInput = document.getElementById('facadeLength');
            if (facadeLengthInput) facadeLengthInput.value = data.length.toFixed(2); // length = longueur du champ PV

            // 3. Forcer le recalcul
            if (typeof scheduleUpdate === 'function') {
                scheduleUpdate();
            }
        }
    });

    // ==================== PATCH POUR INTÉGRATION DANS LE RAPPORT GLOBAL / intégrer le 08.06.2026 ====================
    window._ombriereBoisType = 'bois';
    window._ombriereBoisReady = true;

    window.appendOmbriereBoisPages = async (doc) => {
        console.log('🔄 [Bois] appendOmbriereBoisPages appelé');

        // ── 1. Sauvegarder l'état des onglets ──────────────────────────────
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

        // ── 2. Révéler tous les onglets pour capture (hors-écran) ──────────
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

        // Garde l'ancien flag pour le restaurer
        const prevFlag = window.isGeneratingPDF;
        window.isGeneratingPDF = true;

        try {
            // ── 3. Forcer le redessin ──────────────────────────────────────
            console.log('🔄 [Bois] runAllDrawings...');
            await runAllDrawings();
            console.log('✅ [Bois] runAllDrawings OK');

            // Redessiner le calepinage dans l'iframe interne
            const calepIframe = document.querySelector('iframe');
            if (calepIframe?.contentWindow?.calculateAndDraw) {
                await calepIframe.contentWindow.calculateAndDraw();
            } else if (typeof window.calculateAndDraw === 'function') {
                await window.calculateAndDraw();
            }
            await new Promise(r => setTimeout(r, 500));

            // ── 4. Capturer les 4 plans via la safeCapture ORIGINALE ───────
            const coupeCanvas = await safeCapture('coupeCanvas');
            const facadeCanvas = await safeCapture('facadeCanvas');
            const implantCanvas = await safeCapture('implantationCanvas');
            const calepCanvas = await safeCapture('pv-canvas', true);

            console.log('📸 [Bois] Canvas capturés :', {
                coupe: coupeCanvas ? `${coupeCanvas.width}x${coupeCanvas.height}` : 'null',
                facade: facadeCanvas ? `${facadeCanvas.width}x${facadeCanvas.height}` : 'null',
                implantation: implantCanvas ? `${implantCanvas.width}x${implantCanvas.height}` : 'null',
                calepinage: calepCanvas ? `${calepCanvas.width}x${calepCanvas.height}` : 'null'
            });

            // ── 5. Ajouter une page A3 paysage au doc du parent ───────────
            const A3_W = 420, A3_H = 297, margin = 15;
            const gridW = (A3_W - 3 * margin) / 2;
            const gridH = (A3_H - 45) / 2;

            doc.addPage([A3_W, A3_H], 'landscape');
            console.log('✅ [Bois] Page A3 ajoutée – total pages :', doc.getNumberOfPages());

            // Titre de la page
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text("Plans d'Exécution – Ombrière Bois", A3_W / 2, margin, { align: 'center' });

            // ── 6. Dessiner les 4 cadres ──────────────────────────────────
            const addPlanImage = (canvas, title, x, y) => {
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(title, x, y + 5);

                doc.setDrawColor(150);
                doc.setLineWidth(0.5);
                doc.rect(x, y, gridW, gridH);

                if (canvas) {
                    try {
                        const imgData = canvas.toDataURL('image/jpeg', 0.95);
                        const imgProps = doc.getImageProperties(imgData);
                        const ratio = imgProps.width / imgProps.height;
                        const availW = gridW - 10;
                        const availH = gridH - 15;
                        let fw = availW, fh = availW / ratio;
                        if (fh > availH) { fh = availH; fw = availH * ratio; }
                        const drawX = x + (gridW - fw) / 2;
                        const drawY = y + 10 + (availH - fh) / 2;
                        doc.addImage(imgData, 'JPEG', drawX, drawY, fw, fh);
                    } catch (imgErr) {
                        console.warn(`⚠️ [Bois] Erreur addImage "${title}":`, imgErr);
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

            addPlanImage(coupeCanvas, '1. Plan de Coupe', margin, 25);
            addPlanImage(facadeCanvas, '2. Plan de Façade', margin * 2 + gridW, 25);
            addPlanImage(calepCanvas, '3. Plan de Calepinage', margin, 25 + gridH + 10);
            addPlanImage(implantCanvas, "4. Plan d'Implantation", margin * 2 + gridW, 25 + gridH + 10);

            console.log('✅ [Bois] Tous les plans ajoutés au document global');

        } catch (err) {
            console.error('❌ [Bois] Erreur dans appendOmbriereBoisPages :', err);
            doc.addPage([420, 297], 'landscape');
            doc.setFontSize(14); doc.setTextColor(200, 0, 0);
            doc.text('Erreur lors de la génération des plans Ombrière Bois.', 210, 148, { align: 'center' });
            doc.setTextColor(0, 0, 0);

        } finally {
            // ── 7. Restaurer l'état original des onglets ──────────────────
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
            window.isGeneratingPDF = prevFlag || false;
        }
    };

});