"""
Routes du calculateur Loi APER (calcul_APER.js) :

  GET  /concevoir_mon_projet/parametre-projet/<projet_id>/loi-aper/load
       polygones, % solarisables (valeur + libellé) et surface projetée champ PV du calepinage
       enregistré, pour la variante active du projet ;
  POST /concevoir_mon_projet/parametre-projet/<projet_id>/loi-aper/save
       remplace polygones et variables après validation stricte (loi_aper_schemas.py).

Même contrôle d'accès que les autres routes du projet (créateur ou administrateur) et même garde
que le calepinage : écriture refusée (409) si le projet n'est plus le projet actif de la session.
"""
import pydantic
from flask import Blueprint, g, jsonify, request

from app.extensions import db
from app.middleware.auth_middleware import login_required
from app.routes.concevoir_mon_projet import _get_project_with_permission, _refus_projet_hors_session
from app.schemas.loi_aper_schemas import AperSauvegarde
from app.services.loi_aper import charger_donnees_aper, enregistrer_donnees_aper

loi_aper_bp = Blueprint('loi_aper', __name__, url_prefix='/concevoir_mon_projet')

# Quelques dizaines de polygones font quelques dizaines de Ko : au-delà, pas une saisie légitime.
MAX_CORPS_OCTETS = 2 * 1024 * 1024


@loi_aper_bp.route('/parametre-projet/<int:projet_id>/loi-aper/load', methods=['GET'])
@login_required
def charger_loi_aper(projet_id):
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        return jsonify({'success': True, **charger_donnees_aper(projet)})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur lors du chargement de la Loi APER : {e}'}), 500


@loi_aper_bp.route('/parametre-projet/<int:projet_id>/loi-aper/save', methods=['POST'])
@login_required
def enregistrer_loi_aper(projet_id):
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        if request.content_length and request.content_length > MAX_CORPS_OCTETS:
            return jsonify({'success': False, 'message': 'Requête trop volumineuse.'}), 413
        corps = request.get_json(silent=True)
        if not isinstance(corps, dict):
            return jsonify({'success': False, 'message': 'Corps JSON attendu.'}), 400

        sauvegarde = AperSauvegarde.model_validate(corps)
        enregistrer_donnees_aper(projet, sauvegarde)
        db.session.commit()
        return jsonify({'success': True, 'indiceProjet': projet.active_indice})
    except pydantic.ValidationError as e:
        erreur = e.errors()[0] if e.errors() else None
        champ = '.'.join(str(p) for p in erreur['loc']) if erreur else '?'
        message = erreur['msg'] if erreur else str(e)
        return jsonify({'success': False, 'message': f"Loi APER : champ '{champ}' invalide : {message}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f"Erreur lors de l'enregistrement de la Loi APER : {e}"}), 500
