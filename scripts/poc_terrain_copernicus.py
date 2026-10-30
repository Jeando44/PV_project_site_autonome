# -*- coding: utf-8 -*-
"""
Terrain hors France : valider la lecture du Copernicus DEM GLO-30 (copernicus.py) sur les vraies
tuiles du registre AWS Open Data, en le comparant à l'IGN RGE ALTI là où l'IGN fait référence.

Pour chaque site français :
  1. grille Copernicus sur un carré de --taille m (lecture partielle des COG, cache disque) ;
  2. grille IGN 1 m sur la même zone, lue aux CENTRES des pixels Copernicus ;
  3. écarts : biais moyen (géoïde EGM2008 vs NGF + surface vs sol), écart-type et 95e centile
     une fois le biais retiré, corrélation ; dénivelé d'un profil est-ouest pour les deux sources.
  Un décodage faux (octets, prédicteur, décalage d'un pixel) donnerait une corrélation faible ou
  un biais de dizaines de mètres : c'est ce que le script cherche à exclure.
Sites hors de France : informatif (altitudes, dénivelé), sans référence.

ATTENTION : appels réseau vers copernicus-dem-30m.s3.amazonaws.com (en-tête + quelques blocs par
tuile, ≈ 2-6 Mo par site) et data.geopf.fr (1 grille IGN par site français).

Utilisation :
    python scripts/poc_terrain_copernicus.py                  # sites par défaut
    python scripts/poc_terrain_copernicus.py --lat 33.97 --lng -6.85 --nom "Rabat" --etranger
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.getcwd())

from app.services.terrain import copernicus as cop  # noqa: E402
from app.services.terrain.mnt import telecharger_grille_ign  # noqa: E402

SITES = [
    ('Plaine (Beauce)', 48.3500, 1.4900, True),
    ('Pente régulière (Limagne, piémont)', 45.7700, 3.0400, True),
    ('Relief vallonné (Morvan, boisé)', 47.1500, 4.0000, True),
    ('Espagne (Saragosse)', 41.6500, -0.8800, False),
    ('Maroc (Ouarzazate, centrale Noor)', 30.9970, -6.8650, False),
]
CACHE = os.path.join('instance', 'cache_mnt', 'copernicus')


def carre(lat, lng, cote):
    d_lat = cote / 2 / cop.M_PAR_DEGRE
    d_lng = cote / 2 / (cop.M_PAR_DEGRE * np.cos(np.radians(lat)))
    return [(lat - d_lat, lng - d_lng), (lat + d_lat, lng + d_lng)]


def tester_site(nom, lat, lng, en_france, taille, source):
    print(f'\n=== {nom} ({lat:.5f}, {lng:.5f})')
    t0 = time.time()
    avant = source.telechargements
    g = cop.grille_copernicus(carre(lat, lng, taille), 0.0, source)
    print(f'  Copernicus : {g.largeur} x {g.hauteur} px, couverture {g.couverture:.0%}, '
          f'{source.telechargements - avant} requête(s), {time.time() - t0:.1f} s')
    if not g.exploitable:
        print('  -> aucune donnée exploitable (mer ?)')
        return None
    valides = g.z[np.isfinite(g.z)]
    print(f'  altitudes {valides.min():.1f} .. {valides.max():.1f} m (EGM2008)')
    profil = [g.altitude(lat, lng + d / (cop.M_PAR_DEGRE * np.cos(np.radians(lat))))
              for d in np.linspace(-taille / 2 + 30, taille / 2 - 30, 25)]
    profil = [z for z in profil if z is not None]
    print(f'  profil E-O ({taille - 60:.0f} m) : dénivelé {max(profil) - min(profil):.2f} m')
    if not en_france:
        return {'nom': nom}

    t0 = time.time()
    ign = telecharger_grille_ign(carre(lat, lng, taille), marge_m=40, res=1.0)
    print(f'  IGN 1 m : {ign.largeur} x {ign.hauteur} px, {time.time() - t0:.1f} s')
    lngs = g.xmin + (np.arange(g.largeur) + 0.5) * g.res_x
    lats = g.ymax - (np.arange(g.hauteur) + 0.5) * g.res_y
    paires = []
    for il, la in enumerate(lats):
        for ic, lo in enumerate(lngs):
            zi = ign.altitude(la, lo)
            if zi is not None and np.isfinite(g.z[il, ic]):
                paires.append((g.z[il, ic], zi))
    c, i = np.array(paires).T
    ecart = c - i
    biais = float(np.mean(ecart))
    residu = ecart - biais
    corr = float(np.corrcoef(c, i)[0, 1]) if np.std(i) > 0.05 else float('nan')
    profil_ign = [ign.altitude(lat, lng + d / (cop.M_PAR_DEGRE * np.cos(np.radians(lat))))
                  for d in np.linspace(-taille / 2 + 30, taille / 2 - 30, 25)]
    profil_ign = [z for z in profil_ign if z is not None]
    print(f'  Copernicus - IGN sur {len(paires)} pixels : biais {biais:+.2f} m, '
          f'écart-type {np.std(residu):.2f} m, p95 |résidu| {np.percentile(np.abs(residu), 95):.2f} m, '
          f'corrélation {corr:.3f}')
    print(f'  profil E-O IGN : dénivelé {max(profil_ign) - min(profil_ign):.2f} m')
    return {'nom': nom, 'biais': biais, 'sigma': float(np.std(residu)), 'corr': corr}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lat', type=float)
    ap.add_argument('--lng', type=float)
    ap.add_argument('--nom', default='site')
    ap.add_argument('--etranger', action='store_true')
    ap.add_argument('--taille', type=float, default=400.0)
    args = ap.parse_args()
    sites = [(args.nom, args.lat, args.lng, not args.etranger)] if args.lat is not None else SITES
    source = cop.SourceCopernicus(CACHE)
    resultats = []
    for i, (nom, lat, lng, fr) in enumerate(sites):
        try:
            resultats.append(tester_site(nom, lat, lng, fr, args.taille, source))
        except Exception as e:   # un site en échec ne bloque pas les autres
            print(f'  ÉCHEC : {type(e).__name__} : {e}')
            resultats.append(None)
        if i == 0:
            meta = next((m for m in source._metas.values() if m), None)
            if meta:
                print(f'  [tuile] {meta["largeur"]} x {meta["hauteur"]} px, blocs {meta["bloc_l"]} x '
                      f'{meta["bloc_h"]}, compression {meta["compression"]}, prédicteur {meta["predicteur"]}, '
                      f'pas {meta["res_x"] * 3600:.2f}" x {meta["res_y"] * 3600:.2f}", '
                      f'pixel (0,0) centré en ({meta["lat0"]:.6f}, {meta["lng0"]:.6f})')

    print('\n=== Synthèse')
    for r in resultats:
        if r and 'biais' in r:
            print(f'  {r["nom"]:<40} biais {r["biais"]:+6.2f} m  σ {r["sigma"]:5.2f} m  corr {r["corr"]:.3f}')
        elif r:
            print(f'  {r["nom"]:<40} lu (pas de référence)')
    print(f'  Requêtes Copernicus : {source.telechargements} (cache : {CACHE})')


if __name__ == '__main__':
    main()
