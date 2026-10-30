# -*- coding: utf-8 -*-
"""
Modèle numérique de terrain (MNT) local d'un champ PV — source unique des altitudes pour les plans
2D (façades, coupes), la 3D et les exports.

Principe : on télécharge UNE grille d'altitudes sur l'emprise du champ (+ marge), puis on
l'interpole (bilinéaire) partout où l'on a besoin d'une altitude. Les plans et la 3D lisent donc
exactement les mêmes valeurs.

Sources :
- France : IGN Géoplateforme, RGE ALTI® 1 m (altitudes NGF-IGN69), Licence Ouverte Etalab 2.0.
  Grille : WMS-R, couche ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES, format BIL float32, EPSG:2154.
  Points isolés : API altimétrie elevation.json (sert de référence de contrôle).
- Hors France : Google Elevation, demandé par le NAVIGATEUR (calepinage_maison_terrain.js), jamais
  par le serveur ni mis en cache. Le choix de la source se fait par le PAYS du projet : la couche
  IGN renvoie aussi des altitudes hors de France (0 m partout), on ne peut donc pas détecter
  « hors France » par l'absence de données.

Le module sépare le calcul (fonctions pures, testées hors ligne) des accès réseau (fonctions
`telecharger_*`), utilisées par grille_cache.py (route /api/terrain/grille) et par le script de
prototype scripts/poc_terrain_ign.py.
"""
import math

import numpy as np
from pyproj import Transformer

WMS_R_URL = 'https://data.geopf.fr/wms-r/wms'
COUCHE_RGE_ALTI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES'
ALTI_POINTS_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
RESSOURCE_ALTI = 'ign_rge_alti_wld'
NODATA_IGN = -99999.0
ALTITUDE_MIN, ALTITUDE_MAX = -500.0, 5000.0   # plage plausible pour détecter l'ordre des octets
MAX_PIXELS_COTE = 2048                         # limite prudente d'une requête WMS
MAX_POINTS_ALTI = 5000                         # limite documentée de l'API altimétrie
ATTRIBUTION_IGN = '© IGN – RGE ALTI®'

_VERS_L93 = Transformer.from_crs('EPSG:4326', 'EPSG:2154', always_xy=True)
_DEPUIS_L93 = Transformer.from_crs('EPSG:2154', 'EPSG:4326', always_xy=True)


def vers_lambert93(lat, lng):
    """(lat, lng) WGS84 -> (x, y) Lambert-93 en mètres."""
    return _VERS_L93.transform(lng, lat)


def depuis_lambert93(x, y):
    """(x, y) Lambert-93 -> (lat, lng) WGS84."""
    lng, lat = _DEPUIS_L93.transform(x, y)
    return lat, lng


class GrilleMNT:
    """Grille régulière d'altitudes, alignée sur les axes Lambert-93.

    `z[ligne, colonne]` ; ligne 0 = bord NORD (convention image/WMS). Le pixel (l, c) couvre
    [xmin + c*res, xmin + (c+1)*res] x [ymax - (l+1)*res, ymax - l*res] ; sa valeur est celle
    de son CENTRE. Les cases sans donnée valent NaN.
    """

    def __init__(self, z, xmin, ymax, res, source='ign'):
        self.z = np.asarray(z, dtype=np.float64)
        self.xmin = float(xmin)
        self.ymax = float(ymax)
        self.res = float(res)
        self.source = source

    @property
    def hauteur(self):
        return self.z.shape[0]

    @property
    def largeur(self):
        return self.z.shape[1]

    @property
    def couverture(self):
        """Part des cases ayant une altitude (1.0 = grille complète)."""
        return float(np.isfinite(self.z).mean()) if self.z.size else 0.0

    @property
    def exploitable(self):
        """False si la grille est vide ou uniformément plate. Hors de France, l'IGN renvoie 0 m
        PARTOUT (mesuré à Saragosse, ~200 m réels) au lieu d'une valeur « sans donnée » : une
        grille parfaitement constante est donc traitée comme une absence de donnée."""
        valeurs = self.z[np.isfinite(self.z)]
        return valeurs.size > 0 and float(np.ptp(valeurs)) > 1e-3

    def altitude_l93(self, x, y):
        """Altitude interpolée (bilinéaire entre centres de pixels) ; None hors grille ou sans donnée."""
        c = (x - self.xmin) / self.res - 0.5
        l = (self.ymax - y) / self.res - 0.5
        # Tolérance d'un demi-pixel aux bords : on y prolonge la valeur du pixel de bord.
        if c < -0.5 or l < -0.5 or c > self.largeur - 0.5 or l > self.hauteur - 0.5:
            return None
        c = min(max(c, 0.0), self.largeur - 1.0)
        l = min(max(l, 0.0), self.hauteur - 1.0)
        c0, l0 = int(math.floor(c)), int(math.floor(l))
        c1, l1 = min(c0 + 1, self.largeur - 1), min(l0 + 1, self.hauteur - 1)
        fc, fl = c - c0, l - l0
        v = self.z[[l0, l0, l1, l1], [c0, c1, c0, c1]]
        if not np.all(np.isfinite(v)):
            return None
        haut = v[0] * (1 - fc) + v[1] * fc
        bas = v[2] * (1 - fc) + v[3] * fc
        return float(haut * (1 - fl) + bas * fl)

    def altitude(self, lat, lng):
        return self.altitude_l93(*vers_lambert93(lat, lng))

    def profil(self, a, b, pas=1.0):
        """Profil le long du segment a -> b ((lat, lng) chacun).

        Retourne [{'s': abscisse en m depuis a, 'lat', 'lng', 'z'}] ; z = None si hors donnée.
        """
        xa, ya = vers_lambert93(*a)
        xb, yb = vers_lambert93(*b)
        longueur = math.hypot(xb - xa, yb - ya)
        # Tolérance : l'aller-retour WGS84 <-> L93 donne 50.0000001 m pour 50 m.
        n = max(1, int(math.ceil(longueur / pas - 1e-6)))
        points = []
        for i in range(n + 1):
            t = i / n
            x, y = xa + (xb - xa) * t, ya + (yb - ya) * t
            lat, lng = depuis_lambert93(x, y)
            points.append({'s': longueur * t, 'lat': lat, 'lng': lng, 'z': self.altitude_l93(x, y)})
        return points


def emprise_l93(points_latlng, marge_m=30.0, res=1.0, calage_m=None):
    """Emprise Lambert-93 (xmin, ymin, xmax, ymax) couvrant les points + marge, et dimensions en
    pixels (largeur, hauteur).

    Calage : les CENTRES de pixels tombent sur les multiples de `res` (bords à k*res - res/2),
    c'est-à-dire sur les nœuds natifs du RGE ALTI. Ainsi le WMS renvoie les valeurs natives sans
    rééchantillonner. Mesuré au prototype : aux nœuds, grille = API altimétrie (écart médian 3 mm) ;
    avec des bords sur les mètres entiers, le rééchantillonnage WMS ajoutait ~10 cm en pente.
    `calage_m` (multiple de `res`) arrondit l'emprise vers l'extérieur par carreaux : deux tracés
    voisins retombent sur la même emprise, donc sur la même entrée du cache.
    """
    xy = [vers_lambert93(lat, lng) for lat, lng in points_latlng]
    xs, ys = [p[0] for p in xy], [p[1] for p in xy]
    pas = calage_m or res
    demi = res / 2
    xmin = math.floor((min(xs) - marge_m) / pas) * pas - demi
    ymin = math.floor((min(ys) - marge_m) / pas) * pas - demi
    xmax = math.ceil((max(xs) + marge_m) / pas) * pas + demi
    ymax = math.ceil((max(ys) + marge_m) / pas) * pas + demi
    largeur, hauteur = int(round((xmax - xmin) / res)), int(round((ymax - ymin) / res))
    if largeur > MAX_PIXELS_COTE or hauteur > MAX_PIXELS_COTE:
        raise ValueError(f'Emprise trop grande ({largeur}x{hauteur} px) : découper la requête.')
    return (xmin, ymin, xmax, ymax), largeur, hauteur


def decoder_bil_float32(octets, largeur, hauteur, nodata=NODATA_IGN):
    """Décode un BIL float32 brut en tableau (hauteur, largeur), NaN pour les cases sans donnée.

    L'ordre des octets n'étant pas garanti par le service, on retient celui qui donne le plus de
    valeurs plausibles.
    """
    attendu = largeur * hauteur * 4
    if len(octets) != attendu:
        raise ValueError(f'BIL de {len(octets)} octets, {attendu} attendus '
                         '(réponse d\'erreur XML au lieu de la grille ?)')
    meilleur, score_max = None, -1
    for ordre in ('<f4', '>f4'):
        with np.errstate(invalid='ignore', over='ignore'):   # le mauvais ordre donne des valeurs absurdes
            z = np.frombuffer(octets, dtype=ordre).astype(np.float64).reshape(hauteur, largeur)
            z[np.isclose(z, nodata) | ~np.isfinite(z)] = np.nan
            score = int(np.sum((z >= ALTITUDE_MIN) & (z <= ALTITUDE_MAX)))
        if score > score_max:
            meilleur, score_max = z, score
    with np.errstate(invalid='ignore'):
        meilleur[(meilleur < ALTITUDE_MIN) | (meilleur > ALTITUDE_MAX)] = np.nan
    return meilleur


def parametres_wms_grille(emprise, largeur, hauteur):
    xmin, ymin, xmax, ymax = emprise
    return {
        'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
        'LAYERS': COUCHE_RGE_ALTI, 'STYLES': '',
        'FORMAT': 'image/x-bil;bits=32', 'CRS': 'EPSG:2154',
        # EPSG:2154 en WMS 1.3.0 : ordre des axes est, nord.
        'BBOX': f'{xmin},{ymin},{xmax},{ymax}',
        'WIDTH': str(largeur), 'HEIGHT': str(hauteur),
    }


# --------------------------------------------------------------------------- accès réseau

def _get(url, params):
    """GET -> octets. urllib (et non requests) : sous Windows il s'appuie sur le magasin de
    certificats du système, requests sur le sien (certifi) — qui rejette les postes dont un
    antivirus/proxy inspecte le HTTPS."""
    import urllib.parse
    import urllib.request
    req = urllib.request.Request(f'{url}?{urllib.parse.urlencode(params)}',
                                 headers={'User-Agent': 'PV_project/terrain-mnt'})
    with urllib.request.urlopen(req, timeout=30) as rep:
        return rep.read()


def telecharger_grille_ign(points_latlng, marge_m=30.0, res=1.0):
    """Grille RGE ALTI couvrant les points (+ marge). Une seule requête WMS-R."""
    emprise, largeur, hauteur = emprise_l93(points_latlng, marge_m, res)
    return telecharger_grille_ign_emprise(emprise, largeur, hauteur, res)


def telecharger_grille_ign_emprise(emprise, largeur, hauteur, res):
    """Grille RGE ALTI sur une emprise déjà calculée (cf. emprise_l93)."""
    octets = _get(WMS_R_URL, parametres_wms_grille(emprise, largeur, hauteur))
    z = decoder_bil_float32(octets, largeur, hauteur)
    return GrilleMNT(z, emprise[0], emprise[3], res, source='ign')


def altitudes_points_ign(points_latlng):
    """Altitudes IGN de points isolés (API altimétrie), None pour les points sans donnée."""
    import json
    resultat = []
    for i in range(0, len(points_latlng), 150):   # lots courts : l'API est en GET
        lot = points_latlng[i:i + 150]
        rep = json.loads(_get(ALTI_POINTS_URL, {
            'lon': '|'.join(f'{lng:.8f}' for _, lng in lot),
            'lat': '|'.join(f'{lat:.8f}' for lat, _ in lot),
            'resource': RESSOURCE_ALTI, 'delimiter': '|', 'zonly': 'true',
        }))
        for z in rep['elevations']:
            z = z['z'] if isinstance(z, dict) else z
            resultat.append(None if z is None or z <= NODATA_IGN + 1 else float(z))
    return resultat
