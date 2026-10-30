"""
Orchestrateur des calculs de consommation/autonomie — port Python de validation croisée avec le JS
du modal IRVE (app/static/concevoir_mon_projet/javascript/Irve/). Utilisé par le bouton temporaire
"Comparer avec Python" de la section 2 (Analyse d'autonomie énergétique du site).
"""
import logging

import pydantic
from flask import Blueprint, request, jsonify, g

from app.extensions import csrf
from app.middleware.auth_middleware import login_required
from app.models.calcul_consommation.calcul_consommation import (
    compute_average_existing_hourly,
    compute_besoin_journalier_kwh,
    compute_puissance_max_simultanee_kw,
)
from app.models.calcul_consommation.calcul_autonomie import build_autonomy_pv_params, compute_autonomy
from app.models.calcul_prodsolaire.calcul_prodsolaire import calculate_pv_data
from app.models.calcul_consommation.calcul_irve import compute_bilan_puissance
from app.schemas.irve_schemas import CalculerAutonomieRequest, SystemeHybrideProductibleRequest
from app.schemas.pac_schemas import PacAltitudeRequest, PacMeteoRequest

consommation_bp = Blueprint('consommation', __name__)


@consommation_bp.route('/api/consommation/calculer_autonomie', methods=['POST'])
@consommation_bp.route('/concevoir_mon_projet/api/consommation/calculer_autonomie', methods=['POST'])
@csrf.exempt
@login_required
def calculer_autonomie():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        # CORRECTIF (validation stricte) : remplace l'extraction manuelle non protégée
        # (float(data.get('lat')) levait un TypeError non intercepté -> 500 si lat manquant/invalide)
        # par une validation Pydantic complète du payload, avec des bornes explicites par champ.
        req = CalculerAutonomieRequest.model_validate(data)

        # Profil journalier moyen du site : celui transmis par le frontend s'il existe (seule source
        # correcte quand la consommation vient d'un import de courbe de charge, cf. schema), sinon
        # reconstruit a partir des profils saisonniers comme auparavant.
        if req.existing_hourly_data:
            existing_hourly = [float(v or 0) for v in req.existing_hourly_data]
        else:
            existing_hourly = compute_average_existing_hourly(req.seasonal_hourly_data)
        besoin_journalier_kwh = compute_besoin_journalier_kwh(existing_hourly)

        # Puissance onduleur : préfère le pic AVANT foisonnement transmis par le JS (Méthode 1
        # équipements, cf. loadProfileBottomUp.js) — sinon, celui-ci n'existe pas (Méthode 2/saisie
        # manuelle/import, où aucun foisonnement ne s'applique) et le max du profil suffit.
        puissance_max_simultanee_kw = (
            req.puissance_max_avant_foisonnement_kw
            if req.puissance_max_avant_foisonnement_kw is not None
            else compute_puissance_max_simultanee_kw(existing_hourly)
        )

        if besoin_journalier_kwh <= 0:
            return jsonify({'error': "Aucune consommation du site définie (section 1 vide)."}), 400

        result = compute_autonomy(besoin_journalier_kwh, puissance_max_simultanee_kw, req.autonomie_params.model_dump(), req.lat, req.lon)

        # Bilan de puissance IRVE (optionnel) : fourni seulement si des bornes ont été sélectionnées.
        if req.irve_data:
            bilan_params = req.bilan_params.model_dump() if req.bilan_params else {}
            result['bilan_puissance'] = compute_bilan_puissance([b.model_dump() for b in req.irve_data], bilan_params)

        _memoriser_autonomie(data.get('projet_id'), result)
        return jsonify(result)
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'error': f"Champ '{field}' invalide : {message}"}), 400
    except (ValueError, TypeError, KeyError) as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _memoriser_autonomie(projet_id, result):
    """
    Consommation annuelle du site enregistrée en base pour l'étude économique (Site autonome /
    Hybride, cf. app/services/resultats_prodsolaire.py) — seulement pour un projet de l'utilisateur.
    Un échec n'empêche pas l'affichage : l'étude éco reste bloquée faute de valeur enregistrée.
    """
    from app.extensions import db
    from app.routes.concevoir_mon_projet import _get_project_with_permission
    from app.services.resultats_prodsolaire import memoriser_autonomie
    try:
        projet = _get_project_with_permission(int(projet_id), g.user) if projet_id else None
    except (TypeError, ValueError):
        projet = None
    if not projet:
        return
    try:
        memoriser_autonomie(projet.id, result)
        db.session.commit()
        result['autonomie_enregistree'] = projet.id
    except Exception as e:
        logging.getLogger(__name__).warning("Enregistrement du pré-dimensionnement impossible : %s", e)
        db.session.rollback()


@consommation_bp.route('/api/systeme_hybride/productible', methods=['POST'])
@consommation_bp.route('/concevoir_mon_projet/api/systeme_hybride/productible', methods=['POST'])
@csrf.exempt
@login_required
def systeme_hybride_productible():
    """Productible spécifique (kWh/kWc/an) du site pour la section Système hybride : même simulation
    PVGIS/pvlib (champ de référence de 1 kWc, TMY mis en cache) que l'Analyse d'autonomie
    énergétique du site (compute_autonomy), pour que les deux sections affichent la même valeur."""
    try:
        req = SystemeHybrideProductibleRequest.model_validate(request.get_json(silent=True) or {})
        params = build_autonomy_pv_params(
            {'inclinaison': req.inclinaison, 'azimut': req.azimut, 'pertes': req.pertes, 'mount': 'free', 'usehorizon': '1'},
            req.lat, req.lon)
        result = calculate_pv_data(params)
        productible = float(result['fields'][0].get('specific_production') or 0)
        if productible <= 0:
            return jsonify({'error': 'Productible nul renvoyé par la simulation solaire.'}), 502
        return jsonify({
            'productible_annuel_kwh_kwc': productible,
            'pr': result.get('summary', {}).get('performance_ratio'),
        })
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'error': f"Champ '{field}' invalide : {message}"}), 400
    except (ValueError, TypeError, KeyError) as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@consommation_bp.route('/api/pac/meteo', methods=['POST'])
@consommation_bp.route('/concevoir_mon_projet/api/pac/meteo', methods=['POST'])
@csrf.exempt
@login_required
def pac_meteo():
    """Séries météo du site pour la section PAC / climatiseur : température, humidité, irradiation
    horizontale et sur les 4 façades, en heure murale sur la grille de 365 jours de la courbe IRVE.
    Lecture seule : rien n'est écrit en base (cf. app/models/calcul_consommation/pac_meteo.py)."""
    from app.models.calcul_consommation.pac_meteo import serie_meteo_pac
    try:
        req = PacMeteoRequest.model_validate(request.get_json(silent=True) or {})
        return jsonify(serie_meteo_pac(req.lat, req.lon, req.pas_minutes, req.annee, req.cache_id))
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'error': f"Champ '{field}' invalide : {message}"}), 400
    except (ValueError, TypeError, KeyError) as e:
        return jsonify({'error': str(e)}), 400
    except Exception:
        logging.exception("Données météo PAC indisponibles")
        return jsonify({'error': "Données météo indisponibles pour ce site. Réessayez plus tard."}), 502


@consommation_bp.route('/api/pac/altitude', methods=['POST'])
@consommation_bp.route('/concevoir_mon_projet/api/pac/altitude', methods=['POST'])
@csrf.exempt
@login_required
def pac_altitude():
    """Altitude du terrain au point de l'adresse du projet (pré-remplissage du champ « Altitude du
    site » de la section PAC). Lecture seule ; altitude_m = null si aucune source n'a répondu."""
    import os
    from flask import current_app
    from app.models.calcul_consommation.pac_meteo import altitude_site
    try:
        req = PacAltitudeRequest.model_validate(request.get_json(silent=True) or {})
    except pydantic.ValidationError:
        return jsonify({'error': 'Coordonnées invalides.'}), 400
    return jsonify(altitude_site(req.lat, req.lon, os.path.join(current_app.instance_path, 'cache_mnt')))
