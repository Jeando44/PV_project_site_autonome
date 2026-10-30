"""
Rentabilité économique du projet IRVE — calcul de référence (vérification du calcul du navigateur).
=====================================================================================================
Miroir exact de app/static/concevoir_mon_projet/javascript/Irve/rentabilite_irve/rentabilite_irve_calculs.js
(classerPlage, horlogeMurale, ventiler, calculerRentabilite) et des outils financiers du pompage solaire
(van, tri, anneeRetour de pompage_solaire_calculs.js). Toute formule modifiée d'un côté doit l'être de
l'autre (vérification : routes/irve_verification.py, écart admis 0,01).

Conventions identiques au JS : mois 0-11, jour de semaine 0 = dimanche, heures 0-23.
"""
import math
from datetime import datetime, timedelta, timezone

PLAGES = {
    'BASE': 'Base (tarif unique)',
    'HP': 'Heures pleines (HP)',
    'HC': 'Heures creuses (HC)',
    'P': 'Pointe (P)',
    'HPH': 'Heures pleines hiver (HPH)',
    'HCH': 'Heures creuses hiver (HCH)',
    'HPE': 'Heures pleines été (HPE)',
    'HCE': 'Heures creuses été (HCE)',
}

PLAGES_PAR_TARIF = {
    'C5_BASE': ['BASE'],
    'C5_HPHC': ['HP', 'HC'],
    'C4': ['HPH', 'HCH', 'HPE', 'HCE'],
    'C3': ['P', 'HPH', 'HCH', 'HPE', 'HCE'],
}

MOIS_POINTE = (11, 0, 1)
HEURES_POINTE_DEFAUT = (8, 9, 18, 19)
HEURES_HC_DEFAUT = (23, 0, 1, 2, 3, 12, 13, 14)   # Turpe7Manager.generateDefaultTurpe7Config


def frise(heures):
    return [h in heures for h in range(24)]


def est_hiver(mois):
    return mois >= 10 or mois <= 2


def classer_plage(tarif, mois, jour_semaine, heure, config):
    """Plage tarifaire d'un instant en heure murale (miroir de classerPlage)."""
    if tarif == 'C5_BASE':
        return 'BASE'
    hc = bool(config and config.get('hc_hours') and config['hc_hours'][heure])
    if tarif == 'C5_HPHC':
        return 'HC' if hc else 'HP'
    if tarif == 'C3':
        pointe = bool(config and config.get('pointe_hours') and config['pointe_hours'][heure])
        if pointe and mois in MOIS_POINTE and jour_semaine != 0:
            return 'P'
    if est_hiver(mois):
        return 'HCH' if hc else 'HPH'
    return 'HCE' if hc else 'HPE'


def _dernier_dimanche_utc(annee, mois):
    """Changement d'heure UE : dernier dimanche du mois (0-11), 01:00 UTC."""
    suivant = datetime(annee + (1 if mois == 11 else 0), 1 if mois == 11 else mois + 2, 1, 1, 0, tzinfo=timezone.utc)
    dernier = suivant - timedelta(days=1)
    return dernier - timedelta(days=(dernier.weekday() + 1) % 7)


def horloge_murale(annee, pas_min, utc1):
    """index de pas -> (mois 0-11, jour de semaine 0=dimanche, heure) en heure murale."""
    origine = datetime(annee, 1, 1, tzinfo=timezone.utc)
    debut_ete = _dernier_dimanche_utc(annee, 2)
    fin_ete = _dernier_dimanche_utc(annee, 9)
    pas = timedelta(minutes=pas_min)
    heure = timedelta(hours=1)

    def lire(i):
        t = origine + i * pas
        if utc1:
            instant = t - heure
            t = instant + (2 if debut_ete <= instant < fin_ete else 1) * heure
        return t.month - 1, (t.weekday() + 1) % 7, t.hour
    return lire


def ventiler(series, annee, pas_min, utc1, tarif, config):
    """Séries de puissance (kW) -> kWh par plage (miroir de ventiler)."""
    plages = PLAGES_PAR_TARIF.get(tarif) or PLAGES_PAR_TARIF['C5_BASE']
    noms = list(series)
    kwh = {p: {n: 0.0 for n in noms} for p in plages}
    totaux = {n: 0.0 for n in noms}
    n = max((len(series[k]) for k in noms), default=0)
    dt = pas_min / 60.0
    horloge = horloge_murale(annee, pas_min, utc1)
    for i in range(n):
        mois, jour, h = horloge(i)
        plage = classer_plage(tarif, mois, jour, h, config)
        for nom in noms:
            serie = series[nom]
            e = (float(serie[i]) if i < len(serie) and serie[i] is not None else 0.0) * dt
            kwh[plage][nom] += e
            totaux[nom] += e
    return {'plages': plages, 'kwh': kwh, 'totaux': totaux}


# -------------------------------------------------------------------------------- outils financiers

def van(flux, taux):
    return sum(f / (1 + taux) ** t for t, f in enumerate(flux))


def tri(flux):
    """TRI par dichotomie sur [-99 %, 1000 %] ; None si la VAN ne change pas de signe."""
    bas, haut = -0.99, 10.0
    v_bas, v_haut = van(flux, bas), van(flux, haut)
    if not (math.isfinite(v_bas) and math.isfinite(v_haut)) or v_bas * v_haut > 0:
        return None
    for _ in range(200):
        milieu = (bas + haut) / 2
        v_milieu = van(flux, milieu)
        if v_milieu == 0:
            return milieu
        if v_bas * v_milieu < 0:
            haut = milieu
        else:
            bas, v_bas = milieu, v_milieu
    return (bas + haut) / 2


def annee_retour(lignes, cle, cle_gain):
    if lignes and lignes[0][cle] >= 0:
        return 0
    for i in range(1, len(lignes)):
        if lignes[i][cle] >= 0:
            avant = lignes[i - 1][cle]
            gain = lignes[i][cle_gain]
            return (i - 1) + (-avant / gain) if gain > 0 else i
    return None


def _arrondi(v, d):
    k = 10 ** d
    return math.floor(v * k + 0.5) / k   # Math.round JS : arrondi demi vers +infini


def calculer_rentabilite(p, energie):
    """Flux annuels et indicateurs (miroir de calculerRentabilite ; notations détaillées dans le JS)."""
    N = int(p['horizon'])
    pct = lambda v: (float(v) if v is not None else 0.0) / 100.0  # noqa: E731
    plages = energie['plages']
    irve_total = sum(energie['irve'].get(k, 0.0) for k in plages)
    pv_total1 = sum(energie['pv'].get(k, 0.0) for k in plages)
    e_utile = irve_total * pct(p['rendement'])
    pv_a_financer = p['pv_financement'] == 'a_financer'
    vente_surplus = p['surplus'] == 'vente'

    capex_bornes = p['capex_bornes']
    capex_total = p['capex_bornes'] + p['capex_installation'] + p['capex_raccordement'] + p['capex_gc'] + p['capex_etudes']
    aides = p['aide_advenir'] + p['aide_autres']
    investissement = capex_total - aides + (p['capex_pv'] if pv_a_financer else 0)
    opex_bornes = p['opex_maintenance'] + p['opex_supervision'] + p['opex_abonnement']
    taux = pct(p['actualisation'])

    lignes = [{
        'annee': 0, 'valeur': 0, 'cout_reseau': 0, 'economie_pv': 0, 'manque_surplus': 0, 'charges': 0, 'remplacement': 0,
        'flux': -investissement, 'cumul': -investissement, 'flux_actualise': -investissement, 'cumul_actualise': -investissement,
        'pv_kwh': 0, 'reseau_kwh': 0,
    }]
    flux = [-investissement]
    couts_actualises = 0.0
    energie_actualisee = 0.0

    for t in range(1, N + 1):
        facteur_pv = (1 - pct(p['degradation'])) ** (t - 1)
        idx_elec = (1 + pct(p['evol_elec'])) ** (t - 1)
        idx_vente = (1 + pct(p['evol_vente'])) ** (t - 1)
        idx_infl = (1 + pct(p['inflation'])) ** (t - 1)
        idx_carb = (1 + pct(p['evol_carburant'])) ** (t - 1)

        cout_reseau = economie_pv = pv_kwh = reseau_kwh = 0.0
        for k in plages:
            pv_k = energie['pv'].get(k, 0.0) * facteur_pv
            res_k = max(0.0, energie['irve'].get(k, 0.0) - pv_k)
            prix = p['prix'][k] * idx_elec
            cout_reseau += res_k * prix
            economie_pv += pv_k * prix
            pv_kwh += pv_k
            reseau_kwh += res_k
        manque_surplus = pv_kwh * p['prix_surplus'] if vente_surplus else 0.0

        if p['modele'] == 'payante':
            valeur = e_utile * p['prix_vente'] * idx_vente * (1 - pct(p['commission']))
        elif p['modele'] == 'flotte':
            valeur = e_utile * p['prix_reference'] * idx_vente
        else:
            km = e_utile / p['conso_ve'] * 100 if p['conso_ve'] > 0 else 0.0
            valeur = km * p['conso_th'] / 100 * p['prix_carburant'] * idx_carb + p['entretien_evite'] * idx_infl

        charges = opex_bornes * idx_infl + (p['opex_pv'] * idx_infl if pv_a_financer else 0.0)
        remplacement = capex_bornes * pct(p['remplacement']) * idx_infl if (t % p['duree_vie'] == 0 and t < N) else 0.0
        f = valeur - cout_reseau - manque_surplus - charges - remplacement
        actu = (1 + taux) ** t
        prec = lignes[t - 1]
        lignes.append({
            'annee': t, 'valeur': valeur, 'cout_reseau': cout_reseau, 'economie_pv': economie_pv, 'manque_surplus': manque_surplus,
            'charges': charges, 'remplacement': remplacement, 'flux': f, 'cumul': prec['cumul'] + f,
            'flux_actualise': f / actu, 'cumul_actualise': prec['cumul_actualise'] + f / actu,
            'pv_kwh': pv_kwh, 'reseau_kwh': reseau_kwh,
        })
        flux.append(f)
        couts_actualises += (cout_reseau + manque_surplus + charges + remplacement) / actu
        energie_actualisee += e_utile / actu

    t_ri = tri(flux)
    a1 = lignes[1] if len(lignes) > 1 else {}
    return {
        'lignes': lignes,
        'indicateurs': {
            'horizon': N,
            'capex_total': capex_total,
            'aides': aides,
            'investissement': investissement,
            'irve_kwh': irve_total,
            'pv_kwh': pv_total1,
            'reseau_kwh': max(0.0, irve_total - pv_total1),
            'utile_kwh': e_utile,
            'couverture_pv_pct': pv_total1 / irve_total * 100 if irve_total > 0 else 0,
            'economie_pv_an1': (a1.get('economie_pv') or 0) - (a1.get('manque_surplus') or 0),
            'flux_an1': a1.get('flux') or 0,
            'cumul_final': lignes[N]['cumul'],
            'van': _arrondi(van(flux, taux), 2),
            'tri_pct': None if t_ri is None else t_ri * 100,
            'retour_ans': annee_retour(lignes, 'cumul', 'flux'),
            'retour_actualise_ans': annee_retour(lignes, 'cumul_actualise', 'flux_actualise'),
            'cout_kwh_recharge': (investissement + couts_actualises) / energie_actualisee if energie_actualisee > 0 else None,
        },
    }


def energie_depuis_courbes(courbe, autoconso, tarif, config):
    """
    Énergie de l'année 1 par plage à partir des courbes ENREGISTRÉES (miroir de energieAnnee1 de la
    section) : courbe IRVE du bilan (heure murale) et part PV des bornes (UTC+1), la part PV d'une plage
    étant bornée par la consommation de cette plage.
    """
    annee = int(courbe.get('annee') or datetime.now().year)
    v_irve = ventiler({'irve': courbe['irve']}, annee, int(courbe['pas_temps_min']), False, tarif, config)
    pv = (autoconso or {}).get('pv_irve') or []
    v_pv = ventiler({'pv': pv}, annee, int(autoconso['pas_min']), True, tarif, config) if pv else None
    energie = {'plages': v_irve['plages'], 'irve': {}, 'pv': {}}
    for k in v_irve['plages']:
        energie['irve'][k] = v_irve['kwh'][k]['irve']
        energie['pv'][k] = min(v_pv['kwh'][k]['pv'], v_irve['kwh'][k]['irve']) if v_pv else 0.0
    return energie
