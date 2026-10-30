# -*- coding: utf-8 -*-
"""
Génération PDF vectorielle (ReportLab) du petit champ solaire : une page A3 paysage par vue (coupe
puis façade), cadre 3mm, cartouche (angle inférieur droit) - adapté de
pdf_generators/ombriere_metal_pdf.py.

CORRECTIF (demande explicite : "le plan de coupe et de façade doit impérativement tenir sur une page
au format A3 ; l'ensemble du contenu, terrain compris, doit être entièrement visible et s'adapter
correctement à l'échelle") : la version précédente fixait l'échelle sur la seule HAUTEUR du contenu
et élargissait la page à la longueur du champ (bandes de plusieurs mètres de large pour un grand
champ), en excluant le terrain du cadrage. Désormais : page A3 fixe, échelle normalisée (1/N) choisie
pour que la largeur ET la hauteur tiennent dans la zone de dessin, terrain compris (son étendue est
bornée à l'emprise du champ au moment de la capture, cf. drawCoupe/drawFacade sous
window.__dxfCapture), bande du cartouche réservée pour qu'il ne recouvre jamais le dessin.

Différence avec l'ombrière métal : les entités ne sont PAS recalculées ici.
Elles sont déjà entièrement calculées côté client par
plan_coupe_petit_champ_solaire.js (mêmes entités que celles envoyées au DXF,
cf. dxf_generators/petit_champ_solaire_dxf.py) - avec leur propre couleur RGB
et hauteur de texte déjà résolues, contrairement à l'ombrière métal qui n'a
qu'une palette générique par catégorie.
"""
import io

from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas

import math

from app.models.pdf_generators.pdf_cartouche import (
    PAGE_W_MM, PAGE_H_MM, MARGIN_MM, CARTOUCHE_W_MM, CARTOUCHE_H_MM, X, Y, draw_cadre, draw_cartouche,
)

# Marge minimale pour éviter que le trait/texte le plus extérieur touche pile le cadre.
DRAWING_PADDING_MM = 3.0
VIEWS = (('Coupe', 'coupe'), ('Facade', 'facade'))

# Zone de dessin : intérieur du cadre, le cartouche (angle inférieur droit) ne devant jamais être
# recouvert. Deux dispositions possibles, la plus grande échelle l'emporte (cf. _zone_de_dessin) :
#   - bande du cartouche réservée en bas, pleine largeur (plan long et bas : façade) ;
#   - colonne du cartouche réservée à droite, pleine hauteur (plan plus haut que large).
AREA_X0_MM = MARGIN_MM + DRAWING_PADDING_MM
AREA_Y0_MM = MARGIN_MM + DRAWING_PADDING_MM
INNER_W_MM = PAGE_W_MM - 2 * (MARGIN_MM + DRAWING_PADDING_MM)
INNER_H_MM = PAGE_H_MM - 2 * (MARGIN_MM + DRAWING_PADDING_MM)
ZONES_MM = (
    (INNER_W_MM, INNER_H_MM - CARTOUCHE_H_MM),
    (INNER_W_MM - CARTOUCHE_W_MM, INNER_H_MM),
)

# Taille de texte plancher (pt) : à petite échelle (grand champ), une cotation reste lisible.
MIN_FONT_PT = 4

_ALIGN_DRAW_FN = {'center': 'drawCentredString', 'right': 'drawRightString'}


def _extent_points(entities):
    xs, ys = [], []
    for e in entities:
        if e['type'] == 'LWPOLYLINE':
            for p in e['points']:
                xs.append(p['x'])
                ys.append(p['y'])
        else:
            xs.append(e['x'])
            ys.append(e['y'])
    return xs, ys


def _bbox_of_entities(entities):
    """Emprise de TOUTES les entités, terrain compris (demande explicite : tout doit être visible)."""
    xs, ys = _extent_points(entities)
    if not xs:
        return 0.0, 0.0, 1.0, 1.0
    return min(xs), min(ys), max(xs), max(ys)


def _echelle_ajustee(needed):
    """Plus petite échelle 1/N >= `needed`, par pas fins (5, 10, 25, 50 ou 100 selon la plage).

    CORRECTIF (demande explicite : "il y a encore de l'espace vide dans la page, augmenter l'échelle
    pour occuper le maximum d'espace possible") : la liste d'échelles « propres » commune aux plans
    (pick_nice_scale) saute de 1:250 à 1:500 — un besoin de 1:319 tombait à 1:500 et le dessin
    n'occupait que ~64 % de la page. L'échelle reste un entier lisible (1:325), cotée dans le
    cartouche.
    """
    needed = max(float(needed), 1.0)
    if needed <= 20:
        pas = 1
    elif needed <= 100:
        pas = 5
    elif needed <= 200:
        pas = 10
    elif needed <= 500:
        pas = 25
    elif needed <= 1000:
        pas = 50
    else:
        pas = 100
    return int(math.ceil(needed / pas) * pas)


def _zone_de_dessin(content_w, content_h):
    """(échelle N, largeur zone, hauteur zone) de la disposition offrant la plus grande échelle."""
    meilleure = None
    for zone_w, zone_h in ZONES_MM:
        n = _echelle_ajustee(max((content_w * 1000) / zone_w, (content_h * 1000) / zone_h))
        if meilleure is None or n < meilleure[0]:
            meilleure = (n, zone_w, zone_h)
    return meilleure


def _place_and_draw(c, entities):
    """Met à l'échelle 'propre' `entities` (mètres, Y vers le haut) pour qu'elles tiennent en largeur
    ET en hauteur dans la zone de dessin de la page A3, puis les centre dans cette zone.
    Retourne l'échelle '1:N'."""
    min_x, min_y, max_x, max_y = _bbox_of_entities(entities)
    content_w = max(max_x - min_x, 0.01)
    content_h = max(max_y - min_y, 0.01)

    scale_n, zone_w, zone_h = _zone_de_dessin(content_w, content_h)
    scale_mm_per_m = 1000.0 / scale_n

    drawn_w = content_w * scale_mm_per_m
    drawn_h = content_h * scale_mm_per_m
    left = AREA_X0_MM + (zone_w - drawn_w) / 2
    top = AREA_Y0_MM + (zone_h - drawn_h) / 2

    def to_mm(x_m, y_m):
        return left + (x_m - min_x) * scale_mm_per_m, top + (max_y - y_m) * scale_mm_per_m

    for e in entities:
        color = e.get('color') or [0, 0, 0]
        r, g, b = (c_ / 255 for c_ in color)

        if e['type'] == 'LWPOLYLINE':
            pts = [to_mm(p['x'], p['y']) for p in e['points']]
            path = c.beginPath()
            path.moveTo(X(pts[0][0]), Y(pts[0][1]))
            for px, py in pts[1:]:
                path.lineTo(X(px), Y(py))
            if e.get('closed'):
                path.close()
            c.setStrokeColorRGB(r, g, b)
            # Trait fin : à l'échelle d'un grand champ, un trait de 0,25 mm noircissait les panneaux
            # et hachures serrés.
            c.setLineWidth(0.12 * mm)
            fill = e.get('fill')
            if fill and e.get('closed'):
                fr, fg, fb = (c_ / 255 for c_ in fill)
                c.setFillColorRGB(fr, fg, fb)
                c.drawPath(path, stroke=1, fill=1)
            else:
                c.drawPath(path, stroke=1, fill=0)
        else:  # TEXT
            x, y = to_mm(e['x'], e['y'])
            c.saveState()
            c.setFillColorRGB(r, g, b)
            # Hauteur de texte réelle (mètres) -> mm sur la page (via l'échelle) -> points (1mm = 2.83464566pt),
            # cohérent avec la taille du dessin plutôt qu'une taille fixe arbitraire.
            font_size_pt = max(float(e.get('height') or 0.15) * scale_mm_per_m * 2.83464566, MIN_FONT_PT)
            c.setFont('Helvetica', font_size_pt)
            c.translate(X(x), Y(y))
            c.rotate(float(e.get('rotationDeg') or 0))
            draw_fn = getattr(c, _ALIGN_DRAW_FN.get(e.get('align'), 'drawString'))
            draw_fn(0, 0, str(e.get('text', '')))
            c.restoreState()

    return f"1:{scale_n}"


def generate_petit_champ_solaire_pdf(entities_by_view, cartouche):
    """
    entities_by_view : {'coupe': [...], 'facade': [...]} (même format que le DXF).
    cartouche : {nom_projet, nom_plan, indice, date, adresse, company_name, company_logo}
      ('nom_plan' complété automatiquement par page: "... - Coupe" / "... - Facade").
    Retourne un buffer PDF (1 page A3 paysage par vue présente).
    """
    views_present = [(label, key) for label, key in VIEWS if entities_by_view.get(key)]
    if not views_present:
        raise ValueError("Aucune géométrie à exporter (coupe/façade vides - le plan a-t-il été calculé ?).")

    buffer = io.BytesIO()
    c = pdfcanvas.Canvas(buffer, pagesize=landscape(A3))

    base_nom_plan = cartouche.get('nom_plan') or 'Petit champ solaire'
    for label, key in views_present:
        entities = entities_by_view.get(key) or []
        echelle_str = _place_and_draw(c, entities)
        draw_cadre(c)
        page_cartouche = dict(cartouche)
        page_cartouche['nom_plan'] = f"{base_nom_plan} - {label}"
        draw_cartouche(c, page_cartouche, echelle_str)
        c.showPage()

    c.save()
    buffer.seek(0)
    return buffer
