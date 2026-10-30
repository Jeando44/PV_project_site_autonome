# -*- coding: utf-8 -*-
"""
Orthophoto drone : géoréférencement (fichier-monde -> coins WGS84) pour l'affichage sur la carte.
L'image n'est jamais envoyée au serveur (conservation en session dans le navigateur) : seuls les 6 nombres
du fichier-monde, les dimensions et l'éventuel .prj transitent.
"""
from flask import Blueprint, jsonify, request

from app.extensions import csrf
from app.models.orthophoto_georef import SYSTEMES_SUPPORTES, ErreurGeoref, georeferencer

orthophoto_bp = Blueprint('orthophoto', __name__)

TAILLE_TEXTE_MAX = 20000  # .prj WKT : quelques Ko


@orthophoto_bp.route('/api/orthophoto/systemes', methods=['GET'])
def systemes_orthophoto():
    return jsonify({'systemes': [{'code': code, 'nom': nom} for code, nom in SYSTEMES_SUPPORTES.items()]})


@orthophoto_bp.route('/api/orthophoto/georeferencer', methods=['POST'])
@csrf.exempt
def georeferencer_orthophoto():
    data = request.get_json(silent=True) or {}
    fichier_monde = data.get('fichier_monde')
    prj = data.get('prj')
    if not isinstance(fichier_monde, str) or len(fichier_monde) > TAILLE_TEXTE_MAX:
        return jsonify({'error': "Fichier de coordonnées manquant ou trop volumineux."}), 400
    if prj is not None and (not isinstance(prj, str) or len(prj) > TAILLE_TEXTE_MAX):
        return jsonify({'error': "Fichier .prj invalide."}), 400
    try:
        resultat = georeferencer(
            fichier_monde, data.get('largeur'), data.get('hauteur'),
            systeme=data.get('systeme') or 'auto', prj=prj,
        )
    except ErreurGeoref as e:
        return jsonify({'error': str(e)}), 400
    except Exception:
        return jsonify({'error': "Géoréférencement impossible avec ces données."}), 400
    return jsonify(resultat)
