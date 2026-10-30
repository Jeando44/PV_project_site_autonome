"""
Modal « Configuration Batterie & Éco » (temps de recharge, comparatif véhicule électrique / thermique)
— calcul de référence (vérification du calcul du navigateur, écart admis 0,01).

Miroir exact de calculateBatteryDetail(), interpolateKm() et getAutonomyRatio()
(app/static/concevoir_mon_projet/javascript/Irve/analyse_eco_irve.js). Les entrées sont les valeurs
EFFECTIVES utilisées par le navigateur (valeurs par défaut du formulaire déjà appliquées).
Toute formule ou donnée modifiée d'un côté doit l'être de l'autre.
"""

# Profils d'autonomie (km) par température (°C) — copie de window.EV_AUTONOMY_PROFILES.
EV_AUTONOMY_PROFILES = {
    'kangoo': {
        'cap': 45,
        'ville': [(-10, 190), (0, 220), (10, 280), (20, 335), (25, 275), (30, 260), (35, 240), (40, 220)],
        'mixte': [(-10, 170), (0, 200), (10, 260), (20, 315), (25, 310), (30, 310), (35, 310), (40, 300)],
        'autoroute': [(-10, 120), (0, 150), (10, 200), (20, 240), (25, 210), (30, 210), (35, 210), (40, 200)],
    },
    'e208': {
        'cap': 50,
        'ville': [(-10, 210), (0, 280), (10, 340), (20, 400), (30, 360), (40, 330)],
        'mixte': [(-10, 170), (0, 220), (10, 270), (20, 320), (30, 290), (40, 270)],
        'autoroute': [(-10, 120), (0, 160), (10, 200), (20, 240), (30, 220), (40, 200)],
    },
    'zoe': {
        'cap': 52,
        'ville': [(-10, 200), (0, 260), (10, 340), (20, 420), (30, 380), (40, 350)],
        'mixte': [(-10, 180), (0, 230), (10, 290), (20, 340), (30, 310), (40, 280)],
        'autoroute': [(-10, 130), (0, 170), (10, 210), (20, 250), (30, 230), (40, 210)],
    },
    'model3': {
        'cap': 60,
        'ville': [(-10, 300), (0, 380), (10, 460), (20, 550), (30, 500), (40, 470)],
        'mixte': [(-10, 260), (0, 320), (10, 380), (20, 430), (30, 400), (40, 380)],
        'autoroute': [(-10, 200), (0, 250), (10, 300), (20, 340), (30, 320), (40, 300)],
    },
    'modely': {
        'cap': 75,
        'ville': [(-10, 320), (0, 410), (10, 500), (20, 580), (30, 530), (40, 500)],
        'mixte': [(-10, 270), (0, 340), (10, 400), (20, 450), (30, 420), (40, 400)],
        'autoroute': [(-10, 210), (0, 270), (10, 320), (20, 360), (30, 340), (40, 320)],
    },
    'megane': {
        'cap': 60,
        'ville': [(-10, 240), (0, 320), (10, 400), (20, 480), (30, 440), (40, 410)],
        'mixte': [(-10, 210), (0, 280), (10, 340), (20, 400), (30, 360), (40, 340)],
        'autoroute': [(-10, 160), (0, 210), (10, 260), (20, 300), (30, 280), (40, 260)],
    },
    'spring': {
        'cap': 26.8,
        'ville': [(-10, 120), (0, 170), (10, 210), (20, 250), (30, 220), (40, 200)],
        'mixte': [(-10, 90), (0, 120), (10, 160), (20, 190), (30, 170), (40, 150)],
        'autoroute': [(-10, 60), (0, 80), (10, 110), (20, 130), (30, 120), (40, 110)],
    },
    'custom': {
        'cap': 50,
        'ville': [(-10, 210), (0, 270), (10, 330), (20, 380), (30, 340), (40, 310)],
        'mixte': [(-10, 160), (0, 210), (10, 260), (20, 300), (30, 270), (40, 250)],
        'autoroute': [(-10, 110), (0, 150), (10, 190), (20, 220), (30, 200), (40, 180)],
    },
}


def interpoler_km(profil, temp):
    """Interpolation linéaire bornée aux extrémités (miroir d'interpolateKm)."""
    if not profil:
        return 250
    pts = sorted(profil, key=lambda p: p[0])
    if temp <= pts[0][0]:
        return pts[0][1]
    if temp >= pts[-1][0]:
        return pts[-1][1]
    bas, haut = pts[0], pts[-1]
    for p in pts:
        if p[0] <= temp:
            bas = p
        if p[0] > temp:
            haut = p
            break
    fraction = (temp - bas[0]) / (haut[0] - bas[0])
    return bas[1] + (haut[1] - bas[1]) * fraction


def ratio_autonomie(modele, parcours, temp):
    """Autonomie à la température / autonomie à 20 °C (miroir de getAutonomyRatio)."""
    donnees = EV_AUTONOMY_PROFILES.get(modele) or EV_AUTONOMY_PROFILES['custom']
    profil = donnees.get(parcours) or donnees['mixte']
    km20 = interpoler_km(profil, 20)
    if km20 == 0:
        return 1
    return interpoler_km(profil, temp) / km20


def calculer_batterie_eco(e):
    """
    e : cap_batterie, soc_init_pct, soc_fin_pct, p_borne_kw, type ('AC'|'DC'), rdt_ac, rdt_dc,
        dist_jour_km, parcours, conso_ev_base, temp_ext, prix_elec, conso_th_base, prix_carburant,
        prix_achat_ev_k, subvention_ev_k, prix_achat_th_k, entretien_ev, entretien_th, modele.
    """
    cap = e['cap_batterie']
    soc_init = e['soc_init_pct'] / 100
    soc_fin = e['soc_fin_pct'] / 100
    p = e['p_borne_kw']
    cap_recharge = max(0.0, cap * (soc_fin - soc_init))
    rdt_ac, rdt_dc = e['rdt_ac'], e['rdt_dc']

    energie = temps = 0.0
    if cap_recharge > 0 and p > 0:
        if e['type'] == 'AC':
            energie = cap_recharge / rdt_ac
            temps = energie / p
        else:
            soc_80 = 0.8
            t1 = t2 = e1 = e2 = 0.0
            p1, p2 = 0.80 * p, 0.25 * p
            if soc_init < soc_80:
                cible1 = min(soc_fin, soc_80)
                e1 = cap * (cible1 - soc_init) / rdt_dc
                t1 = e1 / p1
            if soc_fin > soc_80:
                debut2 = max(soc_init, soc_80)
                e2 = cap * (soc_fin - debut2) / rdt_dc
                t2 = e2 / p2
            temps = t1 + t2
            energie = e1 + e2

    parcours = e['parcours']
    mult_th = 1.20 if parcours == 'ville' else (0.90 if parcours == 'autoroute' else 1.0)
    temp = max(-10, min(40, e['temp_ext']))
    ratio = ratio_autonomie(e.get('modele') or 'custom', parcours, temp)
    conso_ev = e['conso_ev_base'] / ratio if ratio > 0 else e['conso_ev_base']
    autonomie = cap / conso_ev * 100 if conso_ev > 0 else 0.0
    conso_th = e['conso_th_base'] * mult_th
    nrj_jour = e['dist_jour_km'] / 100 * conso_ev
    dist_an = e['dist_jour_km'] * 365

    temps_jour = 0.0
    if nrj_jour > 0 and p > 0:
        temps_jour = (nrj_jour / rdt_ac) / p if e['type'] == 'AC' else (nrj_jour / rdt_dc) / (0.80 * p)

    cout_ev = dist_an / 100 * conso_ev * e['prix_elec'] + e['entretien_ev']
    cout_th = dist_an / 100 * conso_th * e['prix_carburant'] + e['entretien_th']
    economie = cout_th - cout_ev
    surcout = (e['prix_achat_ev_k'] * 1000 - e['subvention_ev_k'] * 1000) - e['prix_achat_th_k'] * 1000

    roi_ans = None
    if surcout > 0:
        roi_cas = 'annees' if economie > 0 else 'jamais'
        if economie > 0:
            roi_ans = surcout / economie
    elif economie > 0:
        roi_cas = 'immediat_econome'
    else:
        roi_cas = 'moins_cher_usage_plus_cher'

    return {
        'capacite_recharge_kwh': cap_recharge,
        'energie_borne_kwh': energie,
        'temps_recharge_h': temps,
        'conso_ev_reelle': conso_ev,
        'autonomie_km': autonomie,
        'energie_jour_kwh': nrj_jour,
        'temps_jour_h': temps_jour,
        'cout_annuel_ev': cout_ev,
        'cout_annuel_th': cout_th,
        'economie_annuelle': economie,
        'surcout_achat': surcout,
        'roi_ans': roi_ans,
        'roi_cas': roi_cas,
    }
