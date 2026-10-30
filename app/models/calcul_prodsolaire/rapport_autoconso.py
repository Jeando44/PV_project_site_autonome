from fpdf import FPDF
from datetime import datetime
import io
import base64
import tempfile
import os

def hex_to_rgb(hex_color):
    """Convertit une couleur hexadécimale #RRGGBB en tuple (R, G, B)."""
    hex_color = hex_color.lstrip('#')
    try:
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        return (239, 68, 68) # Couleur par défaut (rouge)

class Report(FPDF):
    def __init__(self, orientation='P', unit='mm', format='A4', theme_color='#ef4444'):
        super().__init__(orientation, unit, format)
        self.theme_color_rgb = hex_to_rgb(theme_color)

    def header(self):
        self.set_font("helvetica", "B", 20)
        self.set_text_color(*self.theme_color_rgb)
        self.cell(0, 10, "Rapport d'Analyse d'Autoconsommation", border=0, ln=1, align="L")
        self.set_font("helvetica", "", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"Edite le {datetime.now().strftime('%d/%m/%Y')}", border=0, ln=1, align="L")
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(128)
        self.cell(0, 10, f"Page {self.page_no()}", 0, 0, "C")

def save_b64_image(b64_string):
    """Sauvegarde une image base64 dans un fichier temporaire."""
    try:
        # Enlever le préfixe 'data:image/png;base64,'
        img_data = base64.b64decode(b64_string.split(',')[1])
        with tempfile.NamedTemporaryFile(mode='w+b', delete=False, suffix=".png") as tmp_file:
            tmp_file.write(img_data)
            return tmp_file.name
    except Exception as e:
        print(f"Erreur sauvegarde image b64: {e}")
        return None

def generate_pdf_report(data):
    theme_color = data.get('theme_color', '#ef4444')
    pdf = Report(theme_color=theme_color)
    study_type = data.get('study_type', 'aci')
    pdf.add_page()

    global_summary = data.get('sites', {}).get('Global', {}).get('summary', {})

    if study_type == 'vente_totalite':
        # --- RAPPORT POUR VENTE EN TOTALITÉ ---
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, "Resume de la Production (Annee 1)", border=0, ln=1, align="L")
        
        kpis_vt = [
            ("Production PV totale (P50)", f"{global_summary.get('production_mwh', 0):.2f} MWh"),
            ("Puissance crete du projet", f"{global_summary.get('peak_power_kw', 0):.2f} kWc"),
        ]
        pdf.set_font("helvetica", "", 11)
        for label, value in kpis_vt:
            pdf.cell(90, 8, label, border=0)
            pdf.cell(50, 8, f": {value}", border=0, ln=1)
        pdf.ln(5)

        # Hypothèses P50/P90
        p90_params = data.get('p90_params', {})
        if p90_params:
            pdf.set_font("helvetica", "B", 14)
            pdf.cell(0, 10, "Hypotheses de calcul P50/P90", border=0, ln=1, align="L")
            
            hypotheses = [
                ("Incertitude totale sur la production", f"{p90_params.get('incertitude_production', 0):.2f} %"),
                ("Incertitude meteo", f"{p90_params.get('incertitude_meteo', 0):.2f} %"),
                ("Degradation annuelle des panneaux", f"{p90_params.get('degradation', 0):.2f} %"),
                ("Horizon d'etude", f"{p90_params.get('horizon', 0)} ans"),
            ]
            pdf.set_font("helvetica", "", 11)
            for label, value in hypotheses:
                pdf.cell(90, 8, label, border=0)
                pdf.cell(50, 8, f": {value}", border=0, ln=1)
        
        pdf.ln(10)

    else:
        # --- RAPPORT POUR ACI / ACC ---
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, "Resume Energetique Global", border=0, ln=1, align="L")
        
        kpis = [
            ("Production PV totale", f"{global_summary.get('production_mwh', 0):.2f} MWh"),
            ("Energie PV autoconsommee", f"{global_summary.get('pv_consumed_mwh', 0):.2f} MWh"),
            ("Excedent d'energie", f"{global_summary.get('surplus_mwh', 0):.2f} MWh"),
            ("Taux d'autoconsommation", f"{global_summary.get('autoconsumption_rate', 0):.2f} %"),
            ("Taux d'autoproduction", f"{global_summary.get('autoproduction_rate', 0):.2f} %"),
        ]

        pdf.set_font("helvetica", "", 11)
        for label, value in kpis:
            pdf.cell(90, 8, label, border=0)
            pdf.cell(50, 8, f": {value}", border=0, ln=1)
        
        pdf.ln(10)

    # --- Section 2: Analyse de Rentabilité (ACC) ---
    eco_results = data.get('economic_results')
    if eco_results and study_type == 'acc':
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, "Analyse de Rentabilite (ACC)", border=0, ln=1, align="L")

        # Tableau des économies par participant
        pdf.set_font("helvetica", "B", 10)
        pdf.set_fill_color(*pdf.theme_color_rgb)
        pdf.set_text_color(255, 255, 255)
        headers = ["Participant", "Facture SANS projet PV"
        "", "Facture AVEC projet PV", "Economie annuelle"]
        col_widths = [50, 45, 45, 40]
        for i, header in enumerate(headers):
            pdf.cell(col_widths[i], 8, header, border=1, fill=True, align="C")
        pdf.ln()

        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(0, 0, 0)
        for key, participant_data in eco_results.items():
            if key == 'producteur':
                continue
            pdf.cell(col_widths[0], 8, key, border=1)
            pdf.cell(col_widths[1], 8, f"{participant_data.get('cout_sans_acc', 0):.2f} EUR", border=1, align="R")
            pdf.cell(col_widths[2], 8, f"{participant_data.get('cout_avec_acc', 0):.2f} EUR", border=1, align="R")
            pdf.cell(col_widths[3], 8, f"{participant_data.get('economie_annuelle', 0):.2f} EUR", border=1, align="R")
            pdf.ln()
        
        pdf.ln(5)

        # Indicateurs Producteur
        producteur_data = eco_results.get('producteur', {})
        # NOUVEAU: Utiliser les indicateurs financiers calculés
        van_projet = producteur_data.get('van_projet', 0)
        tri_projet = producteur_data.get('tri_projet', 0)
        tri_equity = producteur_data.get('tri_equity', 0)
        temps_retour = producteur_data.get('temps_retour_actualise')
        temps_retour_text = f"{temps_retour:.1f} ans" if temps_retour is not None and temps_retour > 0 else "Non atteint"

        pdf.set_font("helvetica", "B", 12)
        pdf.cell(0, 8, "Indicateurs pour le Producteur", border='B', ln=1)
        pdf.ln(4)
        pdf.set_font("helvetica", "", 10)
        pdf.cell(90, 8, "Revenu Total Annuel (An 1)", border=0)
        pdf.cell(50, 8, f": {producteur_data.get('revenu_total_annuel', 0):.2f} EUR", border=0, ln=1)
        pdf.cell(90, 8, "Temps de Retour sur Investissement (Actualise)", border=0)
        pdf.cell(50, 8, f": {temps_retour_text}", border=0, ln=1)
        pdf.cell(90, 8, "TRI Projet", border=0)
        pdf.cell(50, 8, f": {tri_projet:.2f} %", border=0, ln=1)
        pdf.cell(90, 8, "TRI Fonds Propres", border=0)
        pdf.cell(50, 8, f": {tri_equity:.2f} %", border=0, ln=1)

    pdf.ln(10)

    # --- Section 3: Graphiques ---
    chart_images = data.get('chartImages', {})
    tmp_files = []

    # Graphique barres mensuel
    if chart_images.get('monthly_bar'):
        pdf.add_page()
        title = "Production Mensuelle (P50 - Annee 1)" if study_type == 'vente_totalite' else "Analyse Mensuelle Globale"
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, title, border=0, ln=1, align="L")
        path = save_b64_image(chart_images['monthly_bar'])
        if path:
            tmp_files.append(path)
            pdf.image(path, x=15, w=180)
            pdf.ln(5)

    # NOUVEAU: Graphique P50/P90 pour Vente en Totalité
    if study_type == 'vente_totalite' and chart_images.get('p50_p90_bar'):
        pdf.add_page()
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, "Evolution de la Production Annuelle (P50 vs P90)", border=0, ln=1, align="L")
        path = save_b64_image(chart_images['p50_p90_bar'])
        if path:
            tmp_files.append(path)
            pdf.image(path, x=15, w=180)
            pdf.ln(5)

    # Graphiques économiques
    if chart_images.get('eco_comparison_bar') or chart_images.get('eco_producer_pie'):
        pdf.add_page()
        pdf.set_font("helvetica", "B", 14)
        pdf.cell(0, 10, "Graphiques Economiques", border=0, ln=1, align="L")
        current_y = pdf.get_y()

        # Graphique comparaison factures
        if chart_images.get('eco_comparison_bar'):
            path = save_b64_image(chart_images['eco_comparison_bar'])
            if path:
                tmp_files.append(path)
                pdf.set_font("helvetica", "B", 11)
                pdf.cell(0, 8, "Comparaison des factures annuelles", border=0, ln=1)
                pdf.image(path, x=15, w=180, h=80)
                current_y = pdf.get_y() + 85
        
        pdf.set_y(current_y)
        pdf.ln(10)

        # Graphique revenus producteur
        if chart_images.get('eco_producer_pie'):
            path = save_b64_image(chart_images['eco_producer_pie'])
            if path:
                tmp_files.append(path)
                pdf.set_font("helvetica", "B", 11)
                pdf.cell(0, 8, "Repartition des revenus du producteur", border=0, ln=1)
                pdf.image(path, x=pdf.get_x() + 50, w=90, h=90)

    # Nettoyage des fichiers temporaires
    for f in tmp_files:
        try:
            os.remove(f)
        except Exception as e:
            print(f"Erreur suppression fichier temp: {e}")

    return pdf.output(dest='S').encode('latin-1')