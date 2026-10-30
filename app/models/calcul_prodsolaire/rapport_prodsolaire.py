from fpdf.fpdf import FPDF
from datetime import datetime
import matplotlib
matplotlib.use('Agg') # Force un backend non-interactif pour matplotlib
import matplotlib.pyplot as plt
import io
import numpy as np
import tempfile
import os

def hex_to_rgb(hex_color):
    """Convertit une couleur hexadécimale #RRGGBB en tuple (R, G, B)."""
    hex_color = hex_color.lstrip('#')
    try:
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        return (37, 99, 235) # Couleur par défaut en cas d'erreur

class PVReport(FPDF):
    def __init__(self, orientation='P', unit='mm', format='A4', theme_color='#3b82f6'):
        super().__init__(orientation, unit, format)
        # On convertit et stocke la couleur au format RGB
        self.theme_color_rgb = hex_to_rgb(theme_color)

    def header(self): 
        self.set_font("helvetica", "B", 20)
        # On utilise le tuple RGB décompressé
        self.set_text_color(*self.theme_color_rgb)
        self.cell(0, 10, "Rapport de Production Photovoltaique", border=0, ln=1, align="L")
        self.set_font("helvetica", "", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"Edite le {datetime.now().strftime('%d/%m/%Y')}", border=0, ln=1, align="L")
        self.ln(10)

def save_image_from_buffer(buffer):
    """Sauvegarde un buffer d'image (BytesIO) dans un fichier temporaire et retourne son chemin."""
    try:
        buffer.seek(0)
        with tempfile.NamedTemporaryFile(mode='w+b', delete=False, suffix=".png") as tmp_file:
            tmp_file.write(buffer.read())
            return tmp_file.name
    except Exception:
        # Retourne None si une erreur se produit
        return None

def create_typical_day_chart(typical_days_data):
    """Génère un graphique des journées types avec Matplotlib."""
    if not typical_days_data:
        return None

    hours = typical_days_data.get('hours', [])
    summer_prod = typical_days_data.get('summer', [])
    winter_prod = typical_days_data.get('winter', [])

    if not all([hours, summer_prod, winter_prod]):
        return None

    plt.style.use('seaborn-v0_8-whitegrid')
    fig, ax = plt.subplots(figsize=(10, 5))

    ax.plot(hours, summer_prod, label='Journée type Été (Juin-Août)', color='#FFA500', linewidth=2)
    ax.fill_between(hours, summer_prod, color='#FFA500', alpha=0.2)

    ax.plot(hours, winter_prod, label='Journée type Hiver (Déc-Fév)', color='#4682B4', linewidth=2)
    ax.fill_between(hours, winter_prod, color='#4682B4', alpha=0.2)

    ax.set_title('Production Solaire Horaire Moyenne', fontsize=14, weight='bold')
    ax.set_xlabel('Heure de la journée', fontsize=10)
    ax.set_ylabel('Production (kW)', fontsize=10)
    ax.legend()
    ax.set_xticks(np.arange(0, 25, 2))
    ax.set_xlim(0, 23)
    ax.set_ylim(bottom=0)
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)
    return buf

def generate_pv_pdf_report(data):
    # Utilisation de la couleur du thème si elle est passée, sinon une couleur par défaut
    theme_color = data.get('theme_color', '#3b82f6')
    pdf = PVReport(theme_color=theme_color)
    pdf.add_page()
    
    summary = data.get('summary', {})
    fields = data.get('fields', []) # Correction: Les champs sont à la racine des données de résultat
    
    pdf.set_font("helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 10, "Paramètres d'entrée", border=0, ln=1, align="L")
    
    pdf.set_font("helvetica", "", 11)
    pdf.cell(0, 8, f"Localisation : Latitude {summary.get('lat')} / Longitude {summary.get('lon')}", border=0, ln=1)
    pdf.cell(0, 8, f"Puissance crête totale installée : {summary.get('peak_power_kw')} kWc", border=0, ln=1)
    
    # Tableau détaillé des paramètres par champ PV
    if fields:
        pdf.ln(5)
        pdf.set_font("helvetica", "B", 12)
        pdf.cell(0, 10, "Détail des champs photovoltaïques", border=0, ln=1, align="L")
        
        pdf.set_font("helvetica", "B", 9)
        pdf.set_fill_color(*pdf.theme_color_rgb)
        pdf.set_text_color(255, 255, 255)
        
        headers = ["Champ", "Centrale", "kWc", "Pertes (%)", "Techno", "Incl. (°)", "Azimut (°)"]
        col_widths = [20, 20, 20, 25, 30, 25, 25]
        for i, header in enumerate(headers):
            pdf.cell(col_widths[i], 8, header, border=1, fill=True, align="C")
        pdf.ln()

        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(0, 0, 0)
        for field in fields:
            pdf.cell(col_widths[0], 8, str(field.get('id', 'N/A')), border=1, align="C")
            pdf.cell(col_widths[1], 8, str(field.get('plant_id', '1')), border=1, align="C")
            pdf.cell(col_widths[2], 8, str(field.get('peak_power', 0)), border=1, align="C")
            pdf.cell(col_widths[3], 8, str(field.get('losses', 14)), border=1, align="C")
            pdf.cell(col_widths[4], 8, str(field.get('tech', 'crystSi')), border=1, align="C")
            pdf.cell(col_widths[5], 8, str(field.get('angle', 30)), border=1, align="C")
            pdf.cell(col_widths[6], 8, str(field.get('aspect', 0)), border=1, align="C")
            pdf.ln()

    pdf.ln(5)
    
    pdf.set_font("helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 10, "Indicateurs de performance globaux", border=0, ln=1, align="L")
    
    pdf.set_fill_color(*pdf.theme_color_rgb)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", "B", 11)
    pdf.cell(90, 10, "Indicateur", border=1, fill=True, align="C")
    pdf.cell(50, 10, "Valeur", border=1, fill=True, align="C", ln=1)
    
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("helvetica", "", 11)
    pdf.cell(90, 10, "Production totale annuelle", border=1, align="L")
    pdf.cell(50, 10, f"{(summary.get('total_production_kwh', 0) / 1000.0):.2f} MWh", border=1, align="C", ln=1)
    pdf.cell(90, 10, "Pic de production horaire", border=1, align="L")
    pdf.cell(50, 10, f"{summary.get('max_production_kw', 0):.2f} kW", border=1, align="C", ln=1)
    pdf.cell(90, 10, "Heures simulees", border=1, align="L")
    pdf.cell(50, 10, str(summary.get('hours_count', 0)), border=1, align="C", ln=1)
    
    # --- Section du tableau de production mensuelle ---
    monthly_prod = data.get('monthly_production_kwh')
    if monthly_prod and isinstance(monthly_prod, list) and len(monthly_prod) == 12:
        pdf.ln(10)
        pdf.set_font("helvetica", "B", 14)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 10, "Production mensuelle (MWh)", border=0, ln=1, align="L")
        
        pdf.set_font("helvetica", "B", 9)
        pdf.set_fill_color(*pdf.theme_color_rgb)
        pdf.set_text_color(255, 255, 255)
        
        months = ["Jan", "Fev", "Mar", "Avr", "Mai", "Juin", "Juil", "Aou", "Sep", "Oct", "Nov", "Dec"]
        col_width = 190 / 12 # Largeur totale / 12 mois
        
        for month in months:
            pdf.cell(col_width, 8, month, border=1, fill=True, align="C")
        pdf.ln()

        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(0, 0, 0)
        for prod_kwh in monthly_prod:
            prod_mwh = prod_kwh / 1000.0
            pdf.cell(col_width, 8, f"{prod_mwh:.2f}", border=1, align="C")
        pdf.ln()

        total_row_y = pdf.get_y()
        pdf.set_font("helvetica", "B", 10)
        pdf.text(pdf.get_x(), total_row_y + 10, f"Production Annuelle Totale : {(summary.get('total_production_kwh', 0) / 1000.0):.2f} MWh")

    # --- Section du graphique des journées types ---
    typical_days_data = data.get('typical_days')
    chart_image_buffer = create_typical_day_chart(typical_days_data)

    if chart_image_buffer:
        pdf.add_page()
        pdf.set_font("helvetica", "B", 14)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 10, "Profil de production journalier type", border=0, ln=1, align="L")
        pdf.ln(5)
        tmp_file_path = save_image_from_buffer(chart_image_buffer)
        if tmp_file_path:
            pdf.image(tmp_file_path, x=pdf.get_x(), y=pdf.get_y(), w=180, type='PNG')
            os.remove(tmp_file_path)

    return pdf.output(dest='S').encode('latin-1')