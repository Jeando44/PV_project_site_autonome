  document.addEventListener('DOMContentLoaded', () => {
            // --- GLOBAL VARIABLES & APP STATE ---
            let appState = {
                postModel: 'bipente',
                traversePosition: 'top', // FIXÉ à 'top' (devant le poteau) selon le nouveau mandat
                overhangType: 'sym',
                dimensionColor: '#0000FF',
                invertSlope: false,
                parsedDistances: [],
                reinforcementType: 'bracons',
                // NOUVEAU: renfort poteaux intermédiaires
                interReinforcementType: 'bracons', // Défaut sur bracons

                widthRoof: 15.0,
                postCount: 3,
                asymmetryPct: 30,
                inclination1: 15,
                inclination2: 10,
            };
            let isUpdateScheduled = false;
            let lastValidPostDistances = document.getElementById('postDistances').value;
            // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : tant que l'utilisateur n'a pas
            // lui-même modifié #postDistances, ce champ est recalculé automatiquement (cf. ombriere_metal.js).
            let userEditedPostDistances = false;
            let isAutoFillingPostDistances = false;
            let map = null; // Ajout pour éviter l'erreur ReferenceError: map is not defined
            
            let lastDismissedError = "";
            let lastFormValuesStr = "";

            // --- CUSTOM MODAL ---
            function showCustomModal(titleText, message, isError = true) {
                if (message === lastDismissedError) {
                    return; // Évite la réapparition en boucle si l'erreur a déjà été fermée
                }

                let existingModal = document.getElementById('custom-validation-error-modal');
                if (existingModal) {
                    if (document.getElementById('custom-validation-msg')?.textContent === message) {
                        return; // Évite le scintillement
                    }
                    existingModal.remove();
                }

                // Plus de backdrop global
                const modalBox = document.createElement('div');
                modalBox.id = 'custom-validation-error-modal';
                const topColor = isError ? '#e74c3c' : '#3498db';
                
                modalBox.style.cssText = `
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #fff;
                    border-radius: 8px;
                    padding: 20px 25px;
                    max-width: 450px;
                    width: 90%;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                    text-align: left;
                    font-family: 'Segoe UI', Arial, sans-serif;
                    border-left: 6px solid ${topColor};
                    animation: slideDown 0.3s ease-out;
                    z-index: 2147483647;
                    display: flex;
                    align-items: flex-start;
                    gap: 15px;
                `;

                if (!document.getElementById('custom-validation-styles')) {
                    const style = document.createElement('style');
                    style.id = 'custom-validation-styles';
                    style.innerHTML = `
                        @keyframes slideDown {
                            from { transform: translate(-50%, -30px); opacity: 0; }
                            to { transform: translate(-50%, 0); opacity: 1; }
                        }
                    `;
                    document.head.appendChild(style);
                }

                const icon = document.createElement('div');
                icon.innerHTML = isError ? '⚠️' : 'ℹ️';
                icon.style.cssText = 'font-size: 24px; line-height: 1;';

                const content = document.createElement('div');
                content.style.flex = '1';

                const title = document.createElement('h3');
                title.textContent = titleText;
                title.style.cssText = 'margin: 0 0 10px 0; color: #2c3e50; font-size: 18px; font-weight: bold;';

                const msg = document.createElement('p');
                msg.id = 'custom-validation-msg';
                msg.textContent = message;
                msg.style.cssText = 'margin: 0 0 15px 0; color: #555; font-size: 14px; line-height: 1.5; word-wrap: break-word;';

                const btn = document.createElement('button');
                btn.textContent = 'OK';
                btn.style.cssText = `
                    background: ${topColor};
                    color: #fff;
                    border: none;
                    padding: 8px 25px;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                    font-weight: bold;
                    transition: opacity 0.2s;
                    float: right;
                `;
                
                const closeModal = () => {
                    lastDismissedError = message;
                    modalBox.remove();
                    document.removeEventListener('keydown', escapeHandler);
                };

                const escapeHandler = (e) => {
                    if (e.key === 'Escape' || e.key === 'Enter') {
                        closeModal();
                    }
                };

                btn.onclick = closeModal;

                document.addEventListener('keydown', escapeHandler);

                content.appendChild(title);
                content.appendChild(msg);
                content.appendChild(btn);
                modalBox.appendChild(icon);
                modalBox.appendChild(content);
                document.body.appendChild(modalBox);
                
                setTimeout(() => btn.focus(), 10);
            }

            // --- UTILITY FUNCTIONS ---
            function setupCanvas(canvasEl) {
                const dpr = window.devicePixelRatio || 1;
                const rect = canvasEl.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                    return { width: 0, height: 0, dpr };
                }
                canvasEl.width = rect.width * dpr;
                canvasEl.height = rect.height * dpr;
                const ctx = canvasEl.getContext('2d');
                ctx.scale(dpr, dpr);
                return { width: rect.width, height: rect.height, dpr };
            }

            // Mise à jour de drawDimensionLine pour prendre en compte le décalage de la ligne
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
                // Lignes d'extension (pour rattacher à la structure)
                if (offset !== 0) {
                    context.beginPath(); context.moveTo(x1, y1); context.lineTo(p1.x, p1.y); context.stroke();
                    context.beginPath(); context.moveTo(x2, y2); context.lineTo(p2.x, p2.y); context.stroke();
                }
                // Ticks perpendiculaires (nouvelles)
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

            // Mise à jour de drawVerticalDimensionWithLeader pour permettre de coter n'importe quel point Y
            function drawVerticalDimensionWithLeader(context, x_target, y_target, x_dim_line, text, groundY = 0) {
                context.save();
                context.strokeStyle = appState.dimensionColor; context.fillStyle = appState.dimensionColor; context.lineWidth = 1; context.font = '12px Arial';

                // Ligne de rappel depuis le point haut (vers la ligne de cote)
                context.beginPath(); context.setLineDash([2, 3]); context.moveTo(x_target, y_target); context.lineTo(x_dim_line, y_target); context.stroke();

                // Ligne de rappel depuis le sol (vers la ligne de cote)
                context.beginPath(); context.moveTo(x_target, groundY); context.lineTo(x_dim_line, groundY); context.stroke();

                // Dessiner la ligne de cote verticale
                context.setLineDash([]); drawDimensionLine(context, x_dim_line, groundY, x_dim_line, y_target, text, 0, true);
                context.restore();
            }

            // Helper for infinite line intersection
            function intersectLines(p1, p2, p3, p4) {
                const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
                if (den === 0) return null; // Parallel
                const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
                return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
            }

            const intersect = (p1, p2, p3, p4) => {
                const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
                if (den === 0) return null;
                const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
                const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;
                if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { // L'intersection se trouve sur les segments
                    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                } else if (t >= 0 && t <= 1) { // Intersection sur la ligne P1P2 (utile pour l'extension poteau)
                    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                }
                return null; // L'intersection se trouve hors des segments
            };

            // Mise à jour de drawSaintAndrewCross pour utiliser des traits épais
            function drawSaintAndrewCross(ctx, x1, y1, x2, y2, x3, y3, x4, y4, thickness, color = '#dc2626') {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = thickness;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x3, y3);
                ctx.lineTo(x4, y4);
                ctx.stroke();
            }

            function drawRect(ctx, x, y, w, h, color, fill = true) {
                ctx.beginPath();
                if (fill) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y, w, h);
                } else {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, y, w, h);
                }
            }
            function drawLine(ctx, x1, y1, x2, y2, color = '#333', width = 2) {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            function intersectLineSegment(p1, p2, p3, p4, extendLine = false) {
                const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
                if (den === 0) return null;
                const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
                const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;

                if (t >= 0 && t <= 1 && (u >= 0 && u <= 1 || extendLine)) {
                    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                }
                return null;
            }

            // Helper pour intersection avec options d'extensions (porté depuis le backend)
            function intersectLinesExt(p1, p2, p3, p4, extendLine = false, extendBoth = false) {
                const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
                if (den === 0) return null;
                const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
                const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;
                if (((t >= 0 && t <= 1) || extendBoth) && ((u >= 0 && u <= 1) || extendLine || extendBoth)) {
                    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                }
                return null;
            }
            function getOffsetLine(p1, p2, offset) {
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const perpAngle = angle + Math.PI / 2;
                const dx = offset * Math.cos(perpAngle);
                const dy = offset * Math.sin(perpAngle);
                return { p1: { x: p1.x + dx, y: p1.y + dy }, p2: { x: p2.x + dx, y: p2.y + dy } };
            }

            // --- CORE DRAWING FUNCTIONS ---
            function drawCoupe(canvas, ctx, viewManager, values) {
                const { width, height } = setupCanvas(canvas);
                if (width === 0) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.translate(viewManager.panX, viewManager.panY);
                ctx.scale(viewManager.zoom, viewManager.zoom);

                const { postHeight, passageHeight, roofSlope, postWidth, beamHeight, beamWidth, purlinHeight, purlinThickness, integrationSystemHeight, panelThickness, widthRoof, postCount, asymmetryPct, inclination1, inclination2, braceFixPercentage, crossThickness, heightUnderBrace, overhangSymValue, bracePosPct, bracePosIntermPct, bracePosTraverseIntPct, bracePosTraversePotRive } = values;

                // --- LOGIQUE D'ÉCHELLE ET BASE ---
                const MAX_WIDTH_METERS = widthRoof + 2 + overhangSymValue * 2;
                const scale = width / MAX_WIDTH_METERS * 0.6; // 90% de la largeur du canvas pour laisser des marges
                const groundY = height * 0.8;
                ctx.translate(width / 2, groundY);

                const postWidthScaled = postWidth * scale;
                const postHeightScaled = postHeight * scale;

                // --- RÉCUPÉRATION DES DONNÉES GÉOMÉTRIQUES CALCULÉES CÔTÉ SERVEUR ---
                const { postsX, traversePolygons, coverPolygons, purlinPolygons, postTops, braces, dimensions } = values.geometry;

                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // 1. Dessin de la Ligne du Sol
                drawLine(ctx, -width * 4, 0, width * 4, 0, '#65a30d', 4); // vert-600

                // Hachure de sol (2m de profondeur)
                const groundPath = new Path2D();
                const hatchDepthScaled = 2 * scale; // Hachure à 2m de profondeur
                const startX_hatch = (postsX[0] * scale) - postWidthScaled / 2 - 50;
                const endX_hatch = (postsX[postsX.length - 1] * scale) + postWidthScaled / 2 + 50;

                groundPath.moveTo(startX_hatch, 0);
                groundPath.lineTo(endX_hatch, 0);
                groundPath.lineTo(endX_hatch, hatchDepthScaled);
                groundPath.lineTo(startX_hatch, hatchDepthScaled);
                groundPath.closePath();

                const patternCanvas = document.createElement('canvas');
                const patternCtx = patternCanvas.getContext('2d');
                patternCanvas.width = 10; patternCanvas.height = 10;
                patternCtx.strokeStyle = '#cccccc'; patternCtx.lineWidth = 1;
                patternCtx.beginPath(); patternCtx.moveTo(0, 10); patternCtx.lineTo(10, 0); patternCtx.stroke();
                const pattern = ctx.createPattern(patternCanvas, 'repeat');
                ctx.fillStyle = pattern;
                ctx.fill(groundPath);
                ctx.strokeStyle = '#374151';
                ctx.lineWidth = 2;
                ctx.stroke(groundPath);
                // Fin Hachure de sol

                // Cotation Largeur Bâtiment (Entraxe) à 1m de profondeur dans l'archure
                const depth1mScaled = 1 * scale;
                drawDimensionLine(ctx, postsX[0] * scale, depth1mScaled, postsX[postsX.length - 1] * scale, depth1mScaled, `${dimensions.largeur_batiment.toFixed(2)}m (Largeur Bâtiment)`, 0, false);

                // 2. Dessin des Renforts (Braces)
                ctx.lineWidth = 1.5; ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#374151';
                braces.forEach(brace => {
                    ctx.beginPath();
                    ctx.moveTo(brace.points[0].x * scale, brace.points[0].y * scale);
                    brace.points.slice(1).forEach(p => ctx.lineTo(p.x * scale, p.y * scale));
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                });

                // 5. Dessin des Poteaux (Posts) - Visuel
                ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
                postTops.forEach(pt => {
                    ctx.fillRect(pt.x * scale - postWidthScaled / 2, pt.y * scale, postWidthScaled, -pt.y * scale);
                    ctx.strokeRect(pt.x * scale - postWidthScaled / 2, pt.y * scale, postWidthScaled, -pt.y * scale);
                });

                // 3. Dessin de la Traverse
                ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5; ctx.fillStyle = '#FFFFFF';
                traversePolygons.forEach(poly => {
                    ctx.beginPath();
                    ctx.moveTo(poly[0].x * scale, poly[0].y * scale);
                    poly.slice(1).forEach(p => ctx.lineTo(p.x * scale, p.y * scale));
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                });

                // 4. Dessin des Pannes et de la Couverture
                ctx.fillStyle = '#808080'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 1;
                coverPolygons.forEach(poly => {
                    ctx.beginPath();
                    ctx.moveTo(poly[0].x * scale, poly[0].y * scale);
                    poly.slice(1).forEach(p => ctx.lineTo(p.x * scale, p.y * scale));
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                });

                ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
                purlinPolygons.forEach(purlin => {
                    ctx.save();
                    ctx.translate(purlin.x * scale, purlin.y * scale);
                    ctx.rotate(purlin.angle);
                    ctx.fillRect(-purlin.w * scale / 2, -purlin.h * scale, purlin.w * scale, purlin.h * scale);
                    ctx.strokeRect(-purlin.w * scale / 2, -purlin.h * scale, purlin.w * scale, purlin.h * scale);
                    ctx.restore();
                });

                // 7. Croix de Saint-André en Coupe (UNE SEULE CROIX PAR PORTIQUE)
                if (values.toggleCrossCoupe && values.crossCoupe) {
                    // Ne dessiner que la première travée spécifiée
                    // MODIFICATION: Boucle sur toutes les travées demandées
                    const spans = parseSpanInput(values.crossCoupe);
                    spans.forEach(spanIndex => {
                        if (spanIndex >= 1 && spanIndex <= postsX.length - 1) {
                            const xStart = postsX[spanIndex - 1] * scale;
                            const xEnd = postsX[spanIndex] * scale;

                            const postTopYStart = postTops[spanIndex - 1].y * scale;
                            const postTopYEnd = postTops[spanIndex].y * scale;

                            const thicknessScaled = crossThickness * scale;

                            ctx.save();
                            ctx.globalCompositeOperation = 'destination-over';

                            drawSaintAndrewCross(ctx, xStart + postWidthScaled / 2, postTopYStart, xEnd - postWidthScaled / 2, 0, xStart + postWidthScaled / 2, 0, xEnd - postWidthScaled / 2, postTopYEnd, thicknessScaled, '#000000');
                            ctx.restore();
                        }
                    });
                }

                // 8. Cotations
                const dimOffsetV = 30;
                const dimOffsetH = 30;

                // --- COTATIONS HAUTEURS BAS ET ÉGOUT (À DROITE DU POTEAU DE RIVE) ---
                const lastPostX = postsX[postsX.length - 1];
                const xPosDimBas = (lastPostX + 1) * scale;   // Ligne à 1m du poteau
                const xPosDimEgout = (lastPostX + 2) * scale; // Ligne à 2m pour ne pas chevaucher

                // 1. Cotation Bas Structure (Sous la traverse)
                const yCanvasTraverse = dimensions.anchors.bas_structure_y * scale;
                const valBasStructure = values.lowPointHeight;
                drawVerticalDimensionWithLeader(ctx, lastPostX * scale, yCanvasTraverse, xPosDimBas, `${valBasStructure.toFixed(2)}m (Bas Str.)`, 0);

                // 2. Cotation Égout Couverture (Haut de couverture)
                const xCanvasEgout = dimensions.anchors.egout_x * scale;
                const yCanvasEgout = dimensions.anchors.egout_y * scale;
                const valEgout = values.hauteur_batiment_egout;
                drawVerticalDimensionWithLeader(ctx, xCanvasEgout, yCanvasEgout, xPosDimEgout, `${valEgout.toFixed(2)}m (Egout)`, 0);

                // C.1. Hauteur structure (Faîtage au sol)
                const yFaitageReel = dimensions.anchors.faitage_y * scale;
                const xBarreMesure = (postsX[0] - 1) * scale;
                const H_faitage_m = values.faitageCalcule;
                drawVerticalDimensionWithLeader(ctx, postsX[0] * scale, yFaitageReel, xBarreMesure, `${H_faitage_m.toFixed(2)}m (Faîtage)`, 0);

                // C.3. Largeur totale toiture (bas)
                dimensions.anchors.rampant_lines.forEach((line, index) => {
                    const lengthMeters = dimensions.rampants[index];
                    const dimOffset = -45; // Pixels au dessus du pan
                    drawDimensionLine(ctx, line.p1.x * scale, line.p1.y * scale,
                        line.p2.x * scale, line.p2.y * scale,
                        `${lengthMeters.toFixed(2)}m`, dimOffset, false);
                });

                // C.5. Pente de toit (Annotation)
                dimensions.anchors.rampant_lines.forEach((line, index) => {
                    let currentSlopeValue;
                    if (appState.postModel === 'asymetrique') {
                        currentSlopeValue = (index === 0) ? inclination1 : inclination2;
                    } else if (appState.postModel === 'multipente') {
                        currentSlopeValue = roofSlope; 
                    } else {
                        currentSlopeValue = roofSlope;
                    }

                    const midX = (line.p1.x + line.p2.x) / 2 * scale;
                    const midY = (line.p1.y + line.p2.y) / 2 * scale;

                    // Calcul de l'angle du rampant pour aligner le texte
                    const angle = Math.atan2(line.p2.y - line.p1.y, line.p2.x - line.p1.x);
                    const perpAngle = angle + Math.PI / 2;
                    
                    // Positionnement : Juste au-dessus de la ligne de couverture
                    const offsetPx = -15; 
                    const textX = midX + offsetPx * Math.cos(perpAngle);
                    const textY = midY + offsetPx * Math.sin(perpAngle);

                    ctx.save();
                    ctx.translate(textX, textY);
                    
                    // On garde le texte à l'endroit et lisible de gauche à droite
                    let textAngle = angle;
                    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
                        textAngle += Math.PI;
                    }
                    ctx.rotate(textAngle);
                    
                    ctx.fillStyle = appState.dimensionColor;
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Affichage de l'inclinaison en degrés et calcul de la pente en %
                    const pentePct = Math.round(Math.tan(currentSlopeValue * Math.PI / 180) * 100);
                    ctx.fillText(`Pente: ${currentSlopeValue}° (${pentePct}%)`, 0, 0);
                    ctx.restore();
                });

                ctx.restore();
            }

            function drawFacade(canvas, ctx, viewManager, values) {
                // [Logique de dessin de la façade conservée]
                const { postHeight, facadeLength, leftOverhang, rightOverhang, groundSlopeFacade, postWidth, panelWidth, roofSlope, lowPointHeight, alignRoof, pvLayout, baseAltimetry, purlinHeight, crossFacade, toggleCrossFacade, crossThickness } = values;
                const { width, height } = setupCanvas(canvas);
                if (width === 0 || height === 0) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                ctx.save();
                ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
                ctx.translate(width / 2, height / 2);
                const distances = appState.parsedDistances;
                const postCount = distances.length + 1;
                if (postCount < 2) { ctx.restore(); return; }

                const roofApparentHeight = values.roofApparentHeight;

                const totalDrawingWidth = facadeLength;
                const totalDrawingHeight = postHeight + Math.abs(groundSlopeFacade) + roofApparentHeight + 5;
                const scale = Math.min(width / (totalDrawingWidth + 4), height / (totalDrawingHeight + 4)) * 0.9;

                const originX = -totalDrawingWidth * scale / 2;
                const groundYAtOrigin = (postHeight * scale + roofApparentHeight * scale) / 2;
                ctx.translate(originX, groundYAtOrigin);

                const getScaledGroundY = (x) => (facadeLength > 0 ? (x / (facadeLength * scale)) * (-groundSlopeFacade * scale) : 0);

                // Dessin du Sol (Hachure de sol)
                const groundPath = new Path2D();
                const groundDepth = 4 * scale;
                const startX = -width * 2 / viewManager.zoom; const endX = width * 2 / viewManager.zoom;
                groundPath.moveTo(startX, getScaledGroundY(startX)); groundPath.lineTo(endX, getScaledGroundY(endX));
                groundPath.lineTo(endX, getScaledGroundY(endX) + groundDepth); groundPath.lineTo(startX, getScaledGroundY(startX) + groundDepth);
                groundPath.closePath();
                ctx.fillStyle = "#f9f9f9"; ctx.fill(groundPath);
                const patternCanvas = document.createElement('canvas'); const patternCtx = patternCanvas.getContext('2d');
                patternCanvas.width = 10; patternCanvas.height = 10;
                patternCtx.strokeStyle = '#cccccc'; patternCtx.lineWidth = 1;
                patternCtx.beginPath(); patternCtx.moveTo(0, 10); patternCtx.lineTo(10, 0); patternCtx.stroke();
                const pattern = ctx.createPattern(patternCanvas, 'repeat');
                ctx.fillStyle = pattern; ctx.fill(groundPath);
                ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke(groundPath);

                const postPositions = [leftOverhang];
                let currentPos = leftOverhang;
                distances.forEach(d => { currentPos += d; postPositions.push(currentPos); });

                // Calcul des poteaux et traverse (Façade)
                const postWidthScaled = Math.max(postWidth * scale, 2);
                ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
                ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; // Remove fill color

                const useRoofAlignment = alignRoof;
                // CORRECTIF (Bug façade Monopente) : les poteaux de la façade (rangée avant, niveau
                // égout) doivent s'arrêter exactement au bas de la bande de toiture (roofBottomStartY,
                // basée sur lowPointHeight), pas à postHeight (hauteur du faîtage/point haut de la
                // structure, atteinte uniquement par les traverses internes). Avec postHeight — bien
                // plus grand que lowPointHeight en Monopente puisque basé sur la largeur totale et non
                // demi-largeur — les poteaux dépassaient visiblement la bande de toiture dessinée.
                const postTopY_at_0 = getScaledGroundY(0) - lowPointHeight * scale;

                let postTopsY = [];
                postPositions.forEach(xPos => {
                    const groundY = getScaledGroundY(xPos * scale);
                    let postTopY, postH;
                    if (useRoofAlignment) {
                        postTopY = postTopY_at_0;
                        postH = groundY - postTopY;
                    } else {
                        postTopY = groundY - lowPointHeight * scale;
                        postH = lowPointHeight * scale;
                    }
                    postTopsY.push(postTopY);
                    ctx.fillRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
                    ctx.strokeRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
                });

                const roofThicknessScaled = roofApparentHeight * scale;
                const structureBottomY_at_0 = getScaledGroundY(0) - lowPointHeight * scale;
                let roofBottomStartY, roofBottomEndY, roofTopStartY, roofTopEndY;
                roofBottomStartY = structureBottomY_at_0;
                if (useRoofAlignment) {
                    roofBottomEndY = roofBottomStartY;
                } else {
                    roofBottomEndY = getScaledGroundY(facadeLength * scale) - lowPointHeight * scale;
                }
                roofTopStartY = roofBottomStartY - roofThicknessScaled;
                roofTopEndY = roofBottomEndY - roofThicknessScaled;

                // Dessin "façade/panneaux"
                const roofPath = new Path2D();
                roofPath.moveTo(0, roofBottomStartY); roofPath.lineTo(facadeLength * scale, roofBottomEndY);
                roofPath.lineTo(facadeLength * scale, roofTopEndY); roofPath.lineTo(0, roofTopStartY);
                roofPath.closePath();
                ctx.fillStyle = 'rgba(30, 41, 59, 1)'; ctx.fill(roofPath); ctx.stroke(roofPath);

                const panneFacadeHeightScaled = values.panneFacadeHeight * scale;

                const pannePath = new Path2D();
                pannePath.moveTo(0, roofBottomStartY);
                pannePath.lineTo(facadeLength * scale, roofBottomEndY);
                pannePath.lineTo(facadeLength * scale, roofBottomEndY + panneFacadeHeightScaled);
                pannePath.lineTo(0, roofBottomStartY + panneFacadeHeightScaled);
                pannePath.closePath();

                ctx.fillStyle = '#e5e7eb';
                ctx.fill(pannePath);
                ctx.strokeStyle = '#a0aec0';
                ctx.lineWidth = 1;
                ctx.stroke(pannePath);

                // Calepinage PV (calculé côté serveur)
                try {
                    const rows = values.pvRows || 0;
                    const cols = values.pvCols || 0;
                    if (rows > 0 && cols > 0) {
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

                // Dessin des Croix de Saint-André
                if (toggleCrossFacade && crossFacade) {
                    const spansToDraw = parseSpanInput(crossFacade);
                    const numSpans = distances.length;
                    const thicknessScaled = crossThickness * scale;

                    ctx.save();
                    ctx.globalCompositeOperation = 'destination-over';

                    spansToDraw.forEach(spanIndex => {
                        if (spanIndex >= 1 && spanIndex <= numSpans) {
                            const xStart = postPositions[spanIndex - 1] * scale;
                            const xEnd = postPositions[spanIndex] * scale;

                            const groundYStart = getScaledGroundY(xStart);
                            const groundYEnd = getScaledGroundY(xEnd);

                            const postTopYStart = postTopsY[spanIndex - 1];
                            const postTopYEnd = postTopsY[spanIndex];

                            drawSaintAndrewCross(ctx,
                                xStart + postWidthScaled / 2, postTopYStart,
                                xEnd - postWidthScaled / 2, groundYEnd,
                                xStart + postWidthScaled / 2, groundYStart,
                                xEnd - postWidthScaled / 2, postTopYEnd,
                                thicknessScaled, '#000000');
                        }
                    });
                    ctx.restore();
                }

                // Cotations (Mise à jour de la logique d'alignement)
                const highestRoofPointY = Math.min(roofTopStartY, roofTopEndY);
                const dimLineYTotal = highestRoofPointY - 60; // Ligne la plus haute pour le total
                const dimLineYInter = (postCount > 2) ? dimLineYTotal + 30 : dimLineYTotal; // Ligne pour les entraxes
                const dimLineYOverhang = dimLineYInter; // Même ligne pour les P-à-f

                const xOverhangLeft = postPositions[0] * scale;
                const xOverhangRight = postPositions[postPositions.length - 1] * scale;

                // C.1. Cotations Inter-poteaux (si N > 2)
                if (postCount > 2) {
                    for (let i = 0; i < distances.length; i++) {
                        drawDimensionLine(ctx, postPositions[i] * scale, dimLineYInter, postPositions[i + 1] * scale, dimLineYInter, `${distances[i].toFixed(2)}m`, 0, false);
                    }
                }

                // C.2. Cotation Porte-à-faux Gauche
                drawDimensionLine(ctx, 0, dimLineYOverhang, xOverhangLeft, dimLineYOverhang, `${leftOverhang.toFixed(2)}m`, 0, false);

                // C.3. Cotation Porte-à-faux Droit
                drawDimensionLine(ctx, xOverhangRight, dimLineYOverhang, facadeLength * scale, dimLineYOverhang, `${rightOverhang.toFixed(2)}m`, 0, false);

                // C.4. Cotation Longueur totale (toujours la plus haute)
                drawDimensionLine(ctx, 0, dimLineYTotal, facadeLength * scale, dimLineYTotal, `${facadeLength.toFixed(2)}m`, 0, false);


                const highPointHeightValue_Left = values.highPointHeightLeft;
                const highPointHeightValue_Right = values.highPointHeightRight;

                const dimOffsetLeft = (-2) * scale;
                const dimOffsetRight = facadeLength * scale + (2) * scale;

                drawVerticalDimensionWithLeader(ctx, 0, roofTopStartY, dimOffsetLeft - 30, `${highPointHeightValue_Left.toFixed(2)}m (Haut Str.)`, getScaledGroundY(0));
                drawVerticalDimensionWithLeader(ctx, facadeLength * scale, roofTopEndY, dimOffsetRight + 30, `${highPointHeightValue_Right.toFixed(2)}m (Haut Str.)`, getScaledGroundY(facadeLength * scale));

                const altimetryLeft = baseAltimetry;
                const altimetryRight = baseAltimetry + groundSlopeFacade;
                const groundRefPoints = [{ x: 0, refText: `+0.00m`, altText: `${altimetryLeft.toFixed(2)}m (NGF)` }, { x: facadeLength * scale, refText: `${groundSlopeFacade.toFixed(2)}m`, altText: `${altimetryRight.toFixed(2)}m (NGF)` }];
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
            }

            function drawImplantation(canvas, ctx, viewManager, values) {
                // [Logique de dessin d'implantation conservée, mise à jour de la cotation]
                const { facadeLength, postWidth, totalProjectionWidth, postCount } = values;
                const distances = appState.parsedDistances;
                const numCols = distances.length + 1;
                if (numCols < 2) return;

                const { width, height } = setupCanvas(canvas);
                if (width === 0 || height === 0) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                ctx.save();
                ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
                ctx.translate(width / 2, height / 2);

                const projectionWidth = totalProjectionWidth;
                const scale = Math.min(width / (facadeLength + 2), height / (projectionWidth + 2)) * 0.9;

                ctx.translate(-facadeLength * scale / 2, -projectionWidth * scale / 2);

                // Dessin standard du périmètre
                ctx.strokeStyle = '#374151';
                ctx.lineWidth = 3;
                ctx.strokeRect(0, 0, facadeLength * scale, projectionWidth * scale);

                const midY = projectionWidth * scale / 2;
                const postPositions = [values.leftOverhang];
                let currentPos = values.leftOverhang;
                distances.forEach(d => { currentPos += d; postPositions.push(currentPos); });

                // Dessin des axes
                ctx.save(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
                const axisExtension = 80;

                ctx.beginPath(); ctx.moveTo(-axisExtension, midY); ctx.lineTo(facadeLength * scale + axisExtension, midY); ctx.stroke();
                postPositions.forEach(xPos => { ctx.beginPath(); ctx.moveTo(xPos * scale, -axisExtension); ctx.lineTo(xPos * scale, projectionWidth * scale + axisExtension); ctx.stroke(); });
                ctx.restore();

                // Dessin des poteaux
                const postSize = postWidth * scale; ctx.fillStyle = '#FFFFFF'; // Removed fill color
                const rowSpacing = projectionWidth * scale / (postCount - 1);

                postPositions.forEach(xPos => {
                    for (let i = 0; i < postCount; i++) {
                        const yPos = i * rowSpacing;
                        ctx.fillRect(xPos * scale - postSize / 2, yPos - postSize / 2, postSize, postSize);
                        ctx.strokeRect(xPos * scale - postSize / 2, yPos - postSize / 2, postSize, postSize);
                    }
                });

                // Cotations (Mise à jour de la logique d'alignement)
                const totalDimY = projectionWidth * scale + 60; // Ligne la plus haute pour le total
                const interPostDimY = (postCount > 2) ? projectionWidth * scale + 30 : totalDimY; // Ligne pour les entraxes
                const overhangDimY = interPostDimY; // Même ligne pour les P-à-f

                // C.1. Cotations Inter-poteaux (si N > 2)
                const xOverhangLeft = postPositions[0] * scale;
                const xOverhangRight = postPositions[postPositions.length - 1] * scale;

                if (numCols > 2) {
                    for (let i = 0; i < distances.length; i++) {
                        drawDimensionLine(ctx, postPositions[i] * scale, interPostDimY, postPositions[i + 1] * scale, interPostDimY, `${distances[i].toFixed(2)}m`);
                    }
                }

                // C.2. Cotation Porte-à-faux Gauche
                drawDimensionLine(ctx, 0, overhangDimY, xOverhangLeft, overhangDimY, `${values.leftOverhang.toFixed(2)}m`, 0, false);

                // C.3. Cotation Porte-à-faux Droit
                drawDimensionLine(ctx, xOverhangRight, overhangDimY, facadeLength * scale, overhangDimY, `${values.rightOverhang.toFixed(2)}m`, 0, false);

                // C.4. Cotation Longueur totale (toujours la plus haute)
                drawDimensionLine(ctx, 0, totalDimY, facadeLength * scale, totalDimY, `${facadeLength.toFixed(2)}m`, 0, false);

                drawDimensionLine(ctx, facadeLength * scale, 0, facadeLength * scale, projectionWidth * scale, `${projectionWidth.toFixed(2)}m`, 30, true);
                ctx.restore();
            }

            /* ================================================================================ */
            /* ====   ALGORITHME DE CALCUL AUTOMATIQUE DE L'IMPLANTATION DES POTEAUX        ==== */
            /* ================================================================================ */
            /*
             * Adapté de l'algorithme équivalent d'ombriere_metal.js / ombriere_solumbra.js, avec
             * des contraintes propres au bâtiment métal :
             *   - Entraxes de référence autorisés : 7.5, 7, 6.5, 6 et 5 m (pas d'entraxe de 10 m).
             *   - Porte-à-faux gauche (fixe, saisi) ET porte-à-faux droit (résultat calculé)
             *     doivent rester compris entre 0 et 1 m (cf. limites des champs
             *     leftOverhang/rightOverhang, min="0.1" max="1").
             *   - PRIORITÉ ABSOLUE : on maximise d'abord le nombre d'entraxes de 6.5 m (entraxe
             *     privilégié), puis (à défaut) de 7.5 m, puis 7 m, puis 6 m, puis 5 m.
             */
            const POST_SPACING_REFS_BATIMENT = [6.5, 7.5, 7, 6, 5];

            function computeOptimalPostLayoutBatiment(facadeLength, leftOverhang) {
                const EPS = 1e-6;
                const target = facadeLength - leftOverhang; // Longueur restant à couvrir par les entraxes + le PF droit
                if (target < -EPS) {
                    return { feasible: false, counts: {}, rightOverhang: 0 };
                }

                // Recherche récursive en profondeur, priorité stricte aux plus grands entraxes
                // d'abord (7.5 > 7 > 6.5 > 6 > 5), telle que le porte-à-faux droit résultant reste
                // dans [0, 1] m.
                function search(remaining, idx) {
                    if (idx >= POST_SPACING_REFS_BATIMENT.length) {
                        if (remaining >= -EPS && remaining <= 1 + EPS) {
                            return { counts: {}, rightOverhang: Math.max(0, remaining) };
                        }
                        return null;
                    }
                    const ref = POST_SPACING_REFS_BATIMENT[idx];
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

                // Repli (cas extrêmes, ex: façade très courte) : remplissage glouton standard,
                // sans garantie que le porte-à-faux droit reste dans [0, 1] m ; l'anomalie sera
                // alors signalée par la validation existante du champ rightOverhang.
                let rem = target;
                const counts = {};
                POST_SPACING_REFS_BATIMENT.forEach(ref => {
                    const n = Math.floor((rem + EPS) / ref);
                    counts[ref] = n;
                    rem -= n * ref;
                });
                return { feasible: false, counts, rightOverhang: Math.max(0, rem) };
            }

            // Construit l'expression "Entraxes poteaux" (ex: "5*6.5" ou "3*7.5 + 1*6") à partir du
            // résultat de computeOptimalPostLayoutBatiment. Affiché dans l'ordre numérique
            // décroissant (7.5 > 7 > 6.5 > 6 > 5) pour la lisibilité, indépendamment de l'ordre de
            // priorité de recherche (6.5 en premier).
            function formatPostDistancesExprBatiment(layout) {
                const parts = [];
                [...POST_SPACING_REFS_BATIMENT].sort((a, b) => b - a).forEach(ref => {
                    const n = layout.counts[ref] || 0;
                    if (n > 0) parts.push(`${n}*${ref}`);
                });
                return parts.length ? parts.join(' + ') : '1*5';
            }

            // Recalcule et remplit automatiquement le champ "Entraxes poteaux" avec l'entraxe
            // optimal, SAUF si l'utilisateur a lui-même déjà modifié ce champ (il reste alors
            // éditable et sous son contrôle, conformément à la consigne : le champ ne doit jamais
            // écraser une saisie manuelle en cours).
            function autoFillOptimalEntraxeBatiment() {
                if (userEditedPostDistances) return;
                const postDistancesInput = document.getElementById('postDistances');
                const facadeLengthInput = document.getElementById('facadeLength');
                const leftOverhangInput = document.getElementById('leftOverhang');
                if (!postDistancesInput || !facadeLengthInput || !leftOverhangInput) return;

                const facadeLength = parseFloat(facadeLengthInput.value) || 0;
                const leftOverhang = parseFloat(leftOverhangInput.value) || 0;
                const layout = computeOptimalPostLayoutBatiment(facadeLength, leftOverhang);
                const expr = formatPostDistancesExprBatiment(layout);

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
                    if (el.type === 'number' && !el.readOnly) {
                        if (['postCount', 'purlinCount'].includes(el.id)) {
                            val = parseInt(val) || 0;
                        } else {
                            val = parseFloat(val) || 0;
                        }
                    } else if (el.type === 'number' && el.readOnly) {
                        val = parseFloat(val) || 0;
                    }
                    values[el.id] = val;
                });

                // Porte-à-faux
                const overhangVal = parseFloat(document.getElementById('overhangValue').value);
                values.overhangSymValue = isNaN(overhangVal) ? 0.25 : overhangVal;

                appState.widthRoof = values.widthRoof;
                appState.postCount = values.postCount;
                appState.asymmetryPct = values.asymmetryPct;
                appState.inclination1 = values.inclination1;
                appState.inclination2 = values.inclination2;

                values.postModel = appState.postModel;
                values.invertSlope = appState.invertSlope;
                values.reinforcementType = appState.reinforcementType;
                values.interReinforcementType = appState.interReinforcementType;

                return values;
            }

            let currentCalculatedValues = null;

            // ---- LOGIQUE DE GÉOMÉTRIE (Portée en Frontend pour éviter les requêtes API) ----
            function calculateBuildingGeometryLocal(data) {
                const _safeFloat = (val, def = 0.0) => { const p = parseFloat(val); return isNaN(p) ? def : p; };
                const _round2 = (val) => Math.round(val * 100) / 100;
                
                const parsePostDistances = (expr, fLen, lOver, rOver) => {
                    let error = "", dists = [];
                    if (!expr || !String(expr).trim()) return { distances: [], error: "" };
                    try {
                        const segs = String(expr).replace(/,/g, '+').split('+');
                        for (let seg of segs) {
                            let cleaned = seg.trim();
                            if (!cleaned) continue;
                            if (cleaned.includes('*')) {
                                let pts = cleaned.split('*');
                                let count = parseInt(pts[0].trim());
                                let val = parseFloat(pts[1].trim());
                                if (count < 0 || val < 0) throw new Error("Valeurs négatives");
                                for(let i=0; i<count; i++) dists.push(val);
                            } else {
                                let val = parseFloat(cleaned);
                                if (val < 0) throw new Error("Valeurs négatives");
                                dists.push(val);
                            }
                        }
                    } catch(e) { return { distances: [], error: e.message }; }
                    let tot = dists.reduce((a,b)=>a+b, 0);
                    let calc = lOver + tot + rOver;
                    if (Math.abs(calc - fLen) > 0.01) {
                        error = `Attention : Somme entraxes (${tot.toFixed(2)}m) + p-à-f (${(lOver+rOver).toFixed(2)}m) = ${calc.toFixed(2)}m ≠ longueur totale (${fLen.toFixed(2)}m).`;
                    }
                    return { distances: dists, error };
                };

                // VALIDATION CÔTÉ CLIENT
                const validateClientData = (data_obj, dists) => {
                    if (!/^[0-9.+\* ]*$/.test(data_obj.postDistances)) {
                        throw new Error("Entraxes invalides : Seuls les chiffres, points, '+', '*' et espaces sont autorisés.");
                    }
                    const checkRange = (val, min, max, name, minInclusive = false, maxInclusive = true) => {
                        const v = parseFloat(val);
                        if (isNaN(v)) throw new Error(`Le champ "${name}" est invalide.`);
                        const minCheck = minInclusive ? (v >= min) : (v > min);
                        const maxCheck = maxInclusive ? (v <= max) : (v < max);
                        if (!minCheck || !maxCheck) {
                            const minBracket = minInclusive ? "[" : "]";
                            const maxBracket = maxInclusive ? "]" : "[";
                            throw new Error(`Le champ "${name}" doit être dans l'intervalle ${minBracket}${min}, ${max}${maxBracket}. Valeur: ${v}`);
                        }
                    };
                
                    checkRange(data_obj.widthRoof, 0, 50, "Largeur toiture bâtiment");
                    checkRange(data_obj.postCount, 0, 10, "Nombre de poteaux");
                    checkRange(data_obj.bracePosPct, 0, 100, "Position bracon_Pot_rives (%)");
                    checkRange(data_obj.bracePosTraversePotRive, 0, 100, "Position bracon_Traverse_Pot_rive");
                    checkRange(data_obj.bracePosIntermPct, 0, 100, "Position bracon_Pot_Interm (%)");
                    checkRange(data_obj.bracePosTraverseIntPct, 0, 100, "Position bracon_Traverse_Int (%)");
                    checkRange(data_obj.hauteur_batiment_egout, 0, 15, "Hauteur Bâtiment_Égout (m)");
                    if (parseFloat(data_obj.heightUnderBrace) > 0) checkRange(data_obj.heightUnderBrace, 0, 15, "Hauteur sous renfort (m)");
                    if (parseFloat(data_obj.hauteur_batiment_egout) <= parseFloat(data_obj.heightUnderBrace)) throw new Error("La Hauteur Bâtiment_Égout doit être strictement supérieure à la Hauteur sous renfort.");
                    checkRange(data_obj.panelWidth, 0, 50, "Largeur champ PV (m)");
                    checkRange(data_obj.roofSlope, 0, 50, "Pente de la toiture (°)");
                    if (data_obj.postModel === 'asymetrique') { checkRange(data_obj.inclination1, 0, 50, "Inclinaison P1 (°)"); checkRange(data_obj.inclination2, 0, 50, "Inclinaison P2 (°)"); }
                    checkRange(data_obj.overhangSymValue, 0, 0.30, "Porte-à-faux (Symétrique)");
                    checkRange(data_obj.asymmetryPct, 0, 100, "% d'asymétrie");
                    checkRange(data_obj.postWidth, 0, 1, "Épaisseur poteau", false, false);
                    checkRange(data_obj.purlinThickness, 0, 1, "Épaisseur pannes", false, false);
                    checkRange(data_obj.panelThickness, 0, 1, "Épaisseur panneaux", false, false);
                    checkRange(data_obj.integrationSystemHeight, 0, 1, "Hauteur système d'intégration", false, false);
                    checkRange(data_obj.beamHeight, 0, 1, "Épaisseur traverse", false, false);
                    checkRange(data_obj.beamWidth, 0, 1, "Largeur traverse", false, false);
                    checkRange(data_obj.braceWidth, 0, 1, "Épaisseur des bracons", false, false);
                    checkRange(data_obj.crossThickness, 0, 1, "Épaisseur contreventement", false, false);
                    checkRange(data_obj.braceFixPercentage, 0, 100, "Fixation renfort (%)");
                    checkRange(data_obj.purlinCount, 2, 15, "Nombre de pannes", false, false);
                    checkRange(data_obj.facadeLength, 0, 100, "Longueur totale (m)");
                    checkRange(data_obj.leftOverhang, 0, 1, "P-à-F Gauche (m)");
                    checkRange(data_obj.rightOverhang, 0, 1, "P-à-F Droit (m)");
                    checkRange(data_obj.groundSlopeFacade, -3, 3, "Dénivelé du terrain", true, false);
                    checkRange(data_obj.baseAltimetry, -3, 3, "Altimétrie au point +0,00 m", true, false);
                    if (data_obj.alignRoof && dists.length > 0 && Math.max(...dists) > 10) throw new Error("Alignement toiture : L'entraxe maximum autorisé est de 10m.");
                };

                const postModel = data.postModel || "bipente";
                const widthRoof = _safeFloat(data.widthRoof, 15.0);
                const postCount = parseInt(_safeFloat(data.postCount, 3));
                const hauteurEgout = _safeFloat(data.hauteur_batiment_egout, 5.0);
                const integrationSysHeight = _safeFloat(data.integrationSystemHeight, 0.1);
                const purlinHeight = _safeFloat(data.purlinHeight, 0.3);
                const beamHeight = _safeFloat(data.beamHeight, 0.15);
                const roofSlope = _safeFloat(data.roofSlope, 8.0);
                
                let asymPct = 0, inc1 = 0, inc2 = 0;
                if (postModel === 'asymetrique') {
                    asymPct = _safeFloat(data.asymmetryPct, 30);
                    inc1 = _safeFloat(data.inclination1, 15);
                    inc2 = _safeFloat(data.inclination2, 10);
                }
                
                const facadeLength = _safeFloat(data.facadeLength, 38.0);
                const leftOverhang = _safeFloat(data.leftOverhang, 1.0);
                const rightOverhang = _safeFloat(data.rightOverhang, 1.0);
                const distancesResult = parsePostDistances(data.postDistances, facadeLength, leftOverhang, rightOverhang);
                
                // DÉCLENCHEMENT DE LA VALIDATION
                validateClientData(data, distancesResult.distances);

                const totalRoofThickness = 0.05 + integrationSysHeight + purlinHeight + beamHeight;
                const lowPointHeight = hauteurEgout - totalRoofThickness;
                
                let maxRoofRise = 0.0;
                const slopeRad = roofSlope * Math.PI / 180;
                if (postModel === 'bipente') maxRoofRise = (widthRoof / 2) * Math.tan(slopeRad);
                else if (postModel === 'monopente') maxRoofRise = widthRoof * Math.tan(slopeRad);
                else if (postModel === 'asymetrique') {
                    const w1 = widthRoof * (asymPct / 100.0);
                    const w2 = widthRoof * (1.0 - (asymPct / 100.0));
                    maxRoofRise = Math.max(w1 * Math.tan(inc1 * Math.PI / 180), w2 * Math.tan(inc2 * Math.PI / 180));
                } else if (postModel === 'multipente' && postCount > 1) {
                    maxRoofRise = ((widthRoof / (postCount - 1)) / 2) * Math.tan(slopeRad);
                }
                const postHeight = lowPointHeight + maxRoofRise;
                
                const overhangSymValue = _safeFloat(data.overhangSymValue, 0.25);
                const panelWidth = _safeFloat(data.panelWidth, 12.4);
                const groundSlopeFacade = _safeFloat(data.groundSlopeFacade, 0);
                
                let penteToitureRad = slopeRad;
                let demiLargeurBatiment = widthRoof / 2.0;
                let faitageCalcule = 0;

                if (postModel === 'monopente') {
                    demiLargeurBatiment = widthRoof;
                    faitageCalcule = hauteurEgout + (((demiLargeurBatiment / Math.cos(penteToitureRad)) + overhangSymValue) * Math.sin(penteToitureRad));
                } else if (postModel === 'asymetrique') {
                    const inc1Rad = inc1 * Math.PI / 180, inc2Rad = inc2 * Math.PI / 180;
                    const rise1 = ((widthRoof * (asymPct / 100.0) / Math.cos(inc1Rad)) + overhangSymValue) * Math.sin(inc1Rad);
                    const rise2 = ((widthRoof * (1.0 - (asymPct / 100.0)) / Math.cos(inc2Rad)) + overhangSymValue) * Math.sin(inc2Rad);
                    faitageCalcule = hauteurEgout + Math.max(rise1, rise2);
                    penteToitureRad = rise1 > rise2 ? inc1Rad : inc2Rad;
                } else if (postModel === 'multipente' && postCount > 1) {
                    demiLargeurBatiment = (widthRoof / (postCount - 1)) / 2.0;
                    faitageCalcule = hauteurEgout + (((demiLargeurBatiment / Math.cos(penteToitureRad)) + overhangSymValue) * Math.sin(penteToitureRad));
                } else {
                    faitageCalcule = hauteurEgout + (((demiLargeurBatiment / Math.cos(penteToitureRad)) + overhangSymValue) * Math.sin(penteToitureRad));
                }

                const roofApparentHeight = Math.abs(panelWidth * Math.sin(slopeRad));
                const panneFacadeHeight = purlinHeight - (Math.sin(slopeRad) * purlinHeight);
                // CORRECTIF : "Haut Str." (plan de façade) doit être identique à la hauteur de
                // Faîtage du plan de coupe (faitageCalcule), pas postHeight (hauteur de la
                // structure porteuse SANS l'épaisseur de couverture ni le porte-à-faux — l'écart
                // entre les deux, ~totalRoofThickness + overhangSymValue*sin(pente), expliquait le
                // décalage constaté d'environ 67 cm). L'ancien calcul (lowPointHeight +
                // roofApparentHeight) utilisait en plus panelWidth — un champ hérité du calepinage
                // PV sans rapport avec la géométrie réelle du bâtiment (widthRoof).
                const highPointHeightLeft = faitageCalcule;
                // CORRECTIF : quand le terrain s'abaisse à droite (groundSlopeFacade négatif), la
                // structure part d'un niveau de sol local plus bas, donc sa hauteur apparente à cet
                // endroit doit AUGMENTER (ex: Faîtage=8m, dénivelé=-0.5m => Haut Str.=8.5m), pas
                // diminuer. D'où la soustraction (et non l'addition) de groundSlopeFacade.
                const highPointHeightRight = data.alignRoof ? highPointHeightLeft : (faitageCalcule - groundSlopeFacade);

                let rows = 0, cols = 0;
                const pvLayout = String(data.pvLayout || "10L x 30C").toLowerCase().replace(/ /g, '');
                if (pvLayout.includes('x')) {
                    const pts = pvLayout.split('x');
                    if (pts[0].includes('l') && pts[1].includes('c')) { rows = parseInt(pts[0]); cols = parseInt(pts[1]); }
                    else if (pts[0].includes('c') && pts[1].includes('l')) { cols = parseInt(pts[0]); rows = parseInt(pts[1]); }
                    else { rows = parseInt(pts[0]); cols = parseInt(pts[1]); }
                }

                const invertSlope = data.invertSlope || false;
                const postWidth = _safeFloat(data.postWidth, 0.3);
                const braceWidth = _safeFloat(data.braceWidth, 0.1);
                const purlinThickness = _safeFloat(data.purlinThickness, 0.1);
                const purlinCount = parseInt(_safeFloat(data.purlinCount, 6));
                const reinforceTypeEdge = data.reinforcementType || "bracons";
                const reinforceTypeInt = data.interReinforcementType || "bracons";
                
                const bracePosPct = _safeFloat(data.bracePosPct, 85);
                const bracePosTraversePotRive = _safeFloat(data.bracePosTraversePotRive, 30);
                const bracePosIntermPct = _safeFloat(data.bracePosIntermPct, 70);
                const bracePosTraverseIntPct = _safeFloat(data.bracePosTraverseIntPct, 30);
                const heightUnderBrace = _safeFloat(data.heightUnderBrace, 0);

                let postsX = [];
                if (postCount >= 2) {
                    const pSpacing = widthRoof / (postCount - 1);
                    for (let i = 0; i < postCount; i++) postsX.push(-widthRoof / 2 + i * pSpacing);
                } else postsX.push(0);

                const bCY = -postHeight + beamHeight / 2;
                let traversePoints = [];
                if (postModel === 'bipente') {
                    traversePoints = [{x: postsX[0], y: bCY}, {x: 0, y: bCY - (widthRoof / 2) * Math.tan(slopeRad)}, {x: postsX[postsX.length-1], y: bCY}];
                } else if (postModel === 'monopente') {
                    const rTY = bCY - (widthRoof * Math.tan(slopeRad));
                    traversePoints = invertSlope ? [{x: postsX[0], y: bCY}, {x: postsX[postsX.length-1], y: rTY}] : [{x: postsX[0], y: rTY}, {x: postsX[postsX.length-1], y: bCY}];
                } else if (postModel === 'asymetrique') {
                    const h1 = (widthRoof * (asymPct / 100.0)) * Math.tan(inc1 * Math.PI / 180);
                    const h2 = (widthRoof * (1.0 - (asymPct / 100.0))) * Math.tan(inc2 * Math.PI / 180);
                    const maxH = Math.max(h1, h2);
                    traversePoints = [{x: postsX[0], y: bCY + (maxH - h1)}, {x: postsX[0] + (widthRoof * (asymPct / 100.0)), y: bCY - maxH}, {x: postsX[postsX.length-1], y: bCY + (maxH - h2)}];
                } else if (postModel === 'multipente') {
                    const rise = (postCount > 1) ? ((widthRoof / (postCount - 1)) / 2) * Math.tan(slopeRad) : 0;
                    traversePoints = [{x: postsX[0], y: bCY}];
                    for (let i = 0; i < postsX.length - 1; i++) {
                        traversePoints.push({x: (postsX[i] + postsX[i+1]) / 2, y: bCY - rise});
                        traversePoints.push({x: postsX[i+1], y: bCY});
                    }
                }

                const tBotLines = [], tTopLines = [];
                for (let i = 0; i < traversePoints.length - 1; i++) {
                    tBotLines.push(getOffsetLine(traversePoints[i], traversePoints[i+1], beamHeight / 2));
                    tTopLines.push(getOffsetLine(traversePoints[i], traversePoints[i+1], -beamHeight / 2));
                }

                let postTops = [];
                for (let i = 0; i < postsX.length; i++) {
                    let pTY = bCY;
                    if (postsX.length > 1 && postModel !== 'multipente') {
                        const lines = (i === 0 || i === postsX.length - 1) ? tTopLines : tBotLines;
                        const tLine = lines.find(l => Math.min(l.p1.x, l.p2.x) - 0.1 <= postsX[i] && postsX[i] <= Math.max(l.p1.x, l.p2.x) + 0.1) || lines[0];
                        const inter = intersectLinesExt({x: postsX[i], y: 1000}, {x: postsX[i], y: -1000}, tLine.p1, tLine.p2, true);
                        if (inter) pTY = inter.y;
                    }
                    postTops.push({x: postsX[i], y: pTY});
                }

                const traversePolygons = [], coverPolygons = [], purlinPolygons = [];
                const rampantAnchors = [], rampantLengths = [];
                const getYLine = (p1, p2, xV) => Math.abs(p2.x - p1.x) > 0.001 ? p1.y + (xV - p1.x) * (p2.y - p1.y) / (p2.x - p1.x) : p1.y;

                for (let i = 0; i < traversePoints.length - 1; i++) {
                    let dP1T = {...tTopLines[i].p1}, dP2T = {...tTopLines[i].p2};
                    let dP1B = {...tBotLines[i].p1}, dP2B = {...tBotLines[i].p2};
                    if (i < traversePoints.length - 2) {
                        const iT = intersectLinesExt(dP1T, dP2T, tTopLines[i+1].p1, tTopLines[i+1].p2); if(iT) dP2T = iT;
                        const iB = intersectLinesExt(dP1B, dP2B, tBotLines[i+1].p1, tBotLines[i+1].p2); if(iB) dP2B = iB;
                    }
                    if (i > 0) {
                        const iT = intersectLinesExt(tTopLines[i-1].p1, tTopLines[i-1].p2, dP1T, dP2T); if(iT) dP1T = iT;
                        const iB = intersectLinesExt(tBotLines[i-1].p1, tBotLines[i-1].p2, dP1B, dP2B); if(iB) dP1B = iB;
                    }
                    if (i === 0) { const tx = postsX[0] + postWidth/2; dP1T = {x:tx, y:getYLine(dP1T, dP2T, tx)}; dP1B = {x:tx, y:getYLine(dP1B, dP2B, tx)}; }
                    if (i === traversePoints.length - 2) { const tx = postsX[postsX.length-1] - postWidth/2; dP2T = {x:tx, y:getYLine(dP1T, dP2T, tx)}; dP2B = {x:tx, y:getYLine(dP1B, dP2B, tx)}; }
                    traversePolygons.push([dP1T, dP2T, dP2B, dP1B]);

                    const a = Math.atan2(dP2T.y - dP1T.y, dP2T.x - dP1T.x);
                    let p0R = {...dP1T}, p3R = {...dP2T};
                    if (i===0) p0R = {x: dP1T.x - overhangSymValue * Math.cos(a), y: dP1T.y - overhangSymValue * Math.sin(a)};
                    if (i===traversePoints.length-2) p3R = {x: dP2T.x + overhangSymValue * Math.cos(a), y: dP2T.y + overhangSymValue * Math.sin(a)};
                    
                    const cTop = getOffsetLine(p0R, p3R, -(purlinHeight + 0.05)), cBot = getOffsetLine(p0R, p3R, -purlinHeight);
                    coverPolygons.push([cTop.p1, cTop.p2, cBot.p2, cBot.p1]);
                    
                    const span = Math.hypot(dP2T.x - dP1T.x, dP2T.y - dP1T.y);
                    if (purlinCount > 1) {
                        for (let j=0; j<purlinCount; j++) {
                            const dist = (purlinThickness/2) + j * (span - purlinThickness) / (purlinCount - 1);
                            purlinPolygons.push({x: dP1T.x + dist*Math.cos(a), y: dP1T.y + dist*Math.sin(a), w: purlinThickness, h: purlinHeight, angle: a});
                        }
                    }
                }
                
                for (let i = 0; i < coverPolygons.length - 1; i++) {
                    const p1 = coverPolygons[i], p2 = coverPolygons[i+1];
                    const iT = intersectLinesExt(p1[0], p1[1], p2[0], p2[1], false, true);
                    if (iT) { p1[1] = iT; p2[0] = iT; }
                    const iB = intersectLinesExt(p1[3], p1[2], p2[3], p2[2], false, true);
                    if (iB) { p1[2] = iB; p2[3] = iB; }
                }
                coverPolygons.forEach(poly => { rampantLengths.push(_round2(Math.hypot(poly[1].x - poly[0].x, poly[1].y - poly[0].y))); rampantAnchors.push({p1: poly[0], p2: poly[1]}); });

                // --- Renforts (Bracons / Jarrets) ---
                const getTraverseLineAtX = (xVal) => {
                    for (let line of tBotLines) {
                        const minX = Math.min(line.p1.x, line.p2.x);
                        const maxX = Math.max(line.p1.x, line.p2.x);
                        if (minX - 0.1 <= xVal && xVal <= maxX + 0.1) return line;
                    }
                    let closest = tBotLines[0];
                    let minDist = Infinity;
                    for (let line of tBotLines) {
                        const dist = Math.min(Math.abs(xVal - line.p1.x), Math.abs(xVal - line.p2.x));
                        if (dist < minDist) { minDist = dist; closest = line; }
                    }
                    return closest;
                };

                const getYOnTraverse = (xVal) => {
                    const line = getTraverseLineAtX(xVal);
                    if (Math.abs(line.p2.x - line.p1.x) > 0.001) {
                        return line.p1.y + (xVal - line.p1.x) * (line.p2.y - line.p1.y) / (line.p2.x - line.p1.x);
                    }
                    return line.p1.y;
                };

                const braces = [];
                postsX.forEach((x, index) => {
                    const isEdge = (index === 0 || index === postsX.length - 1);
                    const reinforceType = isEdge ? reinforceTypeEdge : reinforceTypeInt;
                    if (reinforceType === 'none') return;

                    const currentPostTopY = postTops[index].y;
                    let posY;
                    
                    if (heightUnderBrace > 0) {
                        posY = -heightUnderBrace;
                    } else {
                        posY = isEdge ? currentPostTopY * (bracePosPct / 100.0) : currentPostTopY * (bracePosIntermPct / 100.0);
                    }
                    posY = Math.max(currentPostTopY, Math.min(0, posY)); // Contraindre la position entre le sol et le sommet du poteau
                    if (posY === 0 && heightUnderBrace === 0) return;
                    
                    const targets = [];

                    if (isEdge) {
                        targets.push({ pX: index === 0 ? x + postWidth / 2 : x - postWidth / 2, tLine: index === 0 ? tBotLines[0] : tBotLines[tBotLines.length - 1], isLeftOriented: index === 0 });
                    } else {
                        const fakeLineLeft = { p1: { x: postsX[index - 1], y: getYOnTraverse(postsX[index - 1]) }, p2: { x: x, y: getYOnTraverse(x) } };
                        const fakeLineRight = { p1: { x: x, y: getYOnTraverse(x) }, p2: { x: postsX[index + 1], y: getYOnTraverse(postsX[index + 1]) } };
                        targets.push({ pX: x - postWidth / 2, tLine: fakeLineLeft, isLeftOriented: false }, { pX: x + postWidth / 2, tLine: fakeLineRight, isLeftOriented: true });
                    }

                    targets.forEach(target => {
                        const braceP = isEdge ? bracePosTraversePotRive / 100 : bracePosTraverseIntPct / 100;
                        const pStart = { x: target.pX, y: posY }, pCorner = { x: target.pX, y: currentPostTopY };
                        const pEndX = target.isLeftOriented ? target.tLine.p1.x + (target.tLine.p2.x - target.tLine.p1.x) * braceP : target.tLine.p2.x - (target.tLine.p2.x - target.tLine.p1.x) * braceP;
                        const realTLine = getTraverseLineAtX(pEndX);
                        const pEnd = { x: pEndX, y: getYOnTraverse(pEndX) };

                        if (reinforceType === 'jarrets') {
                            braces.push({ points: [pCorner, pEnd, { x: target.pX, y: posY }], type: 'jarrets' });
                        } else if (reinforceType === 'bracons') {
                            const a = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x) + Math.PI / 2;
                            const offX = (braceWidth / 2) * Math.cos(a), offY = (braceWidth / 2) * Math.sin(a);
                            const bPoly = [
                                intersectLinesExt({ x: pStart.x + offX, y: pStart.y + offY }, { x: pEnd.x + offX, y: pEnd.y + offY }, { x: target.pX, y: 1000 }, { x: target.pX, y: -1000 }, true, true),
                                intersectLinesExt({ x: pStart.x + offX, y: pStart.y + offY }, { x: pEnd.x + offX, y: pEnd.y + offY }, realTLine.p1, realTLine.p2, true, true),
                                intersectLinesExt({ x: pStart.x - offX, y: pStart.y - offY }, { x: pEnd.x - offX, y: pEnd.y - offY }, realTLine.p1, realTLine.p2, true, true),
                                intersectLinesExt({ x: pStart.x - offX, y: pStart.y - offY }, { x: pEnd.x - offX, y: pEnd.y - offY }, { x: target.pX, y: 1000 }, { x: target.pX, y: -1000 }, true, true)
                            ];
                            if (bPoly.every(p => p !== null)) braces.push({ points: bPoly, type: 'bracons' });
                        }
                    });
                });

                return Object.assign({}, data, {
                    lowPointHeight: _round2(lowPointHeight), postHeight: _round2(postHeight), faitageCalcule: _round2(faitageCalcule),
                    maxRoofRise: _round2(maxRoofRise), roofApparentHeight: _round2(roofApparentHeight), panneFacadeHeight: _round2(panneFacadeHeight),
                    highPointHeightLeft: _round2(highPointHeightLeft), highPointHeightRight: _round2(highPointHeightRight),
                    pvRows: rows || 0, pvCols: cols || 0, parsedDistances: distancesResult.distances, postDistancesError: distancesResult.error,
                    geometry: {
                        postsX, traversePolygons, coverPolygons, purlinPolygons, postTops, braces,
                        dimensions: {
                            largeur_batiment: widthRoof, faitage: faitageCalcule, egout: hauteurEgout, bas_structure: lowPointHeight,
                            rampants: rampantLengths, pente: roofSlope, anchors: {
                                bas_structure_y: tBotLines.length ? tBotLines[tBotLines.length-1].p2.y : 0,
                                egout_x: rampantAnchors.length ? rampantAnchors[rampantAnchors.length-1].p2.x : 0,
                                egout_y: rampantAnchors.length ? rampantAnchors[rampantAnchors.length-1].p2.y : 0,
                                faitage_y: coverPolygons.length ? Math.min(...coverPolygons.flatMap(p => p.map(pt => pt.y))) : 0,
                                rampant_lines: rampantAnchors
                            }
                        }
                    }
                });
            }

            async function updateAppLogic() {
                let values = getFormValues();

                let currentValuesStr = JSON.stringify(values);
                if (currentValuesStr !== lastFormValuesStr) {
                    lastDismissedError = ""; 
                    lastFormValuesStr = currentValuesStr;
                }

                try {
                    // Calcul local Instantané pour le dessin frontend
                    const data = calculateBuildingGeometryLocal(values);
                    
                    document.getElementById('lowPointHeight').value = data.lowPointHeight.toFixed(2);
                    document.getElementById('postHeight').value = data.postHeight.toFixed(2);
                    document.getElementById('postDistancesError').innerHTML = data.postDistancesError || "";
                    
                    values.lowPointHeight = data.lowPointHeight;
                    values.postHeight = data.postHeight;
                    values.faitageCalcule = data.faitageCalcule;
                    values.roofApparentHeight = data.roofApparentHeight;
                    values.panneFacadeHeight = data.panneFacadeHeight;
                    values.highPointHeightLeft = data.highPointHeightLeft;
                    values.highPointHeightRight = data.highPointHeightRight;
                    values.pvRows = data.pvRows;
                    values.pvCols = data.pvCols;
                    values.geometry = data.geometry;
                    appState.parsedDistances = data.parsedDistances;
                    values.totalProjectionWidth = values.widthRoof;
                    values.beamLength = values.widthRoof + values.overhangSymValue * 2;
                    
                    currentCalculatedValues = values;
                } catch (error) {
                    console.error("Erreur de validation/calcul:", error);
                    appState.parsedDistances = [];
                    currentCalculatedValues = null; // Bloque le dessin du canvas
                    showCustomModal("Valeur hors limite", error.message, true);
                }
                
                return currentCalculatedValues;
            }

            function parseSpanInput(input) {
                if (!input) return [];
                // Supporte les listes séparées par des virgules (ex: 1,3,4)
                return input.split(',')
                    .map(s => s.trim().replace('*', ''))
                    .map(Number)
                    .filter(n => !isNaN(n) && n > 0);
            }

            async function runAllDrawings() {
                await updateAppLogic();
                if (currentCalculatedValues) {
                    coupeViewManager.draw(currentCalculatedValues);
                    facadeViewManager.draw(currentCalculatedValues);
                    implantationViewManager.draw(currentCalculatedValues);

                    // Sauvegarde automatique des canvas dans localStorage pour l'export PDF
                    try {
                        const _toB64 = (canvasId) => {
                            const c = document.getElementById(canvasId);
                            if (!c || c.width === 0 || c.height === 0) return null;
                            const tmp = document.createElement('canvas');
                            tmp.width = c.width;
                            tmp.height = c.height;
                            const ctx = tmp.getContext('2d');
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(0, 0, tmp.width, tmp.height);
                            ctx.drawImage(c, 0, 0);
                            return tmp.toDataURL('image/jpeg', 0.85);
                        };
                        const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';
                        const existing = (() => {
                            try { return JSON.parse(localStorage.getItem('geometriePlansData') || '{}'); }
                            catch(e) { return {}; }
                        })();
                        existing[pvId] = {
                            coupe:        _toB64('coupeCanvas'),
                            facade:       _toB64('facadeCanvas'),
                            implantation: _toB64('implantationCanvas'),
                            ombriereType: 'batiment_metal',
                            savedAt: new Date().toISOString()
                        };
                        existing.savedAt = new Date().toISOString();
                        localStorage.setItem('geometriePlansData', JSON.stringify(existing));
                    } catch(e) {
                        console.warn('[Batiment Metal] Sauvegarde canvas localStorage échouée:', e);
                    }
                }
            }

            // [Fonctions de gestion du Modal, de la Vue (ViewManager), et des Canvases]

            const modal = document.getElementById('app-modal');
            const modalOverlay = document.getElementById('modal-overlay');
            const modalHeader = document.getElementById('modal-header');


            document.getElementById('close-modal-btn').addEventListener('click', (e) => {
                modal.classList.add('hidden');
                modalOverlay.classList.add('hidden');
            });

            document.getElementById('toggle-form-btn').addEventListener('click', () => {
                const appModal = document.getElementById('app-modal');
                appModal.classList.toggle('form-hidden');
                setTimeout(() => {
                    scheduleUpdate();
                    if (map) map.invalidateSize();
                    adjustCanvasHeights();
                }, 350);
            });

            let isDragging = false,
                offsetX, offsetY;
            modalHeader.addEventListener('mousedown', (e) => {
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
                modal.offsetHeight;
                adjustCanvasHeights();
                scheduleUpdate();
            });

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

                    // Propriétés pour la jonction
                    this.traverseBottomLines = [];

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
                    const valuesToUse = calculatedValues || currentCalculatedValues;
                    if (valuesToUse && valuesToUse.geometry) {
                        this.drawFunction(this.canvas, this.ctx, this, valuesToUse);
                    }
                }
            }

            function adjustCanvasHeights() {
                const canvasColumn = document.getElementById('canvas-column');
                const coupeContainer = document.getElementById('coupe-container');
                const facadeContainer = document.getElementById('facade-block-container');
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

            const coupeViewManager = new ViewManager(document.getElementById('coupeCanvas'), drawCoupe);
            const facadeViewManager = new ViewManager(document.getElementById('facadeCanvas'), drawFacade);
            const implantationViewManager = new ViewManager(document.getElementById('implantationCanvas'), drawImplantation);
            const managers = {
                Coupe: coupeViewManager,
                Facade: facadeViewManager,
                Implantation: implantationViewManager
            };

            let debounceTimeout;
            document.querySelectorAll('.all-inputs').forEach(input => input.addEventListener('input', () => {
                if (input.id === 'overhangValue') {
                    document.getElementById('overhangSymValue').value = input.value;
                }

            // CORRECTION: Si l'utilisateur modifie un pourcentage de positionnement des bracons,
            // on force la hauteur sous renfort à 0 pour que le calcul prenne bien en compte les pourcentages.
            if (['bracePosPct', 'bracePosIntermPct', 'bracePosTraverseIntPct', 'bracePosTraversePotRive'].includes(input.id)) {
                const heightUnderBraceInput = document.getElementById('heightUnderBrace');
                if (heightUnderBraceInput && parseFloat(heightUnderBraceInput.value) > 0) {
                    heightUnderBraceInput.value = 0;
                }
            }

                // Voir bloc "ALGORITHME DE CALCUL AUTOMATIQUE DES POTEAUX" : toute saisie manuelle de
                // #postDistances désactive définitivement l'auto-remplissage, tandis qu'une modification
                // de la longueur de façade ou du porte-à-faux gauche recalcule l'entraxe optimal (sauf
                // si l'auto-remplissage lui-même est à l'origine de cet évènement 'input').
                if (input.id === 'postDistances' && !isAutoFillingPostDistances) {
                    userEditedPostDistances = true;
                } else if (input.id === 'facadeLength' || input.id === 'leftOverhang') {
                    autoFillOptimalEntraxeBatiment();
                }

                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    scheduleUpdate();
                    setTimeout(adjustCanvasHeights, 50);
                }, 300);
            }));

            document.getElementById('toolInvertSlope').addEventListener('click', (e) => { appState.invertSlope = !appState.invertSlope; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });

            document.getElementById('toolDimColors').addEventListener('click', (e) => {
                const btn = e.target.closest('.dim-color-btn'); if (!btn) return;
                appState.dimensionColor = btn.dataset.color;
                document.querySelectorAll('.dim-color-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); scheduleUpdate();
            });

            // Renforts de Rives
            document.getElementById('reinforceBracons').addEventListener('click', (e) => {
                appState.reinforcementType = 'bracons';
                setupToggleButton(e.currentTarget, document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
                scheduleUpdate();
            });
            document.getElementById('reinforceJarrets').addEventListener('click', (e) => {
                appState.reinforcementType = 'jarrets';
                setupToggleButton(e.currentTarget, document.querySelectorAll('.controls-container .toggle-btn-group button[id^="reinforce"]'));
                scheduleUpdate();
            });

            // Renforts Intermédiaires
            document.getElementById('toggleBraceInterBracons').addEventListener('click', (e) => {
                appState.interReinforcementType = 'bracons';
                setupToggleButton(e.currentTarget, document.querySelectorAll('#intermediateBraceControls button'));
                scheduleUpdate();
            });
            document.getElementById('toggleBraceInterJarrets').addEventListener('click', (e) => {
                appState.interReinforcementType = 'jarrets';
                setupToggleButton(e.currentTarget, document.querySelectorAll('#intermediateBraceControls button'));
                scheduleUpdate();
            });

            const allModelButtons = document.querySelectorAll('#model-btn-group button');
            const asymmetryFields = document.getElementById('asymmetryFields');
            const symSlopeControl = document.getElementById('symSlopeControl');

            const setModel = (model) => {
                appState.postModel = model;

                const isAsymmetric = model === 'asymetrique';
                asymmetryFields.classList.toggle('hidden', !isAsymmetric);
                symSlopeControl.classList.toggle('hidden', isAsymmetric);

                // Renforts par défaut
                appState.reinforcementType = 'bracons';
                document.getElementById('reinforceBracons').classList.add('active');
                document.getElementById('reinforceJarrets').classList.remove('active');

                // Pente par défaut
                if (!isAsymmetric) {
                    document.getElementById('roofSlope').value = 8;
                }

                // Nombre de poteaux par défaut : 2 pour tous les modèles, 3 pour Multipente
                // (qui nécessite au moins 2 pans, donc (postCount - 1) >= 2 lignes de poteaux).
                const postCountInput = document.getElementById('postCount');
                if (postCountInput) postCountInput.value = (model === 'multipente') ? 3 : 2;

                // Position Traverse: 'top' FIXÉ
                appState.traversePosition = 'top';

                // Renfort intermédiaire: 'bracons' par défaut
                appState.interReinforcementType = 'bracons';
                document.querySelectorAll('#intermediateBraceControls button').forEach(btn => btn.classList.remove('active'));
                document.getElementById('toggleBraceInterBracons').classList.add('active');

                scheduleUpdate().then(adjustCanvasHeights);
            };

            document.getElementById('modelBipente').addEventListener('click', (e) => {
                setupToggleButton(e.currentTarget, allModelButtons);
                setModel('bipente');
            });
            document.getElementById('modelMonopente').addEventListener('click', (e) => {
                setupToggleButton(e.currentTarget, allModelButtons);
                setModel('monopente');
            });
            document.getElementById('modelAsymetrique').addEventListener('click', (e) => {
                setupToggleButton(e.currentTarget, allModelButtons);
                setModel('asymetrique');
            });
            document.getElementById('modelMultipente').addEventListener('click', (e) => {
                setupToggleButton(e.currentTarget, allModelButtons);
                setModel('multipente');
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
            // l'implantation des poteaux y est générée automatiquement (sommaire), sans tenir
            // compte des contraintes spécifiques du projet.
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
                        Veuillez adapter le plan d'implantation des poteaux à votre projet. Il s'agit
                        d'une implantation sommaire générée automatiquement par le logiciel pour
                        l'affichage du modèle, qui ne tient pas compte de vos contraintes spécifiques.
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
                document.querySelectorAll(groupClass).forEach(t => t.classList.remove('active')); tabButton.classList.add('active');
                document.querySelectorAll(contentClass).forEach(c => c.classList.add('hidden'));
                const targetView = document.getElementById(tabButton.id.replace('tab', 'view'));
                if (targetView) targetView.classList.remove('hidden');

                await new Promise(resolve => requestAnimationFrame(resolve));

                if (tabButton.id === 'tabCalepinage' && map) {
                    map.invalidateSize();
                }
                // CORRECTIF : le plan de façade est l'onglet actif par défaut au sein de son
                // groupe — il ne reçoit donc jamais lui-même de clic tant que l'utilisateur ne
                // clique pas explicitement dessus. C'est le clic sur "Plan de coupe" qui révèle
                // réellement la zone contenant Façade/Implantation (masquée par défaut, cf.
                // calepinage-full) : le message doit donc aussi apparaître à ce moment-là.
                // Ne s'affiche que sur une action RÉELLE de l'utilisateur (isTrusted, pas un
                // changement d'onglet déclenché par le code au chargement), et seulement si
                // l'utilisateur n'a pas déjà personnalisé lui-même l'implantation des poteaux
                // (postDistances) — dans ce cas l'avertissement n'a plus lieu d'être.
                if ((tabButton.id === 'tabFacade' || tabButton.id === 'tabCoupe') && isTrusted && !userEditedPostDistances) {
                    showFacadeDisclaimerOnce();
                }
                await scheduleUpdate();
            }
            document.getElementById('tabCoupe').addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget, e.isTrusted));
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

            // --- EXPORT FUNCTIONS (Conservées) ---
            document.getElementById('exportCoupeBtn').addEventListener('click', async () => {
                const canvas = await html2canvas(document.getElementById('coupeCanvas'), { scale: 2, backgroundColor: '#ffffff' });
                const link = document.createElement('a'); link.download = 'plan-coupe.png'; link.href = canvas.toDataURL('image/png', 1.0); link.click();
            });
            document.getElementById('exportFacadeBtn').addEventListener('click', async () => {
                const canvas = await html2canvas(document.getElementById('facadeCanvas'), { scale: 2, backgroundColor: '#ffffff' });
                const link = document.createElement('a'); link.download = 'plan-facade.png'; link.href = canvas.toDataURL('image/png', 1.0); link.click();
            });
            document.getElementById('printBtn').addEventListener('click', () => window.print());

            const safeCapture = async (canvasId, isIframe = false) => {
                const el = document.getElementById(canvasId);
                if (!el) return null;
                try {
                const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
                return canvas.toDataURL('image/png', 1.0);
                } catch (e) {
                    console.warn(`Erreur lors de la capture du canvas ${canvasId}`, e);
                    return null;
                }
            };

            document.getElementById('exportPdfBtn').addEventListener('click', async () => {
                const exportBtn = document.getElementById('exportPdfBtn');
                const originalText = exportBtn.innerHTML;
                exportBtn.disabled = true;
                exportBtn.innerHTML = "Génération du PDF...";

                try {
                    // CORRECTIF : cet export appelait un backend Python (/api/generate_report ->
                    // rapport_batiment_metal.generate_a3_pdf_batiment_metal) qui n'existe pas dans le
                    // projet (404, puis 500 une fois l'URL corrigée). L'export fonctionnel côté
                    // ombriere_metal.js est entièrement client (jsPDF), sans backend : on réutilise ici
                    // window.appendBatimentMetalPages (déjà présente plus bas dans ce fichier, utilisée
                    // par le rapport global) qui capture déjà correctement les 4 plans (coupe, façade,
                    // calepinage, implantation) avec recadrage et annotations.
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
                    await window.appendBatimentMetalPages(doc);
                    doc.deletePage(1); // Retire la page vierge initiale créée par défaut par jsPDF
                    doc.save('plans-batiment.pdf');
                } catch (e) {
                    console.error("PDF Export Error:", e);
                    showCustomModal("Erreur", "Erreur lors de l'export PDF.", true);
                } finally {
                    exportBtn.innerHTML = originalText;
                    exportBtn.disabled = false;
                    await scheduleUpdate();
                }
            });

            // --- INITIALIZATION (Conservée et adaptées) ---
            window.addEventListener('load', () => {
                document.getElementById('reinforceBracons').classList.add('active');
                document.getElementById('toggleBraceInterBracons').classList.add('active');

                document.querySelector('.dim-color-btn[data-color="#0000FF"]').classList.add('active');

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

            // Lancement automatique (Déplacé à la fin pour garantir l'initialisation)
            modal.classList.remove('hidden');
            modalOverlay.classList.remove('hidden');
            switchTab('.tab-group-1', '.tab-content-1', document.getElementById('tabCalepinage'));
            document.getElementById('modelBipente').click();
            // Entraxe par défaut calculé automatiquement (voir bloc "ALGORITHME DE CALCUL
            // AUTOMATIQUE DES POTEAUX" plus haut), à la place de l'ancienne valeur statique "3*10 + 6".
            autoFillOptimalEntraxeBatiment();
            scheduleUpdate().then(() => {
                adjustCanvasHeights();
            });


            // ==================== PATCH POUR INTÉGRATION DANS LE RAPPORT GLOBAL ====================
            window._batimentMetalType = 'batiment_metal';
            window._batimentMetalReady = true;

            window.appendBatimentMetalPages = async (doc) => {
                console.log('🔄 [Batiment Metal] appendBatimentMetalPages appelé');

                // CORRECTIF : inclure aussi .tab-content-2 (Plan de façade / Plan d'implantation), pas
                // seulement .tab-content-1 (Plan de calepinage / Plan de coupe) — sinon le plan
                // d'implantation (masqué par défaut tant que son onglet n'a jamais été ouvert) restait
                // à taille nulle lors de la capture et n'apparaissait jamais dans le PDF exporté.
                const views = document.querySelectorAll('.tab-content-1, .tab-content-2');
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

                const prevFlag = window.isGeneratingPDF;
                window.isGeneratingPDF = true;

                try {
                    await runAllDrawings();
                    const calepIframe = document.querySelector('iframe');
                    if (calepIframe?.contentWindow?.calculateAndDraw) {
                        await calepIframe.contentWindow.calculateAndDraw();
                    } else if (typeof window.calculateAndDraw === 'function') {
                        await window.calculateAndDraw();
                    }
                    await new Promise(r => setTimeout(r, 500));

                    // Helper : Rogne l'image pour éviter les marges blanches tout en protégeant les hachures
                    // (cf. ombriere_metal.js / ombriere_bois.js / ombriere_solumbra.js, absent jusqu'ici de
                    // ce fichier : l'image du calepinage prenait tout le canvas sans être recadrée).
                    const getCroppedCanvas = (sourceCanvas) => {
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

                        const padding = 20;
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
                    };

                    // Construit les lignes d'annotation "Données techniques calepinage" à partir des
                    // valeurs déjà synchronisées et affichées dans l'iframe de calepinage (mêmes valeurs
                    // que les cartes #dim-results-overlay / #orientation-overlay / #ref-pv-si-overlay),
                    // pour garantir la cohérence avec l'écran et éviter de mal réinterpréter le format
                    // brut des données du localStorage (ex: les dimensions panneaux, qui ne s'affichaient
                    // pas avec l'ancienne version basée sur formData.dimensionsPanneaux).
                    const buildCalepinageAnnotationLines = (iframeDoc) => {
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
                    };

                    // Neutraliser temporairement la bordure de #drawing-zone et ses boutons de zoom/pan :
                    // ces éléments touchent les bords du conteneur et empêchaient le recadrage
                    // (getCroppedCanvas) de se resserrer sur les panneaux/toiture/cotations réellement
                    // utiles (l'image capturée prenait alors tout le canvas).
                    let _dzBorderBackup = null, _dzControls = null;
                    try {
                        const ifrDoc = calepIframe?.contentWindow?.document;
                        const dz = ifrDoc?.getElementById('drawing-zone');
                        if (dz) { _dzBorderBackup = dz.style.border; dz.style.border = 'none'; }
                        _dzControls = ifrDoc?.querySelector('#drawing-zone > div:not(#canvas-pan-zoom-wrapper):not(#north-pointer)');
                        if (_dzControls) _dzControls.style.display = 'none';
                    } catch (e) {}

                    const safeCapture = async (canvasId, isIframe = false) => {
                        let targetEl;
                        if (isIframe) {
                            const iframe = document.querySelector('iframe');
                            // #drawing-zone (panneaux + toiture + cotations uniquement, sans les cartes d'infos
                            // de la barre latérale #overlays-sidebar) plutôt que #pdf-capture-area (qui inclut
                            // la barre latérale).
                            targetEl = iframe?.contentWindow?.document?.getElementById('drawing-zone') || iframe?.contentWindow?.document?.getElementById('pv-canvas');
                            if (!targetEl) targetEl = document.getElementById('drawing-zone') || document.getElementById('pv-canvas');
                        } else {
                            targetEl = document.getElementById(canvasId);
                        }
                        if (!targetEl) return null;
                        if (targetEl.tagName === 'CANVAS' && (targetEl.width === 0 || targetEl.height === 0)) return null;
                        try {
                            if (targetEl.tagName === 'CANVAS') {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = targetEl.width;
                                tempCanvas.height = targetEl.height;
                                const tCtx = tempCanvas.getContext('2d');
                                tCtx.fillStyle = '#ffffff';
                                tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                                tCtx.drawImage(targetEl, 0, 0);
                                return tempCanvas;
                            } else {
                                const captured = await html2canvas(targetEl, { scale: 2, backgroundColor: '#ffffff' });
                                return getCroppedCanvas(captured) || captured;
                            }
                        } catch (e) {
                            console.warn(`Échec capture ${canvasId}`, e);
                            return null;
                        }
                    };

                    const coupeCanvas    = await safeCapture('coupeCanvas');
                    const facadeCanvas   = await safeCapture('facadeCanvas');
                    const implantCanvas  = await safeCapture('implantationCanvas');
                    const calepCanvas    = await safeCapture('pv-canvas', true);

                    try {
                        if (_dzControls) _dzControls.style.display = '';
                        const ifrDocRestore = calepIframe?.contentWindow?.document;
                        const dzRestore = ifrDocRestore?.getElementById('drawing-zone');
                        if (dzRestore) dzRestore.style.border = _dzBorderBackup || '';
                    } catch (e) {}

                    console.log('📸 [Batiment Metal] Canvas capturés :', {
                        coupe: coupeCanvas ? `${coupeCanvas.width}x${coupeCanvas.height}` : 'null',
                        facade: facadeCanvas ? `${facadeCanvas.width}x${facadeCanvas.height}` : 'null',
                        implantation: implantCanvas ? `${implantCanvas.width}x${implantCanvas.height}` : 'null',
                        calepinage: calepCanvas ? `${calepCanvas.width}x${calepCanvas.height}` : 'null'
                    });

                    const A3_W = 420, A3_H = 297, margin = 15;
                    const gridW = (A3_W - 3 * margin) / 2;
                    const gridH = (A3_H - 45) / 2;

                    doc.addPage([A3_W, A3_H], 'landscape');

                    doc.setFontSize(20);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 0, 0);
                    doc.text("Plans d'Exécution – Bâtiment Métal", A3_W / 2, margin, { align: 'center' });

                    const addPlanImage = (canvas, title, x, y, annotation) => {
                        doc.setFontSize(14);
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(0, 0, 0);
                        doc.text(title, x, y + 5);
                        doc.setDrawColor(150);
                        doc.setLineWidth(0.5);
                        doc.rect(x, y, gridW, gridH);

                        // Annotation des données techniques du calepinage (remplace les cartes d'infos
                        // retirées de l'image capturée : Nbre panneaux, Puissance, Pente, Azimut, Réf SI, Dim panneaux).
                        let contentTopOffset = 10;
                        if (annotation && annotation.length) {
                            doc.setFontSize(8);
                            doc.setFont('helvetica', 'normal');
                            doc.setTextColor(60, 60, 60);
                            annotation.forEach((line, i) => {
                                doc.text(line, x + 3, y + contentTopOffset + (i * 3.5));
                            });
                            doc.setTextColor(0, 0, 0);
                            contentTopOffset += annotation.length * 3.5 + 2;
                        }

                        if (canvas) {
                            try {
                                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                                const imgProps = doc.getImageProperties(imgData);
                                const ratio = imgProps.width / imgProps.height;
                                const availW = gridW - 10;
                                const availH = gridH - contentTopOffset - 5;
                                let fw = availW, fh = availW / ratio;
                                if (fh > availH) { fh = availH; fw = availH * ratio; }
                                const drawX = x + (gridW - fw) / 2;
                                const drawY = y + contentTopOffset + (availH - fh) / 2;
                                doc.addImage(imgData, 'JPEG', drawX, drawY, fw, fh);
                            } catch (imgErr) {
                                console.warn(`⚠️ [Batiment Metal] Erreur addImage "${title}":`, imgErr);
                                doc.setFontSize(10);
                                doc.setTextColor(200, 0, 0);
                                doc.text('Erreur image', x + gridW / 2, y + gridH / 2, { align: 'center' });
                                doc.setTextColor(0, 0, 0);
                            }
                        } else {
                            doc.setFontSize(12);
                            doc.setTextColor(200, 0, 0);
                            doc.text('Plan non disponible', x + gridW / 2, y + gridH / 2, { align: 'center' });
                            doc.setTextColor(0, 0, 0);
                        }
                    };

                    addPlanImage(coupeCanvas,   '1. Plan de Coupe',        margin,              25);
                    addPlanImage(facadeCanvas,  '2. Plan de Façade',      margin * 2 + gridW,   25);
                    addPlanImage(calepCanvas,   '3. Plan de Calepinage',  margin,              25 + gridH + 10, buildCalepinageAnnotationLines(calepIframe?.contentWindow?.document));
                    addPlanImage(implantCanvas, "4. Plan d'Implantation", margin * 2 + gridW,   25 + gridH + 10);

                    console.log('✅ [Batiment Metal] Tous les plans ajoutés au document global');
                } catch (err) {
                    console.error('❌ [Batiment Metal] Erreur dans appendBatimentMetalPages :', err);
                    doc.addPage([420, 297], 'landscape');
                    doc.setFontSize(14);
                    doc.setTextColor(200, 0, 0);
                    doc.text('Erreur lors de la génération des plans Bâtiment Métal.', 210, 148, { align: 'center' });
                    doc.setTextColor(0, 0, 0);
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
                    window.isGeneratingPDF = prevFlag || false;
                }
            };


        });
