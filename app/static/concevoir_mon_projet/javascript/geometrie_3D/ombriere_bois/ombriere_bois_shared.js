// Helpers partagés par tous les modèles d'ombrière BOIS — port des formules communes de
// static/js/geometrie_ombriere_3D/ombriere_bois/model_simple.js (drawCoupe/calculateOmbriereBoisLocal),
// le moteur 2D "coupe" d'origine. Chargé AVANT les fichiers model_*.js de ce dossier (comme
// model_single_post.js pour les modèles métal, dont on réutilise aussi parsePostDistancesSimple/
// parsePvLayoutSimple, déjà exposés globalement).
//
// Différence de convention clé avec les modèles métal (cf. model_single_post.js) : le bois prend
// en entrée "Hauteur libre de passage (m)" (passageHeight) — PAS la hauteur à l'égout — et EN
// DÉDUIT la hauteur de poteau/traverse, dans le sens inverse de calculateOmbriereMetalLocal.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

/**
 * Calcule la géométrie commune de la traverse/toiture monopente en bois : longueur réelle de la
 * traverse (raccourcie par le porte-à-faux, comme model_single_post.js), et hauteur du CENTRE de
 * la traverse au niveau Z=0 (traverseCenterZ, généralement 0 en porte-à-faux symétrique), déduite
 * de "passageHeight" (l'input principal bois) plutôt que d'une hauteur à l'égout.
 */
function computeWoodMonopenteGeometry(params) {
    const {
        panelWidth, roofSlope, invertSlope = false, beamHeight,
        overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        passageHeight = 2.8
    } = params;

    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);
    const isSymOverhang = overhangType !== 'asym';
    const ohH = isSymOverhang ? overhangSym : overhangF; // côté faîtage (haut)
    const ohL = isSymOverhang ? overhangSym : overhangG; // côté gouttière (bas)
    const beamLength = Math.max(0.2, panelWidth - ohH - ohL);
    // Le pivot de rotation de la traverse reste au centre géométrique du panneau (Z=0) en
    // porte-à-faux symétrique (cas par défaut de tous les modèles bois) ; en asymétrique
    // (simple_travolta), léger décentrage cohérent avec model_single_post.js, non présent tel
    // quel dans le moteur 2D d'origine (qui garde la traverse strictement centrée en Z=0 dans
    // tous les cas) mais qui dégénère vers 0 pour toute valeur symétrique — cf. tête de fichier.
    const traverseEccentricity = (ohL - ohH) / 2;
    const traverseCenterZ = traverseEccentricity * Math.cos(slopeRad);

    // yLowestBeamPointRel : demi-portée projetée + demi-épaisseur traverse (le point le plus bas
    // de la traverse, relatif à son centre) — même formule que calculateOmbriereBoisLocal.
    const yLowestBeamPointRel = (beamLength / 2) * Math.abs(Math.sin(slopeRad)) + (beamHeight / 2) * Math.cos(slopeRad);
    // Centre de la traverse (niveau mondial, à Z=traverseCenterZ) déduit de la hauteur libre de
    // passage (contrairement au modèle métal, qui part de lowPointHeight vers le haut).
    const traverseCenterY = passageHeight + yLowestBeamPointRel;
    const beamTopY = traverseCenterY + beamHeight / 2;

    // Hauteur du dessous de la traverse à une position Z quelconque (monde), pour y poser un
    // poteau (vertical ou incliné) — même usage que beamBottomAt dans les modèles métal.
    const beamBottomAt = (z) => (traverseCenterY - beamHeight / 2) + (z - traverseCenterZ) * Math.tan(slopeRad);

    return { slopeRad, beamLength, traverseCenterZ, traverseCenterY, beamTopY, beamBottomAt };
}

/**
 * Rallonge à appliquer à un poteau (incliné ou vertical) pour que sa face d'extrémité (plate,
 * perpendiculaire à son propre axe) intersecte PLEINEMENT le plan de la traverse par en dessous,
 * pas seulement par un coin — correctif ciblé : avec une longueur qui amène la ligne centrale
 * pile à l'intersection théorique, SEUL le coin le plus proche (dans le sens de la pente)
 * atteignait le plan, le coin opposé restant en retrait (poteau visiblement "à moitié" en contact
 * avec la traverse). En rallongeant de ce même écart, le coin le plus proche touche exactement le
 * plan et le coin le plus éloigné vient légèrement s'encastrer dans l'épaisseur de la traverse :
 * la section entière du poteau intersecte bien la traverse par-dessous. Calcul standard de coupe
 * d'about (charpente) : allowance = (postWidth/2) * tan(phi), où phi est l'angle entre l'axe du
 * poteau et la NORMALE du plan de la traverse (phi=0 => coupe perpendiculaire => aucun rallonge
 * nécessaire ; phi grand => coupe très rasante => rallonge important).
 */
function miterOverlapAllowance(postWidth, dirZ, dirY, slopeRad) {
    // Normale du plan de la traverse (plan Y = f(Z) de pente tan(slopeRad)) dans le plan (Z,Y) :
    // tangente = (cos(slopeRad), sin(slopeRad)), normale = tangente tournée de 90° = (-sin, cos).
    const normalZ = -Math.sin(slopeRad), normalY = Math.cos(slopeRad);
    const tangentZ = Math.cos(slopeRad), tangentY = Math.sin(slopeRad);
    const compNormal = dirZ * normalZ + dirY * normalY;
    const compTangent = dirZ * tangentZ + dirY * tangentY;
    if (Math.abs(compNormal) < 1e-6) return 0;
    return Math.abs(postWidth / 2 * (compTangent / compNormal));
}

/**
 * Poteau incliné : boîte allant du sol (Y=0, Z=baseZ) jusqu'au dessous de la traverse, à
 * "inclinationDeg" degrés par rapport à l'HORIZONTALE (#postInclinationBois) — port de
 * drawInclinedPoleExact (model_simple.js). La longueur est rallongée de miterOverlapAllowance()
 * pour que le poteau intersecte PLEINEMENT la traverse par-dessous, pas seulement par un coin
 * (cf. miterOverlapAllowance). Retourne la hauteur réelle du point de jonction (utile pour les
 * modèles qui y accrochent un bracon), le poteau étant déjà ajouté à la scène.
 *
 * "outward" (port de "forceOutward" dans drawInclinedPoleExact) contrôle le SENS du penchant :
 * - outward=false (défaut) : le poteau penche VERS targetZ (convergent, utilisé par
 *   simple_azelan/simple_travolta, où forceOutward vaut false dans le 2D d'origine).
 * - outward=true : le poteau penche À L'OPPOSÉ de targetZ (divergent — utilisé par
 *   inclinedPost/y_shape/double/offset, où forceOutward vaut true dans le 2D d'origine). Ce
 *   n'est PAS un simple détail cosmétique : avec outward=true, targetZ ne sert plus qu'à
 *   déterminer de quel côté est le poteau (gauche/droite) pour savoir dans quel sens
 *   "s'éloigner" ; le poteau ne rejoint plus targetZ lui-même.
 */
function buildInclinedWoodPost(scene, root, name, x, baseZ, targetZ, geo, postWidth, mat, inclinationDeg = 55, outward = false, showAnchors = false, anchorMat = null) {
    const angleFromHorizontal = (inclinationDeg * Math.PI) / 180;
    const towardSign = targetZ >= baseZ ? 1 : -1;
    const dir = outward ? -towardSign : towardSign;
    // Direction unitaire (monde) : monte de "angleFromHorizontal" au-dessus de l'horizontale, en
    // penchant vers targetZ (ou à l'opposé si outward=true).
    const dirZ = dir * Math.cos(angleFromHorizontal);
    const dirY = Math.sin(angleFromHorizontal);

    // Intersection avec le dessous de la traverse (droite Y = beamBottomAt(Z), pente tan(slopeRad)) :
    // paramétrique Y(t) = t*dirY, Z(t) = baseZ + t*dirZ ; on résout t tel que
    // t*dirY = beamBottomAt(baseZ + t*dirZ) = beamBottomAt(baseZ) + t*dirZ*tan(slopeRad)
    // => t*(dirY - dirZ*tanSlope) = beamBottomAt(baseZ).
    // CORRECTIF (poteaux inclinés trop courts / n'intersectant pas la traverse, tous modèles bois
    // utilisant ce helper) : le numérateur était erronément "beamBottomAt(baseZ) - baseZ*tanSlope"
    // (indépendant de baseZ après simplification, alors que la vraie hauteur de la traverse à
    // l'aplomb de la base du poteau EST beamBottomAt(baseZ) lui-même, sans rien soustraire) — ceci
    // faussait la longueur calculée d'autant plus que |baseZ| est grand, de façon asymétrique
    // entre poteau bas/haut (l'un ressortait trop court, l'autre trop long).
    const tanSlope = Math.tan(geo.slopeRad);
    const rhs = geo.beamBottomAt(baseZ);
    const denom = dirY - dirZ * tanSlope;
    const t = Math.abs(denom) > 1e-6 ? rhs / denom : 0;
    const length = Math.max(0.1, t + miterOverlapAllowance(postWidth, dirZ, dirY, geo.slopeRad));

    const topY = length * dirY;
    const topZ = baseZ + length * dirZ;

    // Ancrage sol optionnel (#showAnchors, obligatoire par défaut pour le bois) : raccourcit le
    // poteau pour que son pied remonte à WOOD_ANCHOR_HEIGHT (le sommet, à la traverse, ne bouge
    // pas), plot posé à l'aplomb du nouveau pied — même principe que
    // applyGroundAnchorInclined (ombriere_metal/model_single_post.js).
    let finalLength = length, baseY = 0, baseZFinal = baseZ;
    if (showAnchors && Math.abs(dirY) > 1e-6) {
        finalLength = Math.max(0.1, length - WOOD_ANCHOR_HEIGHT / dirY);
        baseY = WOOD_ANCHOR_HEIGHT;
        baseZFinal = topZ - finalLength * dirZ;
        buildWoodAnchor(scene, root, `${name}_anchor`, x, baseZFinal, anchorMat);
    }
    const midY = (baseY + topY) / 2;
    const midZ = (baseZFinal + topZ) / 2;

    // rotation.x pour aligner l'axe local "depth" (Z) de la boîte sur (dirZ, dirY) : même
    // dérivation que model_inclined_post.js (modèles métal) — rotation.x = atan2(-dirY, dirZ).
    const post = BABYLON.MeshBuilder.CreateBox(name, {
        width: postWidth, height: postWidth, depth: finalLength
    }, scene);
    post.rotation.x = Math.atan2(-dirY, dirZ);
    post.position.set(x, midY, midZ);
    post.material = mat;
    post.parent = root;

    return { topY, topZ };
}

/**
 * Hauteur d'un poteau VERTICAL (droit) sous le dessous de la traverse à la position Z, rallongée
 * de la même façon que buildInclinedWoodPost (miterOverlapAllowance, avec dirZ=0, dirY=1 pour un
 * poteau vertical) afin qu'il intersecte PLEINEMENT le plan de la traverse par-dessous — à utiliser
 * à la place de "Math.max(0.1, geo.beamBottomAt(z))" pour tout poteau vertical (double/offset/
 * simple_azelan/simple_travolta_2).
 */
function verticalWoodPostHeight(geo, z, postWidth) {
    return Math.max(0.1, geo.beamBottomAt(z) + miterOverlapAllowance(postWidth, 0, 1, geo.slopeRad));
}

// Ancrage sol — ombrière bois, OBLIGATOIRE par défaut (#showAnchors, coché par défaut pour ce type
// de structure, cf. test_3d.html) mais togglable comme dans le 2D d'origine (isAncrageActive,
// model_simple.js) : port du même socle 2 étages — une platine large posée au sol (0.40m x 0.02m)
// surmontée d'un plot plus étroit (0.15m x 0.10m) sur lequel vient le pied du poteau bois, hauteur
// totale 0.12m (cf. getAncragePolys/"+= 0.12" dans model_simple.js).
const WOOD_ANCHOR_HEIGHT = 0.12;

function buildWoodAnchor(scene, root, name, x, z, material) {
    const basePlate = BABYLON.MeshBuilder.CreateBox(`${name}_plate`, {
        width: 0.4, height: 0.02, depth: 0.4
    }, scene);
    basePlate.position.set(x, 0.01, z);
    basePlate.material = material;
    basePlate.parent = root;

    const pedestal = BABYLON.MeshBuilder.CreateBox(`${name}_pedestal`, {
        width: 0.15, height: 0.10, depth: 0.15
    }, scene);
    pedestal.position.set(x, 0.02 + 0.05, z);
    pedestal.material = material;
    pedestal.parent = root;
    return pedestal;
}

/**
 * Ajuste la hauteur/position d'un poteau VERTICAL pour tenir compte de l'ancrage au sol : le
 * sommet ne bouge pas (toujours le dessous de la traverse), le pied remonte de WOOD_ANCHOR_HEIGHT
 * et un ancrage (socle 2 étages) comble l'espace laissé au sol. Retourne {height, baseY} à
 * utiliser pour construire le poteau (position finale = baseY + height/2).
 */
function applyWoodGroundAnchor(scene, root, name, x, z, fullHeight, showAnchors, anchorMat) {
    if (!showAnchors) return { height: fullHeight, baseY: 0 };
    buildWoodAnchor(scene, root, name, x, z, anchorMat);
    return { height: Math.max(0.1, fullHeight - WOOD_ANCHOR_HEIGHT), baseY: WOOD_ANCHOR_HEIGHT };
}

/**
 * Bracon/entretoise oblique pleine entre 2 points (Y,Z) à une position X donnée — port de
 * drawObliqueBar (model_simple.js). N'ajoute rien si les 2 points sont confondus (bracon
 * dégénéré à bracingPosition=100%, comme le moteur 2D d'origine — cf. "if (Math.abs(botY - topY)
 * > 0.01)").
 */
function buildObliqueWoodBrace(scene, root, name, x, y1, z1, y2, z2, thickness, mat) {
    const dz = z2 - z1, dy = y2 - y1;
    const length = Math.sqrt(dz * dz + dy * dy);
    if (length < 0.01) return null;
    const brace = BABYLON.MeshBuilder.CreateBox(name, {
        width: thickness, height: thickness, depth: length
    }, scene);
    brace.rotation.x = -Math.atan2(dy, dz);
    brace.position.set(x, (y1 + y2) / 2, (z1 + z2) / 2);
    brace.material = mat;
    brace.parent = root;
    return brace;
}

/**
 * Traverse + pannes + rails + panneaux d'un modèle monopente bois (une traverse par poteau de
 * façade, pannes/rails/panneaux partagés sur toute la façade) — port de la section "3. Traverse,
 * 4. Pannes, 5. Panneaux" de drawCoupe. Pannes "côté" (purlinsPosition==='side', le réglage par
 * défaut de tous les modèles bois, bouton "Côté" actif) : encastrées dans l'épaisseur de la
 * traverse (posées à sa hauteur d'axe) plutôt qu'empilées par-dessus comme les modèles métal.
 */
function buildWoodRoof(scene, root, params, geo, postPositions, materials) {
    const {
        facadeLength, beamHeight, purlinHeight, purlinWidth = 0.10, purlinCount, panelWidth, roofSlope,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06,
        pvLayout = '7LX40C', hideRails = false, hidePanels = false,
        purlinsPosition = 'side'
    } = params;
    const { slopeRad, beamLength, traverseCenterZ, beamTopY } = geo;
    const { steelMat, panelMat, integrationMat } = materials;

    // Largeur de la traverse (son épaisseur le long de la façade, axe X) alignée sur la largeur
    // de la panne ("purlinHeight", seule dimension de panne disponible dans le formulaire) plutôt
    // que sur "beamWidth" (qui ne sert plus qu'aux pannes elles-mêmes, cf. plus bas) — demande
    // explicite : la traverse doit être aussi large que la panne, pas plus fine.
    postPositions.forEach((x, i) => {
        const traverse = BABYLON.MeshBuilder.CreateBox(`traverseBois_${i}`, {
            width: purlinHeight, height: beamHeight, depth: beamLength
        }, scene);
        traverse.rotation.x = -slopeRad;
        traverse.position.set(x, beamTopY - beamHeight / 2, traverseCenterZ);
        traverse.material = steelMat;
        traverse.parent = root;
    });

    // Pannes : "côté" = encastrées à l'axe de la traverse (purlinLocalY=0, cf. tête de fichier) ;
    // "dessus" = posées par-dessus, comme les modèles métal.
    const purlinAxisY = purlinsPosition === 'top' ? beamTopY + purlinHeight / 2 : beamTopY - beamHeight / 2;
    const purlinHalfSpanZ = (beamLength / 2) * Math.cos(slopeRad);
    const purlinCountSafe = Math.max(2, Math.round(purlinCount));
    for (let i = 0; i < purlinCountSafe; i++) {
        const t = purlinCountSafe === 1 ? 0.5 : i / (purlinCountSafe - 1);
        let z = traverseCenterZ - purlinHalfSpanZ + t * (2 * purlinHalfSpanZ);
        if (i === 0) z = traverseCenterZ - purlinHalfSpanZ + purlinWidth / 2;
        if (i === purlinCountSafe - 1) z = traverseCenterZ + purlinHalfSpanZ - purlinWidth / 2;
        const axisAt = purlinAxisY + (z - traverseCenterZ) * Math.tan(slopeRad);
        const purlin = BABYLON.MeshBuilder.CreateBox(`purlinBois_${i}`, {
            width: facadeLength, height: purlinHeight, depth: purlinWidth
        }, scene);
        purlin.position.set(facadeLength / 2, axisAt, z);
        purlin.material = steelMat;
        purlin.parent = root;
    }

    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02;
    // slopeLength (couverture pleine du panneau, avant raccourcissement par le porte-à-faux) :
    // même formule que model_single_post.js.
    const slopeLength = panelWidth / Math.cos(slopeRad);
    const cellDepth = Math.max(0.01, (slopeLength - cellGap * (pvRows + 1)) / pvRows);
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);
    const cellPitch = cellWidth + cellGap;

    const integrationY0 = purlinsPosition === 'top' ? beamTopY + purlinHeight : Math.max(beamTopY, purlinAxisY + purlinHeight / 2);
    if (!hideRails) {
        for (let c = 0; c <= pvCols; c++) {
            const railX = c * cellPitch + cellGap / 2;
            const rail = BABYLON.MeshBuilder.CreateBox(`integrationRailBois_${c}`, {
                width: integrationSystemWidth, height: integrationSystemHeight, depth: slopeLength
            }, scene);
            rail.rotation.x = -slopeRad;
            rail.position.set(railX, integrationY0 + integrationSystemHeight / 2, traverseCenterZ);
            rail.material = integrationMat;
            rail.parent = root;
        }
    }

    const panelOffsetY = integrationY0 + integrationSystemHeight;
    if (!hidePanels) {
        const panelGroup = new BABYLON.TransformNode('panelGroupBois', scene);
        panelGroup.rotation.x = -slopeRad;
        panelGroup.position.set(facadeLength / 2, panelOffsetY + panelThickness / 2, traverseCenterZ);
        panelGroup.parent = root;
        for (let r = 0; r < pvRows; r++) {
            const cz = -slopeLength / 2 + cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
            for (let c = 0; c < pvCols; c++) {
                const cx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                const cell = BABYLON.MeshBuilder.CreateBox(`pvCellBois_${r}_${c}`, {
                    width: cellWidth, height: panelThickness, depth: cellDepth
                }, scene);
                cell.position.set(cx, 0, cz);
                cell.material = panelMat;
                cell.parent = panelGroup;
            }
        }
    }
}

/**
 * Contreventement longitudinal (le long de la façade, axe X) entre poteaux adjacents — port de
 * la section "1. Dessin des Renforts (Bracons) DERRIÈRE les poteaux" de drawFacade (model_simple.js) :
 * pour chaque paire de poteaux de façade consécutifs, 2 barres obliques en X, chacune partant
 * d'un poteau à "postBracePercent" % de sa hauteur (depuis le HAUT, donc à "(100-postBracePercent)%"
 * depuis le sol) et rejoignant le dessous de la toiture près du poteau opposé, décalé de
 * "purlinBracePercent" % de l'entraxe vers l'intérieur — #postBracePercent "% renfort Long
 * poteau" et #purlinBracePercent "% renfort Long panne" dans ombriere_bois.html.
 *
 * Placé à une profondeur Z donnée (celle d'une "file" de poteaux — #contreventementF1/F2 dans
 * test_3d.html, cf. commentaire dédié dans chaque model_*.js) plutôt qu'au centre géométrique de
 * la traverse : "il faut placer les contreventements longitudinaux en fonction des files de
 * poteaux qui sont sélectionnées".
 *
 * Simplification : le 2D d'origine fait varier la hauteur du toit le long de X selon
 * "groundSlopeFacade"/l'alignement toiture (façade non horizontale) ; nos modèles 3D bois ne
 * portent pas cette inclinaison longitudinale, donc la hauteur de toiture utilisée ici
 * (geo.beamBottomAt(z), le dessous de la traverse à cette profondeur) est CONSTANTE le long de X
 * plutôt qu'interpolée entre les 2 bouts de façade.
 */
function buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, referencePostHeight, materials, z) {
    const { postBracePercent = 0, purlinBracePercent = 0, braceWidth = 0.10 } = params;
    if (!(postBracePercent > 0) || !(purlinBracePercent > 0)) return;
    if (z === undefined) z = geo.traverseCenterZ;

    const attachY = referencePostHeight * ((100 - postBracePercent) / 100);
    const offsetFrac = purlinBracePercent / 100;
    const roofY = geo.beamBottomAt(z);

    for (let i = 0; i < postPositions.length - 1; i++) {
        const x1 = postPositions[i];
        const x2 = postPositions[i + 1];
        const distance = x2 - x1;
        if (!(distance > 0)) continue;
        const offset = distance * offsetFrac;
        const xNearRight = x1 + offset; // point de toiture proche du poteau DROIT, mesuré depuis le poteau GAUCHE
        const xNearLeft = x2 - offset;  // point de toiture proche du poteau GAUCHE, mesuré depuis le poteau DROIT

        buildLongitudinalWoodBrace(scene, root, `facadeBraceA_${z < 0 ? 'F1' : 'F2'}_${i}`, x1, attachY, xNearRight, roofY, z, braceWidth, materials.steelMat);
        buildLongitudinalWoodBrace(scene, root, `facadeBraceB_${z < 0 ? 'F1' : 'F2'}_${i}`, x2, attachY, xNearLeft, roofY, z, braceWidth, materials.steelMat);
    }
}

/**
 * Entretoise oblique pleine dans le plan X-Y (façade), à une profondeur Z fixe — même principe
 * que buildObliqueWoodBrace mais orientée le long de X plutôt que Z (rotation autour de l'axe Z
 * du monde, pas X).
 */
function buildLongitudinalWoodBrace(scene, root, name, x1, y1, x2, y2, z, thickness, mat) {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.01) return null;
    const brace = BABYLON.MeshBuilder.CreateBox(name, {
        width: length, height: thickness, depth: thickness
    }, scene);
    brace.rotation.z = Math.atan2(dy, dx);
    brace.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
    brace.material = mat;
    brace.parent = root;
    return brace;
}

// Palette bois dédiée (#structureColorBois/#integrationColorBois/#panelColorBois dans
// test_3d.html) : la charpente est en bois par défaut (brun), le système d'intégration reste en
// métal gris clair par défaut (comme les modèles métal) mais devient éditable pour ce type de
// structure — demande explicite : "ajouter une nouvelle palette de couleur pour structure bois"
// couvrant charpente/intégration/panneaux séparément.
function makeWoodMaterials(scene, params) {
    const { structureColor = '#A0522D', panelColor = '#1e293b', integrationColor = '#d1d5db' } = params;
    const steelMat = new BABYLON.StandardMaterial('woodMat', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);
    const panelMat = new BABYLON.StandardMaterial('panelMatBois', scene);
    panelMat.diffuseColor = BABYLON.Color3.FromHexString(panelColor);
    const integrationMat = new BABYLON.StandardMaterial('integrationMatBois', scene);
    integrationMat.diffuseColor = BABYLON.Color3.FromHexString(integrationColor);
    // Ancrage sol (plot béton/acier) : même teinte grise pour tous les modèles bois, non
    // personnalisable (élément technique, pas architectural) — cf. buildWoodAnchor.
    const anchorMat = new BABYLON.StandardMaterial('anchorMatBois', scene);
    anchorMat.diffuseColor = new BABYLON.Color3(0.61, 0.64, 0.68);
    return { steelMat, panelMat, integrationMat, anchorMat };
}

if (typeof window !== 'undefined') {
    window.computeWoodMonopenteGeometry = computeWoodMonopenteGeometry;
    window.miterOverlapAllowance = miterOverlapAllowance;
    window.buildInclinedWoodPost = buildInclinedWoodPost;
    window.verticalWoodPostHeight = verticalWoodPostHeight;
    window.buildObliqueWoodBrace = buildObliqueWoodBrace;
    window.buildWoodRoof = buildWoodRoof;
    window.buildLongitudinalFacadeBracing = buildLongitudinalFacadeBracing;
    window.buildLongitudinalWoodBrace = buildLongitudinalWoodBrace;
    window.makeWoodMaterials = makeWoodMaterials;
    window.WOOD_ANCHOR_HEIGHT = WOOD_ANCHOR_HEIGHT;
    window.buildWoodAnchor = buildWoodAnchor;
    window.applyWoodGroundAnchor = applyWoodGroundAnchor;
}
