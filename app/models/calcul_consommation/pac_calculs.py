"""
Module PAC / climatiseur — calcul de RÉFÉRENCE (miroir Python des fichiers du navigateur).
=========================================================================================
Miroir exact, fonction par fonction, de :
  - Irve/pac_climatisation/pac_modele_cop.js      (COP / EER, puissance, charge partielle, dégivrage)
  - Irve/pac_climatisation/pac_dimensionnement.js (bâtiment, déperditions, ECS)
  - Irve/pac_climatisation/pac_simulation.js      (5R1C / 1R1C, ballon d'ECS, auxiliaires, synthèse)
  - Irve/pac_climatisation/pac_rentabilite.js     (système de référence, flux, indicateurs, CO2)
Les formules, leurs sources et leurs hypothèses sont documentées dans ces fichiers ; toute formule
modifiée l'est DES DEUX CÔTÉS (test de parité : vrai JS exécuté sous Node contre ce module).

Données de référence : les mêmes fichiers donnees/*.json que le navigateur (lus sur disque).
Arrondis : Math.round JS (demi vers +infini) reproduit par _round_js.
"""
import json
import math
import os
from datetime import date, timedelta
from functools import lru_cache

from app.models.calcul_consommation.rentabilite_irve import annee_retour, tri, van

ZERO_K = 273.15
RHO_C_AIR = 0.34
ORIENTATIONS = ('N', 'E', 'S', 'O')
REPARTITION_H_DEDUITE = {'ve': 0.25, 'fenetres': 0.2}
RELANCE_H = 2
TOLERANCE_CONFORT_K = 1
USAGES_ELEC = ('eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires')
GRANDEURS_Q = ('qChauffagePac', 'qChauffageAppoint', 'qFroid', 'qEcsPac', 'qEcsResistance')
SERIES = ('tAir',) + GRANDEURS_Q + USAGES_ELEC + ('tBallon',)
INF = math.inf

DOSSIER_DONNEES = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'concevoir_mon_projet',
                               'javascript', 'Irve', 'pac_climatisation', 'donnees')
FICHIERS = {'bat': 'batiment.json', 'emetteurs': 'emetteurs.json', 'ecs': 'ecs.json',
            'equip': 'equipements.json', 'deps': 'departements.json', 'eco': 'rentabilite.json'}


@lru_cache(maxsize=1)
def references():
    """Données de référence partagées avec le navigateur (donnees/*.json)."""
    ref = {}
    for cle, nom in FICHIERS.items():
        with open(os.path.join(DOSSIER_DONNEES, nom), encoding='utf-8') as f:
            ref[cle] = json.load(f)
    return ref


def _round_js(x):
    return math.floor(x + 0.5)


def _fini(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def trouver(liste, ident):
    return next((x for x in (liste or []) if x.get('id') == ident), None)


# =============================================================================================
# pac_modele_cop.js
# =============================================================================================
def interp_lin(xs, ys, x):
    n = len(xs)
    if n == 0:
        return math.nan
    if n == 1 or x <= xs[0]:
        return ys[0]
    if x >= xs[n - 1]:
        return ys[n - 1]
    for i in range(1, n):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[n - 1]


def carnot_chaud(te, tw, systeme, carnot):
    p_cond = carnot['pincement_condenseur_air_k'] if systeme == 'air_air' else carnot['pincement_condenseur_eau_k']
    t_cond = tw + p_cond + ZERO_K
    t_evap = te - carnot['pincement_evaporateur_air_k'] + ZERO_K
    return t_cond / max(carnot['ecart_minimal_k'], t_cond - t_evap)


def carnot_froid(te, tw, systeme, carnot):
    p_evap = carnot['pincement_evaporateur_air_interieur_k'] if systeme == 'air_air' else carnot['pincement_evaporateur_eau_k']
    t_evap = tw - p_evap + ZERO_K
    t_cond = te + carnot['pincement_condenseur_air_exterieur_k'] + ZERO_K
    return t_evap / max(carnot['ecart_minimal_k'], t_cond - t_evap)


def grouper_par_depart(points):
    groupes = {}
    for p in points:
        groupes.setdefault(_round_js(p['w']), []).append(p)
    return [{'w': w, 'pts': sorted(pts, key=lambda p: p['a'])} for w, pts in sorted(groupes.items())]


def interp_groupes(groupes, te, tw, valeur, hors_plage_t):
    par_groupe = []
    for g in groupes:
        xs = [p['a'] for p in g['pts']]
        if te < xs[0] or te > xs[-1]:
            par_groupe.append(hors_plage_t(g, te))
        else:
            par_groupe.append(interp_lin(xs, [valeur(p) for p in g['pts']], te))
    return interp_lin([g['w'] for g in groupes], par_groupe, tw)


def facteur_degivrage(te, hr, deg):
    if not deg or te <= deg['t_min'] or te >= deg['t_max']:
        return 1
    if te <= deg['t_pic']:
        tri_ = (te - deg['t_min']) / (deg['t_pic'] - deg['t_min'])
    else:
        tri_ = (deg['t_max'] - te) / (deg['t_max'] - deg['t_pic'])
    h = max(0, min(1, ((80 if hr is None else hr) - deg['humidite_debut_pct'])
                   / (deg['humidite_pleine_pct'] - deg['humidite_debut_pct'])))
    return 1 - (deg['perte_max_pct'] / 100) * tri_ * h


def facteur_charge_partielle(plr, modulation_min, cd):
    if not (plr > 0) or plr >= modulation_min or modulation_min <= 0:
        return 1
    cr = plr / modulation_min
    return cr / (cd * cr + 1 - cd)


def perte_liaisons_defaut(l, ref):
    r = ref['liaisons_frigorifiques']
    pct = (max(0, (l.get('longueur') or 0) - r['longueur_reference_m']) * r['pct_par_m']
           + abs(l.get('denivele') or 0) * r['pct_par_m_denivele']
           + (l.get('coudes90') or 0) * r['pct_par_coude_90']
           + (l.get('coudes180') or 0) * r['pct_par_coude_180'])
    return min(r['perte_max_pct'], pct)


class Modele:
    """creerModele() de pac_modele_cop.js. cfg : mode, systeme, points, puissanceNominaleKw, tExtMin,
    tExtMax, inclutDegivrage, perteLiaisonsPct, modulationMinPct, cd."""

    def __init__(self, cfg, ref):
        self.chaud = cfg['mode'] == 'chaud'
        self.mode = cfg['mode']
        self.systeme = cfg['systeme']
        self.carnot = ref['modele_carnot']
        self.carnot_fn = carnot_chaud if self.chaud else carnot_froid
        cle = 'cop' if self.chaud else 'eer'
        bornes = ref['puissance_selon_temperature']
        self.pente = (bornes['chaud_pct_par_k'] if self.chaud else bornes['froid_pct_par_k']) / 100
        self.bornes = bornes
        self.sens = 1 if self.chaud else -1
        self.t_ref = 7 if self.chaud else 35
        valides = [p for p in (cfg.get('points') or []) if _fini(p.get('a')) and _fini(p.get('w'))]
        pts_r = [{'a': p['a'], 'w': p['w'], 'eta': p[cle] / self.carnot_fn(p['a'], p['w'], self.systeme, self.carnot)}
                 for p in valides if _fini(p.get(cle)) and p[cle] > 0]
        pts_p = [p for p in valides if _fini(p.get('p_kw')) and p['p_kw'] > 0]
        self.groupes_eta = grouper_par_depart(pts_r)
        self.groupes_p = grouper_par_depart(pts_p)
        self.eta_defaut = self.carnot['eta_chaud_defaut'] if self.chaud else self.carnot['eta_froid_defaut']
        self.p_nominale = cfg.get('puissanceNominaleKw') or 0
        self.f_liaisons = 1 - max(0, min(100, cfg.get('perteLiaisonsPct') or 0)) / 100
        mod = cfg.get('modulationMinPct')
        self.modulation_min = max(0, min(100, ref['charge_partielle']['modulation_min_pct'] if mod is None else mod)) / 100
        cd = cfg.get('cd')
        self.cd = ref['charge_partielle']['cd'] if cd is None else cd
        self.deg = ref['degivrage'] if self.chaud and not cfg.get('inclutDegivrage') else None
        self.t_min = cfg.get('tExtMin')
        self.t_max = cfg.get('tExtMax')

    def _facteur_pente(self, dt):
        return max(self.bornes['borne_min'], min(self.bornes['borne_max'], 1 + self.sens * self.pente * dt))

    def _eta(self, te, tw):
        if not self.groupes_eta:
            return self.eta_defaut
        return interp_groupes(self.groupes_eta, te, tw, lambda p: p['eta'],
                              lambda g, t: g['pts'][0]['eta'] if t < g['pts'][0]['a'] else g['pts'][-1]['eta'])

    def _puissance_brute(self, te, tw):
        if not self.groupes_p:
            return self.p_nominale * self._facteur_pente(te - self.t_ref)

        def hors(g, t):
            bord = g['pts'][0] if t < g['pts'][0]['a'] else g['pts'][-1]
            return bord['p_kw'] * self._facteur_pente(t - bord['a'])
        return interp_groupes(self.groupes_p, te, tw, lambda p: p['p_kw'], hors)

    def en_plage(self, te):
        return (not _fini(self.t_min) or te >= self.t_min) and (not _fini(self.t_max) or te <= self.t_max)

    def capacite_kw(self, te, tw, hr):
        if not self.en_plage(te):
            return 0
        return max(0, self._puissance_brute(te, tw)) * self.f_liaisons * facteur_degivrage(te, hr, self.deg)

    def rendement(self, te, tw, hr, plr):
        pleine = self._eta(te, tw) * self.carnot_fn(te, tw, self.systeme, self.carnot)
        return (pleine * self.f_liaisons * facteur_degivrage(te, hr, self.deg)
                * facteur_charge_partielle(plr, self.modulation_min, self.cd))


def loi_deau(te, l):
    if te <= l['tBase']:
        t = l['departBase']
    elif te >= l['tNonChauffage']:
        t = l['departDoux']
    else:
        t = l['departBase'] + (l['departDoux'] - l['departBase']) * (te - l['tBase']) / (l['tNonChauffage'] - l['tBase'])
    return min(t, l['departMax']) if _fini(l.get('departMax')) else t


def eau_froide_mensuelle(t_moy_mens, t_an, ecs_ref):
    ef = ecs_ref['eau_froide']
    sortie = []
    for m in range(12):
        precedent = t_moy_mens[(m + 11) % 12]
        t = t_an + ef['amortissement'] * (precedent - t_an)
        sortie.append(max(ef['min_c'], min(ef['max_c'], t)))
    return sortie


# =============================================================================================
# pac_dimensionnement.js
# =============================================================================================
def renouvellement_equivalent(ventilation, n50, bat):
    n_vent = ventilation['renouvellement_vol_h'] * (1 - (ventilation.get('rendement_recuperation') or 0)) if ventilation else 0
    return n_vent + (n50 or 0) / bat['infiltration']['diviseur_n50']


def g_depuis_niveau(niveau, ventilation, bat):
    r = bat['maison_reference']
    v = r['surface_m2'] * r['hauteur_m']
    a_fen = r['surface_m2'] * r['part_vitree_surface_pct'] / 100
    a_mur = r['perimetre_m'] * r['hauteur_m'] - a_fen
    h_opaque = ((niveau['u_mur'] * a_mur + niveau['u_toit'] * r['surface_m2'] + niveau['u_sol'] * r['surface_m2'])
                * (1 + niveau['ponts_thermiques_pct'] / 100))
    h_tr = h_opaque + niveau['u_fenetre'] * a_fen
    h_ve = RHO_C_AIR * v * renouvellement_equivalent(ventilation, niveau['n50'], bat)
    return {'G': (h_tr + h_ve) / v, 'hTr': h_tr, 'hVe': h_ve, 'volume': v}


def surface_solaire_effective(a_fenetre, g_fenetre, bat):
    return a_fenetre * bat['vitrages']['part_vitree_cadre'] * g_fenetre * bat['vitrages']['facteur_ombrage_hiver']


def parametres_5r1c(surface, capacite_kj_m2k, bat):
    m = bat['modele_5r1c']
    return {'Cm': capacite_kj_m2k * 1000 * surface, 'aM': m['ratio_surface_masse'] * surface,
            'aT': m['ratio_surfaces_interieures'] * surface, 'hIs': m['h_is_w_m2k'], 'hMs': m['h_ms_w_m2k']}


def batiment_simplifie(e, bat):
    volume = e['surface'] * e['hauteur']
    H = e['G'] * volume
    a_fen = e['surface'] * e['partVitreePct'] / 100
    connu = _fini(e.get('uFenetre')) and _fini(e.get('renouvellementVolH'))
    h_ve = RHO_C_AIR * volume * e['renouvellementVolH'] if connu else REPARTITION_H_DEDUITE['ve'] * H
    h_tr_w = e['uFenetre'] * a_fen if connu else REPARTITION_H_DEDUITE['fenetres'] * H
    plafond = 0.9 * H
    if h_ve + h_tr_w > plafond:
        k = plafond / (h_ve + h_tr_w)
        h_ve *= k
        h_tr_w *= k
    h_tr_op = H - h_ve - h_tr_w
    a_sol = surface_solaire_effective(a_fen, e['gFenetre'], bat)
    b = {'modele': '5r1c', 'surface': e['surface'], 'volume': volume, 'H': H, 'hTrOp': h_tr_op, 'hTrW': h_tr_w,
         'hVe': h_ve, 'vitrages': {o: a_sol / 4 for o in ORIENTATIONS}}
    b.update(parametres_5r1c(e['surface'], e['capaciteKjM2K'], bat))
    return b


def batiment_detaille(pieces, env, ventilation, capacite_kj_m2k, bat):
    n_eq = renouvellement_equivalent(ventilation, env.get('n50'), bat)
    f_pt = 1 + env['ponts_thermiques_pct'] / 100
    vitrages = {o: 0 for o in ORIENTATIONS}
    surface = volume = h_op = h_w = 0
    detail = []
    for p in pieces:
        a_mur_brut = a_fen = 0
        for f in p.get('facades') or []:
            if f.get('orientation') not in ORIENTATIONS or not (f.get('longueur') or 0) > 0:
                continue
            brut = f['longueur'] * p['hauteur']
            fen = brut * (p.get('vitragePct') or 0) / 100
            a_mur_brut += brut
            a_fen += fen
            vitrages[f['orientation']] += surface_solaire_effective(fen, env['g_fenetre'], bat)
        a_mur = a_mur_brut - a_fen
        a_toit = p['surface'] if p.get('sousToiture') else 0
        a_sol = p['surface'] if p.get('surSol') else 0
        h_op_piece = (env['u_mur'] * a_mur + env['u_toit'] * a_toit + env['u_sol'] * a_sol) * f_pt
        h_w_piece = env['u_fenetre'] * a_fen
        v_piece = p['surface'] * p['hauteur']
        h_ve_piece = RHO_C_AIR * v_piece * n_eq
        surface += p['surface']
        volume += v_piece
        h_op += h_op_piece
        h_w += h_w_piece
        detail.append({'nom': p.get('nom', ''), 'surface': p['surface'], 'volume': v_piece, 'hTr': h_op_piece + h_w_piece,
                       'hVe': h_ve_piece, 'H': h_op_piece + h_w_piece + h_ve_piece})
    h_ve = RHO_C_AIR * volume * n_eq
    b = {'modele': '5r1c', 'surface': surface, 'volume': volume, 'H': h_op + h_w + h_ve, 'hTrOp': h_op, 'hTrW': h_w,
         'hVe': h_ve, 'vitrages': vitrages, 'pieces': detail}
    b.update(parametres_5r1c(surface, capacite_kj_m2k, bat))
    return b


def puissance_chauffage_base(H, t_int, t_base):
    return max(0, H * (t_int - t_base))


def gamme_chauffage(besoin_kw, avec_appoint):
    return {'min': 0.8 * besoin_kw, 'max': 1.1 * besoin_kw} if avec_appoint else {'min': besoin_kw, 'max': 1.2 * besoin_kw}


def gamme_froid(pointe_kw):
    return {'min': pointe_kw, 'max': 1.2 * pointe_kw}


def pertes_ballon_defaut(volume, ecs):
    t = ecs['pertes_ballon_defaut_kwh_24h']
    xs = [x['volume_l'] for x in t]
    ys = [x['pertes'] for x in t]
    if volume <= xs[0]:
        return ys[0] * volume / xs[0]
    for i in range(1, len(xs)):
        if volume <= xs[i]:
            return ys[i - 1] + (ys[i] - ys[i - 1]) * (volume - xs[i - 1]) / (xs[i] - xs[i - 1])
    return ys[-1] * volume / xs[-1]


def correction_altitude(altitude_site, altitude_meteo):
    if not _fini(altitude_site) or not _fini(altitude_meteo):
        return 0
    return -0.0065 * (altitude_site - altitude_meteo)


# =============================================================================================
# pac_simulation.js
# =============================================================================================
def calendrier(annee):
    jours = []
    d = date(int(annee), 1, 1)
    while len(jours) < 365:
        if not (d.month == 2 and d.day == 29):
            # getUTCDay : 0 = dimanche ; date.weekday() : 0 = lundi
            jours.append({'mois': d.month - 1, 'jourSemaine': (d.weekday() + 1) % 7, 'jour': d.day})
        d += timedelta(days=1)
    return jours


def dans_plage(h, debut, fin):
    if debut == fin:
        return False
    return (debut <= h < fin) if debut < fin else (h >= debut or h < fin)


class Modele1R1C:
    def __init__(self, b, t_init):
        self.ti = t_init
        self.H = max(b['H'], 1e-6)
        self.C = max(b['C'], 1)

    def _calculer(self, te, phi, dt):
        teq = te + phi / self.H
        return teq + (self.ti - teq) * math.exp(-dt * self.H / self.C)

    def t_air(self):
        return self.ti

    def essai(self, te, phi_int, phi_sol, phi_hc, dt):
        return self._calculer(te, phi_int + phi_sol + phi_hc, dt)

    def valider(self, te, phi_int, phi_sol, phi_hc, dt):
        self.ti = self._calculer(te, phi_int + phi_sol + phi_hc, dt)
        return self.ti


class Modele5R1C:
    def __init__(self, b, t_init):
        self.tm = t_init
        self.t_op = t_init
        self.h_ve = max(b['hVe'], 1e-3)
        self.h_tr_w = b['hTrW']
        self.h_tr_is = b['hIs'] * b['aT']
        self.h_tr_ms = b['hMs'] * b['aM']
        den = 1 / b['hTrOp'] - 1 / self.h_tr_ms if b['hTrOp'] > 0 else INF
        self.h_tr_em = 0 if not math.isfinite(den) else (1 / den if den > 1e-9 else 1e9)
        self.h_tr1 = 1 / (1 / self.h_ve + 1 / self.h_tr_is)
        self.h_tr2 = self.h_tr1 + self.h_tr_w
        self.h_tr3 = 1 / (1 / self.h_tr2 + 1 / self.h_tr_ms)
        self.f_masse = b['aM'] / b['aT']
        self.f_surface = max(0, 1 - self.f_masse - self.h_tr_w / (b['hMs'] * b['aT']))
        self.cm = b['Cm']

    def _calculer(self, te, phi_int, phi_sol, phi_hc, dt):
        t_sup = te
        phi_ia = 0.5 * phi_int + phi_hc
        gains = 0.5 * phi_int + phi_sol
        phi_st = self.f_surface * gains
        phi_m = self.f_masse * gains
        phi_m_tot = phi_m + self.h_tr_em * te + self.h_tr3 * (phi_st + self.h_tr_w * te + self.h_tr1 * (phi_ia / self.h_ve + t_sup)) / self.h_tr2
        cdt = self.cm / dt
        tm_fin = (self.tm * (cdt - 0.5 * (self.h_tr3 + self.h_tr_em)) + phi_m_tot) / (cdt + 0.5 * (self.h_tr3 + self.h_tr_em))
        tm_moy = 0.5 * (self.tm + tm_fin)
        ts = ((self.h_tr_ms * tm_moy + phi_st + self.h_tr_w * te + self.h_tr1 * (t_sup + phi_ia / self.h_ve))
              / (self.h_tr_ms + self.h_tr_w + self.h_tr1))
        t_air = (self.h_tr_is * ts + self.h_ve * t_sup + phi_ia) / (self.h_tr_is + self.h_ve)
        return 0.3 * t_air + 0.7 * ts, tm_fin

    def t_air(self):
        return self.t_op

    def essai(self, te, phi_int, phi_sol, phi_hc, dt):
        return self._calculer(te, phi_int, phi_sol, phi_hc, dt)[0]

    def valider(self, te, phi_int, phi_sol, phi_hc, dt):
        self.t_op, self.tm = self._calculer(te, phi_int, phi_sol, phi_hc, dt)
        return self.t_op


def simuler(e):
    """simuler() de pac_simulation.js (mêmes clés d'entrée ; modèles = instances de Modele)."""
    pas = e['pasMin']
    dt_s = pas * 60
    dt_h = pas / 60
    par_jour = 1440 // pas
    n = 365 * par_jour
    cal = calendrier(e['annee'])
    met = e['meteo']
    b = e['batiment']
    cons = e['consignes']
    us = e['usages']
    ap = e['apports']
    ecs = e.get('ecs') if us.get('ecs') else None
    aux = e.get('aux') or {}
    appoint = e.get('appoint') or {'puissanceKw': 0, 'tBivalence': -99}
    ideal = bool(e.get('ideal'))
    chaud = e.get('chaud')
    froid = e.get('froid')
    systeme = e.get('systeme')

    t_init = cons['chauffage']
    bm = Modele5R1C(b, t_init) if b['modele'] == '5r1c' else Modele1R1C(b, t_init)
    phi_test = 10 * b['surface']

    sortie = {k: [0.0] * n for k in SERIES}
    c_ballon = ecs['volume'] * 1.163 if ecs else 0
    ua_ballon = ecs['pertesKwh24h'] * 1000 / 24 / 45 if ecs else 0
    etat = {'tBallon': ecs['consigne'] if ecs else 0, 'enCharge': False, 'antileg': False, 'hEcs': 0.0}
    h_inconf_chaud = 0.0
    h_inconf_froid = 0.0
    consigne_precedente = None
    relance_restante = 0
    aux_arret = [0.0] * n
    mois_actifs = [False] * 12
    mod_min_chaud = chaud.modulation_min if chaud else 0
    mod_min_froid = froid.modulation_min if froid else 0
    temp = met['temperature']
    hum = met.get('humidite')
    irr = met['irradiation']
    vit = b['vitrages']
    priorite_ecs = (ecs.get('priorite') is not False) if ecs else False
    al = ecs.get('antilegionelle') if ecs else None

    prechauffe = 14 * par_jour
    for k in range(-prechauffe, n):
        i = (k + n) % n
        enregistrer = k >= 0
        te = temp[i]
        hr = hum[i] if hum else 80
        jour = cal[i // par_jour]
        minute = (i % par_jour) * pas
        heure = minute // 60
        weekend = jour['jourSemaine'] in (0, 6)
        absent = bool(cons.get('absenceSemaine')) and not weekend and dans_plage(heure, cons['absenceDebut'], cons['absenceFin'])

        consigne_chaud = cons['reduit'] if (dans_plage(heure, cons['reduitDebut'], cons['reduitFin'])
                                            or (absent and cons.get('reduitEnAbsence'))) else cons['chauffage']
        consigne_froid = INF if (cons.get('froidSeulementPresence') and absent) else cons['froid']
        if consigne_precedente is not None and consigne_chaud > consigne_precedente:
            relance_restante = RELANCE_H
        consigne_precedente = consigne_chaud

        occupants = 0 if absent else cons['occupants']
        phi_int = ap['appareilsWm2'] * b['surface'] + occupants * ap['occupantSensibleW']
        f_sol = ap['facteurEte'] if bm.t_air() > cons['froid'] - 1 else 1
        phi_sol = f_sol * (vit['N'] * irr['N'][i] + vit['E'] * irr['E'][i] + vit['S'] * irr['S'][i] + vit['O'] * irr['O'][i])

        f_ecs = q_ecs_pac = q_ecs_res = e_ecs = 0
        tw_ecs = cap_ecs_w = 0
        ecs_prete = None
        if ecs:
            t_ef = ecs['eauFroideMensuelle'][jour['mois']]
            q_puisage = ecs['litresJour'] * ecs['profil'][heure] * (pas / 60) * 1.163 * max(0, ecs['tUsage'] - t_ef)
            q_pertes = ua_ballon * (etat['tBallon'] - ecs['tAmbiance']) * dt_h
            if al and al.get('actif') and jour['jourSemaine'] == al['jourSemaine'] and heure == al['heure'] and minute % 60 == 0:
                etat['antileg'] = True
            plage = ecs.get('plage')
            plage_ok = not plage or dans_plage(heure, plage['debut'], plage['fin'])
            t_ballon = etat['tBallon']
            if (t_ballon < ecs['consigne'] - ecs['hysteresis'] and plage_ok) or t_ballon < ecs['tUsage'] or etat['antileg']:
                etat['enCharge'] = True
            cible = max(ecs['consigne'], al['temperature']) if etat['antileg'] else ecs['consigne']
            t_max_pac = ecs['tEauMaxPac']
            pac_possible = bool(chaud) and chaud.en_plage(te)
            tw_ecs = min(t_max_pac + 5, t_ballon + 5)
            cap_ecs_w = chaud.capacite_kw(te, tw_ecs, hr) * 1000 if pac_possible else 0

            def ecs_prete(fraction, q_puisage=q_puisage, q_pertes=q_pertes, cible=cible, t_max_pac=t_max_pac, cap=cap_ecs_w):
                q_pac = q_res = 0
                tb = etat['tBallon']
                if etat['enCharge']:
                    besoin = c_ballon * (cible - tb) + q_puisage + q_pertes
                    besoin_pac = max(0, c_ballon * (min(cible, t_max_pac) - tb) + q_puisage + q_pertes)
                    q_pac = max(0, min(besoin_pac, cap * dt_h * fraction))
                    reste = max(0, besoin - q_pac)
                    res_autorisee = cible > t_max_pac or cap == 0 or tb < ecs['tUsage']
                    if res_autorisee and ecs['resistanceKw'] > 0:
                        q_res = min(reste, ecs['resistanceKw'] * 1000 * dt_h)
                f = q_pac / (cap * dt_h) if cap > 0 else 0
                return q_pac, q_res, f, q_puisage, q_pertes

        def appliquer_ecs(r):
            nonlocal q_ecs_pac, q_ecs_res, f_ecs, e_ecs
            q_ecs_pac, q_ecs_res, f_ecs, q_p, q_l = r
            e_ecs = q_ecs_pac / chaud.rendement(te, tw_ecs, hr, 1) if q_ecs_pac > 0 else 0
            tb = etat['tBallon'] + (q_ecs_pac + q_ecs_res - q_p - q_l) / c_ballon
            tb = max(tb, ecs['eauFroideMensuelle'][jour['mois']])
            etat['tBallon'] = tb
            if tb < ecs['tUsage']:
                etat['hEcs'] += dt_h if enregistrer else 0
            cible_finale = max(ecs['consigne'], al['temperature']) if etat['antileg'] else ecs['consigne']
            if tb >= cible_finale - 1e-6:
                etat['enCharge'] = False
                etat['antileg'] = False

        if ecs and priorite_ecs:
            appliquer_ecs(ecs_prete(1))

        t0 = bm.essai(te, phi_int, phi_sol, 0, dt_s)
        phi = q_pac = q_app = q_froid = 0
        e_chauffage = e_froid = 0
        espace_actif = False
        taux_marche = 0
        if us.get('chauffage') and t0 < consigne_chaud:
            espace_actif = True
            t10 = bm.essai(te, phi_int, phi_sol, phi_test, dt_s)
            besoin = max(0, phi_test * (consigne_chaud - t0) / (t10 - t0))
            if ideal:
                q_pac = besoin
            else:
                tw = loi_deau(te, e['loiDeau']) if systeme == 'air_eau' else e['puitsChaud']
                cap_w = chaud.capacite_kw(te, tw, hr) * 1000 if chaud else 0
                cap_dispo = cap_w * max(0, 1 - f_ecs)
                q_pac = min(besoin, cap_dispo)
                appoint_ok = appoint['puissanceKw'] > 0 and (te <= appoint['tBivalence'] or cap_w == 0)
                q_app = min(besoin - q_pac, appoint['puissanceKw'] * 1000) if appoint_ok else 0
                plr = q_pac / cap_dispo if cap_dispo > 0 else 0
                if q_pac > 0:
                    e_chauffage = q_pac / chaud.rendement(te, tw, hr, plr) * dt_h
                    taux_marche = (1 if plr >= mod_min_chaud else plr / mod_min_chaud) * (1 - f_ecs)
            phi = q_pac + q_app
        elif us.get('froid') and t0 > consigne_froid:
            espace_actif = True
            t10 = bm.essai(te, phi_int, phi_sol, -phi_test, dt_s)
            besoin = max(0, phi_test * (t0 - consigne_froid) / (t0 - t10))
            if ideal:
                q_froid = besoin
            else:
                tw = e['departFroid']
                cap_w = froid.capacite_kw(te, tw, hr) * 1000 if froid else 0
                cap_dispo = cap_w * max(0, 1 - f_ecs)
                q_froid = min(besoin, cap_dispo)
                plr = q_froid / cap_dispo if cap_dispo > 0 else 0
                if q_froid > 0:
                    e_froid = q_froid / froid.rendement(te, tw, hr, plr) * dt_h
                    taux_marche = (1 if plr >= mod_min_froid else plr / mod_min_froid) * (1 - f_ecs)
            phi = -q_froid

        if ecs and not priorite_ecs:
            appliquer_ecs(ecs_prete(max(0, 1 - taux_marche)))

        t_fin = bm.valider(te, phi_int, phi_sol, phi, dt_s)
        if enregistrer:
            if us.get('chauffage') and relance_restante <= 0 and t_fin < consigne_chaud - TOLERANCE_CONFORT_K:
                h_inconf_chaud += dt_h
            if us.get('froid') and math.isfinite(consigne_froid) and t_fin > consigne_froid + TOLERANCE_CONFORT_K:
                h_inconf_froid += dt_h
        relance_restante -= dt_h

        p_aux_marche = p_aux_arret = 0
        if not ideal:
            marche = min(1, f_ecs + taux_marche)
            if systeme == 'air_eau':
                p_aux_marche += (aux.get('circulateurW') or 0) * (1 if espace_actif else f_ecs)
            else:
                p_aux_marche += (aux.get('ventilateurW') or 0) * (aux.get('nbUnitesInterieures') or 1) * (1 if espace_actif else 0)
            seuil = aux.get('carterSeuilC')
            if te < (10 if seuil is None else seuil):
                p_aux_arret += (aux.get('carterW') or 0) * (1 - marche)
            p_aux_arret += (aux.get('veilleW') or 0) * (1 - marche)

        if enregistrer:
            sortie['tAir'][i] = bm.t_air()
            sortie['qChauffagePac'][i] = q_pac / 1000
            sortie['qChauffageAppoint'][i] = q_app / 1000
            sortie['qFroid'][i] = q_froid / 1000
            sortie['qEcsPac'][i] = q_ecs_pac / dt_h / 1000
            sortie['qEcsResistance'][i] = q_ecs_res / dt_h / 1000
            sortie['eChauffage'][i] = e_chauffage / dt_h / 1000
            sortie['eFroid'][i] = e_froid / dt_h / 1000
            sortie['eEcs'][i] = e_ecs / dt_h / 1000
            sortie['eAppoint'][i] = q_app / 1000 + q_ecs_res / dt_h / 1000
            sortie['eAuxiliaires'][i] = p_aux_marche / 1000
            aux_arret[i] = p_aux_arret / 1000
            if q_pac > 0 or q_app > 0 or q_froid > 0 or q_ecs_pac > 0 or q_ecs_res > 0:
                mois_actifs[jour['mois']] = True
            sortie['tBallon'][i] = etat['tBallon']

    hors_tension = aux.get('horsTensionHorsSaison')
    ea = sortie['eAuxiliaires']
    for i in range(n):
        if not hors_tension or mois_actifs[cal[i // par_jour]['mois']]:
            ea[i] += aux_arret[i]
    sortie['heuresEcsInconfort'] = etat['hEcs']
    sortie['heuresInconfortChaud'] = h_inconf_chaud
    sortie['heuresInconfortFroid'] = h_inconf_froid
    sortie['pasMin'] = pas
    sortie['annee'] = e['annee']
    return sortie


def synthese(s):
    pas = s['pasMin']
    dt_h = pas / 60
    par_jour = 1440 // pas
    cal = calendrier(s['annee'])
    cles = USAGES_ELEC + GRANDEURS_Q
    mensuel = {k: [0.0] * 12 for k in cles}
    annuel = {k: 0.0 for k in cles}
    n = len(s['eChauffage'])
    pointe = 0
    for i in range(n):
        m = cal[i // par_jour]['mois']
        for k in cles:
            v = s[k][i] * dt_h
            mensuel[k][m] += v
            annuel[k] += v
        total = 0
        for k in USAGES_ELEC:
            total += s[k][i]
        if total > pointe:
            pointe = total
    e_total = 0
    for k in USAGES_ELEC:
        e_total += annuel[k]
    chaleur_pac = annuel['qChauffagePac'] + annuel['qEcsPac']
    chaleur_totale = chaleur_pac + annuel['qChauffageAppoint'] + annuel['qEcsResistance']
    elec_chaleur = annuel['eChauffage'] + annuel['eEcs'] + annuel['eAppoint']
    return {
        'mensuel': mensuel, 'annuel': annuel, 'eTotal': e_total, 'pointeKw': pointe,
        'scopChauffage': annuel['qChauffagePac'] / annuel['eChauffage'] if annuel['eChauffage'] > 0 else None,
        'seerSimule': annuel['qFroid'] / annuel['eFroid'] if annuel['eFroid'] > 0 else None,
        'performanceGlobaleChaud': chaleur_totale / (elec_chaleur + annuel['eAuxiliaires']) if elec_chaleur > 0 else None,
        'couverturePac': chaleur_pac / chaleur_totale if chaleur_totale > 0 else None,
        'heuresInconfortChaud': s['heuresInconfortChaud'],
        'heuresInconfortFroid': s['heuresInconfortFroid'],
        'heuresEcsInconfort': s['heuresEcsInconfort'],
    }


def serie_pac(sim):
    """seriePac() de pac_section.js : puissance électrique totale par pas, arrondie au dix-millième."""
    n = len(sim['eChauffage'])
    sortie = [0.0] * n
    for i in range(n):
        t = 0
        for k in USAGES_ELEC:
            t += sim[k][i]
        sortie[i] = _round_js(t * 10000) / 10000
    return sortie


# =============================================================================================
# Orchestration (miroir de calculer() de pac_section.js, à partir de la requête de vérification)
# =============================================================================================
def construire_batiment(req, modele_chaud, t_base, tw_base, ref):
    """construireBatiment() : 'aucun' (ECS seule), 'detaille', 'simplifie' ou 'deduit'."""
    bat = ref['bat']
    bt = req['batiment']
    methode = bt['methode']
    if methode == 'aucun':
        return {'modele': '1r1c', 'surface': 1, 'volume': 1, 'H': 1, 'C': 1e6, 'vitrages': {o: 0 for o in ORIENTATIONS}}
    inertie = trouver(bat['inerties']['classes'], bt.get('inertie_id'))
    capacite = inertie['capacite_kj_m2k'] if inertie else 130
    if methode == 'detaille':
        return batiment_detaille(bt['pieces'], bt['env'], bt['ventilation'], capacite, bat)
    u_fenetre = renouvellement = None
    if methode == 'simplifie':
        niveau = trouver(bat['niveaux_isolation'], bt['niveau_id'])
        ventilation = trouver(bat['ventilations'], bt['ventilation_id'])
        G = bt['g'] if bt.get('g') is not None else g_depuis_niveau(niveau, ventilation, bat)['G']
        u_fenetre = niveau['u_fenetre']
        renouvellement = renouvellement_equivalent(ventilation, niveau['n50'], bat)
    else:  # deduit
        taux = bt['taux_dim'] / 100
        volume = bt['surface'] * bt['hauteur']
        cap = modele_chaud.capacite_kw(t_base, tw_base, 80) * 1000
        H = cap / taux / max(1, (bt['consigne_chauffage'] if bt.get('consigne_chauffage') is not None else 20) - t_base)
        G = H / volume
    return batiment_simplifie({'surface': bt['surface'], 'hauteur': bt['hauteur'], 'G': G, 'capaciteKjM2K': capacite,
                               'partVitreePct': bt['vitrage_pct'], 'gFenetre': bt['g_fenetre'], 'uFenetre': u_fenetre,
                               'renouvellementVolH': renouvellement}, bat)


def calculer_simulation(req, meteo_brute, ref=None):
    """Recalcule dimensionnement + simulation + synthèse depuis la requête de vérification.
    meteo_brute : réponse de serie_meteo_pac() (températures non corrigées de l'altitude)."""
    ref = ref or references()
    dT = correction_altitude(req.get('altitude_site_m'), meteo_brute.get('altitude_meteo_m'))
    met = dict(meteo_brute)
    met['temperature'] = [t + dT for t in meteo_brute['temperature']] if dT else meteo_brute['temperature']
    usages = req['usages']
    avec_espace = usages['chauffage'] or usages['froid']
    t_base = req['tbase_hiver']
    cfg = req['modeles']
    modele_chaud = Modele(cfg['chaud'], ref['equip']) if cfg.get('chaud') else None
    modele_froid = Modele(cfg['froid'], ref['equip']) if cfg.get('froid') else None
    loi = req.get('loi_deau')
    tw_base = loi_deau(t_base, loi) if loi else req['puits_chaud']
    b = construire_batiment(req, modele_chaud, t_base, tw_base, ref)

    bat = ref['bat']
    apports = {'appareilsWm2': req['apports']['appareilsWm2'], 'occupantSensibleW': bat['apports_internes']['occupant_sensible_w'],
               'facteurEte': bat['vitrages']['facteur_protection_ete'] / bat['vitrages']['facteur_ombrage_hiver']}
    consignes = dict(req['consignes'])
    if not usages['froid']:
        consignes['froid'] = 99
    commun = {'pasMin': req['meteo']['pas_minutes'], 'annee': req['meteo']['annee'], 'meteo': met, 'batiment': b,
              'apports': apports, 'consignes': consignes, 'systeme': req['systeme'], 'loiDeau': loi,
              'puitsChaud': req['puits_chaud'], 'departFroid': req['depart_froid']}

    sim_besoins = None
    if avec_espace:
        cc = dict(consignes, reduit=consignes['chauffage'], reduitEnAbsence=False)
        sim_besoins = simuler(dict(commun, consignes=cc, usages={'chauffage': usages['chauffage'], 'froid': usages['froid'], 'ecs': False}, ideal=True))
    t_int = consignes['chauffage']
    besoin_base_kw = puissance_chauffage_base(b['H'], t_int, t_base) / 1000 if usages['chauffage'] else 0
    pointe = lambda arr: max([0] + list(arr)) if arr else 0  # noqa: E731
    pointe_chaud = pointe(sim_besoins['qChauffagePac']) if sim_besoins else 0
    pointe_froid = pointe(sim_besoins['qFroid']) if sim_besoins else 0

    ecs = None
    if usages['ecs']:
        e = req['ecs']
        profil = ref['ecs']['profils_puisage'].get(e['profil_id']) or ref['ecs']['profils_puisage']['standard']
        t_moy = [t + dT for t in meteo_brute['temperatures_moyennes_mensuelles']]
        t_an = meteo_brute['temperature_moyenne_annuelle'] + dT
        ecs = {
            'litresJour': e['litresJour'], 'profil': profil['fractions'], 'tUsage': e['tUsage'], 'consigne': e['consigne'],
            'hysteresis': e['hysteresis'], 'volume': e['volume'],
            'pertesKwh24h': e['pertesKwh24h'] if e.get('pertesKwh24h') is not None else pertes_ballon_defaut(e['volume'], ref['ecs']),
            'tAmbiance': e['tAmbiance'], 'eauFroideMensuelle': eau_froide_mensuelle(t_moy, t_an, ref['ecs']),
            'resistanceKw': e['resistanceKw'], 'tEauMaxPac': e['tEauMaxPac'], 'plage': e.get('plage'),
            'antilegionelle': dict(e['antilegionelle'], temperature=ref['ecs']['antilegionelle']['temperature_c']),
            'priorite': e['priorite'],
        }
    entree = dict(commun, usages=usages, chaud=modele_chaud, froid=modele_froid, appoint=req['appoint'], ecs=ecs, aux=req['aux'])
    sim = simuler(entree)
    syn = synthese(sim)
    pac = serie_pac(sim)
    resultat = {
        'synthese': syn,
        'dimensionnement': {
            'H': b['H'], 'volume': b['volume'], 'besoinBaseKw': besoin_base_kw,
            'pointeChaudDynKw': pointe_chaud, 'pointeFroidKw': pointe_froid,
            'gammeCh': gamme_chauffage(besoin_base_kw, req['appoint']['puissanceKw'] > 0) if usages['chauffage'] else None,
            'gammeFr': gamme_froid(pointe_froid) if usages['froid'] else None,
        },
        'bilan_pac_kwh': sum(pac) * req['meteo']['pas_minutes'] / 60,
    }
    return resultat, sim


# =============================================================================================
# pac_rentabilite.js
# =============================================================================================
def serie_pac_comparee(sim, froid_compare):
    n = len(sim['eChauffage'])
    sortie = [0.0] * n
    for i in range(n):
        t = 0
        for k in USAGES_ELEC:
            if k != 'eFroid' or froid_compare:
                t += sim[k][i]
        sortie[i] = t
    return sortie


def consommation_reference(sim, pas_min, choix, ref):
    dt_h = pas_min / 60
    sys_ = trouver(ref['systemes_chauffage'], choix['chauffage']) or ref['systemes_chauffage'][0]
    eta_ch = choix['rendementChauffage'] if (choix.get('rendementChauffage') or 0) > 0 else sys_['rendement']
    ecs_elec = sys_['energie'] == 'elec' or choix.get('ecs') == 'electrique'
    sys_ecs = trouver(ref['systemes_ecs'], 'electrique' if ecs_elec else 'chaudiere')
    eta_ecs = choix['rendementEcs'] if (not ecs_elec and (choix.get('rendementEcs') or 0) > 0) else sys_ecs['rendement']
    seer = choix['seer'] if choix.get('froid') == 'clim' and (choix.get('seer') or 0) > 0 else None
    n = len(sim['eChauffage'])
    elec_serie = [0.0] * n
    utile = {'chauffage': 0.0, 'ecs': 0.0, 'froid': 0.0}
    comb_ch = comb_ecs = elec_ecs = elec_ch = elec_froid = 0.0
    for i in range(n):
        q_ch = sim['qChauffagePac'][i] + sim['qChauffageAppoint'][i]
        q_ecs = sim['qEcsPac'][i] + sim['qEcsResistance'][i]
        q_fr = sim['qFroid'][i]
        utile['chauffage'] += q_ch * dt_h
        utile['ecs'] += q_ecs * dt_h
        utile['froid'] += q_fr * dt_h
        if sys_['energie'] == 'elec':
            elec_serie[i] += q_ch / eta_ch
            elec_ch += q_ch / eta_ch * dt_h
        else:
            comb_ch += q_ch / eta_ch * dt_h
        if ecs_elec:
            elec_ecs += q_ecs / eta_ecs * dt_h
        else:
            comb_ecs += q_ecs / eta_ecs * dt_h
        if seer:
            elec_serie[i] += q_fr / seer
            elec_froid += q_fr / seer * dt_h
    pci = comb_ch + comb_ecs
    conv = ref['conversions']
    return {
        'systeme': sys_, 'ecsElectrique': ecs_elec, 'rendements': {'chauffage': eta_ch, 'ecs': eta_ecs, 'seer': seer},
        'utile': utile, 'elecSerie': elec_serie, 'elecEcsKwh': elec_ecs, 'elecChKwh': elec_ch, 'elecFroidKwh': elec_froid,
        'combustiblePciKwh': {'chauffage': comb_ch, 'ecs': comb_ecs, 'total': pci},
        'gazPcsKwh': pci * conv['pcs_sur_pci_gaz_naturel'] if sys_['energie'] == 'gaz' else 0,
        'fioulLitres': pci / conv['fioul_kwh_pci_par_litre'] if sys_['energie'] == 'fioul' else 0,
        'energie': sys_['energie'],
    }


def emissions(annuel, conso_ref, froid_compare, part_reseau, f):
    """conso_ref : {energie, elecChKwh, elecEcsKwh, elecFroidKwh, combustiblePciKwh: {total}}."""
    pac_ch = annuel['eChauffage'] + annuel['qChauffageAppoint'] + annuel['eAuxiliaires']
    pac_ecs = annuel['eEcs'] + annuel['qEcsResistance']
    pac_fr = annuel['eFroid'] if froid_compare else 0
    pac = (pac_ch * f['elec_chauffage'] + pac_ecs * f['elec_ecs'] + pac_fr * f['elec_froid']) * part_reseau
    comb = f['gaz'] if conso_ref['energie'] == 'gaz' else f['fioul'] if conso_ref['energie'] == 'fioul' else 0
    ref_ = (conso_ref['elecChKwh'] * f['elec_chauffage'] + conso_ref['elecEcsKwh'] * f['elec_ecs']
            + conso_ref['elecFroidKwh'] * f['elec_froid'] + conso_ref['combustiblePciKwh']['total'] * comb)
    return {'pac': pac, 'ref': ref_, 'evite': ref_ - pac}


def _pct(v):
    return (v or 0) / 100


def calculer_rentabilite(p, e):
    """calculerRentabilite() de pac_rentabilite.js."""
    N = p['horizon']
    plages = e['plages']
    somme = lambda o: sum((o.get(k) or 0) for k in plages)  # noqa: E731
    cout_plages = lambda o: sum((o.get(k) or 0) * (p['prix'].get(k) or 0) for k in plages)  # noqa: E731
    pac_kwh = somme(e['pac'])
    pac_brut = cout_plages(e['pac'])
    prix_moy = pac_brut / pac_kwh if pac_kwh > 0 else 0
    ref_elec_kwh = somme(e['ref_elec'])
    ref_elec_cout = cout_plages(e['ref_elec'])
    investissement = p['capex_materiel'] + p['capex_travaux'] - p['aides'] - p['cout_evite']
    taux = _pct(p['actualisation'])
    abonnement_gaz = p['abonnement_gaz'] if e['gaz'] and p['resiliation_gaz'] else 0
    pv = e.get('pv_kwh') or 0

    lignes = [{'annee': 0, 'cout_ref': 0, 'cout_pac': 0, 'economie_pv': 0, 'remplacement': 0, 'flux': -investissement,
               'cumul': -investissement, 'flux_actualise': -investissement, 'cumul_actualise': -investissement}]
    flux = [-investissement]
    ref_actualise = 0
    pac_actualise = investissement
    for t in range(1, N + 1):
        idx_elec = (1 + _pct(p['evol_elec'])) ** (t - 1)
        idx_gaz = (1 + _pct(p['evol_gaz'])) ** (t - 1)
        idx_fioul = (1 + _pct(p['evol_fioul'])) ** (t - 1)
        idx_infl = (1 + _pct(p['inflation'])) ** (t - 1)
        pv_t = min(pac_kwh, pv * (1 - _pct(p['degradation'])) ** (t - 1))
        economie_pv = pv_t * prix_moy * idx_elec
        detail = {
            'pac_energie': pac_brut * idx_elec - economie_pv,
            'pac_surplus': pv_t * p['prix_surplus'],
            'pac_abonnement': p['surcout_abonnement'] * idx_elec,
            'pac_entretien': p['entretien_pac'] * idx_infl,
            'ref_energie': ref_elec_cout * idx_elec + e['gaz_pcs_kwh'] * p['prix_gaz'] * idx_gaz + e['fioul_litres'] * p['prix_fioul'] * idx_fioul,
            'ref_abonnement': abonnement_gaz * idx_gaz,
            'ref_entretien': p['entretien_ref'] * idx_infl,
        }
        cout_pac = detail['pac_energie'] + detail['pac_surplus'] + detail['pac_abonnement'] + detail['pac_entretien']
        cout_ref = detail['ref_energie'] + detail['ref_abonnement'] + detail['ref_entretien']
        remplacement = p['capex_materiel'] * _pct(p['remplacement']) * idx_infl if (t % p['duree_vie'] == 0 and t < N) else 0
        f = cout_ref - cout_pac - remplacement
        actu = (1 + taux) ** t
        prec = lignes[t - 1]
        ligne = {'annee': t, 'cout_ref': cout_ref, 'cout_pac': cout_pac, 'economie_pv': economie_pv, 'remplacement': remplacement,
                 'flux': f, 'cumul': prec['cumul'] + f, 'flux_actualise': f / actu, 'cumul_actualise': prec['cumul_actualise'] + f / actu,
                 'pv_kwh': pv_t, 'reseau_kwh': pac_kwh - pv_t}
        ligne.update(detail)
        lignes.append(ligne)
        flux.append(f)
        ref_actualise += cout_ref / actu
        pac_actualise += (cout_pac + remplacement) / actu

    tri_ = tri(flux)
    a1 = lignes[1] if len(lignes) > 1 else {}
    return {
        'lignes': lignes,
        'indicateurs': {
            'horizon': N, 'investissement': investissement, 'pac_kwh': pac_kwh, 'pv_kwh': min(pac_kwh, pv),
            'reseau_kwh': max(0, pac_kwh - pv), 'prix_moyen_pac': prix_moy, 'ref_elec_kwh': ref_elec_kwh,
            'ref_gaz_pcs_kwh': e['gaz_pcs_kwh'], 'ref_fioul_litres': e['fioul_litres'],
            'cout_ref_an1': a1.get('cout_ref', 0), 'cout_pac_an1': a1.get('cout_pac', 0),
            'economie_an1': a1.get('cout_ref', 0) - a1.get('cout_pac', 0), 'economie_pv_an1': a1.get('economie_pv', 0),
            'cumul_final': lignes[N]['cumul'], 'cout_global_ref': ref_actualise, 'cout_global_pac': pac_actualise,
            'van': math.floor(van(flux, taux) * 100 + 0.5) / 100,
            'tri_pct': None if tri_ is None else tri_ * 100,
            'retour_ans': annee_retour(lignes, 'cumul', 'flux'),
            'retour_actualise_ans': annee_retour(lignes, 'cumul_actualise', 'flux_actualise'),
        },
    }


def investissement_defaut(type_, nb_unites, ref):
    d = ref['investissement_defaut']
    n = max(1, _round_js(nb_unites or 1))
    if type_ == 'air_eau':
        return d['air_eau']
    if type_ == 'clim':
        return d['clim_premiere_unite'] + (n - 1) * d['clim_unite_supplementaire']
    return d['air_air_premiere_unite'] + (n - 1) * d['air_air_unite_supplementaire']
