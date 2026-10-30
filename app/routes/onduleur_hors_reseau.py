"""
Validation des appareils génériques hors réseau (pompage solaire / site autonome).
=================================================================================
Les valeurs saisies dans le formulaire du calepinage (onduleurs_hors_reseau.js) sont contrôlées
dans le navigateur, puis ici avant d'être appliquées au dimensionnement des chaînes : bornes et
cohérence de app/schemas/onduleur_hors_reseau_schemas.py (miroir du front).

  POST .../api/onduleur_hors_reseau/valider   {role, valeurs} -> {success, valeurs normalisées}
Lecture seule : rien n'est écrit en base (persistance à l'étude, cf. docs/onduleurs_hors_reseau_etude.md).
"""
import pydantic
from flask import Blueprint, jsonify, request

from app.extensions import csrf
from app.middleware.auth_middleware import login_required
from app.schemas.onduleur_hors_reseau_schemas import AppareilHorsReseau, message_erreur

onduleur_hors_reseau_bp = Blueprint('onduleur_hors_reseau', __name__)


@onduleur_hors_reseau_bp.route('/api/onduleur_hors_reseau/valider', methods=['POST'])
@onduleur_hors_reseau_bp.route('/concevoir_mon_projet/api/onduleur_hors_reseau/valider', methods=['POST'])
@csrf.exempt
@login_required
def valider_appareil_hors_reseau():
    try:
        appareil = AppareilHorsReseau.model_validate(request.get_json(silent=True) or {})
    except pydantic.ValidationError as e:
        return jsonify({'success': False, 'error': message_erreur(e)}), 400
    return jsonify({'success': True, 'valeurs': appareil.valeurs.model_dump()})
