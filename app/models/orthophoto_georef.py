# -*- coding: utf-8 -*-
"""
Géoréférencement d'une orthophoto drone livrée en JPEG/PNG + fichier-monde (.jgw, .pgw, .tfw, .wld).

Le fichier-monde contient 6 nombres (convention ESRI), pour le CENTRE du pixel (colonne, ligne) :
    X = A·colonne + B·ligne + C
    Y = D·colonne + E·ligne + F
dans l'ordre du fichier : A, D, B, E, C, F. Il ne dit PAS dans quel système de coordonnées sont X et Y :
on le lit dans le .prj s'il est fourni, sinon on le déduit de l'ordre de grandeur des valeurs (cas
français courants : Lambert 93, UTM 30/31/32 N, WGS84 en degrés), ou l'utilisateur le choisit.

Sortie : les 4 coins de l'image (bords extérieurs des pixels) en WGS84, pour les poser sur la carte.
Seuls des nombres transitent : l'image elle-même reste dans le navigateur (session uniquement).
"""
import math
import re

from pyproj import CRS, Transformer

# Systèmes proposés à l'utilisateur (et reconnus par la détection automatique).
SYSTEMES_SUPPORTES = {
    'EPSG:2154': 'RGF93 / Lambert 93',
    'EPSG:4326': 'WGS 84 (degrés)',
    'EPSG:32630': 'WGS 84 / UTM 30 N',
    'EPSG:32631': 'WGS 84 / UTM 31 N',
    'EPSG:32632': 'WGS 84 / UTM 32 N',
    'EPSG:3857': 'WGS 84 / Pseudo-Mercator (Web)',
}
for _zone in range(42, 51):  # Coniques conformes 9 zones (CC42 à CC50)
    SYSTEMES_SUPPORTES[f'EPSG:{3900 + _zone}'] = f'RGF93 / CC{_zone}'

DIMENSION_MAX_PX = 100000
EMPRISE_MAX_M = 20000  # au-delà, ce n'est pas une orthophoto de site : erreur de système ou de fichier


class ErreurGeoref(ValueError):
    """Donnée d'entrée invalide : message destiné à l'utilisateur."""


def lire_fichier_monde(texte):
    """6 nombres du fichier-monde -> dict {A, D, B, E, C, F}. Tolère virgule décimale et lignes vides."""
    if not isinstance(texte, str) or not texte.strip():
        raise ErreurGeoref("Fichier de coordonnées vide.")
    valeurs = []
    for brut in re.split(r'[\s;]+', texte.strip()):
        if not brut:
            continue
        try:
            valeurs.append(float(brut.replace(',', '.')))
        except ValueError:
            raise ErreurGeoref(f"Fichier de coordonnées illisible : « {brut[:20]} » n'est pas un nombre.")
    if len(valeurs) != 6:
        raise ErreurGeoref(f"Fichier de coordonnées invalide : 6 nombres attendus, {len(valeurs)} trouvés.")
    if not all(math.isfinite(v) for v in valeurs):
        raise ErreurGeoref("Fichier de coordonnées invalide : valeur non finie.")
    a, d, b, e, c, f = valeurs
    if abs(a * e - b * d) < 1e-18:
        raise ErreurGeoref("Fichier de coordonnées invalide : taille de pixel nulle.")
    return {'A': a, 'D': d, 'B': b, 'E': e, 'C': c, 'F': f}


def detecter_systeme(monde, prj_texte=None):
    """
    Système des coordonnées du fichier-monde : .prj s'il est fourni et reconnu, sinon déduction par l'ordre
    de grandeur du coin haut-gauche. Retourne (code 'EPSG:xxxx' ou None, origine 'prj' | 'auto' | None).
    """
    if prj_texte and prj_texte.strip():
        try:
            crs = CRS.from_user_input(prj_texte.strip())
            epsg = crs.to_epsg(min_confidence=70)
            if epsg:
                return f'EPSG:{epsg}', 'prj'
        except Exception:
            pass  # .prj non interprétable : on tente la déduction
    x, y = monde['C'], monde['F']
    if -180 <= x <= 180 and -90 <= y <= 90 and abs(monde['A']) < 0.01:
        return 'EPSG:4326', 'auto'
    if 100000 <= x <= 1300000 and 6000000 <= y <= 7200000:
        return 'EPSG:2154', 'auto'
    # UTM : l'abscisse seule ne donne pas la zone ; en France métropolitaine, la zone suit la longitude.
    if 160000 <= x <= 840000 and 4000000 <= y <= 6000000:
        return None, None  # UTM plausible mais zone ambiguë : choix de l'utilisateur
    return None, None


def _coins_pixels(largeur, hauteur):
    # Bords extérieurs : le fichier-monde vise le centre des pixels, d'où le décalage d'un demi-pixel.
    return {
        'haut_gauche': (-0.5, -0.5),
        'haut_droit': (largeur - 0.5, -0.5),
        'bas_droit': (largeur - 0.5, hauteur - 0.5),
        'bas_gauche': (-0.5, hauteur - 0.5),
    }


def georeferencer(fichier_monde, largeur, hauteur, systeme='auto', prj=None):
    """
    Coins WGS84 d'une orthophoto.

    :param fichier_monde: contenu texte du .jgw/.pgw/.tfw/.wld
    :param largeur: largeur de l'image en pixels (image d'origine)
    :param hauteur: hauteur de l'image en pixels
    :param systeme: 'auto' ou un code de SYSTEMES_SUPPORTES
    :param prj: contenu texte du .prj (facultatif)
    :return: dict (systeme, nom_systeme, origine_systeme, coins {nom: {lat, lng}}, taille_pixel_m, largeur_m,
             hauteur_m, rotation_deg)
    """
    try:
        largeur, hauteur = int(largeur), int(hauteur)
    except (TypeError, ValueError):
        raise ErreurGeoref("Dimensions de l'image invalides.")
    if not (1 <= largeur <= DIMENSION_MAX_PX and 1 <= hauteur <= DIMENSION_MAX_PX):
        raise ErreurGeoref(f"Dimensions de l'image hors limites (1 à {DIMENSION_MAX_PX} px).")
    monde = lire_fichier_monde(fichier_monde)

    origine = 'utilisateur'
    if not systeme or systeme == 'auto':
        systeme, origine = detecter_systeme(monde, prj)
        if not systeme:
            raise ErreurGeoref("Système de coordonnées non reconnu : choisissez-le dans la liste "
                               "(ou joignez le fichier .prj livré avec l'orthophoto).")
    if systeme not in SYSTEMES_SUPPORTES:
        raise ErreurGeoref("Système de coordonnées non pris en charge.")

    vers_wgs84 = Transformer.from_crs(systeme, 'EPSG:4326', always_xy=True)
    coins = {}
    for nom, (col, lig) in _coins_pixels(largeur, hauteur).items():
        x = monde['A'] * col + monde['B'] * lig + monde['C']
        y = monde['D'] * col + monde['E'] * lig + monde['F']
        lng, lat = vers_wgs84.transform(x, y)
        if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            raise ErreurGeoref("Coordonnées hors du globe : le système choisi ne correspond pas au fichier.")
        coins[nom] = {'lat': lat, 'lng': lng}

    # Dimensions réelles, mesurées sur l'ellipsoïde entre les coins (indépendant du système source).
    geod = CRS('EPSG:4326').get_geod()

    def distance(p, q):
        return geod.inv(p['lng'], p['lat'], q['lng'], q['lat'])[2]

    largeur_m = distance(coins['haut_gauche'], coins['haut_droit'])
    hauteur_m = distance(coins['haut_gauche'], coins['bas_gauche'])
    if max(largeur_m, hauteur_m) > EMPRISE_MAX_M:
        raise ErreurGeoref(f"Emprise de {max(largeur_m, hauteur_m) / 1000:.1f} km : le système de coordonnées "
                           "choisi ne correspond probablement pas au fichier.")
    azimut = geod.inv(coins['haut_gauche']['lng'], coins['haut_gauche']['lat'],
                      coins['haut_droit']['lng'], coins['haut_droit']['lat'])[0]

    return {
        'systeme': systeme,
        'nom_systeme': SYSTEMES_SUPPORTES[systeme],
        'origine_systeme': origine,
        'coins': coins,
        'taille_pixel_m': largeur_m / largeur,
        'largeur_m': largeur_m,
        'hauteur_m': hauteur_m,
        # 0° = bord haut de l'image orienté plein est (image « nord en haut »).
        'rotation_deg': ((azimut - 90) + 180) % 360 - 180,
    }
