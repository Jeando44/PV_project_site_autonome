# -*- coding: utf-8 -*-
"""
Routes d'export PDF vectoriel (ReportLab) pour les plans qui ne passent pas par
le pipeline jsPDF/html2canvas côté client (pas de capture de carte à faire) :
ombrière métal (coupe + façade), petit champ solaire (coupe + façade).
"""
from flask import Blueprint, jsonify, request, send_file

from app.extensions import csrf
from app.services.mention_essai import pdf_pour_utilisateur

pdf_bp = Blueprint('pdf_export', __name__)


@pdf_bp.route('/api/export_pdf/ombriere_metal', methods=['POST'])
@csrf.exempt
def export_pdf_ombriere_metal():
    """
    Génère le PDF (A3 paysage, 2 pages : coupe puis façade) de l'ombrière métal
    actuellement ouverte. `data` = paramètres bruts (mêmes clés que
    calculate_ombriere()), lus en direct depuis le formulaire ouvert côté client.
    """
    payload = request.get_json(silent=True) or {}
    data = payload.get('data') or {}
    cartouche = payload.get('cartouche') or {}
    try:
        from app.models.pdf_generators.ombriere_metal_pdf import generate_ombriere_metal_pdf  # import différé : bibliothèque lourde, chargée au premier appel
        pdf_buffer = pdf_pour_utilisateur(generate_ombriere_metal_pdf(data, cartouche))
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du PDF : {e}"}), 500

    return send_file(
        pdf_buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name='ombriere_metal.pdf',
    )


@pdf_bp.route('/api/export_pdf/petit_champ_solaire', methods=['POST'])
@csrf.exempt
def export_pdf_petit_champ_solaire():
    """
    Génère le PDF (A3 paysage, 1 page par vue présente : coupe puis façade) du
    petit champ solaire actuellement ouvert. `entities` = primitives déjà
    calculées côté client (même format que /api/export_dxf/petit_champ_solaire).
    """
    payload = request.get_json(silent=True) or {}
    entities = payload.get('entities') or {}
    cartouche = payload.get('cartouche') or {}
    try:
        from app.models.pdf_generators.petit_champ_solaire_pdf import generate_petit_champ_solaire_pdf  # import différé : bibliothèque lourde, chargée au premier appel
        pdf_buffer = pdf_pour_utilisateur(generate_petit_champ_solaire_pdf(entities, cartouche))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du PDF : {e}"}), 500

    return send_file(
        pdf_buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name='petit_champ_solaire.pdf',
    )
