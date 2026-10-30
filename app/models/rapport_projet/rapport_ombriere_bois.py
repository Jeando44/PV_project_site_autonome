import base64
import io
from PIL import Image, ImageChops
from fpdf import FPDF

def crop_image_bois(img: Image.Image) -> Image.Image:
    """
    Rogne les marges blanches d'une image PIL.
    """
    # Créer un fond de la couleur du pixel en haut à gauche (supposé fond)
    bg = Image.new(img.mode, img.size, img.getpixel((0,0)))
    diff = ImageChops.difference(img, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    
    if bbox:
        # Ajout d'une petite marge de sécurité
        pad = 20
        return img.crop((
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(img.width, bbox[2] + pad),
            min(img.height, bbox[3] + pad)
        ))
    return img

def generate_a3_pdf_bois(images_b64: dict) -> io.BytesIO:
    """
    Génère un PDF A3 Paysage avec 4 plans en grille 2x2.
    """
    pdf = FPDF(orientation='L', unit='mm', format='A3')
    pdf.add_page()
    
    # Titre du rapport
    pdf.set_font("helvetica", "B", 20)
    pdf.cell(0, 15, "Rapport Ombrière - Plans de conception", align="C", new_x="LMARGIN", new_y="NEXT")
    
    A3_W = 420
    A3_H = 297
    margin = 15
    grid_w = (A3_W - 3 * margin) / 2
    grid_h = (A3_H - 45) / 2
    
    positions = [
        {"title": "1. Plan de Coupe", "key": "coupe", "x": margin, "y": 25},
        {"title": "2. Plan de Façade", "key": "facade", "x": margin * 2 + grid_w, "y": 25},
        {"title": "3. Plan de Calepinage", "key": "calepinage", "x": margin, "y": 25 + grid_h + 10},
        {"title": "4. Plan d'Implantation", "key": "implantation", "x": margin * 2 + grid_w, "y": 25 + grid_h + 10},
    ]
    
    for pos in positions:
        pdf.set_font("helvetica", "B", 14)
        pdf.set_xy(pos["x"], pos["y"])
        pdf.cell(grid_w, 10, pos["title"], align="L")
        
        # Contour de la cellule
        pdf.set_line_width(0.5)
        pdf.set_draw_color(150, 150, 150)
        pdf.rect(pos["x"], pos["y"], grid_w, grid_h)
        
        b64_data = images_b64.get(pos["key"])
        img_valid = False
        
        if b64_data and "," in b64_data:
            b64_str = b64_data.split(',')[1]
            if b64_str:
                try:
                    img_data = base64.b64decode(b64_str)
                    img = Image.open(io.BytesIO(img_data)).convert("RGBA")
                    img_valid = True
                except Exception:
                    pass

        if img_valid:
            bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
            bg.paste(img, mask=img)
            img = bg.convert("RGB")
            
            cropped = crop_image_bois(img)
            
            avail_w = grid_w - 10
            avail_h = grid_h - 15
            
            img_w, img_h = cropped.size
            ratio = img_w / img_h
            
            final_w = avail_w
            final_h = avail_w / ratio
            
            if final_h > avail_h:
                final_h = avail_h
                final_w = avail_h * ratio
                
            draw_x = pos["x"] + (grid_w - final_w) / 2
            draw_y = pos["y"] + 10 + (avail_h - final_h) / 2
            
            pdf.image(cropped, x=draw_x, y=draw_y, w=final_w, h=final_h)
        else:
            # Si l'image n'est pas reçue ou est corrompue, on affiche ceci sans crasher
            pdf.set_font("helvetica", "I", 12)
            pdf.set_text_color(255, 0, 0)
            pdf.set_xy(pos["x"], pos["y"] + grid_h / 2)
            pdf.cell(grid_w, 10, "Plan non disponible", align="C")
            pdf.set_text_color(0, 0, 0)
            
    return io.BytesIO(pdf.output())