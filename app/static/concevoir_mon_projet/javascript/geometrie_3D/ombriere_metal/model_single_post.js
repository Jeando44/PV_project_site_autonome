// Générateur paramétrique Babylon.js — modèle "Poteaux centrés" (monopente).
// Déplacé tel quel depuis static/js/shed3d_generator.js (aucun changement de logique) dans le
// cadre de la réorganisation des modèles d'ombrière en un fichier par modèle. Voir
// ombriere_3d_orchestrator.js pour le point d'entrée commun (buildOmbriere3D).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).
//
// Architecture (comme la coupe 2D d'origine) : un POTEAU par entraxe, surmonté d'une TRAVERSE
// individuelle orientée dans le plan Y-Z (perpendiculaire à la façade, montant la pente de
// l'égout au faîtage) — PAS une poutre unique le long de X. Les PANNES, elles, sont horizontales
// le long de X et reposent PAR-DESSUS l'ensemble des traverses, réparties à intervalles réguliers
// en montant la pente (purlinCount pannes). Le champ PV et le système d'intégration reposent
// eux-mêmes sur les pannes.

/**
 * Interprète une disposition du type "7LX40C" (7 Lignes x 40 Colonnes) en {rows, cols}.
 * Retombe sur le repli fourni si le format ne correspond pas.
 */
function parsePvLayoutSimple(str, fallbackRows, fallbackCols) {
    const m = String(str).trim().match(/^(\d+)\s*L\s*[xX]\s*(\d+)\s*C$/i);
    if (!m) return { rows: fallbackRows, cols: fallbackCols };
    return { rows: Math.max(1, parseInt(m[1], 10)), cols: Math.max(1, parseInt(m[2], 10)) };
}

/**
 * Interprète une expression d'entraxes en positions X de poteaux. Syntaxe tolérante :
 *   - séparateur de termes : '+' OU un/des espace(s)  -> "3*10 + 6" == "3*10 6" == "3x10 6"
 *   - multiplicateur : '*' ou 'x'/'X' (espaces autour tolérés) -> "6*5", "6 x 5", "4X6"
 *   - décimales avec '.' ou ',' -> "3*2,5"
 *   - un terme sans multiplicateur = 1 travée de cette longueur -> "6 6 6 7" = 4 travées
 * Exemples : "4*6 7" ou "6 6 6 6 7" -> 5 travées ; "3*10+6" -> 4 travées.
 */
function parsePostDistancesSimple(expr, leftOverhang) {
    const cleaned = String(expr == null ? '' : expr)
        .replace(/\s*([*xX])\s*/g, '$1')   // "6 * 5" -> "6*5"
        .replace(/\s*\+\s*/g, ' ')          // '+' (et ses espaces) -> séparateur espace
        .trim();
    const terms = cleaned.split(/\s+/).filter(Boolean);
    const spacings = [];
    terms.forEach(t => {
        const m = t.match(/^(\d+)[*xX](\d+(?:[.,]\d+)?)$/);
        if (m) {
            const count = parseInt(m[1], 10);
            const val = parseFloat(m[2].replace(',', '.'));
            if (isFinite(val) && val > 0) for (let i = 0; i < count; i++) spacings.push(val);
        } else {
            const val = parseFloat(t.replace(',', '.'));
            if (isFinite(val) && val > 0) spacings.push(val);
        }
    });
    const positions = [leftOverhang];
    let x = leftOverhang;
    spacings.forEach(s => { x += s; positions.push(x); });
    return positions;
}

/**
 * Construit un renfort "jarret" : équerre triangulaire pleine (pas une simple diagonale) reliant
 * un point sur le poteau (p1), un point sous la traverse (p2) et le point exact de jonction
 * poteau/traverse (p3) — port du triangle dessiné dans la branche "else { // Jarrets }" de
 * drawReinforcement (ombriere_v2.js). p1/p2/p3 sont des {y, z} dans le plan Y-Z ; le triangle est
 * extrudé le long de X (thickness) pour former un prisme. Les faces sont dupliquées dans les deux
 * sens (voir tri()) pour rester visibles quelle que soit l'orientation du triangle p1/p2/p3,
 * plutôt que de calculer un sens de rotation correct au cas par cas pour chaque appelant.
 */
function buildJarretGusset(scene, name, p1, p2, p3, xCenter, thickness, material) {
    const halfT = thickness / 2;
    const positions = [
        xCenter - halfT, p1.y, p1.z,
        xCenter - halfT, p2.y, p2.z,
        xCenter - halfT, p3.y, p3.z,
        xCenter + halfT, p1.y, p1.z,
        xCenter + halfT, p2.y, p2.z,
        xCenter + halfT, p3.y, p3.z
    ];
    const tri = (a, b, c) => [a, b, c, a, c, b];
    const indices = [
        ...tri(0, 1, 2), ...tri(3, 5, 4),
        ...tri(0, 3, 4), ...tri(0, 4, 1),
        ...tri(1, 4, 5), ...tri(1, 5, 2),
        ...tri(2, 5, 3), ...tri(2, 3, 0)
    ];
    const mesh = new BABYLON.Mesh(name, scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    vertexData.normals = normals;
    vertexData.applyToMesh(mesh);
    mesh.material = material;
    return mesh;
}

/**
 * Rallonge à appliquer à un poteau ou un bracon (section carrée "width") pour qu'il intersecte
 * PLEINEMENT le plan de la traverse par-dessous, pas seulement par un coin de sa section — sans
 * cela, une face d'about perpendiculaire à l'axe du poteau/bracon ne touche le plan incliné de la
 * traverse que par l'arête la plus proche, l'arête opposée restant visiblement en retrait.
 * Correctif ciblé : même formule que miterOverlapAllowance dans ombriere_bois_shared.js (coupe
 * d'about de charpente : allowance = (width/2) * tan(phi), phi = angle entre l'axe et la NORMALE
 * du plan de la traverse), appliquée ici à l'ombrière métal. dirZ/dirY = direction unitaire (dans
 * le plan Y-Z) de l'élément, du pied vers la traverse.
 */
function metalOverlapAllowance(width, dirZ, dirY, slopeRad) {
    const normalZ = -Math.sin(slopeRad), normalY = Math.cos(slopeRad);
    const tangentZ = Math.cos(slopeRad), tangentY = Math.sin(slopeRad);
    const compNormal = dirZ * normalZ + dirY * normalY;
    const compTangent = dirZ * tangentZ + dirY * tangentY;
    if (Math.abs(compNormal) < 1e-6) return 0;
    return Math.abs(width / 2 * (compTangent / compNormal));
}

/**
 * Rallonge le point d'ancrage (y2,z2) d'un bracon/entretoise sur la traverse (le point (y1,z1) sur
 * le poteau reste inchangé), le long de sa propre direction, en utilisant metalOverlapAllowance —
 * pour que le bracon intersecte pleinement la traverse par-dessous, comme les poteaux.
 */
function extendBraceToTraverse(y1, z1, y2, z2, crossSection, slopeRad) {
    const dz = z2 - z1, dy = y2 - y1;
    const len = Math.hypot(dz, dy);
    if (len < 1e-6) return { y: y2, z: z2 };
    const dirZ = dz / len, dirY = dy / len;
    const overlap = metalOverlapAllowance(crossSection, dirZ, dirY, slopeRad);
    return { y: y2 + dirY * overlap, z: z2 + dirZ * overlap };
}

// Ancrage sol (plot béton) — ombrière métal, OPTIONNEL (#showAnchors, décoché par défaut). Port du
// "massif de fondation" (drawFoundation, ombriere_v2.js) : un plot posé sur le sol, le poteau vient
// par-dessus (raccourci de METAL_ANCHOR_HEIGHT pour garder le même sommet, jonction traverse
// inchangée). Dimensions demandées : 0.50m de haut, 0.70m d'emprise au sol (carrée en 3D — le 2D
// d'origine n'a qu'une seule dimension "largeur" faute d'axe X dans la vue en coupe).
const METAL_ANCHOR_HEIGHT = 0.50;
const METAL_ANCHOR_FOOTPRINT = 0.70;

function buildMetalAnchor(scene, root, name, x, z, material) {
    const anchor = BABYLON.MeshBuilder.CreateBox(name, {
        width: METAL_ANCHOR_FOOTPRINT, height: METAL_ANCHOR_HEIGHT, depth: METAL_ANCHOR_FOOTPRINT
    }, scene);
    anchor.position.set(x, METAL_ANCHOR_HEIGHT / 2, z);
    anchor.material = material;
    anchor.parent = root;
    return anchor;
}

/**
 * Ajuste la hauteur d'un poteau VERTICAL pour tenir compte de l'ancrage au sol : le sommet ne
 * bouge pas (toujours le dessous de la traverse), le pied remonte de METAL_ANCHOR_HEIGHT et un
 * plot béton comble l'espace laissé au sol. Retourne {height, baseY} à utiliser pour construire
 * le poteau (height = hauteur de la boîte, baseY = décalage Y de son pied, position finale =
 * baseY + height/2). N'ajoute le plot que si showAnchors est actif.
 */
function applyGroundAnchorVertical(scene, root, name, x, z, fullHeight, showAnchors, anchorMat) {
    if (!showAnchors) return { height: fullHeight, baseY: 0 };
    buildMetalAnchor(scene, root, name, x, z, anchorMat);
    return { height: Math.max(0.1, fullHeight - METAL_ANCHOR_HEIGHT), baseY: METAL_ANCHOR_HEIGHT };
}

/**
 * Même principe que applyGroundAnchorVertical mais pour un poteau INCLINÉ défini par son point
 * haut (topY,topZ) et sa direction unitaire (dirZ,dirY) : raccourcit la longueur pour que le PIED
 * remonte à Y=METAL_ANCHOR_HEIGHT (le sommet ne bouge pas), et pose le plot à l'aplomb du nouveau
 * pied. Retourne {length, baseY, baseZ} (baseY/baseZ = position du nouveau pied du poteau).
 */
function applyGroundAnchorInclined(scene, root, name, x, topY, topZ, dirZ, dirY, fullLength, showAnchors, anchorMat) {
    if (!showAnchors || Math.abs(dirY) < 1e-6) return { length: fullLength, baseY: 0, baseZ: topZ - fullLength * dirZ };
    const length = Math.max(0.1, fullLength - METAL_ANCHOR_HEIGHT / dirY);
    const baseZ = topZ - length * dirZ;
    buildMetalAnchor(scene, root, name, x, baseZ, anchorMat);
    return { length, baseY: METAL_ANCHOR_HEIGHT, baseZ };
}

/**
 * Construit le mesh 3D d'une ombrière "poteaux centrés" dans la scène Babylon donnée.
 * Retourne le TransformNode racine. L'origine (0,0,0) du root correspond au centre de la
 * façade au niveau du sol (= point qui sera ancré sur la lat/lng côté Google Maps).
 */
function buildSinglePostShed(scene, params) {
    const {
        facadeLength, leftOverhang, rightOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        heightUnderBrace = 2.80, braceWidth = 0.10, braceFixPercentage = 70,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        reinforcementType = 'bracons', showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRoot', scene);
    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);

    // Modèle "poteaux centrés" : lowPointHeight reste la hauteur réelle à l'égout. slopeLength
    // sert de référence pour "Largeur champ PV" (panneaux/rails, cf. plus bas), mais la portée
    // réellement charpentée (pannes/traverse) suit traverseLength, cf. porte-à-faux ci-dessous.
    const slopeLength = panelWidth / Math.cos(slopeRad);

    // Porte-à-faux toiture F(aîtage)/G(outtière) : la TRAVERSE (et le poteau qui la supporte)
    // est plus courte que le plein span et peut être décentrée par rapport au centre du toit
    // (Z=0) — la toiture, elle, reste centrée et couvre toujours "panelWidth" en entier.
    // Symétrique : un seul débord des deux côtés (traverse centrée, comme avant).
    // Asymétrique : débords F et G différents -> excentrement = (G - F) / 2.
    const isSymOverhang = overhangType !== 'asym';
    const ohF = isSymOverhang ? overhangSym : overhangF; // côté faîtage (haut, Z+)
    const ohG = isSymOverhang ? overhangSym : overhangG; // côté gouttière (bas, Z-)
    const traverseLength = Math.max(0.2, slopeLength - ohF - ohG);
    const traverseEccentricity = (ohG - ohF) / 2;
    // traverseEccentricity ci-dessus est une distance MESURÉE LE LONG DE LA PENTE (comme
    // slopeLength/traverseLength). Toute position/écart en coordonnée Z MONDE doit être
    // projetée par cos(pente) — sinon la panne sablière/faîtière déborde de la traverse d'une
    // valeur proche de sa propre demi-épaisseur dès que la pente n'est plus négligeable
    // (c'était le bug : l'excentrement/la demi-portée étaient utilisés tels quels en Z monde).
    const traverseEccentricityZ = traverseEccentricity * Math.cos(slopeRad);

    // Hauteur de traverse/poteau : à l'aplomb du centre de la traverse (Z = traverseEccentricity),
    // pas nécessairement au centre du toit comme avant (cas particulier quand l'excentrement = 0).
    const beamTopY = lowPointHeight + (traverseEccentricity + slopeLength / 2) * Math.sin(slopeRad);
    // Rallongé (metalOverlapAllowance) pour que le poteau intersecte pleinement le dessous de la
    // traverse par-dessous, pas seulement par un coin de sa section — correctif ciblé.
    const postHeight = Math.max(0.1, beamTopY - beamHeight + metalOverlapAllowance(postWidth, 0, 1, slopeRad));

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const makeMat = (name, r, g, b) => {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.diffuseColor = new BABYLON.Color3(r, g, b);
        return m;
    };
    const steelMat = new BABYLON.StandardMaterial('steelMat', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);
    const panelMat = new BABYLON.StandardMaterial('panelMat', scene);
    panelMat.diffuseColor = BABYLON.Color3.FromHexString(panelColor);
    const integrationMat = makeMat('integrationMat', 0.82, 0.84, 0.86);
    const anchorMat = makeMat('anchorMat', 0.61, 0.64, 0.68);

    // Poteaux : un par entraxe, jusqu'au dessous de leur traverse respective. Centrés sur l'axe
    // Z de la traverse (traverseEccentricity), pas nécessairement Z=0 en porte-à-faux asymétrique.
    // Ancrage sol optionnel (#showAnchors) : raccourcit le poteau de METAL_ANCHOR_HEIGHT et pose un
    // plot béton sous son pied, sans changer la jonction avec la traverse.
    postPositions.forEach((x, i) => {
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `anchor_${i}`, x, traverseEccentricityZ, postHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`post_${i}`, {
            width: postWidth, depth: postWidth, height: h
        }, scene);
        post.position.set(x, baseY + h / 2, traverseEccentricityZ);
        post.material = steelMat;
        post.parent = root;
    });

    // Traverses : une par poteau (pas une poutre unique), dans le plan Y-Z. Longueur et
    // centrage déterminés par le porte-à-faux F/G (traverseLength, traverseEccentricity) —
    // la toiture (pannes/panneaux), elle, continue de couvrir tout "panelWidth".
    postPositions.forEach((x, i) => {
        const traverse = BABYLON.MeshBuilder.CreateBox(`traverse_${i}`, {
            width: beamWidth, height: beamHeight, depth: traverseLength
        }, scene);
        traverse.rotation.x = -slopeRad;
        traverse.position.set(x, beamTopY - beamHeight / 2, traverseEccentricityZ);
        traverse.material = steelMat;
        traverse.parent = root;
    });

    // Bracons : renfort diagonal de part et d'autre de chaque poteau, d'une prise à hauteur
    // "heightUnderBrace" sur le poteau jusqu'à un point d'ancrage SOUS la traverse de ce même
    // poteau (intersection par le dessous), à braceFixPercentage % de la demi-portée DE LA
    // TRAVERSE (plus courte que le champ PV en cas de porte-à-faux) — la prise et l'ancrage
    // sont mesurés à partir du centre réel du poteau/traverse (traverseEccentricity), pas Z=0.
    // Plan Y-Z, comme la traverse : un bracon vers l'égout (Z-), un vers le faîtage (Z+).
    // La prise sur le poteau est recalée automatiquement si "heightUnderBrace" est saisi trop haut
    // (>= hauteur du poteau) : les bracons doivent toujours rester visibles, jamais disparaître
    // silencieusement à cause d'une valeur de champ incohérente.
    const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
    if (effectiveHeightUnderBrace > 0.05) {
        const reachZ = (traverseLength / 2) * (braceFixPercentage / 100) * Math.cos(slopeRad); // projection Z monde
        // Hauteur du dessous de la traverse à un décalage donné (delta, en Z monde) par rapport à son centre.
        const beamBottomAt = (delta) => (beamTopY - beamHeight) + delta * Math.tan(slopeRad);
        const addBraceYZ = (x, y1, z1, y2, z2, name) => {
            // Rallonge le point d'ancrage sur la traverse (y2,z2) pour une intersection pleine,
            // pas juste un coin — correctif ciblé "y compris les bracons".
            const ext = extendBraceToTraverse(y1, z1, y2, z2, braceWidth, slopeRad);
            const dz = ext.z - z1, dy = ext.y - y1;
            const length = Math.sqrt(dz * dz + dy * dy);
            if (length < 1e-6) return;
            const brace = BABYLON.MeshBuilder.CreateBox(name, {
                width: braceWidth, height: braceWidth, depth: length
            }, scene);
            brace.rotation.x = -Math.atan2(dy, dz);
            brace.position.set(x, (y1 + ext.y) / 2, (z1 + ext.z) / 2);
            brace.material = steelMat;
            brace.parent = root;
        };
        // Jarret : équerre triangulaire pleine à l'angle poteau/traverse (pas une diagonale
        // depuis "heightUnderBrace") — port de la branche "else { // Jarrets }" de
        // drawReinforcement (ombriere_v2.js). Le point sur la traverse (p2) reste le même que
        // pour un bracon (reachZ/braceFixPercentage) ; seul le côté poteau change (p1/p3, au
        // plus près de la jonction réelle poteau/traverse, pas à heightUnderBrace).
        const jarretHeight = 0.35;
        const addJarret = (x, postZEdge, outerZ, name) => {
            const postY = beamBottomAt(postZEdge - traverseEccentricityZ);
            const outerY = beamBottomAt(outerZ - traverseEccentricityZ);
            const p1 = { y: postY - jarretHeight, z: postZEdge };
            const p2 = { y: outerY, z: outerZ };
            const p3 = { y: postY, z: postZEdge };
            const gusset = buildJarretGusset(scene, name, p1, p2, p3, x, braceWidth, steelMat);
            gusset.parent = root;
        };
        postPositions.forEach((x, i) => {
            const postZLow = traverseEccentricityZ - postWidth / 2;
            const postZHigh = traverseEccentricityZ + postWidth / 2;
            const outerZLow = traverseEccentricityZ - reachZ;
            const outerZHigh = traverseEccentricityZ + reachZ;
            if (reinforcementType === 'jarrets') {
                addJarret(x, postZLow, outerZLow, `jarret_${i}_low`);
                addJarret(x, postZHigh, outerZHigh, `jarret_${i}_high`);
            } else {
                addBraceYZ(x, effectiveHeightUnderBrace, postZLow, beamBottomAt(-reachZ), outerZLow, `brace_${i}_low`);
                addBraceYZ(x, effectiveHeightUnderBrace, postZHigh, beamBottomAt(reachZ), outerZHigh, `brace_${i}_high`);
            }
        });
    }

    // Pannes : horizontales le long de X, posées PAR-DESSUS l'ensemble des traverses, réparties
    // à intervalles réguliers en montant la pente (purlinCount pannes). Calées sur la portée
    // RÉELLEMENT charpentée par la traverse (traverseLength, centrée sur traverseEccentricity),
    // pas sur la largeur nominale du champ PV — le porte-à-faux raccourcit/décentre la panne
    // sablière et la panne faîtière tout autant que la traverse elle-même.
    // La panne sablière (bas, i=0) et la panne faîtière (haut, dernière) sont recalées d'une
    // demi-épaisseur vers l'intérieur pour ne pas dépasser l'extrémité de la traverse.
    const purlinCountSafe = Math.max(2, Math.round(purlinCount));
    // purlinHalfSpan est le long de la pente (comme traverseLength) ; projeté en Z monde ici
    // (voir traverseEccentricityZ ci-dessus) pour que la panne sablière/faîtière affleure
    // vraiment l'extrémité de la traverse au lieu d'en déborder (l'erreur, avant projection,
    // grandit avec la pente : elle vaut purlinHalfSpan*(1-cos(pente)), du même ordre de
    // grandeur que la demi-épaisseur d'une panne dès que la pente n'est plus négligeable).
    const purlinHalfSpanZ = (traverseLength / 2) * Math.cos(slopeRad);
    for (let i = 0; i < purlinCountSafe; i++) {
        const t = purlinCountSafe === 1 ? 0.5 : i / (purlinCountSafe - 1);
        let z = traverseEccentricityZ - purlinHalfSpanZ + t * (2 * purlinHalfSpanZ);
        if (i === 0) z = traverseEccentricityZ - purlinHalfSpanZ + beamWidth / 2;
        if (i === purlinCountSafe - 1) z = traverseEccentricityZ + purlinHalfSpanZ - beamWidth / 2;
        const traverseTopAt = beamTopY + (z - traverseEccentricityZ) * Math.tan(slopeRad);
        const purlin = BABYLON.MeshBuilder.CreateBox(`purlin_${i}`, {
            width: facadeLength, height: purlinHeight, depth: beamWidth
        }, scene);
        purlin.position.set(facadeLength / 2, traverseTopAt + purlinHeight / 2, z);
        purlin.material = steelMat;
        purlin.parent = root;
    }

    // Disposition de la grille de panneaux (calculée ici car les rails du système d'intégration,
    // ci-dessous, doivent s'aligner sur les colonnes de panneaux).
    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02; // joint esthétique entre panneaux (2 cm), non paramétrable dans ce PoC
    const cellDepth = Math.max(0.01, (slopeLength - cellGap * (pvRows + 1)) / pvRows);
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);
    const cellPitch = cellWidth + cellGap;

    // Système d'intégration : des RAILS (pas une dalle continue), dans le sens de la pente,
    // par-dessus les pannes. Un rail entre chaque paire de panneaux adjacents (partagé par les
    // deux), et un seul rail à chaque extrémité de rive (pvCols + 1 rails au total).
    const integrationY0 = beamTopY + purlinHeight;
    if (!hideRails) {
        for (let c = 0; c <= pvCols; c++) {
            // Position le long de X (repère "root", avant le recentrage final) : centre du joint
            // entre panneaux c-1 et c (ou de la marge de rive pour c=0 et c=pvCols).
            const railX = c * cellPitch + cellGap / 2;
            const rail = BABYLON.MeshBuilder.CreateBox(`integrationRail_${c}`, {
                width: integrationSystemWidth, height: integrationSystemHeight, depth: slopeLength
            }, scene);
            rail.rotation.x = -slopeRad;
            rail.position.set(railX, integrationY0 + integrationSystemHeight / 2, 0);
            rail.material = integrationMat;
            rail.parent = root;
        }
    }

    // Champ PV : grille de panneaux individuels (ex "7LX40C" = 7 lignes le long de la pente x 40
    // colonnes le long de la façade), par-dessus le système d'intégration. Un TransformNode porte
    // la position/inclinaison commune ; chaque cellule n'a que sa position locale (pas de pente
    // à recalculer par cellule).
    const panelOffsetY = integrationY0 + integrationSystemHeight;
    const panelGroup = new BABYLON.TransformNode('panelGroup', scene);
    panelGroup.rotation.x = -slopeRad;
    panelGroup.position.set(facadeLength / 2, panelOffsetY + panelThickness / 2, 0);
    panelGroup.parent = root;

    if (!hidePanels) {
        for (let r = 0; r < pvRows; r++) {
            const cz = -slopeLength / 2 + cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
            for (let c = 0; c < pvCols; c++) {
                const cx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                const cell = BABYLON.MeshBuilder.CreateBox(`pvCell_${r}_${c}`, {
                    width: cellWidth, height: panelThickness, depth: cellDepth
                }, scene);
                cell.position.set(cx, 0, cz);
                cell.material = panelMat;
                cell.parent = panelGroup;
            }
        }
    }

    root.position.x -= facadeLength / 2;
    // Métadonnées de diagnostic (pas de rendu) : permet de vérifier depuis l'appelant que les
    // champs du formulaire sont bien pris en compte, sans changer la signature de la fonction.
    root.shedStats = { postPositions, beamTopY, postHeight, facadeLength, slopeLength };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildSinglePostShed = buildSinglePostShed;
    window.parsePostDistancesSimple = parsePostDistancesSimple;
    window.parsePvLayoutSimple = parsePvLayoutSimple;
    window.buildJarretGusset = buildJarretGusset;
    window.metalOverlapAllowance = metalOverlapAllowance;
    window.extendBraceToTraverse = extendBraceToTraverse;
    window.buildMetalAnchor = buildMetalAnchor;
    window.applyGroundAnchorVertical = applyGroundAnchorVertical;
    window.applyGroundAnchorInclined = applyGroundAnchorInclined;
}
