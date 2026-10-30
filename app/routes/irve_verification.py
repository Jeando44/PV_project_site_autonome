"""
Vérification des calculs IRVE du navigateur et persistance de la section Rentabilité.
=====================================================================================
Chaque calcul de la page IRVE est d'abord fait dans le navigateur (affichage immédiat), puis ses
ENTRÉES et ses RÉSULTATS sont envoyés ici : le calcul de référence (app/models/calcul_consommation/)
est refait et comparé valeur par valeur. Au-delà d'un écart de 0,01, les valeurs de référence
remplacent celles du navigateur (`conforme: false` + `reference`).

  POST .../api/irve/verification/bilan_puissance   bilan de puissance des bornes
  POST .../api/irve/verification/energie           énergie consommée par les bornes (bilan annuel)
  POST .../api/irve/verification/batterie_eco      modal Batterie & Éco (recharge, comparatif VE / thermique)
  POST .../api/irve/verification/rentabilite       section Rentabilité (courbes relues EN BASE)
  GET/POST .../parametre-projet/<id>/irve/rentabilite   saisies de la section Rentabilité
"""
import logging
import math

import pydantic
from flask import Blueprint, g, jsonify, request

from app.extensions import csrf, db
from app.middleware.auth_middleware import login_required
from app.models.calcul_consommation.batterie_eco_irve import calculer_batterie_eco
from app.models.calcul_consommation.calcul_irve import bilan_puissance_brut, simuler_energie_irve
from app.models.calcul_consommation.rentabilite_irve import calculer_rentabilite, energie_depuis_courbes
from app.schemas.irve_rentabilite_schemas import (
    RentabiliteIrveSauvegarde, VerificationBatterieRequest, VerificationBilanRequest,
    VerificationEnergieRequest, VerificationRentabiliteRequest,
)
from app.services.irve_controle import ecart_admis, energie_kwh

irve_verification_bp = Blueprint('irve_verification', __name__)
logger = logging.getLogger(__name__)

TOLERANCE = 0.01
MAX_ECARTS_RENVOYES = 50


def comparer(js, ref, chemin='', ecarts=None):
    """Écarts entre le résultat du navigateur et la référence (nombres : écart > 0,01)."""
    if ecarts is None:
        ecarts = []
    if isinstance(ref, dict):
        if not isinstance(js, dict):
            ecarts.append({'chemin': chemin or '/', 'navigateur': None, 'reference': '{…}'})
            return ecarts
        for cle, valeur in ref.items():
            if cle in js:
                comparer(js[cle], valeur, f"{chemin}.{cle}" if chemin else cle, ecarts)
        return ecarts
    if isinstance(ref, list):
        if not isinstance(js, list) or len(js) != len(ref):
            ecarts.append({'chemin': chemin, 'navigateur': f"{len(js) if isinstance(js, list) else '?'} valeurs", 'reference': f"{len(ref)} valeurs"})
            return ecarts
        for i, (a, b) in enumerate(zip(js, ref)):
            comparer(a, b, f"{chemin}[{i}]", ecarts)
        return ecarts
    est_nombre = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)  # noqa: E731
    if est_nombre(ref) and est_nombre(js):
        if not (math.isfinite(ref) and math.isfinite(js)) or abs(ref - js) > TOLERANCE:
            ecarts.append({'chemin': chemin, 'navigateur': js, 'reference': ref})
    elif ref != js:
        ecarts.append({'chemin': chemin, 'navigateur': js, 'reference': ref})
    return ecarts


def _reponse(calcul, js, reference):
    ecarts = comparer(js, reference)
    if ecarts:
        logger.warning("[Vérification IRVE] %s : %d écart(s), ex. %s", calcul, len(ecarts), ecarts[:3])
    return jsonify({
        'success': True,
        'conforme': not ecarts,
        'nb_ecarts': len(ecarts),
        'ecarts': ecarts[:MAX_ECARTS_RENVOYES],
        'reference': reference,
    })


def _erreur_validation(e):
    premiere = e.errors()[0] if e.errors() else None
    champ = '.'.join(str(p) for p in premiere['loc']) if premiere else '?'
    message = premiere['msg'] if premiere else str(e)
    return jsonify({'success': False, 'message': f"Champ '{champ}' invalide : {message}"}), 400


def _route(nom):
    return [f'/api/irve/verification/{nom}', f'/concevoir_mon_projet/api/irve/verification/{nom}']


def _enregistrer(nom, vue):
    for url in _route(nom):
        irve_verification_bp.add_url_rule(url, f'verifier_{nom}' if url.startswith('/api') else f'verifier_{nom}_prefixe',
                                          vue, methods=['POST'])


@csrf.exempt
@login_required
def verifier_bilan_puissance():
    try:
        req = VerificationBilanRequest.model_validate(request.get_json(silent=True) or {})
        ref = bilan_puissance_brut([b.model_dump() for b in req.bornes], req.params)
        return _reponse('bilan_puissance', req.js, ref)
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@csrf.exempt
@login_required
def verifier_energie():
    try:
        req = VerificationEnergieRequest.model_validate(request.get_json(silent=True) or {})
        entrees = req.model_dump(exclude={'js'})
        ref = simuler_energie_irve(entrees)
        return _reponse('energie', req.js, ref)
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@csrf.exempt
@login_required
def verifier_batterie_eco():
    try:
        req = VerificationBatterieRequest.model_validate(request.get_json(silent=True) or {})
        ref = calculer_batterie_eco(req.entrees)
        return _reponse('batterie_eco', req.js, ref)
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@csrf.exempt
@login_required
def verifier_rentabilite():
    """Énergie recalculée depuis les courbes EN BASE (bilan + part PV), puis flux et indicateurs."""
    from app.models.irve import IrveConfig
    from app.routes.concevoir_mon_projet import _get_project_with_permission
    try:
        req = VerificationRentabiliteRequest.model_validate(request.get_json(silent=True) or {})
        if not _get_project_with_permission(req.projet_id, g.user):
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        config = IrveConfig.query.filter_by(projet_id=req.projet_id).first()
        courbe = config.load_curve if config else None
        if not courbe or not courbe.get('irve'):
            return jsonify({'success': True, 'verifiable': False, 'message': "Aucune courbe IRVE enregistrée."})
        bilan = courbe.get('bilan_irve_kwh')
        if bilan is None or not ecart_admis(energie_kwh(courbe['irve'], int(courbe['pas_temps_min'])), float(bilan)):
            return jsonify({'success': True, 'verifiable': False, 'message': "Courbe IRVE enregistrée non conforme au bilan."})
        auto = courbe.get('autoconso_irve')
        if auto and not ecart_admis(float(auto.get('cons_irve_kwh') or 0), float(bilan)):
            return jsonify({'success': True, 'verifiable': False, 'message': "Analyse d'autoconsommation non conforme au bilan."})
        energie = energie_depuis_courbes(courbe, auto, req.tarif, req.horo.model_dump())
        params = req.params.model_dump()
        ref = calculer_rentabilite(params, energie)
        ref['energie'] = energie
        return _reponse('rentabilite', req.js, ref)
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    except (ValueError, TypeError, KeyError, ZeroDivisionError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400


_enregistrer('bilan_puissance', verifier_bilan_puissance)
_enregistrer('energie', verifier_energie)
_enregistrer('batterie_eco', verifier_batterie_eco)
_enregistrer('rentabilite', verifier_rentabilite)


# ------------------------------------------------------------------ persistance de la section Rentabilité

@irve_verification_bp.route('/concevoir_mon_projet/parametre-projet/<int:projet_id>/irve/rentabilite', methods=['GET'])
@login_required
def charger_rentabilite(projet_id):
    from app.models.irve import IrveConfig
    from app.routes.concevoir_mon_projet import _get_project_with_permission
    if not _get_project_with_permission(projet_id, g.user):
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    config = IrveConfig.query.filter_by(projet_id=projet_id).first()
    return jsonify({'success': True, 'rentabilite': config.rentabilite if config else None})


@irve_verification_bp.route('/concevoir_mon_projet/parametre-projet/<int:projet_id>/irve/rentabilite', methods=['POST'])
@login_required
def enregistrer_rentabilite(projet_id):
    from app.models.irve import IrveConfig
    from app.routes.concevoir_mon_projet import _get_project_with_permission
    try:
        if not _get_project_with_permission(projet_id, g.user):
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        donnees = RentabiliteIrveSauvegarde.model_validate(request.get_json(silent=True) or {})
        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = IrveConfig(projet_id=projet_id, data={})
            db.session.add(config)
        config.rentabilite = donnees.model_dump()
        db.session.commit()
        return jsonify({'success': True})
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    except Exception as e:
        db.session.rollback()
        logger.exception("Enregistrement de la rentabilité IRVE impossible")
        return jsonify({'success': False, 'message': str(e)}), 500
