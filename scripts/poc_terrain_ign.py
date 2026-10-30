# -*- coding: utf-8 -*-
"""
Étape 0 du chantier « terrain automatique » : valider la grille RGE ALTI (WMS-R, BIL float32).

Pour chaque site :
  1. télécharge UNE grille 1 m sur un carré de --taille m (+ marge), centres de pixels calés sur
     les nœuds natifs du RGE ALTI ;
  2. FIDÉLITÉ : compare la grille à l'API altimétrie IGN sur des nœuds natifs (seuls points où
     l'API rend la valeur brute ; entre les nœuds elle n'interpole pas comme nous, l'écart n'y
     mesure donc pas une erreur). Critère : médiane < 2 cm et 95e centile < 10 cm ;
  3. trace 3 profils (est-ouest, nord-sud, diagonale) : dénivelé et pente max, pour information.
Le site hors de France est informatif : la couche IGN y renvoie des altitudes mondiales, le choix
de la source (IGN / Google) se fera donc par le pays du projet.

ATTENTION : appels réseau vers data.geopf.fr (≈ 1 requête grille + 2 à 3 requêtes points par site).

Utilisation :
    python scripts/poc_terrain_ign.py                       # sites par défaut
    python scripts/poc_terrain_ign.py --lat 45.77 --lng 3.04 --nom "mon site"
"""
import argparse
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.getcwd())

from app.services.terrain.mnt import (  # noqa: E402
    altitudes_points_ign, depuis_lambert93, telecharger_grille_ign, vers_lambert93,
)

SITES = [
    ('Plaine (Beauce)', 48.3500, 1.4900, True),
    ('Pente régulière (Limagne, piémont)', 45.7700, 3.0400, True),
    ('Relief vallonné (Morvan)', 47.1500, 4.0000, True),
    ('Hors France (Espagne)', 41.6500, -0.8800, False),
]
MEDIANE_MAX, P95_MAX = 0.02, 0.10


def carre(lat, lng, cote):
    x, y = vers_lambert93(lat, lng)
    d = cote / 2
    return [depuis_lambert93(x + dx, y + dy) for dx, dy in ((-d, -d), (d, -d), (d, d), (-d, d))]


def tester_site(nom, lat, lng, en_france, taille, pas):
    print(f'\n=== {nom} ({lat:.5f}, {lng:.5f})')
    coins = carre(lat, lng, taille)
    t0 = time.time()
    grille = telecharger_grille_ign(coins, marge_m=30.0, res=1.0)
    print(f'  grille {grille.largeur}x{grille.hauteur} px en {time.time() - t0:.1f} s, '
          f'couverture {grille.couverture * 100:.1f} %')
    x, y = vers_lambert93(lat, lng)
    d = taille / 2
    if not en_france:
        zs = grille.z[np.isfinite(grille.z)]
        print(f'  altitudes {zs.min():.1f} - {zs.max():.1f} m, exploitable : {grille.exploitable} '
              '-> la grille doit être rejetée (source choisie par le pays du projet)')
        return not grille.exploitable

    # 2. Fidélité aux nœuds natifs (mètres entiers), un nœud tous les 5 m.
    X, Y = math.floor(x), math.floor(y)
    noeuds = [(X + i, Y + j) for i in range(-int(d), int(d) + 1, 5) for j in range(-int(d), int(d) + 1, 5)]
    ref = altitudes_points_ign([depuis_lambert93(nx, ny) for nx, ny in noeuds])
    ecarts = np.array([abs(grille.altitude_l93(nx, ny) - r) for (nx, ny), r in zip(noeuds, ref)
                       if r is not None and grille.altitude_l93(nx, ny) is not None])
    med, p95, maxi = np.median(ecarts), np.percentile(ecarts, 95), ecarts.max()
    fidele = med < MEDIANE_MAX and p95 < P95_MAX
    print(f'  fidélité sur {len(ecarts)} nœuds : médiane {med:.3f} / p95 {p95:.3f} / max {maxi:.3f} m '
          f'{"OK" if fidele else "ÉCHEC"}')

    # 3. Profils (information).
    segments = {
        'est-ouest': ((x - d, y), (x + d, y)),
        'nord-sud': ((x, y + d), (x, y - d)),
        'diagonale': ((x - d, y - d), (x + d, y + d)),
    }
    for libelle, ((xa, ya), (xb, yb)) in segments.items():
        profil = [q for q in grille.profil(depuis_lambert93(xa, ya), depuis_lambert93(xb, yb), pas=pas)
                  if q['z'] is not None]
        zs = [q['z'] for q in profil]
        pentes = [abs(b['z'] - a['z']) / (b['s'] - a['s']) * 100 for a, b in zip(profil, profil[1:])]
        print(f'  profil {libelle:10s} : {len(profil)} pts, z {zs[0]:.2f} -> {zs[-1]:.2f}, '
              f'dénivelé {max(zs) - min(zs):5.2f} m, pente moy {abs(zs[-1] - zs[0]) / profil[-1]["s"] * 100:4.1f} %, '
              f'pente max locale {max(pentes):4.1f} %')
    return fidele


def main():
    ap = argparse.ArgumentParser(description='Prototype MNT IGN : grille WMS-R vs API altimétrie')
    ap.add_argument('--lat', type=float)
    ap.add_argument('--lng', type=float)
    ap.add_argument('--nom', default='Site personnalisé')
    ap.add_argument('--taille', type=float, default=150, help='côté du carré testé en m (défaut 150)')
    ap.add_argument('--pas', type=float, default=2.0, help='pas des profils en m (défaut 2)')
    args = ap.parse_args()
    sites = [(args.nom, args.lat, args.lng, True)] if args.lat is not None else SITES
    resultats = []
    for nom, lat, lng, fr in sites:
        try:
            resultats.append((nom, tester_site(nom, lat, lng, fr, args.taille, args.pas)))
        except Exception as e:  # noqa: BLE001 - prototype : on veut le rapport complet
            print(f'  ERREUR : {type(e).__name__}: {e}')
            resultats.append((nom, False))
    print('\n=== Bilan')
    for nom, ok in resultats:
        print(f'  {"OK   " if ok else "ÉCHEC"} {nom}')
    return 0 if all(ok for _, ok in resultats) else 1


if __name__ == '__main__':
    sys.exit(main())
