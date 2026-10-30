# -*- coding: utf-8 -*-
"""
Terrain des plans REGÉNÉRÉS côté serveur (ombrières : PDF/DXF via
app/models/dxf_generators/ombriere_metal_v2.py).

Le navigateur dessine le terrain à l'écran avec geometrie_structure/terrain_plans.js ; il envoie
dans le payload d'export le profil DÉJÀ échantillonné, dans le repère du dessin :
    terrain = {'coupe': [[x, y], ...], 'facade': [[x, y], ...], 'altitudes_ngf': bool, 'source': str}
avec x = abscisse du plan en mètres et y = ordonnée du sol en mètres, **positive vers le BAS**
(même convention que les générateurs Python, hérités du canevas). Le serveur ne refait donc aucun
calcul altimétrique : il rejoue le même sol, donc le PDF/DXF montre exactement le dessin de l'écran.

Ce module est le MIROIR des fonctions pures de terrain_plans.js (`interpoler`, `calerTable`) ;
la parité est vérifiée par tests/terrain/test_parite_terrain_plans.py.
"""

SOL_PLAT = 'plat'


def sol_depuis_points(points):
    """[[x, y], ...] -> fonction x -> y (interpolation linéaire, sol prolongé à plat aux extrémités).

    Renvoie None si moins de 2 points exploitables : l'appelant garde alors son sol historique.
    """
    propres = []
    for p in points or []:
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if x == x and y == y:          # écarte les NaN
            propres.append((x, y))
    if len(propres) < 2:
        return None
    propres.sort(key=lambda q: q[0])
    xs = [q[0] for q in propres]
    ys = [q[1] for q in propres]

    def sol(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        bas, haut = 0, len(xs) - 1
        while haut - bas > 1:
            milieu = (bas + haut) // 2
            if xs[milieu] <= x:
                bas = milieu
            else:
                haut = milieu
        largeur = xs[haut] - xs[bas]
        t = (x - xs[bas]) / largeur if largeur else 0.0
        return ys[bas] + (ys[haut] - ys[bas]) * t

    return sol


def sol_du_plan(data, plan):
    """Fonction de sol d'un plan ('coupe' | 'facade') depuis le payload d'export, ou None."""
    terrain = (data or {}).get('terrain') or {}
    return sol_depuis_points(terrain.get(plan))


def altitudes_ngf(data):
    return bool(((data or {}).get('terrain') or {}).get('altitudes_ngf'))


def caler_table(postes, mode, hauteur_min=0.0):
    """Miroir de TerrainPlans.calerTable (terrain_plans.js).

    `postes` = [(x, z_sol)] en mètres, z vers le HAUT ; `mode` = 'pente' (la table suit la pente
    entre le premier et le dernier poteau) ou 'horizontal'. La table est calée pour que le poteau
    le plus contraint garde exactement `hauteur_min` de garde au sol.
    -> (z_table(x), pente) ou None si aucun poteau.
    """
    propres = sorted([(float(x), float(z)) for x, z in (postes or []) if z == z], key=lambda q: q[0])
    if not propres:
        return None
    (x0, z0), (x1, z1) = propres[0], propres[-1]
    pente = (z1 - z0) / (x1 - x0) if mode == 'pente' and x1 > x0 else 0.0
    decalage = max(z - pente * x for x, z in propres) + hauteur_min
    return (lambda x: decalage + pente * x), pente


def hauteur_mesuree(sol, x_cote, y_cible, x_cible=None, au_pied=False):
    """Hauteur (m) d'une cotation verticale, mesurée sur le dessin jusqu'au sol — même règle que
    drawVerticalDimensionWithLeader : au droit de la LIGNE DE COTE (défaut), ou au droit du point
    coté (`au_pied`, pied de poteau). Renvoie (hauteur, y_du_sol)."""
    x_pied = x_cible if (au_pied and x_cible is not None) else x_cote
    y_sol = sol(x_pied) if sol else 0.0
    return y_sol - y_cible, y_sol
