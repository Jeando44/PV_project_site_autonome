# -*- coding: utf-8 -*-
"""
Génération DXF (ezdxf) d'une ombrière métal : 3 vues (coupe, façade,
implantation des poteaux), chacune sur son propre layout paperspace A3
paysage (cadre + cartouche), échelle calculée automatiquement pour remplir
le maximum d'espace disponible - même logique que le PDF
(pdf_generators/ombriere_metal_pdf.py), les deux partageant la même
normalisation de géométrie (ombriere_geom_render.build_draw_ops).

Les 3 vues sont dessinées dans un modelspace UNIQUE, décalées les unes des
autres (VIEW_OFFSET_X) pour ne jamais se chevaucher - chaque layout n'affiche
ensuite, via son viewport, que la vue qui le concerne.
"""
import io
import math

from ezdxf.enums import TextEntityAlignment

from app.models.dxf_generators.ombriere_metal_v2 import calculate_ombriere
from app.models.dxf_generators.ombriere_geom_render import (
    build_draw_ops, bbox_of_ops, pick_nice_scale, hex_to_rgb,
)
from app.models.dxf_generators.base_dxf import (
    create_document, add_page_layout, draw_cadre, draw_cartouche,
    build_zip_response, decode_base64_image, MARGIN_MM,
)

VIEW_OFFSET_X = 80.0  # m entre chaque vue dans le modelspace (marge large, évite tout chevauchement)
DRAWING_PADDING_MM = 8.0
VIEWS = (('Coupe', 'coupe'), ('Facade', 'facade'), ('Implantation', 'implantation'))

# Palette DXF spécifique (différente du PDF, qui garde ses couleurs d'origine) :
# structure (poteaux/pannes/traverses/bracons) en gris clair, cotes en bleu
# (ligne) + blanc (valeur), panneaux remplis en bleu clair.
DXF_CATEGORY_COLORS = {
    'structure': (191, 191, 191),
    'dimension_line': (0, 102, 255),
    'dimension_text': (255, 255, 255),
}
PANEL_FILL_RGB = (191, 219, 254)


def _draw_ops_into_modelspace(msp, ops, offset_x, offset_y, layer):
    for op in ops:
        category = op.get('category')
        if op['kind'] == 'polyline':
            pts = [(x + offset_x, y + offset_y) for x, y in op['points']]
            entity = msp.add_lwpolyline(pts, close=op.get('closed', False), dxfattribs={'layer': layer})
            if category == 'panel' and op.get('closed') and len(pts) >= 3:
                hatch = msp.add_hatch(dxfattribs={'layer': layer})
                hatch.rgb = PANEL_FILL_RGB
                hatch.paths.add_polyline_path(pts, is_closed=True)
                entity.rgb = PANEL_FILL_RGB
            else:
                rgb = DXF_CATEGORY_COLORS.get(category) or hex_to_rgb(op.get('stroke')) or hex_to_rgb(op.get('fill'))
                if rgb:
                    entity.rgb = rgb
        else:  # text
            x, y = op['x'] + offset_x, op['y'] + offset_y
            text_entity = msp.add_text(
                str(op.get('text', ''))[:80],
                dxfattribs={'layer': layer, 'height': 0.15, 'rotation': math.degrees(op.get('angle', 0))},
            )
            text_entity.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
            rgb = DXF_CATEGORY_COLORS.get(category)
            if rgb:
                text_entity.rgb = rgb


def generate_ombriere_metal_dxf(data, cartouche):
    """
    data : paramètres bruts de l'ombrière (mêmes clés que calculate_ombriere()).
    cartouche : {nom_projet, indice, date, adresse, company_name, company_logo}
      ('nom_plan' fixé automatiquement par vue: "... - Coupe" / "... - Facade" / "... - Implantation").
    Retourne un buffer ZIP (dxf + logo éventuel) prêt pour send_file().
    """
    result = calculate_ombriere(data)
    geometry = result['geometry']

    doc = create_document()
    if 'OMBRIERE' not in doc.layers:
        doc.layers.add('OMBRIERE', color=7)
    msp = doc.modelspace()

    logo_bytes = decode_base64_image(cartouche.get('company_logo'))
    logo_filename = 'logo.png' if logo_bytes else None
    logo_pixel_size = None
    if logo_bytes:
        try:
            from PIL import Image
            with Image.open(io.BytesIO(logo_bytes)) as im:
                logo_pixel_size = im.size
        except Exception:
            logo_pixel_size = None

    base_nom_plan = cartouche.get('nom_plan') or 'Ombrière métal'

    for i, (label, geom_key) in enumerate(VIEWS):
        ops = build_draw_ops(geometry[geom_key])
        offset_x = i * VIEW_OFFSET_X
        _draw_ops_into_modelspace(msp, ops, offset_x, 0, 'OMBRIERE')

        min_x, min_y, max_x, max_y = bbox_of_ops(ops)
        bbox_center = (offset_x + (min_x + max_x) / 2, (min_y + max_y) / 2)
        content_w = max(max_x - min_x, 0.01)
        content_h = max(max_y - min_y, 0.01)

        viewport_w = 420.0 - 2 * MARGIN_MM
        viewport_h = 297.0 - 2 * MARGIN_MM
        avail_w = viewport_w - 2 * DRAWING_PADDING_MM
        avail_h = viewport_h - 2 * DRAWING_PADDING_MM
        needed_scale = max((content_w * 1000) / avail_w, (content_h * 1000) / avail_h, 1)
        scale_n = pick_nice_scale(needed_scale)

        layout, page_w, page_h = add_page_layout(
            doc, label, scale_n, bbox_center, paper_format='A3', orientation='landscape',
        )
        draw_cadre(layout, page_w, page_h)
        page_cartouche = dict(cartouche)
        page_cartouche['nom_plan'] = f"{base_nom_plan} - {label}"
        page_cartouche['echelle'] = f"1:{scale_n}"
        draw_cartouche(
            doc, layout, page_w, page_h, page_cartouche,
            logo_filename=logo_filename, logo_pixel_size=logo_pixel_size,
        )

    return build_zip_response(
        doc, 'ombriere_metal.dxf', logo_bytes=logo_bytes, logo_filename=logo_filename,
    )
