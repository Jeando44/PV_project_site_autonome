document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL VARIABLES & APP STATE ---
    let map;
    let appState = {
        postModel: 'single', // MOD 1.1: Sera réglé sur 'single' au lancement
        traversePosition: 'side', // Valeur par défaut demandée : "Côté" au lieu de "Dessus"
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
        showExtBracing: false, // Ajout pour le contreventement extérieur
        showFoundation: false, // Désélectionné par défaut
        showDimensions: false, // Cotations masquées par défaut (#toolToggleDimensions)
        showHeightHelperDims: false, // Cotations "Hauteur sous bracon" + "Hauteur libre de passage" masquées par défaut
        showAltimetryDims: true, // Cotation altimétrique (croix + "+0.00= X Ngf") affichée par défaut (#toolToggleAltimetryDims)
        showParcelLimitDims: true, // Ligne verticale "Limite parcellaire" (coupe + façade) affichée par défaut (#toolToggleParcelLimitDims)
        // Fondations : système d'ancrage ('beton' | 'vis' | 'micropieu'), configuration béton ('1p' =
        facadeOrientation: 'Sud', // Orientation affichée sur le Plan de façade (défaut demandé : Sud)
        // FIX (item 3) : contrôle dédié pour le Plan de coupe (#coupe-orientation-group), distinct de
        // facadeOrientation ci-dessus (utilisé par le Plan de façade) — défaut demandé : Est.
        coupeOrientation: 'Est',
        // un plot par poteau | 'dp' = longrine partagée pour 2 poteaux, modèle Double Poteaux),
        // position du béton par rapport au terrain ('surface' = posé sur le sol | 'enterre'), et
        // variante vis ('simple' | avec jambes de renfort, cf. visReinforced).
        anchorSystem: 'beton',
        foundationConfig: '1p',
        foundationPosition: 'surface',
        visReinforced: false,
        // Position de la vis AVEC renfort uniquement ('enterre' | 'surface') — la vis simple et le
        // micropieu restent toujours entièrement enterrés, cf. drawFoundationVis/drawFoundationMicropieu.
        visPosition: 'enterre',
        // Micropieu : affichage de la plaque d'about en extrémité inférieure (masquable).
        micropieuShowPlate: true,
    };
    window.appState = appState; // Exposé pour ombriere_liasonnee.js
    let isUpdateScheduled = false;
    let lastValidPostDistances = document.getElementById('postDistances') ? document.getElementById('postDistances').value : "";
    // Voir updateOverhangsFromCalepinage() (item 4) : tant que l'utilisateur n'a pas modifié
    // lui-même le champ "Entraxes poteaux", celui-ci reste recalculé automatiquement à partir du
    // calepinage (LxC) et de l'entraxe fixe #facadeEntraxe. Démarre à false pour que ce calcul
    // s'applique dès le chargement (remplace la valeur statique "2*4.925" du HTML).
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

            // Vue par défaut : "Double Poteaux" / variante V3, fondations affichées en Vis.
            // Le clic active le bouton ET lance le scheduleUpdate via son listener
            document.getElementById('modelDoublePost').click();
            document.getElementById('bracingV3').click();
            document.getElementById('toolFoundation').click();
            document.getElementById('anchorVis').click();

            // Active l'onglet "Plan de coupe" par défaut (l'onglet "Plan de calepinage"/l'iframe
            // associée ont été retirés).
            switchTab('.tab-group-1', '.tab-content-1', document.getElementById('tabCoupe'));

            // Lancement initial
            scheduleUpdate().then(() => {

                // MOD 1.0: Lancer l'ajustement de hauteur
                adjustCanvasHeights();
            });
        });
    } else {
        // Pas de modal de bienvenue — initialiser directement.
        // NB : ce .click() est sans effet réel sur appState à ce stade (les gestionnaires de clic
        // des boutons modèle, enregistrés plus bas dans ce même fichier, ne sont pas encore attachés
        // ici) — le modèle par défaut effectivement appliqué est celui forcé par le handler
        // window.load ("FORCER LE MODÈLE PAR DÉFAUT", plus bas), qui s'exécute après coup.
        const modelBtn = document.getElementById('modelSinglePost');
        if (modelBtn) modelBtn.click();
        const tabCoupeDefault = document.getElementById('tabCoupe');
        if (tabCoupeDefault) switchTab('.tab-group-1', '.tab-content-1', tabCoupeDefault);
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
            // Si on génère un PDF, on force une taille pour éviter de capturer un canvas vide.
            // FIX (flou export PDF) : 1200x800 restait net sur la grille 4 plans/page mais devenait
            // flou une fois agrandi sur la moitié d'une page A3 (zone "grande échelle" du plan de
            // coupe, page 2) — ~76 DPI effectifs, bien en dessous du seuil de netteté à l'impression
            // (~300 DPI). Base portée à 3600x2400 (x3) : le pipeline de dessin (drawCoupe/drawFacade)
            // recalcule "scale" à partir de cette taille, donc tout le plan gagne en résolution sans
            // changer les proportions ni la mise en page.
            if (window.isGeneratingPDF) {
                w = 3600;
                h = 2400;
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

    function drawDimensionLine(context, x1, y1, x2, y2, text, offset = 0, isVertical = false, fontSize = 12) {
        if (!appState.showDimensions) return; // Bouton "Masquer/Afficher les cotations" (#toolToggleDimensions)
        context.save();
        context.strokeStyle = appState.dimensionColor;
        context.fillStyle = appState.dimensionColor;
        context.lineWidth = 1;
        context.font = `${fontSize}px Arial`;
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
        const textMetrics = context.measureText(text); const textWidth = textMetrics.width; const textHeight = fontSize + 2;
        context.fillStyle = '#FFFFFF'; context.fillRect(-(textWidth / 2) - 2, -(textHeight / 2), textWidth + 4, textHeight);
        context.fillStyle = appState.dimensionColor; context.fillText(text, 0, 0);
        context.restore(); context.restore();
    }
    window.drawDimensionLine = drawDimensionLine; // Exposé pour ombriere_liasonnee.js (cotation d'entraxe)

    /**
     * Cotation verticale d'un point (x_target, y_target) jusqu'au SOL, tracée sur la ligne x_dim_line.
     * - groundY : Y du sol (nombre, historique) ou FONCTION x -> Y du sol dans le repère courant (terrain
     *   réel : profil automatique ou droite manuelle).
     * - options.mesure : 'ligne' (défaut) = la cote descend jusqu'au sol SOUS la ligne de cote (elle le
     *   touche toujours, sans flotter ni s'enfoncer) ; 'cible' = mesurée depuis le sol au droit du point
     *   coté (pied de poteau : hauteur sous bracon, passage), reportée sur la ligne de cote par une ligne
     *   de rappel en pointillés — la valeur reste la hauteur réelle au poteau.
     * - text null + options.echelle (px/m) : valeur CALCULÉE sur le dessin (longueur réellement tracée),
     *   donc toujours juste quel que soit le terrain.
     */
    function drawVerticalDimensionWithLeader(context, x_target, y_target, x_dim_line, text, groundY = 0, fontSize = 12, options = {}) {
        if (!appState.showDimensions) return; // Bouton "Masquer/Afficher les cotations" (#toolToggleDimensions)
        const solEn = typeof groundY === 'function' ? groundY : () => groundY;
        const xPied = options.mesure === 'cible' ? x_target : x_dim_line;
        const yPied = solEn(xPied);
        const libelle = (text == null && options.echelle > 0) ? `${((yPied - y_target) / options.echelle).toFixed(2)}m` : text;
        context.save();
        context.strokeStyle = appState.dimensionColor; context.fillStyle = appState.dimensionColor; context.lineWidth = 1; context.font = `${fontSize}px Arial`;
        context.beginPath(); context.setLineDash([2, 3]); context.moveTo(x_target, y_target); context.lineTo(x_dim_line, y_target); context.stroke();
        if (xPied !== x_dim_line) {
            context.beginPath(); context.moveTo(x_target, yPied); context.lineTo(x_dim_line, yPied); context.stroke();
        }
        context.setLineDash([]); drawDimensionLine(context, x_dim_line, yPied, x_dim_line, y_target, libelle, 0, true, fontSize);
        context.restore();
    }

    const intersect = (p1, p2, p3, p4) => {
        const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
        if (den === 0) return null;
        const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
        // const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;

        return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
    };
    // Exposé pour les fichiers de dessin séparés (petit_champ_solaire_poteau_Double poteaux_*.js)
    // qui ont besoin de cette même intersection géométrique, sans dupliquer sa formule.
    window.intersect = intersect;

    // --- CORE DRAWING FUNCTIONS ---
    function drawCoupe(canvas, ctx, viewManager, values) {
        const { width, height } = setupCanvas(canvas);
        if (width === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY);
        ctx.scale(viewManager.zoom, viewManager.zoom);

        // Récupération de toutes les valeurs
        const { postHeight = 0, lowPointHeight = 0, passageHeight = 0, roofSlope = 0, purlinCount = 6, postWidth = 0.4, beamHeight = 0.2, panelWidth = 0, panelThickness = 0.05, purlinHeight = 0.2, integrationSystemHeight = 0, overhangSymValue = 0, overhangAsymHigh = 0, overhangAsymLow = 0, heightUnderBrace = 2.0, braceFixPercentage = 70, postSpacing = 0, postEccentricity = 0, postSpacingInclined = 0, postInclinationInclined = 65, braceWidth = 0.15, beamLength = 0 } = values;

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

        // panelWidth est la largeur totale du champ PV (ex: 12.40 ou 5.85)
        const effectiveWidthForHeight = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') ? panelWidth / 2 : panelWidth;
        const highPointHeightValue = lowPointHeight + Math.abs(effectiveWidthForHeight * Math.sin(roofSlopeRadians));
        // FIX (item 1) : marge portée à +6m (au lieu de +2m) pour garder dans le cadre les nouvelles
        // cotations horizontales positionnées à 4m au-dessus du point le plus haut des panneaux
        // (limite de parcelle, largeur toiture projetée, espacement entre shed), + marge résiduelle.
        // Terrain automatique (IGN/Google, cf. geometrie_structure/terrain_plans.js) : fonction de sol
        // en mètres (xM = abscisse du dessin, 0 = shed 0 ; zRel = altitude relative, positive vers le
        // haut), ou null -> saisie manuelle historique (droite, cf. getCoupeGroundY plus bas).
        const solCoupeAuto = (window.TerrainPlans && typeof window.TerrainPlans.solCoupe === 'function')
            ? window.TerrainPlans.solCoupe({ invertSlope: localInvertSlope })
            : null;
        const totalDrawingHeight = highPointHeightValue + 6;

        // Répétition "sheds" (petit champ solaire) : nbShed rangées identiques. Le pas horizontal entre
        // deux rangées = projection horizontale du rampant (largeur champ PV x cos(pente), l'emprise au sol
        // d'une ombrière) + shedSpacing (le dégagement libre saisi par l'utilisateur) — c'est ainsi que les
        // ombrières se positionnent par défaut. Calculé ici (avant l'échelle) pour que la vue "Tout voir" englobe
        // bien toutes les rangées, pas seulement la première.
        // CORRECTIF (demande explicite : "il n'y a pas le bon nombre de shed dessiné sur les plans de
        // coupe") : une précédente correction plafonnait volontairement le nombre de rangées
        // RÉELLEMENT DESSINÉES à une petite valeur illustrative (5), quelle que soit la valeur
        // synchronisée de "Nbre de shed" (potentiellement plus grande, cf. sync_calepinage_shed.js) —
        // au prétexte qu'un grand nombre de rangées fait mécaniquement diminuer `scale` (cf.
        // widthForScale plus bas), rendant les traits à épaisseur fixe visuellement épais/sombres. Ce
        // plafond créait cependant exactement le bug rapporté : le plan de coupe (et son export PDF/DXF
        // vectoriel, qui rejoue cette même fonction — cf. plan_coupe_petit_champ_solaire.js) affichait
        // moins de rangées que la valeur réelle synchronisée. On dessine désormais le compte RÉEL, avec
        // un plafond de sécurité large (200) qui ne sert qu'à écarter une valeur aberrante/corrompue,
        // jamais à limiter un cas d'usage légitime.
        const MAX_SHED_REPETITIONS_SAFETY = 200;
        const nbShedRaw = parseInt(values.nbShed, 10);
        const nbShedCount = (Number.isFinite(nbShedRaw) && nbShedRaw > 0)
            ? Math.min(nbShedRaw, MAX_SHED_REPETITIONS_SAFETY)
            : 1;
        
        // Correctif Bipente (Y-Shape) : la projection est celle d'UN SEUL pan de toiture (panelWidth / 2).
        // CORRECTION DEMANDÉE : Pour le modèle Bipente, la projection doit couvrir les DEUX pans pour
        // que l'espacement saisi corresponde à la distance libre entre les bords des toitures.
        const widthForShedProjection = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape')
            ? panelWidth * 2 // On double la largeur projetée pour le calcul du pas
            : panelWidth;
        const projectedPanelsWidthMeters = widthForShedProjection * Math.cos(roofSlopeRadians);
        // L'ancienne formule (basée sur les dimensions unitaires des panneaux) est conservée en commentaire
        // au cas où, mais la nouvelle (basée sur la largeur totale du champ PV) est plus directe.
        // inter-panneaux (contrairement à panelWidth qui les inclut) : formule fournie par l'utilisateur.
        // Le paramètre UI "Espacement entre shed" (values.shedSpacing, ex: 0.5m) N'EST PAS modifié/écrasé
        // à l'écran — seule cette variable de calcul interne (shedPitchMeters) additionne la largeur
        // projetée à cette valeur (ex: 4.66m + 0.5m = 5.16m), utilisée uniquement pour le pas de
        // répétition des sheds.
        const paysageBtnForShed = document.getElementById('panelOrientationPaysage');
        const isPaysageForShed = !!(paysageBtnForShed && paysageBtnForShed.classList.contains('active'));
        const dimAlongRampantMmForShed = isPaysageForShed ? (values.petitPanelWidthMm || 0) : (values.petitPanelLengthMm || 0);
        const nbPanelsRampantForShed = Math.max(1, Math.round(values.nbPanelsRampant) || 1);
        const shedPitchMeters = projectedPanelsWidthMeters + (values.shedSpacing || 0);

        // CORRECTIF (demande explicite : "le dessin ne doit plus s'écraser pour tenir dans un cadre
        // fixe, quel que soit le nombre de rangées") : l'échelle n'est plus calée sur la largeur totale
        // du dessin (qui grandissait avec nbShed/nbShedGroups, écrasant tout le reste) — seule la
        // hauteur du dessin (totalDrawingHeight, INDÉPENDANTE du nombre de rangées) pilote désormais
        // l'échelle. Comportement inchangé pour tout cas où la hauteur était déjà le facteur limitant
        // (cas courant à faible nombre de rangées) ; pour un grand champ, le dessin déborde maintenant
        // du viewport à échelle réelle constante — navigation via le pan/zoom déjà existant
        // (viewManager), pas via une compression automatique. widthForScale (ex-facteur de compression)
        // n'a plus d'utilité, retiré.
        const scale = height / totalDrawingHeight;
        if (window.__dxfCapture) window.__dxfCapture.scale = scale; // Export DXF (cf. dxf_export.js) : seul point d'accès à "scale" (px/mètre) sans dupliquer sa formule.

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
        // Ligne médiane de la traverse (son épaisseur, à mi-hauteur) : cible d'intersection des
        // bracons (cf. drawReinforcement) pour qu'ils s'arrêtent précisément au milieu de la
        // traverse, sans jamais pouvoir la dépasser (contrairement à un ciblage sur le dessous,
        // où les bords du bracon pouvaient déborder au-delà du dessus de la traverse).
        const beamMidLine = getBeamLine(0);

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

                const shouldDrawSinglePostBrace = postHeight > heightUnderBrace;

                if (shouldDrawSinglePostBrace) {
                    if (appState.showBraceLeft || appState.postModel === 'y_shape') drawReinforcement('left', postCenterX, values);
                    if (appState.showBraceRight || appState.postModel === 'y_shape') drawReinforcement('right', postCenterX, values);
                }
            } else if (appState.postModel === 'double' && appState.showDoubleBracing) {
                // Dispatch V1/V2 <-> V3/V4 : fonctions déplacées dans
                // petit_champ_solaire_poteau_Double poteaux_V1_V2.js / _V3_V4 .js (préambule de
                // calcul dupliqué entre les 2 fichiers, cf. plan — drawDoublePostReinforcement lui,
                // le primitif de dessin partagé, reste dans petit_champ_solaire_poteau_utilities.js).
                const doubleBraceGeo = {
                    postSpacing: values.postSpacing, heightUnderBrace,
                    // Sol local du shed courant (cf. solLocalY) : les fichiers V1/V2 et V3/V4 lisent
                    // `coupeAlignRoofOn ? getCoupeGroundY(x) : 0` — on leur passe la fonction juste.
                    coupeAlignRoofOn: true, getCoupeGroundY: solLocalY,
                    beamIntersectLine, beamBottomLine,
                    beamCenterY, beamHeightScaled, beamOffsetScaled, beamLengthScaled, cosA, sinA,
                    lineLength
                };
                if (appState.doublePostBracing === 'v1' || appState.doublePostBracing === 'v2') {
                    drawDoublePostReinforcementSetV1V2(ctx, scale, postWidthScaled, values, doubleBraceGeo);
                } else {
                    drawDoublePostReinforcementSetV3V4(ctx, scale, postWidthScaled, values, doubleBraceGeo);
                }
            }
        }

        // Fondations : 3 systèmes d'ancrage (#anchor-system-group) — Béton (plots/longrine), Vis de
        // fondation ou Micropieux. Remplace l'ancien massif fixe (0.50m x 0.60m, toujours "sur le
        // sol") par une géométrie paramétrable (dimensions, position sol/enterré, configuration 1P/DP).

        // FIX: les champs de dimensions fondations doivent accepter 0 comme valeur valide — un simple
        // "valeur || défaut" traite 0 comme falsy et le remplace silencieusement par le défaut,
        // empêchant par ex. de saisir un débord de 0. On ne retombe sur le défaut que si la valeur
        // n'est pas un nombre exploitable (undefined, NaN, chaîne vide).
        const numOr = (val, fallback) => {
            const n = typeof val === 'number' ? val : parseFloat(val);
            return Number.isFinite(n) ? n : fallback;
        };

        // Fondations (Béton/Vis/Micropieux) : déplacées dans
        // static/js/petit_champ_solaire/petit_champ_solaire_poteau_utilities.js (aucune dépendance au
        // modèle de poteaux). Fonctions globales : drawFoundationBeton, drawFoundationVis,
        // drawFoundationMicropieu, drawAnchorReinforcementLegs, computeDPFoundationLength, drawAnchor,
        // isAnchorInFrontOfPost, drawAnchorBehindPost, drawAnchorInFrontOfPost — toutes reçoivent
        // désormais (ctx, scale, values, ...) explicitement au lieu de la closure de drawCoupe.

        const drawThePosts = () => {
            ctx.fillStyle = '#f3f4f6';
            ctx.strokeStyle = '#374151';

            let isPostInFront = (appState.traversePosition === 'side' && appState.postModel !== 'y_shape') ||
                (appState.traversePosition === 'top' && appState.postModel === 'inclinedPost');
            // Traits allégés (demande explicite) : poteaux moins épais, en conservant la même hiérarchie
            // visuelle relative "au premier plan" (isPostInFront) vs "en arrière-plan".
            ctx.lineWidth = isPostInFront ? 1.4 : 0.9;

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

                // FIX (Alignement toiture coché) : le pied du poteau doit toucher le sol LOCAL à sa
                // propre position X (et non rester au niveau 0 du repère du shed) — sinon, dès que le
                // poteau est décalé du centre du shed (excentré, y_shape avec excentricité), il
                // s'enfonce dans le sol ou flotte au-dessus selon le sens de la pente.
                const localGroundOffset = solLocalY(postCenterX);
                let postBottomY = localGroundOffset;
                if (appState.showFoundation && appState.anchorSystem === 'beton') {
                    if (appState.foundationPosition === 'enterre') {
                        postBottomY += numOr(values.foundationBuryLevel, 0.3) * scale;
                    } else if (appState.foundationPosition === 'surface') {
                        // CORRIGÉ : le plot béton "Sur le sol" est dessiné au-dessus du terrain (son dessus
                        // à Y=-profondeur, cf. drawFoundationBeton) — le poteau doit reposer SUR ce plot au
                        // lieu de continuer jusqu'au niveau du sol (Y=0), sinon il traverse visuellement le
                        // plot au lieu de s'appuyer dessus.
                        postBottomY -= numOr(values.foundationDepth, 0.5) * scale;
                    }
                }

                // Fondation dessinée AVANT le poteau par défaut (le poteau vient se superposer
                // proprement par-dessus son ancrage), SAUF le plot béton "Sur le sol" qui doit au
                // contraire apparaître devant le poteau (dessiné après, cf. isAnchorInFrontOfPost).
                // L'ancrage est dessiné dans un repère translaté au niveau du sol local (ses propres
                // références internes supposent un sol à Y=0).
                ctx.save(); ctx.translate(0, localGroundOffset);
                drawAnchorBehindPost(ctx, scale, values, postCenterX);
                ctx.restore();
                ctx.fillRect(postCenterX - postWidthScaled / 2, postTopY, postWidthScaled, postBottomY - postTopY);
                ctx.strokeRect(postCenterX - postWidthScaled / 2, postTopY, postWidthScaled, postBottomY - postTopY);
                ctx.save(); ctx.translate(0, localGroundOffset);
                drawAnchorInFrontOfPost(ctx, scale, values, postCenterX);
                ctx.restore();

            } else {
                const isInclined = appState.postModel === 'inclinedPost';
                const spacing = (isInclined ? postSpacingInclined : postSpacing) * scale / 2;

                // DP-Ancrage (Béton) : longrine partagée dessinée AVANT la boucle des poteaux par
                let buryLevelScaled = 0;
                if (appState.showFoundation && appState.anchorSystem === 'beton') {
                    if (appState.foundationPosition === 'enterre') {
                        buryLevelScaled = numOr(values.foundationBuryLevel, 0.3) * scale;
                    } else if (appState.foundationPosition === 'surface') {
                        // CORRIGÉ : même correction que la branche single/offset/y_shape ci-dessus — le
                        // poteau doit reposer sur le dessus du plot/longrine béton "Sur le sol" (Y=-profondeur)
                        // au lieu de descendre jusqu'au niveau du sol (Y=0).
                        buryLevelScaled = -numOr(values.foundationDepth, 0.5) * scale;
                    }
                }

                // défaut, pour que les poteaux viennent se superposer proprement par-dessus — SAUF en
                // position "Sur le sol" où elle doit apparaître devant (dessinée après, plus bas).
                const isSharedDPGlobal = !isInclined && appState.foundationConfig === 'dp' && appState.anchorSystem === 'beton';
                if (isSharedDPGlobal) drawAnchorBehindPost(ctx, scale, values, 0, computeDPFoundationLength(values));

                [-1, 1].forEach(sign => {
                    const postX = sign * spacing;
                    // FIX (Alignement toiture coché) : chaque poteau (gauche/droit) touche son propre
                    // sol local — le terrain continue de suivre sa pente à l'intérieur même d'un shed,
                    // donc les 2 poteaux d'un modèle Double Poteaux n'ont pas le même niveau de sol dès
                    // que la pente n'est pas nulle. La ligne reliant leurs 2 pieds est ainsi parallèle
                    // au terrain (même fonction linéaire getCoupeGroundY que le sol lui-même).
                    const localGroundOffsetPost = solLocalY(postX);
                    const postBottomY = localGroundOffsetPost + buryLevelScaled;
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

                        const groundLine = { p1: { x: -lineLength, y: postBottomY }, p2: { x: lineLength, y: postBottomY } };
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

                        // Fondation dessinée AVANT le poteau par défaut, voir branche single/offset/y_shape.
                        if (bottomLeft && bottomRight) drawAnchorBehindPost(ctx, scale, values, (bottomLeft.x + bottomRight.x) / 2);

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
                        if (bottomLeft && bottomRight) drawAnchorInFrontOfPost(ctx, scale, values, (bottomLeft.x + bottomRight.x) / 2);

                    } else { // Vertical Double Post
                        const postLine = { p1: { x: postX, y: 0 }, p2: { x: postX, y: -lineLength } };
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

                        // DP-Ancrage (Béton) : une seule longrine partagée entre les 2 poteaux, dessinée
                        // une seule fois (au centre, X=0, AVANT la boucle — cf. plus haut) plutôt qu'un
                        // plot individuel par poteau — donc ignorée ici. 1P-Ancrage et les systèmes
                        // Vis/Micropieux restent inchangés : chaque poteau garde son propre ancrage
                        // individuel, dessiné AVANT le poteau (item 6) pour que celui-ci vienne se
                        // superposer proprement par-dessus.
                        const isSharedDP = !isInclined && appState.foundationConfig === 'dp' && appState.anchorSystem === 'beton';
                        if (!isSharedDP) { ctx.save(); ctx.translate(0, localGroundOffsetPost); drawAnchorBehindPost(ctx, scale, values, postX); ctx.restore(); }
                        ctx.fillRect(postX - postWidthScaled / 2, postTopY, postWidthScaled, postBottomY - postTopY);
                        ctx.strokeRect(postX - postWidthScaled / 2, postTopY, postWidthScaled, postBottomY - postTopY);
                        if (!isSharedDP) { ctx.save(); ctx.translate(0, localGroundOffsetPost); drawAnchorInFrontOfPost(ctx, scale, values, postX); ctx.restore(); }
                    }
                });

                // DP-Ancrage (Béton) "Sur le sol" : la longrine partagée doit apparaître devant les
                // poteaux (cf. isAnchorInFrontOfPost) — rejouée ici après la boucle qui vient de les
                // dessiner, avec le même override de longueur qu'avant la boucle.
                if (isSharedDPGlobal) drawAnchorInFrontOfPost(ctx, scale, values, 0, computeDPFoundationLength(values));

                if (isInclined && values.showInclinedGroundBar) {
                    const innerSpacing = postSpacingInclined * scale - postWidthScaled;
                    const startX = -spacing + postWidthScaled / 2;
                    ctx.fillRect(startX, -postWidthScaled / 2, innerSpacing, postWidthScaled);
                    ctx.strokeRect(startX, -postWidthScaled / 2, innerSpacing, postWidthScaled);
                }
            }
        };

        // drawDoublePostBracingBar : déplacée dans
        // petit_champ_solaire_poteau_Double poteaux_V1_V2.js (utilisée uniquement par la branche V1).
        // drawDoublePostReinforcementSet : éclatée en drawDoublePostReinforcementSetV1V2 /
        // drawDoublePostReinforcementSetV3V4 (fichiers Double poteaux dédiés) — cf. dispatcher dans
        // drawTheReinforcements() ci-dessus.
        // drawDoublePostReinforcement : déplacée dans petit_champ_solaire_poteau_utilities.js
        // (primitif de dessin du bracon, partagé par V1/V3/V4, sans dépendance au modèle de poteaux).
        // Signature désormais (ctx, scale, start, end, postWidthScaled, values, isV2Inner) — les appels
        // ci-dessous (dans drawDoublePostReinforcementSet) passent ctx/scale explicitement.

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
            // FIX (Alignement toiture coché) : "hauteur sous renfort" se mesure depuis le sol LOCAL
            // du poteau (cf. drawThePosts), pas depuis Y=0 du repère du shed.
            const braceGroundOffset = solLocalY(postCenterX);
            const braceAttachOnPostY = -heightUnderBrace * scale + braceGroundOffset;

            // Cible la ligne MÉDIANE de la traverse (et non son dessous) : le bracon doit intersecter
            // la traverse précisément en son milieu, sans jamais la dépasser (correctif demandé).
            let currentBeamBottomLine = beamMidLine;
            let currentBeamOffset = beamOffsetScaled;
            let currentAngle = angle;
            let currentBeamLength = beamLengthScaled;

            if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                currentBeamLength = beamLengthScaled;
                // FIX: Bracon 70% (overshoot) — root cause trouvée par instrumentation directe du
                // canvas (sondage des coordonnées globales réellement dessinées) : ce signe NE DOIT
                // PAS dépendre de localInvertSlope. drawRoofStructure dessine 2 bras via 2 appels
                // d'angles opposés (+roofSlopeRadians*(invert?-1:1) et son opposé) ; lequel des deux
                // devient visuellement "gauche" ou "droite" dépend déjà de invertSlope à CE niveau-là
                // (il permute les 2 bras). Mais la rotation RÉELLEMENT appliquée par le bras qui finit
                // à gauche vaut TOUJOURS -roofSlopeRadians, et celle du bras à droite TOUJOURS
                // +roofSlopeRadians, quel que soit invertSlope (vérifié : Bras1/Bras2 échangent leurs
                // rôles gauche/droite avec invertSlope, mais la rotation du bras "de gauche" reste
                // constante). Multiplier par -1 ici (comme avant) inversait donc le bracon sur le
                // MAUVAIS bras dès que invertSlope=true (le cas par défaut pour ce modèle), l'envoyant
                // loin au-dessus de la vraie traverse.
                currentAngle = (side === 'left' ? -1 : 1) * Math.abs(roofSlopeRadians);
                // Face AVANT de la traverse (dessous), pas sa ligne médiane : le bracon doit intersecter
                // cette face précisément (cf. correctif "limiter la longueur des bracons à l'intersection
                // des traverses sur les faces avant").
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
            const isYShapeModel = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape');
            if (appState.postModel === 'single' || appState.postModel === 'offset' || appState.postModel === 'linked') {
                braceAttachDist = (currentBeamLength / 2) * (braceFixPercentage / 100);
            } else { // Y-Shape
                braceAttachDist = currentBeamLength * (braceFixPercentage / 100);
            }

            let finalBeamOffset = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') ? 0 : currentBeamOffset;

            let braceEndOnBeamBottom;
            if (isYShapeModel) {
                // FIX: Bracon 70% — le point d'attache est recalculé directement à partir des 2
                // extrémités RÉELLES de la traverse (tête = fixée au poteau, égout = bord de toiture),
                // par interpolation linéaire à braceFixPercentage% (70% par défaut) de la tête vers
                // l'égout. Approche robuste par construction : la tête et l'égout sont exprimés dans le
                // même repère (rotation currentAngle, pivot beamCenterY) que celui réellement utilisé
                // par drawRoofStructure pour dessiner la traverse, donc le point interpolé tombe
                // toujours exactement sur celle-ci, quel que soit le pourcentage choisi.
                const localY = beamHeightScaled / 2; // face avant (dessous) de la traverse
                const toScreen = (localX) => ({
                    x: finalBeamOffset + localX * currentCosA - localY * currentSinA,
                    y: beamCenterY + localX * currentSinA + localY * currentCosA
                });
                const headPoint = toScreen(0); // tête de la traverse, au poteau
                const egoutPoint = toScreen(sign * currentBeamLength); // égout, bord de toiture
                const t = braceFixPercentage / 100; // 70% par défaut, tête -> égout
                braceEndOnBeamBottom = {
                    x: headPoint.x + t * (egoutPoint.x - headPoint.x),
                    y: headPoint.y + t * (egoutPoint.y - headPoint.y)
                };
            } else {
                const braceEndRotated = { x: sign * braceAttachDist, y: 0 };
                braceEndOnBeamBottom = {
                    x: finalBeamOffset + braceEndRotated.x * currentCosA - braceEndRotated.y * currentSinA,
                    y: beamCenterY + braceEndRotated.x * currentSinA + braceEndRotated.y * currentCosA
                };
            }

            if (appState.reinforcementType === 'bracons') {
                // Correctif demandé : barre RECTANGULAIRE (angles en extrémités à 90°), au lieu de
                // l'ancien quadrilatère dont les bouts étaient coupés le long du poteau/de la traverse
                // (angles obliques). Rectangle simple entre braceLineP1 (poteau) et braceEndOnBeamBottom
                // (traverse), de largeur braceWidthScaled, bouts perpendiculaires à l'axe du bracon.
                const braceWidthScaled = values.braceWidth * scale;
                const braceAngle = Math.atan2(braceEndOnBeamBottom.y - braceLineP1.y, braceEndOnBeamBottom.x - braceLineP1.x);
                const perpAngle = braceAngle + Math.PI / 2;
                const halfW = braceWidthScaled / 2;
                const cosP = Math.cos(perpAngle), sinP = Math.sin(perpAngle);

                const p1 = { x: braceLineP1.x + halfW * cosP, y: braceLineP1.y + halfW * sinP };
                const p2 = { x: braceEndOnBeamBottom.x + halfW * cosP, y: braceEndOnBeamBottom.y + halfW * sinP };
                const p3 = { x: braceEndOnBeamBottom.x - halfW * cosP, y: braceEndOnBeamBottom.y - halfW * sinP };
                const p4 = { x: braceLineP1.x - halfW * cosP, y: braceLineP1.y - halfW * sinP };

                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.lineTo(p4.x, p4.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

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

            const isYShapeArm = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') && half;
            // Toiture Y en forme de V inversé (faîtage au poteau, égouts plus bas que le poteau) :
            // on inverse uniquement la rotation appliquée au dessin (le bras descend vers l'extérieur
            // au lieu de monter), sans toucher au signe de localAngle utilisé plus bas pour choisir de
            // quel côté du poteau (gauche/droite) le bras s'étend — sinon les 2 bras se retrouveraient
            // du même côté.
            ctx.rotate(isYShapeArm ? -localAngle : localAngle);

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

            // Trait allégé (demande explicite) : couvre à la fois la traverse ET les pannes
            // (drawPurlinAt plus bas hérite de ce même ctx.lineWidth, aucun réglage propre).
            ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.9;

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

            // Correctif : values.overhangSymValue est désormais un pourcentage (%), pas des mètres —
            // utiliser values.overhangH (déjà converti en mètres par calculateOmbriereMetalLocal,
            // overhangH === overhangL === overhangSymValue-en-mètres pour la toiture Y).
            const overhangScaled = (values.overhangH || 0) * scale;

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

            // Bords de chaque panneau, calculés AVANT le dessin des pannes (pour pouvoir positionner
            // celles-ci exactement aux bords des panneaux, cf. ci-dessous) — même logique de calcul
            // que l'ancienne boucle de dessin des panneaux, extraite ici pour être partagée.
            const nbPanelsRampantCount = Math.max(1, Math.round(values.nbPanelsRampant) || 1);
            const panelUnitScaled = (values.panelUnitLengthM || 0) * scale;
            const panelGapScaled = ((values.panelSpacingY || 0) / 1000) * scale;
            const panelDir = panelDrawWidth >= 0 ? 1 : -1;

            const panelEdges = [];
            if (nbPanelsRampantCount > 1 && panelUnitScaled > 0) {
                let panelCursorX = panelStartX;
                // Correction pour aligner le premier panneau sur le début de la zone de dessin des panneaux
                // (panelStartX), qui inclut déjà le porte-à-faux.
                // L'ancienne logique commençait à panelStartX, ce qui était correct.
                // La nouvelle logique doit s'assurer que les panneaux sont bien positionnés
                // à l'intérieur de la zone `panelDrawWidth`.
                // `panelStartX` est le point de départ de la toiture (avec porte-à-faux).
                // `panelDrawWidth` est la longueur totale de la toiture.

                for (let p = 0; p < nbPanelsRampantCount; p++) {
                    const edgeStart = panelCursorX;
                    const edgeEnd = panelCursorX + panelDir * panelUnitScaled;
                    panelEdges.push({ start: edgeStart, end: edgeEnd });
                    panelCursorX += panelDir * (panelUnitScaled + panelGapScaled);
                }
            } else {
                panelEdges.push({ start: panelStartX, end: panelStartX + panelDrawWidth });
            }

            // Pannes : correctif géométrique demandé — chaque panneau reçoit exactement 2 pannes,
            // positionnées à [porte-à-faux%] et [100-porte-à-faux%] de SA PROPRE dimension (et non à
            // ses bords 0%/100% comme précédemment). Exemple de validation (2 panneaux 2000x1300mm,
            // espacement 20mm, porte-à-faux 20%) : pannes à 0 / 1.20 / 2.02 / 3.22 m le long de la
            // traverse. Les pannes du 1er et du dernier panneau tombent alors exactement sur les
            // extrémités de la traverse, par construction (overhangH/overhangL utilisent la même
            // proportion, cf. calculateOmbriereMetalLocal).
            ctx.fillStyle = '#e5e7eb';
            const purlinSize = (values.purlinWidth || 0.08) * scale;
            const overhangFrac = Math.min(0.5, Math.max(0, (values.overhangSymValue || 0) / 100));
            // Pannes périphériques (aux 2 extrémités de la traverse, qui coïncident par construction
            // avec purlinA du 1er panneau et purlinB du dernier) : posées ENTIÈREMENT sur la traverse
            // (bord extérieur affleurant son extrémité), au lieu d'être centrées sur le point comme les
            // pannes intermédiaires — ce qui laissait la moitié de la panne dépasser dans le vide.
            const drawPurlinAt = (xPos, flushInsideDir) => {
                const rectX = flushInsideDir ? Math.min(xPos, xPos + flushInsideDir * purlinSize) : xPos - purlinSize / 2;
                ctx.fillRect(rectX, -beamHeightScaled / 2 - purlinHeightScaled, purlinSize, purlinHeightScaled);
                ctx.strokeRect(rectX, -beamHeightScaled / 2 - purlinHeightScaled, purlinSize, purlinHeightScaled);
            };
            panelEdges.forEach(({ start, end }, idx) => {
                const purlinA = start + overhangFrac * (end - start);
                const purlinB = start + (1 - overhangFrac) * (end - start);
                drawPurlinAt(purlinA, idx === 0 ? panelDir : null);
                drawPurlinAt(purlinB, idx === panelEdges.length - 1 ? -panelDir : null);
            });

            // Dessin de l'intégration (petit champ solaire : pas de rail, integrationSystemHeightScaled = 0)
            // — on saute complètement le dessin, un strokeRect de hauteur 0 tracerait quand même un trait
            // horizontal visible (le contour d'un rectangle plat n'est jamais vide).
            if (integrationSystemHeightScaled > 0) {
                ctx.fillStyle = '#d1d5db';
                ctx.fillRect(panelStartX, integrationSystemY, panelDrawWidth, integrationSystemHeightScaled);
                ctx.strokeRect(panelStartX, integrationSystemY, panelDrawWidth, integrationSystemHeightScaled);
            }

            // Représentation individuelle des panneaux du rampant (petit champ solaire) : au lieu d'un
            // seul bloc plein, on dessine nbPanelsRampant panneaux distincts, dimensionnés selon le mode
            // de pose (portrait = longueur, paysage = largeur) et séparés par panelSpacingY — réutilise
            // panelEdges calculé ci-dessus (partagé avec le positionnement des pannes).
            // Trait fin et bleu clair (plutôt que le strokeStyle/lineWidth épais hérité du dessin de la
            // traverse/pannes juste au-dessus) pour que les panneaux, très fins, restent bien visibles.
            ctx.strokeStyle = '#93C5FD'; ctx.lineWidth = 0.5;
            ctx.fillStyle = 'rgba(30, 41, 59, 1)';
            panelEdges.forEach(({ start, end }) => {
                ctx.fillRect(start, panelY, end - start, panelThicknessScaled);
                ctx.strokeRect(start, panelY, end - start, panelThicknessScaled);
            });

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

        // FIX (item 1, plans de coupe) : référence commune pour les cotations horizontales "limite
        // de parcelle", "largeur toiture projetée au sol" et "espacement entre shed" — toutes
        // positionnées à 4m au-dessus du point le plus haut des panneaux (au lieu de rester au
        // niveau du sol). Même formule que panelCorners/parcelPanelCorners plus bas, calculée une
        // seule fois ici pour rester cohérente entre les sections qui l'utilisent (drawStandardDimensions
        // ci-dessous, cotation "limite de parcelle" et nouvelle cotation "espacement entre shed").
        const overhangLScaledTop = (values.overhangL || 0) * scale;
        const overhangHScaledTop = (values.overhangH || 0) * scale;
        const eaveOnRightTop = Math.sin(angle) >= 0;
        const overhangLeftScaledTop = eaveOnRightTop ? overhangHScaledTop : overhangLScaledTop;
        const overhangRightScaledTop = eaveOnRightTop ? overhangLScaledTop : overhangHScaledTop;
        const panelCornersTop = [{ x: -beamLengthScaled / 2 - overhangLeftScaledTop, y: panelY }, { x: beamLengthScaled / 2 + overhangRightScaledTop, y: panelY }]
            .map(p => ({ x: p.x * cosA - p.y * sinA + beamOffsetScaled, y: beamCenterY + p.x * sinA + p.y * cosA }));
        const topDimY = Math.min(...panelCornersTop.map(p => p.y)) - 2 * scale;

        // Ensemble complet des cotations du modèle "Poteaux centrés" (et modèles apparentés).
        // Extrait en fonction réutilisable pour pouvoir être rejoué tel quel sur un module du modèle "linked".
        // FIX (item 1) : groundOffsetY (défaut 0) permet d'annuler, pour la cotation "largeur toiture
        // projetée au sol", le décalage vertical appliqué par ctx.translate(..., getCoupeGroundY(...))
        // au shed courant (le champ solaire suit la pente, cf. item 2 d'une demande précédente) — sans
        // cette compensation, cette cotation dérivait verticalement d'un shed à l'autre par rapport aux
        // cotations "limite de parcelle"/"espacement entre shed" (dessinées hors boucle, à hauteur fixe).
        // solY : Y du sol réel dans le repère translaté courant (défaut : solLocalY, sol du shed
        // courant) — toutes les cotations verticales ci-dessous descendent jusqu'à lui.
        const drawStandardDimensions = (groundOffsetY = 0, realGroundOffsetY = 0, solY = null) => {
            const solCote = solY || solLocalY;
            const coteSol = { echelle: scale };
            const coteAuPied = { echelle: scale, mesure: 'cible' };
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
                // Signes inversés par rapport à l'ancienne convention "toiture en creux" (cf. même
                // correctif dans drawRoofStructure/drawReinforcement) pour que ces points de cotation
                // suivent la position réelle des égouts de la toiture en V inversé.
                const angle_L = -roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const angle_R = roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const cos_L = Math.cos(angle_L); const sin_L = Math.sin(angle_L);
                const cos_R = Math.cos(angle_R); const sin_R = Math.sin(angle_R);

                const panelWidthForY = panelWidthScaled / 2;

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

                // Jarret / bracon : hauteur comptée depuis le sol AU POTEAU (cf. drawReinforcement,
                // braceGroundOffset), pas depuis le niveau 0 du shed.
                const braceLowestY = solCote(0) - values.heightUnderBrace * scale;

                const dimLineX_L = panelTop_L_rel.x - 0.1 * scale;
                const dimLineX_R = panelTop_R_rel.x + 0.1 * scale;

                // Correctif ciblé : cotation verticale "hauteur haute" (structureHighestHeight, ex:
                // "2.23m" par défaut) supprimée — plus affichée pour ce modèle.

                const leaderStartX_L = -postWidthScaled / 2;
                drawVerticalDimensionWithLeader(ctx, leaderStartX_L, braceLowestY, dimLineX_L + 5 * scale, null, solCote, 12, coteAuPied);
                const leaderStartX_R = postWidthScaled / 2;
                drawVerticalDimensionWithLeader(ctx, leaderStartX_R, braceLowestY, dimLineX_R - 5 * scale, null, solCote, 12, coteAuPied);

            } else {
                // Cotations verticales pour les autres modèles
                // Bouton dédié (#toolToggleHeightDims) : masque spécifiquement "Hauteur libre de
                // passage" (ci-dessous) et "Hauteur sous renfort/bracon" (plus bas dans ce fichier).
                // CORRIGÉ (export PDF/DXF) : ces 2 cotations ne doivent JAMAIS apparaître dans les plans
                // exportés (coupe), même si l'utilisateur les a affichées à l'écran via ce bouton — donc
                // forcées masquées pendant la capture d'export (window.__dxfCapture, posé par
                // plan_coupe_petit_champ_solaire.js), indépendamment de l'état du bouton à l'écran.
                if (appState.showHeightHelperDims && !window.__dxfCapture) {
                    drawVerticalDimensionWithLeader(ctx, beamCorners[0].x, structureLowestY, beamCorners[0].x, null, solCote, 12, coteAuPied);
                }
            // Cotations "Hauteur bas/haut PV" : offset CONSTANT de 0.1m (10cm) depuis l'extrémité
                // du panneau, quelle que soit la largeur du champ PV (valeur fixe demandée, au lieu de
                // l'ancien 1.0m).
            // Valeur mesurée jusqu'au sol réel sous la ligne de cote (terrain, toiture à niveau ou non).
            drawVerticalDimensionWithLeader(ctx, panelLowest.x, panelLowest.y, panelLowest.x - 0.1 * scale, null, solCote, 12, coteSol);

                // Cotation "hauteur poteau" masquée (demande utilisateur) — plus dessinée.

                // Toiture à niveau ou terrain réel : la cote descend jusqu'au sol sous elle et affiche
                // la hauteur mesurée (plus de correction « à la main » du dénivelé).
                drawVerticalDimensionWithLeader(ctx, panelHighest.x, panelHighest.y, panelHighest.x + 0.1 * scale, null, solCote, 12, coteSol);
            }

            // --- FIN BLOC COTATIONS VERTICALES ---


            // Cotation "Hauteur sous renfort" (= Hauteur sous bracon, pour modèles non-Y et
            // non-inclined) — masquée par le bouton dédié #toolToggleHeightDims (avec "Hauteur
            // libre de passage" ci-dessus). CORRIGÉ (export PDF/DXF) : forcée masquée pendant la
            // capture d'export (cf. commentaire équivalent ci-dessus pour "Hauteur libre de passage").
            // Attache mesurée depuis le sol au poteau (cf. drawReinforcement) ; la cote part du même sol.
            const braceAttachAu = (xPoteau) => solCote(xPoteau) - heightUnderBrace * scale;

            if (appState.showHeightHelperDims && !window.__dxfCapture && appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape' && appState.postModel !== 'inclinedPost' && (appState.reinforcementType === 'bracons' || (appState.postModel === 'double' && appState.showDoubleBracing))) {
                let dimLineX = -1.0 * scale;
                let leaderStartX = 0;

                if (appState.postModel === 'single' || appState.postModel === 'linked') {
                    leaderStartX = postWidthScaled / 2;
                    dimLineX = -postWidthScaled / 2 - 1.0 * scale;
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCote, 12, coteAuPied);

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
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCote, 12, coteAuPied);

                } else if (appState.postModel === 'double') {
                    const spacing = postSpacing * scale / 2;
                    leaderStartX = -spacing - postWidthScaled / 2; // Bord extérieur du poteau gauche
                    dimLineX = leaderStartX - 1.0 * scale;
                    drawVerticalDimensionWithLeader(ctx, leaderStartX, braceAttachAu(leaderStartX), dimLineX, null, solCote, 12, coteAuPied);
                }

            }

            // --- DEBUT BLOC COTATIONS HORIZONTALES ---

            if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
                // Signes inversés par rapport à l'ancienne convention "toiture en creux" (cf. même
                // correctif dans drawRoofStructure/drawReinforcement) pour que ces points de cotation
                // suivent la position réelle des égouts de la toiture en V inversé.
                const angle_L = -roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const angle_R = roofSlopeRadians * (localInvertSlope ? -1 : 1);
                const cos_L = Math.cos(angle_L); const sin_L = Math.sin(angle_L);
                const cos_R = Math.cos(angle_R); const sin_R = Math.sin(angle_R);

                const panelWidthForY = panelWidthScaled / 2;

                const p_left_end = {
                    x: (-postWidthScaled / 2) + (-panelWidthForY) * cos_L - panelY * sin_L,
                    y: beamCenterY + (-panelWidthForY) * sin_L + panelY * cos_L
                };

                const p_right_end = {
                    x: (+postWidthScaled / 2) + (panelWidthForY) * cos_R - panelY * sin_R,
                    y: beamCenterY + (panelWidthForY) * sin_R + panelY * cos_R
                };

                const totalProjWidth = values.totalProjectionWidth;

                // FIX (item 1) : cotation "largeur toiture projetée au sol" positionnée à 4m
                // au-dessus du point le plus haut des panneaux (topDimY), au lieu du niveau du sol.
                // "- groundOffsetY" compense la translation du shed courant (pente du terrain) pour
                // rester à une hauteur GLOBALE constante, alignée avec les 2 autres cotations.
                const projDimYArm = topDimY - groundOffsetY;
                drawDimensionLine(ctx, p_left_end.x, projDimYArm, p_right_end.x, projDimYArm, `${totalProjWidth.toFixed(2)}m`, 0, false);

            } else {
                // Cotations horizontales pour les autres modèles
                const projectionHorizontale = values.totalProjectionWidth;
                const projMinX = Math.min(...panelCorners.map(p => p.x));
                const projMaxX = Math.max(...panelCorners.map(p => p.x));

                // FIX (item 1) : cotation "largeur toiture projetée au sol" positionnée à 4m
                // au-dessus du point le plus haut des panneaux (topDimY), au lieu du niveau du sol.
                // "- groundOffsetY" compense la translation du shed courant (pente du terrain) pour
                // rester à une hauteur GLOBALE constante, alignée avec les 2 autres cotations.
                const projDimY = topDimY - groundOffsetY;

                if (appState.postModel === 'offset' && (appState.offsetPostSide !== 'center' || postEccentricity !== 0)) {
                    let basePostX = 0;
                    if (appState.offsetPostSide !== 'center') {
                        const halfPanelHorizontal = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                        if (appState.offsetPostSide === 'low') basePostX = localInvertSlope ? halfPanelHorizontal : -halfPanelHorizontal;
                        if (appState.offsetPostSide === 'high') basePostX = localInvertSlope ? -halfPanelHorizontal : halfPanelHorizontal;
                    }
                    const postCenterX = basePostX + (values.postEccentricity * scale);
                    const totalProj = (projMaxX - projMinX) / scale;

                    // Une seule ligne de cotation horizontale (largeur projetée totale) — les deux
                    // demi-cotations (de chaque bord au centre du poteau) sont volontairement masquées.
                    drawDimensionLine(ctx, projMinX, projDimY, projMaxX, projDimY, `${totalProj.toFixed(2)}m`, 0, false);

                    const structuralCenterX = (projMinX + projMaxX) / 2;
                    if (Math.abs(postCenterX - structuralCenterX) > 0.01 * scale) {
                        const dimY_L3 = projDimY + 0.3 * scale;
                        drawDimensionLine(ctx, structuralCenterX, dimY_L3, postCenterX, dimY_L3, `${Math.abs(values.postEccentricity).toFixed(2)}m`, 0, false);
                    }

                } else if (appState.postModel === 'single' || appState.postModel === 'linked') {
                    // Une seule ligne de cotation horizontale (largeur projetée totale) — les deux
                    // demi-cotations (de chaque bord au centre du poteau) sont volontairement masquées.
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
        // nbShedCount / shedPitchMeters : calculés plus haut (avant l'échelle) pour que la vue "Tout voir"
        // englobe toutes les rangées de shed.
        const shedSpacingScaled = shedPitchMeters * scale;

        // FIX: le sol doit être dessiné AVANT les poteaux/fondations, pas après — sinon son
        // remplissage opaque (#f0f0f0) recouvre entièrement tout ce qui est dessiné sous la ligne
        // Y=0 (vis de fondation, micropieux, plots béton "Enterré"), les rendant invisibles.
        const groundRectDepth = 1.40 * scale; // Profondeur hachure de 1.40m
        // Pente du terrain : reproduit la pente du Plan de façade (taux = Dénivelé du terrain /
        // Longueur totale) le long de l'axe du Plan de coupe. Chaque ombrière (shed) suit ce niveau de
        // sol local — translatée en bloc à getCoupeGroundY(sa position X), cf. boucles de dessin
        // plus bas — SANS jamais rallonger poteau/vis/fondation (leur géométrie interne ne change pas).
        const groundSlopeRatioCoupe = (values.facadeLength > 0) ? (-numOr(values.groundSlopeFacade, 0) / values.facadeLength) : 0;
        // Terrain automatique : profil réel (Y du canevas vers le bas, d'où le signe -).
        const getCoupeGroundY = solCoupeAuto
            ? (xScaled) => -solCoupeAuto.zRel(xScaled / scale) * scale
            : (xScaled) => xScaled * groundSlopeRatioCoupe;
        // FIX (item 3, bouton "Alignement toiture" plans de coupe) : coché (défaut) = comportement
        // historique ci-dessus, chaque shed suit le sol local (hauteurs identiques pour tous les
        // sheds, cf. boucles de dessin plus bas). Décoché = la structure reste à niveau (translation Y
        // annulée), seul le terrain (toujours dessiné avec getCoupeGroundY réel) continue de suivre la
        // pente — d'où l'ajustement de la cotation "Hauteur haut PV" dans drawStandardDimensions (item 5).
        const coupeAlignRoofOn = values.coupeAlignRoof !== false;
        // Toiture à niveau : calée sur le shed dont le sol est le PLUS HAUT (Y le plus petit), pour
        // qu'aucun shed n'ait moins que la hauteur prévue. Identique à l'historique (niveau du shed 0)
        // tant que le terrain ne monte pas au-delà du shed 0.
        let niveauHorizontalY = 0;
        for (let k = 1; k < nbShedCount; k++) niveauHorizontalY = Math.min(niveauHorizontalY, getCoupeGroundY(k * shedSpacingScaled));
        const getCoupeStructureY = (xScaled) => coupeAlignRoofOn ? getCoupeGroundY(xScaled) : niveauHorizontalY;
        // Sol LOCAL d'un poteau, dans le repère translaté du shed courant (cf. boucles de dessin) :
        // niveau du sol à sa position ABSOLUE moins la translation du shed. Sur l'ancienne droite
        // passant par 0, cela redonnait getCoupeGroundY(xLocal) ; sur un profil réel, c'est la seule
        // formule juste. En mode « à niveau », les poteaux descendent désormais jusqu'au sol réel
        // (poteaux de longueur variable) au lieu de s'arrêter au niveau du shed 0.
        let shedCourantX = 0;
        const solLocalY = (xLocal) => getCoupeGroundY(shedCourantX + xLocal) - getCoupeStructureY(shedCourantX);
        // CORRECTIF (demande explicite, export PDF vectoriel : "l'ensemble du contenu, terrain
        // compris, doit être entièrement visible") : le sol était tracé sur ±4 largeurs de canevas
        // autour du 1er shed — une largeur en PIXELS, sans rapport avec le champ : il s'arrêtait en
        // cours de route sous un grand champ, et dépassait largement un petit. Pendant une capture
        // d'export (window.__dxfCapture), il couvre exactement les rangées + une marge ; à l'écran,
        // il est seulement prolongé jusqu'à la dernière rangée.
        const groundMarginMeters = Math.max(2, projectedPanelsWidthMeters);
        const shedsRightMeters = (nbShedCount - 1) * shedPitchMeters + projectedPanelsWidthMeters / 2;
        const groundLeftX = window.__dxfCapture
            ? -(projectedPanelsWidthMeters / 2 + groundMarginMeters) * scale
            : -width * 4 / viewManager.zoom;
        const groundRightX = window.__dxfCapture
            ? (shedsRightMeters + groundMarginMeters) * scale
            : Math.max(width * 4 / viewManager.zoom, (shedsRightMeters + groundMarginMeters) * scale + width / viewManager.zoom);
        // Points du sol : 2 suffisent pour la droite manuelle ; profil réel échantillonné tous les
        // 0,5 m (la grille IGN est à 1 m).
        const solPointsCoupe = [];
        const pasSolCoupe = solCoupeAuto ? 0.5 * scale : (groundRightX - groundLeftX);
        for (let x = groundLeftX; x < groundRightX; x += pasSolCoupe) solPointsCoupe.push({ x, y: getCoupeGroundY(x) });
        solPointsCoupe.push({ x: groundRightX, y: getCoupeGroundY(groundRightX) });
        const groundPathCoupe = new Path2D();
        solPointsCoupe.forEach((p, i) => (i ? groundPathCoupe.lineTo(p.x, p.y) : groundPathCoupe.moveTo(p.x, p.y)));
        for (let i = solPointsCoupe.length - 1; i >= 0; i--) groundPathCoupe.lineTo(solPointsCoupe[i].x, solPointsCoupe[i].y + groundRectDepth);
        groundPathCoupe.closePath();
        ctx.save();
        ctx.fillStyle = "#f0f0f0"; ctx.fill(groundPathCoupe);
        ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke(groundPathCoupe);
        ctx.save();
        ctx.clip(groundPathCoupe);
        ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
        const hatchMinY = Math.min.apply(null, solPointsCoupe.map((p) => p.y)) - 5;
        const hatchMaxY = Math.max.apply(null, solPointsCoupe.map((p) => p.y)) + groundRectDepth + 5;
        const hatchSpan = hatchMaxY - hatchMinY;
        for (let i = groundLeftX - hatchSpan; i < groundRightX; i += 10) {
            ctx.beginPath(); ctx.moveTo(i, hatchMaxY); ctx.lineTo(i + hatchSpan, hatchMinY); ctx.stroke();
        }
        ctx.restore();
        ctx.restore();

        shedCourantX = 0;
        let linkedDrawResult = null;
        let doubleYShapeDrawResult = null;
        if (appState.postModel === 'linked') {
            // Modèle "Poteaux centrés liaisonnés" : logique encapsulée dans ombriere_liasonnee.js.
            // On expose les helpers locaux nécessaires (closures de drawCoupe) au fichier dédié.
            window.drawReinforcement = drawReinforcement;
            window.drawRoofStructure = drawRoofStructure;
            window.drawFoundation = drawAnchor;
            linkedDrawResult = drawOmbriereLiasonee(ctx, values, scale, angle, cosA, sinA);
        } else if (appState.postModel === 'doubleYShape') {
            // Modèle "Double toiture Y" : logique encapsulée dans ombriere_liasonnee.js.
            window.drawReinforcement = drawReinforcement;
            window.drawRoofStructure = drawRoofStructure;
            window.drawFoundation = drawAnchor;
            doubleYShapeDrawResult = drawDoubleYShapeOmbriere(ctx, values, scale, angle, cosA, sinA);
        } else {
            for (let shedIdx = 0; shedIdx < nbShedCount; shedIdx++) {
                ctx.save();
                // Item 2 : le champ solaire suit la pente du terrain — toute l'ombrière (poteaux,
                // vis/fondation, traverse, panneaux) est translatée en bloc au niveau du sol local à
                // cette position, SANS jamais rallonger/raccourcir le poteau, la vis ou la fondation
                // (leur géométrie interne, calculée une fois hors boucle, reste inchangée).
                shedCourantX = shedIdx * shedSpacingScaled;
                ctx.translate(shedIdx * shedSpacingScaled, getCoupeStructureY(shedIdx * shedSpacingScaled));

                if (appState.postModel === 'y_shape') {
                    // Ordre de dessin : traverse, PUIS poteaux, PUIS bracons (les bracons doivent
                    // apparaître devant les poteaux, pas dessous).
                    drawRoofStructure(roofSlopeRadians * (localInvertSlope ? -1 : 1), 0, beamCenterY, true); // Bras 1
                    drawRoofStructure(-roofSlopeRadians * (localInvertSlope ? -1 : 1), 0, beamCenterY, true); // Bras 2
                    drawThePosts();
                    drawTheReinforcements();
                } else if (appState.traversePosition === 'side') {
                    // Traverse "Côté" : poteaux puis bracons (bracons devant les poteaux), traverse
                    // dessinée en premier (les bracons/poteaux doivent apparaître devant elle).
                    drawRoofStructure(angle, beamOffsetScaled, beamCenterY);
                    drawThePosts();
                    drawTheReinforcements();
                } else {
                    // Traverse "Dessus" : poteaux puis bracons (bracons devant les poteaux), traverse
                    // dessinée en dernier (elle repose visuellement sur les poteaux).
                    drawThePosts();
                    drawTheReinforcements();
                    drawRoofStructure(angle, beamOffsetScaled, beamCenterY);
                }

                ctx.restore();
            }
        }

        // Terrain au-dessus du BAS DE LA STRUCTURE (table enfoncée) : zone hachurée en rouge + profondeur,
        // reprise par les exports PDF/DXF (vrais traits). Bas de structure = enveloppe basse de ce qui est
        // DESSINÉ : dessous de la traverse et dessous des panneaux (porte-à-faux compris). Modèles à
        // géométrie encapsulée (liaisonné, double Y) et bipente : sans objet ici.
        if (window.TerrainPlans && typeof window.TerrainPlans.zonesEnfoncement === 'function'
            && appState.postModel !== 'linked' && appState.postModel !== 'doubleYShape' && appState.postModel !== 'y_shape') {
            const versShed = (q) => ({ x: q.x * cosA - q.y * sinA + beamOffsetScaled, y: beamCenterY + q.x * sinA + q.y * cosA });
            const segments = [
                // Dessous de la traverse (repère de la traverse : y vers le bas).
                [versShed({ x: -beamLengthScaled / 2, y: beamHeightScaled / 2 }), versShed({ x: beamLengthScaled / 2, y: beamHeightScaled / 2 })],
                // Dessous des panneaux : mêmes extrémités que panelCornersTop, épaisseur en plus.
                [versShed({ x: -beamLengthScaled / 2 - overhangLeftScaledTop, y: panelY + panelThicknessScaled }),
                    versShed({ x: beamLengthScaled / 2 + overhangRightScaledTop, y: panelY + panelThicknessScaled })],
            ].map(([a, b]) => (a.x <= b.x ? [a, b] : [b, a]));
            const xG = Math.min.apply(null, segments.map((sg) => sg[0].x));
            const xD = Math.max.apply(null, segments.map((sg) => sg[1].x));
            // Y (vers le bas) du point le plus bas de la structure à l'abscisse locale xl.
            const dessousLocal = (xl) => {
                let y = -Infinity;
                segments.forEach(([a, b]) => {
                    if (xl < a.x || xl > b.x || b.x === a.x) return;
                    y = Math.max(y, a.y + ((b.y - a.y) * (xl - a.x)) / (b.x - a.x));
                });
                return Number.isFinite(y) ? y : NaN;
            };
            for (let shedIdx = 0; shedIdx < nbShedCount; shedIdx++) {
                const sx = shedIdx * shedSpacingScaled;
                const sy = getCoupeStructureY(sx);
                const zones = window.TerrainPlans.zonesEnfoncement(sx + xG, sx + xD, getCoupeGroundY,
                    (x) => sy + dessousLocal(x - sx), 0.1 * scale);
                window.TerrainPlans.dessinerEnfoncements(ctx, zones, { echelle: scale, taillePolice: Math.max(9, 0.25 * scale) });
            }
        }

        // --- Dimensions ---
        if (appState.postModel !== 'linked' && appState.postModel !== 'doubleYShape') {
            for (let shedIdx = 0; shedIdx < nbShedCount; shedIdx++) {
                ctx.save();
                shedCourantX = shedIdx * shedSpacingScaled;
                const shedGroundOffsetY = getCoupeStructureY(shedIdx * shedSpacingScaled);
                ctx.translate(shedIdx * shedSpacingScaled, shedGroundOffsetY);
                // 2e argument : écart sol réel - niveau de la structure (0 si elle suit le sol).
                drawStandardDimensions(shedGroundOffsetY, getCoupeGroundY(shedIdx * shedSpacingScaled) - shedGroundOffsetY);
                ctx.restore();
            }
        } else if (appState.postModel === 'linked' && linkedDrawResult && linkedDrawResult.linkPoints && linkedDrawResult.linkPoints.length > 0) {
            // Cotations standard rejouées sur chaque ombrière liaisonnée (toutes identiques),
            // puis cotation de l'entraxe entre chaque paire de poteaux.
            linkedDrawResult.linkPoints.forEach(pt => {
                ctx.save();
                ctx.translate(pt.center.x, 0);
                drawStandardDimensions(0, 0, (x) => getCoupeGroundY(pt.center.x + x));
                ctx.restore();
            });
            drawLinkedEntraxeDimensions(ctx, linkedDrawResult.linkPoints, linkedDrawResult.safePostSpacing, scale);
        } else if (appState.postModel === 'doubleYShape' && doubleYShapeDrawResult && doubleYShapeDrawResult.postPositions && doubleYShapeDrawResult.postPositions.length > 0) {
            // Cotations du modèle "Toiture Y" rejouées sur le premier poteau (tous identiques).
            ctx.save();
            ctx.translate(doubleYShapeDrawResult.postPositions[0], 0);
            drawStandardDimensions(0, 0, (x) => getCoupeGroundY(doubleYShapeDrawResult.postPositions[0] + x));
            ctx.restore();
        }

        if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape') {
            for (let shedIdx = 0; shedIdx < nbShedCount; shedIdx++) {
                ctx.save();
                ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.translate(shedIdx * shedSpacingScaled, getCoupeStructureY(shedIdx * shedSpacingScaled));
                ctx.translate(beamOffsetScaled, beamCenterY); ctx.rotate(angle);
                ctx.fillText(`Pente = ${roofSlope}°`, 0, panelY - 10);
                ctx.restore();
            }
        }

        // --- Cotation altimétrique (item 1) : petite croix + niveau terrain "+0.00= X Ngf" à droite
        // du premier poteau de la première ombrière (shed 0), masquable via #toolToggleAltimetryDims.
        if (appState.showAltimetryDims && appState.postModel !== 'linked' && appState.postModel !== 'doubleYShape') {
            let firstPostXAlt = 0;
            if (appState.postModel === 'double' || appState.postModel === 'inclinedPost') {
                // CORRECTIF (cotation masquée par les jambes de force/contreventement) : positionnée
                // désormais après le DEUXIÈME poteau (+spacingAlt, à droite) plutôt qu'après le premier
                // (-spacingAlt, à gauche) — les barres de renfort occupent l'espace entre les 2 poteaux
                // et juste à droite du premier, là où la cotation était auparavant posée.
                const spacingAlt = (appState.postModel === 'inclinedPost' ? postSpacingInclined : postSpacing) * scale / 2;
                firstPostXAlt = spacingAlt;
            } else if (appState.postModel === 'offset' && appState.offsetPostSide !== 'center') {
                const halfPanelHorizontalAlt = (panelWidthScaled / 2) * Math.cos(roofSlopeRadians);
                if (appState.offsetPostSide === 'low') firstPostXAlt = localInvertSlope ? halfPanelHorizontalAlt : -halfPanelHorizontalAlt;
                if (appState.offsetPostSide === 'high') firstPostXAlt = localInvertSlope ? -halfPanelHorizontalAlt : halfPanelHorizontalAlt;
                firstPostXAlt += values.postEccentricity * scale;
            } else {
                firstPostXAlt = values.postEccentricity * scale;
            }
            const altY = getCoupeGroundY(0); // niveau du sol au droit de la première ombrière (shed 0)
            const altX = firstPostXAlt + postWidthScaled / 2 + 0.3 * scale; // à droite du premier poteau
            ctx.save();
            ctx.strokeStyle = appState.dimensionColor; ctx.lineWidth = 1.5;
            const crossSize = 5;
            ctx.beginPath(); ctx.moveTo(altX - crossSize, altY); ctx.lineTo(altX + crossSize, altY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(altX, altY - crossSize); ctx.lineTo(altX, altY + crossSize); ctx.stroke();
            ctx.fillStyle = appState.dimensionColor; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            const altitudeShed0 = solCoupeAuto ? solCoupeAuto.zAbs(0) : numOr(values.baseAltimetry, 0);
            const uniteAltitude = solCoupeAuto ? window.TerrainPlans.libelleAltitude() : 'Ngf';
            ctx.fillText(`+0.00= ${altitudeShed0.toFixed(2)} ${uniteAltitude}`, altX + crossSize + 3, altY - 3);
            ctx.restore();

            // FIX (item 4) : même repère altimétrique, cette fois après le poteau du dernier plan
            // de coupe (dernier shed) — affiche l'altimétrie de départ et sa valeur ajustée du
            // dénivelé (ex: altimétrie=+4.00, dénivelé=-0.20 -> "+4.00 = 3.80 Ngf").
            // Un seul shed (champ d'une rangée, détail de coupe du dossier de plans) : ce repère
            // tomberait exactement sur le premier, les deux textes se superposaient.
            if (nbShedCount > 1) {
                const lastShedOffsetScaled = (nbShedCount - 1) * shedSpacingScaled;
                const lastPostXAlt = firstPostXAlt + lastShedOffsetScaled;
                const altYLast = getCoupeGroundY(lastShedOffsetScaled);
                const altXLast = lastPostXAlt + postWidthScaled / 2 + 0.3 * scale;
                const baseAltimetryValue = altitudeShed0;
                const adjustedAltimetryValue = solCoupeAuto
                    ? solCoupeAuto.zAbs(lastShedOffsetScaled / scale)
                    : baseAltimetryValue + numOr(values.groundSlopeFacade, 0);
                ctx.save();
                ctx.strokeStyle = appState.dimensionColor; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(altXLast - crossSize, altYLast); ctx.lineTo(altXLast + crossSize, altYLast); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(altXLast, altYLast - crossSize); ctx.lineTo(altXLast, altYLast + crossSize); ctx.stroke();
                ctx.fillStyle = appState.dimensionColor; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                const altSignPrefix = baseAltimetryValue >= 0 ? '+' : '';
                ctx.fillText(`${altSignPrefix}${baseAltimetryValue.toFixed(2)} = ${adjustedAltimetryValue.toFixed(2)} ${uniteAltitude}`, altXLast + crossSize + 3, altYLast - 3);
                ctx.restore();
            }
        }

        // --- Limites parcellaires (section "Données des coupes et façades") ---
        // Ligne verticale rouge + label vertical + cotation horizontale, entre l'extrémité gauche/
        // droite du champ de panneaux et la limite parcellaire correspondante. Non applicable aux
        // modèles "linked"/"doubleYShape" (géométrie encapsulée ailleurs, boutons de sélection de
        // modèle inexistants sur cette page). Toujours affiché si une valeur est saisie (indépendant
        // du bouton "Afficher/masquer les cotations" : il s'agit d'une limite de site, pas d'une
        // simple cotation interne) ; seule la cotation chiffrée elle-même respecte ce bouton (via
        // drawDimensionLine).
        // FIX: ancre le label "Façade [Orientation]" (dessiné plus bas) près de la ligne verticale
        // "Limite parcellaire gauche" quand elle existe — portée déclarée ici (hors du bloc if
        // ci-dessous, block-scopé) pour rester accessible après sa fermeture.
        let facadeLabelAnchorX = null;
        if (appState.postModel !== 'linked' && appState.postModel !== 'doubleYShape') {
            const overhangLScaledParcel = (values.overhangL || 0) * scale;
            const overhangHScaledParcel = (values.overhangH || 0) * scale;
            const eaveOnRightParcel = Math.sin(angle) >= 0;
            const overhangLeftScaledParcel = eaveOnRightParcel ? overhangHScaledParcel : overhangLScaledParcel;
            const overhangRightScaledParcel = eaveOnRightParcel ? overhangLScaledParcel : overhangHScaledParcel;
            const parcelPanelCorners = [
                { x: -beamLengthScaled / 2 - overhangLeftScaledParcel, y: panelY },
                { x: beamLengthScaled / 2 + overhangRightScaledParcel, y: panelY }
            ].map(p => ({ x: p.x * cosA - p.y * sinA + beamOffsetScaled, y: beamCenterY + p.x * sinA + p.y * cosA }));

            // Limite parcellaire (gauche/droite) : déplacée dans
            // petit_champ_solaire_poteau_utilities.js (drawParcelLimitCoupe), aucune dépendance au
            // modèle de poteaux.
            const parcelLimitGeo = { parcelPanelCorners, nbShedCount, shedSpacingScaled, topDimY, groundRectDepth, solY: getCoupeGroundY };
            const leftParcelLineX = drawParcelLimitCoupe(ctx, scale, values, 'left', parcelLimitGeo);
            if (leftParcelLineX !== null) facadeLabelAnchorX = leftParcelLineX;
            drawParcelLimitCoupe(ctx, scale, values, 'right', parcelLimitGeo);

            // FIX (item 1) : nouvelle cotation "espacement entre shed" — une par intervalle entre 2
            // ombrières successives, positionnée elle aussi à 4m au-dessus du point le plus haut des
            // panneaux (topDimY). Espacement réel = shedPitchMeters (pas de répétition) moins la
            // largeur projetée d'une ombrière = values.shedSpacing (cf. calcul de shedPitchMeters).
            if (nbShedCount > 1) {
                for (let shedIdx = 0; shedIdx < nbShedCount - 1; shedIdx++) {
                    const shedRightX = parcelPanelCorners[1].x + shedIdx * shedSpacingScaled;
                    const nextShedLeftX = parcelPanelCorners[0].x + (shedIdx + 1) * shedSpacingScaled;
                    drawDimensionLine(ctx, shedRightX, topDimY, nextShedLeftX, topDimY, `${(values.shedSpacing || 0).toFixed(2)}m`, 0, false);
                }
            }
        }

        // --- Titre d'orientation de la façade dynamique (dessiné sur le canvas) ---
        // FIX (item 3) : le Plan de coupe utilise désormais son propre contrôle d'orientation
        // (#coupe-orientation-group / appState.coupeOrientation, défaut Est), indépendant de celui du
        // Plan de façade (#facade-orientation-group / appState.facadeOrientation, défaut Sud).
        // Label d'orientation façade (plan de coupe) : déplacé dans
        // petit_champ_solaire_poteau_utilities.js (drawCoupeOrientationLabel).
        drawCoupeOrientationLabel(ctx, scale, values, { angle, cosA, sinA, beamCenterY, panelY, beamLengthScaled, beamOffsetScaled }, facadeLabelAnchorX);

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
            // un bras extérieur standard de panelWidth/2 qui dépasse vers l'extérieur.
            const doubleYShapePanelCount = Math.max(2, values.doubleYShapePanelsCount || 2);
            const totalWidthMeters = (doubleYShapePanelCount - 1) * (values.postSpacing || 0);
            const outerArmMeters = (values.panelWidth || 0) / 2;
            return {
                minX: -(totalWidthMeters / 2) - outerArmMeters - marginMeters,
                maxX: (totalWidthMeters / 2) + outerArmMeters + marginMeters,
                minY: -values.postHeight - marginMeters,
                maxY: marginMeters
            };
        }
        // Les rangées de shed supplémentaires (nbShedCount > 1) s'étendent vers la droite de shedPitchMeters
        // en shedPitchMeters : on élargit la boîte englobante en conséquence.
        const totalShedSpanMeters = (nbShedCount - 1) * shedPitchMeters;
        // Terrain automatique : étendue verticale du sol réel sous les sheds (+ hachure de 1,40 m).
        let solHautM = 0, solBasM = 0;
        if (solCoupeAuto) {
            for (let x = -values.panelWidth / 2; x <= values.panelWidth / 2 + totalShedSpanMeters; x += 0.5) {
                const z = solCoupeAuto.zRel(x);
                solHautM = Math.max(solHautM, z);
                solBasM = Math.max(solBasM, -z);
            }
            if (solBasM > 0) solBasM += 1.4;
        }
        return {
            minX: -(values.panelWidth / 2) - marginMeters,
            maxX: values.panelWidth / 2 + totalShedSpanMeters + marginMeters,
            minY: -values.postHeight - solHautM - marginMeters,
            maxY: marginMeters + solBasM // Just above the ground line (Y=0)
        };
    }

    function drawFacade(canvas, ctx, viewManager, values) {
        // Logique de dessin de la façade (conservée intégralement)
        // FIX (item 3) : le Plan de façade utilise désormais son propre dénivelé/altimétrie
        // (#facadeGroundSlope/#facadeBaseAltimetry), indépendant de celui du Plan de coupe
        // (#groundSlopeFacade/#baseAltimetry) — alias de déstructuration pour ne toucher aucune des
        // nombreuses utilisations de groundSlopeFacade/baseAltimetry plus bas dans cette fonction.
        const { postHeight, facadeLength, leftOverhang, rightOverhang, facadeGroundSlope: groundSlopeFacade, postWidth, panelWidth, roofSlope, invertSlope, lowPointHeight, alignRoof, pvLayout, facadeBaseAltimetry: baseAltimetry, purlinHeight, parcelLimitLeftFacade, parcelLimitRightFacade } = values;
        // FIX: ReferenceError "numOr is not defined" — cette fonction est locale à drawCoupe, pas
        // partagée avec drawFacade (portée de fonction distincte) ; drawFacadeParcelLimit plus bas en
        // a besoin, d'où cette duplication minimale (même implémentation que dans drawCoupe).
        const numOr = (val, fallback) => {
            const n = typeof val === 'number' ? val : parseFloat(val);
            return Number.isFinite(n) ? n : fallback;
        };
        // Police réduite pour les cotations du plan de façade (demande utilisateur), par rapport à la
        // taille par défaut (12px) utilisée pour le plan de coupe/implantation. Remonté ici (portée de
        // fonction) depuis l'intérieur de la boucle par groupe de sheds : drawFacadeParcelLimit, qui
        // s'exécute après cette boucle, en a besoin (cf. FIX ReferenceError "facadeDimFontSize is not
        // defined").
        const facadeDimFontSize = 9;
        const { width, height } = setupCanvas(canvas);
        if (width === 0 || height === 0) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(viewManager.panX, viewManager.panY); ctx.scale(viewManager.zoom, viewManager.zoom);
        ctx.translate(width / 2, height / 2);
        const distances = appState.parsedDistances;
        if (!distances) { ctx.restore(); return; }
        const effectivePanelWidth = appState.postModel === 'y_shape' ? panelWidth / 2 : panelWidth;
        const roofApparentHeight = Math.abs(effectivePanelWidth * Math.sin(roofSlope * Math.PI / 180 * (invertSlope ? -1 : 1)));

        // "Nb sheds en longueur" / "Espacement entre groupe de shed" : le plan de façade (un groupe =
        // la configuration calepinage LxC courante, avec ses propres porte-à-faux déduits) est
        // dupliqué nbShedGroups fois le long de la façade, séparé par shedGroupSpacing — même
        // principe que la répétition nbShed/shedSpacing déjà en place dans le Plan de coupe.
        // CORRECTIF (demande explicite : même bug que dans drawCoupe ci-dessus, cf. son commentaire) —
        // ce plafond illustratif faisait diverger le plan de façade de la rangée réellement
        // sélectionnée via "Analyse par rangée" (#nbShedGroups synchronisé depuis le groupe de la
        // rangée choisie, cf. sync_calepinage_shed.js / FormHandler.js). Dessine désormais le compte
        // RÉEL, avec le même plafond de sécurité (200) que drawCoupe.
        const MAX_SHED_GROUPS_SAFETY = 200;
        const nbShedGroupsCount = Math.min(Math.max(1, Math.round(values.nbShedGroups) || 1), MAX_SHED_GROUPS_SAFETY);
        const shedGroupSpacingMeters = values.shedGroupSpacing || 0;
        const groupPitchMeters = facadeLength + shedGroupSpacingMeters;
        const totalGroupsWidthMeters = nbShedGroupsCount * facadeLength + (nbShedGroupsCount - 1) * shedGroupSpacingMeters;

        const totalDrawingWidth = totalGroupsWidthMeters;
        // Terrain automatique (cf. geometrie_structure/terrain_plans.js) : profil de la rangée choisie
        // dans « Analyse par rangée », lu dans le sens de la vue (#facade-orientation) ; null -> saisie
        // manuelle historique (droite de pente groundSlopeFacade par groupe).
        const solFacadeAuto = (window.TerrainPlans && typeof window.TerrainPlans.solFacade === 'function')
            ? window.TerrainPlans.solFacade({ orientation: appState.facadeOrientation || 'Sud', longueurDessinM: totalGroupsWidthMeters })
            : null;
        let deniveleDessinM = Math.abs(groundSlopeFacade);
        if (solFacadeAuto) {
            let zMin = 0, zMax = 0;
            for (let x = 0; x <= totalGroupsWidthMeters; x += 0.5) {
                const z = solFacadeAuto.zRel(x);
                zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
            }
            deniveleDessinM = zMax - zMin;
        }
        const totalDrawingHeight = postHeight + deniveleDessinM + roofApparentHeight + 5;
        // CORRECTIF (demande explicite, même principe que drawCoupe ci-dessus) : l'échelle n'est plus
        // calée sur totalDrawingWidth (qui grandit avec nbShedGroups et écrasait le dessin) — seule
        // totalDrawingHeight (indépendante du nombre de groupes de sheds) pilote désormais l'échelle.
        // totalDrawingWidth reste utilisé plus bas pour centrer le dessin (originX), inchangé.
        const scale = (height / (totalDrawingHeight + 4)) * 0.9;
        if (window.__dxfCapture) window.__dxfCapture.scale = scale; // Export DXF (cf. dxf_export.js) : seul point d'accès à "scale" (px/mètre) sans dupliquer sa formule.

        const originX = -totalDrawingWidth * scale / 2;
        const groundYAtOrigin = (postHeight * scale + roofApparentHeight * scale) / 2;
        ctx.translate(originX, groundYAtOrigin);

        // getScaledGroundY prend une position ABSOLUE (sur toute la largeur multi-groupes) : le
        // dénivelé du terrain reste ainsi continu d'un groupe de shed au suivant (pas remis à zéro à
        // chaque répétition) — le taux de pente (m par mètre) reste celui d'UN groupe (facadeLength),
        // appliqué sur la portée réelle absolue.
        const getScaledGroundY = solFacadeAuto
            ? (xAbsScaled) => -solFacadeAuto.zRel(xAbsScaled / scale) * scale
            : (xAbsScaled) => (facadeLength > 0 ? (xAbsScaled / (facadeLength * scale)) * (-groundSlopeFacade * scale) : 0);
        const groundPath = new Path2D();
        const groundDepth = 1.40 * scale; // Profondeur hachure de 1.40m
        // CORRECTIF (même demande que le sol du Plan de coupe, cf. drawCoupe) : étendue en pixels de
        // canevas, sans rapport avec la longueur du champ — bornée aux groupes de sheds + 2 m pendant
        // une capture d'export, prolongée jusqu'au dernier groupe à l'écran.
        const facadeGroundMarginScaled = 2 * scale;
        const startX = window.__dxfCapture ? -facadeGroundMarginScaled : -width * 2 / viewManager.zoom;
        const endX = window.__dxfCapture
            ? totalDrawingWidth * scale + facadeGroundMarginScaled
            : Math.max(width * 2 / viewManager.zoom, totalDrawingWidth * scale + width / viewManager.zoom);
        const solPointsFacade = [];
        const pasSolFacade = solFacadeAuto ? 0.5 * scale : (endX - startX);
        for (let x = startX; x < endX; x += pasSolFacade) solPointsFacade.push({ x, y: getScaledGroundY(x) });
        solPointsFacade.push({ x: endX, y: getScaledGroundY(endX) });
        solPointsFacade.forEach((p, i) => (i ? groundPath.lineTo(p.x, p.y) : groundPath.moveTo(p.x, p.y)));
        for (let i = solPointsFacade.length - 1; i >= 0; i--) groundPath.lineTo(solPointsFacade[i].x, solPointsFacade[i].y + groundDepth);
        groundPath.closePath();
        ctx.fillStyle = "#f9f9f9"; ctx.fill(groundPath);
        if (window.__dxfCapture) {
            // Le hachurage visuel du sol utilise normalement un CanvasPattern (branche else ci-dessous) :
            // un remplissage raster répété, sans équivalent DXF/PDF vectoriel (DxfContextRecorder.
            // createPattern() est un no-op). Pendant une capture d'export (cf. captureDxfEntities), on le
            // remplace par des lignes diagonales explicites — même technique que le hachurage du Plan de
            // coupe juste au-dessus (drawCoupe), déjà correctement exporté grâce à ce mécanisme.
            ctx.save();
            ctx.clip(groundPath);
            ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
            const hatchMinY = Math.min.apply(null, solPointsFacade.map((p) => p.y)) - 5;
            const hatchMaxY = Math.max.apply(null, solPointsFacade.map((p) => p.y)) + groundDepth + 5;
            const hatchSpan = hatchMaxY - hatchMinY;
            for (let i = startX - hatchSpan; i < endX; i += 10) {
                ctx.beginPath(); ctx.moveTo(i, hatchMaxY); ctx.lineTo(i + hatchSpan, hatchMinY); ctx.stroke();
            }
            ctx.restore();
        } else {
            const patternCanvas = document.createElement('canvas'); const patternCtx = patternCanvas.getContext('2d');
            patternCanvas.width = 10; patternCanvas.height = 10;
            patternCtx.strokeStyle = '#cccccc'; patternCtx.lineWidth = 1;
            patternCtx.beginPath(); patternCtx.moveTo(0, 10); patternCtx.lineTo(10, 0); patternCtx.stroke();
            const pattern = ctx.createPattern(patternCanvas, 'repeat');
            ctx.fillStyle = pattern; ctx.fill(groundPath);
        }
        ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke(groundPath);

        const postWidthScaled = Math.max(postWidth * scale, 2);
        const useRoofAlignment = alignRoof;

        // FIX (item 1, plans de façade) : référence "plate", indépendante du dénivelé du terrain et du
        // décalage de groupe (getScaledGroundY(groupOffsetScaled) varie par groupe de shed dupliqué) —
        // utilisée pour positionner TOUTES les cotations horizontales (entraxes/longueur totale/limite
        // de parcelle) à une hauteur constante, sans décalage vertical d'une ligne/d'un groupe à l'autre.
        const isYShapeFacadeFlat = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape');
        const structureBottomRefHeightFlat = isYShapeFacadeFlat ? postHeight : lowPointHeight;
        // Correctif : les poteaux ne doivent jamais dépasser la façade (rester dans [0, facadeLength])
        // — filet de sécurité (clamp, sans retirer d'éléments pour ne pas décaler la correspondance
        // avec "distances") au cas où un léger écart d'arrondi placerait un poteau hors de cette plage.
        const postPositionsRaw = (appState.postPositionsX && appState.postPositionsX.length > 0) ? appState.postPositionsX : [leftOverhang];
        const postPositions = postPositionsRaw.map(xPos => Math.min(Math.max(xPos, 0), facadeLength));

        // Calage de la table de chaque groupe (cf. TerrainPlans.calerTable) : « Alignement toiture »
        // coché = table horizontale, sinon elle suit la pente entre le premier et le dernier poteau.
        // Dans les deux cas, le poteau le plus contraint garde exactement postHeight ; les autres
        // s'allongent. Sur la droite manuelle, le mode pente redonne des poteaux tous égaux (dessin
        // historique) ; le mode horizontal se cale sur le point HAUT (avant : sur le début du groupe,
        // ce qui raccourcissait les poteaux quand le terrain monte). Calculé AVANT le dessin : la
        // table la plus haute fixe la hauteur des cotations (facadeFlatTopY ci-dessous).
        const calagesGroupes = [];
        for (let g = 0; g < nbShedGroupsCount; g++) {
            const decalage = g * groupPitchMeters * scale;
            const zSolM = (xM) => -getScaledGroundY(decalage + xM * scale) / scale;
            const calage = (window.TerrainPlans && typeof window.TerrainPlans.calerTable === 'function')
                ? window.TerrainPlans.calerTable(
                    postPositions.map((xPos) => ({ x: xPos, zSol: zSolM(xPos) })),
                    useRoofAlignment ? 'horizontal' : 'pente', 0)
                : null;
            calagesGroupes.push({ zSolM, zTableM: calage ? calage.zTable : zSolM });   // niveau du pied « de référence »
        }
        const tableLaPlusHauteM = Math.max.apply(null, calagesGroupes.map((c) => Math.max(c.zTableM(0), c.zTableM(facadeLength))));
        // Référence plate historique, relevée si une table (terrain qui monte) passe au-dessus.
        const facadeFlatTopY = Math.min(0, -tableLaPlusHauteM * scale) - structureBottomRefHeightFlat * scale - roofApparentHeight * scale;

        // Un groupe de shed = exactement le contenu précédemment dessiné une seule fois ; répété
        // nbShedGroupsCount fois, chacun décalé de groupPitchMeters (facadeLength + espacement).
        for (let g = 0; g < nbShedGroupsCount; g++) {
            const groupOffsetScaled = g * groupPitchMeters * scale;
            ctx.save();
            ctx.translate(groupOffsetScaled, 0);
            ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
            const { zTableM } = calagesGroupes[g];
            // Poteaux verticaux, pied sur le sol LOCAL. Fondations (bouton « Fondations ») dessinées
            // dans un repère translaté au sol de chaque poteau, comme en coupe : la partie enterrée
            // est donc la même pour tous les poteaux, quelle que soit la pente.
            const avecFondations = appState.showFoundation && typeof drawAnchorBehindPost === 'function';
            const largeurPlotFacade = appState.anchorSystem === 'beton' ? numOr(values.foundationWidth, 0.5) : undefined;
            postPositions.forEach(xPos => {
                const groundY = getScaledGroundY(groupOffsetScaled + xPos * scale);
                const postTopY = -(zTableM(xPos) + postHeight) * scale;
                let postBottomY = groundY;
                if (avecFondations && appState.anchorSystem === 'beton') {
                    if (appState.foundationPosition === 'enterre') postBottomY += numOr(values.foundationBuryLevel, 0.3) * scale;
                    else if (appState.foundationPosition === 'surface') postBottomY -= numOr(values.foundationDepth, 0.5) * scale;
                }
                if (avecFondations) {
                    ctx.save(); ctx.translate(0, groundY);
                    drawAnchorBehindPost(ctx, scale, values, xPos * scale, largeurPlotFacade);
                    ctx.restore();
                    ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
                }
                const postH = postBottomY - postTopY;
                ctx.fillRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
                ctx.strokeRect(xPos * scale - postWidthScaled / 2, postTopY, postWidthScaled, postH);
                if (avecFondations && typeof drawAnchorInFrontOfPost === 'function') {
                    ctx.save(); ctx.translate(0, groundY);
                    drawAnchorInFrontOfPost(ctx, scale, values, xPos * scale, largeurPlotFacade);
                    ctx.restore();
                    ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
                }
            });

            // FIX: Plan de façade Bipente — pour ce modèle, le poteau atteint le FAÎTAGE (postHeight),
            // pas l'égout (lowPointHeight, bien plus bas). La bande de toiture doit donc être ancrée
            // sur postHeight (comme les poteaux ci-dessus, cf. postTopY = groundY - postHeight*scale),
            // sinon elle reste calée sur lowPointHeight et les poteaux semblent percer au-dessus
            // d'elle. Les panneaux (grille de calepinage) subdivisant cette même bande suivent
            // automatiquement la correction — ils deviennent coplanaires avec la pente ainsi rétablie.
            const isYShapeFacade = (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape');
            const structureBottomRefHeight = isYShapeFacade ? postHeight : lowPointHeight;

            const roofThicknessScaled = roofApparentHeight * scale;
            // Bas de la toiture = droite de la table (même calage que les poteaux ci-dessus).
            let roofBottomStartY, roofBottomEndY, roofTopStartY, roofTopEndY;
            roofBottomStartY = -(zTableM(0) + structureBottomRefHeight) * scale;
            roofBottomEndY = -(zTableM(facadeLength) + structureBottomRefHeight) * scale;
            roofTopStartY = roofBottomStartY - roofThicknessScaled;
            roofTopEndY = roofBottomEndY - roofThicknessScaled;

            // Dessin "façade/panneaux"
            const roofPath = new Path2D();
            roofPath.moveTo(0, roofBottomStartY); roofPath.lineTo(facadeLength * scale, roofBottomEndY);
            roofPath.lineTo(facadeLength * scale, roofTopEndY); roofPath.lineTo(0, roofTopStartY);
            roofPath.closePath();
            // CORRECTIF (demande explicite : "les poteaux passent devant les panneaux") : ce
            // remplissage est déjà dessiné APRÈS les poteaux (ligne ~1721 ci-dessus), donc déjà
            // au-dessus dans l'ordre de peinture du canvas — mais son alpha (0.7) laissait le
            // remplissage gris opaque et le contour foncé des poteaux transparaître nettement au
            // travers, donnant l'impression trompeuse qu'ils étaient dessinés PAR-DESSUS. Opacité
            // pleine désormais, pour que les panneaux masquent réellement les poteaux en dessous.
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

            // Terrain au-dessus du bas de la toiture (table enfoncée) : zone hachurée rouge, reprise
            // par les exports (cf. TerrainPlans.dessinerEnfoncements). Bipente : bas = faîtage, sans objet.
            if (!isYShapeFacade && window.TerrainPlans && typeof window.TerrainPlans.zonesEnfoncement === 'function') {
                const zones = window.TerrainPlans.zonesEnfoncement(0, facadeLength * scale,
                    (x) => getScaledGroundY(groupOffsetScaled + x),
                    (x) => -(zTableM(x / scale) + structureBottomRefHeight) * scale, 0.1 * scale);
                window.TerrainPlans.dessinerEnfoncements(ctx, zones, { echelle: scale, taillePolice: Math.max(9, 0.25 * scale) });
            }

            // FIX (item 3, plans de façade) : la grille de calepinage (LxC) était réservée à g===0
            // (première façade seulement) — désormais tracée identiquement sur CHAQUE groupe de shed
            // dupliqué (comme le reste du dessin : toiture, pannes, poteaux, cotations).
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
                    // "Espacement X" (mm, cf. #panelSpacingX) : creuse un intervalle visuel ENTRE colonnes
                    // consécutives de la grille de calepinage (LxC), sans toucher aux colonnes de bord (0 et
                    // cols-1, qui restent affleurantes aux limites réelles de la façade) — même principe que
                    // panelSpacingY dans le Plan de coupe, appliqué ici à la seule grille disponible côté
                    // Plan de façade (aucune subdivision physique en panneaux individuels n'existait avant).
                    const vWidthLen = Math.hypot(v_width.x, v_width.y) || 1;
                    const uWidthX = v_width.x / vWidthLen, uWidthY = v_width.y / vWidthLen;
                    const halfGapX = (((values.panelSpacingX || 0) / 1000) * scale) / 2;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 0.5;
                    for (let i = 0; i < rows; i++) {
                        for (let j = 0; j < cols; j++) {
                            const insetStart = j === 0 ? 0 : halfGapX;
                            const insetEnd = j === cols - 1 ? 0 : halfGapX;
                            const jStartFrac = j / cols, jEndFrac = (j + 1) / cols;
                            const c1x = p1.x + jStartFrac * v_width.x + (i / rows) * v_height.x + uWidthX * insetStart;
                            const c1y = p1.y + jStartFrac * v_width.y + (i / rows) * v_height.y + uWidthY * insetStart;
                            const c2x = p1.x + jEndFrac * v_width.x + (i / rows) * v_height.x - uWidthX * insetEnd;
                            const c2y = p1.y + jEndFrac * v_width.y + (i / rows) * v_height.y - uWidthY * insetEnd;
                            const c3x = p1.x + jEndFrac * v_width.x + ((i + 1) / rows) * v_height.x - uWidthX * insetEnd;
                            const c3y = p1.y + jEndFrac * v_width.y + ((i + 1) / rows) * v_height.y - uWidthY * insetEnd;
                            const c4x = p1.x + jStartFrac * v_width.x + ((i + 1) / rows) * v_height.x + uWidthX * insetStart;
                            const c4y = p1.y + jStartFrac * v_width.y + ((i + 1) / rows) * v_height.y + uWidthY * insetStart;
                            ctx.beginPath();
                            ctx.moveTo(c1x, c1y); ctx.lineTo(c2x, c2y); ctx.lineTo(c3x, c3y); ctx.lineTo(c4x, c4y);
                            ctx.closePath(); ctx.stroke();
                        }
                    }
                }
            } catch (e) { console.error("Format de calepinage PV invalide.", e); }

            // FIX (item 1) : dimLineY1/dimLineY2 utilisent désormais facadeFlatTopY (référence plate,
            // hors boucle) au lieu de highestRoofPointY (qui intégrait getScaledGroundY(groupOffsetScaled),
            // variable par groupe) — les cotations restent ainsi à une hauteur strictement identique
            // sur tous les groupes de shed dupliqués, quel que soit le dénivelé du terrain.
            const dimLineY1 = facadeFlatTopY - 30; const dimLineY2 = facadeFlatTopY - 60;
            drawDimensionLine(ctx, 0, dimLineY1, postPositions[0] * scale, dimLineY1, `${leftOverhang.toFixed(1)}m`, 0, false, facadeDimFontSize);
            for (let i = 0; i < distances.length; i++) {
                drawDimensionLine(ctx, postPositions[i] * scale, dimLineY1, postPositions[i + 1] * scale, dimLineY1, `${distances[i].toFixed(2)}m`, 0, false, facadeDimFontSize);
            }
            drawDimensionLine(ctx, postPositions[postPositions.length - 1] * scale, dimLineY1, facadeLength * scale, dimLineY1, `${rightOverhang.toFixed(1)}m`, 0, false, facadeDimFontSize);
            drawDimensionLine(ctx, 0, dimLineY2, facadeLength * scale, dimLineY2, `${facadeLength.toFixed(2)}m`, 0, false, facadeDimFontSize);

            // FIX: cohérence avec structureBottomRefHeight ci-dessus (postHeight pour Bipente, sinon
            // lowPointHeight) — sinon ce texte affichait encore une hauteur calée sur l'égout alors
            // que le point dessiné (roofTopStartY/roofTopEndY) est désormais au faîtage.
            // Hauteurs mesurées sur le dessin jusqu'au sol réel sous chaque ligne de cote.
            const solGroupe = (x) => getScaledGroundY(groupOffsetScaled + x);
            const coteSolFacade = { echelle: scale };

            const dimOffsetLeft = (-2) * scale;
            const dimOffsetRight = facadeLength * scale + (2) * scale;

            // FIX (item 2) : ces cotations verticales (hauteur haute) ne sont plus dessinées à CHAQUE
            // frontière entre groupes de shed dupliqués (ce qui créait des lignes verticales inutiles
            // "au milieu" du plan, à chaque jonction) — seulement au bord gauche du premier groupe et
            // au bord droit du dernier, même principe que pour l'altimétrie (item 3, demande précédente).
            if (g === 0) {
                drawVerticalDimensionWithLeader(ctx, 0, roofTopStartY, dimOffsetLeft, null, solGroupe, facadeDimFontSize, coteSolFacade);
            }
            if (g === nbShedGroupsCount - 1) {
                drawVerticalDimensionWithLeader(ctx, facadeLength * scale, roofTopEndY, dimOffsetRight, null, solGroupe, facadeDimFontSize, coteSolFacade);
            }

            const xFinGroupeM = (groupOffsetScaled / scale) + facadeLength;
            const altimetryLeft = solFacadeAuto ? solFacadeAuto.zAbs(0) : baseAltimetry;
            const deniveleDroite = solFacadeAuto ? solFacadeAuto.zRel(xFinGroupeM) : groundSlopeFacade;
            const altimetryRight = altimetryLeft + deniveleDroite;
            const uniteAltitudeFacade = solFacadeAuto ? (window.TerrainPlans.altitudesNGF() ? 'm (NGF)' : 'm (alt. approx.)') : 'm (NGF)';
            // FIX (item 3, plans de façade) : n'afficher l'altimétrie gauche que sur le premier poteau
            // du premier groupe de shed (g===0), et l'altimétrie droite que sur le dernier poteau du
            // dernier groupe (g===nbShedGroupsCount-1) — plus d'affichage sur les plans intermédiaires.
            const groundRefPoints = [];
            if (g === 0) groundRefPoints.push({ x: 0, refText: `+0.00m`, altText: `${altimetryLeft.toFixed(2)}${uniteAltitudeFacade}` });
            if (g === nbShedGroupsCount - 1) groundRefPoints.push({ x: facadeLength * scale, refText: `${deniveleDroite.toFixed(2)}m`, altText: `${altimetryRight.toFixed(2)}${uniteAltitudeFacade}` });
            groundRefPoints.forEach(point => {
                const y = getScaledGroundY(groupOffsetScaled + point.x);
                ctx.save(); ctx.fillStyle = appState.dimensionColor; ctx.font = `bold ${facadeDimFontSize}px Arial`; ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom'; ctx.fillText(point.refText, point.x, y - 4);
                ctx.textBaseline = 'top'; ctx.font = `${facadeDimFontSize}px Arial`; ctx.fillText(point.altText, point.x, y + 4);
                ctx.strokeStyle = appState.dimensionColor; ctx.lineWidth = 1.5; const crossSize = 4;
                ctx.beginPath(); ctx.moveTo(point.x - crossSize, y); ctx.lineTo(point.x + crossSize, y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(point.x, y - crossSize); ctx.lineTo(point.x, y + crossSize); ctx.stroke();
                ctx.restore();
            });

            ctx.restore(); // fin du groupe g
        }

        // --- Limites parcellaires sur la façade ---
        // FIX (item 1, plans de façade) : un seul label "Façade [Orientation]" pour tout le plan
        // (au lieu d'un par groupe de shed dupliqué), ancré à droite de la ligne "Limite parcellaire
        // gauche" — même principe que sur le Plan de coupe.
        let facadeLabelAnchorX = null;
        // Limite parcellaire + label d'orientation (plan de façade) : déplacés dans
        // petit_champ_solaire_poteau_utilities.js (drawParcelLimitFacade / drawFacadeOrientationLabel).
        const facadeParcelLimitGeo = { totalGroupsWidthMeters, totalDrawingHeight, groundDepth, facadeFlatTopY, facadeDimFontSize };
        const leftFacadeParcelLineX = drawParcelLimitFacade(ctx, scale, values, 'left', facadeParcelLimitGeo);
        if (leftFacadeParcelLineX !== null) facadeLabelAnchorX = leftFacadeParcelLineX;
        drawParcelLimitFacade(ctx, scale, values, 'right', facadeParcelLimitGeo);

        drawFacadeOrientationLabel(ctx, values, facadeFlatTopY, facadeLabelAnchorX);

        ctx.restore();

        // Return boundary box for PDF cropping (in meters/drawing units) — élargi pour couvrir tous
        // les groupes de shed dupliqués.
        const marginMeters = 1.0;
        const postMinX = -leftOverhang - postWidth / 2;
        const postMaxX = (nbShedGroupsCount - 1) * groupPitchMeters + facadeLength + rightOverhang + postWidth / 2;
        // + surélévation éventuelle des tables sur un terrain qui monte (cf. calagesGroupes).
        const maxHeight = values.postHeight + roofApparentHeight + 1.0 + Math.max(0, tableLaPlusHauteM);
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
            const projWidthOneSide = ((values.panelWidth / 2) * Math.cos(absRoofSlopeRad)) * scale;
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
            if (el.type === 'number') val = parseFloat(val) || 0;
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
            expression = "";
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
                    if (value < 1 || value > 10) throw new Error(`Entraxe invalide "${value}" : doit être compris entre 1 et 10 m`);
                    for (let i = 0; i < count; i++) distances.push(value);
                } else {
                    const val = parseFloat(seg);
                    if (isNaN(val)) throw new Error(`Valeur non numérique: "${seg}"`);
                    if (val < 1 || val > 10) throw new Error(`Entraxe invalide "${val}" : doit être compris entre 1 et 10 m`);
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
        // Petit champ solaire : pas de rail de système d'intégration (panneaux fixés directement sur pannes).
        let integrationSystemHeight = 0;
        let panelThickness = safeFloat(data.panel_thickness);
        let panelWidth = safeFloat(data.panel_width);
        let panelSpacingY = safeFloat(data.panel_spacing_y);
        let roofSlope = safeFloat(data.roof_slope);
        let overhangSymValue = safeFloat(data.overhang_sym_value);
        let overhangAsymHigh = safeFloat(data.overhang_asym_high);
        let overhangAsymLow = safeFloat(data.overhang_asym_low);
        let postEccentricity = safeFloat(data.post_eccentricity);

        // Logique de porte-à-faux en pourcentage
        const paysageBtn = document.getElementById('panelOrientationPaysage');
        const isPaysage = !!(paysageBtn && paysageBtn.classList.contains('active'));
        const dimAlongRampantMm = isPaysage ? safeFloat(data.petit_panel_width_mm) : safeFloat(data.petit_panel_length_mm);
        const panelUnitLengthM = dimAlongRampantMm / 1000;
        const overhangPercentage = safeFloat(data.overhang_sym_value, 20); // Le champ est maintenant un %
        overhangSymValue = (overhangPercentage / 100) * panelUnitLengthM;

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
        const lowPointThicknessStack = beamHeight + purlinHeight + integrationSystemHeight + panelThickness;
        let passageHeight = lowPointHeightInput - lowPointThicknessStack + overhangL * Math.sin(roofSlope * Math.PI / 180);

        // Correctif "panne faîtière trop courte" : la traverse de chaque bras doit avoir la longueur
        // de la largeur du champ PV + l'espacement entre panneaux - la largeur d'UN porte-à-faux
        // (formule fournie par l'utilisateur), remplaçant l'ancienne (panelWidth/2 - overhang) qui la
        // sous-dimensionnait par rapport aux panneaux réellement dessinés sur chaque bras (cf.
        // drawRoofStructure, qui dessine nbPanelsRampant panneaux PLEINS sur CHAQUE bras, pas la
        // moitié) — la panne la plus proche du poteau (panne faîtière) retombait donc hors traverse.
        let beamLength = (postModel === "y_shape" || postModel === "doubleYShape") ? (panelWidth + (panelSpacingY / 1000) - overhangSymValue) : (panelWidth - overhangH - overhangL);

        let maxEccentricity = (panelWidth / 2) * Math.cos(roofSlope * Math.PI / 180);
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
            // Correctif "panneaux au sol" : pour ce modèle, beamLength est DÉJÀ la longueur d'UN
            // SEUL bras (panelWidth/2 - overhangSymValue, cf. plus haut), pas une traverse pleine
            // longueur centrée sur le poteau comme dans la branche "else" ci-dessous. La chute
            // jusqu'à l'égout (bout du bras) se produit donc sur la longueur COMPLÈTE de beamLength,
            // pas sur sa moitié — utiliser (beamLength / 2) sous-estimait cette chute et plaçait
            // l'égout réel plus bas que prévu (jusqu'à toucher le sol pour les pentes/portées fortes).
            let yLowestBeamPointRel = (beamLength * Math.abs(Math.sin(roofSlopeRadians))) + ((beamHeight / 2) * Math.cos(roofSlopeRadians));
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

        let y1 = (-panelWidth / 2) * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);
        let y2 = (panelWidth / 2) * Math.sin(roofSlopeRadians) + (-beamHeight / 2) * Math.cos(roofSlopeRadians);

        let totalProjectionWidth = (postModel === "y_shape" || postModel === "doubleYShape") ? (panelWidth * Math.cos(Math.abs(roofSlopeRadians))) + postWidth : panelWidth * Math.cos(Math.abs(roofSlopeRadians));
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
            panel_unit_length_m: panelUnitLengthM,
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

        // Calculer automatiquement l'expression d'entraxes à partir de l'entraxe entre poteaux
        const pvLayoutInput = document.getElementById('pvLayout');
        const lengthInput = document.getElementById('petitPanelLengthMm');
        const widthInput = document.getElementById('petitPanelWidthMm');
        const spacingInput = document.getElementById('panelSpacingY');
        const entraxeInput = document.getElementById('facadeEntraxe');
        
        let postDistancesExpr = "";
        if (pvLayoutInput && lengthInput && widthInput && entraxeInput) {
            let rows = NaN, cols = NaN;
            const cleanedLayout = pvLayoutInput.value.toLowerCase().replace(/\s/g, '');
            const layoutParts = cleanedLayout.split('x');
            if (layoutParts.length === 2) {
                const part1 = layoutParts[0]; const part2 = layoutParts[1];
                if (part1.includes('l') && part2.includes('c')) { rows = parseInt(part1); cols = parseInt(part2); }
                else if (part1.includes('c') && part2.includes('l')) { cols = parseInt(part1); rows = parseInt(part2); }
                else { [rows, cols] = layoutParts.map(Number); }
            }
            if (!isNaN(cols) && cols > 0) {
                const paysageBtn = document.getElementById('panelOrientationPaysage');
                const isPaysage = !!(paysageBtn && paysageBtn.classList.contains('active'));
                const dimAlongFacadeMm = isPaysage ? (parseFloat(lengthInput.value) || 0) : (parseFloat(widthInput.value) || 0);
                const spacingM = (parseFloat(spacingInput && spacingInput.value) || 0) / 1000;
                const entraxeM = parseFloat(entraxeInput.value) || 0;
                if (dimAlongFacadeMm > 0 && entraxeM > 0) {
                    const layout = computeFacadePostLayout({
                        cols,
                        panelDimAlongFacadeM: dimAlongFacadeMm / 1000,
                        spacingM,
                        entraxeMaxM: entraxeM,
                    });
                    postDistancesExpr = `${layout.nbEntraxes}*${entraxeM}`;
                }
            }
        }

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
                panel_spacing_y:          values.panelSpacingY,
                roof_slope:               values.roofSlope,
                overhang_sym_value:       values.overhangSymValue,
                overhang_asym_high:       values.overhangAsymHigh,
                overhang_asym_low:        values.overhangAsymLow,
                petit_panel_width_mm:     values.petitPanelWidthMm,
                petit_panel_length_mm:    values.petitPanelLengthMm,
                post_eccentricity:        values.postEccentricity,
                post_width:               values.postWidth,
                post_spacing:             values.postSpacing,
                post_spacing_inclined:    values.postSpacingInclined,
                post_inclination_inclined:values.postInclinationInclined,
                height_under_brace:       values.heightUnderBrace,
                brace_fix_percentage:     values.braceFixPercentage,
                purlin_count:             Number(values.purlinCount) || 0, // champ readonly (verrouillé) : valeur en chaîne, cf. getFormValues()
                facade_length:            values.facadeLength,
                left_overhang:            values.leftOverhang,
                right_overhang:           values.rightOverhang,
                ground_slope_facade:      values.groundSlopeFacade,
                base_altimetry:           values.baseAltimetry,
                post_distances_expr:      postDistancesExpr,
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
            // values.overhangSymValue est un pourcentage (%), pas des mètres : conversion de secours
            // identique à celle de calculateOmbriereMetalLocal (panelUnitLengthM peut ne pas encore
            // être renseigné ici, d'où le recalcul local plutôt qu'une réutilisation directe).
            {
                const _paysageBtn = document.getElementById('panelOrientationPaysage');
                const _isPaysage = !!(_paysageBtn && _paysageBtn.classList.contains('active'));
                const _dimAlongRampantMm = _isPaysage ? (parseFloat(values.petitPanelWidthMm) || 0) : (parseFloat(values.petitPanelLengthMm) || 0);
                const _overhangFallbackM = ((values.overhangSymValue || 0) / 100) * (_dimAlongRampantMm / 1000);
                values.overhangH = _overhangFallbackM;
                values.overhangL = _overhangFallbackM;
            }
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

        values.panelUnitLengthM = _r.panel_unit_length_m;
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
            showFieldViolationModal(violation);
            return;
        }
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

        // Si la façade est masquée, le plan de coupe prend toute la hauteur.
        if (appModal.classList.contains('facade-hidden')) {
            coupeContainer.style.height = '100%';
            coupeContainer.style.flex = '1 1 100%';
            return;
        }

        // Si le plan de coupe est masqué, le plan de façade prend toute la hauteur.
        if (appModal.classList.contains('coupe-hidden')) {
            facadeContainer.style.height = '100%';
            facadeContainer.style.flex = '1 1 100%';
            return;
        }

        // NOUVEAU : Si on est en mode calepinage, on laisse le CSS gérer (100% hauteur)
        // On sort de la fonction pour éviter que le JS n'écrase les styles
        if (appModal.classList.contains('calepinage-full')) {
            coupeContainer.style.height = '100%';
            coupeContainer.style.flex = '1 1 100%';
            return;
        }

        // CORRECTIF (demande explicite : "afficher les plans de coupe et de façade au même endroit
        // lorsqu'on navigue dans le formulaire avec la barre verticale — les plans doivent rester
        // visibles, peu importe l'endroit où l'on est dans le formulaire") : la hauteur des deux plans
        // était calée sur la POSITION des titres "Géométrie" et "Actions" du formulaire, et
        // recalculée à chaque défilement de celui-ci — les plans suivaient donc le formulaire au lieu
        // de rester en place. La colonne des plans occupe désormais toute la hauteur visible
        // (cf. CSS "Plans fixes") et se partage à parts égales ; le formulaire défile seul à côté.
        if (!canvasColumn || !coupeContainer || !facadeContainer) return;
        coupeContainer.style.height = '';
        coupeContainer.style.flex = '1 1 0';
        facadeContainer.style.height = '';
        facadeContainer.style.flex = '1 1 0';
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
    const managers = {
        Coupe: coupeViewManager,
        Facade: facadeViewManager,
        Implantation: implantationViewManager
    };

    // Export DXF (cf. static/js/petit_champ_solaire/dxf_export.js, fichier séparé) : ce fichier
    // tourne dans son propre <script> et n'a donc pas accès aux variables locales de cette
    // closure DOMContentLoaded — seul point d'exposition nécessaire (fonctions de dessin +
    // ViewManagers, pour rejouer drawCoupe/drawFacade avec un faux contexte "enregistreur").
    window.__petitChampSolaireExports = { drawCoupe, drawFacade, coupeViewManager, facadeViewManager, appState };

    let debounceTimeout;
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

    // Terrain automatique (profils IGN/Google du champ PV, cf. geometrie_structure/terrain_plans.js) :
    // chargé depuis la page parente, redessine à son arrivée.
    if (window.TerrainPlans) window.TerrainPlans.demarrer(() => scheduleUpdate());

    // Petit champ solaire : "Largeur champ PV" (panelWidth) est calculée automatiquement — elle dépend du
    // nombre de panneaux en rampant, de la dimension du panneau selon le mode de pose (portrait = longueur,
    // paysage = largeur) et de l'espacement Y entre panneaux : nb * dim + (nb - 1) * espacement.
    function updatePanelWidthFromRampant() {
        const nbInput = document.getElementById('nbPanelsRampant');
        const lengthInput = document.getElementById('petitPanelLengthMm');
        const widthInput = document.getElementById('petitPanelWidthMm');
        const spacingInput = document.getElementById('panelSpacingY');
        const panelWidthInput = document.getElementById('panelWidth');
        if (!nbInput || !lengthInput || !widthInput || !spacingInput || !panelWidthInput) return;

        const nb = parseInt(nbInput.value, 10) || 0;
        if (nb <= 0) return;

        const paysageBtn = document.getElementById('panelOrientationPaysage');
        const isPaysage = !!(paysageBtn && paysageBtn.classList.contains('active'));
        const dimAlongRampantMm = isPaysage ? (parseFloat(widthInput.value) || 0) : (parseFloat(lengthInput.value) || 0);
        const spacingMm = parseFloat(spacingInput.value) || 0;

        const totalWidthM = (nb * dimAlongRampantMm) / 1000 + (nb - 1) * (spacingMm / 1000);
        const formatted = totalWidthM.toFixed(2);
        if (panelWidthInput.value !== formatted) {
            panelWidthInput.value = formatted;
            panelWidthInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    ['nbPanelsRampant', 'petitPanelLengthMm', 'petitPanelWidthMm', 'panelSpacingY'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePanelWidthFromRampant);
    });
    document.querySelectorAll('#panelOrientationGroup button').forEach(btn => {
        btn.addEventListener('click', updatePanelWidthFromRampant);
    });
    updatePanelWidthFromRampant();

    // "Nombre de pannes" (purlinCount) est verrouillé à 2 pannes par panneau en rampant (une à
    // chaque bord du panneau, cf. correctif géométrie dans drawRoofStructure) — champ en lecture
    // seule, resynchronisé à chaque changement de "nbPanelsRampant".
    function updatePurlinCountFromPanels() {
        const nbInput = document.getElementById('nbPanelsRampant');
        const purlinCountInput = document.getElementById('purlinCount');
        if (!nbInput || !purlinCountInput) return;
        const nb = parseInt(nbInput.value, 10) || 0;
        if (nb <= 0) return;
        const formatted = String(2 * nb);
        if (purlinCountInput.value !== formatted) {
            purlinCountInput.value = formatted;
        }
    }
    document.getElementById('nbPanelsRampant').addEventListener('input', updatePurlinCountFromPanels);
    updatePurlinCountFromPanels();

    // Somme des entraxes d'une expression "Entraxes poteaux" (ex: "2*4.925"), utilisée ci-dessous
    // pour déduire les porte-à-faux — best-effort : renvoie 0 sur une expression invalide (la
    // validation stricte/l'affichage d'erreur restent gérés par parsePostDistances lors du dessin).
    function sumPostDistancesExpr(expression) {
        if (!expression || !expression.trim()) return 0;
        try {
            const segments = expression.replace(/,/g, "+").split("+");
            let total = 0;
            for (let seg of segments) {
                seg = seg.trim();
                if (seg === "") continue;
                if (seg.includes("*")) {
                    const parts = seg.split("*");
                    if (parts.length !== 2) return 0;
                    const count = parseInt(parts[0].trim(), 10);
                    const value = parseFloat(parts[1].trim());
                    if (isNaN(count) || isNaN(value)) return 0;
                    total += count * value;
                } else {
                    const val = parseFloat(seg);
                    if (isNaN(val)) return 0;
                    total += val;
                }
            }
            return total;
        } catch (e) { return 0; }
    }

    // Section "Plan de façade" : le nombre de poteaux, l'entraxe (postDistances) et les
    // porte-à-faux gauche/droite ne sont plus saisis manuellement — ils sont recalculés à partir
    // du nombre de panneaux du calepinage (LxC, colonnes "C" = le long de la façade), de leur
    // dimension physique, de l'espacement entre panneaux (Espacement Y.) et de l'entraxe maximum
    // fixe saisi (#facadeEntraxe). Le calcul pur (aucun accès DOM) est isolé dans
    // computeFacadePostLayout() ci-dessous, qui retourne aussi les coordonnées de placement de
    // chaque poteau (postPositionsM, en mètres depuis l'origine de la façade) — utilisable
    // indépendamment du formulaire (tests, futurs générateurs 3D, etc. — exposée sur
    // window.computeFacadePostLayout).
    //
    // Base de calcul :
    //   Longueur totale groupe PV (Ltotale) = C x Largeur_utile_panneau + (C-1) x Espacement
    //   Nombre d'entraxes = floor(Ltotale / Entraxe_max)
    //   Nombre de poteaux = Nombre d'entraxes + 1
    //   Porte-à-faux symétrique = (Ltotale - Nombre d'entraxes x Entraxe_max) / 2
    //   Position du poteau i (0-indexé) = Porte-à-faux + i x Entraxe_max
    //
    // Exemple vérifié (3L x 8C, panneaux 2000x1134mm en portrait, espacement 20mm, entraxe max 2m) :
    //   Ltotale = 8x1.134 + 7x0.02 = 9.212m ; entraxes = floor(9.212/2) = 4 ; poteaux = 5 ;
    //   porte-à-faux = (9.212 - 4x2)/2 = 0.606m.
    function computeFacadePostLayout({ cols, panelDimAlongFacadeM, spacingM, entraxeMaxM }) {
        const EPS = 1e-6;
        if (!(cols > 0) || !(panelDimAlongFacadeM > 0) || !(entraxeMaxM > 0)) {
            return { totalLengthM: 0, nbEntraxes: 0, nbPosts: 0, overhangM: 0, postPositionsM: [] };
        }
        const safeSpacingM = spacingM > 0 ? spacingM : 0;

        // FIX : l'espacement entre panneaux (cols - 1 interstices) était auparavant absent du
        // calcul de la longueur totale — ex: 8 panneaux de 1.134m + espacement 20mm =>
        // 8x1.134 + 7x0.02 (pas seulement 8x1.134).
        const totalLengthM = cols * panelDimAlongFacadeM + Math.max(0, cols - 1) * safeSpacingM;

        const nbEntraxes = Math.max(1, Math.floor((totalLengthM + EPS) / entraxeMaxM));
        const nbPosts = nbEntraxes + 1;

        let overhangM = (totalLengthM - nbEntraxes * entraxeMaxM) / 2;
        if (!isFinite(overhangM) || overhangM < 0) overhangM = 0;

        // Coordonnées de placement : un poteau tous les "entraxeMaxM", à partir du porte-à-faux
        // gauche (poteau 0 à x=overhangM, dernier poteau à x=totalLengthM-overhangM).
        const postPositionsM = Array.from({ length: nbPosts }, (_, i) => overhangM + i * entraxeMaxM);

        return { totalLengthM, nbEntraxes, nbPosts, overhangM, postPositionsM };
    }
    window.computeFacadePostLayout = computeFacadePostLayout;

    function updateOverhangsFromCalepinage() {
        const pvLayoutInput = document.getElementById('pvLayout');
        const leftOverhangInput = document.getElementById('leftOverhang');
        const rightOverhangInput = document.getElementById('rightOverhang');
        const lengthInput = document.getElementById('petitPanelLengthMm');
        const widthInput = document.getElementById('petitPanelWidthMm');
        const spacingInput = document.getElementById('panelSpacingY');
        // FIX: 'postSpacing' (label "Entraxe (m)") est un champ DIFFÉRENT — l'écart entre les 2
        // poteaux d'une même paire pour le modèle Double Poteaux (contraint à rester < largeur
        // projetée d'une ombrière, cf. validation dédiée), pas l'entraxe entre poteaux successifs le
        // long de la façade. On utilise ici le nouveau champ dédié #facadeEntraxe.
        const entraxeInput = document.getElementById('facadeEntraxe');
        const facadeLengthInput = document.getElementById('facadeLength');
        if (!pvLayoutInput || !leftOverhangInput || !rightOverhangInput || !lengthInput || !widthInput || !entraxeInput) return;

        // Même parsing "LxC" que drawFacade (rows = "L", cols = "C") — "C" = nb de panneaux le long
        // de la façade, la dimension qui nous intéresse ici.
        let rows = NaN, cols = NaN;
        const cleanedLayout = pvLayoutInput.value.toLowerCase().replace(/\s/g, '');
        const layoutParts = cleanedLayout.split('x');
        if (layoutParts.length === 2) {
            const part1 = layoutParts[0]; const part2 = layoutParts[1];
            if (part1.includes('l') && part2.includes('c')) { rows = parseInt(part1); cols = parseInt(part2); }
            else if (part1.includes('c') && part2.includes('l')) { cols = parseInt(part1); rows = parseInt(part2); }
            else { [rows, cols] = layoutParts.map(Number); }
        }
        if (isNaN(cols) || cols <= 0) return;

        const paysageBtn = document.getElementById('panelOrientationPaysage');
        const isPaysage = !!(paysageBtn && paysageBtn.classList.contains('active'));
        // Dimension "le long de la façade" = la dimension opposée à "en rampant" (cf.
        // updatePanelWidthFromRampant) : portrait -> largeur panneau, paysage -> longueur panneau.
        const dimAlongFacadeMm = isPaysage ? (parseFloat(lengthInput.value) || 0) : (parseFloat(widthInput.value) || 0);
        if (dimAlongFacadeMm <= 0) return;

        const spacingM = (parseFloat(spacingInput && spacingInput.value) || 0) / 1000;
        const entraxeM = parseFloat(entraxeInput.value) || 0;

        const layout = computeFacadePostLayout({
            cols,
            panelDimAlongFacadeM: dimAlongFacadeMm / 1000,
            spacingM,
            entraxeMaxM: entraxeM,
        });

        if (facadeLengthInput) {
            const calculatedFacadeLength = layout.totalLengthM.toFixed(2);
            if (facadeLengthInput.value !== calculatedFacadeLength) {
                facadeLengthInput.value = calculatedFacadeLength;
            }
            facadeLengthInput.readOnly = true;
        }

        const entraxeSum = entraxeM > 0 ? layout.nbEntraxes * entraxeM : 0;
        let overhang = entraxeM > 0 ? layout.overhangM : (layout.totalLengthM - entraxeSum) / 2;
        if (!isFinite(overhang) || overhang < 0) overhang = 0;
        const formatted = overhang.toFixed(2);

        if (leftOverhangInput.value !== formatted) {
            leftOverhangInput.value = formatted;
            leftOverhangInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        leftOverhangInput.readOnly = true;
        if (rightOverhangInput.value !== formatted) {
            rightOverhangInput.value = formatted;
            rightOverhangInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        rightOverhangInput.readOnly = true;
    }
    ['pvLayout', 'petitPanelLengthMm', 'petitPanelWidthMm', 'panelSpacingY', 'facadeEntraxe'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateOverhangsFromCalepinage);
    });
    document.querySelectorAll('#panelOrientationGroup button').forEach(btn => {
        btn.addEventListener('click', updateOverhangsFromCalepinage);
    });
    updateOverhangsFromCalepinage();

    // Bornes de saisie strictes : rejet catégorique, jamais de correction silencieuse de la saisie de
    // l'utilisateur. getFieldRangeViolation() est appelée par runAllDrawings() AVANT tout dessin (donc à
    // chaque tentative de mise à jour, pas seulement au blur) : si un champ est hors intervalle, aucun
    // dessin n'est effectué et un modal explicatif s'affiche ; le champ garde exactement ce que
    // l'utilisateur a tapé, et reprend le focus (texte sélectionné) une fois le modal fermé. 
    let validationModalOpen = false;

    function showValidationModal(message) {
        return new Promise(resolve => { 
            const overlay = document.getElementById('validation-modal-overlay');
            const msgEl = document.getElementById('validation-modal-message');
            const okBtn = document.getElementById('validation-modal-ok');
            if (!overlay || !msgEl || !okBtn) { resolve(); return; }
            msgEl.textContent = message;
            overlay.classList.add('visible');
            const handler = () => {
                overlay.classList.remove('visible');
                okBtn.removeEventListener('click', handler);
                resolve();
            };
            okBtn.addEventListener('click', handler);
        });
    }

    function showFieldViolationModal(violation) {
        if (validationModalOpen) return;
        validationModalOpen = true;
        showValidationModal(violation.message).then(() => {
            validationModalOpen = false;
            if (violation.el) { violation.el.focus(); violation.el.select(); }
        });
    }

    // NB : "passageHeight" (Hauteur libre de passage) est une valeur CALCULÉE (readonly, dérivée de
    // lowPointHeight et de l'épaisseur de la structure), pas une saisie directe de l'utilisateur — elle
    // est donc volontairement absente de SIMPLE_RANGE_FIELDS : y ajouter une borne bloquante créerait une
    // impasse (l'utilisateur ne peut pas "corriger" une valeur qu'il ne saisit pas directement). Ses
    // bornes 0.2–2 m et sa valeur par défaut 0.8 m sont posées uniquement sur le champ HTML (cf.
    // petit_champ_solaire.html), à titre indicatif.
    const SIMPLE_RANGE_FIELDS = [
        ['lowPointHeight', 0.3, 5, 'Hauteur structure égout (m)'],
        ['overhangSymValue', 0, 49, 'Porte-à-faux (%)'],
        ['overhangAsymHigh', 0, 1, 'Porte-à-faux Haut (m)'],
        ['overhangAsymLow', 0, 1, 'Porte-à-faux Bas (m)'],
        ['postEccentricity', 0, 30, 'Excentrement (m)'],
        // 'rightOverhang' est volontairement absent d'ici : c'est une valeur recalculée dynamiquement
        // (cf. parsePostDistances), validée séparément plus bas sur sa valeur À VENIR plutôt que sur
        // sa valeur encore affichée (voir commentaire dans getFieldRangeViolation).
        ['groundSlopeFacade', -3, 3, 'Dénivelé du terrain (m)'], ['baseAltimetry', 0, 1500, 'Altimétrie au point +0.00m (m)'],
        // FIX (item 3) : mêmes bornes que ci-dessus, pour les champs dédiés au Plan de façade.
        ['facadeGroundSlope', -3, 3, 'Dénivelé du terrain (Plan de façade) (m)'], ['facadeBaseAltimetry', 0, 1500, 'Altimétrie au point +0.00m (Plan de façade) (m)'],
        // NOUVEAU (demande explicite) : 0 est désormais une valeur valide (borne ">= 0" au lieu de
        // "> 0") — 0 désactive intentionnellement le tracé de la ligne de cotation correspondante,
        // cf. drawParcelLimitCoupe/drawParcelLimitFacade (petit_champ_solaire_poteau_utilities.js),
        // déjà gardées par `if (!(limitM > 0)) return null;` — ce comportement est inchangé, seule la
        // possibilité de SAISIR 0 est désormais autorisée ici plutôt que bloquée.
        ['parcelLimitLeftCoupe', 0, 100, 'Limite parcellaire (coupe) (m)'], ['parcelLimitRightCoupe', 0, 100, 'Limite parcellaire (coupe) (m)'], ['parcelLimitLeftFacade', 0, 100, 'Limite parcellaire (façade) (m)'], ['parcelLimitRightFacade', 0, 100, 'Limite parcellaire (façade) (m)'],
        ['heightUnderBrace', 0, 2, 'Hauteur sous renfort (m)'],
    ];
    SIMPLE_RANGE_FIELDS.forEach(([id, min, max]) => {
        const el = document.getElementById(id);
        if (el) { el.min = min; el.max = max; }
    });

    // Correctif ciblé : "linkedPanelsCount"/"doubleYShapePanelsCount" retirés (modèles "Centrés
    // liaisonnés"/"Double toiture Y" supprimés, champs correspondants retirés du HTML).
    const INTEGER_RANGE_FIELDS = [];
    INTEGER_RANGE_FIELDS.forEach(([id, min, max]) => {
        const el = document.getElementById(id);
        if (el) { el.min = min; el.max = max; el.step = 1; }
    });

    // Vérifie tous les champs à bornes strictes ainsi que l'entraxe (dépendant du modèle actif) et
    // renvoie la première violation trouvée ({el, message}), ou null si tout est valide.
    function getFieldRangeViolation() {
        // Bornes communes front/back (limites.json, cf. dossier_plans/iframe/validation_parametres.js) :
        // contrôlées en premier ; la liste locale ci-dessous reste en filet de sécurité.
        const violationLimites = window.PetitChampValidation ? window.PetitChampValidation.premiereViolation() : null;
        if (violationLimites) return violationLimites;
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

    // FIX (item 4) : l'algorithme "5/7.5/10m" ci-dessus (computeOptimalPostLayout/
    // autoFillOptimalEntraxe) est celui des grandes ombrières (ombriere_v2.js) — inadapté au petit
    // champ solaire, dont le nombre de poteaux/porte-à-faux est désormais calculé par
    // updateOverhangsFromCalepinage() à partir du calepinage (LxC) et de l'entraxe fixe
    // #facadeEntraxe (cf. plus bas). Déclenchement sur facadeLength/leftOverhang retiré pour éviter
    // que les deux algorithmes ne s'écrasent mutuellement le champ "Entraxes poteaux".

    // Gestion des boutons d'orientation de la façade
    document.querySelectorAll('.facade-orientation-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.facade-orientation-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            appState.facadeOrientation = e.currentTarget.dataset.orientation;
            scheduleUpdate();
        });
    });
    // FIX (item 3) : orientation dédiée au Plan de coupe (#coupe-orientation-group), indépendante du
    // bloc ci-dessus (Plan de façade).
    document.querySelectorAll('.coupe-orientation-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.coupe-orientation-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            appState.coupeOrientation = e.currentTarget.dataset.orientation;
            scheduleUpdate();
        });
    });

    function initializeToggleButtons() {
        // Bouton pour masquer/afficher la vue façade
        const toggleFacadeBtn = document.getElementById('toggleFacadeViewBtn');
        if (toggleFacadeBtn) {
            toggleFacadeBtn.addEventListener('click', (e) => {
                e.currentTarget.classList.toggle('active');
                document.getElementById('app-modal').classList.toggle('facade-hidden');
                scheduleUpdate();
            });
            // Initialisation de l'état du bouton au chargement
            const isFacadeHidden = document.getElementById('app-modal').classList.contains('facade-hidden');
            toggleFacadeBtn.classList.toggle('active', isFacadeHidden);
        }

        // Bouton pour masquer/afficher la vue coupe
        document.querySelectorAll('#toggleCoupeViewBtn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const appModal = document.getElementById('app-modal');
                appModal.classList.toggle('coupe-hidden');
                const isHidden = appModal.classList.contains('coupe-hidden');
                document.querySelectorAll('#toggleCoupeViewBtn').forEach(b => b.classList.toggle('active', isHidden));

                // Si on cache la coupe, on doit s'assurer que la façade est visible
                if (isHidden && appModal.classList.contains('facade-hidden')) {
                    document.getElementById('toggleFacadeViewBtn').click();
                } else { scheduleUpdate(); }
            });
        });
    }
    // FIX (item 2) : cette fonction n'était jamais appelée — les icônes 👁️/✂️ n'avaient donc aucun
    // gestionnaire de clic (boutons inertes).
    initializeToggleButtons();



    document.getElementById('toolInvertSlope').addEventListener('click', (e) => { appState.invertSlope = !appState.invertSlope; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toolFoundation').addEventListener('click', (e) => { appState.showFoundation = !appState.showFoundation; e.currentTarget.classList.toggle('active'); scheduleUpdate(); });
    document.getElementById('toolToggleDimensions').addEventListener('click', (e) => { appState.showDimensions = !appState.showDimensions; e.currentTarget.classList.toggle('active', appState.showDimensions); scheduleUpdate(); });
    document.getElementById('toolToggleHeightDims').addEventListener('click', (e) => { appState.showHeightHelperDims = !appState.showHeightHelperDims; e.currentTarget.classList.toggle('active', appState.showHeightHelperDims); scheduleUpdate(); });
    document.getElementById('toolToggleAltimetryDims').addEventListener('click', (e) => { appState.showAltimetryDims = !appState.showAltimetryDims; e.currentTarget.classList.toggle('active', appState.showAltimetryDims); scheduleUpdate(); });
    document.getElementById('toolToggleParcelLimitDims').addEventListener('click', (e) => { appState.showParcelLimitDims = !appState.showParcelLimitDims; e.currentTarget.classList.toggle('active', appState.showParcelLimitDims); scheduleUpdate(); });

    // Fondations : système d'ancrage (Béton/Vis/Micropieux) — bascule l'affichage des champs propres
    // à chaque système, comme #overhangSymContainer/#overhangAsymContainer pour le porte-à-faux.
    // Vis et Micropieux partagent les mêmes champs (#foundationVisFields : profondeur + renfort),
    // car tous deux sont toujours enterrés, sans bascule sol/enterré (sauf exception vis+renfort).
    const visPositionContainerEl = document.getElementById('visPositionContainer');
    const micropieuPlateContainerEl = document.getElementById('micropieuPlateContainer');
    // Le toggle "Position (Vis avec renfort)" n'a de sens QUE pour la vis (pas le micropieu), et
    // uniquement quand la case "Avec renfort" est cochée — cf. demande explicite "Option 'VIS avec
    // renfort jambe de force'". La case "Afficher la plaque d'about" n'a de sens QUE pour le micropieu.
    const updateVisMicropieuSubFields = () => {
        if (visPositionContainerEl) visPositionContainerEl.classList.toggle('hidden', !(appState.anchorSystem === 'vis' && appState.visReinforced));
        if (micropieuPlateContainerEl) micropieuPlateContainerEl.classList.toggle('hidden', appState.anchorSystem !== 'micropieu');
    };
    document.getElementById('anchorBeton').addEventListener('click', (e) => {
        appState.anchorSystem = 'beton';
        setupToggleButton(e.currentTarget, document.querySelectorAll('#anchor-system-group button'), document.getElementById('foundationBetonFields'), document.getElementById('foundationVisFields'));
        updateVisMicropieuSubFields();
        scheduleUpdate();
    });
    document.getElementById('anchorVis').addEventListener('click', (e) => {
        appState.anchorSystem = 'vis';
        setupToggleButton(e.currentTarget, document.querySelectorAll('#anchor-system-group button'), document.getElementById('foundationVisFields'), document.getElementById('foundationBetonFields'));
        updateVisMicropieuSubFields();
        scheduleUpdate();
    });
    document.getElementById('anchorMicropieu').addEventListener('click', (e) => {
        appState.anchorSystem = 'micropieu';
        setupToggleButton(e.currentTarget, document.querySelectorAll('#anchor-system-group button'), document.getElementById('foundationVisFields'), document.getElementById('foundationBetonFields'));
        updateVisMicropieuSubFields();
        scheduleUpdate();
    });
    // Bouton "Fondation" : replie/déplie l'ensemble des labels et boutons de configuration des
    // fondations (masqués par défaut pour ne pas surcharger le formulaire).
    const toggleFoundationOptionsBtn = document.getElementById('toggleFoundationOptions');
    if (toggleFoundationOptionsBtn) {
        toggleFoundationOptionsBtn.addEventListener('click', (e) => {
            const wrapper = document.getElementById('foundationOptionsWrapper');
            const nowHidden = wrapper.classList.toggle('hidden');
            e.currentTarget.classList.toggle('active', !nowHidden);
        });
    }
    // Dimensions par défaut selon la configuration béton (item 2) : 1P-Ancrage = plot individuel plus
    // petit (0.8 x 0.5 x 0.3), 2P-Ancrage = longrine de base plus longue (2.0 x 0.5 x 0.3) — sa
    // longueur RÉELLEMENT dessinée reste de toute façon recalculée dynamiquement depuis l'entraxe
    // (cf. computeDPFoundationLength), cette valeur n'est qu'un point de départ affiché/cohérent.
    const FOUNDATION_CONFIG_DEFAULTS = {
        '1p': { length: 0.8, width: 0.5, depth: 0.3 },
        'dp': { length: 2.0, width: 0.5, depth: 0.3 },
    };
    document.querySelectorAll('#foundation-config-group .foundation-config-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.foundationConfig = e.currentTarget.dataset.config;
            setupToggleButton(e.currentTarget, document.querySelectorAll('#foundation-config-group .foundation-config-btn'));
            const defaults = FOUNDATION_CONFIG_DEFAULTS[appState.foundationConfig];
            if (defaults) {
                document.getElementById('foundationLength').value = defaults.length;
                document.getElementById('foundationWidth').value = defaults.width;
                document.getElementById('foundationDepth').value = defaults.depth;
            }
            scheduleUpdate();
        });
    });
    const foundationBuryLevelContainerEl = document.getElementById('foundationBuryLevelContainer');
    document.querySelectorAll('#foundation-position-group .foundation-position-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.foundationPosition = e.currentTarget.dataset.position;
            setupToggleButton(e.currentTarget, document.querySelectorAll('#foundation-position-group .foundation-position-btn'));
            // Champ "Niveau d'ancrage" affiché uniquement en position Enterré(e).
            if (foundationBuryLevelContainerEl) foundationBuryLevelContainerEl.classList.toggle('hidden', appState.foundationPosition !== 'enterre');
            scheduleUpdate();
        });
    });
    document.getElementById('visReinforced').addEventListener('change', (e) => {
        appState.visReinforced = e.target.checked;
        updateVisMicropieuSubFields();
        scheduleUpdate();
    });
    document.querySelectorAll('#vis-position-group .vis-position-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.visPosition = e.currentTarget.dataset.visPosition;
            setupToggleButton(e.currentTarget, document.querySelectorAll('#vis-position-group .vis-position-btn'));
            scheduleUpdate();
        });
    });
    const micropieuShowPlateEl = document.getElementById('micropieuShowPlate');
    if (micropieuShowPlateEl) {
        micropieuShowPlateEl.addEventListener('change', (e) => {
            appState.micropieuShowPlate = e.target.checked;
            scheduleUpdate();
        });
    }
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
    // Activation des variantes de contreventement "Double Poteaux" (bracingV1-V4) : déplacée dans
    // petit_champ_solaire_poteau_Double poteaux_V1_V2.js (bracingV1/V2) et
    // petit_champ_solaire_poteau_Double poteaux_V3_V4 .js (bracingV3/V4).

    document.getElementById('showDoubleBracing').addEventListener('change', e => { appState.showDoubleBracing = e.target.checked; scheduleUpdate(); });
    // FIX: #showExtBracing n'existe pas dans ce template (petit_champ_solaire.html) — un
    // addEventListener sur null faisait planter tout le script au chargement de la page. Gardé au
    // cas où l'élément serait réintroduit plus tard.
    const showExtBracingEl = document.getElementById('showExtBracing');
    if (showExtBracingEl) showExtBracingEl.addEventListener('change', e => { appState.showExtBracing = e.target.checked; scheduleUpdate(); });

    // Correctif ciblé : les boutons "Type de renfort" (#reinforceBracons/#reinforceJarrets) sont
    // supprimés de l'interface — les petits champs solaires sont toujours en bracons par défaut
    // (appState.reinforcementType reste 'bracons', valeur initiale jamais modifiée désormais).
    // Gestionnaires de clic retirés (éléments inexistants, un addEventListener sur null ferait
    // planter le script).

    // Correctif ciblé : le bouton "Porte-à-faux asymétrique" (#overhangAsym) est masqué de
    // l'interface (asym n'est plus atteignable) — son gestionnaire de clic est retiré ; seul
    // "Symétrique" reste utile (mode permanent désormais).
    document.getElementById('overhangSym').addEventListener('click', () => {
        appState.overhangType = 'sym';
        setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        scheduleUpdate();
    });

    const allModelButtons = document.querySelectorAll('#model-btn-group button');
    const allModelControls = [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls')];
    const overhangSymBtn = document.getElementById('overhangSym');
    const overhangAsymBtn = document.getElementById('overhangAsym');

    const setOverhangControlsEnabled = (enabled) => {
        // Le bouton asymétrique est maintenant toujours masqué
        overhangSymBtn.disabled = !enabled; 
        overhangAsymBtn.disabled = !enabled;
    };

    // Les modèles "Toiture Y" / "Double toiture Y" imposent une traverse "Côté" (pas de position "Dessus"
    // possible pour eux) ET une pente inversée (cf. modelYShape). On mémorise la position/l'inversion
    // choisies par l'utilisateur avant d'entrer dans l'un de ces 2 modèles, pour les restaurer telles
    // quelles en revenant sur un autre modèle (au lieu de laisser "Côté"/pente inversée fuiter — bug
    // corrigé : cliquer Toiture Y puis un autre modèle inversait à tort la pente de ce dernier).
    let traversePositionBeforeYShape = null;
    let invertSlopeBeforeYShape = null;
    const restoreTraversePositionIfNeeded = () => {
        if (invertSlopeBeforeYShape !== null) {
            appState.invertSlope = invertSlopeBeforeYShape;
            document.getElementById('toolInvertSlope').classList.toggle('active', invertSlopeBeforeYShape);
            invertSlopeBeforeYShape = null;
        }
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

    // Activation des modèles Centrés/Excentrés/Bipente : déplacée dans des fichiers dédiés
    // (petit_champ_solaire_poteau_{centre,excentres,bipente}.js — chacun un addEventListener
    // indépendant sur son propre bouton), pour permettre de gérer/communiquer sur chaque modèle
    // séparément. Ces fichiers s'appuient sur `window.__petitChampSolaireModelSwitch` (défini
    // ci-dessous) pour accéder aux helpers partagés de cette closure. Le bouton "Double Poteaux"
    // (modelDoublePost) reste ici : son activation ne dépend d'aucune variante V1-V4 de bracing en
    // particulier (cf. petit_champ_solaire_poteau_Double poteaux_V1_V2.js / _V3_V4.js).
    window.__petitChampSolaireModelSwitch = {
        allModelButtons, allModelControls, overhangSymBtn, overhangAsymBtn,
        setOverhangControlsEnabled, heightUnderBraceInput, updateLinkedAndDoubleSharedControls,
        setupToggleButton, scheduleUpdate, adjustCanvasHeights, restoreTraversePositionIfNeeded,
        rememberTraverseBeforeYShape: () => {
            if (appState.postModel !== 'y_shape' && appState.postModel !== 'doubleYShape') {
                traversePositionBeforeYShape = appState.traversePosition;
                invertSlopeBeforeYShape = appState.invertSlope;
            }
        }
    };

    // --- MODÈLE STANDARD : Double Poteaux (Correction du bug de division d'origine) ---
    // NB : conserve volontairement les 2 gestionnaires de clic déjà présents avant cette
    // refactorisation (un ex-forEach partagé avec Centrés/Excentrés, un second dédié) — les deux se
    // déclenchent au clic, comportement pré-existant inchangé.
    document.getElementById('modelDoublePost').addEventListener('click', (e) => {
        restoreTraversePositionIfNeeded();
        appState.postModel = 'double';

        heightUnderBraceInput.value = "0.2";
        heightUnderBraceInput.readOnly = false;
        document.getElementById('shedSpacing').value = "2.50";

        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postSpacing').min = '0.5';
        document.getElementById('postSpacing').value = 3;
        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);

        setOverhangControlsEnabled(true);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });
    document.getElementById('modelDoublePost').addEventListener('click', (e) => {
        appState.postModel = 'double';

        document.getElementById('postEccentricity').value = 0;
        document.getElementById('postSpacing').min = '0.5';
        document.getElementById('postSpacing').value = 3;
        // SUPPRIMÉ : document.getElementById('panelWidth').value = 12.40;
        setOverhangControlsEnabled(true);
        setupToggleButton(e.currentTarget, allModelButtons, document.getElementById('doublePostControls'), [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')]);
        updateLinkedAndDoubleSharedControls();
        scheduleUpdate().then(adjustCanvasHeights);
    });

    // Correctif ciblé : le modèle "Poteaux inclinés" (modelInclinedPost) est supprimé — bouton et
    // contrôles associés retirés du HTML, gestion de clic retirée ici (les éléments n'existent plus,
    // un addEventListener sur null ferait planter le script).

    // Correctif ciblé : les modèles "Centrés liaisonnés" (modelLinkedPost) et "Double toiture Y"
    // (modelDoubleYShape) sont supprimés — boutons et contrôles associés retirés du HTML, gestion
    // de clic retirée ici (les éléments n'existent plus, un addEventListener sur null ferait
    // planter le script).

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

    async function switchTab(groupClass, contentClass, tabButton) {
        const appModal = document.getElementById('app-modal');

        document.querySelectorAll(groupClass).forEach(t => t.classList.remove('active'));
        tabButton.classList.add('active');

        document.querySelectorAll(contentClass).forEach(c => c.classList.add('hidden'));
        const targetView = document.getElementById(tabButton.id.replace('tab', 'view'));
        if (targetView) targetView.classList.remove('hidden');

        // On ne retire les classes que si on clique sur un onglet du groupe principal
        if (groupClass === '.tab-group-1') {
            appModal.classList.remove('form-hidden');
            appModal.classList.remove('calepinage-full');
        }

        await new Promise(resolve => requestAnimationFrame(resolve));
        adjustCanvasHeights();
        await scheduleUpdate();
    }

    document.getElementById('tabCoupe').addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget));
    const tabPlanMasseBtn = document.getElementById('tabPlanMasse');
    if (tabPlanMasseBtn) tabPlanMasseBtn.addEventListener('click', e => switchTab('.tab-group-1', '.tab-content-1', e.currentTarget));
    document.querySelectorAll('.tab-group-2').forEach(tab => tab.addEventListener('click', e => switchTab('.tab-group-2', '.tab-content-2', e.currentTarget)));

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
                targetEl = iframe.contentWindow.document.getElementById('pdf-capture-area') || iframe.contentWindow.document.getElementById('pv-canvas');
            }
            if (!targetEl) {
                targetEl = document.getElementById('pdf-capture-area') || document.getElementById('pv-canvas');
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

            // FIX (item 1, export) : #coupe-container/#facade-block-container restent display:none
            // via CSS (.coupe-hidden/.facade-hidden/.calepinage-full sur #app-modal, cf. boutons
            // 👁️/✂️) même quand leurs enfants .tab-content-1 sont forcés en display:flex ci-dessous —
            // un display:none sur le PARENT masque le canvas quel que soit le style de l'enfant,
            // d'où les plans de coupe "absents" du rapport si ce bouton avait été utilisé avant
            // l'export. Ces classes sont retirées le temps de la capture, puis restaurées.
            const appModalEl = document.getElementById('app-modal');
            const modalHiddenClasses = ['coupe-hidden', 'facade-hidden', 'calepinage-full'].filter(c => appModalEl.classList.contains(c));
            modalHiddenClasses.forEach(c => appModalEl.classList.remove(c));

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
                // FIX (flou export PDF) : 1200x800 restait net sur la grille 4 plans/page mais
                // devenait flou une fois agrandi sur la moitié d'une page A3 (zone "grande échelle"
                // du plan de coupe, page 2) — ~76 DPI effectifs à l'impression. Taille forcée portée
                // à 3600x2400 (x3) : le pipeline de dessin recalcule "scale" à partir de cette
                // taille, donc tout le plan gagne en résolution sans changer la mise en page.
                v.style.width = '3600px';
                v.style.height = '2400px';
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

                const [coupeImg, facadeImg, implantationImg, calepinageImg] = await Promise.all([
                    safeCapture('coupeCanvas'),
                    safeCapture('facadeCanvas'),
                    safeCapture('implantationCanvas'),
                    safeCapture('pv-canvas', true)
                ]);

                const { jsPDF } = window.jspdf;
                const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

                const A3_W = 420; const A3_H = 297; const margin = 15;
                const gridW = (A3_W - 3 * margin) / 2;
                const gridH = (A3_H - 45) / 2;

                doc.setFontSize(20);
                doc.setFont('helvetica', 'bold');
                doc.text("Rapport Ombrière - Plans de conception", A3_W / 2, margin, { align: 'center' });

                const images = [
                    { title: "1. Plan de Coupe", data: coupeImg ? coupeImg.toDataURL('image/png') : null, x: margin, y: 25 },
                    { title: "2. Plan de Façade", data: facadeImg ? facadeImg.toDataURL('image/png') : null, x: margin * 2 + gridW, y: 25 },
                    { title: "3. Plan de Calepinage", data: calepinageImg ? calepinageImg.toDataURL('image/png') : null, x: margin, y: 25 + gridH + 10 },
                    { title: "4. Plan d'Implantation", data: implantationImg ? implantationImg.toDataURL('image/png') : null, x: margin * 2 + gridW, y: 25 + gridH + 10 }
                ];

                images.forEach(img => {
                    doc.setFontSize(14);
                    doc.setFont('helvetica', 'bold');
                    doc.text(img.title, img.x, img.y + 5);
                    doc.setDrawColor(150); doc.setLineWidth(0.5);
                    doc.rect(img.x, img.y, gridW, gridH);

                    if (img.data) {
                        const imgProps = doc.getImageProperties(img.data);
                        const ratio = imgProps.width / imgProps.height;
                        const availW = gridW - 10; const availH = gridH - 15;
                        let finalW = availW; let finalH = availW / ratio;
                        if (finalH > availH) { finalH = availH; finalW = availH * ratio; }
                        const drawX = img.x + (gridW - finalW) / 2;
                        const drawY = img.y + 10 + (availH - finalH) / 2;
                        doc.addImage(img.data, 'PNG', drawX, drawY, finalW, finalH);
                    } else {
                        doc.setFontSize(12); doc.setTextColor(255, 0, 0);
                        doc.text("Plan non disponible", img.x + gridW/2, img.y + gridH/2, { align: 'center' });
                        doc.setTextColor(0, 0, 0);
                    }
                });

                // FIX (item 3, export) : deuxième page dédiée, les 2 plans empilés VERTICALEMENT
                // (l'un au-dessus de l'autre, chacun sur toute la largeur de la page) — plan de coupe
                // à grande échelle en haut, plan de façade en bas. Auparavant côte à côte (corrigé).
                doc.addPage([A3_W, A3_H], 'landscape');
                doc.setFontSize(20);
                doc.setFont('helvetica', 'bold');
                doc.text("Plan de Coupe et Plan de Façade", A3_W / 2, margin, { align: 'center' });

                const zoneX = margin;
                const zoneW = A3_W - 2 * margin;
                const zoneGap = margin;
                const zonesY = 25;
                const zoneH = (A3_H - zonesY - margin - zoneGap) / 2;
                const zones = [
                    { title: "Plan de Coupe", data: coupeImg ? coupeImg.toDataURL('image/png') : null, y: zonesY },
                    { title: "Plan de Façade", data: facadeImg ? facadeImg.toDataURL('image/png') : null, y: zonesY + zoneH + zoneGap }
                ];
                zones.forEach(zone => {
                    doc.setFontSize(14);
                    doc.setFont('helvetica', 'bold');
                    doc.text(zone.title, zoneX, zone.y + 5);
                    doc.setDrawColor(150); doc.setLineWidth(0.5);
                    doc.rect(zoneX, zone.y, zoneW, zoneH);

                    if (zone.data) {
                        const imgProps = doc.getImageProperties(zone.data);
                        const ratio = imgProps.width / imgProps.height;
                        const availW = zoneW - 10; const availH = zoneH - 15;
                        let finalW = availW; let finalH = availW / ratio;
                        if (finalH > availH) { finalH = availH; finalW = availH * ratio; }
                        const drawX = zoneX + (zoneW - finalW) / 2;
                        const drawY = zone.y + 10 + (availH - finalH) / 2;
                        doc.addImage(zone.data, 'PNG', drawX, drawY, finalW, finalH);
                    } else {
                        doc.setFontSize(12); doc.setTextColor(255, 0, 0);
                        doc.text("Plan non disponible", zoneX + zoneW / 2, zone.y + zoneH / 2, { align: 'center' });
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
                // Restaure l'état facade-hidden/coupe-hidden/calepinage-full retiré avant capture.
                modalHiddenClasses.forEach(c => appModalEl.classList.add(c));
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
            // FIX (flou export PDF) : voir commentaire équivalent dans exportPdfBtn ci-dessus.
            v.style.width = '3600px';
            v.style.height = '2400px';
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
                        targetEl = ifr.contentWindow.document.getElementById('pdf-capture-area') || ifr.contentWindow.document.getElementById('pv-canvas');
                    }
                    if (!targetEl) {
                        targetEl = document.getElementById('pdf-capture-area') || document.getElementById('pv-canvas');
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
        // "Position traverse" par défaut sur "Côté" (toolPosTraverseSide) au lieu de "Dessus".
        ['toggleBraceLeft', 'toggleBraceRight', 'toolPosTraverseSide'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('active');
        });

        // FIX (item 4) : remplacé par updateOverhangsFromCalepinage() (calcul basé sur le
        // calepinage LxC + #facadeEntraxe), cf. commentaire plus haut.
        updateOverhangsFromCalepinage();

        // Masquer le bouton de porte-à-faux asymétrique au chargement
        const overhangAsymBtn = document.getElementById('overhangAsym');
        if (overhangAsymBtn) overhangAsymBtn.style.display = 'none';

        document.querySelector('.dim-color-btn[data-color="#0000FF"]').classList.add('active');

        // 2. FORCER LE MODÈLE PAR DÉFAUT (Double Poteaux / V3, fondations Vis affichées)
        // Cela initialise l'appState et corrige les décalages de calcul. Ce handler window.load
        // s'exécute APRÈS tous les addEventListener (contrairement au .click() equivalent posé plus
        // haut dans le bloc DOMContentLoaded "else", exécuté trop tôt) : c'est donc lui qui fixe
        // effectivement l'état par défaut réellement observé au chargement.
        const btnDoublePoteaux = document.getElementById('modelDoublePost');
        if (btnDoublePoteaux) {
            btnDoublePoteaux.click();
            document.getElementById('bracingV3').click();
            document.getElementById('toolFoundation').click();
            document.getElementById('anchorVis').click();
        }

        // 3. Forcer l'onglet Plan de coupe au démarrage (l'onglet Calepinage a été retiré).
        const tabCoupeLoadDefault = document.getElementById('tabCoupe');
        if (tabCoupeLoadDefault) {
            switchTab('.tab-group-1', '.tab-content-1', tabCoupeLoadDefault);
        }

        document.getElementById('overhangSym').click();
        adjustCanvasHeights();

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

    const controlsContainer = document.getElementById('controls-container');
    if (controlsContainer) {
        controlsContainer.addEventListener('scroll', () => {
            adjustCanvasHeights();
        });
    }

    // === SYNCHRONISATION INCLINAISON roofSlope → fenêtre parente (si cette page est elle-même
    // intégrée en iframe ailleurs) — l'iframe de calepinage interne à cette page a été retirée. ===
    (function () {
        const _pvIdMetal = new URLSearchParams(window.location.search).get('pvId');
        const roofSlopeEl = document.getElementById('roofSlope');
        if (roofSlopeEl) {
            roofSlopeEl.addEventListener('input', function () {
                const val = parseFloat(this.value);
                if (!isNaN(val) && window.parent !== window) {
                    window.parent.postMessage({ action: 'updateCalepinageField', fieldName: 'inclinaison', value: val, pvId: _pvIdMetal }, '*');
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
            // FIX (flou export PDF) : voir commentaire équivalent dans exportPdfBtn.
            v.style.width      = '3600px';
            v.style.height     = '2400px';
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
                        const imgData  = canvas.toDataURL('image/png');
                        const imgProps = doc.getImageProperties(imgData);
                        const ratio    = imgProps.width / imgProps.height;
                        const availW   = gridW - 10;
                        const availH   = gridH - 15;
                        let fw = availW, fh = availW / ratio;
                        if (fh > availH) { fh = availH; fw = availH * ratio; }
                        const drawX = x + (gridW - fw) / 2;
                        const drawY = y + 10 + (availH - fh) / 2;
                        doc.addImage(imgData, 'PNG', drawX, drawY, fw, fh);
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