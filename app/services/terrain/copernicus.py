# -*- coding: utf-8 -*-
"""
Terrain hors France : Copernicus DEM GLO-30 (ESA / Airbus, résolution 1 seconde d'arc ≈ 30 m),
lu directement dans les GeoTIFF « cloud optimized » publics du registre AWS Open Data
(s3://copernicus-dem-30m, sans clé ni compte).

Licence : utilisation, y compris commerciale, et conservation libres, sous réserve de la mention
ATTRIBUTION_COPERNICUS. Les blocs téléchargés sont donc gardés sur disque (instance/cache_mnt/
copernicus/), ce que les conditions Google interdisent.

LIMITES À CONNAÎTRE
- C'est un modèle de SURFACE (MNS) : en ville ou en forêt, bâtiments et arbres y sont en partie
  inclus. Sur un terrain dégagé (cas d'un champ PV), il suit le sol.
- Pas de 30 m : la grille interpolée donne la pente générale, pas un talus ou un fossé.
- Altitudes au-dessus du géoïde EGM2008 (et non NGF) ; précision absolue annoncée < 4 m (90 %).

Lecture : on ne télécharge que les octets utiles (requêtes HTTP Range). En-tête TIFF + tables des
blocs, puis les seuls blocs (≈ 1024 x 1024 px) qui recouvrent l'emprise, décompressés ici (zlib +
prédicteur TIFF) : aucune dépendance au-delà de numpy.

Repère de la grille servie : géographique (EPSG:4326), pixels natifs du MNT, sans
rééchantillonnage. `xmin`/`ymax` = bords ouest/nord, `res_x`/`res_y` en degrés.
"""
import json
import math
import os
import struct
import tempfile
import zlib
from urllib.error import HTTPError

import numpy as np

URL_BASE = 'https://copernicus-dem-30m.s3.amazonaws.com'
ATTRIBUTION_COPERNICUS = ('Copernicus DEM GLO-30 © DLR e.V. 2010-2014 et © Airbus Defence and Space '
                          'GmbH 2014-2018, fourni dans le cadre de COPERNICUS par l\'Union européenne '
                          'et l\'ESA ; tous droits réservés')
M_PAR_DEGRE = 111320.0          # même convention que calepinage_maison_terrain.js
MAX_PIXELS_COTE = 400           # ≈ 12 km à l'équateur : très au-delà d'un champ PV
ALTITUDE_MIN, ALTITUDE_MAX = -500.0, 9000.0
OCTETS_EN_TETE = 65536

# Balises TIFF utiles.
T_LARGEUR, T_HAUTEUR, T_BITS, T_COMPRESSION = 256, 257, 258, 259
T_STRIP_OFFSETS, T_ROWS_PER_STRIP, T_STRIP_COUNTS = 273, 278, 279
T_PLANAR, T_PREDICTEUR = 284, 317
T_TILE_L, T_TILE_H, T_TILE_OFFSETS, T_TILE_COUNTS = 322, 323, 324, 325
T_FORMAT_ECHANTILLON = 339
T_PIXEL_SCALE, T_TIEPOINT, T_GEOKEYS, T_GDAL_NODATA = 33550, 33922, 34735, 42113
GEOKEY_RASTER_TYPE, PIXEL_IS_POINT = 1025, 2

# type TIFF -> (format struct, taille)
TYPES = {1: ('B', 1), 2: ('c', 1), 3: ('H', 2), 4: ('I', 4), 5: ('II', 8), 6: ('b', 1), 7: ('B', 1),
         8: ('h', 2), 9: ('i', 4), 10: ('ii', 8), 11: ('f', 4), 12: ('d', 8), 16: ('Q', 8), 17: ('q', 8), 18: ('Q', 8)}


class ErreurCopernicus(Exception):
    """Fichier inattendu (format non géré) ou réponse réseau incohérente."""


# --------------------------------------------------------------------------- nom des tuiles

def nom_tuile(lat_sud, lng_ouest):
    """Tuile 1° x 1° dont le coin sud-ouest est (lat_sud, lng_ouest), entiers."""
    ns = 'N' if lat_sud >= 0 else 'S'
    eo = 'E' if lng_ouest >= 0 else 'W'
    return f'Copernicus_DSM_COG_10_{ns}{abs(lat_sud):02d}_00_{eo}{abs(lng_ouest):03d}_00_DEM'


def url_tuile(nom):
    return f'{URL_BASE}/{nom}/{nom}.tif'


# --------------------------------------------------------------------------- lecture TIFF

def _decoder_valeurs(octets, ordre, typ, n):
    fmt, taille = TYPES[typ]
    if typ == 2:
        return octets[:n].split(b'\0', 1)[0].decode('ascii', 'replace')
    if typ in (5, 10):
        brut = struct.unpack(f'{ordre}{2 * n}{"I" if typ == 5 else "i"}', octets[:8 * n])
        return [brut[i] / brut[i + 1] if brut[i + 1] else 0.0 for i in range(0, 2 * n, 2)]
    return list(struct.unpack(f'{ordre}{n}{fmt}', octets[:taille * n]))


def lire_ifd(lire):
    """Première IFD (pleine résolution) d'un TIFF / BigTIFF. `lire(offset, n)` -> octets.
    -> dict {balise: valeur(s)} + '_ordre'."""
    en_tete = lire(0, 16)
    ordre = {b'II': '<', b'MM': '>'}.get(en_tete[:2])
    if ordre is None:
        raise ErreurCopernicus('Pas un fichier TIFF.')
    version = struct.unpack(ordre + 'H', en_tete[2:4])[0]
    if version == 42:
        big, offset_ifd = False, struct.unpack(ordre + 'I', en_tete[4:8])[0]
    elif version == 43:
        big, offset_ifd = True, struct.unpack(ordre + 'Q', en_tete[8:16])[0]
    else:
        raise ErreurCopernicus(f'Version TIFF inconnue : {version}.')
    t_compte, t_entree, t_val = (8, 20, 8) if big else (2, 12, 4)
    nb = struct.unpack(ordre + ('Q' if big else 'H'), lire(offset_ifd, t_compte))[0]
    brut = lire(offset_ifd + t_compte, nb * t_entree)
    tags = {'_ordre': ordre}
    for i in range(nb):
        e = brut[i * t_entree:(i + 1) * t_entree]
        balise, typ = struct.unpack(ordre + 'HH', e[:4])
        if typ not in TYPES:
            continue
        n = struct.unpack(ordre + ('Q' if big else 'I'), e[4:4 + (t_compte if big else 4)])[0]
        taille = TYPES[typ][1] * n
        champ = e[t_entree - t_val:]
        if taille <= t_val:
            donnees = champ
        else:
            donnees = lire(struct.unpack(ordre + ('Q' if big else 'I'), champ)[0], taille)
        tags[balise] = _decoder_valeurs(donnees, ordre, typ, n)
    return tags


def _un(tags, balise, defaut=None):
    v = tags.get(balise, defaut)
    return v[0] if isinstance(v, list) else v


def metadonnees(tags):
    """Géométrie et organisation des blocs d'une tuile, à partir de ses balises TIFF."""
    if _un(tags, T_BITS) != 32 or _un(tags, T_FORMAT_ECHANTILLON, 1) != 3:
        raise ErreurCopernicus('MNT attendu en float32.')
    if _un(tags, T_PLANAR, 1) != 1:
        raise ErreurCopernicus('Organisation planaire non gérée.')
    compression = _un(tags, T_COMPRESSION, 1)
    if compression not in (1, 8, 32946):
        raise ErreurCopernicus(f'Compression TIFF non gérée : {compression}.')
    largeur, hauteur = _un(tags, T_LARGEUR), _un(tags, T_HAUTEUR)
    if T_TILE_OFFSETS in tags:
        bl, bh = _un(tags, T_TILE_L), _un(tags, T_TILE_H)
        offsets, comptes = tags[T_TILE_OFFSETS], tags[T_TILE_COUNTS]
    else:   # bandes = blocs de toute la largeur
        bl, bh = largeur, min(_un(tags, T_ROWS_PER_STRIP, hauteur), hauteur)
        offsets, comptes = tags[T_STRIP_OFFSETS], tags[T_STRIP_COUNTS]
    echelle, tie = tags.get(T_PIXEL_SCALE), tags.get(T_TIEPOINT)
    if not echelle or not tie:
        raise ErreurCopernicus('Géoréférencement absent.')
    res_x, res_y = echelle[0], echelle[1]
    # Tiepoint : le point raster (i, j) correspond à (x, y). PixelIsArea -> coin du pixel ;
    # PixelIsPoint -> centre du pixel. On ramène au CENTRE du pixel (0, 0).
    i, j, x, y = tie[0], tie[1], tie[3], tie[4]
    cles = tags.get(T_GEOKEYS) or []
    point = any(cles[k] == GEOKEY_RASTER_TYPE and cles[k + 3] == PIXEL_IS_POINT
                for k in range(4, len(cles) - 3, 4))
    decalage = 0.0 if point else 0.5
    nodata = tags.get(T_GDAL_NODATA)
    try:
        nodata = float(nodata) if nodata not in (None, '') else None
    except ValueError:
        nodata = None
    return {
        'largeur': largeur, 'hauteur': hauteur, 'bloc_l': bl, 'bloc_h': bh,
        'blocs_par_ligne': math.ceil(largeur / bl),
        'offsets': list(offsets), 'comptes': list(comptes),
        'compression': compression, 'predicteur': _un(tags, T_PREDICTEUR, 1),
        'ordre': tags['_ordre'],
        'res_x': res_x, 'res_y': res_y,
        'lng0': x + (decalage - i) * res_x,   # centre du pixel (0, 0)
        'lat0': y - (decalage - j) * res_y,
        'nodata': nodata,
    }


def decoder_bloc(octets, meta):
    """Bloc compressé -> tableau float64 (bloc_h, bloc_l), NaN pour les cases sans donnée."""
    bl, bh, ordre = meta['bloc_l'], meta['bloc_h'], meta['ordre']
    if meta['compression'] in (8, 32946):
        octets = zlib.decompress(octets)
    attendu = bl * bh * 4
    if len(octets) < attendu:   # dernière bande éventuellement plus courte
        octets = octets + b'\0' * (attendu - len(octets))
    brut = np.frombuffer(octets[:attendu], dtype=np.uint8)
    pred = meta['predicteur']
    if pred == 3:
        # Prédicteur flottant : par ligne, différences d'octets, puis octets rangés par plans de
        # poids (le plus fort en premier, quel que soit l'ordre du fichier).
        lignes = np.cumsum(brut.reshape(bh, bl * 4), axis=1, dtype=np.uint8)
        z = lignes.reshape(bh, 4, bl).transpose(0, 2, 1).copy().view('>f4').reshape(bh, bl)
    elif pred == 2:
        z = np.frombuffer(brut.tobytes(), dtype=ordre + 'u4').reshape(bh, bl).astype(np.uint32)
        z = np.cumsum(z, axis=1, dtype=np.uint32).view(np.float32)
    elif pred == 1:
        z = np.frombuffer(brut.tobytes(), dtype=ordre + 'f4').reshape(bh, bl)
    else:
        raise ErreurCopernicus(f'Prédicteur TIFF non géré : {pred}.')
    z = z.astype(np.float64)
    if meta['nodata'] is not None:
        z[z == meta['nodata']] = np.nan
    with np.errstate(invalid='ignore'):
        z[~np.isfinite(z) | (z < ALTITUDE_MIN) | (z > ALTITUDE_MAX)] = np.nan
    return z


# --------------------------------------------------------------------------- source avec cache

def _ecrire_atomique(chemin, octets):
    dossier = os.path.dirname(chemin)
    fd, tmp = tempfile.mkstemp(dir=dossier, suffix='.tmp')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(octets)
        os.replace(tmp, chemin)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def lire_plage_http(url, debut, n):
    """GET Range -> octets ; None si la tuile n'existe pas (mer, hors couverture).
    urllib (et non requests) : cf. mnt._get (magasin de certificats Windows)."""
    import urllib.request
    req = urllib.request.Request(url, headers={'User-Agent': 'PV_project/terrain-mnt',
                                               'Range': f'bytes={debut}-{debut + n - 1}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as rep:
            octets = rep.read()
            if rep.status == 200 and debut:   # serveur ignorant Range : on découpe nous-mêmes
                octets = octets[debut:debut + n]
            return octets[:n]
    except HTTPError as e:
        if e.code == 404:
            return None
        raise


class SourceCopernicus:
    """Accès aux tuiles avec cache disque : `<dossier>/<tuile>/meta.json` et `b<index>.bin`
    (bloc compressé tel que téléchargé), `<dossier>/<tuile>.absente` pour les tuiles de mer."""

    def __init__(self, dossier_cache, lire_plage=lire_plage_http):
        self.dossier = dossier_cache
        self.lire_plage = lire_plage
        self._metas = {}
        self.telechargements = 0

    def meta(self, nom):
        if nom in self._metas:
            return self._metas[nom]
        dossier = os.path.join(self.dossier, nom)
        chemin = os.path.join(dossier, 'meta.json')
        if os.path.exists(os.path.join(self.dossier, nom + '.absente')):
            meta = None
        elif os.path.exists(chemin):
            with open(chemin, encoding='utf-8') as f:
                meta = json.load(f)
        else:
            meta = self._telecharger_meta(nom)
            os.makedirs(self.dossier, exist_ok=True)
            if meta is None:
                _ecrire_atomique(os.path.join(self.dossier, nom + '.absente'), b'')
            else:
                os.makedirs(dossier, exist_ok=True)
                _ecrire_atomique(chemin, json.dumps(meta).encode('utf-8'))
        self._metas[nom] = meta
        return meta

    def _telecharger_meta(self, nom):
        url = url_tuile(nom)
        tampon = self.lire_plage(url, 0, OCTETS_EN_TETE)
        self.telechargements += 1
        if tampon is None:
            return None

        def lire(offset, n):
            if offset + n <= len(tampon):
                return tampon[offset:offset + n]
            self.telechargements += 1
            octets = self.lire_plage(url, offset, n)
            if octets is None or len(octets) < n:
                raise ErreurCopernicus('En-tête TIFF tronqué.')
            return octets
        return metadonnees(lire_ifd(lire))

    def bloc(self, nom, index):
        meta = self.meta(nom)
        chemin = os.path.join(self.dossier, nom, f'b{index}.bin')
        if os.path.exists(chemin):
            with open(chemin, 'rb') as f:
                octets = f.read()
        else:
            n = meta['comptes'][index]
            if n == 0:   # bloc vide (autorisé par le format) : sans donnée
                return np.full((meta['bloc_h'], meta['bloc_l']), np.nan)
            octets = self.lire_plage(url_tuile(nom), meta['offsets'][index], n)
            self.telechargements += 1
            if octets is None or len(octets) != n:
                raise ErreurCopernicus('Bloc TIFF incomplet.')
            _ecrire_atomique(chemin, octets)
        return decoder_bloc(octets, meta)


# --------------------------------------------------------------------------- grille

class GrilleGeo:
    """Grille d'altitudes en lat/lng (EPSG:4326). z[ligne, colonne], ligne 0 = bord NORD ; valeur
    au CENTRE du pixel ; NaN = sans donnée. Miroir de calepinage_maison_terrain.js::GrilleMNT
    (mode géographique)."""

    crs = 'EPSG:4326'

    def __init__(self, z, xmin, ymax, res_x, res_y, source='copernicus', attribution=ATTRIBUTION_COPERNICUS):
        self.z = np.asarray(z, dtype=np.float64)
        self.xmin, self.ymax = float(xmin), float(ymax)
        self.res_x, self.res_y = float(res_x), float(res_y)
        self.source = source
        self.attribution = attribution

    @property
    def hauteur(self):
        return self.z.shape[0]

    @property
    def largeur(self):
        return self.z.shape[1]

    @property
    def couverture(self):
        return float(np.isfinite(self.z).mean()) if self.z.size else 0.0

    @property
    def exploitable(self):
        valeurs = self.z[np.isfinite(self.z)]
        return valeurs.size > 0 and float(np.ptp(valeurs)) > 1e-3

    def altitude(self, lat, lng):
        """Interpolation bilinéaire entre centres de pixels ; None hors grille ou sans donnée."""
        c = (lng - self.xmin) / self.res_x - 0.5
        l = (self.ymax - lat) / self.res_y - 0.5
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
        return float((v[0] * (1 - fc) + v[1] * fc) * (1 - fl) + (v[2] * (1 - fc) + v[3] * fc) * fl)


def emprise_geo(points_latlng, marge_m):
    """(lat_min, lng_min, lat_max, lng_max) couvrant les points + marge (en degrés)."""
    lats = [p[0] for p in points_latlng]
    lngs = [p[1] for p in points_latlng]
    lat_c = (min(lats) + max(lats)) / 2
    d_lat = marge_m / M_PAR_DEGRE
    d_lng = marge_m / (M_PAR_DEGRE * max(math.cos(math.radians(lat_c)), 0.01))
    return min(lats) - d_lat, min(lngs) - d_lng, max(lats) + d_lat, max(lngs) + d_lng


def grille_copernicus(points_latlng, marge_m, source):
    """GrilleGeo couvrant les points (+ marge, + 1 pixel pour l'interpolation), aux pixels natifs
    du MNT. Peut chevaucher plusieurs tuiles. Lève ValueError si l'emprise est trop grande ;
    renvoie une grille entièrement NaN si aucune tuile n'existe (mer)."""
    lat_min, lng_min, lat_max, lng_max = emprise_geo(points_latlng, marge_m)
    lat_c, lng_c = (lat_min + lat_max) / 2, (lng_min + lng_max) / 2

    # Le réseau de pixels est celui de la tuile qui contient le centre (une tuile de mer :
    # n'importe quelle tuile voisine existante).
    candidats = [(math.floor(lat_c), math.floor(lng_c))] + [
        (la, lo) for la in range(math.floor(lat_min), math.floor(lat_max) + 1)
        for lo in range(math.floor(lng_min), math.floor(lng_max) + 1)]
    ref = next((source.meta(nom_tuile(*t)) for t in candidats if source.meta(nom_tuile(*t))), None)
    if ref is None:
        return GrilleGeo(np.full((2, 2), np.nan), lng_min, lat_max, 1 / 3600, 1 / 3600)
    rx, ry = ref['res_x'], ref['res_y']
    c0 = math.floor((lng_min - ref['lng0']) / rx) - 1
    c1 = math.ceil((lng_max - ref['lng0']) / rx) + 1
    l0 = math.floor((ref['lat0'] - lat_max) / ry) - 1
    l1 = math.ceil((ref['lat0'] - lat_min) / ry) + 1
    largeur, hauteur = c1 - c0 + 1, l1 - l0 + 1
    if largeur > MAX_PIXELS_COTE or hauteur > MAX_PIXELS_COTE:
        raise ValueError(f'Emprise trop grande ({largeur}x{hauteur} px).')
    lngs = ref['lng0'] + np.arange(c0, c1 + 1) * rx           # centres des colonnes
    lats = ref['lat0'] - np.arange(l0, l1 + 1) * ry           # centres des lignes (nord -> sud)
    z = np.full((hauteur, largeur), np.nan)

    tuiles = {(la, lo) for la in range(math.floor(lats[-1]) - 1, math.floor(lats[0]) + 1)
              for lo in range(math.floor(lngs[0]) - 1, math.floor(lngs[-1]) + 1)}
    for la, lo in sorted(tuiles):
        nom = nom_tuile(la, lo)
        meta = source.meta(nom)
        if meta is None:
            continue
        # Pixel de la tuile le plus proche de chaque centre cible (identique s'ils partagent le réseau).
        cols = np.rint((lngs - meta['lng0']) / meta['res_x']).astype(int)
        rows = np.rint((meta['lat0'] - lats) / meta['res_y']).astype(int)
        ok_c = (cols >= 0) & (cols < meta['largeur'])
        ok_l = (rows >= 0) & (rows < meta['hauteur'])
        if not ok_c.any() or not ok_l.any():
            continue
        il = np.nonzero(ok_l)[0]
        ic = np.nonzero(ok_c)[0]
        R, C = rows[il][:, None], cols[ic][None, :]
        index = (R // meta['bloc_h']) * meta['blocs_par_ligne'] + C // meta['bloc_l']
        vide = ~np.isfinite(z[np.ix_(il, ic)])
        for b in np.unique(index[vide]):
            bloc = source.bloc(nom, int(b))
            masque = vide & (index == b)
            ll, cc = np.nonzero(masque)
            z[il[ll], ic[cc]] = bloc[R[ll, 0] % meta['bloc_h'], C[0, cc] % meta['bloc_l']]
    return GrilleGeo(z, lngs[0] - rx / 2, lats[0] + ry / 2, rx, ry)
