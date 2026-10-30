"""
ombriere.py — Logique métier de l'ombrière solaire (Solakvan)
Toute la logique de calcul extraite de ombriere.js
"""

import math
import re


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
    if post_model == "y_shape":
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


def build_drawing_data(data: dict, result: dict) -> dict:
    """
    Construit les données de dessin géométriques (polygones, cotations) pour le plan de coupe JS.
    """
    import math
    polygons = []
    dimensions = []
    texts = []

    post_model = result.get("post_model", "single")
    post_height = result.get("post_height", 0)
    panel_width = result.get("panel_width", 0)
    roof_slope_rad = result.get("roof_slope_radians", 0)
    post_width = result.get("post_width", 0.4)
    beam_length = result.get("beam_length", panel_width)
    beam_height = float(data.get("beam_height", 0.4))
    eccentricity = result.get("post_eccentricity_clamped", 0)

    beam_center_y = -post_height
    roof_center_y = beam_center_y - beam_height

    # 1. Dessin du ou des Poteaux
    def get_vert_intersection_y():
        active_slope = abs(roof_slope_rad) if post_model == "y_shape" else roof_slope_rad
        return beam_center_y + (beam_height / 2) / math.cos(active_slope)

    vert_intersection_y = get_vert_intersection_y()

    def get_vert_post_exact(cx):
        dx_base = cx - eccentricity
        active_slope = roof_slope_rad
        if post_model == "y_shape":
            if abs(dx_base) < 0.01:
                pass
            else:
                active_slope = -roof_slope_rad if dx_base > 0 else roof_slope_rad

        m_b = math.tan(active_slope)
        c_b0 = beam_center_y + (beam_height / 2) / math.cos(active_slope)
        c_b = c_b0 - m_b * eccentricity

        if post_model in ["double", "offset"]:
            c_b = c_b0
        
        left_x = cx - post_width/2
        right_x = cx + post_width/2
        left_y = m_b * left_x + c_b
        right_y = m_b * right_x + c_b
        
        if post_model == "y_shape" and abs(dx_base) < 0.01:
            left_y = vert_intersection_y
            right_y = vert_intersection_y
            
        return {
            "points": [
                {"x": left_x, "y": 0},
                {"x": right_x, "y": 0},
                {"x": right_x, "y": right_y},
                {"x": left_x, "y": left_y}
            ],
            "fill": "#9ca3af", "stroke": "#374151", "lineWidth": 1.5
        }

    def get_inclined_pole_exact(base_x, angle_deg, target_x):
        dx_base = base_x - eccentricity
        active_slope = roof_slope_rad
        if post_model == "y_shape":
            active_slope = -roof_slope_rad if dx_base > 0 else roof_slope_rad
            
        m_b = math.tan(active_slope)
        c_b0 = beam_center_y + (beam_height / 2) / math.cos(active_slope)
        c_b = c_b0 - m_b * eccentricity

        if post_model in ["double", "offset"]:
            c_b = c_b0

        if post_model in ["inclinedPost", "y_shape", "double", "offset"]:
            angle_rad = math.radians(abs(angle_deg))
        else:
            angle_rad = math.radians(-abs(angle_deg))
        dir_val = 1 if base_x < target_x else -1
        tan_a = math.tan(angle_rad)
        
        if abs(tan_a) < 0.001:
            m_p = None
        else:
            m_p = tan_a / dir_val

        if m_p:
            dx_ground = (post_width / 2) / math.sin(abs(angle_rad))
        else:
            dx_ground = post_width / 2
            
        left_base_x = base_x - dx_ground
        right_base_x = base_x + dx_ground

        if m_p is None:
            top_left_x = left_base_x
            top_left_y = m_b * top_left_x + c_b
            top_right_x = right_base_x
            top_right_y = m_b * top_right_x + c_b
        else:
            top_left_x = (c_b + m_p * left_base_x) / (m_p - m_b)
            top_left_y = m_b * top_left_x + c_b
            top_right_x = (c_b + m_p * right_base_x) / (m_p - m_b)
            top_right_y = m_b * top_right_x + c_b

        return {
            "points": [
                {"x": left_base_x, "y": 0},
                {"x": right_base_x, "y": 0},
                {"x": top_right_x, "y": top_right_y},
                {"x": top_left_x, "y": top_left_y}
            ],
            "fill": "#9ca3af", "stroke": "#374151", "lineWidth": 1.5
        }

    def get_oblique_bar(x1, y1, x2, y2):
        angle = math.atan2(y2 - y1, x2 - x1)
        thickness = float(data.get("braceThickness", 25)) / 100.0
        dx = (thickness / 2) * math.sin(angle)
        dy = (thickness / 2) * math.cos(angle)
        return {
            "points": [
                {"x": x1 - dx, "y": min(0, y1 + dy)},
                {"x": x1 + dx, "y": min(0, y1 - dy)},
                {"x": x2 + dx, "y": min(0, y2 - dy)},
                {"x": x2 - dx, "y": min(0, y2 + dy)}
            ],
            "fill": "#6b7280", "stroke": "#374151", "lineWidth": 1.5
        }

    inc_left = float(data.get("post_inclination_left", 65))
    inc_right = float(data.get("post_inclination_right", 65))
    bracing_pos = float(data.get("bracing_position", 80)) / 100.0

    if post_model == "inclinedPost":
        dist_ext = result.get("coupe_entraxe", 3.54) / 2
        
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, eccentricity - dist_ext, 0))
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, eccentricity + dist_ext, 0))
        
        hide_central_post = data.get("hide_central_post", False)
        if not hide_central_post:
            polygons.append(get_vert_post_exact(eccentricity))
        polygons.append(get_inclined_pole_exact(eccentricity - dist_ext, inc_left, eccentricity))
        polygons.append(get_inclined_pole_exact(eccentricity + dist_ext, inc_right, eccentricity))
        
    elif post_model == "y_shape":
        dist_ext = result.get("coupe_entraxe", 3.54) / 2
        
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, eccentricity - dist_ext, 0))
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, eccentricity + dist_ext, 0))
        
        polygons.append(get_vert_post_exact(eccentricity))
        polygons.append(get_inclined_pole_exact(eccentricity - dist_ext, inc_left, eccentricity))
        polygons.append(get_inclined_pole_exact(eccentricity + dist_ext, inc_right, eccentricity))
        
    elif post_model == "double":
        is_v2 = data.get("double_post_bracing") == "v2"
        dist = result.get("coupe_entraxe", 1.92)
        sign = -1 if is_v2 else 1
        base_x = eccentricity + sign * dist
        
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, base_x, 0))
        
        polygons.append(get_vert_post_exact(eccentricity))
        polygons.append(get_inclined_pole_exact(base_x, inc_left, eccentricity))
        
    elif post_model == "offset":
        is_v2 = data.get("double_post_bracing") == "v2"
        dist = result.get("coupe_entraxe", 1.80)
        sign = -1 if is_v2 else 1
        base_x = eccentricity + sign * dist
        
        polygons.append(get_oblique_bar(eccentricity, vert_intersection_y * bracing_pos, base_x, 0))
        
        polygons.append(get_vert_post_exact(eccentricity))
        polygons.append(get_inclined_pole_exact(base_x, inc_left, eccentricity))
    else:
        polygons.append(get_vert_post_exact(eccentricity))

    # 2. Dessin de la Traverse et du Panneau de toiture
    def rotate_point(px, py, cx, cy, angle):
        rx = math.cos(angle) * (px - cx) - math.sin(angle) * (py - cy) + cx
        ry = math.sin(angle) * (px - cx) + math.cos(angle) * (py - cy) + cy
        return {"x": rx, "y": ry}

    if post_model == "y_shape":
        # beam_length est déjà la longueur d'un demi-rampant (panel_width/2 - overhang)
        # Chaque pan part de l'apex (eccentricity) vers l'extérieur sur beam_length
        for sign in [-1, 1]:
            half_beam = beam_length / 2          # demi-longueur de traverse par pan
            half_panel = panel_width / 4         # = (panel_width/2) / 2 = demi-largeur de panneau par pan
            b_pts = [
                {"x": eccentricity + sign * half_beam - half_beam, "y": beam_center_y},
                {"x": eccentricity + sign * half_beam + half_beam, "y": beam_center_y},
                {"x": eccentricity + sign * half_beam + half_beam, "y": beam_center_y - beam_height},
                {"x": eccentricity + sign * half_beam - half_beam, "y": beam_center_y - beam_height}
            ]
            rot_beam = [rotate_point(p["x"], p["y"], eccentricity, beam_center_y, -sign * roof_slope_rad) for p in b_pts]
            polygons.append({"points": rot_beam, "fill": "#d1d5db", "stroke": "#374151", "lineWidth": 1.5})

            r_pts = [
                {"x": eccentricity + sign * half_panel - half_panel, "y": roof_center_y},
                {"x": eccentricity + sign * half_panel + half_panel, "y": roof_center_y},
                {"x": eccentricity + sign * half_panel + half_panel, "y": roof_center_y - 0.15},
                {"x": eccentricity + sign * half_panel - half_panel, "y": roof_center_y - 0.15}
            ]
            rot_roof = [rotate_point(p["x"], p["y"], eccentricity, beam_center_y, -sign * roof_slope_rad) for p in r_pts]
            polygons.append({"points": rot_roof, "fill": "rgba(67, 56, 202, 0.7)", "stroke": "#374151", "lineWidth": 1.5})
    else:
        b_pts = [
            {"x": eccentricity - beam_length/2, "y": beam_center_y},
            {"x": eccentricity + beam_length/2, "y": beam_center_y},
            {"x": eccentricity + beam_length/2, "y": beam_center_y - beam_height},
            {"x": eccentricity - beam_length/2, "y": beam_center_y - beam_height}
        ]
        rotated_beam = [rotate_point(p["x"], p["y"], eccentricity, beam_center_y, roof_slope_rad) for p in b_pts]
        polygons.append({"points": rotated_beam, "fill": "#d1d5db", "stroke": "#374151", "lineWidth": 1.5})

        r_pts = [
            {"x": eccentricity + panel_width/2, "y": roof_center_y},
            {"x": eccentricity + panel_width/2, "y": roof_center_y - 0.15},
            {"x": eccentricity - panel_width/2, "y": roof_center_y - 0.15}
        ]
        rotated_roof = [rotate_point(p["x"], p["y"], eccentricity, beam_center_y, roof_slope_rad) for p in r_pts]
        polygons.append({"points": rotated_roof, "fill": "rgba(67, 56, 202, 0.7)", "stroke": "#374151", "lineWidth": 1.5})

    return {
        "polygons": polygons,
        "dimensions": dimensions,
        "texts": texts
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

    # === MODIFICATION CHIRURGICALE ===
    if post_model == "double":
        data["roof_slope"] = 8.0
        if overhang_sym_value == 0:
            overhang_sym_value = 0.5
        if double_post_bracing == "v2":
            data["passage_height"] = 2.60
            data["invert_slope"] = True
        else:
            data["passage_height"] = 2.38
            data["invert_slope"] = False
    elif post_model == "offset":
        data["roof_slope"] = 8.0
        data["passage_height"] = 2.60
        if double_post_bracing == "v2":
            data["invert_slope"] = True
        else:
            data["invert_slope"] = False

    # Re-lecture des valeurs pour garantir la physique du dessin
    passage_height = float(data.get("passage_height", 0))
    roof_slope = float(data.get("roof_slope", 0))
    invert_slope = bool(data.get("invert_slope", False))
    panel_width = float(data.get("panel_width", 0))
    post_width = float(data.get("post_width", 0))
    beam_height = float(data.get("beam_height", 0))
    purlin_height = float(data.get("purlin_height", 0))
    integration_system_height = float(data.get("integration_system_height", 0))
    panel_thickness = float(data.get("panel_thickness", 0))

    post_eccentricity = float(data.get("post_eccentricity", 0))

    # === 1. Calcul overhang (porte-à-faux) ===
    if overhang_type == "sym" or post_model == "y_shape":
        overhang_h = overhang_l = overhang_sym_value
    else:
        overhang_h = overhang_asym_high
        overhang_l = overhang_asym_low

    # === 1.5. Excentrement spécial Ras-de-panne pour Modèle Offset ===
    beam_length_computed = (panel_width / 2.0 - overhang_sym_value) if post_model == "y_shape" else (panel_width - overhang_h - overhang_l)
    if post_model == "offset":
        is_low = (offset_post_side == "low")
        put_on_left = not is_low if invert_slope else is_low
        if put_on_left:
            post_eccentricity = (beam_length_computed / 2) - (post_width / 2)
        else:
            post_eccentricity = -(beam_length_computed / 2) + (post_width / 2)
            
    elif post_model == "double":
        if invert_slope:
            post_eccentricity = -(panel_width / 2) + 1.45 + (post_width / 2)
        else:
            post_eccentricity = (panel_width / 2) - 1.45 - (post_width / 2)

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

    # Pannes encastrées latéralement -> ne s'additionnent plus à la hauteur globale
    low_point_height = (
        passage_height + beam_height +
        integration_system_height + panel_thickness
    )

    # === 4. Calcul angle de toiture ===
    roof_slope_radians = roof_slope * math.pi / 180 * (-1 if invert_slope else 1)

    # === 5. Calcul hauteur poteau ===
    new_post_height = 0.0

    if post_model == "y_shape":
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
    if post_model == "y_shape":
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
    if post_model == "y_shape":
        high_point_height = low_point_height + abs((panel_width / 2.0) * math.sin(roof_slope_radians))
    else:
        high_point_height = low_point_height + abs(panel_width * math.sin(roof_slope_radians))

    result = {
        # Hauteurs calculées (à afficher dans les champs readonly)
        "low_point_height": round(low_point_height, 2),
        "post_height": round(new_post_height, 2),
        "high_point_height": round(high_point_height, 2),

        # Géométrie
        "beam_length": round(beam_length, 4),
        "total_projection_width": round(total_projection_width, 4),
        "overhang_h": overhang_h,
        "overhang_l": overhang_l,
        "post_inclination_left": float(data.get("post_inclination_left", 65)),
        "post_inclination_right": float(data.get("post_inclination_right", 65)),
        "bracing_position": float(data.get("bracing_position", 80)),
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
    
    # Calcul des entraxes spécifiques pour le plan de coupe
    if post_model in ["inclinedPost", "y_shape"]:
        # 3.54m entre les pieds des poteaux inclinés
        result["coupe_entraxe"] = 3.54 
    elif post_model == "double":
        result["coupe_entraxe"] = 1.92
    elif post_model == "offset":
        result["coupe_entraxe"] = 1.80

    # Forcer la division par deux pour le modèle en V
    if post_model == "y_shape":
        result["half_panel_width"] = panel_width / 2

    # Intégration de la génération de géométrie pour JS
    result["drawing"] = build_drawing_data(data, result)
    return result