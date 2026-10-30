# -*- coding: utf-8 -*-
"""
Génération du DXF du Plan de situation projet : 2 pages (1/10000 puis 1/500),
parcelles cadastrales + marqueur/cercle de localisation, cadre + cartouche.

Les coordonnées (parcelles, marqueur) arrivent déjà converties en mètres réels
par le front-end, dans un repère local centré sur le point du projet (0, 0) -
même convention que GeometryUtils.js. Le backend se contente de les injecter
dans le modelspace ezdxf et de gérer la mise en page / l'échelle.
"""
import io

from ezdxf.enums import TextEntityAlignment

from app.models.dxf_generators.base_dxf import (
    build_zip_response,
    create_document,
    decode_base64_image,
    draw_cadre,
    draw_cartouche,
    add_page_layout,
)


def _draw_parcelles(msp, parcelles):
    for points in parcelles or []:
        if len(points) < 2:
            continue
        coords = [(p['x'], p['y']) for p in points]
        msp.add_lwpolyline(coords, close=True, dxfattribs={'layer': 'PARCELLES'})


def _draw_location_marker(msp, marker):
    radius = (marker or {}).get('radius_m') or 50.0
    label = (marker or {}).get('label') or 'Localisation projet'
    msp.add_circle((0, 0), radius=radius, dxfattribs={'layer': 'LOCALISATION'})
    msp.add_point((0, 0), dxfattribs={'layer': 'LOCALISATION'})
    text_height = max(radius * 0.1, 2.0)
    msp.add_text(
        label, dxfattribs={'layer': 'LOCALISATION', 'height': text_height},
    ).set_placement((radius * 0.1, radius * 0.1), align=TextEntityAlignment.LEFT)


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


def generate_situation_dxf(payload):
    """
    payload (JSON) attendu :
      cartouche: {nom_projet, nom_plan, indice, date, adresse,
                  company_name, company_phone, company_address, company_logo}
      paper: {format: 'A3', orientation: 'landscape'}
      location_marker: {radius_m, label}
      parcelles: [[{x, y}, ...], ...]   # mètres réels, repère local (0,0) = point projet
      pages: [{name, scale, view_center: {x, y}}]  # view_center optionnel, défaut (0,0)
    Retourne un buffer ZIP (dxf + logo éventuel) prêt pour send_file().
    """
    cartouche = payload.get('cartouche') or {}
    paper = payload.get('paper') or {}
    paper_format = paper.get('format', 'A3')
    orientation = paper.get('orientation', 'landscape')
    parcelles = payload.get('parcelles') or []
    marker = payload.get('location_marker') or {}
    pages = payload.get('pages') or [
        {'name': 'Situation_1_10000', 'scale': 10000},
        {'name': 'Situation_1_1000', 'scale': 1000},
    ]

    doc = create_document()
    msp = doc.modelspace()
    _draw_location_marker(msp, marker)
    _draw_parcelles(msp, parcelles)

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
        page_cartouche['nom_plan'] = cartouche.get('nom_plan') or 'Plan de situation projet'
        page_cartouche['echelle'] = f"1:{scale}"
        draw_cartouche(
            doc, layout, page_w, page_h, page_cartouche,
            logo_filename=logo_filename, logo_pixel_size=logo_pixel_size,
        )

    return build_zip_response(
        doc, 'plan_situation.dxf', logo_bytes=logo_bytes, logo_filename=logo_filename,
    )
