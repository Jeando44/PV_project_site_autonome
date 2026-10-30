"""
graph_modal_routes.py - Routes API pour la génération de graphiques
"""

from flask import Blueprint, request, jsonify
import logging

logger = logging.getLogger(__name__)

graph_modal_bp = Blueprint('graph_modal', __name__, url_prefix='/api/graph-modal')


@graph_modal_bp.route('/data', methods=['POST'])
def get_graph_data():
    try:
        data = request.get_json(silent=True) or {}

        if not data:
            return jsonify({'success': False, 'error': 'Aucune donnée fournie'}), 400

        # Valider les champs requis
        required_fields = ['solarData', 'shapes', 'formData']
        missing = [f for f in required_fields if f not in data or not data[f]]
        if missing:
            return jsonify({
                'success': False,
                'error': f'Champs manquants: {", ".join(missing)}'
            }), 400

        # Extraire les paramètres
        solar_data = data['solarData']
        shapes = data['shapes']
        form_data = data['formData']

        p50_adjustment = float(data.get('p50_adjustment', 0.0))
        uncertainty = float(data.get('uncertainty', 4.9))
        degradation = float(data.get('degradation', 0.25))
        duration = int(data.get('duration', 20))

        if duration not in [20, 25, 30]:
            return jsonify({'success': False, 'error': 'La durée doit être 20, 25 ou 30 ans'}), 400

        logger.info(f"Génération graphiques - durée: {duration} ans")

        from app.models.GraphModal import generate_solar_production_charts  # import différé : bibliothèque lourde, chargée au premier appel
        result = generate_solar_production_charts(
            solar_data=solar_data,
            shapes=shapes,
            form_data=form_data,
            p50_adjustment=p50_adjustment,
            uncertainty=uncertainty,
            degradation=degradation,
            duration=duration
        )

        return jsonify(result), 200

    except ValueError as e:
        logger.error(f"Erreur de validation: {e}")
        return jsonify({'success': False, 'error': f'Erreur de validation: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Erreur: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'Erreur interne du serveur'}), 500


@graph_modal_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'service': 'graph-modal-api'}), 200
