# -*- coding: utf-8 -*-
"""
Normalisation des primitives génériques produites par ombriere_metal_v2.py
(generate_coupe / generate_facade / generate_implantation) : shapes
(polygon/rect, avec transform optionnel), dimensions (cotes), leaders (lignes
de renvoi), texts.

Un seul point de conversion "geom (repère canvas, Y vers le bas, comme
ombriere_metal.js) -> opérations de dessin en coordonnées absolues réelles
(mètres, Y vers le haut)", réutilisé par les deux cibles de rendu (PDF
vectoriel ReportLab et DXF ezdxf) pour ne dupliquer qu'une seule fois la
géométrie des transforms/cotes/lignes de renvoi.
"""
import math

DIM_TICK = 0.08  # demi-longueur des amorces de cote (m)


def _rotate(x, y, angle):
    c, s = math.cos(angle), math.sin(angle)
    return x * c - y * s, x * s + y * c


def _apply_transform(x, y, tf):
    if not tf:
        return x, y
    rx, ry = _rotate(x, y, tf.get('angle', 0))
    return tf.get('x', 0) + rx, tf.get('y', 0) + ry


def hex_to_rgb(hex_color):
    if not hex_color or not isinstance(hex_color, str):
        return None
    h = hex_color.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def build_draw_ops(geom):
    """
    Retourne une liste d'opérations en coordonnées absolues réelles (mètres,
    Y vers le haut) :
      {'kind': 'polyline', 'points': [(x,y),...], 'closed': bool, 'stroke': '#rrggbb'|None, 'fill': '#rrggbb'|None, 'category': str|None}
      {'kind': 'text', 'x':.., 'y':.., 'text': str, 'angle': float (rad), 'category': str|None}

    `category` est une étiquette sémantique (ex: 'structure', 'panel',
    'dimension_line', 'dimension_text', 'hatching') indépendante de la couleur
    hex utilisée pour le PDF - elle permet au rendu DXF d'appliquer sa propre
    palette (cf. ombriere_metal_dxf.py) sans toucher au rendu PDF, qui continue
    lui à utiliser 'stroke'/'fill' tels quels.
    """
    ops = []

    def flip(x, y):
        return x, -y

    for shape in geom.get('shapes', []):
        tf = shape.get('transform')
        if shape['type'] == 'polygon':
            raw_pts = [(p['x'], p['y']) for p in shape['points']]
        else:  # rect
            x, y, w, h = shape['x'], shape['y'], shape['w'], shape['h']
            raw_pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        pts = [flip(*_apply_transform(px, py, tf)) for px, py in raw_pts]
        ops.append({'kind': 'polyline', 'points': pts, 'closed': True, 'stroke': shape.get('stroke'), 'fill': shape.get('fill'), 'category': shape.get('category')})

    for dim in geom.get('dimensions', []):
        is_vertical = bool(dim.get('isVertical'))
        offset = dim.get('offset') or 0
        if is_vertical:
            x1o, y1o = flip(dim['x1'] + offset, dim['y1'])
            x2o, y2o = flip(dim['x2'] + offset, dim['y2'])
            tick_dx, tick_dy = DIM_TICK, 0
        else:
            x1o, y1o = flip(dim['x1'], dim['y1'] + offset)
            x2o, y2o = flip(dim['x2'], dim['y2'] + offset)
            tick_dx, tick_dy = 0, DIM_TICK
        ops.append({'kind': 'polyline', 'points': [(x1o, y1o), (x2o, y2o)], 'closed': False, 'stroke': '#000000', 'fill': None, 'category': 'dimension_line'})
        ops.append({'kind': 'polyline', 'points': [(x1o - tick_dx, y1o - tick_dy), (x1o + tick_dx, y1o + tick_dy)], 'closed': False, 'stroke': '#000000', 'fill': None, 'category': 'dimension_line'})
        ops.append({'kind': 'polyline', 'points': [(x2o - tick_dx, y2o - tick_dy), (x2o + tick_dx, y2o + tick_dy)], 'closed': False, 'stroke': '#000000', 'fill': None, 'category': 'dimension_line'})
        mid_x, mid_y = (x1o + x2o) / 2, (y1o + y2o) / 2
        ops.append({'kind': 'text', 'x': mid_x, 'y': mid_y + (0.12 if not is_vertical else 0), 'text': dim.get('text', ''), 'angle': math.pi / 2 if is_vertical else 0, 'category': 'dimension_text'})

    for leader in geom.get('leaders', []):
        xt, yt = flip(leader['x_target'], leader['y_target'])
        x_dim, _ = flip(leader['x_dim_line'], leader['y_target'])
        _, ground_y = flip(leader['x_dim_line'], leader.get('ground_y', 0))
        ops.append({'kind': 'polyline', 'points': [(xt, yt), (x_dim, yt)], 'closed': False, 'stroke': '#000000', 'fill': None, 'category': 'dimension_line'})
        ops.append({'kind': 'polyline', 'points': [(x_dim, yt), (x_dim, ground_y)], 'closed': False, 'stroke': '#000000', 'fill': None, 'category': 'dimension_line'})
        vertical_leader = abs(ground_y - yt) > abs(x_dim - xt)
        ops.append({'kind': 'text', 'x': x_dim + (0.15 if not vertical_leader else 0), 'y': (yt + ground_y) / 2, 'text': leader.get('text', ''), 'angle': math.pi / 2 if vertical_leader else 0, 'category': 'dimension_text'})

    for txt in geom.get('texts', []):
        tf = txt.get('transform')
        x, y = flip(*_apply_transform(txt['x'], txt['y'], tf))
        angle = -(tf.get('angle', 0)) if tf else 0
        ops.append({'kind': 'text', 'x': x, 'y': y, 'text': txt.get('text', ''), 'angle': angle, 'category': 'text_label'})

    return ops


def bbox_of_ops(ops):
    xs, ys = [], []
    for op in ops:
        if op['kind'] == 'polyline':
            for x, y in op['points']:
                xs.append(x)
                ys.append(y)
        else:
            xs.append(op['x'])
            ys.append(op['y'])
    if not xs:
        return 0.0, 0.0, 1.0, 1.0
    return min(xs), min(ys), max(xs), max(ys)


NICE_SCALES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 500, 1000]


def pick_nice_scale(needed):
    """Plus petite échelle 'propre' (1/N) supérieure ou égale à `needed` -
    garantit que le dessin tient dans l'espace disponible (cf. plan_de_masse.js)."""
    for s in NICE_SCALES:
        if s >= needed:
            return s
    return math.ceil(needed / 100.0) * 100
