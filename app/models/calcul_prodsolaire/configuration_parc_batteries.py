"""
Configuration d'un parc de batteries : montage série, parallèle, série-parallèle, et couplage AC/DC.

Unité de calcul = UNE référence du catalogue (une « batterie » telle que vendue : pack ou tour), avec
ses caractéristiques de fiche : capacité (kWh), puissances de charge/décharge (kW), tension (V),
courant max (A).

  Montage              Tension    Capacité (Ah)   Énergie        Courant max   Puissance
  série (n)            n × V      Ah              n × E          I             n × P
  parallèle (p)        V          p × Ah          p × E          p × I         p × P
  série-parallèle      s × V      p × Ah          s × p × E      p × I         s × p × P
  (p branches de s)

La puissance du parc est plafonnée par le courant max quand il est connu (P ≤ V_bus × p × I).

Contrôles réalisés AVEC LES DONNÉES DISPONIBLES (les autres sont signalés comme non vérifiables) :
  - bloquants : nombre de batteries nul, série-parallèle non divisible, évolutivité constructeur
    (batteries en série min/max, branches en parallèle max) dépassée ;
  - avertissements : évolutivité non renseignée, décharge supérieure à la puissance de l'onduleur
    hybride (elle sera plafonnée), couplage DC sans onduleur hybride compatible ;
  - informations : contrôles tension / courant du port batterie de l'onduleur impossibles tant que
    ces caractéristiques ne sont pas en base.
"""

MONTAGES = ('serie', 'parallele', 'serie-parallele')
COUPLAGES = ('AC', 'DC')
# Rendement des convertisseurs DC/DC d'un onduleur hybride (MPPT -> bus, bus -> batterie). Valeur fixe
# faute de donnée constructeur en base (demande explicite : partir sur 99 %).
RENDEMENT_DC_DC = 0.99
RENDEMENT_ONDULEUR_DEFAUT = 0.97


def _nombre(valeur):
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _entier(valeur):
    v = _nombre(valeur)
    return int(round(v)) if v is not None else None


def normaliser_couplage(valeur):
    """'DC', 'DC (via StorEdge / H...' -> 'DC' ; tout le reste -> 'AC'."""
    return 'DC' if str(valeur or '').strip().upper().startswith('DC') else 'AC'


def rendement_fraction(valeur, defaut=RENDEMENT_ONDULEUR_DEFAUT):
    """Rendement en fraction ; accepte un pourcentage (97,5) ; hors plage plausible -> défaut."""
    v = _nombre(valeur)
    if v is None:
        return defaut
    if v > 1:
        v /= 100.0
    return v if 0.8 <= v <= 1.0 else defaut


def repartition(montage, nb_total, nb_serie=None):
    """(batteries en série par branche, branches en parallèle, erreurs)."""
    n = _entier(nb_total) or 0
    if n < 1:
        return 0, 0, ["Le nombre de batteries doit être d'au moins 1."]
    if montage == 'parallele':
        return 1, n, []
    if montage == 'serie-parallele':
        s = _entier(nb_serie)
        if not s:
            return 0, 0, ["Série-parallèle : indiquez le nombre de batteries en série par branche."]
        if n % s:
            return 0, 0, [f"Série-parallèle : {n} batteries ne se répartissent pas en branches de {s} "
                          f"(le nombre total doit être un multiple de {s})."]
        return s, n // s, []
    return n, 1, []


def calculer_parc(unite, montage='serie', nb_total=1, nb_serie=None, limites=None, onduleur=None):
    """
    unite    : {capacite_kwh, puissance_charge_kw, puissance_decharge_kw, tension_v, courant_max_a, dod_pct}
    limites  : {nb_serie_min, nb_serie_max, nb_parallele_max} (évolutivité constructeur, facultatif)
    onduleur : {couplage, rendement, puissance_kw, hybride, compatible} (facultatif)
    """
    unite = unite or {}
    limites = limites or {}
    onduleur = onduleur or {}
    montage = montage if montage in MONTAGES else 'serie'
    alertes = []

    def alerte(niveau, message):
        alertes.append({'niveau': niveau, 'message': message})

    s, p, erreurs = repartition(montage, nb_total, nb_serie)
    for e in erreurs:
        alerte('erreur', e)

    cap = _nombre(unite.get('capacite_kwh')) or 0.0
    pc = _nombre(unite.get('puissance_charge_kw')) or 0.0
    pd = _nombre(unite.get('puissance_decharge_kw')) or 0.0
    v = _nombre(unite.get('tension_v'))
    i_max = _nombre(unite.get('courant_max_a'))
    dod = _nombre(unite.get('dod_pct')) or 100.0

    # --- Évolutivité constructeur ---
    s_min, s_max, p_max = (_entier(limites.get(k)) for k in ('nb_serie_min', 'nb_serie_max', 'nb_parallele_max'))
    if s and p:
        if s_max is not None and s > s_max:
            alerte('erreur', f"{s} batteries en série : le constructeur en autorise au plus {s_max}.")
        if s_min is not None and s < s_min:
            alerte('erreur', f"{s} batterie(s) en série : le constructeur en exige au moins {s_min}.")
        if p_max is not None and p > p_max:
            alerte('erreur', f"{p} branches en parallèle : le constructeur en autorise au plus {p_max}.")
        if s * p > 1 and s_max is None and p_max is None:
            alerte('avertissement', "Évolutivité de la batterie non renseignée en base : le nombre de batteries "
                                    "en série et en parallèle n'a pas pu être vérifié.")

    n = s * p
    tension_bus = v * s if v else None
    capacite_ah = (cap * 1000.0 / v) * p if v else None
    puissance_charge = pc * n
    puissance_decharge = pd * n
    courant_parc = i_max * p if i_max else None
    if tension_bus and courant_parc:
        p_courant = tension_bus * courant_parc / 1000.0
        if p_courant < max(puissance_charge, puissance_decharge) - 1e-9:
            alerte('info', f"Puissance limitée par le courant max ({courant_parc:.0f} A × {tension_bus:.0f} V "
                           f"= {p_courant:.1f} kW).")
        puissance_charge = min(puissance_charge, p_courant)
        puissance_decharge = min(puissance_decharge, p_courant)

    # --- Couplage / onduleur ---
    couplage = normaliser_couplage(onduleur.get('couplage'))
    rendement_ond = rendement_fraction(onduleur.get('rendement'))
    p_ond = _nombre(onduleur.get('puissance_kw'))
    if couplage == 'DC':
        if onduleur.get('hybride') is False:
            alerte('avertissement', "Batterie à couplage DC : l'onduleur retenu n'est pas un onduleur hybride.")
        if onduleur.get('compatible') is False:
            alerte('avertissement', "Batterie absente de la liste de compatibilité de l'onduleur retenu.")
        if p_ond and puissance_decharge > p_ond:
            alerte('avertissement', f"Puissance de décharge du parc ({puissance_decharge:.1f} kW) supérieure à celle "
                                    f"de l'onduleur hybride ({p_ond:.1f} kW) : la décharge sera plafonnée, "
                                    "production solaire comprise.")
        alerte('info', "Plage de tension et courant du port batterie de l'onduleur non renseignés en base : "
                       "compatibilité électrique du parc non vérifiée.")

    capacite = cap * n
    return {
        'montage': montage,
        'nb_total': n,
        'serie': s,
        'parallele': p,
        'tension_bus_v': tension_bus,
        'capacite_ah': capacite_ah,
        'capacite_nominale_kwh': capacite,
        'capacite_utile_kwh': capacite * dod / 100.0,
        'puissance_charge_kw': puissance_charge,
        'puissance_decharge_kw': puissance_decharge,
        'courant_max_a': courant_parc,
        'c_rate': (puissance_decharge / capacite) if capacite > 0 else None,
        'autonomie_h': (capacite * dod / 100.0 / puissance_decharge) if puissance_decharge > 0 else None,
        'couplage': couplage,
        'rendement_onduleur': rendement_ond if couplage == 'DC' else None,
        'rendement_dc_dc': RENDEMENT_DC_DC if couplage == 'DC' else None,
        'puissance_onduleur_kw': p_ond if couplage == 'DC' else None,
        'alertes': alertes,
        'bloquant': any(a['niveau'] == 'erreur' for a in alertes),
    }


def rendement_systeme(rte, couplage, rendement_onduleur=RENDEMENT_ONDULEUR_DEFAUT):
    """Rendements de bout en bout (AC -> AC) attendus, pour affichage et contrôle.

    AC : RTE de fiche = AC -> AC. DC : RTE de fiche = DC -> DC (cellules + BMS) ;
    charge solaire = η DC/DC × RTE ; recharge réseau = η onduleur × η DC/DC × RTE × η onduleur
    (l'énergie du réseau traverse l'onduleur à la charge puis à la décharge).
    """
    if normaliser_couplage(couplage) == 'AC':
        return {'solaire': rte, 'reseau': rte}
    return {'solaire': RENDEMENT_DC_DC * rte,
            'reseau': rendement_onduleur * RENDEMENT_DC_DC * rte * rendement_onduleur}
