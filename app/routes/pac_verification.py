"""
Vérification des calculs PAC / climatiseur du navigateur (même principe que irve_verification.py).
================================================================================================
Le calcul est d'abord fait dans le navigateur (affichage immédiat), puis ses ENTRÉES et ses
RÉSULTATS sont envoyés ici : le calcul de référence (app/models/calcul_consommation/pac_calculs.py)
est refait et comparé valeur par valeur. Au-delà d'un écart de 0,01, les valeurs de référence
remplacent celles du navigateur (`conforme: false` + `reference`, et pour la simulation `series`).

Les saisies incohérentes ou hors bornes sont REJETÉES (400, message en clair) : bornes et contrôles
de app/schemas/pac_verification_schemas.py, miroir de pac_section.js.

  POST .../api/pac/verification/simulation    dimensionnement, simulation annuelle, synthèse
  POST .../api/pac/verification/rentabilite   étude de rentabilité et CO2
Lecture seule : rien n'est écrit en base.
"""
import logging

import pydantic
from flask import Blueprint, jsonify, request

from app.extensions import csrf
from app.middleware.auth_middleware import login_required
from app.models.calcul_consommation.pac_calculs import (
    GRANDEURS_Q, USAGES_ELEC, calculer_rentabilite, calculer_simulation, emissions, references, trouver,
)
from app.routes.irve_verification import MAX_ECARTS_RENVOYES, comparer
from app.schemas.pac_verification_schemas import (
    VerificationRentabiliteRequest, VerificationSimulationRequest, message_erreur,
)

pac_verification_bp = Blueprint('pac_verification', __name__)
logger = logging.getLogger(__name__)

SERIES_RENVOYEES = ('tAir',) + GRANDEURS_Q + USAGES_ELEC


def _erreur_validation(e):
    return jsonify({'success': False, 'error': f"Saisie incohérente : {message_erreur(e)}"}), 400


def _reponse(calcul, js, reference, **extra):
    ecarts = comparer(js, reference)
    if ecarts:
        logger.warning("[Vérification PAC] %s : %d écart(s), ex. %s", calcul, len(ecarts), ecarts[:3])
    corps = {'success': True, 'conforme': not ecarts, 'nb_ecarts': len(ecarts),
             'ecarts': ecarts[:MAX_ECARTS_RENVOYES], 'reference': reference}
    if ecarts:
        corps.update(extra)
    return jsonify(corps)


def _identifiants_connus(entrees):
    """Les identifiants (niveau d'isolation, ventilation, inertie, profil d'ECS) doivent exister."""
    ref = references()
    b = entrees['batiment']
    controles = [
        (b.get('niveau_id'), ref['bat']['niveaux_isolation'], "niveau d'isolation"),
        (b.get('ventilation_id'), ref['bat']['ventilations'], 'ventilation'),
        (b.get('inertie_id'), ref['bat']['inerties']['classes'], 'inertie'),
    ]
    for ident, liste, nom in controles:
        if ident is not None and trouver(liste, ident) is None:
            return f"{nom} inconnu(e) : {ident}"
    ecs = entrees.get('ecs')
    if ecs and ecs['profil_id'] not in ref['ecs']['profils_puisage']:
        return f"profil de puisage inconnu : {ecs['profil_id']}"
    return None


@pac_verification_bp.route('/api/pac/verification/simulation', methods=['POST'])
@pac_verification_bp.route('/concevoir_mon_projet/api/pac/verification/simulation', methods=['POST'])
@csrf.exempt
@login_required
def verification_simulation():
    from app.models.calcul_consommation.pac_meteo import serie_meteo_pac
    try:
        req = VerificationSimulationRequest.model_validate(request.get_json(silent=True) or {})
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    entrees = req.entrees.model_dump()
    inconnu = _identifiants_connus(entrees)
    if inconnu:
        return jsonify({'success': False, 'error': f"Saisie incohérente : {inconnu}."}), 400
    m = entrees['meteo']
    try:
        meteo = serie_meteo_pac(m['lat'], m['lon'], m['pas_minutes'], m['annee'])
    except Exception:
        logger.exception("[Vérification PAC] météo indisponible")
        return jsonify({'success': False, 'error': 'Données météo indisponibles : vérification reportée.'}), 502
    try:
        reference, sim = calculer_simulation(entrees, meteo)
    except (ValueError, ZeroDivisionError, KeyError, TypeError) as e:
        logger.exception("[Vérification PAC] calcul impossible")
        return jsonify({'success': False, 'error': f"Calcul de vérification impossible ({e})."}), 400
    return _reponse('simulation', req.navigateur, reference, series={k: sim[k] for k in SERIES_RENVOYEES})


@pac_verification_bp.route('/api/pac/verification/rentabilite', methods=['POST'])
@pac_verification_bp.route('/concevoir_mon_projet/api/pac/verification/rentabilite', methods=['POST'])
@csrf.exempt
@login_required
def verification_rentabilite():
    try:
        req = VerificationRentabiliteRequest.model_validate(request.get_json(silent=True) or {})
    except pydantic.ValidationError as e:
        return _erreur_validation(e)
    ent = req.entrees.model_dump()
    res = calculer_rentabilite(ent['p'], ent['e'])
    ind = res['indicateurs']
    part_reseau = ind['reseau_kwh'] / ind['pac_kwh'] if ind['pac_kwh'] > 0 else 1
    cr = dict(ent['conso_ref'], combustiblePciKwh={'total': ent['conso_ref']['combustiblePciKwh']})
    co2 = emissions(ent['annuel'], cr, ent['froid_compare'], part_reseau, references()['eco']['emissions_kgco2_kwh'])
    return _reponse('rentabilite', req.navigateur, {'indicateurs': ind, 'lignes': res['lignes'], 'co2': co2})
