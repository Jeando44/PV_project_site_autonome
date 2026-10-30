"""Port Python fidèle (fonction par fonction) de calepinage_maison_calculs.js pour le calepinage
résidentiel (Calepinage_mainson) — TOUS les poseMode ('incline'/'plat'/'shed'/'dome'), contour
rectangle OU polygone libre, pans divisés ou non (2/4 pans), obstacles et panneaux supprimés
manuellement.

Chaque fonction ci-dessous porte, en commentaire, le nom de la fonction JS d'origine
(app/static/concevoir_mon_projet/javascript/components/calepinage_systeme/Calepinage_mainson/
calepinage_maison_calculs.js) dont elle est la traduction directe — se référer à ce fichier en cas
de doute plutôt qu'à ce module, qui n'est qu'un miroir.
"""
import math

EPS = 1e-9

SUPPORTED_POSE_MODES = ('incline', 'plat', 'shed', 'dome')


# ------------------------------------------------------------------------------------------
# Géométrie de base (rotateAroundOrigin, normalize, boundingBox, pointInPolygon)
# ------------------------------------------------------------------------------------------
def _rotate(pt, angle_rad):
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    return {'x': pt['x'] * cos_a - pt['y'] * sin_a, 'y': pt['x'] * sin_a + pt['y'] * cos_a}


def _normalize(v):
    length = math.hypot(v['x'], v['y']) or 1
    return {'x': v['x'] / length, 'y': v['y'] / length}


def _bounding_box(poly):
    xs = [p['x'] for p in poly]
    ys = [p['y'] for p in poly]
    return {'minX': min(xs), 'maxX': max(xs), 'minY': min(ys), 'maxY': max(ys)}


def _point_in_polygon(pt, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]['x'], poly[i]['y']
        xj, yj = poly[j]['x'], poly[j]['y']
        if (yi > pt['y']) != (yj > pt['y']):
            x_intersect = (xj - xi) * (pt['y'] - yi) / (yj - yi) + xi
            if pt['x'] < x_intersect:
                inside = not inside
        j = i
    return inside


# ------------------------------------------------------------------------------------------
# offsetPolygonEdges / bufferPolygonOutward / erodePolygonByEdgeClearances
# ------------------------------------------------------------------------------------------
def _offset_polygon_edges(poly, distances, inward):
    n = len(poly)
    if n < 3:
        return list(poly)

    signed_area = 0.0
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        signed_area += a['x'] * b['y'] - b['x'] * a['y']
    ccw = signed_area > 0

    edges = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        d = _normalize({'x': b['x'] - a['x'], 'y': b['y'] - a['y']})
        if ccw:
            edge_normal = {'x': -d['y'], 'y': d['x']}
        else:
            edge_normal = {'x': d['y'], 'y': -d['x']}
        if not inward:
            edge_normal = {'x': -edge_normal['x'], 'y': -edge_normal['y']}
        dist = distances[i] if i < len(distances) else 0
        edges.append({
            'point': {'x': a['x'] + edge_normal['x'] * dist, 'y': a['y'] + edge_normal['y'] * dist},
            'dir': d,
        })

    result = []
    for i in range(n):
        original = poly[i]
        prev = edges[(i - 1) % n]
        cur = edges[i]
        det = prev['dir']['x'] * cur['dir']['y'] - prev['dir']['y'] * cur['dir']['x']
        if abs(det) < EPS:
            result.append(original)
            continue
        dx = cur['point']['x'] - prev['point']['x']
        dy = cur['point']['y'] - prev['point']['y']
        t = (dx * cur['dir']['y'] - dy * cur['dir']['x']) / det
        result.append({'x': prev['point']['x'] + prev['dir']['x'] * t, 'y': prev['point']['y'] + prev['dir']['y'] * t})
    return result


def _buffer_polygon_outward(poly, amount):
    if not amount:
        return list(poly)
    return _offset_polygon_edges(poly, [amount] * len(poly), False)


def _erode_polygon_by_edge_clearances(poly, clearances):
    if len(poly) < 3:
        return []
    return _offset_polygon_edges(poly, clearances, True)


# ------------------------------------------------------------------------------------------
# clipPolygonByLine / intersectLineWithSegment (filtre "cette bande de rangée touche le contour")
# ------------------------------------------------------------------------------------------
def _intersect_line_with_segment(line_point, line_dir, a, b):
    dx1, dy1 = line_dir['x'], line_dir['y']
    dx2, dy2 = b['x'] - a['x'], b['y'] - a['y']
    det = dx2 * dy1 - dx1 * dy2
    if abs(det) < EPS:
        return {'x': (a['x'] + b['x']) / 2, 'y': (a['y'] + b['y']) / 2}
    ex, ey = a['x'] - line_point['x'], a['y'] - line_point['y']
    s = (dx1 * ey - dy1 * ex) / det
    return {'x': a['x'] + s * dx2, 'y': a['y'] + s * dy2}


def _clip_polygon_by_line(poly, line_point, line_dir, keep_sign):
    normal = {'x': -line_dir['y'], 'y': line_dir['x']}

    def side(p):
        return keep_sign * ((p['x'] - line_point['x']) * normal['x'] + (p['y'] - line_point['y']) * normal['y'])

    output = []
    n = len(poly)
    for i in range(n):
        cur = poly[i]
        prev = poly[(i - 1) % n]
        cur_in = side(cur) >= -EPS
        prev_in = side(prev) >= -EPS
        if cur_in:
            if not prev_in:
                output.append(_intersect_line_with_segment(line_point, line_dir, prev, cur))
            output.append(cur)
        elif prev_in:
            output.append(_intersect_line_with_segment(line_point, line_dir, prev, cur))
    return output


# ------------------------------------------------------------------------------------------
# getEffectivePanelDims / computeEdgeClearances / effectiveGridAngle / buildRowOffsets /
# isPointInObstacleBuffer
# ------------------------------------------------------------------------------------------
DOME_PANELS_VALIDES = (2, 4, 6, 8, 10, 12, 14)


def _dome_panels_per_row(valeur):
    """Miroir de domePanelsPerRow() (calepinage_maison_calculs.js) : 2, 4 ... 14, sinon 2."""
    try:
        n = float(valeur)
    except (TypeError, ValueError):
        return 2
    return int(n) if n in DOME_PANELS_VALIDES else 2


def _effective_panel_dims(pose_mode, panel_length_m, panel_width_m, pente_deg, dome_tilt_deg, panel_orientation):
    if pose_mode in ('incline', 'shed'):
        cos_p = math.cos(math.radians(pente_deg)) or 0.0001
    elif pose_mode == 'dome':
        cos_p = math.cos(math.radians(dome_tilt_deg)) or 0.0001
    else:
        cos_p = 1.0
    if panel_orientation == 'paysage':
        return {'alongEave': panel_length_m, 'alongRampant': panel_width_m * cos_p}
    return {'alongEave': panel_width_m, 'alongRampant': panel_length_m * cos_p}


def _compute_edge_clearances(pan, division_mode, edge_clearance_m, ridge_clearance_m):
    ridge_set = set(pan.get('ridgeEdgeIndices') or [])
    n = len(pan['points'])
    return [
        ridge_clearance_m if (division_mode != 'none' and i in ridge_set) else edge_clearance_m
        for i in range(n)
    ]


def _effective_grid_angle(pan, division_mode, contour_mode, rect_azimuth_offset_deg):
    points = pan['points']
    if division_mode == 'none' and contour_mode != 'polygon' and len(points) == 4:
        p0, p1 = points[0], points[1]
        return math.atan2(p1['y'] - p0['y'], p1['x'] - p0['x']) + math.radians(rect_azimuth_offset_deg or 0)
    return pan.get('angle') or 0


def _build_row_offsets(available, eff_size, spacing, group_size, group_spacing):
    offsets = []
    cursor = 0.0
    idx = 0
    if eff_size <= 0:
        return offsets
    while cursor + eff_size <= available + 0.001:
        offsets.append(cursor + eff_size / 2)
        idx += 1
        is_group_boundary = group_size > 0 and idx % group_size == 0
        cursor += eff_size + spacing + (group_spacing if is_group_boundary else 0)
    kept = offsets[: (len(offsets) // group_size) * group_size] if group_size > 0 else offsets
    if kept:
        actual_used = kept[-1] + eff_size / 2
        shift = (available - actual_used) / 2
        return [o + shift for o in kept]
    return kept


# ------------------------------------------------------------------------------------------
# Joints de dilatation (paramsJointDilatation / decouperEnTroncons / placerColonnesAvecJoints)
# ------------------------------------------------------------------------------------------
JOINT_DILATATION = {
    'largeurDefautMm': 100, 'largeurMinMm': 10, 'largeurMaxMm': 300,
    'limiteDefautM': 65, 'limiteMinM': 50, 'limiteMaxM': 100,
}
TYPES_AVEC_JOINT_DILATATION = ('ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra', 'toiture_inclinee')


def _borner(valeur, vmin, vmax, defaut):
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return defaut
    if valeur == '' or math.isnan(v) or math.isinf(v):
        return defaut
    return min(vmax, max(vmin, v))


SEPARATION_TERRASSE = {'surfaceMaxM2': 300, 'largeurDefautMm': 900, 'largeurMinMm': 300, 'largeurMaxMm': 3000}


def _params_joint_dilatation(state):
    """Port de paramsJointDilatation (sans le filtre shed/dôme, appliqué par l'appelant)."""
    if (state.get('typeMontage') or '') == 'toiture_terrasse':
        t = SEPARATION_TERRASSE
        return {
            'largeurM': _borner(state.get('terrasseSeparationMm'), t['largeurMinMm'], t['largeurMaxMm'], t['largeurDefautMm']) / 1000,
            'surfaceMaxM2': t['surfaceMaxM2'], 'limiteM': None, 'repartition': 'egale',
        }
    if (state.get('typeMontage') or '') not in TYPES_AVEC_JOINT_DILATATION:
        return None
    j = JOINT_DILATATION
    return {
        'largeurM': _borner(state.get('jointDilatationMm'), j['largeurMinMm'], j['largeurMaxMm'], j['largeurDefautMm']) / 1000,
        'limiteM': _borner(state.get('jointDilatationLimiteM'), j['limiteMinM'], j['limiteMaxM'], j['limiteDefautM']),
        'repartition': 'limite' if state.get('jointDilatationRepartition') == 'limite' else 'egale',
    }


def _decouper_en_troncons(n, w, s, limite, repartition='egale'):
    if n <= 0:
        return []
    if repartition == 'limite':
        par_troncon = max(1, math.floor((limite + s + 1e-9) / (w + s)))
        troncons, reste = [], n
        while reste > 0:
            troncons.append(min(par_troncon, reste))
            reste -= par_troncon
        return troncons

    def longueur(k):
        return k * w + max(0, k - 1) * s

    nb = max(1, math.ceil(longueur(n) / limite - 1e-9))
    while nb < n and longueur(math.ceil(n / nb)) > limite + 1e-9:
        nb += 1
    base, reste = n // nb, n % nb
    return [base + (1 if i < reste else 0) for i in range(nb)]


def _placer_colonnes_avec_joints(available, w, s, joint):
    n = math.floor((available + 0.001 + s) / (w + s))
    troncons, total = [], 0.0
    while n > 0:
        troncons = _decouper_en_troncons(n, w, s, joint['limiteM'], joint['repartition'])
        nb_joints = len(troncons) - 1
        total = n * w + (n - 1 - nb_joints) * s + nb_joints * joint['largeurM']
        if total <= available + 0.001:
            break
        n -= 1
    centres, joints_x = [], []
    if n <= 0:
        return centres, joints_x
    curseur = (available - total) / 2
    for t, k in enumerate(troncons):
        for _ in range(k):
            centres.append(curseur + w / 2)
            curseur += w + s
        if t < len(troncons) - 1:
            bord_fin = curseur - s
            joints_x.append(bord_fin + joint['largeurM'] / 2)
            curseur = bord_fin + joint['largeurM']
    return centres, joints_x


def _is_point_in_obstacle_buffer(pt, o):
    local = _rotate({'x': pt['x'] - o['x'], 'y': pt['y'] - o['y']}, -(o.get('angle') or 0))
    return abs(local['x']) <= o['w'] / 2 + o.get('buffer', 0) and abs(local['y']) <= o['h'] / 2 + o.get('buffer', 0)


# ------------------------------------------------------------------------------------------
# computeCandidatePanelSlots / packPanelsForPan
# ------------------------------------------------------------------------------------------
def compute_candidate_panel_slots(pan, ctx):
    """Port de computeCandidatePanelSlots(pan), poseMode 'incline'/'plat'/'shed'/'dome'. Retourne
    None si poseMode n'est pas supporté."""
    pose_mode = pan.get('poseMode', 'incline')
    if pose_mode not in SUPPORTED_POSE_MODES:
        return None
    is_shed = pose_mode == 'shed'
    is_dome = pose_mode == 'dome'

    dims = _effective_panel_dims(pose_mode, ctx['panelLengthM'], ctx['panelWidthM'], ctx['penteDeg'], ctx['domeTiltDeg'], ctx['panelOrientation'])
    w, l = dims['alongEave'], dims['alongRampant']
    if w <= 0 or l <= 0:
        return []

    angle = _effective_grid_angle(pan, ctx['divisionMode'], ctx['contourMode'], ctx['rectAzimuthOffsetDeg'])
    overhang = (ctx['overhangRampant'] + ctx['overhangLongpan']) / 2
    buffered_points = _buffer_polygon_outward(pan['points'], overhang)

    clearances = _compute_edge_clearances(pan, ctx['divisionMode'], ctx['edgeClearanceM'], ctx['ridgeClearanceEachSideM'])
    eroded_points = _erode_polygon_by_edge_clearances(buffered_points, clearances)
    if len(eroded_points) < 3:
        return []

    local_points = [_rotate(p, -angle) for p in eroded_points]
    bb = _bounding_box(local_points)

    spacing_x = ctx['panelSpacingXM']
    dome_panel_gap = ctx['domePanelSpacingM'] if is_dome else 0
    # Rangée de dôme = nb_dome panneaux le long du rampant (moitié de chaque côté), cf. domePanelsPerRow.
    nb_dome = _dome_panels_per_row(ctx.get('domePanelsPerRow')) if is_dome else 1
    pair_height = (nb_dome * l + (nb_dome - 1) * dome_panel_gap) if is_dome else l
    spacing_y = ctx['domeSpacingM'] if is_dome else (ctx['shedSpacingM'] if is_shed else ctx['panelSpacingYM'])
    # "Nb. panneaux en longueur" / "Esp. groupe de shed (mm)" : regroupement le long de la rangée
    # (axe X, égout) — 0 = pas de regroupement.
    shed_panels_per_row = max(0, min(40, ctx['shedPanelsPerRow'])) if is_shed else 0
    shed_row_group_spacing = max(0, ctx['shedRowGroupSpacingM']) if is_shed else 0

    usable_y = max(0, bb['maxY'] - bb['minY'])
    # Plafond 15 : aligné sur le JS (saisie "Nb. PV par shed" 1-15).
    shed_group_size = max(1, min(15, ctx['shedPanelsPerGroup'])) if is_shed else 1
    # "Sheds réguliers" (miroir de computeCandidatePanelSlots) : une TABLE = shed_group_size panneaux
    # en largeur x shed_panels_per_row en longueur ; actif seulement si Esp. groupe de shed > 0 ET
    # Nb. PV en long. par shed > 0.
    shed_regulier_actif = (
        is_shed and ctx['shedRegularAlignment'] and shed_regulier_applicable(ctx) and shed_panels_per_row > 0
    )
    panneaux_par_table = shed_group_size * shed_panels_per_row

    def cle_table(jx, jy):
        return f'{jx // shed_panels_per_row}-{jy // shed_group_size}'

    if shed_group_size > 1 and pair_height > 0:
        row_ys = []
        y = 0.0
        while y + pair_height <= usable_y + 1e-9:
            row_ys.append(y)
            is_group_boundary = (len(row_ys) % shed_group_size) == 0
            y += pair_height + (spacing_y if is_group_boundary else ctx['panelSpacingYM'])
        row_ys = row_ys[: (len(row_ys) // shed_group_size) * shed_group_size]
    else:
        count_y = math.floor((usable_y + spacing_y) / (pair_height + spacing_y)) if pair_height > 0 else 0
        row_ys = [i * (pair_height + spacing_y) for i in range(count_y)]

    used_y = (row_ys[-1] + pair_height) if row_ys else 0
    grid_offset = ctx['gridOffsetByPan'].get(pan['id'], {})
    dx0, dy0 = grid_offset.get('dx', 0), grid_offset.get('dy', 0)
    start_y = bb['minY'] + (usable_y - used_y) / 2 + dy0

    deleted_set = set(ctx['deletedPanelIndicesByPan'].get(pan['id'], []))

    usable_x = max(0, bb['maxX'] - bb['minX'])
    x_centers = _build_row_offsets(usable_x, w, spacing_x, shed_panels_per_row, shed_row_group_spacing)
    # Joints de dilatation (ombrières / bâtiment incliné), jamais en shed ni en dôme.
    joint = dict(ctx['jointDilatation']) if ctx.get('jointDilatation') and not (is_shed or is_dome) else None
    if joint and joint.get('surfaceMaxM2'):
        # Terrasse : sections de surfaceMaxM2 de panneaux au plus (cf. computeCandidatePanelSlots).
        surface_colonne = len(row_ys) * ctx['panelLengthM'] * ctx['panelWidthM']
        if surface_colonne > 0:
            colonnes_max = max(1, math.floor(joint['surfaceMaxM2'] / surface_colonne + 1e-9))
            joint['limiteM'] = colonnes_max * w + (colonnes_max - 1) * spacing_x + 1e-6
    if joint and joint.get('limiteM'):
        centres, joints_x = _placer_colonnes_avec_joints(usable_x, w, spacing_x, joint)
        if joints_x:
            x_centers = centres

    obstacles = ctx['obstacles']
    slots = []

    def push_slot(x, y, h, jx, jy, dome_side=None):
        local_corners = [{'x': x, 'y': y}, {'x': x + w, 'y': y}, {'x': x + w, 'y': y + h}, {'x': x, 'y': y + h}]
        true_corners = [_rotate(c, angle) for c in local_corners]
        inside = all(_point_in_polygon(c, eroded_points) for c in true_corners)
        blocked = any(_is_point_in_obstacle_buffer(c, o) for c in true_corners for o in obstacles)
        if not inside or blocked:
            return
        idx_key = f'{jx}-{jy}' if dome_side is None else f'{jx}-{jy}-{dome_side}'
        true_center = _rotate({'x': x + w / 2, 'y': y + h / 2}, angle)
        slots.append({
            'idxKey': idx_key, 'cx': true_center['x'], 'cy': true_center['y'],
            'w': w, 'l': h, 'angle': angle, 'deleted': idx_key in deleted_set,
        })

    # NOUVEAU (port de la recherche de phase JS, "assurez-vous que le polygone soit rempli au
    # maximum de panneaux") : pour un shed groupé sur un contour polygone libre, teste plusieurs
    # décalages horizontaux de xCenters et conserve celui qui maximise le nombre d'empilements
    # complets — no-op pour un contour rectangle (grille déjà optimale, cf. commentaire JS).
    if is_shed and ctx['contourMode'] == 'polygon' and (shed_group_size > 1 or shed_regulier_actif) and x_centers:
        row_bands = []
        for ry in row_ys:
            y_pair = start_y + ry
            band = _clip_polygon_by_line(
                _clip_polygon_by_line(local_points, {'x': 0, 'y': y_pair}, {'x': 1, 'y': 0}, 1),
                {'x': 0, 'y': y_pair + pair_height}, {'x': 1, 'y': 0}, -1,
            )
            row_bands.append(len(band) >= 3)

        def count_complete_slots_for_x_centers(centers):
            count_by_stack = {}
            for jy, ry in enumerate(row_ys):
                if not row_bands[jy]:
                    continue
                y_pair = start_y + ry
                module_idx = jy // shed_group_size
                for jx, center_x in enumerate(centers):
                    x = bb['minX'] + center_x - w / 2 + dx0
                    corners = [
                        {'x': x, 'y': y_pair}, {'x': x + w, 'y': y_pair},
                        {'x': x + w, 'y': y_pair + pair_height}, {'x': x, 'y': y_pair + pair_height},
                    ]
                    corners = [_rotate(c, angle) for c in corners]
                    inside = all(_point_in_polygon(c, eroded_points) for c in corners)
                    blocked = any(_is_point_in_obstacle_buffer(c, o) for c in corners for o in obstacles)
                    if not inside or blocked:
                        continue
                    key = cle_table(jx, jy) if shed_regulier_actif else f'{jx}-{module_idx}'
                    count_by_stack[key] = count_by_stack.get(key, 0) + 1
            complet = panneaux_par_table if shed_regulier_actif else shed_group_size
            total = 0
            for count in count_by_stack.values():
                if count == complet:
                    total += complet
            return total

        pitch = w + spacing_x
        sample_count = 16
        best_centers, best_count, best_abs_delta = x_centers, count_complete_slots_for_x_centers(x_centers), 0
        for i in range(1, sample_count + 1):
            delta = (i / sample_count) * (pitch / 2)
            for d in (delta, -delta):
                shifted = [c + d for c in x_centers]
                if shifted[0] - w / 2 < -0.01 or shifted[-1] + w / 2 > usable_x + 0.01:
                    continue
                count = count_complete_slots_for_x_centers(shifted)
                if count > best_count or (count == best_count and abs(d) < best_abs_delta):
                    best_count, best_centers, best_abs_delta = count, shifted, abs(d)
        x_centers = best_centers

    for jy, ry in enumerate(row_ys):
        y_pair = start_y + ry
        band = _clip_polygon_by_line(
            _clip_polygon_by_line(local_points, {'x': 0, 'y': y_pair}, {'x': 1, 'y': 0}, 1),
            {'x': 0, 'y': y_pair + pair_height}, {'x': 1, 'y': 0}, -1,
        )
        if len(band) < 3:
            continue
        for jx, center_x in enumerate(x_centers):
            x = bb['minX'] + center_x - w / 2 + dx0
            if is_dome:
                for k in range(nb_dome):
                    push_slot(x, y_pair + k * (l + dome_panel_gap), l, jx, jy, k)
            else:
                push_slot(x, y_pair, l, jx, jy)

    # Filtre OBLIGATOIRE (toujours actif dès que shedGroupSize>1) : un empilement (jx, module)
    # incomplet (< shedGroupSize panneaux survivants) est entièrement retiré.
    if is_shed and shed_group_size > 1:
        def jx_of(idx_key):
            return int(idx_key.split('-')[0])

        def jy_of(idx_key):
            return int(idx_key.split('-')[1])

        def module_of(jy):
            return jy // shed_group_size

        count_by_stack = {}
        for s in slots:
            if s['deleted']:
                continue
            key = f'{jx_of(s["idxKey"])}-{module_of(jy_of(s["idxKey"]))}'
            count_by_stack[key] = count_by_stack.get(key, 0) + 1
        for s in slots:
            if s['deleted']:
                continue
            key = f'{jx_of(s["idxKey"])}-{module_of(jy_of(s["idxKey"]))}'
            if count_by_stack.get(key, 0) < shed_group_size:
                s['deleted'] = True

    # Filtre OPTIONNEL "Sheds réguliers" (case à cocher) : ne garde que les tables COMPLÈTES
    # (exactement shed_group_size x shed_panels_per_row panneaux) ; une table incomplète est retirée.
    if shed_regulier_actif:
        count_by_table = {}
        for s in slots:
            if s['deleted']:
                continue
            jx, jy = (int(v) for v in s['idxKey'].split('-')[:2])
            key = cle_table(jx, jy)
            count_by_table[key] = count_by_table.get(key, 0) + 1
        for s in slots:
            if s['deleted']:
                continue
            jx, jy = (int(v) for v in s['idxKey'].split('-')[:2])
            if count_by_table.get(cle_table(jx, jy), 0) != panneaux_par_table:
                s['deleted'] = True

    return slots


def shed_regulier_applicable(ctx):
    """Port de shedRegulierApplicable : Esp. groupe de shed > 0 ET Nb. PV en long. par shed > 0."""
    return (ctx.get('shedPanelsPerRow') or 0) > 0 and (ctx.get('shedRowGroupSpacingM') or 0) > 0


def pack_panels_for_pan(pan, ctx):
    """Port de packPanelsForPan(pan) : liste des slots survivants, non supprimés."""
    slots = compute_candidate_panel_slots(pan, ctx)
    if slots is None:
        return None
    return [s for s in slots if not s['deleted']]


# ------------------------------------------------------------------------------------------
# Point d'entrée : vérifie l'état complet d'une maison (tous ses pans)
# ------------------------------------------------------------------------------------------
def _build_ctx(state):
    return {
        'panelLengthM': (state.get('panelLengthMm') or 0) / 1000,
        'panelWidthM': (state.get('panelWidthMm') or 0) / 1000,
        'panelSpacingXM': (state.get('panelSpacingXMm') or 0) / 1000,
        'panelSpacingYM': (state.get('panelSpacingYMm') or 0) / 1000,
        'panelOrientation': state.get('panelOrientation') or 'portrait',
        'penteDeg': state.get('penteDeg') or 0,
        'overhangRampant': state.get('overhangRampant') or 0,
        'overhangLongpan': state.get('overhangLongpan') or 0,
        'edgeClearanceM': state.get('edgeClearanceM') or 0,
        'ridgeClearanceEachSideM': state.get('ridgeClearanceEachSideM') or 0,
        'divisionMode': state.get('divisionMode') or 'none',
        'contourMode': state.get('contourMode') or 'rect',
        'rectAzimuthOffsetDeg': state.get('rectAzimuthOffsetDeg') or 0,
        'obstacles': state.get('obstacles') or [],
        'gridOffsetByPan': state.get('gridOffsetByPan') or {},
        'deletedPanelIndicesByPan': state.get('deletedPanelIndicesByPan') or {},
        'shedSpacingM': state.get('shedSpacingM') or 0,
        'shedPanelsPerRow': state.get('shedPanelsPerRow') or 0,
        'shedRowGroupSpacingM': state.get('shedRowGroupSpacingM') or 0,
        'shedPanelsPerGroup': state.get('shedPanelsPerGroup') or 1,
        'shedRegularAlignment': bool(state.get('shedRegularAlignment')),
        'domeSpacingM': state.get('domeSpacingM') or 0,
        'domePanelSpacingM': state.get('domePanelSpacingM') or 0,
        'domeTiltDeg': state.get('domeTiltDeg') or 0,
        'domePanelsPerRow': state.get('domePanelsPerRow'),
        'jointDilatation': _params_joint_dilatation(state),
    }


def verify_maison_state(state, include_positions=False):
    """Recalcule, pan par pan, le nombre de panneaux d'une maison résidentielle (état sérialisé
    tel qu'envoyé par le frontend, cf. calepinage_maison_verif_test.js::buildVerifPayload()).

    Retourne {'pans': [...], 'totalPanelCount': int, 'anyUnsupported': bool}. Un pan dans un
    poseMode inconnu (futur ajout non encore porté) serait marqué skipped=True (jamais compté comme
    0 silencieusement faux) — tous les poseMode actuels sont couverts.
    """
    ctx = _build_ctx(state)
    pans_result = []
    total = 0
    any_unsupported = False

    for pan in state.get('pans') or []:
        pose_mode = pan.get('poseMode', 'incline')
        if pose_mode not in SUPPORTED_POSE_MODES:
            any_unsupported = True
            pans_result.append({
                'panId': pan.get('id'), 'poseMode': pose_mode,
                'skipped': True, 'reason': f"poseMode '{pose_mode}' non reconnu/non supporté",
                'panelCount': None,
            })
            continue
        try:
            panels = pack_panels_for_pan(pan, ctx)
            count = len(panels) if panels is not None else 0
            pan_result = {'panId': pan.get('id'), 'poseMode': pose_mode, 'skipped': False, 'panelCount': count}
            if include_positions:
                # Uniquement {cx, cy, w, l, angle} — pas idxKey/deleted (déjà filtrés par
                # pack_panels_for_pan), ni la structure interne, pour un contrat d'API minimal côté
                # frontend (cf. calepinage_maison_verif_test.js::applyBackendOverride).
                pan_result['panels'] = [
                    {'cx': p['cx'], 'cy': p['cy'], 'w': p['w'], 'l': p['l'], 'angle': p['angle']}
                    for p in (panels or [])
                ]
            pans_result.append(pan_result)
            total += count
        except Exception as e:  # défensif : un pan malformé ne doit jamais faire échouer les autres
            pans_result.append({
                'panId': pan.get('id'), 'poseMode': pose_mode,
                'skipped': True, 'reason': f'Erreur de calcul : {e}', 'panelCount': None,
            })
            any_unsupported = True

    return {'pans': pans_result, 'totalPanelCount': total, 'anyUnsupported': any_unsupported}
