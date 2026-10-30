# -*- coding: utf-8 -*-
"""
Construit le catalogue des pompes Grundfos SQFlex (fichier JSON importable) à partir du livret
technique fourni par l'utilisateur :
    app/static/concevoir_mon_projet/javascript/Irve/pompage_solaire/grundfos.pdf
    (Grundfos, livret technique SQFlex, réf. 99203051, 11/2016)

Les courbes de performance (pages 27 à 32) sont des TRACÉS VECTORIELS : elles sont numérisées
directement depuis le PDF (pas de capture d'écran, pas de relevé à la main). Pour chaque graphique :
  1. les graduations des axes (texte) donnent la conversion position -> valeur (régression linéaire,
     graduations mal lues écartées) ;
  2. les traits épais sont recollés bout à bout en courbes complètes ;
  3. les courbes sont rangées par hauteur croissante (à débit égal, plus la hauteur est grande, plus la
     puissance absorbée P1 est élevée) et associées aux hauteurs imprimées sur le graphique ;
  4. chaque courbe est rééchantillonnée en 24 points répartis selon sa longueur (le coude des faibles
     puissances reste fidèle).
Le script s'arrête si le nombre de courbes trouvées ne correspond pas au nombre de hauteurs attendu.

Les autres données (désignations, dimensions, codes articles, rendements, applications solaires) sont
reprises des tableaux du même livret, reformulées.

Sortie : scripts/donnees/pompes_sqflex_grundfos.json, au format de l'export de l'administration des
matériels (clé « pompe_solaire ») : il s'importe tel quel, en local comme en production, par
« Administration des matériels > Importer JSON », ou en local par scripts/import_pompes_sqflex.py.

Lancement (racine du dépôt) : python scripts/extraire_pompes_sqflex.py [--pdf chemin] [--sortie chemin]
Dépendances : pdfplumber, numpy (déjà installés).
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime

import numpy as np
import pdfplumber

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DEFAUT = os.path.join(RACINE, 'app', 'static', 'concevoir_mon_projet', 'javascript', 'Irve',
                          'pompage_solaire', 'grundfos.pdf')
SORTIE_DEFAUT = os.path.join(RACINE, 'scripts', 'donnees', 'pompes_sqflex_grundfos.json')

SOURCE = 'Grundfos, livret technique SQFlex réf. 99203051 (11/2016)'
P1_MAX_W = 1400  # moteur MSF 3 : puissance absorbée maximale (p. 6 et 33)

# (page, rang du graphique sur la page, modèle, hauteurs imprimées, dans l'ordre croissant)
GRAPHIQUES = [
    (27, 0, '0.6-2', [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    (27, 1, '0.6-3', list(range(80, 201, 10))),
    (28, 0, '1.2-2', [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    (28, 1, '1.2-3', list(range(90, 251, 20))),
    (29, 0, '2.5-2', [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    (29, 1, '3A-10', list(range(30, 71, 5))),
    (30, 0, '5A-3', [2, 5, 10, 15]),
    (30, 1, '5A-7', list(range(10, 51, 5))),
    (31, 0, '7-4', list(range(5, 36, 5))),
    (31, 1, '9-3', list(range(5, 26, 5))),
    (32, 0, '14-3', list(range(5, 26, 5))),
]

# Tableaux du livret : technologie (p. 5/7), débit nominal (désignation), codes articles (p. 41),
# raccord (p. 33), rendement hydraulique des pompes centrifuges (p. 32).
MODELES = {
    '0.6-2': dict(helico=True, q_nom=0.6, codes=('95027324', '95027325'), raccord='Rp 1 1/4'),
    '0.6-3': dict(helico=True, q_nom=0.6, codes=('95027326', '95027327'), raccord='Rp 1 1/4'),
    '1.2-2': dict(helico=True, q_nom=1.2, codes=('95027328', '95027329'), raccord='Rp 1 1/4'),
    '1.2-3': dict(helico=True, q_nom=1.2, codes=('96834838', '96834839'), raccord='Rp 1 1/4'),
    '2.5-2': dict(helico=True, q_nom=2.5, codes=('95027330', '95027331'), raccord='Rp 1 1/4'),
    '3A-10': dict(helico=False, q_nom=3, codes=('95027336', '95027337'), raccord='Rp 1 1/4', rendement=58),
    '5A-3': dict(helico=False, q_nom=5, codes=('95027338', '95027339'), raccord='Rp 1 1/2', rendement=60),
    '5A-7': dict(helico=False, q_nom=5, codes=('95027342', '95027343'), raccord='Rp 1 1/2', rendement=60),
    '7-4': dict(helico=False, q_nom=7, codes=('98978806', '98994902'), raccord='Rp 1 1/2', rendement=69),
    '9-3': dict(helico=False, q_nom=9, codes=('98978774', '98994640'), raccord='Rp 2', rendement=71),
    '14-3': dict(helico=False, q_nom=14, codes=('98978823', '98994933'), raccord='Rp 2', rendement=70),
}

# Installations SQFlex alimentées (au moins en partie) par le solaire — tableau « Aperçu de
# l'installation » (p. 8) et pages 11 à 15, 18 et 19. Les installations éolien seul et groupe seul
# sont exclues (demande : références compatibles avec l'énergie solaire).
APPLICATIONS_SOLAIRES = [
    'SQFlex Solar : panneaux solaires + boîtier de commutation IO 50 (marche/arrêt manuel)',
    'SQFlex solaire avec CU 200 et capteur de niveau : arrêt automatique citerne pleine, '
    'affichage de l\'état et de la puissance d\'entrée',
    'SQFlex solaire avec groupe électrogène : boîtier IO 101, retour automatique au solaire à '
    'l\'arrêt du groupe',
    'SQFlex solaire avec CU 200 et groupe électrogène : IO 101 + CU 200 et capteur de niveau',
    'SQFlex solaire avec batteries de secours : régulateur de charge 48 V, CU 200, IO 50 ou IO 101 '
    'en option (pompage de nuit)',
    'SQFlex Combi (solaire + éolien) : boîtier de protection IO 102',
    'SQFlex Combi avec CU 200 et capteur de niveau : IO 102 + CU 200',
]


# --------------------------------------------------------------------------------------------- #
# Numérisation des courbes
# --------------------------------------------------------------------------------------------- #

def _cid(n):
    # Pages 31-32 : police à identifiants, chiffres codés cid 2..11 -> '0'..'9', cid 12 -> 'P'.
    return str(n - 2) if 2 <= n <= 11 else ('P' if n == 12 else '?')


def _decoder(t):
    t = re.sub(r'\(cid:(\d+)\)', lambda m: _cid(int(m.group(1))), t)
    return re.sub(r'/g(\d+)', lambda m: chr(int(m.group(1)) + 29), t)  # glyphes /gNN (décalage ASCII)


def _nombre(t):
    try:
        return float(t.replace(',', '.'))
    except ValueError:
        return None


def _axes(mots):
    """Graphiques d'une page, de haut en bas : graduations des abscisses (ligne « P1 [W] ») et des
    ordonnées (nombres alignés à droite au-dessus)."""
    mots = [dict(w, text=_decoder(w['text'])) for w in mots if w['upright']]
    lignes_p1 = sorted([w for w in mots if w['text'].startswith('P1')], key=lambda w: w['top'])
    graphiques = []
    bas_precedent = 0
    for p1 in lignes_p1:
        xs = [((w['x0'] + w['x1']) / 2, _nombre(w['text'])) for w in mots
              if abs(w['top'] - p1['top']) < 2 and _nombre(w['text']) is not None and w['x1'] < p1['x0']]
        cand = [w for w in mots if _nombre(w['text']) is not None
                and bas_precedent < w['top'] < p1['top'] - 3 and 60 < w['x0'] and w['x1'] < 110]
        x1s = [round(w['x1']) for w in cand]
        x1_ref = max(set(x1s), key=x1s.count)
        ys = [((w['top'] + w['bottom']) / 2, _nombre(w['text'])) for w in cand if abs(w['x1'] - x1_ref) < 1.5]
        graphiques.append(dict(xs=xs, ys=ys, haut=max(bas_precedent, min(y for y, _ in ys) - 40),
                               bas=p1['top']))
        bas_precedent = p1['bottom']
    return graphiques


def _regression(paires):
    """Position -> valeur ; les graduations mal lues (texte fusionné) sont écartées une à une tant que
    l'écart dépasse 1 % de l'étendue de l'axe."""
    a = np.array(paires, dtype=float)
    while True:
        k, b = np.polyfit(a[:, 0], a[:, 1], 1)
        err = np.abs(a[:, 0] * k + b - a[:, 1])
        if err.max() <= 0.01 * (a[:, 1].max() - a[:, 1].min()) or len(a) <= 4:
            return k, b, err.max()
        a = np.delete(a, err.argmax(), axis=0)


def _recoller(traits, tol=0.8):
    """Recolle bout à bout les morceaux de tracé (une courbe est coupée en plusieurs chemins)."""
    morceaux = [list(map(tuple, c['pts'])) for c in traits]
    courbes = []
    while morceaux:
        ch = morceaux.pop(0)
        allonge = True
        while allonge:
            allonge = False
            for i, m in enumerate(morceaux):
                for c in (m, m[::-1]):
                    if np.hypot(c[0][0] - ch[-1][0], c[0][1] - ch[-1][1]) < tol:
                        ch = ch + c[1:]
                    elif np.hypot(c[-1][0] - ch[0][0], c[-1][1] - ch[0][1]) < tol:
                        ch = c[:-1] + ch
                    else:
                        continue
                    morceaux.pop(i)
                    allonge = True
                    break
                if allonge:
                    break
        courbes.append(ch)
    return courbes


def _reechantillonner(points, n=24):
    p = np.array(sorted(points))
    garde = [0]
    for i in range(1, len(p)):  # P1 strictement croissante, Q non décroissant
        if p[i, 0] > p[garde[-1], 0] + 1e-6 and p[i, 1] >= p[garde[-1], 1] - 1e-4:
            garde.append(i)
    p = p[garde]
    sx = (p[:, 0] - p[0, 0]) / max(p[-1, 0] - p[0, 0], 1e-9)
    sy = (p[:, 1] - p[0, 1]) / max(p[-1, 1] - p[0, 1], 1e-9)
    s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(sx), np.diff(sy)))])
    cible = np.linspace(0, s[-1], n)
    p1 = np.interp(cible, s, p[:, 0])
    q = np.maximum(np.interp(cible, s, p[:, 1]), 0.0)
    return [[round(float(a), 1), round(float(b), 4)] for a, b in zip(p1, q)]


def numeriser_courbes(chemin_pdf):
    pdf = pdfplumber.open(chemin_pdf)
    resultat = {}
    for page, rang, modele, hauteurs in GRAPHIQUES:
        pg = pdf.pages[page - 1]
        g = _axes(pg.extract_words(extra_attrs=['upright'], x_tolerance=1))[rang]
        kx, bx, rx = _regression(g['xs'])
        ky, by, ry = _regression(g['ys'])
        traits = [c for c in pg.curves if (c.get('linewidth') or 0) > 0.9
                  and c['top'] >= g['haut'] and c['bottom'] <= g['bas'] + 2]
        courbes = [sorted(((x * kx + bx, y * ky + by) for x, y in c), key=lambda p: p[1])
                   for c in _recoller(traits)]
        courbes = [c for c in courbes if len(c) > 8]  # traits de repère des étiquettes écartés
        q_ref = max(c[0][1] for c in courbes) + 0.01
        if not q_ref < min(c[-1][1] for c in courbes):
            sys.exit(f'SQF {modele} : pas de débit commun à toutes les courbes, numérisation à revoir')
        courbes.sort(key=lambda c: float(np.interp(q_ref, [p[1] for p in c], [p[0] for p in c])))
        if len(courbes) != len(hauteurs):
            sys.exit(f'SQF {modele} : {len(courbes)} courbes trouvées pour {len(hauteurs)} hauteurs (p. {page})')
        print(f'SQF {modele:<6} p.{page} : {len(courbes):>2} courbes, écart d\'axe max {rx:.2f} W / {ry:.3f} m3/h')
        resultat[modele] = [{'hmt_m': h, 'points': _reechantillonner(c)} for h, c in zip(hauteurs, courbes)]
    return resultat


# --------------------------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------------------------- #

def fiches(courbes):
    lignes = []
    for modele, info in MODELES.items():
        etages = int(modele.split('-')[1])
        c = courbes[modele]
        h_max = max(x['hmt_m'] for x in c)
        q_max = max(p[1] for x in c for p in x['points'])
        trois_pouces = info['helico']
        courbes_json = json.dumps({
            'source': f'{SOURCE}, courbes de performance p. 27-32 (numérisées)',
            'axe_x': 'P1 [W]', 'axe_y': 'Q [m3/h]', 'p1_max_w': P1_MAX_W,
            'validite': 'Valeurs moyennes indicatives (écart-type ±15 %), eau à 20 °C ; '
                        'pertes des clapets et de l\'aspiration incluses',
            'courbes': c,
        }, ensure_ascii=False, separators=(',', ':'))
        for variante_n in (False, True):
            lignes.append({
                'fabricant': 'Grundfos',
                'reference': f'SQF {modele}' + (' N' if variante_n else ''),
                'type_installation': ('Immergée (forage 3" et plus)' if trois_pouces
                                      else 'Immergée (forage 4" et plus ; installation flottante possible)'),
                'technologie_hydraulique': (f'Rotor hélicoïdal (volumétrique) 3", {etages} étages' if trois_pouces
                                            else f'Centrifuge 4", {etages} étages'),
                'architecture_systeme': 'Tout-en-un : moteur à électronique et MPPT intégrés, sans onduleur',
                'moteur': ('MSF 3 N' if variante_n else 'MSF 3') + ' : aimant permanent, P1 max 1400 W, '
                          '8,4 A max, 500 à 3600 min-1',
                'alimentation_electrique': '30-300 V DC ou 1 x 90-240 V AC 50/60 Hz (groupe électrogène 1,55 kVA min.)',
                'tension_entree_solaire': '30-300 V DC (MPPT intégré)',
                'puissance_kw': P1_MAX_W / 1000,
                'hmt_max_m': float(h_max),
                'debit_nominal_m3h': f'{q_max:.2f} max (courbes) ; nominal {info["q_nom"]:g} à 3000 min-1',
                'diametre_forage_min': '76 mm (3")' if trois_pouces else '104 mm (4")',
                'materiaux': ('Inox EN 1.4401 (AISI 316) : Cl- jusqu\'à 500 ppm à moins de 40 °C' if variante_n
                              else 'Inox EN 1.4301 (AISI 304) : Cl- jusqu\'à 300 ppm à moins de 40 °C '
                                   '(500 ppm à moins de 30 °C)'),
                'protections': 'Marche à sec (électrode sur le câble), sous et surtension, surcharge, '
                               'surchauffe (arrêt à 85 °C)',
                'indice_ip': 'IP68',
                'communication': 'CU 200 (état, capteur de niveau) ou CIU 273 (télésurveillance GRM), '
                                 'par courants porteurs',
                'applications': '\n'.join(APPLICATIONS_SOLAIRES),
                'courbes_performance': courbes_json,
                'rendement_hydraulique_pct': info.get('rendement'),
                'code_article': info['codes'][1 if variante_n else 0],
                'raccord_refoulement': info['raccord'],
                'is_active': True,
            })
    return lignes


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    parser.add_argument('--pdf', default=PDF_DEFAUT)
    parser.add_argument('--sortie', default=SORTIE_DEFAUT)
    args = parser.parse_args()

    courbes = numeriser_courbes(args.pdf)
    lignes = fiches(courbes)
    os.makedirs(os.path.dirname(args.sortie), exist_ok=True)
    payload = {
        'exported_at': datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
        'source': 'extraire_pompes_sqflex',
        'document': SOURCE,
        'pompe_solaire': lignes,
    }
    with open(args.sortie, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f'{len(lignes)} références écrites dans {os.path.relpath(args.sortie, RACINE)}')


if __name__ == '__main__':
    main()
