# -*- coding: utf-8 -*-
"""
Routes d'export DXF (ezdxf) pour les plans cartographiques : plan de situation,
plan de masse (Phase 2), plans de coupe (Phase 3).
"""
from flask import Blueprint, jsonify, request, send_file

from app.extensions import csrf

dxf_bp = Blueprint('dxf', __name__)


@dxf_bp.route('/api/export_dxf/situation', methods=['POST'])
@csrf.exempt
def export_dxf_situation():
    """Génère le DXF (zip dxf + logo éventuel) du Plan de situation projet."""
    payload = request.get_json(silent=True) or {}
    try:
        from app.models.dxf_generators.situation_dxf import generate_situation_dxf  # import différé : bibliothèque lourde, chargée au premier appel
        zip_buffer = generate_situation_dxf(payload)
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du DXF : {e}"}), 500

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='plan_situation_dxf.zip',
    )


@dxf_bp.route('/api/export_dxf/plan_de_masse', methods=['POST'])
@csrf.exempt
def export_dxf_plan_de_masse():
    """Génère le DXF (zip dxf + logo éventuel) du Plan de masse."""
    payload = request.get_json(silent=True) or {}
    try:
        from app.models.dxf_generators.plan_de_masse_dxf import generate_plan_de_masse_dxf  # import différé : bibliothèque lourde, chargée au premier appel
        zip_buffer = generate_plan_de_masse_dxf(payload)
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du DXF : {e}"}), 500

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='plan_de_masse_dxf.zip',
    )


@dxf_bp.route('/api/export_dxf/ombriere_metal', methods=['POST'])
@csrf.exempt
def export_dxf_ombriere_metal():
    """
    Génère le DXF (zip dxf + logo éventuel) de l'ombrière métal actuellement
    ouverte : coupe + façade + implantation des poteaux, chacune sur son propre
    layout A3 paysage. `data` = paramètres bruts (mêmes clés que
    calculate_ombriere()), lus en direct depuis le formulaire ouvert côté client
    (aucune donnée d'ombrière n'est aujourd'hui persistée en base, cf. notes de
    app/models/dxf_generators/ombriere_metal_v2.py).
    """
    payload = request.get_json(silent=True) or {}
    data = payload.get('data') or {}
    cartouche = payload.get('cartouche') or {}
    try:
        from app.models.dxf_generators.ombriere_metal_dxf import generate_ombriere_metal_dxf  # import différé : bibliothèque lourde, chargée au premier appel
        zip_buffer = generate_ombriere_metal_dxf(data, cartouche)
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du DXF : {e}"}), 500

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='ombriere_metal_dxf.zip',
    )


@dxf_bp.route('/api/export_dxf/petit_champ_solaire', methods=['POST'])
@csrf.exempt
def export_dxf_petit_champ_solaire():
    """
    Génère le DXF (zip dxf + logo éventuel) du petit champ solaire actuellement
    ouvert : coupe + façade, chacune sur son propre layout A3 paysage.
    `entities` = primitives déjà calculées côté client (coupe/facade), lues
    directement depuis les fonctions de dessin ouvertes (aucune géométrie
    recalculée côté serveur, cf. notes de dxf_generators/petit_champ_solaire_dxf.py).
    """
    payload = request.get_json(silent=True) or {}
    entities = payload.get('entities') or {}
    cartouche = payload.get('cartouche') or {}
    try:
        from app.models.dxf_generators.petit_champ_solaire_dxf import generate_petit_champ_solaire_dxf  # import différé : bibliothèque lourde, chargée au premier appel
        zip_buffer = generate_petit_champ_solaire_dxf(entities, cartouche)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f"Erreur lors de la génération du DXF : {e}"}), 500

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='petit_champ_solaire_dxf.zip',
    )
