"""
Vieillissement du stockage sur la durée de l'étude économique.

Le calcul de stockage (calcul_stockage.py) simule l'ANNÉE 1 avec PySAM, puis la rejoue à capacité
réduite (état de santé SoH = 90 %, 80 %, 70 %...). On obtient ainsi, pour chaque SoH, l'énergie
réellement restituée : une batterie rarement pleine ne perd presque rien quand sa capacité baisse,
une batterie saturée tous les jours perd en proportion. Ce module en déduit, année par année :

  - l'état de santé : SoH(t+1) = SoH(t) − dégradation calendaire − (1 − SoH fin de vie) × cycles(t) / cycles max
    (cycles(t) = cycles équivalents complets réellement simulés, fonction du SoH) ;
  - la fin de vie : SoH ≤ SoH fin de vie (fiche batterie, 60 % par défaut) — la batterie ne contribue
    plus au-delà ; l'année où le seuil est franchi, sa contribution est comptée au prorata ;
  - le remplacement : automatique à la fin de vie (défaut), à une année choisie, ou aucun ;
  - les flux d'énergie de l'année, les flux solaires suivant aussi la dégradation des panneaux.

MIROIR EXACT de app/static/concevoir_mon_projet/javascript/etude_economique/StockageVieillissement.js
(calcul instantané du navigateur) : toute modification doit être reportée dans les deux fichiers —
tests/etude_economique/test_vieillissement_stockage_js_py.py compare leurs résultats.
"""

# Défaut retenu en l'absence de donnée constructeur (demande explicite : 60 % partout).
SOH_FIN_VIE_DEFAUT_PCT = 60.0
FLUX = ('e_sol_restit_mwh', 'e_sol_charge_mwh', 'e_res_charge_mwh', 'e_res_restit_mwh', 'cycles_an')
FLUX_SOLAIRES = ('e_sol_restit_mwh', 'e_sol_charge_mwh')
MODES_REMPLACEMENT = ('auto', 'annee', 'aucun')


def soh_fin_vie(valeur_pct):
    """SoH de fin de vie en fraction : valeur de la fiche si plausible (50-99 %), sinon 60 %."""
    try:
        v = float(valeur_pct)
    except (TypeError, ValueError):
        v = SOH_FIN_VIE_DEFAUT_PCT
    if not 50.0 <= v <= 99.0:
        v = SOH_FIN_VIE_DEFAUT_PCT
    return v / 100.0


def interpoler(points, soh, cle):
    """Valeur de `cle` au SoH donné, par interpolation linéaire entre les points simulés
    (extrapolation linéaire sous le plus bas, bornée à 0 ; plafonnée au point à 100 %)."""
    pts = sorted(points, key=lambda p: p['soh'])
    if not pts:
        return 0.0
    if len(pts) == 1 or soh >= pts[-1]['soh']:
        return max(0.0, float(pts[-1][cle]))
    if soh <= pts[0]['soh']:
        a, b = pts[0], pts[1]
    else:
        a, b = pts[0], pts[1]
        for i in range(1, len(pts)):
            if soh <= pts[i]['soh']:
                a, b = pts[i - 1], pts[i]
                break
    if b['soh'] == a['soh']:
        return max(0.0, float(a[cle]))
    k = (soh - a['soh']) / (b['soh'] - a['soh'])
    return max(0.0, float(a[cle]) + k * (float(b[cle]) - float(a[cle])))


def trajectoire(vieillissement, horizon, degradation_pv=0.0, mode_remplacement='auto', annee_remplacement=None):
    """
    Liste d'années t = 1..horizon : {t, soh_debut, soh_fin, fraction_service, remplacement, + FLUX}.

    `vieillissement` : bloc outputs.vieillissement du calcul de stockage.
    `degradation_pv` : dégradation annuelle des panneaux, en FRACTION (0,005 = 0,5 %/an).
    """
    points = vieillissement.get('points') or []
    eol = soh_fin_vie(vieillissement.get('soh_fin_vie_pct'))
    cal = max(0.0, float(vieillissement.get('degrad_cal_pct_an') or 0.0)) / 100.0
    cycles_max = float(vieillissement.get('cycles_max') or 0.0)
    mode = mode_remplacement if mode_remplacement in MODES_REMPLACEMENT else 'auto'
    try:
        annee = int(annee_remplacement) if annee_remplacement not in (None, '') else None
    except (TypeError, ValueError):
        annee = None

    soh = 1.0
    annees = []
    for t in range(1, int(horizon) + 1):
        remplacement = False
        if t > 1 and ((mode == 'auto' and soh <= eol + 1e-9) or (mode == 'annee' and annee == t)):
            soh = 1.0
            remplacement = True

        ligne = {'t': t, 'soh_debut': soh, 'remplacement': remplacement}
        if soh <= eol + 1e-9:
            ligne.update({'soh_fin': soh, 'fraction_service': 0.0})
            ligne.update({cle: 0.0 for cle in FLUX})
            annees.append(ligne)
            continue

        cycles = interpoler(points, soh, 'cycles_an')
        perte = cal + ((1.0 - eol) * cycles / cycles_max if cycles_max > 0 else 0.0)
        soh_fin = max(0.0, soh - perte)
        if perte > 0 and soh_fin < eol:
            fraction = (soh - eol) / perte
            soh_moyen = (soh + eol) / 2.0
        else:
            fraction = 1.0
            soh_moyen = (soh + soh_fin) / 2.0
        facteur_pv = (1.0 - degradation_pv) ** (t - 1)
        for cle in FLUX:
            valeur = interpoler(points, soh_moyen, cle) * fraction
            ligne[cle] = valeur * facteur_pv if cle in FLUX_SOLAIRES else valeur
        ligne.update({'soh_fin': soh_fin, 'fraction_service': fraction})
        annees.append(ligne)
        soh = soh_fin
    return annees


def duree_de_vie_ans(vieillissement, plafond=60):
    """Années de service avant la fin de vie, sans remplacement (fractionnaire)."""
    total = 0.0
    for ligne in trajectoire(vieillissement, plafond, 0.0, 'aucun'):
        if ligne['fraction_service'] <= 0:
            break
        total += ligne['fraction_service']
    return total
