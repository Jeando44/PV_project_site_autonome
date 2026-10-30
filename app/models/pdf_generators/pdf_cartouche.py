# -*- coding: utf-8 -*-
"""
Cadre (3mm de retrait) + cartouche (angle inférieur droit) communs à tous les
plans PDF vectoriels générés côté serveur (ReportLab) - A3 paysage, nom projet,
nom plan, indice, échelle, date, adresse, logo entreprise. Factorisé pour que
tous les générateurs (ombrière métal, petit champ solaire, ...) partagent
exactement la même mise en page - équivalent Python de
export_plans_pdf_dxf/utils/PdfCartouche.js (jsPDF, côté client).
"""
import io

from reportlab.lib.units import mm

PAGE_W_MM, PAGE_H_MM = 420.0, 297.0  # A3 paysage
MARGIN_MM = 3.0
CARTOUCHE_W_MM = 90.0
CARTOUCHE_H_MM = 45.0


def X(x_mm):
    return x_mm * mm


def Y(y_mm_from_top):
    return (PAGE_H_MM - y_mm_from_top) * mm


def draw_cadre(c, page_w_mm=None):
    """page_w_mm : largeur de page réelle si différente de PAGE_W_MM (cf. petit_champ_solaire_pdf.py,
    page proportionnelle au contenu — demande explicite). None = comportement inchangé (A3 fixe)."""
    w = PAGE_W_MM if page_w_mm is None else page_w_mm
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.3 * mm)
    c.rect(X(MARGIN_MM), Y(PAGE_H_MM - MARGIN_MM), (w - 2 * MARGIN_MM) * mm, (PAGE_H_MM - 2 * MARGIN_MM) * mm)


def draw_cartouche(c, cartouche, echelle_str, page_w_mm=None):
    """page_w_mm : cf. draw_cadre — le cartouche reste positionné dans l'angle inférieur DROIT, donc
    dépendant de la largeur réelle de la page quand elle n'est pas fixe."""
    w = PAGE_W_MM if page_w_mm is None else page_w_mm
    x0 = w - MARGIN_MM - CARTOUCHE_W_MM
    y0_top = PAGE_H_MM - MARGIN_MM - CARTOUCHE_H_MM  # y (depuis le haut) du bord SUPÉRIEUR du cartouche

    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.3 * mm)
    c.rect(X(x0), Y(PAGE_H_MM - MARGIN_MM), CARTOUCHE_W_MM * mm, CARTOUCHE_H_MM * mm, fill=1, stroke=1)

    text_x = x0 + 3
    logo_b64 = cartouche.get('company_logo')
    if logo_b64 and ',' in logo_b64:
        try:
            from reportlab.lib.utils import ImageReader
            from PIL import Image as PILImage
            import base64
            logo_bytes = base64.b64decode(logo_b64.split(',', 1)[1])
            with PILImage.open(io.BytesIO(logo_bytes)) as im:
                iw, ih = im.size
            logo_w = 20.0
            logo_h = min(16.0, logo_w * ih / iw) if iw else 16.0
            ir = ImageReader(io.BytesIO(logo_bytes))
            c.drawImage(
                ir, X(x0 + 2), Y(y0_top + logo_h + 2),
                width=logo_w * mm, height=logo_h * mm,
                mask='auto', preserveAspectRatio=True,
            )
            text_x = x0 + logo_w + 5
        except Exception as e:
            print(f"[pdf_cartouche] Logo entreprise illisible: {e}")

    c.setFont('Helvetica', 8)
    c.setFillColorRGB(0.08, 0.08, 0.08)
    lines = [
        cartouche.get('nom_projet') or '',
        cartouche.get('nom_plan') or '',
        f"Indice : {cartouche.get('indice') or 'A'}",
        f"Echelle : {echelle_str}",
        f"Date : {cartouche.get('date') or ''}",
        cartouche.get('adresse') or '',
    ]
    y = y0_top + 6
    for line in lines:
        if not line:
            continue
        c.drawString(X(text_x), Y(y), str(line)[:60])
        y += 5.5
