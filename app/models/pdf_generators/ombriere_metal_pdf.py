# -*- coding: utf-8 -*-
"""
Génération PDF vectorielle (ReportLab) du plan de coupe + façade d'une
ombrière métal : A3 paysage, cadre 3mm, cartouche (angle inférieur droit),
une page par vue (coupe puis façade), échelle calculée automatiquement pour
remplir le maximum d'espace disponible dans la page.

Source de la géométrie : dxf_generators/ombriere_metal_v2.py (calculate_ombriere
-> geometry.coupe / geometry.facade), les mêmes primitives génériques que
celles utilisées par le DXF (dxf_generators/ombriere_metal_dxf.py) - normalisées
une seule fois par ombriere_geom_render.build_draw_ops.
"""
import io

from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas

from app.models.dxf_generators.ombriere_metal_v2 import calculate_ombriere
from app.models.dxf_generators.ombriere_geom_render import (
    build_draw_ops, bbox_of_ops, pick_nice_scale, hex_to_rgb,
)
from app.models.pdf_generators.pdf_cartouche import (
    PAGE_W_MM, PAGE_H_MM, MARGIN_MM, X as _X, Y as _Y,
    draw_cadre as _draw_cadre, draw_cartouche as _draw_cartouche,
)

DRAWING_PADDING_MM = 8.0


def _place_and_draw(c, ops):
    """Centre + met à l'échelle `ops` (mètres, Y vers le haut) dans la zone
    imprimable hors cartouche, à l'échelle 'propre' la plus grande possible
    qui tient dans l'espace disponible. Retourne la chaîne d'échelle (ex: '1:50')."""
    min_x, min_y, max_x, max_y = bbox_of_ops(ops)
    content_w = max(max_x - min_x, 0.01)
    content_h = max(max_y - min_y, 0.01)

    area_x0, area_y0 = MARGIN_MM, MARGIN_MM
    area_w = PAGE_W_MM - 2 * MARGIN_MM
    area_h = PAGE_H_MM - 2 * MARGIN_MM
    avail_w = area_w - 2 * DRAWING_PADDING_MM
    avail_h = area_h - 2 * DRAWING_PADDING_MM

    needed_scale = max((content_w * 1000) / avail_w, (content_h * 1000) / avail_h, 1)
    scale_n = pick_nice_scale(needed_scale)
    scale_mm_per_m = 1000.0 / scale_n

    drawn_w = content_w * scale_mm_per_m
    drawn_h = content_h * scale_mm_per_m
    offset_x = area_x0 + (area_w - drawn_w) / 2 - min_x * scale_mm_per_m
    top_of_drawing = area_y0 + (area_h - drawn_h) / 2

    def to_mm(x_m, y_m):
        return offset_x + x_m * scale_mm_per_m, top_of_drawing + (max_y - y_m) * scale_mm_per_m

    for op in ops:
        if op['kind'] == 'polyline':
            pts = [to_mm(x, y) for x, y in op['points']]
            stroke_rgb = hex_to_rgb(op.get('stroke'))
            fill_rgb = hex_to_rgb(op.get('fill'))
            path = c.beginPath()
            path.moveTo(_X(pts[0][0]), _Y(pts[0][1]))
            for px, py in pts[1:]:
                path.lineTo(_X(px), _Y(py))
            if op.get('closed'):
                path.close()
            if stroke_rgb:
                c.setStrokeColorRGB(stroke_rgb[0] / 255, stroke_rgb[1] / 255, stroke_rgb[2] / 255)
            else:
                c.setStrokeColorRGB(0, 0, 0)
            c.setLineWidth(0.25 * mm)
            if fill_rgb:
                c.setFillColorRGB(fill_rgb[0] / 255, fill_rgb[1] / 255, fill_rgb[2] / 255)
            c.drawPath(path, stroke=1, fill=1 if fill_rgb else 0)
        else:  # text
            x, y = to_mm(op['x'], op['y'])
            c.saveState()
            c.setFillColorRGB(0, 0, 0)
            c.setFont('Helvetica', 6.5)
            c.translate(_X(x), _Y(y))
            import math as _math
            c.rotate(_math.degrees(op.get('angle', 0)))
            c.drawCentredString(0, 0, str(op.get('text', '')))
            c.restoreState()

    return f"1:{scale_n}"


def generate_ombriere_metal_pdf(data, cartouche):
    """
    data : paramètres bruts de l'ombrière (mêmes clés que calculate_ombriere()).
    cartouche : {nom_projet, indice, date, adresse, company_name, company_logo}
      ('nom_plan' est fixé automatiquement par page: "... - Coupe" / "... - Façade").
    Retourne un buffer PDF (2 pages : coupe puis façade).
    """
    result = calculate_ombriere(data)
    geometry = result['geometry']

    buffer = io.BytesIO()
    c = pdfcanvas.Canvas(buffer, pagesize=landscape(A3))

    base_nom_plan = cartouche.get('nom_plan') or 'Ombrière métal'
    for label, geom_key in (('Coupe', 'coupe'), ('Façade', 'facade')):
        ops = build_draw_ops(geometry[geom_key])
        echelle_str = _place_and_draw(c, ops)
        _draw_cadre(c)
        page_cartouche = dict(cartouche)
        page_cartouche['nom_plan'] = f"{base_nom_plan} - {label}"
        _draw_cartouche(c, page_cartouche, echelle_str)
        c.showPage()

    c.save()
    buffer.seek(0)
    return buffer
