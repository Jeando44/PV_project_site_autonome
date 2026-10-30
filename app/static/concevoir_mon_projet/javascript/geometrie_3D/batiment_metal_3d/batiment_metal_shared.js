// Helpers partagés par tous les modèles de bâtiment métal 3D — port de la logique de
// static/js/geometrie_ombriere_3D/batiement_metal/batiment_metal.js (calculateBuildingGeometryLocal,
// 100% client-side, aucun appel serveur), vers Babylon.js. Chargé AVANT les fichiers model_*.js de
// ce dossier. Réutilise parsePostDistancesSimple/parsePvLayoutSimple/buildJarretGusset, déjà exposés
// globalement par ombriere_metal/model_single_post.js (chargé avant dans test_3d.html) — pas de
// duplication.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = largeur du
// bâtiment (perpendiculaire à la façade) — Z correspond exactement à "postsX"/"widthRoof" dans le
// moteur 2D d'origine (qui dessine une COUPE, donc un plan Y-Z, pas X-Y).
//
// Convention de hauteur : contrairement au 2D (canvas, y négatif vers le haut, cf. "bCY"), tout est
// ici exprimé en hauteur réelle positive (Y-up). "lowPointHeight" désigne la hauteur structurelle
// (dessous de traverse) au(x) point(s) bas du profil de toiture — mêmes noms de champs que le 2D,
// mêmes formules de portée/pente, mais sans l'artefact de signe du canvas.

/**
 * Calcule le profil de toiture (polyligne Y-Z) et les positions de poteaux across la largeur du
 * bâtiment, pour l'une des 4 formes ('bipente' | 'monopente' | 'asymetrique' | 'multipente').
 * Port direct des branches "if (postModel === ...)" de calculateBuildingGeometryLocal (largeur/
 * pente/rise), lignes 1050-1083 et 1132-1149 de batiment_metal.js.
 */
function computeBatimentTraversePoints(params) {
    const {
        postModel = 'bipente', widthRoof = 15, postCount = 2, roofSlope = 8, invertSlope = false,
        asymmetryPct = 30, inclination1 = 15, inclination2 = 10,
        hauteurBatimentEgout = 5.0, bacAcierWaveHeight = 0.045, purlinHeight = 0.3, beamHeight = 0.15
    } = params;

    // Épaisseur totale de la couverture : traverse + panne + bac acier (remplace le système
    // d'intégration des ombrières, cf. buildBatimentMetal3DCommon) — l'épaisseur du bac acier
    // (0.75mm) est négligeable ici, c'est la hauteur d'onde qui compte pour l'épaisseur apparente.
    const totalRoofThickness = 0.05 + bacAcierWaveHeight + purlinHeight + beamHeight;
    const lowPointHeight = Math.max(0.1, hauteurBatimentEgout - totalRoofThickness);
    const slopeRad = (roofSlope * Math.PI) / 180;

    const pCount = Math.max(2, Math.round(postCount));
    const postsZ = [];
    const pSpacing = widthRoof / (pCount - 1);
    for (let i = 0; i < pCount; i++) postsZ.push(-widthRoof / 2 + i * pSpacing);

    let traversePoints;
    if (postModel === 'monopente') {
        const rise = widthRoof * Math.tan(slopeRad);
        traversePoints = invertSlope
            ? [{ z: postsZ[0], y: lowPointHeight + rise }, { z: postsZ[postsZ.length - 1], y: lowPointHeight }]
            : [{ z: postsZ[0], y: lowPointHeight }, { z: postsZ[postsZ.length - 1], y: lowPointHeight + rise }];
    } else if (postModel === 'asymetrique') {
        const inc1Rad = (inclination1 * Math.PI) / 180, inc2Rad = (inclination2 * Math.PI) / 180;
        const w1 = widthRoof * (asymmetryPct / 100), w2 = widthRoof * (1 - asymmetryPct / 100);
        const h1 = w1 * Math.tan(inc1Rad), h2 = w2 * Math.tan(inc2Rad);
        const maxH = Math.max(h1, h2);
        const ridgeZ = postsZ[0] + w1;
        traversePoints = [
            { z: postsZ[0], y: lowPointHeight - (maxH - h1) },
            { z: ridgeZ, y: lowPointHeight + maxH },
            { z: postsZ[postsZ.length - 1], y: lowPointHeight - (maxH - h2) }
        ];
    } else if (postModel === 'multipente') {
        const rise = pCount > 1 ? ((widthRoof / (pCount - 1)) / 2) * Math.tan(slopeRad) : 0;
        traversePoints = [{ z: postsZ[0], y: lowPointHeight }];
        for (let i = 0; i < postsZ.length - 1; i++) {
            traversePoints.push({ z: (postsZ[i] + postsZ[i + 1]) / 2, y: lowPointHeight + rise });
            traversePoints.push({ z: postsZ[i + 1], y: lowPointHeight });
        }
    } else { // bipente (défaut)
        const rise = (widthRoof / 2) * Math.tan(slopeRad);
        traversePoints = [
            { z: postsZ[0], y: lowPointHeight },
            { z: 0, y: lowPointHeight + rise },
            { z: postsZ[postsZ.length - 1], y: lowPointHeight }
        ];
    }

    return { postsZ, traversePoints, lowPointHeight, slopeRad };
}

/** Interpole la hauteur Y du profil de toiture (traversePoints) à une position Z donnée (clampée
 * aux extrémités si Z est hors bornes). Généralise la boucle d'interpolation de postTops du 2D
 * (lignes 1157-1167), valable pour les 4 formes puisque traversePoints passe exactement par
 * lowPointHeight à chaque poteau pour le multipente (donc pas de cas particulier nécessaire ici). */
function traverseYAt(traversePoints, z) {
    for (let i = 0; i < traversePoints.length - 1; i++) {
        const p1 = traversePoints[i], p2 = traversePoints[i + 1];
        const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
        if (z >= zMin - 1e-6 && z <= zMax + 1e-6) {
            if (Math.abs(p2.z - p1.z) < 1e-9) return p1.y;
            const t = (z - p1.z) / (p2.z - p1.z);
            return p1.y + t * (p2.y - p1.y);
        }
    }
    return z < traversePoints[0].z ? traversePoints[0].y : traversePoints[traversePoints.length - 1].y;
}

/**
 * Rallonge les 2 extrémités de traversePoints de "overhang" mètres (porte-à-faux toiture), en
 * extrapolant chaque segment d'extrémité selon sa PROPRE pente (pas une simple translation en Z) —
 * la couverture (traverse, pannes, bac acier, panneaux) déborde ainsi légèrement au-delà des
 * poteaux, qui eux restent construits sur postsZ (inchangé). N'affecte pas postsZ : les poteaux ne
 * bougent pas, seule la toiture s'allonge pour les couvrir.
 */
function extendTraversePointsForOverhang(traversePoints, overhang) {
    if (!(overhang > 0) || traversePoints.length < 2) return traversePoints;
    const extended = traversePoints.map(p => ({ z: p.z, y: p.y }));

    const first = extended[0], second = extended[1];
    const dz0 = second.z - first.z, dy0 = second.y - first.y;
    const len0 = Math.hypot(dz0, dy0);
    if (len0 > 1e-6) {
        const t = overhang / len0;
        extended[0] = { z: first.z - dz0 * t, y: first.y - dy0 * t };
    }

    const lastIdx = extended.length - 1;
    const last = extended[lastIdx], prev = extended[lastIdx - 1];
    const dz1 = last.z - prev.z, dy1 = last.y - prev.y;
    const len1 = Math.hypot(dz1, dy1);
    if (len1 > 1e-6) {
        const t = overhang / len1;
        extended[lastIdx] = { z: last.z + dz1 * t, y: last.y + dy1 * t };
    }
    return extended;
}

/**
 * Construit un poteau dont la tête est coupée à l'angle de la pente locale du toit (pas un
 * simple parallélépipède à sommet plat) : la face du dessus est un plan incliné joignant
 * exactement le dessous de la traverse aux 2 bords Z du poteau (yAtZLow/yAtZHigh, cf. appelant) —
 * mêmes principes qu'un jarret/onglet charpente, ici appliqués à la section pleine du poteau.
 * Prisme à 8 sommets (section trapézoïdale dans le plan Y-Z, extrudée selon X) ; double-winding
 * (cf. tri()) comme buildJarretGusset pour rester visible quel que soit le sens de la pente.
 */
function buildAngledTopPost(scene, name, x, z, sectionWidth, sectionHeight, yAtZLow, yAtZHigh, material) {
    const halfW = sectionWidth / 2, halfH = sectionHeight / 2;
    const xA = x - halfW, xB = x + halfW;
    const zLow = z - halfH, zHigh = z + halfH;
    // Section (Y-Z) : bas-bas(zLow), haut-bas(zLow), haut-haut(zHigh), bas-haut(zHigh).
    const positions = [
        xA, 0, zLow, xA, yAtZLow, zLow, xA, yAtZHigh, zHigh, xA, 0, zHigh,
        xB, 0, zLow, xB, yAtZLow, zLow, xB, yAtZHigh, zHigh, xB, 0, zHigh
    ];
    const tri = (a, b, c) => [a, b, c, a, c, b];
    const indices = [
        ...tri(0, 1, 2), ...tri(0, 2, 3),   // face x=xA
        ...tri(4, 6, 5), ...tri(4, 7, 6),   // face x=xB
        ...tri(0, 4, 5), ...tri(0, 5, 1),   // dessous (y=0)
        ...tri(1, 5, 6), ...tri(1, 6, 2),   // dessus incliné (suit la pente)
        ...tri(2, 6, 7), ...tri(2, 7, 3),   // côté zHigh
        ...tri(3, 7, 4), ...tri(3, 4, 0)    // côté zLow
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

/** Indices (dans traversePoints) des points de FAÎTAGE (sommets de pente, pas les points bas
 * d'appui des poteaux) — utilisés par buildFaitageSheets. Bipente/Asymétrique : le point médian
 * (index 1, un seul faîtage même si les 2 pentes diffèrent). Multipente : un sommet entre chaque
 * paire de poteaux adjacents (indices impairs). Monopente : aucun (pente unique, pas de faîtage). */
function getRidgeIndices(postModel, traversePoints) {
    if (postModel === 'bipente' || postModel === 'asymetrique') return [1];
    if (postModel === 'multipente') {
        const idx = [];
        for (let i = 1; i < traversePoints.length - 1; i += 2) idx.push(i);
        return idx;
    }
    return [];
}

/**
 * Tôle faîtage : capote chaque ligne de faîtage (bipente/multipente) sur faitageGauche/Droite
 * mètres de part et d'autre du point de faîtage, le long de la pente de chaque versant adjacent —
 * posée juste au-dessus de la couverture (panneaux si visibles, sinon bac acier), pleine longueur
 * de façade, même convention d'orientation que les pannes/bac acier (rotation.x = -angle).
 */
function buildFaitageSheets(scene, root, params, traversePoints, materials) {
    const {
        postModel = 'bipente', facadeLength, faitageGauche = 0.25, faitageDroite = 0.25,
        beamHeight = 0.15, purlinHeight = 0.3, bacAcierWaveHeight = 0.045, panelThickness = 0.03,
        hidePanels = false
    } = params;
    if (postModel !== 'bipente' && postModel !== 'multipente' && postModel !== 'asymetrique') return;
    const ridgeIndices = getRidgeIndices(postModel, traversePoints);
    if (!ridgeIndices.length) return;

    const coverTopOffset = beamHeight / 2 + purlinHeight + bacAcierWaveHeight + (hidePanels ? 0 : panelThickness);
    const faitageThickness = 0.03;

    ridgeIndices.forEach(ridgeIdx => {
        const ridge = traversePoints[ridgeIdx];
        const prev = traversePoints[ridgeIdx - 1];
        const next = traversePoints[ridgeIdx + 1];

        const addCapSheet = (name, neighbor, span) => {
            if (!(span > 0)) return;
            const dz = neighbor.z - ridge.z, dy = neighbor.y - ridge.y;
            const segLen = Math.hypot(dz, dy);
            if (segLen < 1e-6) return;
            const angle = Math.atan2(dy, dz);
            const uz = dz / segLen, uy = dy / segLen;
            const dist = Math.min(span, segLen) / 2;
            const sheet = BABYLON.MeshBuilder.CreateBox(name, {
                width: facadeLength, height: faitageThickness, depth: Math.min(span, segLen)
            }, scene);
            sheet.rotation.x = -angle;
            sheet.position.set(facadeLength / 2,
                ridge.y + uy * dist + coverTopOffset + faitageThickness / 2,
                ridge.z + uz * dist);
            sheet.material = materials.bacAcierMat;
            sheet.parent = root;
        };

        addCapSheet(`faitage_${ridgeIdx}_gauche`, prev, faitageGauche);
        addCapSheet(`faitage_${ridgeIdx}_droite`, next, faitageDroite);
    });
}

/** Parse une liste de travées façon "1,3" (Croix de Saint-André, Coupe et Façade) — même syntaxe
 * que parseSpanInput dans batiment_metal.js. */
function parseSpanList(str) {
    if (!str) return [];
    return String(str).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
}

/** Parse le mini-DSL "portique:largeurxhauteur" des ouvertures/portes, ex "2:1.2x2.2, 4:3.0x3.0"
 * -> [{bay:2, width:1.2, height:2.2}, {bay:4, width:3.0, height:3.0}]. Entrées invalides ignorées
 * silencieusement (cohérent avec la tolérance déjà en place pour postDistances/crossCoupe). */
function parseDoorsSpec(str) {
    if (!str) return [];
    const doors = [];
    String(str).split(',').forEach(entry => {
        const m = entry.trim().match(/^(\d+)\s*:\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
        if (!m) return;
        const bay = parseInt(m[1], 10), width = parseFloat(m[2]), height = parseFloat(m[3]);
        if (bay > 0 && width > 0 && height > 0) doors.push({ bay, width, height });
    });
    return doors;
}

function makeBatimentMaterials(scene, params) {
    const {
        structureColor = '#8c929a', panelColor = '#1e293b',
        bacAcierColor = '#c0c1c4', claddingColor = '#c8ccd0'
    } = params;
    const steelMat = new BABYLON.StandardMaterial('batimentSteelMat', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);
    const panelMat = new BABYLON.StandardMaterial('batimentPanelMat', scene);
    panelMat.diffuseColor = BABYLON.Color3.FromHexString(panelColor);
    // Bac acier (couverture) : remplace le système d'intégration des ombrières pour les bâtiments —
    // pas de rails, une tôle nervurée galvanisée directement sur les pannes. Couleur pleinement
    // personnalisable (#bacAcierColor) au lieu d'une teinte grise figée — demande explicite
    // "définir la couleur... de la toiture en bac acier".
    const bacAcierMat = new BABYLON.StandardMaterial('batimentBacAcierMat', scene);
    bacAcierMat.diffuseColor = BABYLON.Color3.FromHexString(bacAcierColor);

    // Bardage : couleur pleinement personnalisable (#claddingColor), pré-remplie par défaut selon
    // le "Type de bardage" choisi (cf. test_3d.html) — demande explicite "ajouter des palettes de
    // couleurs pour l'option habillage".
    const claddingMat = new BABYLON.StandardMaterial('batimentCladdingMat', scene);
    claddingMat.diffuseColor = BABYLON.Color3.FromHexString(claddingColor);

    return { steelMat, panelMat, bacAcierMat, claddingMat };
}

/**
 * Renforts (bracons/jarrets) à une position X donnée, entre chaque poteau (across la largeur, Z)
 * et le dessous de la traverse — port de la section "Renforts (Bracons/Jarrets)" de
 * calculateBuildingGeometryLocal (lignes 1214-1286). Rive = 1er/dernier poteau (Z extrêmes),
 * intermédiaire = tous les autres. reachZ/posY utilisent les 4 pourcentages dédiés (rive vs
 * intermédiaire), comme le 2D. Réutilise buildJarretGusset (déjà global, model_single_post.js).
 */
function buildBatimentBracing(scene, root, params, postsZ, traversePoints, x, index, materials) {
    const {
        postSectionHeight = 0.4, braceWidth = 0.1, beamHeight = 0.15,
        bracePosPct = 85, bracePosTraversePotRive = 30,
        bracePosIntermPct = 70, bracePosTraverseIntPct = 30,
        reinforcementTypeEdge = 'bracons', reinforcementTypeInterm = 'bracons',
        heightUnderBrace = 0
    } = params;

    postsZ.forEach((z, i) => {
        const isEdge = i === 0 || i === postsZ.length - 1;
        const reinforceType = isEdge ? reinforcementTypeEdge : reinforcementTypeInterm;
        if (reinforceType === 'none') return;

        const postTopY = Math.max(0.1, traverseYAt(traversePoints, z) - beamHeight / 2);
        let posY = heightUnderBrace > 0 ? heightUnderBrace : postTopY * ((isEdge ? bracePosPct : bracePosIntermPct) / 100);
        // Toujours entre la tête (postTopY) et le bas (0) du poteau — jamais au-delà.
        posY = Math.max(0, Math.min(postTopY, posY));
        if (posY <= 0.05) return;

        const braceP = (isEdge ? bracePosTraversePotRive : bracePosTraverseIntPct) / 100;
        // Un bracon/jarret de chaque côté du poteau (vers la travée de gauche et/ou de droite),
        // sauf aux poteaux de rive qui n'ont qu'une seule travée adjacente.
        const sides = [];
        if (i > 0) sides.push(-1);
        if (i < postsZ.length - 1) sides.push(1);

        sides.forEach(dir => {
            const neighborZ = postsZ[i + dir];
            const reachZ = z + dir * Math.abs(neighborZ - z) * braceP;
            const reachY = Math.max(0.1, traverseYAt(traversePoints, reachZ) - beamHeight / 2);
            const postEdgeZ = z + dir * (postSectionHeight / 2);

            if (reinforceType === 'jarrets') {
                // jarretHeight plafonné à la moitié du poteau : évite que le point d'ancrage
                // (postTopY - jarretHeight) ne descende sous le pied du poteau (0) pour un poteau
                // court (ex: petite largeur de bâtiment ou pente faible) — cf. correctif demandé
                // "toujours entre la tête et le bas du poteau".
                const jarretHeight = Math.min(0.35, postTopY / 2);
                const p1 = { y: postTopY - jarretHeight, z: postEdgeZ };
                const p2 = { y: reachY, z: reachZ };
                const p3 = { y: postTopY, z: postEdgeZ };
                const gusset = buildJarretGusset(scene, `batimentJarret_${x.toFixed(2)}_${i}_${dir}`, p1, p2, p3, x, braceWidth, materials.steelMat);
                gusset.parent = root;
            } else {
                const dz = reachZ - postEdgeZ, dy = reachY - posY;
                const length = Math.sqrt(dz * dz + dy * dy);
                if (length < 1e-6) return;
                const brace = BABYLON.MeshBuilder.CreateBox(`batimentBrace_${x.toFixed(2)}_${i}_${dir}`, {
                    width: braceWidth, height: braceWidth, depth: length
                }, scene);
                brace.rotation.x = -Math.atan2(dy, dz);
                brace.position.set(x, (posY + reachY) / 2, (postEdgeZ + reachZ) / 2);
                brace.material = materials.steelMat;
                brace.parent = root;
            }
        });
    });
}

/** Croix de Saint-André "Coupe" : contreventement en croix (2 diagonales) dans le plan Y-Z, entre
 * 2 poteaux across la largeur adjacents formant la travée demandée (spanIndex 1-based, comme
 * "spans.forEach" du 2D). Appliquée à CHAQUE portique (position X) où le générateur est appelé —
 * cohérent avec le fait que bracons/jarrets (ci-dessus) se répètent eux aussi à chaque portique. */
function buildCrossCoupe(scene, root, params, postsZ, x, index, materials) {
    const { toggleCrossCoupe = false, crossCoupe = '', crossThickness = 0.05, beamHeight = 0.15 } = params;
    if (!toggleCrossCoupe) return;
    const spans = parseSpanList(crossCoupe);
    if (!spans.length) return;
    const { traversePoints } = params.__batimentGeo;

    spans.forEach(spanIndex => {
        if (spanIndex < 1 || spanIndex > postsZ.length - 1) return;
        const z1 = postsZ[spanIndex - 1], z2 = postsZ[spanIndex];
        const y1 = Math.max(0.1, traverseYAt(traversePoints, z1) - beamHeight / 2);
        const y2 = Math.max(0.1, traverseYAt(traversePoints, z2) - beamHeight / 2);
        const addDiag = (name, yA, zA, yB, zB) => {
            const dz = zB - zA, dy = yB - yA;
            const length = Math.sqrt(dz * dz + dy * dy);
            if (length < 1e-6) return;
            const bar = BABYLON.MeshBuilder.CreateBox(name, { width: crossThickness, height: crossThickness, depth: length }, scene);
            bar.rotation.x = -Math.atan2(dy, dz);
            bar.position.set(x, (yA + yB) / 2, (zA + zB) / 2);
            bar.material = materials.steelMat;
            bar.parent = root;
        };
        addDiag(`crossCoupe_${index}_${spanIndex}_a`, 0, z1, Math.max(y1, y2), z2);
        addDiag(`crossCoupe_${index}_${spanIndex}_b`, Math.max(y1, y2), z1, 0, z2);
    });
}

/** Croix de Saint-André "Façade" : contreventement en croix dans le plan X-Y, entre 2 poteaux de
 * façade adjacents formant la travée demandée — appliqué sur les 2 longs-pans (Z = poteau de rive
 * bas et Z = poteau de rive haut), pratique standard de contreventement de long-pan. Généralise le
 * principe de buildLongitudinalFacadeBracing/buildLongitudinalWoodBrace (ombriere_bois_shared.js)
 * en croix pleine (2 diagonales) au lieu d'un simple bracon. */
function buildCrossFacade(scene, root, params, postPositions, postsZ, traversePoints, materials) {
    const { toggleCrossFacade = false, crossFacade = '', crossThickness = 0.05, beamHeight = 0.15 } = params;
    if (!toggleCrossFacade) return;
    const spans = parseSpanList(crossFacade);
    if (!spans.length) return;

    const wallsZ = [postsZ[0], postsZ[postsZ.length - 1]];
    wallsZ.forEach(z => {
        const wallHeight = Math.max(0.1, traverseYAt(traversePoints, z) - beamHeight / 2);
        spans.forEach(spanIndex => {
            if (spanIndex < 1 || spanIndex > postPositions.length - 1) return;
            const x1 = postPositions[spanIndex - 1], x2 = postPositions[spanIndex];
            // CORRECTIF (barres de contreventement façade mal placées) : une rotation.z ne fait
            // tourner que les axes locaux X/Y d'une boîte, jamais son axe Z ("depth") — utiliser
            // depth=length avec rotation.z laissait donc la diagonale pointer perpétuellement selon
            // Z monde (perpendiculaire au mur) au lieu de suivre réellement l'axe poteau-à-poteau.
            // Fix : la longueur doit être portée par "width" (axe local X), qui LUI tourne bien dans
            // le plan X-Y sous rotation.z — la diagonale s'aligne alors pile dans l'axe longitudinal
            // entre les 2 poteaux, comme attendu.
            const addDiag = (name, xA, yA, xB, yB) => {
                const dx = xB - xA, dy = yB - yA;
                const length = Math.sqrt(dx * dx + dy * dy);
                if (length < 1e-6) return;
                const bar = BABYLON.MeshBuilder.CreateBox(name, { width: length, height: crossThickness, depth: crossThickness }, scene);
                bar.rotation.z = Math.atan2(dy, dx);
                bar.position.set((xA + xB) / 2, (yA + yB) / 2, z);
                bar.material = materials.steelMat;
                bar.parent = root;
            };
            addDiag(`crossFacade_${z.toFixed(2)}_${spanIndex}_a`, x1, 0, x2, wallHeight);
            addDiag(`crossFacade_${z.toFixed(2)}_${spanIndex}_b`, x1, wallHeight, x2, 0);
        });
    });
}

/**
 * Habillage (bardage) + ouvertures (portes) — nouvelle fonctionnalité sans équivalent 2D. Construit
 * les 2 pignons (plan Y-Z, aux 2 extrémités de façade) et les 2 longs-pans (plan X-Y, aux 2 Z de
 * rive) sous forme de panneaux de bardage, sur une bande de hauteur claddingPositionPct% ancrée en
 * haut ou en bas (claddingPlacement). Les portes définies dans doorsSpec (par travée de façade)
 * scindent le long-pan concerné en 3 segments (gauche/droite/au-dessus) au lieu d'un panneau plein.
 */
function buildHabillageEtOuverture(scene, root, params, postPositions, postsZ, traversePoints, materials) {
    if (!params.showCladding) return;
    const {
        claddingPositionPct = 100, claddingPlacement = 'bottom', beamHeight = 0.15, postSectionWidth = 0.3,
        doorsSpec = '', claddingThickness = 0.05
    } = params;
    const doors = parseDoorsSpec(doorsSpec);
    const pct = Math.max(0, Math.min(100, claddingPositionPct)) / 100;

    const bandFor = (wallHeight) => {
        const bandHeight = wallHeight * pct;
        return claddingPlacement === 'top' ? { yBottom: wallHeight - bandHeight, yTop: wallHeight } : { yBottom: 0, yTop: bandHeight };
    };

    const addPanel = (name, xCenter, xWidth, zCenter, zWidth, yBottom, yTop, rotY) => {
        const h = yTop - yBottom;
        if (h <= 0.01 || xWidth <= 0.01) return;
        const panel = BABYLON.MeshBuilder.CreateBox(name, { width: xWidth, height: h, depth: claddingThickness }, scene);
        panel.rotation.y = rotY || 0;
        panel.position.set(xCenter, yBottom + h / 2, zCenter);
        panel.material = materials.claddingMat;
        panel.parent = root;
    };

    // Pignons (aux 2 extrémités de façade, plan Y-Z -> panneau étendu selon Z, tourné de 90°).
    [postPositions[0], postPositions[postPositions.length - 1]].forEach((x, gIdx) => {
        const wallHeight = Math.max(...postsZ.map(z => traverseYAt(traversePoints, z) - beamHeight / 2));
        const { yBottom, yTop } = bandFor(wallHeight);
        const gableWidth = postsZ[postsZ.length - 1] - postsZ[0];
        addPanel(`gableCladding_${gIdx}`, x, gableWidth, (postsZ[0] + postsZ[postsZ.length - 1]) / 2, 0, yBottom, yTop, Math.PI / 2);
    });

    // Longs-pans (aux 2 Z de rive, plan X-Y), avec découpe des portes par travée de façade.
    [postsZ[0], postsZ[postsZ.length - 1]].forEach((z, wallIdx) => {
        const wallHeight = Math.max(0.1, traverseYAt(traversePoints, z) - beamHeight / 2);
        const { yBottom, yTop } = bandFor(wallHeight);
        for (let i = 0; i < postPositions.length - 1; i++) {
            const x1 = postPositions[i], x2 = postPositions[i + 1];
            const bayWidth = x2 - x1;
            const door = doors.find(d => d.bay === i + 1);
            if (!door) {
                addPanel(`sideCladding_${wallIdx}_${i}`, (x1 + x2) / 2, bayWidth - postSectionWidth, z, 0, yBottom, yTop, 0);
                continue;
            }
            // Porte centrée dans la travée : segments gauche / droite / au-dessus.
            const doorW = Math.min(door.width, bayWidth - postSectionWidth - 0.2);
            const doorH = Math.min(door.height, yTop - yBottom);
            const bayCenter = (x1 + x2) / 2;
            const leftW = (bayWidth - postSectionWidth - doorW) / 2;
            if (leftW > 0.05) addPanel(`sideCladding_${wallIdx}_${i}_L`, bayCenter - doorW / 2 - leftW / 2, leftW, z, 0, yBottom, yTop, 0);
            if (leftW > 0.05) addPanel(`sideCladding_${wallIdx}_${i}_R`, bayCenter + doorW / 2 + leftW / 2, leftW, z, 0, yBottom, yTop, 0);
            const aboveBottom = yBottom + doorH;
            if (yTop - aboveBottom > 0.05) addPanel(`sideCladding_${wallIdx}_${i}_top`, bayCenter, doorW, z, 0, aboveBottom, yTop, 0);
        }
    });
}

/**
 * Construction complète d'un bâtiment métal 3D (poteaux, traverses, pannes, panneaux PV,
 * renforts, croix Saint-André, habillage) pour l'une des 4 formes de toiture. Point d'entrée
 * commun appelé par chacun des 4 fichiers model_*_metal.js (qui ne font que forcer postModel).
 */
function buildBatimentMetal3DCommon(scene, params) {
    const {
        facadeLength, leftOverhang, rightOverhang = leftOverhang, postDistances,
        postSectionWidth = 0.3, postSectionHeight = 0.4, beamWidth = 0.15, beamHeight = 0.15,
        purlinHeight = 0.3, purlinCount = 6,
        panelThickness = 0.03, bacAcierWaveHeight = 0.045,
        pvLayout = '10LX30C', hidePanels = false, overhangSym = 0.2
    } = params;
    const root = new BABYLON.TransformNode('shedRootBatimentMetal', scene);
    const geo = computeBatimentTraversePoints(params);
    const postsZ = geo.postsZ;
    // Porte-à-faux toiture : rallonge la couverture (traverse/pannes/bac acier/panneaux/faîtage) de
    // part et d'autre au-delà des poteaux (postsZ reste inchangé, les poteaux ne bougent pas) —
    // cf. correctif demandé, valeur par défaut 0.20m (champ partagé "overhangSym").
    const traversePoints = extendTraversePointsForOverhang(geo.traversePoints, overhangSym);
    params.__batimentGeo = { traversePoints };
    const materials = makeBatimentMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    // Poteaux : un par (position façade x position across-largeur), tête coupée à l'angle de la
    // pente locale (buildAngledTopPost) pour épouser exactement le dessous de la traverse sur toute
    // la largeur du poteau (postSectionHeight), au lieu d'un sommet plat qui ne touchait la
    // traverse inclinée que sur une seule arête — généralise postTops du 2D pour les 4 formes.
    postPositions.forEach((x, xi) => {
        postsZ.forEach((z, zi) => {
            const yAtZLow = Math.max(0.1, traverseYAt(traversePoints, z - postSectionHeight / 2) - beamHeight / 2);
            const yAtZHigh = Math.max(0.1, traverseYAt(traversePoints, z + postSectionHeight / 2) - beamHeight / 2);
            const post = buildAngledTopPost(scene, `batimentPost_${xi}_${zi}`, x, z, postSectionWidth, postSectionHeight, yAtZLow, yAtZHigh, materials.steelMat);
            post.parent = root;
        });
    });

    // Traverses : un segment par tronçon du profil de toiture (traversePoints), par poteau de
    // façade — CENTRÉES SUR L'AXE DU POTEAU (même X, aucun décalage) : la traverse (comme une
    // charpente métallique réelle) vient reposer directement au-dessus du poteau, tête coupée à
    // l'angle de la pente (buildAngledTopPost ci-dessus) pour un contact plein, pas décalée "sur le
    // côté" du poteau. CORRECTIF : un décalage en X avait été introduit à tort dans une itération
    // précédente (aucune formule de ce type n'existe dans le moteur 2D de référence — la "coupe" y
    // est un plan Y-Z sans axe X, donc "devant le poteau" n'y décrit qu'un ordre d'affichage 2D, pas
    // un déport réel) ; supprimé. Renforts et croix "coupe" s'accrochent à la traverse : ils restent
    // donc eux aussi dans l'axe du poteau (même X).
    postPositions.forEach((x, xi) => {
        for (let i = 0; i < traversePoints.length - 1; i++) {
            const p1 = traversePoints[i], p2 = traversePoints[i + 1];
            const dz = p2.z - p1.z, dy = p2.y - p1.y;
            const length = Math.sqrt(dz * dz + dy * dy);
            if (length < 1e-6) continue;
            const traverse = BABYLON.MeshBuilder.CreateBox(`batimentTraverse_${xi}_${i}`, {
                width: beamWidth, height: beamHeight, depth: length
            }, scene);
            traverse.rotation.x = -Math.atan2(dy, dz);
            traverse.position.set(x, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
            traverse.material = materials.steelMat;
            traverse.parent = root;
        }
        buildBatimentBracing(scene, root, params, postsZ, traversePoints, x, xi, materials);
        buildCrossCoupe(scene, root, params, postsZ, x, xi, materials);
    });

    buildCrossFacade(scene, root, params, postPositions, postsZ, traversePoints, materials);

    // Pannes + champ PV : réutilise le motif de buildSinglePostShed (ombriere_metal), appliqué par
    // tronçon de toiture (chaque tronçon reçoit sa propre part de pannes/panneaux, proportionnelle
    // à sa longueur de pente, puisque le profil n'est pas un plan unique dès que postModel !=
    // monopente/bipente à 1 seul tronçon).
    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const segLengths = [];
    let totalSegLength = 0;
    for (let i = 0; i < traversePoints.length - 1; i++) {
        const p1 = traversePoints[i], p2 = traversePoints[i + 1];
        const len = Math.hypot(p2.z - p1.z, p2.y - p1.y);
        segLengths.push(len);
        totalSegLength += len;
    }
    const cellGap = 0.02;
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);

    for (let i = 0; i < traversePoints.length - 1; i++) {
        const p1 = traversePoints[i], p2 = traversePoints[i + 1];
        const segLen = segLengths[i];
        if (segLen < 1e-6) continue;
        const segRows = Math.max(1, Math.round(pvRows * (segLen / totalSegLength)));
        const angle = Math.atan2(p2.y - p1.y, p2.z - p1.z);
        const midDist = segLen / 2;

        // Pannes : POSÉES SUR CHANT (debout), pas à plat — depth=beamWidth reste dans le plan de la
        // pente (faible emprise le long du rampant, comme la traverse) tandis que height=purlinHeight
        // devient la hauteur DEBOUT, perpendiculaire au toit. rotation.x = -angle (SANS +Math.PI/2)
        // est la même convention que la traverse ci-dessus (déjà correcte) : depth suit la pente,
        // height est perpendiculaire. Le +Math.PI/2 précédent inversait les deux rôles (panne
        // couchée sur sa largeur) — cf. correctif demandé.
        //
        // CORRECTIF (panne sablière décentrée) : la distribution des pannes doit s'appuyer sur la
        // portée STRUCTURELLE (poteau à poteau/faîtage, geo.traversePoints, sans le porte-à-faux),
        // pas sur "segLen"/"p1" qui incluent désormais le débord de toiture (overhangSym) — sinon la
        // 1ère panne (panne sablière) glisse dans la zone de porte-à-faux au lieu de rester sur
        // l'axe de la tête du poteau. Le porte-à-faux (traverse/bac acier/panneaux, eux basés sur
        // "p1"/"segLen" étendus) démarre ainsi exactement sur l'axe de cette panne, comme demandé.
        const structP1 = geo.traversePoints[i], structP2 = geo.traversePoints[i + 1];
        const structSegLen = Math.hypot(structP2.z - structP1.z, structP2.y - structP1.y);
        const purlinCountSafe = Math.max(2, Math.round(purlinCount));
        for (let j = 0; j < purlinCountSafe; j++) {
            const t = purlinCountSafe === 1 ? 0.5 : j / (purlinCountSafe - 1);
            const dist = beamWidth / 2 + t * (structSegLen - beamWidth);
            const pz = structP1.z + dist * Math.cos(angle);
            const py = structP1.y + dist * Math.sin(angle) + beamHeight / 2 + purlinHeight / 2;
            const purlin = BABYLON.MeshBuilder.CreateBox(`batimentPurlin_${i}_${j}`, {
                width: facadeLength, height: purlinHeight, depth: beamWidth
            }, scene);
            purlin.rotation.x = -angle;
            purlin.position.set(facadeLength / 2, py, pz);
            purlin.material = materials.steelMat;
            purlin.parent = root;
        }

        // Bac acier : remplace le système d'intégration (rails) — une seule tôle continue par
        // tronçon de toiture, posée à plat sur les pannes (comme les panneaux ci-dessous), épaisseur
        // visuelle = hauteur d'onde (0.75mm serait invisible à cette échelle).
        const bacAcier = BABYLON.MeshBuilder.CreateBox(`batimentBacAcier_${i}`, {
            width: facadeLength, height: bacAcierWaveHeight, depth: segLen
        }, scene);
        bacAcier.rotation.x = -angle;
        bacAcier.position.set(facadeLength / 2,
            p1.y + midDist * Math.sin(angle) + beamHeight / 2 + purlinHeight + bacAcierWaveHeight / 2,
            p1.z + midDist * Math.cos(angle));
        bacAcier.material = materials.bacAcierMat;
        bacAcier.parent = root;

        if (!hidePanels) {
            const cellDepth = Math.max(0.01, (segLen - cellGap * (segRows + 1)) / segRows);
            const panelGroup = new BABYLON.TransformNode(`batimentPanelGroup_${i}`, scene);
            // Panneaux : même correctif que les pannes (suppression du +Math.PI/2) — depth=cellDepth
            // (grande dimension) reste dans le plan de la pente, height=panelThickness (fine) reste
            // perpendiculaire : les panneaux restent bien À PLAT sur la toiture, quelle que soit la
            // pente, au lieu d'être debout comme avant.
            panelGroup.rotation.x = -angle;
            panelGroup.position.set(facadeLength / 2,
                p1.y + midDist * Math.sin(angle) + beamHeight / 2 + purlinHeight + bacAcierWaveHeight + panelThickness / 2,
                p1.z + midDist * Math.cos(angle));
            panelGroup.parent = root;
            for (let r = 0; r < segRows; r++) {
                const cz = -segLen / 2 + cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
                for (let c = 0; c < pvCols; c++) {
                    const cx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                    const cell = BABYLON.MeshBuilder.CreateBox(`batimentPvCell_${i}_${r}_${c}`, {
                        width: cellWidth, height: panelThickness, depth: cellDepth
                    }, scene);
                    cell.position.set(cx, 0, cz);
                    cell.material = materials.panelMat;
                    cell.parent = panelGroup;
                }
            }
        }
    }

    buildFaitageSheets(scene, root, params, traversePoints, materials);
    buildHabillageEtOuverture(scene, root, params, postPositions, postsZ, traversePoints, materials);

    root.position.x -= facadeLength / 2;
    const maxPostHeight = Math.max(...postsZ.map(z => Math.max(0.1, traverseYAt(traversePoints, z) - beamHeight / 2)));
    root.shedStats = {
        postPositions, beamTopY: maxPostHeight + beamHeight, postHeight: maxPostHeight, facadeLength,
        slopeLength: totalSegLength
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.computeBatimentTraversePoints = computeBatimentTraversePoints;
    window.traverseYAt = traverseYAt;
    window.parseSpanList = parseSpanList;
    window.parseDoorsSpec = parseDoorsSpec;
    window.extendTraversePointsForOverhang = extendTraversePointsForOverhang;
    window.buildAngledTopPost = buildAngledTopPost;
    window.getRidgeIndices = getRidgeIndices;
    window.buildFaitageSheets = buildFaitageSheets;
    window.buildBatimentMetal3DCommon = buildBatimentMetal3DCommon;
}
