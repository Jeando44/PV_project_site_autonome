# -*- coding: utf-8 -*-
"""
Génération du DXF du Plan de masse : parcelles cadastrales + zone d'implantation
des panneaux solaires (contours des formes de calepinage), cadre + cartouche.

Mêmes conventions que situation_dxf.py : coordonnées déjà converties en mètres
réels par le front-end, repère local centré sur le centre de l'implantation.
"""
import io

from app.models.dxf_generators.base_dxf import (
    build_zip_response,
    create_document,
    decode_base64_image,
    draw_cadre,
    draw_cartouche,
    add_page_layout,
)


def _draw_polygons(msp, polygons, layer):
    for points in polygons or []:
        if len(points) < 2:
            continue
        coords = [(p['x'], p['y']) for p in points]
        msp.add_lwpolyline(coords, close=True, dxfattribs={'layer': layer})


def _logo_from_cartouche(cartouche):
    logo_bytes = decode_base64_image(cartouche.get('company_logo'))
    if not logo_bytes:
        return None, None, None
    try:
        from PIL import Image
        with Image.open(io.BytesIO(logo_bytes)) as im:
            pixel_size = im.size
    except Exception:
        pixel_size = None
    return logo_bytes, 'logo.png', pixel_size


def generate_plan_de_masse_dxf(payload):
    """
    payload (JSON) attendu :
      cartouche: {nom_projet, nom_plan, indice, date, adresse, company_name, company_logo}
      paper: {format: 'A3', orientation: 'landscape'}
      parcelles: [[{x, y}, ...], ...]       # mètres réels, repère local centré sur l'implantation
      implantation: [[{x, y}, ...], ...]    # contours des formes de calepinage
      panneaux: [[{x, y}, ...], ...]        # rectangles des panneaux (facultatif, calque PANNEAUX)
      pages: [{name, scale, view_center: {x, y}}]
    Retourne un buffer ZIP (dxf + logo éventuel) prêt pour send_file().
    """
    cartouche = payload.get('cartouche') or {}
    paper = payload.get('paper') or {}
    paper_format = paper.get('format', 'A3')
    orientation = paper.get('orientation', 'landscape')
    parcelles = payload.get('parcelles') or []
    implantation = payload.get('implantation') or []
    panneaux = payload.get('panneaux') or []
    pages = payload.get('pages') or [
        {'name': 'Masse_1', 'scale': 500},
        {'name': 'Masse_2', 'scale': 500},
    ]

    doc = create_document()
    msp = doc.modelspace()
    _draw_polygons(msp, parcelles, 'PARCELLES')
    _draw_polygons(msp, implantation, 'IMPLANTATION')
    _draw_polygons(msp, panneaux, 'PANNEAUX')

    logo_bytes, logo_filename, logo_pixel_size = _logo_from_cartouche(cartouche)

    for page in pages:
        scale = page.get('scale', 500)
        name = page.get('name') or f"Page_{scale}"
        view_center = page.get('view_center') or {}
        view_center_point = (view_center.get('x', 0) or 0, view_center.get('y', 0) or 0)
        layout, page_w, page_h = add_page_layout(
            doc, name, scale, view_center_point=view_center_point,
            paper_format=paper_format, orientation=orientation,
        )
        draw_cadre(layout, page_w, page_h)
        page_cartouche = dict(cartouche)
        page_cartouche['nom_plan'] = cartouche.get('nom_plan') or 'Plan de masse'
        page_cartouche['echelle'] = f"1:{scale}"
        draw_cartouche(
            doc, layout, page_w, page_h, page_cartouche,
            logo_filename=logo_filename, logo_pixel_size=logo_pixel_size,
        )

    return build_zip_response(
        doc, 'plan_de_masse.dxf', logo_bytes=logo_bytes, logo_filename=logo_filename,
    )
