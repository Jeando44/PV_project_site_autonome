# -*- coding: utf-8 -*-
"""
Génération DXF (ezdxf) du petit champ solaire : 2 vues (coupe, façade), chacune
sur son propre layout paperspace A3 paysage (cadre + cartouche), échelle
calculée automatiquement pour remplir le maximum d'espace disponible - même
pattern que dxf_generators/ombriere_metal_dxf.py.

Différence avec l'ombrière métal : ici la géométrie n'est PAS recalculée en
Python. Les entités DXF sont déjà entièrement calculées côté client par
plan_coupe_petit_champ_solaire.js, qui rejoue les fonctions de dessin existantes
(drawCoupe/drawFacade de petit_champ_solaire.js) avec un faux contexte canvas
enregistreur - le backend se contente de les mettre en page, sans recalculer
aucune géométrie.
"""
import io

from ezdxf.enums import TextEntityAlignment

from app.models.dxf_generators.ombriere_geom_render import pick_nice_scale
from app.models.dxf_generators.base_dxf import (
    create_document, add_page_layout, draw_cadre, draw_cartouche,
    build_zip_response, decode_base64_image, MARGIN_MM,
)

VIEW_OFFSET_X = 80.0  # m entre chaque vue dans le modelspace (marge large, évite tout chevauchement)
DRAWING_PADDING_MM = 8.0
VIEWS = (('Coupe', 'coupe'), ('Facade', 'facade'))

_TEXT_ALIGN_MAP = {
    ('left', 'alphabetic'): TextEntityAlignment.LEFT,
    ('center', 'alphabetic'): TextEntityAlignment.MIDDLE_CENTER,
    ('right', 'alphabetic'): TextEntityAlignment.RIGHT,
}


def _extent_points(entities, exclude_layers=frozenset()):
    xs, ys = [], []
    for e in entities:
        if e.get('layer') in exclude_layers:
            continue
        if e['type'] == 'LWPOLYLINE':
            for p in e['points']:
                xs.append(p['x'])
                ys.append(p['y'])
        else:
            xs.append(e['x'])
            ys.append(e['y'])
    return xs, ys


def _bbox_of_entities(entities):
    """
    Bbox utilisée pour centrer la vue et calculer l'échelle auto (cf. pick_nice_scale).
    Exclut le calque TERRAIN (sol + hachures) : dessiné volontairement à une largeur fixe
    très supérieure à la structure réelle, pour un rendu "plein cadre" à l'écran (cf.
    petit_champ_solaire.js drawCoupe/drawFacade) - le laisser dans ce calcul faisait
    tomber l'échelle auto vers ~1/500 au lieu de 1/20-1/100. Les entités TERRAIN restent
    dessinées normalement, simplement rognées par le viewport/la page à l'impression.
    """
    xs, ys = _extent_points(entities, exclude_layers=frozenset({'TERRAIN'}))
    if not xs:
        xs, ys = _extent_points(entities)  # repli si tout était sur le calque TERRAIN
    if not xs:
        return 0.0, 0.0, 1.0, 1.0
    return min(xs), min(ys), max(xs), max(ys)


def _draw_entities_into_modelspace(doc, msp, entities, offset_x, offset_y):
    for e in entities:
        layer = e.get('layer') or 'DIVERS'
        if layer not in doc.layers:
            doc.layers.add(layer, color=7)
        color = e.get('color')

        if e['type'] == 'LWPOLYLINE':
            pts = [(p['x'] + offset_x, p['y'] + offset_y) for p in e['points']]
            fill = e.get('fill')
            if fill and e.get('closed') and len(pts) >= 3:
                # Remplissage plein (ex: panneaux PV) : une LWPOLYLINE seule ne se remplit jamais en
                # DXF, il faut une entité HATCH dédiée sur les mêmes points (même pattern que
                # ombriere_metal_dxf.py pour les panneaux).
                hatch = msp.add_hatch(dxfattribs={'layer': layer})
                hatch.rgb = tuple(fill)
                hatch.paths.add_polyline_path(pts, is_closed=True)
            entity = msp.add_lwpolyline(pts, close=bool(e.get('closed')), dxfattribs={'layer': layer})
            if color:
                entity.rgb = tuple(color)
        else:  # TEXT
            x, y = e['x'] + offset_x, e['y'] + offset_y
            height = max(float(e.get('height') or 0.15), 0.01)
            text_entity = msp.add_text(
                str(e.get('text', ''))[:120],
                dxfattribs={'layer': layer, 'height': height, 'rotation': float(e.get('rotationDeg') or 0)},
            )
            align = _TEXT_ALIGN_MAP.get((e.get('align'), e.get('baseline')), TextEntityAlignment.LEFT)
            text_entity.set_placement((x, y), align=align)
            if color:
                text_entity.rgb = tuple(color)


def generate_petit_champ_solaire_dxf(entities_by_view, cartouche):
    """
    entities_by_view : {'coupe': [...entités...], 'facade': [...entités...]}
      (format exact produit par plan_coupe_petit_champ_solaire.js: captureDxfEntities()).
    cartouche : {nom_projet, nom_plan, indice, date, adresse, company_name, company_logo}
      ('nom_plan' complété automatiquement par vue: "... - Coupe" / "... - Facade").
    Retourne un buffer ZIP (dxf + logo éventuel) prêt pour send_file().
    """
    views_present = [(label, key) for label, key in VIEWS if entities_by_view.get(key)]
    if not views_present:
        raise ValueError("Aucune géométrie à exporter (coupe/façade vides - le plan a-t-il été calculé ?).")

    doc = create_document()
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

    base_nom_plan = cartouche.get('nom_plan') or 'Petit champ solaire'

    for i, (label, key) in enumerate(views_present):
        entities = entities_by_view.get(key) or []
        offset_x = i * VIEW_OFFSET_X
        _draw_entities_into_modelspace(doc, msp, entities, offset_x, 0)

        min_x, min_y, max_x, max_y = _bbox_of_entities(entities)
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
        doc, 'petit_champ_solaire.dxf', logo_bytes=logo_bytes, logo_filename=logo_filename,
    )
