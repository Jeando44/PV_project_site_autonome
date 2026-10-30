# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4, A3, landscape, portrait
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, NextPageTemplate, PageBreak, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.lib.units import mm
import io
import datetime
import base64
from PIL import Image as PILImage
import json
import os
import re
from app.models.liste_de_materiels import check_show_prices

def parse_number(val):
    if val is None: return 0.0
    # Retire espaces, espaces insécables (\xa0) et symboles
    s = str(val).replace(' ', '').replace('\xa0', '').replace('€', '').strip()
    if not s: return 0.0
    if '.' in s and ',' in s:
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    match = re.search(r'([\d.]+)', s)
    return float(match.group(1)) if match else 0.0

def draw_header_footer(canvas, doc, is_landscape=False):
    canvas.saveState()
    page_width, page_height = landscape(A4) if is_landscape else portrait(A4)

    # Ligne rouge de séparation (en-tête)
    canvas.setStrokeColorRGB(220/255, 38/255, 38/255)
    canvas.setLineWidth(0.4 * mm)
    canvas.line(15*mm, page_height - 26*mm, page_width - 15*mm, page_height - 26*mm)

    # Header - Logo
    try:
        # Utilisation de l'environnement Flask (current_app) pour cibler le dossier static en production
        from flask import current_app
        from reportlab.lib.utils import ImageReader
        from PIL import Image as PILImage
        
        logo_path = os.path.join(current_app.static_folder, 'concevoir_mon_projet', 'medias', 'img', 'Logo', 'LogoSocalts.png')
        
        pil_img = PILImage.open(logo_path)
        img_w, img_h = pil_img.size
        ratio = img_h / float(img_w)
        
        target_w = 20 * mm # Réduisez cette valeur (ex: 15*mm ou 20*mm) pour la gestion de la taille du logo
        target_h = target_w * ratio
        y_img = page_height - 25 * mm # Positionné juste au-dessus de la ligne rouge
        
        ir = ImageReader(pil_img)
        canvas.drawImage(ir, 15*mm, y_img, width=target_w, height=target_h, mask='auto')
    except Exception as e:
        print(f"Erreur lors de l'insertion du logo d'entête: {e}")

    canvas.setFont('Helvetica', 10)
    canvas.setFillColorRGB(100/255, 100/255, 100/255)
    
    # Header - Textes
    canvas.drawCentredString(page_width / 2.0, page_height - 15*mm, "La précision au kWh près,  Socalts propulsés par Solakvan")
    canvas.drawRightString(page_width - 15*mm, page_height - 15*mm, "Socalts_OSA_V1.0")

    # Footer
    canvas.setFont('Helvetica', 9)
    canvas.setFillColorRGB(120/255, 120/255, 120/255)
    
    # Date à gauche
    date_str = getattr(doc, 'custom_date', datetime.datetime.now().strftime("%d/%m/%Y"))
    canvas.drawString(15*mm, 15*mm, f"Le : {date_str}")
    
    # Infos entreprise au centre
    footer_text = getattr(doc, 'custom_company_footer', "Solakvan BET - Études . Ingénierie · Conseils · Formation")
    canvas.drawCentredString(page_width / 2.0, 15*mm, footer_text)
    
    # Numéro de page à droite
    canvas.drawRightString(page_width - 15*mm, 15*mm, f"Page {canvas.getPageNumber()}")
    
    canvas.restoreState()

def portrait_cb(canvas, doc):
    draw_header_footer(canvas, doc, is_landscape=False)

def landscape_cb(canvas, doc):
    draw_header_footer(canvas, doc, is_landscape=True)

def a3_landscape_cb(canvas, doc):
    """Callback pour dessiner la page A3 Paysage (Calepinage)"""
    canvas.saveState()
    data = getattr(doc, 'custom_data', {})
    parametres = data.get('parametres', {})
    map_image_b64 = data.get('map_image')
    company_logo_b64 = data.get('company_logo')
    if not company_logo_b64:
        company_info = data.get('company_info', {})
        company_logo_b64 = company_info.get('logo', '')
        
    # Nettoyage de l'adresse
    adresse_brute = parametres.get('adresse', '')
    if isinstance(adresse_brute, str) and adresse_brute.strip().startswith('{'):
        try:
            adresse_brute = json.loads(adresse_brute).get('adresse', adresse_brute)
        except Exception:
            pass

    page_width, page_height = landscape(A3)
    
    # 1. Cadre de page (bordure noire, marge de 3mm)
    margin = 3 * mm
    padding = 3 * mm
    canvas.setLineWidth(1)
    canvas.setStrokeColor(colors.black)
    canvas.rect(margin, margin, page_width - 2*margin, page_height - 2*margin)
    
    # Définition du cartouche technique (pour calculer l'espace disponible)
    cart_w = 205 * mm  # Largeur totale: 80 (gauche) + 45 (centre) + 80 (droite)
    cart_h = 22 * mm   # Hauteur totale: 11 (haut) + 11 (bas)
    cart_x = page_width - margin - cart_w
    cart_y = margin

    # 2. Insertion de la Capture de la Carte (Map) avec ratio d'aspect
    if map_image_b64 and ',' in map_image_b64:
        try:
            from reportlab.lib.utils import ImageReader
            img_data = base64.b64decode(map_image_b64.split(",")[1])
            img_stream = io.BytesIO(img_data)
            pil_img = PILImage.open(img_stream)
            img_w, img_h = pil_img.size
            
            # L'image occupe l'espace disponible au-dessus du cartouche avec 3mm d'espacement
            # pour ne pas toucher les bordures extérieures ni le bloc du cartouche
            avail_x = margin + 3 * mm
            avail_y = cart_y + cart_h + 3 * mm
            avail_w = page_width - 2 * margin - 6 * mm
            avail_h = page_height - margin - 3 * mm - avail_y
            
            ratio = img_h / float(img_w)
            target_w = avail_w
            target_h = target_w * ratio
            
            if target_h > avail_h:
                target_h = avail_h
                target_w = target_h / ratio
                
            x_img = avail_x + (avail_w - target_w) / 2.0
            y_img = avail_y + (avail_h - target_h) / 2.0
            
            ir = ImageReader(pil_img)
            canvas.drawImage(ir, x_img, y_img, width=target_w, height=target_h, preserveAspectRatio=True, anchor='c')
            
            # 3. Boussole (Indicateur Nord) positionnée en bas à gauche, alignée avec le cartouche
            north_x = margin + 15 * mm
            north_y = cart_y + (cart_h / 2.0)
            
            canvas.setStrokeColor(colors.black)
            canvas.setFillColor(colors.white)
            canvas.circle(north_x, north_y, 4*mm, stroke=1, fill=1) # Cercle de fond blanc pour la lisibilité
            
            canvas.setFillColor(colors.black) # Rétablir pour la flèche
            
            # Flèche du Nord
            p = canvas.beginPath()
            p.moveTo(north_x, north_y + 8*mm)
            p.lineTo(north_x - 3*mm, north_y - 2*mm)
            p.lineTo(north_x, north_y)
            p.lineTo(north_x + 3*mm, north_y - 2*mm)
            p.close()
            canvas.drawPath(p, stroke=1, fill=1)
            
            canvas.setFont("Helvetica-Bold", 10)
            canvas.drawCentredString(north_x, north_y - 6*mm, "N")
            
        except Exception as e:
            print("Erreur insertion image map:", e)

    # 4. Dessin du Cartouche technique (Angle inférieur droit, disposition combinée)
    
    canvas.setFillColor(colors.white)
    canvas.rect(cart_x, cart_y, cart_w, cart_h, fill=1, stroke=1)
    
    # Séparateurs verticaux
    canvas.setFillColor(colors.black)
    canvas.setLineWidth(0.5)
    canvas.line(cart_x + 80*mm, cart_y, cart_x + 80*mm, cart_y + cart_h)
    canvas.line(cart_x + 125*mm, cart_y, cart_x + 125*mm, cart_y + cart_h)
    
    # Séparateurs horizontaux (uniquement dans les blocs de gauche et de droite)
    canvas.line(cart_x, cart_y + 11*mm, cart_x + 80*mm, cart_y + 11*mm)
    canvas.line(cart_x + 125*mm, cart_y + 11*mm, cart_x + 205*mm, cart_y + 11*mm)
    
    # --- GROUPE DE GAUCHE ---
    left_cx = cart_x + 40*mm
    
    # Bloc supérieur (1) : Nom du plan | Indice
    canvas.setFont("Helvetica-Bold", 11)
    indice = parametres.get('indice', data.get('indice_projet', 'A'))
    canvas.drawCentredString(left_cx, cart_y + 11*mm + 5.5*mm - 1.5*mm, f"PLAN DE CALEPINAGE  |  Indice : {indice}")
    
    # Bloc inférieur (2) : Référence panneaux | Qté et Ptotale
    canvas.setFont("Helvetica", 8)
    puissance = parametres.get('total_power', 0)
    try:
        puissance_val = float(puissance)
    except:
        puissance_val = 0.0
    panel_ref = parametres.get('panel_ref', 'N/A')
    panel_count = parametres.get('panel_count', 0)
    
    canvas.drawCentredString(left_cx, cart_y + 7*mm - 1.5*mm, f"Panneaux : {panel_ref}")
    canvas.drawCentredString(left_cx, cart_y + 3.5*mm - 1.5*mm, f"Qté : {panel_count}  |  P. Totale : {puissance_val:.2f} kWc")

    # --- GROUPE CENTRAL (Logo) ---
    center_x = cart_x + 80*mm
    center_w = 45*mm
    center_h = 22*mm
    
    if company_logo_b64 and ',' in company_logo_b64:
        try:
            from reportlab.lib.utils import ImageReader
            logo_data = base64.b64decode(company_logo_b64.split(",")[1])
            logo_stream = io.BytesIO(logo_data)
            logo_ir = ImageReader(logo_stream)
            l_w = center_w - 6*mm
            l_h = center_h - 6*mm
            canvas.drawImage(logo_ir, center_x + 3*mm, cart_y + 3*mm, width=l_w, height=l_h, preserveAspectRatio=True, anchor='c')
        except Exception as e:
            print("Erreur logo cartouche:", e)

    # --- GROUPE DE DROITE ---
    right_cx = cart_x + 125*mm + 40*mm
    import textwrap
    
    # Bloc supérieur (1) : Nom du projet
    canvas.setFont("Helvetica-Bold", 10)
    nom_projet = parametres.get('nom', data.get('nom_projet', 'N/A'))
    wrapped_nom = textwrap.wrap(f"Projet : {nom_projet}", width=45)
    start_y_nom = cart_y + 11*mm + 5.5*mm + (len(wrapped_nom[:2]) - 1) * 1.5*mm - 1.5*mm
    for i, line in enumerate(wrapped_nom[:2]): # Maximum 2 lignes
        canvas.drawCentredString(right_cx, start_y_nom - i*3*mm, line)
    
    # Bloc inférieur (2) : Adresse du projet
    canvas.setFont("Helvetica", 8)
    if isinstance(adresse_brute, str):
        addr_text = adresse_brute[:80]
    else:
        addr_text = str(adresse_brute)[:80]
        
    wrapped_addr = textwrap.wrap(f"Adresse : {addr_text}", width=50)
    start_y_addr = cart_y + 5.5*mm + (len(wrapped_addr[:2]) - 1) * 1.5*mm - 1.5*mm
    for i, line in enumerate(wrapped_addr[:2]): # Maximum 2 lignes
        canvas.drawCentredString(right_cx, start_y_addr - i*3*mm, line)

    canvas.restoreState()

def generate_pdf_report(data):
    buffer = io.BytesIO()
    doc = BaseDocTemplate(buffer, rightMargin=15*mm, leftMargin=15*mm, topMargin=30*mm, bottomMargin=25*mm)
    
    # Extraction des infos pour le header/footer
    # Le frontend envoie une structure plate. On accède donc directement aux clés depuis la racine de 'data'.
    # Stockage des datas dans le doc pour le callback de la page A3
    doc.custom_data = data

    # pi = data.get('projetInfo', data.get('parametres', {}))
    doc.custom_date = data.get('date_projet', datetime.datetime.now().strftime("%d/%m/%Y"))
    
    company_info = data.get('company_info', {})
    c_name = company_info.get('name', '')
    c_phone = company_info.get('phone', '')
    c_addr = company_info.get('address', '')
    parts = [p for p in [c_name, c_phone, c_addr] if p]
    if parts:
        doc.custom_company_footer = " / ".join(parts)

    # Configuration des formats de pages (Portrait pour Garde, Paysage pour le reste)
    frame_portrait = Frame(doc.leftMargin, doc.bottomMargin, portrait(A4)[0] - doc.leftMargin - doc.rightMargin, portrait(A4)[1] - doc.bottomMargin - doc.topMargin, id='portrait_frame')
    frame_landscape = Frame(doc.leftMargin, doc.bottomMargin, landscape(A4)[0] - doc.leftMargin - doc.rightMargin, landscape(A4)[1] - doc.bottomMargin - doc.topMargin, id='landscape_frame')
    frame_a3_landscape = Frame(doc.leftMargin, doc.bottomMargin, landscape(A3)[0] - doc.leftMargin - doc.rightMargin, landscape(A3)[1] - doc.bottomMargin - doc.topMargin, id='a3_landscape_frame')
    
    template_portrait = PageTemplate(id='Portrait', frames=frame_portrait, pagesize=portrait(A4), onPage=portrait_cb)
    template_landscape = PageTemplate(id='Landscape', frames=frame_landscape, pagesize=landscape(A4), onPage=landscape_cb)
    template_a3_landscape = PageTemplate(id='A3_Landscape', frames=frame_a3_landscape, pagesize=landscape(A3), onPage=a3_landscape_cb)
    
    doc.addPageTemplates([template_portrait, template_landscape, template_a3_landscape])

    elements = []
    styles = getSampleStyleSheet()
    
    # ---------------- PAGE DE GARDE (PORTRAIT) ----------------
    is_devis = data.get('is_devis', False)
    items = data.get('items', [])
    
    title_style = styles['Heading1']
    title_style.fontName = 'Helvetica-Bold'
    title_style.fontSize = 16
    title_style.textColor = colors.Color(220/255, 38/255, 38/255)
    title_style.alignment = 1

    subtitle_style = styles['Normal']
    subtitle_style.fontName = 'Helvetica'
    subtitle_style.fontSize = 13
    subtitle_style.textColor = colors.Color(220/255, 38/255, 38/255)
    subtitle_style.alignment = 1
    
    info_style = styles['Normal']
    info_style.fontName = 'Helvetica'
    info_style.fontSize = 11
    info_style.textColor = colors.Color(31/255, 41/255, 55/255)
    info_style.alignment = 1
    info_style.leading = 14

    elements.append(Spacer(1, 10*mm))
    elements.append(Paragraph("Liste de matériels", title_style))
    elements.append(Spacer(1, 2*mm))
    
    # Analyse des données pour le sous-titre dynamique
    has_pv = False
    has_irve = False
    has_stockage = False
    
    for item in items:
        comp = str(item.get('composant', '')).lower()
        if 'modules photovolta' in comp or 'panneau' in comp:
            has_pv = True
        if 'borne de recharge' in comp:
            has_irve = True
        if 'batterie' in comp:
            has_stockage = True
            
    # Logique de titrage (ordre de priorité respecté)
    if has_pv and has_irve and has_stockage:
        subtitle_text = "D'une installation photovoltaïque couplée avec de l'IRVE et du Stockage"
    elif has_pv and has_irve:
        subtitle_text = "D'une installation photovoltaïque couplée avec de l'IRVE"
    elif has_pv and has_stockage:
        subtitle_text = "D'une installation photovoltaïque couplée avec du stockage par batterie"
    elif has_pv:
        subtitle_text = "D'une installation photovoltaïque"
    else:
        subtitle_text = "D'une installation photovoltaïque" # Fallback par défaut
        
    elements.append(Paragraph(subtitle_text, subtitle_style))
        
    elements.append(Spacer(1, 5*mm))
    
    summary_text = data.get('summary', '')
    if summary_text:
        summary_style = styles['Normal']
        summary_style.fontName = 'Helvetica-Bold'
        summary_style.fontSize = 11
        summary_style.textColor = colors.Color(31/255, 41/255, 55/255)
        summary_style.alignment = 1
        elements.append(Paragraph(summary_text, summary_style))
        elements.append(Spacer(1, 5*mm))
    
    try:
        from flask import current_app
        cover_img_path = os.path.join(current_app.static_folder, 'concevoir_mon_projet', 'medias', 'paramètres_Images', 'Image1.png')
        elements.append(Image(cover_img_path, width=180*mm, height=105*mm, kind='proportional'))
    except Exception as e:
        print(f"Erreur lors de l'insertion de l'image de la page de garde : {e}")
        elements.append(Spacer(1, 100*mm)) # Espace de secours si l'image ne charge pas
        
    elements.append(Spacer(1, 25*mm))
    
    projet_nom = data.get('nom_projet', 'N/A')
    elements.append(Paragraph(f"Projet : {projet_nom}", info_style))
    
    adresse_projet = data.get('adresse_projet', 'N/A')
    elements.append(Paragraph(f"Adresse : {adresse_projet}", info_style))
    
    indice_projet = data.get('indice_projet', 'Indice A')
    elements.append(Paragraph(f"Indice : {indice_projet}", info_style))
    
    logo_b64 = company_info.get('logo', '')
    if logo_b64 and ',' in logo_b64:
        try:
            img_data = base64.b64decode(logo_b64.split(',')[1])
            img_io = io.BytesIO(img_data)
            elements.append(Spacer(1, 10*mm))
            logo_img = Image(img_io, width=20*mm, height=20*mm, kind='proportional')
            logo_img.hAlign = 'RIGHT'
            elements.append(logo_img)
        except Exception:
            pass

    # ---------------- PAGE DE CALEPINAGE A3 (PAYSAGE) ----------------
    elements.append(NextPageTemplate('A3_Landscape'))
    elements.append(PageBreak())
    elements.append(Spacer(1, 1)) # Déclencheur pour dessiner la page A3

    # ---------------- TABLEAU MATERIELS (PAYSAGE A4) ----------------
    elements.append(NextPageTemplate('Landscape'))
    elements.append(PageBreak())

    
    items = data.get('items', [])
    parametres = data.get('parametres', {})
    show_prices = check_show_prices(parametres)
    devise = parametres.get('devise', '€')
    taux_tva = float(parametres.get('tva', 20))
    
    # En-têtes du tableau
    if show_prices:
        table_data = [["Composants", "Désignation / Fabricant", "Référence", "Quantité", f"Prix HT ({devise})"]]
    else:
        table_data = [["Composants", "Désignation / Fabricant", "Référence", "Quantité"]]
    
    current_section = None
    total_ht_global = 0.0

    for item in items:
        section = item.get('section', '')
        if section and section != current_section:
            if show_prices:
                table_data.append([section, "", "", "", ""])
            else:
                table_data.append([section, "", "", ""])
            current_section = section
            
        # Recalcul Backend sécurisé
        pu = parse_number(item.get('pu', 0))
        qty_val = parse_number(item.get('quantite', '0'))
        
        prix_total_ht = round(qty_val * pu, 2)
        total_ht_global += prix_total_ht
        
        prix_str = f"{prix_total_ht:.2f}" if prix_total_ht > 0 else "-"
        
        if show_prices:
            table_data.append([item.get('composant', ''), item.get('designation', ''), item.get('reference', ''), item.get('quantite', ''), prix_str])
        else:
            table_data.append([item.get('composant', ''), item.get('designation', ''), item.get('reference', ''), item.get('quantite', '')])
        
    # Ajustement des largeurs de colonnes selon la présence ou non de la colonne prix
    col_widths = [130, 180, 230, 80, 80] if show_prices else [160, 210, 250, 80]
    t = Table(table_data, colWidths=col_widths) 
    t.hAlign = 'RIGHT'
    
    style = TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#F5F5F5")),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#FFFFFF")),
        ('GRID', (0, 0), (-1, -1), 0.1, colors.HexColor("#000000")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ])
    
    # Appliquer le style gris pour les lignes de séparation (sections)
    for i, row in enumerate(table_data):
        # Identifie dynamiquement les lignes séparatrices (toutes les colonnes vides sauf le titre)
        if all(cell == "" for cell in row[1:]) and i > 0:
            style.add('SPAN', (0, i), (-1, i))
            style.add('BACKGROUND', (0, i), (-1, i), colors.HexColor("#ebedef"))
            style.add('TEXTCOLOR', (0, i), (-1, i), colors.HexColor("#2c3e50"))
            style.add('FONTNAME', (0, i), (-1, i), 'Helvetica-Bold')
            style.add('ALIGN', (0, i), (-1, i), 'LEFT')
            style.add('LEFTPADDING', (0, i), (-1, i), 15)

    t.setStyle(style)
    elements.append(t)
    
    if show_prices:
        # ---------------- TABLEAU RECAPITULATIF FINANCIER ----------------
        elements.append(Spacer(1, 10*mm))
        
        montant_tva = total_ht_global * (taux_tva / 100)
        total_ttc = total_ht_global + montant_tva
        
        summary_data = [
            ["Récapitulatif Financier", ""],
            ["Total HT", f"{total_ht_global:,.2f} {devise}".replace(',', ' ')],
            [f"TVA ({taux_tva}%)", f"{montant_tva:,.2f} {devise}".replace(',', ' ')],
            ["Total TTC", f"{total_ttc:,.2f} {devise}".replace(',', ' ')]
        ]
        
        ts = Table(summary_data, colWidths=[100, 100])
        ts.hAlign = 'RIGHT'
        ts.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#FFFFFF")),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#000000")),
            ('BACKGROUND', (0, 3), (-1, 3), colors.HexColor("#f8f9fa")),
        ]))
        elements.append(ts)

    doc.build(elements)
    buffer.seek(0)
    return buffer