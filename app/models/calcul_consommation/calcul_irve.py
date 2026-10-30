"""
Bilan de puissance et énergie consommée des bornes IRVE — calculs de référence (vérification des
calculs du navigateur, cf. routes/irve_verification.py ; écart admis 0,01).

  - bilan_puissance_brut()  : miroir de calculateBilanPuissance() (Irve/calcul_irve.js) ;
  - compute_bilan_puissance(): même calcul, valeurs arrondies (analyse d'autonomie) ;
  - simuler_energie_irve()  : miroir du cœur numérique de calculateEnergie() (Irve/calcul_irve.js) :
    profil journalier par segment (puissance apparente et active consommée, rendement compris),
    plafonnement par la puissance souscrite et la limitation IRVE, besoin cible en kWh, moyenne
    horaire, énergie mensuelle et annuelle, bilan site / IRVE.

Toute formule modifiée d'un côté doit l'être de l'autre.
"""

import math


def bilan_puissance_brut(irve_data, params):
    """
    irve_data: liste de dicts {puissance (kW), pdc (nb Pdc/borne), quantite, type ('AC'|'DC'),
               tension (ex. "230V_M"/"400V_T"/"autre"), customTension}
    params: {ks, kmono, ktri, kdc, cosphi_ac, cosphi_dc, puissance_aux} — valeurs effectives (après
            les valeurs par défaut du formulaire).
    Renvoie les valeurs NON arrondies.
    """
    if not irve_data:
        raise ValueError("Aucune borne IRVE fournie.")

    ks = params.get('ks', 1.0)
    kmono = params.get('kmono', 1.0)
    ktri = params.get('ktri', 1.0)
    kdc = params.get('kdc', 1.0)
    cosphi_ac = params.get('cosphi_ac', 0.98)
    cosphi_dc = params.get('cosphi_dc', 0.98)
    p_aux = params.get('puissance_aux', 0) or 0

    total_p = 0.0
    total_q = 0.0
    k_global = 1.0
    detail = []

    for item in irve_data:
        p_unit = item['puissance']
        pdc_count = item['pdc']
        qty = item['quantite']
        tension_str = str(item.get('tension', ''))
        is_mono = 'M' in tension_str
        u_tension = item.get('customTension') if tension_str == 'autre' else (230 if is_mono else 400)
        u = u_tension if u_tension and u_tension > 0 else (230 if is_mono else 400)

        p_brute_tot = p_unit * pdc_count * qty

        if item.get('type') == 'AC':
            k_coeff = kmono if is_mono else ktri
            p_active = p_brute_tot
            q_reactive = p_active * math.tan(math.acos(cosphi_ac))
            s_apparente = p_active / cosphi_ac
            ib = (s_apparente * 1000) / (u if is_mono else (math.sqrt(3) * u))
        else:
            k_coeff = kdc
            p_active = p_brute_tot
            q_reactive = p_active * math.tan(math.acos(cosphi_dc))
            s_apparente = p_active / cosphi_dc
            ib = (s_apparente * 1000) / (math.sqrt(3) * 400)

        p_calc = p_active * ks * k_coeff
        q_calc = q_reactive * ks * k_coeff
        total_p += p_calc
        total_q += q_calc

        detail.append({
            'id': item.get('id'),
            'p_actif_kw': p_calc,
            'q_reactif_kvar': q_calc,
            's_apparente_kva': math.sqrt(p_calc ** 2 + q_calc ** 2),
            'ib_a': ib,
        })

    total_s = math.sqrt(total_p ** 2 + total_q ** 2)
    # p_aux est une puissance active (kW) : ajoutée à total_p avant de recombiner avec total_q.
    total_p_avec_aux = total_p + p_aux
    praccord = math.sqrt(total_p_avec_aux ** 2 + total_q ** 2)
    ib_total = ((praccord * 1000) / (math.sqrt(3) * 400)) * k_global

    return {
        'p_total_kw': total_p,
        'q_total_kvar': total_q,
        's_total_kva': total_s,
        'praccord_kva': praccord,
        'ib_total_a': ib_total,
        'detail': detail,
    }


def compute_bilan_puissance(irve_data, params):
    """Bilan de puissance arrondi (affichage de l'analyse d'autonomie)."""
    r = bilan_puissance_brut(irve_data, params)
    return {
        'p_total_kw': round(r['p_total_kw'], 2),
        'q_total_kvar': round(r['q_total_kvar'], 2),
        's_total_kva': round(r['s_total_kva'], 2),
        'praccord_kva': round(r['praccord_kva'], 2),
        'ib_total_a': round(r['ib_total_a'], 1),
        'detail': [{
            'p_actif_kw': round(d['p_actif_kw'], 2),
            'q_reactif_kvar': round(d['q_reactif_kvar'], 2),
            's_apparente_kva': round(d['s_apparente_kva'], 2),
            'ib_a': round(d['ib_a'], 1),
        } for d in r['detail']],
    }


def _bissextile(annee):
    return (annee % 4 == 0 and annee % 100 != 0) or annee % 400 == 0


def simuler_energie_irve(e):
    """
    Miroir de calculateEnergie() (partie calcul). `e` (valeurs effectives du formulaire) :
      pas_temps_min, bornes [{id, puissance, quantite, pdc, type}],
      groupes [{key, irve_id, target_kwh, segments: [bool] x segments/jour}],
      cosphi_ac, cosphi_dc, rendement_ac, rendement_dc,
      puissance_souscrite (None = illimitée), puissance_max_irve (None = illimitée),
      existing_hourly [24], annee, nb_jours_non_ouvres.
    """
    pas = int(e['pas_temps_min'])
    seg_jour = 24 * (60 // pas)
    souscrite = math.inf if e.get('puissance_souscrite') is None else float(e['puissance_souscrite'])
    max_irve = math.inf if e.get('puissance_max_irve') is None else float(e['puissance_max_irve'])
    existing = [float(v or 0) for v in e['existing_hourly']]
    bornes = {b['id']: b for b in e['bornes']}

    kva = [0.0] * seg_jour
    kw = [0.0] * seg_jour
    puissance_ref = 0.0
    besoin_kwh = 0.0

    for g in e['groupes']:
        item = bornes.get(g['irve_id'])
        if not item:
            continue
        p_brute = item['puissance'] * item['quantite'] * item['pdc']
        cosphi = e['cosphi_dc'] if item['type'] == 'DC' else e['cosphi_ac']
        s_brute = p_brute / cosphi
        rendement = e['rendement_dc'] if item['type'] == 'DC' else e['rendement_ac']
        p_conso = p_brute / rendement
        besoin_kwh += g.get('target_kwh') or 0
        segments = g.get('segments') or []
        for i in range(seg_jour):
            if i < len(segments) and segments[i]:
                kva[i] += s_brute
                kw[i] += p_conso
                puissance_ref = max(puissance_ref, kva[i])

    livre_kwh = 0.0
    for i in range(seg_jour):
        h = (i * pas) // 60
        disponible = min(souscrite - (existing[h] if h < len(existing) else 0.0), max_irve)
        c_kva, c_kw = kva[i], kw[i]
        if c_kva > disponible:
            ratio = disponible / c_kva
            c_kva = disponible
            c_kw *= ratio
        if besoin_kwh > 0 and livre_kwh >= besoin_kwh:
            c_kva = 0.0
            c_kw = 0.0
        else:
            livre_kwh += c_kw * (pas / 60)
        kva[i], kw[i] = c_kva, c_kw

    par_heure = 60 // pas
    horaire_irve = [sum(kva[h * par_heure:(h + 1) * par_heure]) / par_heure for h in range(24)]
    energie_jour = sum(p * (pas / 60) for p in kw)

    annee = int(e['annee'])
    jours_mois = [31, 29 if _bissextile(annee) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    jours_an = 366 if _bissextile(annee) else 365
    ratio_ouvres = (jours_an - int(e.get('nb_jours_non_ouvres') or 0)) / jours_an
    mensuel_mwh = []
    total_kwh = 0.0
    for j in jours_mois:
        mois_kwh = energie_jour * j * ratio_ouvres
        total_kwh += mois_kwh
        mensuel_mwh.append(mois_kwh / 1000)

    total_irve_mwh = sum(mensuel_mwh)
    total_existant_mwh = sum(existing) * jours_an / 1000
    total_mwh = total_irve_mwh + total_existant_mwh
    return {
        'segments_kva': kva,
        'segments_kw': kw,
        'horaire_irve_kva': horaire_irve,
        'energie_jour_kwh': energie_jour,
        'mensuel_mwh': mensuel_mwh,
        'total_irve_kwh': total_kwh,
        'total_existant_mwh': total_existant_mwh,
        'part_irve_pct': total_irve_mwh / total_mwh * 100 if total_mwh > 0 else 0,
        'puissance_irve_dpm_kva': max([0.0] + kva),
        'puissance_ref_kva': puissance_ref,
    }
