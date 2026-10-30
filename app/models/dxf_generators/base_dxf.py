# -*- coding: utf-8 -*-
"""
Helpers communs pour la génération de plans DXF (ezdxf).

Convention : le modelspace est toujours dessiné en mètres réels, à l'échelle 1:1
(mêmes coordonnées que celles déjà calculées côté front-end par GeometryUtils.js).
L'échelle demandée par l'utilisateur (1/500, 1/10000, ...) n'intervient qu'au
niveau de la mise en page : chaque page devient un layout paperspace au format
papier choisi, avec un viewport dont la hauteur de vue (view_height, en mètres
réels) est calculée pour représenter exactement 1 unité papier = `scale` unités
réelles - voir add_page_layout().
"""
import base64
import io
import math
import zipfile

import ezdxf
import ezdxf.units
from ezdxf.enums import TextEntityAlignment

PAPER_SIZES_MM = {
    'A3': (420.0, 297.0),
    'A4': (297.0, 210.0),
}

MARGIN_MM = 3.0
CARTOUCHE_WIDTH_MM = 90.0
CARTOUCHE_HEIGHT_MM = 45.0
CARTOUCHE_LINE_HEIGHT_MM = 5.5
CARTOUCHE_TEXT_HEIGHT_MM = 3.0
CARTOUCHE_LOGO_MAX_W_MM = 22.0
CARTOUCHE_LOGO_MAX_H_MM = 18.0

_LAYERS = (
    ('PARCELLES', 1),
    ('LOCALISATION', 5),
    ('IMPLANTATION', 3),
    ('PANNEAUX', 5),
    ('CADRE', 7),
    ('CARTOUCHE', 7),
)


def create_document():
    """Crée un document DXF avec un modelspace en mètres réels."""
    doc = ezdxf.new('R2010', setup=True)
    doc.header['$INSUNITS'] = ezdxf.units.M
    for name, color in _LAYERS:
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    return doc


def paper_size_mm(paper_format, orientation):
    w, h = PAPER_SIZES_MM.get(paper_format, PAPER_SIZES_MM['A3'])
    if orientation == 'landscape':
        return max(w, h), min(w, h)
    return min(w, h), max(w, h)


def add_page_layout(doc, name, scale, view_center_point, paper_format='A3', orientation='landscape'):
    """
    Crée un layout paperspace au format demandé, avec un viewport plein cadre
    (hors marge de 3mm) centré sur `view_center_point` (mètres réels, modelspace)
    représentant exactement l'échelle 1/`scale`.
    Retourne (layout, page_w_mm, page_h_mm).
    """
    page_w, page_h = paper_size_mm(paper_format, orientation)
    layout = doc.layouts.new(name)
    layout.page_setup(size=(page_w, page_h), margins=(0, 0, 0, 0), units='mm')

    viewport_w = page_w - 2 * MARGIN_MM
    viewport_h = page_h - 2 * MARGIN_MM
    # 1 mm papier = `scale` mm réels = scale/1000 m réels
    view_height_m = (viewport_h / 1000.0) * scale
    vp = layout.add_viewport(
        center=(page_w / 2.0, page_h / 2.0),
        size=(viewport_w, viewport_h),
        view_center_point=view_center_point,
        view_height=view_height_m,
    )
    vp.dxf.status = 2
    vp.dxf.layer = 'CADRE'
    return layout, page_w, page_h


def draw_cadre(layout, page_w, page_h):
    """Cadre rectangulaire en retrait de 3mm sur tout le périmètre de la feuille."""
    points = [
        (MARGIN_MM, MARGIN_MM),
        (page_w - MARGIN_MM, MARGIN_MM),
        (page_w - MARGIN_MM, page_h - MARGIN_MM),
        (MARGIN_MM, page_h - MARGIN_MM),
    ]
    layout.add_lwpolyline(points, close=True, dxfattribs={'layer': 'CADRE'})


def draw_cartouche(doc, layout, page_w, page_h, cartouche, logo_filename=None, logo_pixel_size=None):
    """
    Cartouche en angle inférieur droit : cadre + logo entreprise (si fourni) +
    lignes de texte (nom projet, nom plan, indice, échelle, date, adresse).
    """
    x0 = page_w - MARGIN_MM - CARTOUCHE_WIDTH_MM
    y0 = MARGIN_MM
    x1 = page_w - MARGIN_MM
    y1 = MARGIN_MM + CARTOUCHE_HEIGHT_MM

    layout.add_lwpolyline(
        [(x0, y0), (x1, y0), (x1, y1), (x0, y1)],
        close=True, dxfattribs={'layer': 'CARTOUCHE'},
    )

    logo_w = 0.0
    if logo_filename and logo_pixel_size:
        iw, ih = logo_pixel_size
        ratio = (ih / iw) if iw else 1.0
        logo_w = CARTOUCHE_LOGO_MAX_W_MM
        logo_h = logo_w * ratio
        if logo_h > CARTOUCHE_LOGO_MAX_H_MM:
            logo_h = CARTOUCHE_LOGO_MAX_H_MM
            logo_w = logo_h / ratio if ratio else logo_h
        image_def = doc.add_image_def(filename=logo_filename, size_in_pixel=(iw, ih))
        layout.add_image(
            image_def,
            insert=(x0 + 2, y1 - logo_h - 2),
            size_in_units=(logo_w, logo_h),
            dxfattribs={'layer': 'CARTOUCHE'},
        )
        logo_w += 2

    text_x = x0 + logo_w + 3
    # Nbre PV / Puissance projet (plan de masse) : facultatifs, lignes omises si absents ou invalides.
    nb_pv = _nombre_positif(cartouche.get('nb_pv'))
    puissance_kwc = _nombre_positif(cartouche.get('puissance_kwc'))
    lines = [
        cartouche.get('nom_projet') or '',
        cartouche.get('nom_plan') or '',
        f"Indice : {cartouche.get('indice') or 'A'}",
        f"Echelle : {cartouche.get('echelle') or ''}",
        f"Nbre PV : {int(round(nb_pv))}" if nb_pv else '',
        f"Puissance projet : {_nombre_fr(puissance_kwc, 2)} kWc" if puissance_kwc else '',
        f"Date : {cartouche.get('date') or ''}",
        cartouche.get('adresse') or '',
    ]
    # Interligne resserré au-delà de 6 lignes : tout tient dans la hauteur du cartouche.
    interligne = CARTOUCHE_LINE_HEIGHT_MM if sum(1 for line in lines if line) <= 6 else 4.6
    y = y1 - 4
    for line in lines:
        if not line or y < y0 + 2:
            continue
        layout.add_text(
            str(line)[:60],
            dxfattribs={'layer': 'CARTOUCHE', 'height': CARTOUCHE_TEXT_HEIGHT_MM},
        ).set_placement((text_x, y), align=TextEntityAlignment.LEFT)
        y -= interligne


def _nombre_positif(valeur):
    """Nombre fini > 0, sinon None (valeur du cartouche transmise par le navigateur)."""
    if isinstance(valeur, bool):
        return None
    try:
        n = float(valeur)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) and 0 < n < 1e9 else None


def _nombre_fr(valeur, decimales):
    """Virgule décimale, espace pour les milliers (ex. 1 234,50)."""
    return f"{valeur:,.{decimales}f}".replace(',', ' ').replace('.', ',')


def build_zip_response(doc, dxf_filename, logo_bytes=None, logo_filename=None):
    """Sérialise le document DXF (+ logo éventuel, référencé en relatif par le
    cartouche) dans un zip en mémoire, prêt pour send_file()."""
    dxf_buffer = io.StringIO()
    doc.write(dxf_buffer)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(dxf_filename, dxf_buffer.getvalue())
        if logo_bytes and logo_filename:
            zf.writestr(logo_filename, logo_bytes)
    zip_buffer.seek(0)
    return zip_buffer


def decode_base64_image(data_url):
    """Décode un logo transmis en data-URL base64 ('data:image/png;base64,...')."""
    if not data_url or ',' not in data_url:
        return None
    try:
        return base64.b64decode(data_url.split(',', 1)[1])
    except Exception:
        return None
