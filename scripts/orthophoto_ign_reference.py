# -*- coding: utf-8 -*-
"""
Fabrique une orthophoto de REFERENCE, parfaitement georeferencee, a partir des tuiles aeriennes IGN
(data.geopf.fr, service public Geoplateforme - le meme fond que celui propose dans l'application).

Sortie : image.jpg + image.jgw (+ image.prj), en Web Mercator (EPSG:3857), directement importable dans
l'application (bouton « Importer une orthophoto drone ») ou dans un SIG.

Utilisation :
    python scripts/orthophoto_ign_reference.py --lat 48.04434 --lng -1.60504 --taille 160
"""
import argparse
import io
import math
import os
import sys
import urllib.request

from PIL import Image

GABARIT = ('https://data.geopf.fr/wmts?LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&SERVICE=WMTS'
           '&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}')
TUILE = 256
R = 6378137.0
PRJ_3857 = ('PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
            'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],'
            'PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],'
            'PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","3857"]]')


def vers_mercator(lat, lng):
    return R * math.radians(lng), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def resolution(zoom):
    return 2 * math.pi * R / (TUILE * 2 ** zoom)


def telecharger(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'PV_project/orthophoto-reference'})
    with urllib.request.urlopen(req, timeout=30) as rep:
        return Image.open(io.BytesIO(rep.read())).convert('RGB')


def construire(lat, lng, taille_m, zoom, sortie):
    res = resolution(zoom)
    cx, cy = vers_mercator(lat, lng)
    demi = taille_m / 2
    # Coins de la zone voulue, en pixels globaux de la pyramide
    origine = -math.pi * R
    px_min, px_max = (cx - demi - origine) / res, (cx + demi - origine) / res
    py_min, py_max = (-(cy + demi) - origine) / res, (-(cy - demi) - origine) / res
    tx0, tx1 = int(px_min // TUILE), int(px_max // TUILE)
    ty0, ty1 = int(py_min // TUILE), int(py_max // TUILE)
    nb = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    print(f'Zoom {zoom} ({res:.3f} m/pixel) — {nb} tuiles a telecharger…')
    mosaique = Image.new('RGB', ((tx1 - tx0 + 1) * TUILE, (ty1 - ty0 + 1) * TUILE))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            mosaique.paste(telecharger(GABARIT.format(z=zoom, x=tx, y=ty)), ((tx - tx0) * TUILE, (ty - ty0) * TUILE))
    gauche, haut = round(px_min - tx0 * TUILE), round(py_min - ty0 * TUILE)
    largeur, hauteur = round(px_max - px_min), round(py_max - py_min)
    image = mosaique.crop((gauche, haut, gauche + largeur, haut + hauteur))
    image.save(sortie + '.jpg', 'JPEG', quality=92)
    # Fichier-monde : taille du pixel + centre du pixel haut-gauche (Web Mercator, metres)
    x0 = origine + (tx0 * TUILE + gauche) * res + res / 2
    y0 = -(origine + (ty0 * TUILE + haut) * res) - res / 2
    with open(sortie + '.jgw', 'w') as f:
        f.write(f'{res:.10f}\n0.0000000000\n0.0000000000\n{-res:.10f}\n{x0:.4f}\n{y0:.4f}\n')
    with open(sortie + '.prj', 'w') as f:
        f.write(PRJ_3857)
    return image.size, res


def main():
    ap = argparse.ArgumentParser(description='Orthophoto de reference IGN (JPEG + .jgw)')
    ap.add_argument('--lat', type=float, required=True)
    ap.add_argument('--lng', type=float, required=True)
    ap.add_argument('--taille', type=float, default=160, help='cote de la zone en metres (defaut 160)')
    ap.add_argument('--zoom', type=int, default=20, help='niveau de zoom IGN (20 = ~10 cm/pixel)')
    ap.add_argument('--sortie', default='IGN_reference')
    a = ap.parse_args()
    taille, res = construire(a.lat, a.lng, a.taille, a.zoom, a.sortie)
    print(f'Image : {a.sortie}.jpg — {taille[0]} x {taille[1]} px, {res * 100:.1f} cm/pixel')
    print(f'Georeferencement : {a.sortie}.jgw (+ {a.sortie}.prj, Web Mercator EPSG:3857)')


if __name__ == '__main__':
    sys.exit(main())
