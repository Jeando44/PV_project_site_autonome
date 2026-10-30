# -*- coding: utf-8 -*-
"""
Grilles MNT IGN servies au navigateur, avec cache disque.

- Une emprise (arrondie par carreaux de CALAGE_M) = un fichier `instance/cache_mnt/<clé>.npy`
  (float32). Les données IGN sont sous Licence Ouverte : leur conservation est permise.
  Les altitudes Google (hors France) ne passent JAMAIS par ici : leurs conditions en limitent
  le stockage, le navigateur les demande lui-même et ne les garde qu'en mémoire.
- Hors France : Copernicus DEM GLO-30 (copernicus.py), licence libre qui en permet la
  conservation : blocs du MNT gardés dans `cache_mnt/copernicus/`, grille servie en lat/lng.
- Écriture atomique (fichier temporaire + os.replace) : plusieurs processus gunicorn peuvent
  écrire la même clé en même temps sans produire de fichier tronqué.
- Transport : centimètres entiers sur 16 bits au-dessus du minimum de la grille (précision 1 cm,
  deux fois plus léger que du float32) ; repli float32 si le dénivelé dépasse 655 m.
"""
import base64
import hashlib
import os
import tempfile

import numpy as np

from app.services.terrain.copernicus import SourceCopernicus, grille_copernicus
from app.services.terrain.mnt import (
    ATTRIBUTION_IGN, COUCHE_RGE_ALTI, GrilleMNT, emprise_l93, telecharger_grille_ign_emprise,
)

CALAGE_M = 25.0
MAX_FICHIERS_CACHE = 500
# Domaine d'emploi de Lambert-93 (EPSG:2154) : France métropolitaine et Corse. Les DROM relèvent
# d'autres projections : ils partent sur le repli Google, comme l'étranger.
DOMAINE_L93 = {'lat_min': 41.15, 'lat_max': 51.56, 'lng_min': -9.86, 'lng_max': 10.38}
NODATA_U16 = 65535


class ErreurTerrain(Exception):
    """Erreur métier : `code` est relu par le navigateur pour choisir un repli."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def dans_domaine_ign(points_latlng):
    d = DOMAINE_L93
    return all(d['lat_min'] <= lat <= d['lat_max'] and d['lng_min'] <= lng <= d['lng_max']
               for lat, lng in points_latlng)


def resolution_adaptee(points_latlng, marge_m):
    """1 m tant que la grille reste raisonnable (≤ 1 km de côté), puis 2 m, puis 5 m.
    Les centres de pixels restent sur des nœuds natifs du RGE ALTI (multiples de la résolution)."""
    for res in (1.0, 2.0, 5.0):
        try:
            _, largeur, hauteur = emprise_l93(points_latlng, marge_m, res, calage_m=CALAGE_M)
        except ValueError:
            continue
        if max(largeur, hauteur) <= 1000:
            return res
    raise ErreurTerrain('emprise_trop_grande', 'Emprise trop grande pour une grille de terrain (> 5 km).')


def _cle(emprise, res):
    brut = f'{COUCHE_RGE_ALTI}|{res}|' + '|'.join(f'{v:.1f}' for v in emprise)
    return hashlib.sha1(brut.encode('ascii')).hexdigest()[:24]


def _elaguer(dossier):
    fichiers = [os.path.join(dossier, f) for f in os.listdir(dossier) if f.endswith('.npy')]
    if len(fichiers) <= MAX_FICHIERS_CACHE:
        return
    fichiers.sort(key=os.path.getmtime)
    for f in fichiers[:len(fichiers) - MAX_FICHIERS_CACHE + MAX_FICHIERS_CACHE // 5]:
        try:
            os.remove(f)
        except OSError:
            pass


def grille_pour_points(points_latlng, marge_m, dossier_cache, telecharger=telecharger_grille_ign_emprise):
    """GrilleMNT IGN couvrant les points (+ marge), depuis le cache ou l'IGN.

    Retourne (grille, depuis_cache). Lève ErreurTerrain('hors_domaine_ign' | 'emprise_trop_grande'
    | 'donnees_absentes').
    """
    if not dans_domaine_ign(points_latlng):
        raise ErreurTerrain('hors_domaine_ign', 'Hors du domaine couvert par le RGE ALTI (métropole et Corse).')
    res = resolution_adaptee(points_latlng, marge_m)
    emprise, largeur, hauteur = emprise_l93(points_latlng, marge_m, res, calage_m=CALAGE_M)
    os.makedirs(dossier_cache, exist_ok=True)
    chemin = os.path.join(dossier_cache, _cle(emprise, res) + '.npy')

    z, depuis_cache = None, False
    if os.path.exists(chemin):
        try:
            z = np.load(chemin, allow_pickle=False)
            depuis_cache = z.shape == (hauteur, largeur)
            os.utime(chemin)   # « récemment utilisé » pour l'élagage
        except (OSError, ValueError):
            z = None
    if not depuis_cache:
        z = telecharger(emprise, largeur, hauteur, res).z.astype(np.float32)

    grille = GrilleMNT(z, emprise[0], emprise[3], res, source='ign')
    if not grille.exploitable:
        # Grille vide ou uniformément plate (l'IGN rend 0 m hors de sa couverture) : jamais en cache.
        raise ErreurTerrain('donnees_absentes', 'Aucune altitude exploitable sur cette emprise.')
    if not depuis_cache:
        fd, tmp = tempfile.mkstemp(dir=dossier_cache, suffix='.tmp')
        try:
            with os.fdopen(fd, 'wb') as f:
                np.save(f, z.astype(np.float32), allow_pickle=False)
            os.replace(tmp, chemin)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        _elaguer(dossier_cache)
    return grille, depuis_cache


def grille_copernicus_pour_points(points_latlng, marge_m, dossier_cache, lire_plage=None):
    """GrilleGeo Copernicus couvrant les points (+ marge). Lève ErreurTerrain('emprise_trop_grande'
    | 'donnees_absentes')."""
    dossier = os.path.join(dossier_cache, 'copernicus')
    source = SourceCopernicus(dossier, lire_plage) if lire_plage else SourceCopernicus(dossier)
    try:
        grille = grille_copernicus(points_latlng, marge_m, source)
    except ValueError as e:
        raise ErreurTerrain('emprise_trop_grande', str(e)) from e
    if not grille.exploitable:
        raise ErreurTerrain('donnees_absentes', 'Aucune altitude exploitable sur cette emprise (hors France).')
    return grille, source.telechargements == 0


def encoder_grille(grille):
    """Grille -> dictionnaire JSON pour le navigateur (cf. calepinage_maison_terrain.js::decoderGrille).
    GrilleMNT (IGN, Lambert-93, `res` en m) ou GrilleGeo (Copernicus, lat/lng, `res_x`/`res_y` en °)."""
    z = grille.z
    valides = np.isfinite(z)
    zmin = float(np.min(z[valides]))
    zmax = float(np.max(z[valides]))
    if (zmax - zmin) * 100 < NODATA_U16:
        cm = np.full(z.shape, NODATA_U16, dtype='<u2')
        cm[valides] = np.round((z[valides] - zmin) * 100).astype('<u2')
        encodage, octets = 'u16cm', cm.tobytes()
    else:
        encodage, octets = 'f32', z.astype('<f4').tobytes()
    if getattr(grille, 'crs', 'EPSG:2154') == 'EPSG:4326':
        geometrie = {'source': grille.source, 'crs': 'EPSG:4326', 'attribution': grille.attribution,
                     'res_x': grille.res_x, 'res_y': grille.res_y}
    else:
        geometrie = {'source': 'ign', 'crs': 'EPSG:2154', 'attribution': ATTRIBUTION_IGN, 'res': grille.res}
    return {
        **geometrie,
        'xmin': grille.xmin, 'ymax': grille.ymax,
        'largeur': grille.largeur, 'hauteur': grille.hauteur,
        'zmin': zmin, 'zmax': zmax,
        'encodage': encodage,
        'donnees': base64.b64encode(octets).decode('ascii'),
    }
