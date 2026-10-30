"""
ombriere.py — Logique métier de l'ombrière solaire (Solakvan)
Toute la logique de calcul extraite de ombriere.js
"""

import math
import re


from app.services.terrain.profil_plans import caler_table, sol_du_plan


def _sol(data, plan):
    """Sol réel du plan ('coupe' | 'facade') envoyé par le navigateur, ou None (dessin historique)."""
    try:
        return sol_du_plan(data, plan)
    except Exception:
        return None


def _sol_ou_plat(data, plan):
    """Fonction de sol toujours appelable : terrain réel, sinon sol plat (y = 0)."""
    return _sol(data, plan) or (lambda x: 0.0)


def _cote_au_sol(sol, x_cote, y_cible, x_pied=None):
    """(text, ground_y) d'une cotation verticale : la cote descend jusqu'au sol et affiche la
    hauteur MESURÉE (même règle qu'à l'écran, cf. drawVerticalDimensionWithLeader).
    `x_pied` : mesure au droit du poteau (hauteur sous bracon, passage) au lieu de la ligne de cote."""
    x = x_pied if x_pied is not None else x_cote
    ground_y = sol(x)
    return f"{ground_y - y_cible:.2f}m", sol(x_cote) if x_pied is None else ground_y


def intersect(p1, p2, p3, p4):
    den = (p1['x'] - p2['x']) * (p3['y'] - p4['y']) - (p1['y'] - p2['y']) * (p3['x'] - p4['x'])
    if den == 0: return None
    t = ((p1['x'] - p3['x']) * (p3['y'] - p4['y']) - (p1['y'] - p3['y']) * (p3['x'] - p4['x'])) / den
    return {'x': p1['x'] + t * (p2['x'] - p1['x']), 'y': p1['y'] + t * (p2['y'] - p1['y'])}

def draw_brace(p_post, p_beam, beam_line, post_line, brace_width):
    b_ang = math.atan2(p_beam['y'] - p_post['y'], p_beam['x'] - p_post['x'])
    perp = b_ang + math.pi/2
    hw = brace_width / 2
    
    lt = {'p1': {'x': p_post['x'] + hw*math.cos(perp), 'y': p_post['y'] + hw*math.sin(perp)},
          'p2': {'x': p_beam['x'] + hw*math.cos(perp), 'y': p_beam['y'] + hw*math.sin(perp)}}
    lb = {'p1': {'x': p_post['x'] - hw*math.cos(perp), 'y': p_post['y'] - hw*math.sin(perp)},
          'p2': {'x': p_beam['x'] - hw*math.cos(perp), 'y': p_beam['y'] - hw*math.sin(perp)}}
          
    p1 = intersect(lt['p1'], lt['p2'], post_line['p1'], post_line['p2'])
    p2 = intersect(lt['p1'], lt['p2'], beam_line['p1'], beam_line['p2'])
    p3 = intersect(lb['p1'], lb['p2'], beam_line['p1'], beam_line['p2'])
    p4 = intersect(lb['p1'], lb['p2'], post_line['p1'], post_line['p2'])
    
    if p1 and p2 and p3 and p4:
        return [p1, p2, p3, p4]
    return None


def _geom_extent_x(geom):
    """Étendue en X de tout ce qui est déjà dans `geom` (shapes + cotes + lignes de renvoi)."""
    xs = []
    for s in geom.get('shapes', []):
        if s['type'] == 'polygon':
            xs.extend(p['x'] for p in s['points'])
        else:
            xs.append(s['x'])
            xs.append(s['x'] + s['w'])
    for d in geom.get('dimensions', []):
        xs.append(d['x1'])
        xs.append(d['x2'])
    for l in geom.get('leaders', []):
        xs.append(l['x_target'])
        xs.append(l['x_dim_line'])
    if not xs:
        return -1.0, 1.0
    return min(xs), max(xs)


def _tag_default_categories(geom, panel_fill='#374151'):
    """
    Étiquette chaque shape non encore catégorisée : 'panel' pour le remplissage
    du panneau PV (seul élément rempli avec `panel_fill`), 'structure' pour tout
    le reste (poteaux, pannes, traverses, bracons...). Évite d'éditer une à une
    les nombreuses lignes `geom['shapes'].append(...)` ci-dessus.
    """
    for s in geom.get('shapes', []):
        if s.get('category'):
            continue
        s['category'] = 'panel' if s.get('fill') == panel_fill else 'structure'
    return geom


def add_ground_hatching(geom, ground_y_fn, margin=0.6, depth=0.4, spacing=0.3):
    """
    Ajoute la ligne de sol + hachures obliques (45°) sous le dessin, sur toute la
    largeur déjà occupée par les formes/cotes/lignes de renvoi (+ marge). La ligne
    de sol passe exactement par ground_y_fn(x) : toutes les cotes verticales
    (qui s'arrêtent au sol, ground_y=ground_y_fn(x)) se terminent donc pile sur
    la hachure, jamais "en l'air" au-dessus.
    """
    min_x, max_x = _geom_extent_x(geom)
    min_x -= margin
    max_x += margin

    n = max(2, int((max_x - min_x) / 0.5) + 1)
    sol_pts = [
        {'x': min_x + i * (max_x - min_x) / (n - 1), 'y': ground_y_fn(min_x + i * (max_x - min_x) / (n - 1))}
        for i in range(n)
    ]
    for i in range(len(sol_pts) - 1):
        geom['shapes'].append({
            'type': 'polygon', 'points': [sol_pts[i], sol_pts[i + 1]],
            'stroke': '#374151', 'lineWidth': 1.2, 'category': 'hatching',
        })

    x = min_x
    while x <= max_x:
        gy = ground_y_fn(x)
        geom['shapes'].append({
            'type': 'polygon',
            'points': [{'x': x, 'y': gy}, {'x': x + depth, 'y': gy + depth}],
            'stroke': '#9CA3AF', 'lineWidth': 0.4, 'category': 'hatching',
        })
        x += spacing
    return geom


def _transform_pt(p, angle, offset_x, offset_y):
    ca, sa = math.cos(angle), math.sin(angle)
    return {'x': offset_x + p['x'] * ca - p['y'] * sa, 'y': offset_y + p['x'] * sa + p['y'] * ca}


def _add_roof_segment(geom, angle, beam_offset, center_y, beam_length, panel_width, purlin_count,
                       purlin_height, integration_system_height, panel_thickness, beam_height,
                       roof_color, integration_color):
    """
    Une travée de toiture "standard" (poutre symétrique centrée sur `beam_offset`
    + pannes + panneau), réutilisée à l'identique pour chaque unité du modèle
    'linked' (Centrés liaisonnés) - même primitives que la branche standard de
    generate_coupe (add_roof), simplifiée (pas de débord asymétrique).
    """
    tf = {'x': beam_offset, 'y': center_y, 'angle': angle}
    geom['shapes'].append({
        'type': 'rect', 'x': -beam_length / 2, 'y': -beam_height / 2, 'w': beam_length, 'h': beam_height,
        'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf,
    })

    p_size = 0.08
    p_eff = beam_length - p_size
    p_spacing = p_eff / (purlin_count - 1) if purlin_count > 1 else 0
    for i in range(purlin_count):
        x_pos = 0 if purlin_count == 1 else -beam_length / 2 + p_size / 2 + i * p_spacing
        geom['shapes'].append({
            'type': 'rect', 'x': x_pos - p_size / 2, 'y': -beam_height / 2 - purlin_height, 'w': p_size, 'h': purlin_height,
            'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf,
        })

    int_y = -beam_height / 2 - purlin_height - integration_system_height
    pan_y = int_y - panel_thickness
    geom['shapes'].append({'type': 'rect', 'x': -panel_width / 2, 'y': int_y, 'w': panel_width, 'h': integration_system_height, 'fill': integration_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})
    geom['shapes'].append({'type': 'rect', 'x': -panel_width / 2, 'y': pan_y, 'w': panel_width, 'h': panel_thickness, 'fill': roof_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})


def _add_y_arm_segment(geom, angle, beam_offset, center_y, arm_length, post_width, purlin_count,
                        purlin_height, integration_system_height, panel_thickness, beam_height,
                        roof_color, integration_color):
    """
    Un bras de toiture "Y" (départ au bord du poteau, s'étend de `arm_length`
    vers l'extérieur) - même convention que la branche is_y_arm de add_roof
    dans generate_coupe, réutilisée pour chaque bras du modèle 'doubleYShape'
    (bras "de jonction" entre deux poteaux voisins : arm_length raccourci pour
    rejoindre le milieu de l'entraxe, sans débord).
    """
    start_x = -post_width / 2 if angle > 0 else post_width / 2
    c_beam_len = -arm_length if angle > 0 else arm_length
    beam_draw_x = start_x + c_beam_len if angle > 0 else start_x
    beam_draw_w = abs(c_beam_len)

    tf = {'x': beam_offset, 'y': center_y, 'angle': angle}
    geom['shapes'].append({
        'type': 'rect', 'x': beam_draw_x, 'y': -beam_height / 2, 'w': beam_draw_w, 'h': beam_height,
        'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf,
    })

    p_size = 0.08
    p_eff = beam_draw_w - p_size
    p_count = max(2, purlin_count // 2)
    p_spacing = p_eff / (p_count - 1) if p_count > 1 else 0
    for i in range(p_count):
        x_pos = start_x + c_beam_len / 2 if p_count == 1 else start_x + (p_size / 2 + i * p_spacing if c_beam_len > 0 else -p_size / 2 - i * p_spacing)
        geom['shapes'].append({
            'type': 'rect', 'x': x_pos - p_size / 2, 'y': -beam_height / 2 - purlin_height, 'w': p_size, 'h': purlin_height,
            'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf,
        })

    int_y = -beam_height / 2 - purlin_height - integration_system_height
    pan_y = int_y - panel_thickness
    geom['shapes'].append({'type': 'rect', 'x': beam_draw_x, 'y': int_y, 'w': beam_draw_w, 'h': integration_system_height, 'fill': integration_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})
    geom['shapes'].append({'type': 'rect', 'x': beam_draw_x, 'y': pan_y, 'w': beam_draw_w, 'h': panel_thickness, 'fill': roof_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})


def _generate_coupe_linked(data, computed):
    """
    Poteaux centrés liaisonnés ('linked') : N unités de coupe "single" standard
    (une par panneau, cf. `linked_panels_count`), espacées de `post_spacing`
    (garde-fou anti-chevauchement identique au JS :
    min_spacing = panel_width * cos(|pente|), sinon spacing = min_spacing+0.01),
    reliées entre elles par des traverses de liaison rectangulaires entre les
    extrémités de leurs poutres. Simplification par rapport au JS d'origine :
    pas d'extension "eave" de la poutre côté liaison (visuellement équivalent,
    la traverse de liaison assure déjà la continuité visuelle entre unités).
    """
    # Terrain réel sous la coupe (profil envoyé par le navigateur) ; sol plat sans terrain.
    sol_coupe = _sol_ou_plat(data, 'coupe')
    geom = {'shapes': [], 'dimensions': [], 'leaders': [], 'texts': []}
    roof_color = '#374151'
    integration_color = '#9CA3AF'

    post_height = computed.get('post_height', 0)
    roof_slope_radians = computed.get('roof_slope_radians', 0)
    beam_length = computed.get('beam_length', 0)
    post_width = float(data.get('post_width', 0.4))
    beam_height = float(data.get('beam_height', 0.2))
    purlin_height = float(data.get('purlin_height', 0.2))
    integration_system_height = float(data.get('integration_system_height', 0.1))
    panel_thickness = float(data.get('panel_thickness', 0.05))
    panel_width = float(data.get('panel_width', 0))
    purlin_count = int(data.get('purlin_count', 6))
    height_under_brace = float(data.get('height_under_brace', 2.0))
    brace_fix_percentage = float(data.get('brace_fix_percentage', 70))
    brace_width = float(data.get('brace_width', 0.15))
    reinforcement_type = data.get('reinforcement_type', 'bracons')
    linked_panels_count = int(data.get('linked_panels_count', 2) or 2)

    angle = roof_slope_radians
    beam_center_y = -post_height - beam_height / 2

    min_spacing = panel_width * math.cos(abs(roof_slope_radians))
    post_spacing_input = float(data.get('post_spacing', 15.0) or 15.0)
    spacing = post_spacing_input if post_spacing_input > min_spacing else min_spacing + 0.01

    panel_count = max(2, linked_panels_count)
    total_width = (panel_count - 1) * spacing
    start_x = -total_width / 2
    unit_centers = []

    for i in range(panel_count):
        cx = start_x + i * spacing
        unit_centers.append(cx)

        post_left_x, post_right_x = cx - post_width / 2, cx + post_width / 2
        geom['shapes'].append({
            'type': 'polygon',
            'points': [{'x': post_left_x, 'y': sol_coupe(post_left_x)}, {'x': post_left_x, 'y': -post_height},
                       {'x': post_right_x, 'y': -post_height}, {'x': post_right_x, 'y': sol_coupe(post_right_x)}],
            'stroke': '#000000', 'lineWidth': 1.5,
        })

        if reinforcement_type == 'bracons' and post_height > height_under_brace:
            beam_line = {
                'p1': _transform_pt({'x': -100, 'y': beam_height / 2}, angle, cx, beam_center_y),
                'p2': _transform_pt({'x': 100, 'y': beam_height / 2}, angle, cx, beam_center_y),
            }
            for sign in (-1, 1):
                post_edge_x = cx + sign * post_width / 2
                attach_dist = (beam_length / 2) * (brace_fix_percentage / 100)
                brace_end_beam = _transform_pt({'x': sign * attach_dist, 'y': beam_height / 2}, angle, cx, beam_center_y)
                pel = {'p1': {'x': post_edge_x, 'y': -100}, 'p2': {'x': post_edge_x, 'y': 100}}
                pts = draw_brace({'x': post_edge_x, 'y': -height_under_brace}, brace_end_beam, beam_line, pel, brace_width)
                if pts:
                    geom['shapes'].append({'type': 'polygon', 'points': pts, 'stroke': '#000000', 'lineWidth': 1})

        _add_roof_segment(geom, angle, cx, beam_center_y, beam_length, panel_width, purlin_count,
                           purlin_height, integration_system_height, panel_thickness, beam_height,
                           roof_color, integration_color)

    # --- Traverses de liaison entre unités consécutives ---
    for i in range(panel_count - 1):
        c1, c2 = unit_centers[i], unit_centers[i + 1]
        p1 = _transform_pt({'x': beam_length / 2, 'y': -beam_height / 2}, angle, c1, beam_center_y)
        p2 = _transform_pt({'x': beam_length / 2, 'y': beam_height / 2}, angle, c1, beam_center_y)
        p3 = _transform_pt({'x': -beam_length / 2, 'y': beam_height / 2}, angle, c2, beam_center_y)
        p4 = _transform_pt({'x': -beam_length / 2, 'y': -beam_height / 2}, angle, c2, beam_center_y)
        geom['shapes'].append({'type': 'polygon', 'points': [p1, p2, p3, p4], 'stroke': '#000000', 'lineWidth': 1.5})

    # --- Cotation entraxe ---
    for i in range(panel_count - 1):
        geom['dimensions'].append({
            'x1': unit_centers[i], 'y1': 1.6, 'x2': unit_centers[i + 1], 'y2': 1.6,
            'text': f"{spacing:.2f}m", 'offset': 0, 'isVertical': False,
        })

    _tag_default_categories(geom)
    add_ground_hatching(geom, sol_coupe)
    return geom


def _generate_coupe_double_y(data, computed):
    """
    Double toiture Y ('doubleYShape') : N structures "Toiture Y" chaînées (cf.
    `double_y_shape_panels_count`). Les bras intérieurs (côté voisin) sont
    étirés jusqu'au milieu de l'entraxe et alignés sans débord (jonction) ;
    les bras extérieurs (aux deux bouts de la chaîne) gardent le débord
    standard de la "Toiture Y" (beam_length = panel_width/2 - overhang).
    """
    # Terrain réel sous la coupe (profil envoyé par le navigateur) ; sol plat sans terrain.
    sol_coupe = _sol_ou_plat(data, 'coupe')
    geom = {'shapes': [], 'dimensions': [], 'leaders': [], 'texts': []}
    roof_color = '#374151'
    integration_color = '#9CA3AF'

    post_height = computed.get('post_height', 0)
    roof_slope_radians = computed.get('roof_slope_radians', 0)
    beam_length = computed.get('beam_length', 0)
    post_width = float(data.get('post_width', 0.4))
    beam_height = float(data.get('beam_height', 0.2))
    purlin_height = float(data.get('purlin_height', 0.2))
    integration_system_height = float(data.get('integration_system_height', 0.1))
    panel_thickness = float(data.get('panel_thickness', 0.05))
    purlin_count = int(data.get('purlin_count', 6))
    height_under_brace = float(data.get('height_under_brace', 2.0))
    brace_fix_percentage = float(data.get('brace_fix_percentage', 70))
    brace_width = float(data.get('brace_width', 0.15))
    reinforcement_type = data.get('reinforcement_type', 'bracons')
    invert_slope = bool(data.get('invert_slope', False))
    double_y_panels_count = int(data.get('double_y_shape_panels_count', 2) or 2)

    beam_center_y = -post_height + (beam_height / 2) * math.cos(abs(roof_slope_radians)) - 0.03

    post_spacing_input = float(data.get('post_spacing', 12.58) or 12.58)
    panel_count = max(2, double_y_panels_count)
    total_width = (panel_count - 1) * post_spacing_input
    start_x = -total_width / 2
    cos_slope = math.cos(roof_slope_radians)
    inner_arm_length = (max(0.0, (post_spacing_input - post_width) / 2) / cos_slope) if cos_slope else beam_length

    for i in range(panel_count):
        cx = start_x + i * post_spacing_input
        has_left, has_right = i > 0, i < panel_count - 1

        geom['shapes'].append({
            'type': 'polygon',
            'points': [{'x': cx - post_width / 2, 'y': sol_coupe(cx - post_width / 2)}, {'x': cx - post_width / 2, 'y': -post_height},
                       {'x': cx + post_width / 2, 'y': -post_height}, {'x': cx + post_width / 2, 'y': sol_coupe(cx + post_width / 2)}],
            'stroke': '#000000', 'lineWidth': 1.5,
        })

        for side_sign, has_neighbor in ((-1, has_left), (1, has_right)):
            arm_angle = (roof_slope_radians if side_sign < 0 else -roof_slope_radians) * (-1 if invert_slope else 1)
            arm_length = inner_arm_length if has_neighbor else beam_length
            _add_y_arm_segment(geom, arm_angle, cx, beam_center_y, arm_length, post_width, purlin_count,
                                purlin_height, integration_system_height, panel_thickness, beam_height,
                                roof_color, integration_color)

            if reinforcement_type == 'bracons' and post_height > height_under_brace:
                beam_line = {
                    'p1': _transform_pt({'x': -100, 'y': beam_height / 2}, arm_angle, cx, beam_center_y),
                    'p2': _transform_pt({'x': 100, 'y': beam_height / 2}, arm_angle, cx, beam_center_y),
                }
                post_edge_x = cx + side_sign * post_width / 2
                attach_dist = beam_length * (brace_fix_percentage / 100)
                brace_end_beam = _transform_pt({'x': side_sign * attach_dist, 'y': beam_height / 2}, arm_angle, cx, beam_center_y)
                pel = {'p1': {'x': post_edge_x, 'y': -100}, 'p2': {'x': post_edge_x, 'y': 100}}
                pts = draw_brace({'x': post_edge_x, 'y': -height_under_brace}, brace_end_beam, beam_line, pel, brace_width)
                if pts:
                    geom['shapes'].append({'type': 'polygon', 'points': pts, 'stroke': '#000000', 'lineWidth': 1})

    for i in range(panel_count - 1):
        geom['dimensions'].append({
            'x1': start_x + i * post_spacing_input, 'y1': 1.6,
            'x2': start_x + (i + 1) * post_spacing_input, 'y2': 1.6,
            'text': f"{post_spacing_input:.2f}m", 'offset': 0, 'isVertical': False,
        })

    _tag_default_categories(geom)
    add_ground_hatching(geom, sol_coupe)
    return geom


def generate_coupe(data, computed):
    # Terrain réel sous la coupe (profil envoyé par le navigateur) ; sol plat sans terrain.
    sol_coupe = _sol_ou_plat(data, 'coupe')
    post_model_dispatch = data.get('post_model', 'single')
    if post_model_dispatch == 'linked':
        return _generate_coupe_linked(data, computed)
    if post_model_dispatch == 'doubleYShape':
        return _generate_coupe_double_y(data, computed)

    geom = {'shapes': [], 'dimensions': [], 'leaders': [], 'texts': []}
    roof_color = '#374151'
    integration_color = '#9CA3AF'

    post_model = data.get('post_model', 'single')
    traverse_position = data.get('traverse_position', 'top')
    invert_slope = bool(data.get('invert_slope', False))
    offset_post_side = data.get('offset_post_side', 'center')
    reinforcement_type = data.get('reinforcement_type', 'bracons')
    show_brace_left = bool(data.get('show_brace_left', True))
    show_brace_right = bool(data.get('show_brace_right', True))
    
    post_height = computed.get('post_height', 0)
    roof_slope_radians = computed.get('roof_slope_radians', 0)
    beam_length = computed.get('beam_length', 0)
    post_width = float(data.get('post_width', 0.4))
    beam_height = float(data.get('beam_height', 0.2))
    passage_height = float(data.get('passage_height', 0))
    purlin_height = float(data.get('purlin_height', 0.2))
    integration_system_height = float(data.get('integration_system_height', 0.1))
    panel_thickness = float(data.get('panel_thickness', 0.05))
    post_eccentricity = computed.get('post_eccentricity_clamped', 0)
    panel_width = float(data.get('panel_width', 0))
    purlin_count = int(data.get('purlin_count', 6))
    overhang_sym_value = float(data.get('overhang_sym_value', 0))
    height_under_brace = float(data.get('height_under_brace', 2.0))
    brace_fix_percentage = float(data.get('brace_fix_percentage', 70))
    brace_width = float(data.get('brace_width', 0.15))
    
    angle = roof_slope_radians
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    
    beam_offset = 0 if (post_model == 'y_shape' or data.get('overhang_type') == 'sym') else (computed.get('overhang_l', 0) - computed.get('overhang_h', 0)) / 2
    
    def transform_pt(p, local_angle, offset_x, offset_y):
        ca = math.cos(local_angle)
        sa = math.sin(local_angle)
        return {'x': offset_x + p['x']*ca - p['y']*sa, 'y': offset_y + p['x']*sa + p['y']*ca}

    if post_model == 'y_shape':
        beam_center_y = -post_height + (beam_height / 2) * math.cos(abs(roof_slope_radians))
    elif traverse_position == 'top':
        beam_center_y = -post_height - beam_height / 2
    else:
        beam_center_y = -post_height
        
    def get_beam_line(y_offset, local_angle=angle, local_beam_offset=beam_offset, local_center_y=beam_center_y):
        ll = 100
        lc = math.cos(local_angle)
        ls = math.sin(local_angle)
        return {
            'p1': {'x': local_beam_offset + (-ll)*lc - y_offset*ls, 'y': local_center_y + (-ll)*ls + y_offset*lc},
            'p2': {'x': local_beam_offset + ll*lc - y_offset*ls, 'y': local_center_y + ll*ls + y_offset*lc}
        }
        
    beam_top_line = get_beam_line(-beam_height / 2)
    beam_bottom_line = get_beam_line(beam_height / 2)
    beam_intersect_line = beam_bottom_line

    # === POTEAUX & RENFORTS ===
    base_post_x = 0
    if post_model in ['single', 'offset', 'y_shape']:
        if post_model == 'offset' and offset_post_side != 'center':
            half_panel_horizontal = (panel_width / 2) * math.cos(abs(roof_slope_radians))
            if offset_post_side == 'low': base_post_x = half_panel_horizontal if invert_slope else -half_panel_horizontal
            if offset_post_side == 'high': base_post_x = -half_panel_horizontal if invert_slope else half_panel_horizontal
        
        post_center_x = base_post_x + post_eccentricity
        post_top_y = -post_height
        
        if post_model != 'y_shape':
            post_left_x = post_center_x - post_width / 2
            post_right_x = post_center_x + post_width / 2
            line_left = {'p1': {'x': post_left_x, 'y': 100}, 'p2': {'x': post_left_x, 'y': -100}}
            line_right = {'p1': {'x': post_right_x, 'y': 100}, 'p2': {'x': post_right_x, 'y': -100}}
            pt_left = intersect(line_left['p1'], line_left['p2'], beam_intersect_line['p1'], beam_intersect_line['p2'])
            pt_right = intersect(line_right['p1'], line_right['p2'], beam_intersect_line['p1'], beam_intersect_line['p2'])
            y_left = pt_left['y'] if pt_left else beam_center_y
            y_right = pt_right['y'] if pt_right else beam_center_y
        else:
            post_left_x = post_center_x - post_width / 2
            post_right_x = post_center_x + post_width / 2
            y_left = -post_height
            y_right = -post_height
            
        geom['shapes'].append({
            'type': 'polygon',
            'points': [{'x': post_left_x, 'y': sol_coupe(post_left_x)}, {'x': post_left_x, 'y': y_left},
                       {'x': post_right_x, 'y': y_right}, {'x': post_right_x, 'y': sol_coupe(post_right_x)}],
            'stroke': '#000000', 'lineWidth': 1.5
        })
        
        # Le jarret est fixé à 0,35 m sous la traverse : pas de dépendance à la hauteur sous renfort
        # (miroir de drawTheReinforcements dans ombriere_metal.js).
        renfort_dessinable = (
            (reinforcement_type == 'bracons' and post_height > height_under_brace)
            or (reinforcement_type == 'jarrets' and post_height > 0.35)
        )
        if renfort_dessinable:
            for side in ['left', 'right']:
                if side == 'left' and not show_brace_left and post_model != 'y_shape': continue
                if side == 'right' and not show_brace_right and post_model != 'y_shape': continue
                
                sign = 1 if side == 'right' else -1
                post_edge_x = post_center_x + sign * post_width / 2
                
                c_angle = angle
                c_beam_bottom = beam_bottom_line
                c_beam_offset = beam_offset
                c_beam_length = beam_length
                
                if post_model == 'y_shape':
                    c_angle = roof_slope_radians if side == 'left' else -roof_slope_radians
                    if invert_slope: c_angle *= -1
                    c_beam_bottom = get_beam_line(beam_height/2, c_angle, 0, beam_center_y)
                    c_beam_offset = 0
                    
                attach_dist = (c_beam_length / 2) * (brace_fix_percentage / 100) if post_model != 'y_shape' else c_beam_length * (brace_fix_percentage / 100)
                end_rot = {'x': sign * attach_dist, 'y': beam_height / 2}
                
                brace_end_beam = {
                    'x': c_beam_offset + end_rot['x']*math.cos(c_angle) - end_rot['y']*math.sin(c_angle),
                    'y': beam_center_y + end_rot['x']*math.sin(c_angle) + end_rot['y']*math.cos(c_angle)
                }
                
                pel = {'p1': {'x': post_edge_x, 'y': -100}, 'p2': {'x': post_edge_x, 'y': 100}}
                
                if reinforcement_type == 'bracons':
                    brace_attach_post_y = -height_under_brace
                    pts = draw_brace({'x': post_edge_x, 'y': brace_attach_post_y}, brace_end_beam, c_beam_bottom, pel, brace_width)
                    if pts: geom['shapes'].append({'type': 'polygon', 'points': pts, 'stroke': '#000000', 'lineWidth': 1})
                elif reinforcement_type == 'jarrets':
                    jarret_height = 0.35
                    post_on_beam = intersect(pel['p1'], pel['p2'], c_beam_bottom['p1'], c_beam_bottom['p2'])
                    if post_on_beam:
                        jarret_attach_y = post_on_beam['y'] + jarret_height
                        geom['shapes'].append({
                            'type': 'polygon',
                            'points': [{'x': post_edge_x, 'y': jarret_attach_y}, brace_end_beam, post_on_beam],
                            'stroke': '#000000', 'lineWidth': 1
                        })
    elif post_model in ['double', 'inclinedPost']:
        is_inclined = (post_model == 'inclinedPost')
        post_spacing = float(data.get('post_spacing', 0))
        post_spacing_inclined = float(data.get('post_spacing_inclined', 0))
        post_inclination_inclined = float(data.get('post_inclination_inclined', 65))
        spacing = (post_spacing_inclined if is_inclined else post_spacing) / 2
        
        for sign in [-1, 1]:
            post_x = sign * spacing
            if is_inclined:
                angle_from_vertical = (90 - post_inclination_inclined) * math.pi / 180
                vx = sign * math.sin(angle_from_vertical)
                vy = -math.cos(angle_from_vertical)
                
                post_axis_line = {'p1': {'x': post_x, 'y': sol_coupe(post_x)}, 'p2': {'x': post_x + vx * 100, 'y': vy * 100}}
                intersect_top = intersect(post_axis_line['p1'], post_axis_line['p2'], beam_top_line['p1'], beam_top_line['p2'])
                intersect_bottom = intersect(post_axis_line['p1'], post_axis_line['p2'], beam_bottom_line['p1'], beam_bottom_line['p2'])
                
                top_center = intersect_bottom if traverse_position == 'top' else intersect_top
                if top_center:
                    perp_angle = math.atan2(vy, vx) + math.pi / 2
                    dx_perp = math.cos(perp_angle) * (post_width / 2)
                    dy_perp = math.sin(perp_angle) * (post_width / 2)
                    
                    left_side = {'p1': {'x': top_center['x'] - dx_perp, 'y': top_center['y'] - dy_perp}, 'p2': {'x': top_center['x'] - dx_perp + vx * 100, 'y': top_center['y'] - dy_perp + vy * 100}}
                    right_side = {'p1': {'x': top_center['x'] + dx_perp, 'y': top_center['y'] + dy_perp}, 'p2': {'x': top_center['x'] + dx_perp + vx * 100, 'y': top_center['y'] + dy_perp + vy * 100}}
                    # Sol au droit du poteau incliné (ligne horizontale à ce niveau).
                    ground_line = {'p1': {'x': -100, 'y': sol_coupe(post_x)}, 'p2': {'x': 100, 'y': sol_coupe(post_x)}}
                    
                    bl = intersect(left_side['p1'], left_side['p2'], ground_line['p1'], ground_line['p2'])
                    br = intersect(right_side['p1'], right_side['p2'], ground_line['p1'], ground_line['p2'])
                    
                    top_cut_line = {'p1': {'x': top_center['x'] - cos_a * 100, 'y': top_center['y'] - sin_a * 100}, 'p2': {'x': top_center['x'] + cos_a * 100, 'y': top_center['y'] + sin_a * 100}}
                    tl = intersect(top_cut_line['p1'], top_cut_line['p2'], left_side['p1'], left_side['p2'])
                    tr = intersect(top_cut_line['p1'], top_cut_line['p2'], right_side['p1'], right_side['p2'])
                    
                    if bl and br and tl and tr:
                        geom['shapes'].append({'type': 'polygon', 'points': [bl, tl, tr, br], 'stroke': '#000000', 'lineWidth': 1.5})
            else:
                post_left_x = post_x - post_width / 2
                post_right_x = post_x + post_width / 2
                line_left = {'p1': {'x': post_left_x, 'y': 100}, 'p2': {'x': post_left_x, 'y': -100}}
                line_right = {'p1': {'x': post_right_x, 'y': 100}, 'p2': {'x': post_right_x, 'y': -100}}
                pt_left = intersect(line_left['p1'], line_left['p2'], beam_intersect_line['p1'], beam_intersect_line['p2'])
                pt_right = intersect(line_right['p1'], line_right['p2'], beam_intersect_line['p1'], beam_intersect_line['p2'])
                y_left = pt_left['y'] if pt_left else beam_center_y
                y_right = pt_right['y'] if pt_right else beam_center_y
                
                if post_model == 'double' and data.get('double_post_bracing', 'v1') == 'v6' and reinforcement_type == 'bracons':
                    y_left = -height_under_brace
                    y_right = -height_under_brace
                    
                geom['shapes'].append({
                    'type': 'polygon',
                    'points': [{'x': post_left_x, 'y': sol_coupe(post_left_x)}, {'x': post_left_x, 'y': y_left},
                               {'x': post_right_x, 'y': y_right}, {'x': post_right_x, 'y': sol_coupe(post_right_x)}],
                    'stroke': '#000000', 'lineWidth': 1.5
                })
        
        if post_model == 'double' and bool(data.get('show_double_bracing', True)):
            brace_height = -height_under_brace
            attach_dist = (beam_length / 2) * (brace_fix_percentage / 100)
            p_inner_left = -spacing + post_width/2
            p_inner_right = spacing - post_width/2
            
            if reinforcement_type == 'jarrets':
                for side in ['left', 'right']:
                    sign = 1 if side == 'right' else -1
                    post_edge_x = sign * (spacing + post_width/2)
                    post_on_beam = intersect({'x': post_edge_x, 'y': 100}, {'x': post_edge_x, 'y': -100}, beam_bottom_line['p1'], beam_bottom_line['p2'])
                    if post_on_beam:
                        jarret_attach_y = post_on_beam['y'] + 0.35
                        end_rot = {'x': sign * attach_dist, 'y': beam_height / 2}
                        brace_end_beam = {'x': beam_offset + end_rot['x']*cos_a - end_rot['y']*sin_a, 'y': beam_center_y + end_rot['x']*sin_a + end_rot['y']*cos_a}
                        geom['shapes'].append({'type': 'polygon', 'points': [{'x': post_edge_x, 'y': jarret_attach_y}, brace_end_beam, post_on_beam], 'stroke': '#000000', 'lineWidth': 1})
            else:
                variant = data.get('double_post_bracing', 'v1')
                
                if variant in ['v1', 'v2', 'v5', 'v6']:
                    geom['shapes'].append({'type': 'polygon', 'points': [
                        {'x': p_inner_left, 'y': brace_height - brace_width/2}, {'x': p_inner_right, 'y': brace_height - brace_width/2},
                        {'x': p_inner_right, 'y': brace_height + brace_width/2}, {'x': p_inner_left, 'y': brace_height + brace_width/2}
                    ], 'stroke': '#000000', 'lineWidth': 1})
                
                if variant == 'v2':
                    p_start = {'x': p_inner_left, 'y': brace_height - brace_width/2}
                    p_end = intersect({'x': p_inner_right, 'y': 100}, {'x': p_inner_right, 'y': -100}, beam_bottom_line['p1'], beam_bottom_line['p2'])
                    if p_end:
                        pts = draw_brace(p_start, p_end, {'p1': {'x': p_inner_right, 'y': 100}, 'p2': {'x': p_inner_right, 'y': -100}}, {'p1': {'x': p_inner_left, 'y': 100}, 'p2': {'x': p_inner_left, 'y': -100}}, brace_width)
                        if pts: geom['shapes'].append({'type': 'polygon', 'points': pts, 'stroke': '#000000', 'lineWidth': 1})
                        
                if variant in ['v4', 'v5']:
                    center_beam = {'x': beam_offset, 'y': beam_center_y + (beam_height/2)*cos_a}
                    pts_left = draw_brace({'x': p_inner_left, 'y': brace_height}, center_beam, beam_bottom_line, {'p1':{'x': p_inner_left, 'y':100}, 'p2':{'x': p_inner_left, 'y':-100}}, brace_width)
                    if pts_left: geom['shapes'].append({'type': 'polygon', 'points': pts_left, 'stroke': '#000000', 'lineWidth': 1})
                    pts_right = draw_brace({'x': p_inner_right, 'y': brace_height}, center_beam, beam_bottom_line, {'p1':{'x': p_inner_right, 'y':100}, 'p2':{'x': p_inner_right, 'y':-100}}, brace_width)
                    if pts_right: geom['shapes'].append({'type': 'polygon', 'points': pts_right, 'stroke': '#000000', 'lineWidth': 1})

                if variant in ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']:
                    for side in ['left', 'right']:
                        sign = 1 if side == 'right' else -1
                        post_edge_x = sign * spacing if variant == 'v6' else (spacing + post_width/2 if side == 'right' else -spacing - post_width/2)
                        end_rot = {'x': sign * attach_dist, 'y': beam_height / 2}
                        brace_end_beam = {'x': beam_offset + end_rot['x']*cos_a - end_rot['y']*sin_a, 'y': beam_center_y + end_rot['x']*sin_a + end_rot['y']*cos_a}
                        b_width = post_width if variant == 'v6' else brace_width
                        pts = draw_brace({'x': post_edge_x, 'y': brace_height}, brace_end_beam, beam_bottom_line, {'p1': {'x': post_edge_x, 'y': -100}, 'p2': {'x': post_edge_x, 'y': 100}}, b_width)
                        if pts: geom['shapes'].append({'type': 'polygon', 'points': pts, 'stroke': '#000000', 'lineWidth': 1})

    # === TOITURE ===
    def add_roof(local_angle, local_beam_offset, local_center_y, half=False):
        is_y_arm = post_model == 'y_shape' and half
        start_x = (-post_width/2 if local_angle > 0 else post_width/2) if is_y_arm else -beam_length/2
        c_beam_len = (-beam_length if local_angle > 0 else beam_length) if is_y_arm else beam_length
        beam_draw_x = start_x + c_beam_len if (is_y_arm and local_angle > 0) else start_x
        beam_draw_w = abs(c_beam_len) if is_y_arm else c_beam_len
        
        tf = {'x': local_beam_offset, 'y': local_center_y, 'angle': local_angle}
        
        geom['shapes'].append({
            'type': 'rect', 'x': beam_draw_x, 'y': -beam_height/2, 'w': beam_draw_w, 'h': beam_height,
            'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf
        })
        
        p_size = 0.08
        p_eff = abs(c_beam_len) - p_size
        p_count = math.ceil(purlin_count / 2) if is_y_arm else purlin_count
        p_spacing = p_eff / (p_count - 1) if p_count > 1 else 0
        
        for i in range(p_count):
            x_pos = start_x + c_beam_len / 2 if p_count == 1 else start_x + (p_size/2 + i*p_spacing if c_beam_len > 0 else -p_size/2 - i*p_spacing)
            geom['shapes'].append({
                'type': 'rect', 'x': x_pos - p_size/2, 'y': -beam_height/2 - purlin_height, 'w': p_size, 'h': purlin_height,
                'stroke': '#000000', 'lineWidth': 1.5, 'transform': tf
            })
            
        panel_start_x = (beam_draw_x - overhang_sym_value if c_beam_len < 0 else beam_draw_x) if is_y_arm else -panel_width/2
        panel_draw_w = abs(c_beam_len) + overhang_sym_value if is_y_arm else panel_width
        
        int_y = -beam_height/2 - purlin_height - integration_system_height
        pan_y = int_y - panel_thickness
        
        geom['shapes'].append({'type': 'rect', 'x': panel_start_x, 'y': int_y, 'w': panel_draw_w, 'h': integration_system_height, 'fill': integration_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})
        geom['shapes'].append({'type': 'rect', 'x': panel_start_x, 'y': pan_y, 'w': panel_draw_w, 'h': panel_thickness, 'fill': roof_color, 'stroke': '#374151', 'lineWidth': 1.5, 'transform': tf})

        geom['texts'].append({
            'text': f"Pente = {data.get('roof_slope', 0)}°",
            'x': panel_start_x + panel_draw_w / 2,
            'y': pan_y - 0.2,
            'transform': tf
        })

        if is_y_arm:
            p_start_abs = transform_pt({'x': panel_start_x, 'y': pan_y}, local_angle, local_beam_offset, local_center_y)
            p_end_abs = transform_pt({'x': panel_start_x + panel_draw_w, 'y': pan_y}, local_angle, local_beam_offset, local_center_y)
            geom['dimensions'].append({
                'x1': p_start_abs['x'], 'y1': p_start_abs['y'],
                'x2': p_end_abs['x'], 'y2': p_end_abs['y'],
                'text': f"{panel_draw_w:.2f}m", 'offset': -1.0, 'isVertical': False
            })

    if post_model == 'y_shape':
        add_roof(roof_slope_radians * (-1 if invert_slope else 1), 0, beam_center_y, True)
        add_roof(-roof_slope_radians * (-1 if invert_slope else 1), 0, beam_center_y, True)
    else:
        add_roof(angle, beam_offset, beam_center_y)

    # === DIMENSIONS ===
    p_left_rel = {'x': -panel_width/2, 'y': -beam_height/2 - purlin_height - integration_system_height - panel_thickness}
    p_right_rel = {'x': panel_width/2, 'y': p_left_rel['y']}
    
    if post_model == 'y_shape':
        proj_w = computed.get('total_projection_width', 0)
        x_target_low = 0 if invert_slope else -proj_w/2
        x_dim_low = x_target_low - 1.0 if x_target_low <= 0 else x_target_low + 1.0
        _t, _g = _cote_au_sol(sol_coupe, x_dim_low, -computed.get('low_point_height', 0))
        geom['leaders'].append({'x_target': x_target_low, 'y_target': -computed.get('low_point_height', 0), 'x_dim_line': x_dim_low, 'text': _t, 'ground_y': _g})
        _t, _g = _cote_au_sol(sol_coupe, post_width/2 + 2.0, sol_coupe(post_width/2) - height_under_brace, x_pied=post_width/2)
        geom['leaders'].append({'x_target': post_width/2, 'y_target': sol_coupe(post_width/2) - height_under_brace, 'x_dim_line': post_width/2 + 2.0, 'text': _t, 'ground_y': _g})
        geom['dimensions'].append({'x1': -proj_w/2, 'y1': 0.5, 'x2': proj_w/2, 'y2': 0.5, 'text': f"{proj_w:.2f}m", 'offset': 0, 'isVertical': False})
    else:
        p_left_t = transform_pt(p_left_rel, angle, beam_offset, beam_center_y)
        p_right_t = transform_pt(p_right_rel, angle, beam_offset, beam_center_y)
        panel_lowest = p_left_t if p_left_t['y'] > p_right_t['y'] else p_right_t
        panel_highest = p_left_t if p_left_t['y'] < p_right_t['y'] else p_right_t
        b_left_t = transform_pt({'x': -beam_length/2, 'y': beam_height/2}, angle, beam_offset, beam_center_y)
        b_right_t = transform_pt({'x': beam_length/2, 'y': beam_height/2}, angle, beam_offset, beam_center_y)
        beam_lowest = b_left_t if b_left_t['y'] > b_right_t['y'] else b_right_t
        
        min_x = min(p_left_t['x'], p_right_t['x'], b_left_t['x'], b_right_t['x'])
        max_x = max(p_left_t['x'], p_right_t['x'], b_left_t['x'], b_right_t['x'])
        
        is_left_lowest = panel_lowest['x'] < panel_highest['x']
        x_dim_low = panel_lowest['x'] - 1.0 if is_left_lowest else panel_lowest['x'] + 1.0
        
        _t, _g = _cote_au_sol(sol_coupe, x_dim_low, panel_lowest['y'])
        geom['leaders'].append({'x_target': panel_lowest['x'], 'y_target': panel_lowest['y'], 'x_dim_line': x_dim_low, 'text': _t, 'ground_y': _g})
        
        x_dim_passage = beam_lowest['x']
        _t, _g = _cote_au_sol(sol_coupe, x_dim_passage, beam_lowest['y'], x_pied=beam_lowest['x'])
        geom['leaders'].append({'x_target': beam_lowest['x'], 'y_target': beam_lowest['y'], 'x_dim_line': x_dim_passage, 'text': _t, 'ground_y': _g})
        
        x_dim_high = panel_highest['x'] - 1.0
        _t, _g = _cote_au_sol(sol_coupe, x_dim_high, panel_highest['y'])
        geom['leaders'].append({'x_target': panel_highest['x'], 'y_target': panel_highest['y'], 'x_dim_line': x_dim_high, 'text': _t, 'ground_y': _g})
        
        post_x = 0
        if post_model == 'offset' and offset_post_side != 'center':
            half_panel_horizontal = (panel_width / 2) * math.cos(abs(roof_slope_radians))
            if offset_post_side == 'low': post_x = half_panel_horizontal if invert_slope else -half_panel_horizontal
            if offset_post_side == 'high': post_x = -half_panel_horizontal if invert_slope else half_panel_horizontal
        post_x += post_eccentricity

        if post_model not in ['double', 'inclinedPost']:
            x_dim_post = post_x - 3.0
            if post_model != 'offset':
                _t, _g = _cote_au_sol(sol_coupe, x_dim_post, -post_height, x_pied=post_x)
                geom['leaders'].append({'x_target': post_x, 'y_target': -post_height, 'x_dim_line': x_dim_post, 'text': _t, 'ground_y': _g})
            if reinforcement_type == 'bracons' and post_height > height_under_brace:
                x_dim_brace = post_x + 2.0
                _y = sol_coupe(post_x) - height_under_brace
                _t, _g = _cote_au_sol(sol_coupe, x_dim_brace, _y, x_pied=post_x)
                geom['leaders'].append({'x_target': post_x + post_width/2, 'y_target': _y, 'x_dim_line': x_dim_brace, 'text': _t, 'ground_y': _g})
        else:
            spacing = (computed.get('post_spacing_inclined', 0) if post_model == 'inclinedPost' else computed.get('post_spacing', 0)) / 2
            
            if post_model == 'double':
                x_dim_brace = spacing + 2.0
                _y = sol_coupe(spacing) - height_under_brace
                _t, _g = _cote_au_sol(sol_coupe, x_dim_brace, _y, x_pied=spacing)
                geom['leaders'].append({'x_target': spacing + post_width/2, 'y_target': _y, 'x_dim_line': x_dim_brace, 'text': _t, 'ground_y': _g})
                
            geom['dimensions'].append({'x1': -spacing, 'y1': 0.5, 'x2': spacing, 'y2': 0.5, 'text': f"{spacing*2:.2f}m", 'offset': 0, 'isVertical': False})

        proj_w = computed.get('total_projection_width', 0)
        proj_dim_y = 0.8 if post_model in ['single', 'y_shape'] else 1.1
        
        if post_model == 'offset':
            geom['dimensions'].append({'x1': min_x, 'y1': proj_dim_y - 0.5, 'x2': post_x, 'y2': proj_dim_y - 0.5, 'text': f"{abs(post_x - min_x):.2f}m", 'offset': 0, 'isVertical': False})
            geom['dimensions'].append({'x1': post_x, 'y1': proj_dim_y - 0.5, 'x2': max_x, 'y2': proj_dim_y - 0.5, 'text': f"{abs(max_x - post_x):.2f}m", 'offset': 0, 'isVertical': False})
        elif post_model == 'single':
            geom['dimensions'].append({'x1': min_x, 'y1': proj_dim_y - 0.6, 'x2': post_x, 'y2': proj_dim_y - 0.6, 'text': f"{abs(post_x - min_x):.2f}m", 'offset': 0, 'isVertical': False})
            geom['dimensions'].append({'x1': post_x, 'y1': proj_dim_y - 0.6, 'x2': max_x, 'y2': proj_dim_y - 0.6, 'text': f"{abs(max_x - post_x):.2f}m", 'offset': 0, 'isVertical': False})

        geom['dimensions'].append({'x1': min_x, 'y1': proj_dim_y, 'x2': max_x, 'y2': proj_dim_y, 'text': f"{proj_w:.2f}m", 'offset': 0, 'isVertical': False})
        geom['dimensions'].append({'x1': p_left_t['x'], 'y1': p_left_t['y'], 'x2': p_right_t['x'], 'y2': p_right_t['y'], 'text': f"{panel_width:.2f}m", 'offset': -1.0, 'isVertical': False})

    _tag_default_categories(geom)
    add_ground_hatching(geom, sol_coupe)
    return geom

def generate_implantation(data, computed):
    """
    Plan d'implantation des poteaux (vue de dessus) d'UNE ombrière : rectangle
    d'emprise (facade_length x largeur de projection), marqueurs de poteaux aux
    positions post_positions_x (axe façade) x profondeur (axe coupe). Repère
    x = axe façade (comme generate_facade), y = axe profondeur (comme le x local
    de generate_coupe) - même convention que le reste de l'app (Y vers le "nord"
    du plan, dessiné vers le haut).
    """
    geom = {'shapes': [], 'dimensions': [], 'leaders': [], 'texts': []}

    post_model = data.get('post_model', 'single')
    facade_length = float(data.get('facade_length', 0))
    post_width = float(data.get('post_width', 0.4))
    total_projection_width = computed.get('total_projection_width', 0)
    post_positions_x = computed.get('post_positions_x', [])
    post_eccentricity = computed.get('post_eccentricity_clamped', 0)
    offset_post_side = data.get('offset_post_side', 'center')
    invert_slope = bool(data.get('invert_slope', False))
    panel_width = float(data.get('panel_width', 0))
    roof_slope_radians = computed.get('roof_slope_radians', 0)

    # Contour d'emprise de la structure (vue de dessus)
    geom['shapes'].append({
        'type': 'rect', 'x': 0, 'y': -total_projection_width / 2,
        'w': facade_length, 'h': total_projection_width,
        'stroke': '#374151', 'lineWidth': 1, 'category': 'structure'
    })

    # Position en profondeur (axe y) de la/des rangée(s) de poteaux, même logique
    # que generate_coupe (base_post_x + excentrement pour single/offset/y_shape ;
    # +-entraxe/2 pour double/inclinedPost).
    if post_model in ('double', 'inclinedPost'):
        spacing = computed.get(
            'post_spacing_inclined' if post_model == 'inclinedPost' else 'post_spacing', 0
        )
        row_ys = [-spacing / 2, spacing / 2]
    else:
        base_post_x = 0
        if post_model == 'offset' and offset_post_side != 'center':
            half_panel_horizontal = (panel_width / 2) * math.cos(abs(roof_slope_radians))
            if offset_post_side == 'low':
                base_post_x = half_panel_horizontal if invert_slope else -half_panel_horizontal
            if offset_post_side == 'high':
                base_post_x = -half_panel_horizontal if invert_slope else half_panel_horizontal
        row_ys = [base_post_x + post_eccentricity]

    for x in post_positions_x:
        for y in row_ys:
            geom['shapes'].append({
                'type': 'rect', 'x': x - post_width / 2, 'y': y - post_width / 2,
                'w': post_width, 'h': post_width,
                'fill': '#374151', 'stroke': '#000000', 'lineWidth': 1, 'category': 'structure'
            })

    # Cotes entraxes le long de la façade
    for i in range(len(post_positions_x) - 1):
        x1, x2 = post_positions_x[i], post_positions_x[i + 1]
        geom['dimensions'].append({
            'x1': x1, 'y1': total_projection_width / 2 + 0.6, 'x2': x2, 'y2': total_projection_width / 2 + 0.6,
            'text': f"{x2 - x1:.2f}m", 'offset': 0, 'isVertical': False
        })

    if post_positions_x:
        geom['dimensions'].append({
            'x1': 0, 'y1': -total_projection_width / 2 - 0.6, 'x2': facade_length, 'y2': -total_projection_width / 2 - 0.6,
            'text': f"{facade_length:.2f}m", 'offset': 0, 'isVertical': False
        })
        geom['dimensions'].append({
            'x1': facade_length + 0.6, 'y1': -total_projection_width / 2, 'x2': facade_length + 0.6, 'y2': total_projection_width / 2,
            'text': f"{total_projection_width:.2f}m", 'offset': 0, 'isVertical': True
        })

    return geom

def generate_facade(data, computed):
    geom = {'shapes': [], 'dimensions': [], 'leaders': []}
    roof_color = '#374151' # Kept for roof panel
    
    post_height = computed.get('post_height', 0)
    facade_length = float(data.get('facade_length', 0))
    ground_slope_facade = float(data.get('ground_slope_facade', 0))
    post_width = float(data.get('post_width', 0.4))
    panel_width = float(data.get('panel_width', 0))
    roof_slope = float(data.get('roof_slope', 0))
    invert_slope = bool(data.get('invert_slope', False))
    low_point_height = computed.get('low_point_height', 0)
    align_roof = bool(data.get('align_roof', False))
    pv_layout = data.get('pv_layout', '')
    purlin_height = float(data.get('purlin_height', 0.2))
    
    left_overhang = float(data.get('left_overhang', 0))
    post_positions_x = computed.get('post_positions_x', [left_overhang])
    if not post_positions_x:
        post_positions_x = [left_overhang]
        
    post_model = data.get('post_model', 'single')
    effective_panel_width = panel_width / 2 if post_model in ('y_shape', 'doubleYShape') else panel_width
    slope_rad = roof_slope * math.pi / 180 * (-1 if invert_slope else 1)
    roof_apparent_height = abs(effective_panel_width * math.sin(slope_rad))
    
    # Terrain réel sous la façade (profil envoyé par le navigateur) ; droite historique sinon.
    sol_facade = _sol(data, 'facade')

    def get_ground_y(x):
        if sol_facade:
            return sol_facade(x)
        return (x / facade_length) * (-ground_slope_facade) if facade_length > 0 else 0

    # Table RIGIDE calée sur les poteaux (miroir de TerrainPlans.calerTable) : « Alignement toiture »
    # coché = table horizontale, sinon elle suit la pente entre le premier et le dernier poteau ;
    # dans les deux cas le poteau le plus contraint garde exactement sa hauteur réglée.
    _calage = caler_table([(x, -get_ground_y(x)) for x in post_positions_x],
                          'horizontal' if align_roof else 'pente', 0.0)
    z_table = _calage[0] if _calage else (lambda x: -get_ground_y(x))
        
    post_top_y_at_0 = -(z_table(0) + post_height)
    
    # --- Poteaux ---
    for x_pos in post_positions_x:
        ground_y = get_ground_y(x_pos)
        post_top_y = -(z_table(x_pos) + post_height)
        post_h = ground_y - post_top_y
            
        geom['shapes'].append({
            'type': 'rect', 'x': x_pos - post_width/2, 'y': post_top_y, 'w': post_width, 'h': post_h,
            'stroke': '#000000', 'lineWidth': 1.5
        })
        
    # --- Toiture (Bac Acier PV) ---
    roof_bottom_start_y = -(z_table(0) + low_point_height)
    roof_bottom_end_y = -(z_table(facade_length) + low_point_height)
    roof_top_start_y = roof_bottom_start_y - roof_apparent_height
    roof_top_end_y = roof_bottom_end_y - roof_apparent_height
    
    geom['shapes'].append({
        'type': 'polygon',
        'points': [{'x': 0, 'y': roof_bottom_start_y}, {'x': facade_length, 'y': roof_bottom_end_y}, {'x': facade_length, 'y': roof_top_end_y}, {'x': 0, 'y': roof_top_start_y}],
        'fill': roof_color, 'stroke': '#374151', 'lineWidth': 1
    })
    
    # --- Pannes (Bords Purlin) ---
    panne_facade_height = purlin_height - abs(math.sin(slope_rad) * purlin_height)
    geom['shapes'].append({
        'type': 'polygon',
        'points': [{'x': 0, 'y': roof_bottom_start_y}, {'x': facade_length, 'y': roof_bottom_end_y}, {'x': facade_length, 'y': roof_bottom_end_y + panne_facade_height}, {'x': 0, 'y': roof_bottom_start_y + panne_facade_height}],
        'stroke': '#000000', 'lineWidth': 1.5
    })
    
    # --- Calepinage (Lignes blanches modules) ---
    if pv_layout:
        parts = pv_layout.lower().replace(' ', '').split('x')
        if len(parts) == 2:
            cols, rows = (int(parts[0].replace('c', '')), int(parts[1].replace('l', ''))) if 'c' in parts[0] else (int(parts[1].replace('c', '')), int(parts[0].replace('l', ''))) if 'l' in parts[0] else (int(parts[1]), int(parts[0]))
            if rows > 0 and cols > 0:
                v_width = {'x': facade_length, 'y': roof_bottom_end_y - roof_bottom_start_y}
                v_height = {'x': 0, 'y': roof_top_start_y - roof_bottom_start_y}
                for i in range(rows):
                    for j in range(cols):
                        p1 = {'x': (j/cols)*v_width['x'], 'y': roof_bottom_start_y + (j/cols)*v_width['y'] + (i/rows)*v_height['y']}
                        p2 = {'x': ((j+1)/cols)*v_width['x'], 'y': roof_bottom_start_y + ((j+1)/cols)*v_width['y'] + (i/rows)*v_height['y']}
                        p3 = {'x': ((j+1)/cols)*v_width['x'], 'y': roof_bottom_start_y + ((j+1)/cols)*v_width['y'] + ((i+1)/rows)*v_height['y']}
                        p4 = {'x': (j/cols)*v_width['x'], 'y': roof_bottom_start_y + (j/cols)*v_width['y'] + ((i+1)/rows)*v_height['y']}
                        geom['shapes'].append({'type': 'polygon', 'points': [p1, p2, p3, p4], 'stroke': 'rgba(255, 255, 255, 0.5)', 'lineWidth': 0.5})

    # --- Cotations : longueur totale, entraxes poteaux, hauteur (verticale) ---
    dim_y_total = min(roof_top_start_y, roof_top_end_y) - 0.9
    dim_y_entraxe = min(roof_top_start_y, roof_top_end_y) - 0.5
    geom['dimensions'].append({
        'x1': 0, 'y1': dim_y_total, 'x2': facade_length, 'y2': dim_y_total,
        'text': f"{facade_length:.2f}m", 'offset': 0, 'isVertical': False,
    })
    for i in range(len(post_positions_x) - 1):
        x1, x2 = post_positions_x[i], post_positions_x[i + 1]
        geom['dimensions'].append({
            'x1': x1, 'y1': dim_y_entraxe, 'x2': x2, 'y2': dim_y_entraxe,
            'text': f"{x2 - x1:.2f}m", 'offset': 0, 'isVertical': False,
        })

    def roof_bottom_at(x):
        t = (x / facade_length) if facade_length > 0 else 0
        return roof_bottom_start_y + t * (roof_bottom_end_y - roof_bottom_start_y)

    x_ref_post = post_positions_x[0]
    y_ground_ref = get_ground_y(x_ref_post)
    y_roof_ref = roof_bottom_at(x_ref_post)
    _t, _g = _cote_au_sol(get_ground_y, x_ref_post - 1.2, y_roof_ref)
    geom['leaders'].append({
        'x_target': x_ref_post, 'y_target': y_roof_ref,
        'x_dim_line': x_ref_post - 1.2, 'text': _t, 'ground_y': _g,
    })

    _tag_default_categories(geom)
    add_ground_hatching(geom, get_ground_y)
    return geom

def parse_post_distances(expression: str, facade_length: float,
                         left_overhang: float, right_overhang: float) -> dict:
    """
    Parse l'expression des entraxes poteaux.
    Ex: "3*10 + 6" → [10, 10, 10, 6]
    Équivalent de parsePostDistances() côté JS.
    """
    error = ""
    distances = []
    positions_x = []
    warning = ""

    available_length = facade_length - left_overhang - right_overhang

    def parse_expr(expr):
        result = []
        segments = expr.replace(",", "+").split("+")
        for seg in segments:
            seg = seg.strip()
            if seg == "":
                continue
            if "*" in seg:
                parts = seg.split("*")
                if len(parts) != 2:
                    raise ValueError(f"Format invalide: \"{seg}\"")
                count = int(parts[0].strip())
                value = float(parts[1].strip())
                if count < 0:
                    raise ValueError(f"Valeurs invalides: \"{seg}\"")
                for _ in range(count):
                    result.append(value)
            else:
                try:
                    result.append(float(seg))
                except ValueError:
                    raise ValueError(f"Valeur non numérique: \"{seg}\"")
        return result

    if not expression or expression.strip() == "":
        # Valeur par défaut demandée : 3 entraxes de 10m + 1 entraxe de 7.50m
        expression = "3*10 + 7.50"

    try:
        distances = parse_expr(expression.strip())
    except ValueError as e:
        error = str(e)
        return {"distances": [], "positions_x": [], "error": error, "warning": "", "right_overhang": right_overhang}

    total_distance = sum(distances)
    calculated_length = left_overhang + total_distance + right_overhang
    new_right_overhang = right_overhang

    if abs(calculated_length - facade_length) > 0.01:
        new_right_overhang = facade_length - left_overhang - total_distance
        warning = (
            f"Attention : Somme entraxes ({total_distance:.2f}m) + p-à-f "
            f"({left_overhang:.2f}m + {right_overhang:.2f}m) = {calculated_length:.2f}m ≠ "
            f"longueur totale ({facade_length:.2f}m). "
            f"Le porte-à-faux droit a été ajusté à {new_right_overhang:.2f}m."
        )

    # Calcul des coordonnées X exactes
    current_x = left_overhang
    positions_x.append(current_x)
    for d in distances:
        current_x += d
        positions_x.append(current_x)

    return {"distances": distances, "positions_x": positions_x, "error": error, "warning": warning, "right_overhang": new_right_overhang}


def validate_and_set_eccentricity(overhang_h: float, overhang_l: float,
                                   panel_width: float, roof_slope: float,
                                   post_eccentricity: float,
                                   post_model: str, offset_post_side: str,
                                   overhang_sym_value: float) -> dict:
    """
    Valide et calcule l'excentrement du poteau.
    Équivalent de validateAndSetEccentricity() côté JS.
    """
    if post_model in ("y_shape", "doubleYShape"):
        beam_length = (panel_width / 2.0) - overhang_sym_value
    else:
        beam_length = panel_width - (overhang_h + overhang_l)

    max_eccentricity = (panel_width / 2) * math.cos(roof_slope * math.pi / 180)

    error_text = ""
    if post_model == "offset":
        if offset_post_side == "low":
            min_limit = overhang_l
            max_limit = panel_width - overhang_h
        else:  # high
            min_limit = overhang_h
            max_limit = panel_width - overhang_l

        if post_eccentricity < min_limit or post_eccentricity > max_limit:
            error_text = f"Erreur: Poteau hors traverse ! (Limites: {min_limit:.2f}m - {max_limit:.2f}m)"

        max_eccentricity = 9999  # Disable standard clamping for offset model
    else:
        error_text = f"(Limite auto: ±{max_eccentricity:.2f}m)"

    return {
        "beam_length": beam_length,
        "max_eccentricity": max_eccentricity,
        "error_text": error_text,
    }


def calculate_ombriere(data: dict) -> dict:
    """
    Effectue tous les calculs de l'ombrière (hauteurs, géométrie de coupe).
    Équivalent de updateAppLogic() côté JS.

    Paramètres attendus dans `data`:
    - post_model: 'single' | 'offset' | 'double' | 'inclinedPost' | 'y_shape'
    - traverse_position: 'top' | 'side'
    - overhang_type: 'sym' | 'asym'
    - invert_slope: bool
    - offset_post_side: 'low' | 'high' | 'center'
    - passage_height: float (m)
    - beam_height: float (m)
    - purlin_height: float (m)
    - integration_system_height: float (m)
    - panel_thickness: float (m)
    - panel_width: float (m)
    - roof_slope: float (degrés)
    - overhang_sym_value: float (m)
    - overhang_asym_high: float (m)
    - overhang_asym_low: float (m)
    - post_eccentricity: float (m)
    - post_width: float (m)
    - post_spacing: float (m)  # for double post
    - post_spacing_inclined: float (m)
    - post_inclination_inclined: float (degrés)
    - height_under_brace: float (m)
    - brace_fix_percentage: float (0-100)
    - purlin_count: int
    - facade_length: float (m)
    - left_overhang: float (m)
    - right_overhang: float (m)
    - ground_slope_facade: float (m)
    - align_roof: bool
    - pv_layout: str
    - base_altimetry: float (m)
    - post_distances_expr: str  (ex: "3*10 + 6")
    - double_post_bracing: str  (v1..v6)
    - show_double_bracing: bool
    - reinforcement_type: 'bracons' | 'jarrets'

    Retourne un dict avec toutes les valeurs calculées.
    """
    post_model = data.get("post_model", "single")
    traverse_position = data.get("traverse_position", "top")
    overhang_type = data.get("overhang_type", "sym")
    invert_slope = bool(data.get("invert_slope", False))
    offset_post_side = data.get("offset_post_side", "center")

    passage_height = float(data.get("passage_height", 0))
    beam_height = float(data.get("beam_height", 0))
    purlin_height = float(data.get("purlin_height", 0))
    integration_system_height = float(data.get("integration_system_height", 0))
    panel_thickness = float(data.get("panel_thickness", 0))
    panel_width = float(data.get("panel_width", 0))
    roof_slope = float(data.get("roof_slope", 0))
    overhang_sym_value = float(data.get("overhang_sym_value", 0))
    overhang_asym_high = float(data.get("overhang_asym_high", 0))
    overhang_asym_low = float(data.get("overhang_asym_low", 0))
    post_eccentricity = float(data.get("post_eccentricity", 0))
    post_width = float(data.get("post_width", 0))
    height_under_brace = float(data.get("height_under_brace", 0))
    brace_fix_percentage = float(data.get("brace_fix_percentage", 70))
    facade_length = float(data.get("facade_length", 0))
    left_overhang = float(data.get("left_overhang", 0))
    right_overhang = float(data.get("right_overhang", 0))
    ground_slope_facade = float(data.get("ground_slope_facade", 0))
    base_altimetry = float(data.get("base_altimetry", 0))
    post_distances_expr = data.get("post_distances_expr", "")
    reinforcement_type = data.get("reinforcement_type", "bracons")
    double_post_bracing = data.get("double_post_bracing", "v1")
    show_double_bracing = bool(data.get("show_double_bracing", True))

    # === 1. Calcul overhang (porte-à-faux) ===
    if overhang_type == "sym" or post_model in ("y_shape", "doubleYShape"):
        overhang_h = overhang_l = overhang_sym_value
    else:
        overhang_h = overhang_asym_high
        overhang_l = overhang_asym_low

    # === 2. Validation excentrement et longueur traverse ===
    ec_result = validate_and_set_eccentricity(
        overhang_h, overhang_l, panel_width, roof_slope,
        post_eccentricity, post_model, offset_post_side, overhang_sym_value
    )
    beam_length = ec_result["beam_length"]
    max_eccentricity = ec_result["max_eccentricity"]
    eccentricity_error = ec_result["error_text"]

    # Clamp eccentricity for offset model
    if post_model == "offset":
        if abs(post_eccentricity) > max_eccentricity:
            post_eccentricity = math.copysign(max_eccentricity, post_eccentricity)

    # === 3. Calcul hauteur bas structure ===
    # Réciproque EXACTE de la relation du configurateur (ombriere_metal.js::calculateOmbriereMetalLocal) :
    # passage = hauteur égout - empilement x cos(pente) + p-à-f bas x sin(pente). L'empilement est
    # perpendiculaire à la pente ; l'ancienne somme brute (sans cos ni porte-à-faux) cotait une hauteur
    # égout différente de la valeur saisie (bug rapporté : 3,00 m saisis, 2,98 m cotés).
    _pente_abs = abs(roof_slope) * math.pi / 180
    low_point_height = (
        passage_height
        + (beam_height + purlin_height + integration_system_height + panel_thickness) * math.cos(_pente_abs)
        - overhang_l * math.sin(_pente_abs)
    )

    # === 4. Calcul angle de toiture ===
    roof_slope_radians = roof_slope * math.pi / 180 * (-1 if invert_slope else 1)

    # === 5. Calcul hauteur poteau ===
    new_post_height = 0.0

    if post_model in ("y_shape", "doubleYShape"):
        cos_a_y = math.cos(abs(roof_slope_radians))
        y_lowest_beam_absolute = -passage_height
        y_lowest_beam_point_rel = (
            (beam_length / 2) * abs(math.sin(roof_slope_radians)) +
            (beam_height / 2) * math.cos(roof_slope_radians)
        )
        beam_center_y_orig = y_lowest_beam_absolute - y_lowest_beam_point_rel
        beam_center_y = beam_center_y_orig - 0.03  # correction empirique
        top_of_beam_y = beam_center_y - (beam_height / 2) * math.cos(roof_slope_radians)
        new_post_height = -top_of_beam_y
    else:
        y_lowest_beam_absolute = -passage_height
        y_lowest_beam_point_rel = (
            (beam_length / 2) * abs(math.sin(roof_slope_radians)) +
            (beam_height / 2) * math.cos(roof_slope_radians)
        )
        beam_center_y = y_lowest_beam_absolute - y_lowest_beam_point_rel

        if traverse_position == "top":
            new_post_height = -(beam_center_y + beam_height / 2)
        else:
            new_post_height = -beam_center_y

    # === 6. Projection horizontale totale ===
    abs_roof_slope_rad = abs(roof_slope * math.pi / 180)
    if post_model in ("y_shape", "doubleYShape"):
        total_projection_width = (panel_width * math.cos(abs_roof_slope_rad)) + post_width
    else:
        total_projection_width = panel_width * math.cos(abs_roof_slope_rad)

    # === 6.5. Cohérence des entraxes profondeur (coupe) avec la toiture ===
    post_spacing = float(data.get("post_spacing", 0))
    post_spacing_inclined = float(data.get("post_spacing_inclined", 0))
    max_spacing = max(0.0, total_projection_width - post_width)
    if post_model == "double" and post_spacing > max_spacing:
        post_spacing = max_spacing
    if post_model == "inclinedPost" and post_spacing_inclined > max_spacing:
        post_spacing_inclined = max_spacing

    # === 7. Parse des distances entre poteaux ===
    dist_result = parse_post_distances(
        post_distances_expr, facade_length, left_overhang, right_overhang
    )
    right_overhang_adjusted = dist_result.get("right_overhang", right_overhang)

    # === 8. Hauteur haut structure (point haut) ===
    if post_model in ("y_shape", "doubleYShape"):
        high_point_height = low_point_height + abs((panel_width / 2.0) * math.sin(roof_slope_radians))
    else:
        high_point_height = low_point_height + abs(panel_width * math.sin(roof_slope_radians))

    result = {
        "status": "success",
        # Hauteurs calculées (à afficher dans les champs readonly)
        "low_point_height": round(low_point_height, 2),
        "post_height": round(new_post_height, 2),
        "high_point_height": round(high_point_height, 2),

        # Géométrie
        "beam_length": round(beam_length, 4),
        "total_projection_width": round(total_projection_width, 4),
        "overhang_h": overhang_h,
        "overhang_l": overhang_l,
        "post_eccentricity_clamped": round(post_eccentricity, 4),
        "max_eccentricity": round(max_eccentricity, 4),

        # Angles
        "roof_slope_radians": roof_slope_radians,

        # Entraxes
        "post_distances": dist_result["distances"],
        "post_positions_x": dist_result["positions_x"],
        "post_distances_error": dist_result["error"],
        "post_distances_warning": dist_result["warning"],
        "post_spacing": round(post_spacing, 4),
        "post_spacing_inclined": round(post_spacing_inclined, 4),

        # Validation excentrement
        "eccentricity_error": eccentricity_error,

        # Données de façade (pour dessin)
        "facade_length": facade_length,
        "left_overhang": left_overhang,
        "right_overhang": round(right_overhang_adjusted, 4),
        "ground_slope_facade": ground_slope_facade,
        "base_altimetry": base_altimetry,

        # Passage de l'état de l'app (pour le dessin JS)
        "post_model": post_model,
        "traverse_position": traverse_position,
        "overhang_type": overhang_type,
        "invert_slope": invert_slope,
        "reinforcement_type": reinforcement_type,
        "double_post_bracing": double_post_bracing,
        "show_double_bracing": show_double_bracing,
        "height_under_brace": height_under_brace,
        "brace_fix_percentage": brace_fix_percentage,

        # Toutes les valeurs brutes (pour le dessin JS)
        "panel_width": panel_width,
        "roof_slope": roof_slope,
        "beam_height": float(data.get("beam_height", 0)),
        "purlin_height": purlin_height,
        "purlin_count": int(data.get("purlin_count", 6)),
        "post_width": post_width,
        "panel_thickness": panel_thickness,
        "integration_system_height": integration_system_height,
        "overhang_sym_value": overhang_sym_value,
        "overhang_asym_high": overhang_asym_high,
        "overhang_asym_low": overhang_asym_low,
        "passage_height": passage_height,
        "post_spacing": float(data.get("post_spacing", 0)),
        "post_spacing_inclined": float(data.get("post_spacing_inclined", 0)),
        "post_inclination_inclined": float(data.get("post_inclination_inclined", 65)),
        "offset_post_side": offset_post_side,
        "post_eccentricity": round(post_eccentricity, 4),

        # Façade
        "pv_layout": data.get("pv_layout", ""),
        "align_roof": bool(data.get("align_roof", False)),
    }
    
    result["geometry"] = {
        "coupe": generate_coupe(data, result),
        "facade": generate_facade(data, result),
        "implantation": generate_implantation(data, result)
    }

    return result