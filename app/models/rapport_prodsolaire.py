from fpdf import FPDF
from datetime import datetime

class PVReport(FPDF):
    def header(self):
        self.set_font("helvetica", "B", 20)
        self.set_text_color(37, 99, 235)
        self.cell(0, 10, "Rapport de Production Photovoltaique", border=0, new_x="LMARGIN", new_y="NEXT", align="L")
        self.set_font("helvetica", "", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"Edite le {datetime.now().strftime('%d/%m/%Y')}", border=0, new_x="LMARGIN", new_y="NEXT", align="L")
        self.ln(10)

def generate_pv_pdf_report(data):
    pdf = PVReport()
    pdf.add_page()
    
    summary = data.get('summary', {})
    
    pdf.set_font("helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 10, "Parametres d'entree", border=0, new_x="LMARGIN", new_y="NEXT", align="L")
    
    pdf.set_font("helvetica", "", 11)
    pdf.cell(0, 8, f"Localisation : Latitude {summary.get('lat')} / Longitude {summary.get('lon')}", border=0, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Puissance crete : {summary.get('peak_power_kw')} kWc", border=0, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Inclinaison : {summary.get('tilt_deg')} deg", border=0, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, f"Azimut : {summary.get('az_deg')} deg", border=0, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    
    pdf.set_font("helvetica", "B", 14)
    pdf.cell(0, 10, "Indicateurs de performance globaux", border=0, new_x="LMARGIN", new_y="NEXT", align="L")
    
    pdf.set_fill_color(37, 99, 235)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", "B", 11)
    pdf.cell(90, 10, "Indicateur", border=1, fill=True, align="C")
    pdf.cell(50, 10, "Valeur", border=1, fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
    
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("helvetica", "", 11)
    pdf.cell(90, 10, "Production totale annuelle", border=1, align="L")
    pdf.cell(50, 10, f"{(summary.get('total_production_kwh', 0) / 1000.0):.2f} MWh", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(90, 10, "Pic de production horaire", border=1, align="L")
    pdf.cell(50, 10, f"{summary.get('max_production_kw', 0):.2f} kW", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(90, 10, "Heures simulees", border=1, align="L")
    pdf.cell(50, 10, str(summary.get('hours_count', 0)), border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    
    return pdf.output()