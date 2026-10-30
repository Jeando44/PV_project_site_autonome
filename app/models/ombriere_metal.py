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
    if overhang_type == "sym" or post_model == "y_shape":
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
    low_point_height = (
        passage_height + beam_height + purlin_height +
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

    return {
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