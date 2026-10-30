"""
batiment_metal.py — Logique métier pour la géométrie des bâtiments métalliques.
"""

import re
import math


def intersect_lines_dict_batiment_metal(p1, p2, p3, p4, extend_line=False, extend_both=False):
    """Fonction d'intersection de segments/droites équivalente à celle du JS."""
    den = (p1['x'] - p2['x']) * (p3['y'] - p4['y']) - (p1['y'] - p2['y']) * (p3['x'] - p4['x'])
    if den == 0: return None
    t = ((p1['x'] - p3['x']) * (p3['y'] - p4['y']) - (p1['y'] - p3['y']) * (p3['x'] - p4['x'])) / den
    u = -((p1['x'] - p2['x']) * (p1['y'] - p3['y']) - (p1['y'] - p2['y']) * (p1['x'] - p3['x'])) / den
    
    cond_t = (0 <= t <= 1) or extend_both
    cond_u = (0 <= u <= 1) or extend_line or extend_both
    
    if cond_t and cond_u:
        return {'x': p1['x'] + t * (p2['x'] - p1['x']), 'y': p1['y'] + t * (p2['y'] - p1['y'])}
    return None

def get_offset_line_batiment_metal(p1, p2, offset):
    """Décalage parallèle d'une ligne d'une distance 'offset'."""
    angle = math.atan2(p2['y'] - p1['y'], p2['x'] - p1['x'])
    perp_angle = angle + math.pi / 2
    dx = offset * math.cos(perp_angle)
    dy = offset * math.sin(perp_angle)
    return {'p1': {'x': p1['x'] + dx, 'y': p1['y'] + dy}, 'p2': {'x': p2['x'] + dx, 'y': p2['y'] + dy}}

def safe_float_batiment_metal(val, default=0.0):
    """Conversion sécurisée en float."""
    try:
        return float(val) if val is not None and str(val).strip() != "" else default
    except ValueError:
        return default

def round_2_batiment_metal(val: float) -> float:
    """Arrondi à 2 décimales."""
    return round(float(val), 2)


def parse_post_distances_batiment_metal(expression: str, facade_length: float, left_overhang: float, right_overhang: float) -> dict:
    """
    Analyse et valide l'expression des entraxes saisie par l'utilisateur.
    Ex: '3*10 + 6' génère [10.0, 10.0, 10.0, 6.0].
    Retourne un dict avec la liste des distances et un éventuel message d'erreur.
    """
    error_msg = ""
    distances = []
    if not expression or not str(expression).strip():
        return {"distances": [], "error": ""}
    
    try:
        segments = str(expression).replace(',', '+').split('+')
        for segment in segments:
            cleaned_segment = segment.strip()
            if not cleaned_segment:
                continue
            if '*' in cleaned_segment:
                parts = cleaned_segment.split('*')
                if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
                    raise ValueError(f"Format invalide: '{segment}'")
                count = int(parts[0].strip())
                value = float(parts[1].strip())
                if count < 0 or value < 0:
                    raise ValueError(f"Valeurs négatives interdites: '{segment}'")
                distances.extend([value] * count)
            else:
                value = float(cleaned_segment)
                if value < 0:
                    raise ValueError(f"Valeur négative interdite: '{segment}'")
                distances.append(value)
    except Exception as e:
        return {"distances": [], "error": str(e)}

    total_distance = sum(distances)
    calculated_length = left_overhang + total_distance + right_overhang
    
    # Tolérance d'arrondi (1 cm)
    if abs(calculated_length - facade_length) > 0.01:
        error_msg = f"Attention : Somme entraxes ({total_distance:.2f}m) + p-à-f ({(left_overhang + right_overhang):.2f}m) = {calculated_length:.2f}m ≠ longueur totale ({facade_length:.2f}m)."
    
    return {"distances": distances, "error": error_msg}

def validate_building_data_batiment_metal(data: dict, distances: list):
    """Valide strictement l'intégrité et les limites des données reçues avant d'effectuer les calculs"""
    def check_range(val, min_val, max_val, name, min_inclusive=False, max_inclusive=True):
        try:
            v = float(val)
        except (ValueError, TypeError):
            raise ValueError(f"Le champ '{name}' est invalide.")
        
        min_check = (v >= min_val) if min_inclusive else (v > min_val)
        max_check = (v <= max_val) if max_inclusive else (v < max_val)
        
        if not (min_check and max_check):
            min_bracket = "[" if min_inclusive else "]"
            max_bracket = "]" if max_inclusive else "["
            raise ValueError(f"Le champ '{name}' doit être dans l'intervalle {min_bracket}{min_val}, {max_val}{max_bracket}. Valeur reçue: {v}")

    post_distances_expr = str(data.get("postDistances", ""))
    if not re.match(r"^[0-9.+\* ]*$", post_distances_expr):
        raise ValueError("Entraxes invalides : Seuls les chiffres, points, +, * et espaces sont autorisés.")

    check_range(data.get("widthRoof", 15), 0, 50, "Largeur toiture bâtiment")
    check_range(data.get("postCount", 3), 0, 10, "Nombre de poteaux")
    check_range(data.get("bracePosPct", 85), 0, 100, "Position bracon_Pot_rives (%)")
    check_range(data.get("bracePosTraversePotRive", 30), 0, 100, "Position bracon_Traverse_Pot_rive")
    check_range(data.get("bracePosIntermPct", 70), 0, 100, "Position bracon_Pot_Interm (%)")
    check_range(data.get("bracePosTraverseIntPct", 30), 0, 100, "Position bracon_Traverse_Int (%)")
    
    h_egout = safe_float_batiment_metal(data.get("hauteur_batiment_egout", 5.0))
    h_renfort = safe_float_batiment_metal(data.get("heightUnderBrace", 0))
    check_range(h_egout, 0, 15, "Hauteur Bâtiment_Égout (m)")
    if h_renfort > 0:
        check_range(h_renfort, 0, 15, "Hauteur sous renfort (m)")
    if h_egout <= h_renfort:
        raise ValueError("La Hauteur Bâtiment_Égout doit être strictement supérieure à la Hauteur sous renfort.")

    check_range(data.get("panelWidth", 12.4), 0, 50, "Largeur champ PV (m)")
    check_range(data.get("roofSlope", 8), 0, 50, "Pente de la toiture (°)")
    if data.get("postModel") == 'asymetrique':
        check_range(data.get("inclination1", 15), 0, 50, "Inclinaison P1 (°)")
        check_range(data.get("inclination2", 10), 0, 50, "Inclinaison P2 (°)")
    check_range(data.get("overhangSymValue", 0.25), 0, 0.30, "Porte-à-faux (Symétrique)")
    check_range(data.get("asymmetryPct", 30), 0, 100, "% d'asymétrie")
    check_range(data.get("postWidth", 0.3), 0, 1, "Épaisseur poteau", min_inclusive=False, max_inclusive=False)
    check_range(data.get("purlinThickness", 0.1), 0, 1, "Épaisseur pannes", min_inclusive=False, max_inclusive=False)
    check_range(data.get("panelThickness", 0.03), 0, 1, "Épaisseur panneaux", min_inclusive=False, max_inclusive=False)
    check_range(data.get("integrationSystemHeight", 0.1), 0, 1, "Hauteur système d'intégration", min_inclusive=False, max_inclusive=False)
    check_range(data.get("beamHeight", 0.15), 0, 1, "Épaisseur traverse", min_inclusive=False, max_inclusive=False)
    check_range(data.get("beamWidth", 0.15), 0, 1, "Largeur traverse", min_inclusive=False, max_inclusive=False)
    check_range(data.get("braceWidth", 0.1), 0, 1, "Épaisseur des bracons", min_inclusive=False, max_inclusive=False)
    check_range(data.get("crossThickness", 0.05), 0, 1, "Épaisseur contreventement", min_inclusive=False, max_inclusive=False)
    check_range(data.get("braceFixPercentage", 10), 0, 100, "Fixation renfort (%)")
    check_range(data.get("purlinCount", 6), 2, 15, "Nombre de pannes", min_inclusive=False, max_inclusive=False)
    check_range(data.get("facadeLength", 38), 0, 100, "Longueur totale (m)")
    check_range(data.get("leftOverhang", 1), 0, 1, "P-à-F Gauche (m)")
    check_range(data.get("rightOverhang", 1), 0, 1, "P-à-F Droit (m)")
    check_range(data.get("groundSlopeFacade", 0), -3, 3, "Dénivelé du terrain", min_inclusive=True, max_inclusive=False)
    check_range(data.get("baseAltimetry", 0), -3, 3, "Altimétrie au point +0,00 m", min_inclusive=True, max_inclusive=False)
    if data.get("alignRoof", False) and distances and max(distances) > 10:
        raise ValueError("Alignement toiture : L'entraxe maximum autorisé est de 10m.")

def calculate_building_geometry_batiment_metal(data: dict) -> dict:
    """
    Logique métier centralisée pour le calcul des hauteurs et dimensions (Bâtiment Métallique).
    Remplace l'ancien calcul côté client (JS).
    """
    post_model = data.get("postModel", "bipente")
    width_roof = safe_float_batiment_metal(data.get("widthRoof", 15.0))
    post_count = int(safe_float_batiment_metal(data.get("postCount", 3)))
    
    hauteur_egout = safe_float_batiment_metal(data.get("hauteur_batiment_egout", 5.0))
    integration_sys_height = safe_float_batiment_metal(data.get("integrationSystemHeight", 0.1))
    purlin_height = safe_float_batiment_metal(data.get("purlinHeight", 0.3))
    beam_height = safe_float_batiment_metal(data.get("beamHeight", 0.15))
    roof_slope = safe_float_batiment_metal(data.get("roofSlope", 8.0))
    
    # Get model-specific values once at the top
    asym_pct = 0
    inc1, inc2 = 0, 0
    if post_model == 'asymetrique':
        asym_pct = safe_float_batiment_metal(data.get("asymmetryPct", 30))
        inc1 = safe_float_batiment_metal(data.get("inclination1", 15))
        inc2 = safe_float_batiment_metal(data.get("inclination2", 10))
    
    # --- 1. Gestion des entraxes et longueurs ---
    facade_length = safe_float_batiment_metal(data.get("facadeLength", 38.0))
    left_overhang = safe_float_batiment_metal(data.get("leftOverhang", 1.0))
    right_overhang = safe_float_batiment_metal(data.get("rightOverhang", 1.0))
    post_distances_expr = str(data.get("postDistances", ""))
    
    distances_result = parse_post_distances_batiment_metal(post_distances_expr, facade_length, left_overhang, right_overhang)
    
    # Validation stricte des données avant calculs
    validate_building_data_batiment_metal(data, distances_result.get("distances", []))
    
    # --- 2. Calcul du point bas structure (Sous traverse) ---
    # Égout - épaisseur couverture (0.05) - système IS - pannes - traverse
    total_roof_thickness = 0.05 + integration_sys_height + purlin_height + beam_height
    low_point_height = hauteur_egout - total_roof_thickness
    
    # --- 3. Calcul de la montée (MaxRoofRise) ---
    max_roof_rise = 0.0
    slope_rad = math.radians(roof_slope)
    
    if post_model == 'bipente':
        max_roof_rise = (width_roof / 2) * math.tan(slope_rad)
    elif post_model == 'monopente':
        max_roof_rise = width_roof * math.tan(slope_rad)
    elif post_model == 'asymetrique':
        width_l = width_roof * (asym_pct / 100.0)
        width_r = width_roof * (1.0 - (asym_pct / 100.0))
        max_roof_rise = max(width_l * math.tan(math.radians(inc1)), width_r * math.tan(math.radians(inc2)))
    elif post_model == 'multipente' and post_count > 1:
        max_roof_rise = ((width_roof / (post_count - 1)) / 2) * math.tan(slope_rad)

    # --- 4. Hauteurs finales ---
    post_height = low_point_height + max_roof_rise

    # --- 5. Calcul précis du Faîtage et des grandeurs Façade ---
    overhang_sym_value = safe_float_batiment_metal(data.get("overhangSymValue", 0.25))
    panel_width = safe_float_batiment_metal(data.get("panelWidth", 12.4))
    ground_slope_facade = safe_float_batiment_metal(data.get("groundSlopeFacade", 0))
    align_roof = data.get("alignRoof", False)

    pente_toiture_rad = slope_rad
    demi_largeur_batiment = width_roof / 2.0

    if post_model == 'monopente':
        demi_largeur_batiment = width_roof
        largeur_rampant_toiture = (demi_largeur_batiment / math.cos(pente_toiture_rad)) + overhang_sym_value
        faitage_calcule = hauteur_egout + (largeur_rampant_toiture * math.sin(pente_toiture_rad))
    elif post_model == 'asymetrique':
        inc1_rad = math.radians(inc1)
        inc2_rad = math.radians(inc2)
        w1 = width_roof * (asym_pct / 100.0)
        w2 = width_roof * (1.0 - (asym_pct / 100.0))
        l_rampant1 = (w1 / math.cos(inc1_rad)) + overhang_sym_value
        l_rampant2 = (w2 / math.cos(inc2_rad)) + overhang_sym_value
        rise1 = l_rampant1 * math.sin(inc1_rad)
        rise2 = l_rampant2 * math.sin(inc2_rad)
        faitage_calcule = hauteur_egout + max(rise1, rise2)
        pente_toiture_rad = inc1_rad if rise1 > rise2 else inc2_rad
    elif post_model == 'multipente' and post_count > 1:
        demi_largeur_batiment = (width_roof / (post_count - 1)) / 2.0
        largeur_rampant_toiture = (demi_largeur_batiment / math.cos(pente_toiture_rad)) + overhang_sym_value
        faitage_calcule = hauteur_egout + (largeur_rampant_toiture * math.sin(pente_toiture_rad))
    else:
        largeur_rampant_toiture = (demi_largeur_batiment / math.cos(pente_toiture_rad)) + overhang_sym_value
        faitage_calcule = hauteur_egout + (largeur_rampant_toiture * math.sin(pente_toiture_rad))

    roof_apparent_height = abs(panel_width * math.sin(slope_rad))
    panne_facade_height = purlin_height - (math.sin(slope_rad) * purlin_height)

    # CORRECTIF : "Haut Str." (plan de façade) doit être identique à la hauteur de Faîtage du plan
    # de coupe (faitage_calcule), pas post_height (hauteur de la structure porteuse SANS
    # l'épaisseur de couverture ni le porte-à-faux — l'écart entre les deux,
    # ~total_roof_thickness + overhang_sym_value*sin(pente), expliquait le décalage constaté
    # d'environ 67 cm). L'ancien calcul (low_point_height + roof_apparent_height) utilisait en
    # plus panel_width — un champ hérité du calepinage PV sans rapport avec la géométrie réelle du
    # bâtiment (width_roof).
    high_point_height_left = faitage_calcule
    # CORRECTIF : quand le terrain s'abaisse à droite (ground_slope_facade négatif), la structure
    # part d'un niveau de sol local plus bas, donc sa hauteur apparente à cet endroit doit
    # AUGMENTER (ex: Faîtage=8m, dénivelé=-0.5m => Haut Str.=8.5m), pas diminuer. D'où la
    # soustraction (et non l'addition) de ground_slope_facade.
    high_point_height_right = high_point_height_left if align_roof else (faitage_calcule - ground_slope_facade)

    # --- 6. Analyse du Calepinage Façade ---
    pv_layout = str(data.get("pvLayout", "10L x 30C")).lower().replace(' ', '')
    rows, cols = 0, 0
    if 'x' in pv_layout:
        parts = pv_layout.split('x')
        if len(parts) == 2:
            try:
                if 'l' in parts[0] and 'c' in parts[1]:
                    rows, cols = int(parts[0].replace('l', '')), int(parts[1].replace('c', ''))
                elif 'c' in parts[0] and 'l' in parts[1]:
                    cols, rows = int(parts[0].replace('c', '')), int(parts[1].replace('l', ''))
                else:
                    rows, cols = int(parts[0]), int(parts[1])
            except ValueError:
                pass

    # --- 7. Calculs Géométriques pour le rendu Vue (Canvas JS) ---
    invert_slope = data.get("invertSlope", False)
    post_width = safe_float_batiment_metal(data.get("postWidth", 0.3))
    brace_width = safe_float_batiment_metal(data.get("braceWidth", 0.1))
    purlin_thickness = safe_float_batiment_metal(data.get("purlinThickness", 0.1))
    purlin_count = int(safe_float_batiment_metal(data.get("purlinCount", 6)))
    
    brace_pos_pct = safe_float_batiment_metal(data.get("bracePosPct", 80))
    brace_pos_traverse_pot_rive = safe_float_batiment_metal(data.get("bracePosTraversePotRive", 30))
    brace_pos_interm_pct = safe_float_batiment_metal(data.get("bracePosIntermPct", 70))
    brace_pos_traverse_int_pct = safe_float_batiment_metal(data.get("bracePosTraverseIntPct", 30))
    reinforcement_type = data.get("reinforcementType", "bracons")
    inter_reinforcement_type = data.get("interReinforcementType", "bracons")
    height_under_brace = safe_float_batiment_metal(data.get("heightUnderBrace", 0))

    # 7.1 Poteaux (x)
    posts_x = []
    if post_count >= 2:
        post_spacing = width_roof / (post_count - 1)
        margin_x = -width_roof / 2
        for i in range(post_count):
            posts_x.append(margin_x + i * post_spacing)
    if not posts_x:
        posts_x.append(0)

    beam_center_y_base = -post_height + beam_height / 2
    traverse_points = []

    # 7.2 Lignes de Traverse (centres)
    if post_model == 'bipente':
        roof_center_y = beam_center_y_base - (width_roof / 2) * math.tan(slope_rad)
        traverse_points = [{'x': posts_x[0], 'y': beam_center_y_base}, {'x': 0, 'y': roof_center_y}, {'x': posts_x[-1], 'y': beam_center_y_base}]
    elif post_model == 'monopente':
        max_rise = width_roof * math.tan(slope_rad)
        roof_top_y = beam_center_y_base - max_rise
        if invert_slope:
            traverse_points = [{'x': posts_x[0], 'y': beam_center_y_base}, {'x': posts_x[-1], 'y': roof_top_y}]
        else:
            traverse_points = [{'x': posts_x[0], 'y': roof_top_y}, {'x': posts_x[-1], 'y': beam_center_y_base}]
    elif post_model == 'asymetrique':
        h1 = (width_roof * (asym_pct / 100.0)) * math.tan(math.radians(inc1))
        h2 = (width_roof * (1.0 - (asym_pct / 100.0))) * math.tan(math.radians(inc2))
        max_h = max(h1, h2)
        apex_x = posts_x[0] + (width_roof * (asym_pct / 100.0))
        traverse_points = [{'x': posts_x[0], 'y': beam_center_y_base + (max_h - h1)}, {'x': apex_x, 'y': beam_center_y_base - max_h}, {'x': posts_x[-1], 'y': beam_center_y_base + (max_h - h2)}]
    elif post_model == 'multipente':
        rise = ((width_roof / (post_count - 1)) / 2) * math.tan(slope_rad) if post_count > 1 else 0
        valley_points = [{'x': x, 'y': beam_center_y_base} for x in posts_x]
        traverse_points = [valley_points[0]]
        for i in range(len(posts_x) - 1):
            x_mid = (posts_x[i] + posts_x[i+1]) / 2
            traverse_points.extend([{'x': x_mid, 'y': beam_center_y_base - rise}, valley_points[i+1]])

    traverse_bottom_lines = [get_offset_line_batiment_metal(traverse_points[i], traverse_points[i+1], beam_height / 2) for i in range(len(traverse_points)-1)]
    traverse_top_lines = [get_offset_line_batiment_metal(traverse_points[i], traverse_points[i+1], -beam_height / 2) for i in range(len(traverse_points)-1)]

    # 7.3 Têtes de poteaux
    post_tops = []
    for index, x in enumerate(posts_x):
        post_top_y = beam_center_y_base
        if len(posts_x) > 1 and post_model != 'multipente':
            is_edge = (index == 0 or index == len(posts_x) - 1)
            lines_to_search = traverse_top_lines if is_edge else traverse_bottom_lines
            target_line = next((line for line in lines_to_search if min(line['p1']['x'], line['p2']['x']) - 0.1 <= x <= max(line['p1']['x'], line['p2']['x']) + 0.1), lines_to_search[0])
            inter = intersect_lines_dict_batiment_metal({'x': x, 'y': 1000}, {'x': x, 'y': -1000}, target_line['p1'], target_line['p2'], True)
            if inter: post_top_y = inter['y']
        post_tops.append({'x': x, 'y': post_top_y})

    # 7.4 Préparation des Polygons de rendu (Traverses, Pannes, Couvertures)
    traverse_polygons, cover_polygons, purlin_polygons, rampant_anchors, rampant_lengths = [], [], [], [], []
    def get_y_on_line(p1, p2, x_val):
        return p1['y'] + (x_val - p1['x']) * (p2['y'] - p1['y']) / (p2['x'] - p1['x']) if abs(p2['x'] - p1['x']) > 0.001 else p1['y']

    total_purlin_cover_height = purlin_height + 0.05
    for i in range(len(traverse_points) - 1):
        p1_top, p2_top = traverse_top_lines[i]['p1'], traverse_top_lines[i]['p2']
        p1_bot, p2_bot = traverse_bottom_lines[i]['p1'], traverse_bottom_lines[i]['p2']

        # Intersections entre sections pour joints propres
        draw_p2_top, draw_p2_bot = p2_top, p2_bot
        if i < len(traverse_points) - 2:
            n_top, n_bot = traverse_top_lines[i+1], traverse_bottom_lines[i+1]
            i_top = intersect_lines_dict_batiment_metal(p1_top, p2_top, n_top['p1'], n_top['p2'])
            if i_top: draw_p2_top = i_top
            i_bot = intersect_lines_dict_batiment_metal(p1_bot, p2_bot, n_bot['p1'], n_bot['p2'])
            if i_bot: draw_p2_bot = i_bot

        draw_p1_top, draw_p1_bot = p1_top, p1_bot
        if i > 0:
            pr_top, pr_bot = traverse_top_lines[i-1], traverse_bottom_lines[i-1]
            i_top = intersect_lines_dict_batiment_metal(pr_top['p1'], pr_top['p2'], p1_top, p2_top)
            if i_top: draw_p1_top = i_top
            i_bot = intersect_lines_dict_batiment_metal(pr_bot['p1'], pr_bot['p2'], p1_bot, p2_bot)
            if i_bot: draw_p1_bot = i_bot

        # Trimming aux poteaux extérieurs
        if i == 0:
            trim_x = posts_x[0] + post_width / 2
            draw_p1_top, draw_p1_bot = {'x': trim_x, 'y': get_y_on_line(p1_top, p2_top, trim_x)}, {'x': trim_x, 'y': get_y_on_line(p1_bot, p2_bot, trim_x)}
        if i == len(traverse_points) - 2:
            trim_x = posts_x[-1] - post_width / 2
            draw_p2_top, draw_p2_bot = {'x': trim_x, 'y': get_y_on_line(p1_top, p2_top, trim_x)}, {'x': trim_x, 'y': get_y_on_line(p1_bot, p2_bot, trim_x)}

        traverse_polygons.append([draw_p1_top, draw_p2_top, draw_p2_bot, draw_p1_bot])

        # Calcul Pannes et Couvertures
        angle = math.atan2(p2_top['y'] - p1_top['y'], p2_top['x'] - p1_top['x'])
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        
        p0_roof_start, p3_roof_end = draw_p1_top.copy(), draw_p2_top.copy()
        if i == 0:
            p0_roof_start = {'x': draw_p1_top['x'] - overhang_sym_value * cos_a, 'y': draw_p1_top['y'] - overhang_sym_value * sin_a}
        if i == len(traverse_points) - 2:
            p3_roof_end = {'x': draw_p2_top['x'] + overhang_sym_value * cos_a, 'y': draw_p2_top['y'] + overhang_sym_value * sin_a}
            
        c_top = get_offset_line_batiment_metal(p0_roof_start, p3_roof_end, -total_purlin_cover_height)
        c_bot = get_offset_line_batiment_metal(p0_roof_start, p3_roof_end, -purlin_height)
        cover_polygons.append([c_top['p1'], c_top['p2'], c_bot['p2'], c_bot['p1']])

        # Pannes (positions distribuées)
        purlin_span = math.hypot(draw_p2_top['x'] - draw_p1_top['x'], draw_p2_top['y'] - draw_p1_top['y'])
        if purlin_count > 1:
            start_d, end_d = purlin_thickness / 2, purlin_span - (purlin_thickness / 2)
            for j in range(purlin_count):
                dist = start_d + j * (end_d - start_d) / (purlin_count - 1)
                if dist <= purlin_span:
                    purlin_polygons.append({'x': draw_p1_top['x'] + dist * cos_a, 'y': draw_p1_top['y'] + dist * sin_a, 'w': purlin_thickness, 'h': purlin_height, 'angle': angle})

    # Bug 2 Fix: Post-process cover polygons to create clean, mitered joins at ridges/valleys.
    # This calculates the intersection of adjacent roof panels and updates their vertices.
    for i in range(len(cover_polygons) - 1):
        poly1, poly2 = cover_polygons[i], cover_polygons[i+1]
        # Intersect the top lines of the cover segments (poly[0] -> poly[1])
        intersect_top = intersect_lines_dict_batiment_metal(poly1[0], poly1[1], poly2[0], poly2[1], extend_both=True)
        if intersect_top:
            poly1[1] = intersect_top  # Update end point of current segment's top line
            poly2[0] = intersect_top  # Update start point of next segment's top line
        # Intersect the bottom lines of the cover segments (poly[3] -> poly[2])
        intersect_bot = intersect_lines_dict_batiment_metal(poly1[3], poly1[2], poly2[3], poly2[2], extend_both=True)
        if intersect_bot:
            poly1[2] = intersect_bot  # Update end point of current segment's bottom line
            poly2[3] = intersect_bot  # Update start point of next segment's bottom line

    # Mise à jour des cotations des rampants après la création des jonctions biseautées
    rampant_anchors = []
    rampant_lengths = []
    for poly in cover_polygons:
        p1, p2 = poly[0], poly[1]  # Points de la face supérieure du panneau de couverture
        ramp_len = math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
        rampant_lengths.append(round_2_batiment_metal(ramp_len))
        rampant_anchors.append({'p1': p1, 'p2': p2})

    # 7.5 Renforts (Bracons/Jarrets)
    def get_traverse_line_at_x(x_val):
        for line in traverse_bottom_lines:
            min_x = min(line['p1']['x'], line['p2']['x'])
            max_x = max(line['p1']['x'], line['p2']['x'])
            if min_x - 0.1 <= x_val <= max_x + 0.1:
                return line
        # S'il dépasse légèrement, récupérer la vraie ligne la plus proche au lieu d'aplatir
        return min(traverse_bottom_lines, key=lambda l: min(abs(x_val - l['p1']['x']), abs(x_val - l['p2']['x'])))

    def get_y_on_traverse(x_val):
        line = get_traverse_line_at_x(x_val)
        p1, p2 = line['p1'], line['p2']
        if abs(p2['x'] - p1['x']) > 0.001:
            return p1['y'] + (x_val - p1['x']) * (p2['y'] - p1['y']) / (p2['x'] - p1['x'])
        return p1['y']

    braces = []
    for index, x in enumerate(posts_x):
        is_edge = (index == 0 or index == len(posts_x) - 1)
        reinforce_type = reinforcement_type if is_edge else inter_reinforcement_type
        if reinforce_type == 'none': continue
        
        current_post_top_y = post_tops[index]['y']
        if height_under_brace > 0:
            pos_y = -height_under_brace
        else:
            pos_y = current_post_top_y * (brace_pos_pct / 100.0) if is_edge else current_post_top_y * (brace_pos_interm_pct / 100.0)
            
        pos_y = max(current_post_top_y, min(0, pos_y))
        if pos_y == 0 and height_under_brace == 0: continue
        
        targets = []
        if is_edge:
            targets.append((x + post_width/2 if index==0 else x - post_width/2, traverse_bottom_lines[0] if index==0 else traverse_bottom_lines[-1], index==0))
        else:
            # Correction chirurgicale : Ciblage de la travée parente exacte proportionnelle au span local
            span_left_x, span_right_x = posts_x[index-1], x
            fake_line_left = {'p1': {'x': span_left_x, 'y': get_y_on_traverse(span_left_x)}, 'p2': {'x': span_right_x, 'y': get_y_on_traverse(span_right_x)}}
            
            span_left_x_r, span_right_x_r = x, posts_x[index+1]
            fake_line_right = {'p1': {'x': span_left_x_r, 'y': get_y_on_traverse(span_left_x_r)}, 'p2': {'x': span_right_x_r, 'y': get_y_on_traverse(span_right_x_r)}}

            # Le bracon gauche s'attache à la travée gauche
            targets.append((x - post_width/2, fake_line_left, False))
            # Le bracon droit s'attache à la travée droite
            targets.append((x + post_width/2, fake_line_right, True))
            
        for p_x, t_line, is_left_oriented in targets:
            brace_p = brace_pos_traverse_pot_rive / 100 if is_edge else brace_pos_traverse_int_pct / 100
            p_start, p_corner = {'x': p_x, 'y': pos_y}, {'x': p_x, 'y': post_tops[index]['y']}
            
            # Calculer purement la composante X d'ancrage
            if is_left_oriented:
                p_end_x = t_line['p1']['x'] + (t_line['p2']['x'] - t_line['p1']['x']) * brace_p
            else:
                p_end_x = t_line['p2']['x'] - (t_line['p2']['x'] - t_line['p1']['x']) * brace_p
                
            real_t_line = get_traverse_line_at_x(p_end_x)
            p_end = {'x': p_end_x, 'y': get_y_on_traverse(p_end_x)}
            
            if reinforce_type == 'jarrets':
                braces.append({'points': [p_corner, p_end, {'x': p_x, 'y': pos_y}], 'type': 'jarrets'})
            elif reinforce_type == 'bracons':
                a = math.atan2(p_end['y'] - p_start['y'], p_end['x'] - p_start['x']) + math.pi / 2
                off_x, off_y = (brace_width / 2) * math.cos(a), (brace_width / 2) * math.sin(a)
                c1, c2 = {'x': p_start['x'] + off_x, 'y': p_start['y'] + off_y}, {'x': p_start['x'] - off_x, 'y': p_start['y'] - off_y}
                c3, c4 = {'x': p_end['x'] + off_x, 'y': p_end['y'] + off_y}, {'x': p_end['x'] - off_x, 'y': p_end['y'] - off_y}
                b_poly = [
                    intersect_lines_dict_batiment_metal(c1, c3, {'x': p_x, 'y': 1000}, {'x': p_x, 'y': -1000}, extend_both=True),
                    intersect_lines_dict_batiment_metal(c1, c3, real_t_line['p1'], real_t_line['p2'], extend_both=True),
                    intersect_lines_dict_batiment_metal(c2, c4, real_t_line['p1'], real_t_line['p2'], extend_both=True),
                    intersect_lines_dict_batiment_metal(c2, c4, {'x': p_x, 'y': 1000}, {'x': p_x, 'y': -1000}, extend_both=True)
                ]
                if all(b_poly): braces.append({'points': b_poly, 'type': 'bracons'})

    # Ancrages des cotations
    dim_egout_x = rampant_anchors[-1]['p2']['x'] if rampant_anchors else 0
    dim_egout_y = rampant_anchors[-1]['p2']['y'] if rampant_anchors else 0
    dim_faitage_y = min((p['y'] for poly in cover_polygons for p in poly), default=0)
    dim_bas_str_y = traverse_bottom_lines[-1]['p2']['y'] if traverse_bottom_lines else 0

    # Construction de la réponse unifiée
    response_data = data.copy()
    response_data.update({
        "lowPointHeight": round_2_batiment_metal(low_point_height),
        "postHeight": round_2_batiment_metal(post_height),
        "faitageCalcule": round_2_batiment_metal(faitage_calcule),
        "maxRoofRise": round_2_batiment_metal(max_roof_rise),
        "roofApparentHeight": round_2_batiment_metal(roof_apparent_height),
        "panneFacadeHeight": round_2_batiment_metal(panne_facade_height),
        "highPointHeightLeft": round_2_batiment_metal(high_point_height_left),
        "highPointHeightRight": round_2_batiment_metal(high_point_height_right),
        "pvRows": rows,
        "pvCols": cols,
        "parsedDistances": distances_result["distances"],
        "postDistancesError": distances_result["error"],
        "geometry": {
            "postsX": posts_x,
            "traversePolygons": traverse_polygons,
            "coverPolygons": cover_polygons,
            "purlinPolygons": purlin_polygons,
            "postTops": post_tops,
            "braces": braces,
            "dimensions": {
                "largeur_batiment": width_roof,
                "faitage": faitage_calcule,
                "egout": hauteur_egout,
                "bas_structure": low_point_height,
                "rampants": rampant_lengths,
                "pente": roof_slope,
                "anchors": {"bas_structure_y": dim_bas_str_y, "egout_x": dim_egout_x, "egout_y": dim_egout_y, "faitage_y": dim_faitage_y, "rampant_lines": rampant_anchors}
            }
        }
    })
    return response_data