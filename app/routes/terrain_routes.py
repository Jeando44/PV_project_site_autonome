# -*- coding: utf-8 -*-
"""
Terrain (MNT) : grille d'altitudes IGN couvrant un champ PV, servie depuis un cache disque.
`source` : 'ign' (défaut ; hors domaine -> `hors_domaine_ign`) ou 'copernicus' (monde entier,
Copernicus DEM GLO-30). Le navigateur enchaîne IGN -> Copernicus -> Google Elevation (dernier
recours, demandé par le navigateur lui-même : rien de Google ne transite par le serveur).
L'authentification est assurée par le middleware global (/api/*).
"""
import os
from urllib.error import URLError

from flask import Blueprint, current_app, jsonify, request

from app.extensions import csrf
from app.services.terrain.copernicus import ErreurCopernicus
from app.services.terrain.grille_cache import (
    ErreurTerrain, encoder_grille, grille_copernicus_pour_points, grille_pour_points,
)

terrain_bp = Blueprint('terrain', __name__)

MAX_POINTS = 2000
MARGE_MAX_M = 100.0
STATUTS = {'hors_domaine_ign': 422, 'donnees_absentes': 422, 'emprise_trop_grande': 413}


def _points(data):
    brut = data.get('points')
    if not isinstance(brut, list) or not 1 <= len(brut) <= MAX_POINTS:
        return None
    points = []
    for p in brut:
        try:
            lat, lng = float(p['lat']), float(p['lng'])
        except (TypeError, KeyError, ValueError):
            return None
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return None
        points.append((lat, lng))
    return points


@terrain_bp.route('/api/terrain/grille', methods=['POST'])
@csrf.exempt
def grille_terrain():
    data = request.get_json(silent=True) or {}
    points = _points(data)
    if points is None:
        return jsonify({'code': 'requete_invalide', 'error': f'1 à {MAX_POINTS} points {{lat, lng}} attendus.'}), 400
    try:
        marge = min(max(float(data.get('marge_m', 20)), 0.0), MARGE_MAX_M)
    except (TypeError, ValueError):
        marge = 20.0
    dossier = os.path.join(current_app.instance_path, 'cache_mnt')
    if data.get('source') == 'copernicus':
        try:
            grille, depuis_cache = grille_copernicus_pour_points(points, marge, dossier)
        except ErreurTerrain as e:
            return jsonify({'code': e.code, 'error': str(e)}), STATUTS.get(e.code, 400)
        except (URLError, TimeoutError, OSError, ValueError, ErreurCopernicus) as e:
            current_app.logger.warning('Terrain Copernicus indisponible : %s', e)
            return jsonify({'code': 'copernicus_indisponible',
                            'error': 'Service altimétrique momentanément indisponible.'}), 502
        reponse = encoder_grille(grille)
        reponse['cache'] = depuis_cache
        return jsonify(reponse)
    try:
        grille, depuis_cache = grille_pour_points(points, marge, dossier)
    except ErreurTerrain as e:
        return jsonify({'code': e.code, 'error': str(e)}), STATUTS.get(e.code, 400)
    except (URLError, TimeoutError, OSError, ValueError) as e:
        current_app.logger.warning('Terrain IGN indisponible : %s', e)
        return jsonify({'code': 'ign_indisponible', 'error': 'Service altimétrique momentanément indisponible.'}), 502
    reponse = encoder_grille(grille)
    reponse['cache'] = depuis_cache
    return jsonify(reponse)
