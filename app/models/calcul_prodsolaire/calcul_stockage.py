"""
Calcul des indicateurs de performance d'un système de stockage (batterie) — délégué à la
bibliothèque officielle NREL-PySAM (module PySAM.Battery) plutôt qu'à une simulation horaire
"maison" (ancienne version : dispatch en 5 stratégies nommées avec priorisation entre 2 flux de
charge bâtiment/IRVE).

Décision d'architecture actée avec l'utilisateur : délégation complète à PySAM.Battery, mode de
dispatch "personnalisé" (batt_custom_dispatch) piloté par une logique simple et unique de
maximisation de l'autoconsommation (+ fenêtre optionnelle de recharge réseau), au lieu des 5
anciennes stratégies. Conséquence assumée : hourly_cons_existante et hourly_cons_irve sont
fusionnés en un seul flux de charge pour le dispatch ; les taux séparés (taux_ext/taux_irve)
restent affichés en reconstituant a posteriori la part de chaque flux, au prorata horaire.
"""

import logging
import math

import PySAM.Battery as PySAMBattery
import PySAM.BatteryTools as BatteryTools

DEFAULT_CHEMISTRY = 'lfpgraphite'  # Li-ion LFP : chimie dominante pour le stockage stationnaire

# Rendement aller-retour par défaut, en FRACTION. 0,90 est la valeur de fiche technique la plus
# courante du catalogue (12 des 40 batteries) et la valeur par défaut demandée.
DEFAULT_RTE = 0.90
DEFAULT_VOLTAGE = 400  # V — gabarit tertiaire/commercial (onduleur-chargeur ~100 kVA, ~200 kWh)
VALID_CHEMISTRIES = {'leadacid', 'lfpgraphite', 'nmcgraphite', 'lmolto'}

# Seuil de capacité en-deçà duquel une tension système de 400V échoue systématiquement au
# dimensionnement PySAM : l'algorithme (BatteryTools.calculate_battery_size) arrondit le nombre de
# strings AU-DESSUS pour atteindre la capacité désirée, avec un "grain" par string de ~0.9 kWh à
# 400V (cellule LFP par défaut, 112 cellules en série) — pour une petite capacité (ex. 10 kWh), ce
# grain dépasse la tolérance de 5% et lève "Could not meet desired battery capacity". À 48V
# (14 cellules en série), le grain tombe à ~0.11 kWh, largement suffisant pour les petites capacités.
SMALL_SYSTEM_CAPACITY_THRESHOLD_KWH = 50
SMALL_SYSTEM_VOLTAGE = 48
LARGE_SYSTEM_VOLTAGE = 400


from app.models.calcul_prodsolaire.vieillissement_stockage import (  # noqa: E402
    soh_fin_vie, trajectoire, duree_de_vie_ans)
from app.models.calcul_prodsolaire.configuration_parc_batteries import (  # noqa: E402
    RENDEMENT_DC_DC, calculer_parc, normaliser_couplage, rendement_fraction, rendement_systeme)


def rendements_depuis_rte(rte):
    """
    Décompose un rendement ALLER-RETOUR en rendement de charge et de décharge, pour PySAM.

    PySAM n'a aucune entrée « round trip efficiency » : le moteur veut `batt_ac_dc_efficiency`
    (conversion AC→DC à la charge) et `batt_dc_ac_efficiency` (DC→AC à la décharge) séparément, et
    ajoute par-dessus les pertes de résistance interne de cellule. La décomposition physiquement
    correcte, à défaut d'information constructeur distinguant les deux sens, est symétrique :

        RTE = η_charge × η_décharge   →   η_charge = η_décharge = √RTE

    POURQUOI C'EST PLUS FIDÈLE QUE LES DEUX CHAMPS PRÉCÉDENTS : l'interface demandait un rendement
    de charge ET un rendement de décharge, alors qu'une fiche technique ne publie qu'un RTE. Saisir
    ce RTE dans les deux champs — geste naturel, et ce que faisait déjà automatiquement
    bd_batteries.js en recopiant le même RTE des deux côtés — revenait à appliquer RTE² : mesuré sur
    une année complète, un RTE annoncé de 90 % produisait 80,4 % réels, soit près de 10 points
    perdus silencieusement. Avec √RTE, l'écart tombe à ~0,65 point, entièrement imputable à la
    résistance interne que PySAM ajoute (cf. tests/materiels/banc_mesure_rte_pysam.py).

    @param rte fraction (0-1)
    @returns (eta_charge, eta_decharge), fractions
    """
    rte_borne = min(max(float(rte), 0.01), 1.0)
    eta = math.sqrt(rte_borne)
    return eta, eta


def _lire_rte(params):
    """
    Rendement aller-retour demandé, en fraction, depuis les paramètres reçus.

    Accepte `sto_rte` (le champ unique actuel) et, à défaut, l'ancien couple
    `sto_rendement_charge` / `sto_rendement_decharge` dont le produit EST le rendement aller-retour
    — de quoi rejouer sans erreur une configuration enregistrée avant ce changement.
    """
    brut = params.get('sto_rte')
    if brut not in (None, ''):
        valeur = float(brut)
        # Tolère une saisie en pourcentage (90) comme en fraction (0.9) : au-delà de 1, c'est
        # nécessairement un pourcentage, aucun rendement aller-retour ne dépassant 100 %.
        return valeur / 100.0 if valeur > 1.0 else valeur

    charge = params.get('sto_rendement_charge')
    decharge = params.get('sto_rendement_decharge')
    if charge not in (None, '') and decharge not in (None, ''):
        return float(charge) * float(decharge)

    return DEFAULT_RTE


def _pick_system_voltage(cap_kwh):
    """Tension système adaptée à la taille de l'installation (cf. note ci-dessus) — 48V pour les
    petits systèmes (résidentiel/petit tertiaire), 400V au-delà (tertiaire/commercial)."""
    return SMALL_SYSTEM_VOLTAGE if cap_kwh < SMALL_SYSTEM_CAPACITY_THRESHOLD_KWH else LARGE_SYSTEM_VOLTAGE


def _completer_parametres_modele_tension(m):
    """
    Renseigne batt_Vfull/Vexp/Vnom/Qexp/Qnom/C_rate pour une chimie décrite par une TABLE tension/SOC
    (LTO, plomb — cf. _build_battery_model), à partir de cette table et de la capacité de cellule.
    Ces valeurs ne servent qu'à satisfaire le précheck PySAM : en mode table, la simulation lit la
    table, pas ces paramètres.
    """
    cell = m.BatteryCell
    table = list(cell.batt_voltage_matrix or [])
    tensions = [float(ligne[1]) for ligne in table if len(ligne) >= 2]
    v_nom = float(cell.batt_Vnom_default)
    v_full = max(tensions) if tensions else v_nom * 1.1
    v_full = max(v_full, v_nom * 1.01)
    q_full = float(cell.batt_Qfull)
    cell.batt_Vfull = v_full
    cell.batt_Vexp = (v_full + v_nom) / 2.0
    cell.batt_Vnom = v_nom
    cell.batt_Qexp = q_full * 0.05
    cell.batt_Qnom = q_full * 0.9
    cell.batt_C_rate = 0.2


def _build_battery_model(cap_kwh, charge_power_kw, discharge_power_kw, dod_percent,
                          chemistry, voltage, n_timesteps, timestep_minutes,
                          rendement_charge, rendement_decharge, calibrer_capacite=True):
    """
    Construit et dimensionne un modèle PySAM.Battery. La séquence de configuration (chimie AVANT
    dimensionnement, bootstrap de valeurs placeholder avant l'appel BatteryTools, matrices
    tension/calendaire fournies explicitement) a été déterminée empiriquement en itérant sur les
    erreurs de précheck du moteur SSC de PySAM (pas de documentation officielle consultable dans
    cet environnement) — chaque champ ci-dessous correspond à une erreur "variable non assignée"
    rencontrée et résolue.
    """
    m = PySAMBattery.new()

    m.BatterySystem.en_standalone_batt = 0
    m.BatterySystem.en_batt = 1
    m.BatterySystem.batt_ac_or_dc = 1  # 1 = connecté côté AC (gen/load déjà en kW AC)
    m.BatterySystem.batt_meter_position = 0  # derrière le compteur (autoconsommation)
    m.BatterySystem.batt_current_choice = 0  # contrôle en puissance, pas en courant
    m.Simulation.timestep_minutes = timestep_minutes

    # --- Bootstrap : valeurs placeholder nécessaires avant chemistry/sizing (le moteur PySAM lit
    # ces variables "originales" avant de les recalculer — elles doivent exister au préalable). ---
    m.BatterySystem.batt_computed_series = 1
    m.BatterySystem.batt_computed_strings = 1
    # 0,96 kWh (et non 1) : multiple exact du « grain » d'une string pour toutes les chimies (plomb :
    # 2 × 2 V × 30 Ah = 120 Wh ; LTO : 9,6 Wh ; LFP/NMC : écart < 1 %). battery_model_change_chemistry
    # redimensionne ce placeholder avec une tolérance de 5 % : avec 1 kWh, le plomb la dépassait (8 %).
    m.value('batt_computed_bank_capacity', 0.96)
    m.BatteryCell.batt_Vnom_default = 3.6
    m.BatterySystem.batt_power_discharge_max_kwac = 1.0
    m.BatterySystem.batt_power_charge_max_kwac = 1.0
    # CORRECTIF (plomb, rendement aller-retour < 60 % : « Could not meet desired battery capacity ») :
    # battery_model_change_chemistry redimensionne la batterie PLACEHOLDER avec une tolérance de 5 %,
    # en divisant sa capacité par le rendement de conversion : selon le rendement, l'arrondi du grain
    # d'une string plomb (120 Wh) dépassait 5 % et le calcul échouait (tout plomb à RTE < 0,60).
    # Initialisation à 100 % sur un placeholder multiple du grain ; rendements réels posés juste après.
    m.BatterySystem.batt_dc_ac_efficiency = 100
    m.BatterySystem.batt_ac_dc_efficiency = 100
    m.BatterySystem.batt_dc_dc_efficiency = 99
    m.BatteryCell.batt_chem = 0 if chemistry == 'leadacid' else 1

    BatteryTools.battery_model_change_chemistry(m, chemistry)
    m.BatterySystem.batt_dc_ac_efficiency = rendement_decharge * 100
    m.BatterySystem.batt_ac_dc_efficiency = rendement_charge * 100

    # Tension : deux représentations selon la chimie, fixées par les défauts PySAM que
    # battery_model_change_chemistry vient de charger :
    #  - LFP / NMC : modèle interne (batt_voltage_choice = 0), paramétré par Vfull/Vexp/Vnom/Qexp...
    #  - LTO (lmolto) / plomb (leadacid) : TABLE tension/SOC (batt_voltage_choice = 1), SANS
    #    Vfull/Vexp/Vnom.
    # CORRECTIF (bug rapporté : "La simulation PySAM n'a pas convergé : battery execution error.
    # batt_Vfull not assigned") : le modèle interne était imposé à TOUTES les chimies, et la table
    # d'origine écrasée par un gabarit à 2 points — pour LTO et plomb, PySAM réclamait alors Vfull,
    # qui n'existe pas pour elles. On ne touche plus à la représentation définie par la chimie.
    #
    # TENSION CONSTANTE (demande explicite, précision du rendement) : toutes les chimies passent en
    # mode TABLE avec une tension de cellule constante égale à sa tension nominale.
    # Pourquoi : PySAM compte l'énergie comme tension × courant ; avec la courbe tension / état de
    # charge de la chimie, l'énergie restituée est plus faible que l'énergie chargée — une perte
    # PROPRE AUX CELLULES de 2,6 points (LFP) à 5 points (NMC), mesurée sur une année (la résistance
    # interne, elle, ne pèse rien : rendement identique à résistance nulle). Or le rendement
    # aller-retour de la fiche CONTIENT DÉJÀ toutes les pertes de la batterie (AC -> AC en couplage AC,
    # DC -> DC en couplage DC) : ces pertes étaient comptées deux fois, le rendement simulé tombant à
    # 90 % pour une fiche à 95 %. À tension constante, le rendement de la fiche est la seule source de
    # pertes et le rendement simulé retombe sur la fiche (±0,1 point). Ce qui est conservé de la
    # chimie : capacité (dont la capacité du plomb selon le régime de décharge), état de charge,
    # limites de puissance. Ce qui est perdu : la variation du rendement avec l'état de charge et le
    # régime, qu'aucune fiche technique ne fournit.
    # Le précheck du module SSC exige malgré tout les paramètres du modèle interne (Vfull, Vexp...),
    # non lus en mode table : _completer_parametres_modele_tension les pose, cohérents avec la table.
    tension_nominale_cellule = float(m.BatteryCell.batt_Vnom_default)
    m.BatteryCell.batt_voltage_choice = 1
    # Première colonne = profondeur de décharge (%). PySAM refuse deux tensions identiques : pente de
    # ±0,01 % autour de la tension nominale, sans effet mesurable sur l'énergie.
    m.BatteryCell.batt_voltage_matrix = [[0, tension_nominale_cellule * 1.0001], [100, tension_nominale_cellule * 0.9999]]
    _completer_parametres_modele_tension(m)
    # RÉSISTANCE INTERNE NULLE, même raison : ses pertes (chute de tension × courant) sont incluses
    # dans le rendement de la fiche. Négligeable en lithium, elle retirait 6 à 8 points au plomb
    # (0,02 Ω par cellule de 2 V : 72 % simulés pour une fiche à 80 %).
    m.BatteryCell.batt_resistance = 0.0
    m.BatteryCell.batt_Qfull_flow = m.BatteryCell.batt_Qfull

    m.BatteryCell.batt_minimum_SOC = max(0, 100 - dod_percent)
    m.BatteryCell.batt_maximum_SOC = 100
    m.BatteryCell.batt_initial_SOC = 100 - dod_percent / 2  # départ à mi-plage utile
    m.BatteryCell.batt_minimum_modetime = 0

    # Dégradation calendaire : modèle par équation plutôt que table (idem tension — évite une
    # table de vieillissement non renseignée par les défauts de chimie de PySAM).
    m.BatteryCell.batt_calendar_choice = 0
    m.BatteryCell.batt_calendar_lifetime_matrix = [[0, 100], [3650, 80]]
    # Coefficients du modèle calendaire : non lus avec batt_calendar_choice = 0, mais exigés par le
    # précheck PySAM. Les défauts de la chimie plomb n'en fournissent pas (erreur "batt_calendar_q0
    # not assigned") : valeurs par défaut de SAM, posées UNIQUEMENT si la chimie ne les a pas
    # définies (LFP/NMC/LTO gardent les leurs).
    for nom, valeur in (('batt_calendar_q0', 1.02), ('batt_calendar_a', 0.00266),
                        ('batt_calendar_b', -7280.0), ('batt_calendar_c', 939.0)):
        try:
            m.value(nom)
        except Exception:
            m.value(nom, valeur)
    m.BatteryCell.batt_room_temperature_celsius = [20.0] * n_timesteps

    # Remplacement de batterie et pertes additionnelles : désactivés (déjà gérés séparément par
    # le calcul de durée de vie/dégradation existant, conservé tel quel dans calculate_storage_data).
    m.BatterySystem.batt_replacement_capacity = 0
    m.BatterySystem.batt_replacement_option = 0
    m.BatterySystem.batt_replacement_schedule_percent = [0]
    m.BatterySystem.batt_loss_choice = 0
    m.BatterySystem.batt_losses = [0]
    m.BatterySystem.batt_losses_charging = [0]
    m.BatterySystem.batt_losses_discharging = [0]
    m.BatterySystem.batt_losses_idle = [0]

    m.Lifetime.analysis_period = 1
    m.Lifetime.system_use_lifetime_output = 0

    tension_retenue = _size_battery_robust(m, max(charge_power_kw, discharge_power_kw), cap_kwh, voltage)
    m.__tension_retenue = tension_retenue
    facteur = _facteur_tension_chimie(chemistry) if calibrer_capacite else 1.0
    _ajuster_capacite_exacte(m, cap_kwh, max(charge_power_kw, discharge_power_kw), facteur)
    return m


_FACTEURS_TENSION = {}


def _energie_decharge_complete(chemistry, calibrer):
    """Énergie DC (kWh) restituée par une batterie de 10 kWh pleine déchargée à C/5 sur 90 % de DoD,
    rapportée à 10 kWh (divisée par 0,9)."""
    cap, p, n = 10.0, 2.0, 8760
    m = _build_battery_model(cap, p, p, 90, chemistry, SMALL_SYSTEM_VOLTAGE, n, 60, 0.95, 0.95,
                             calibrer_capacite=calibrer)
    m.Simulation.timestep_minutes = 60
    m.BatteryCell.batt_initial_SOC = 100
    m.SystemOutput.gen = [0.0] * n
    m.Load.load = [p] * n
    m.BatteryDispatch.batt_dispatch_choice = 2
    m.BatteryDispatch.batt_custom_dispatch = [p] * n
    for nom in ('batt_dispatch_auto_can_gridcharge', 'batt_dispatch_auto_can_clipcharge',
                'batt_dispatch_auto_can_curtailcharge', 'batt_dispatch_auto_can_fuelcellcharge',
                'batt_dispatch_auto_btm_can_discharge_to_grid',
                'batt_dispatch_charge_only_system_exceeds_load',
                'batt_dispatch_discharge_only_load_exceeds_system'):
        setattr(m.BatteryDispatch, nom, 0)
    m.BatteryDispatch.batt_dispatch_auto_can_charge = 1
    m.execute()
    return sum(x for x in list(m.Outputs.batt_power_dc)[:48] if x > 0) / 0.9, cap


def _facteur_tension_chimie(chemistry):
    """
    Rapport « énergie réellement restituée / Ah × tension nominale » propre à chaque chimie, mesuré
    une fois par chimie (décharge complète à C/5, puis mis en cache). Depuis le passage à la tension
    constante, il ne reflète plus la courbe de tension mais la capacité selon la température des tables
    PySAM à 20 °C (LFP et LTO ≈ 0,96, NMC ≈ 1) et selon le régime pour le plomb : il garantit que la
    capacité simulée reste celle de la fiche.
    Repli sur 1 si la mesure échoue — on retombe alors sur la simple mise à l'échelle nominale.
    """
    if chemistry not in _FACTEURS_TENSION:
        try:
            energie, cap = _energie_decharge_complete(chemistry, calibrer=False)
            facteur = energie / cap if energie > 0 else 1.0
            _FACTEURS_TENSION[chemistry] = facteur if 0.7 < facteur < 1.3 else 1.0
        except Exception:
            logging.exception("Calibrage de la capacité impossible pour la chimie %s", chemistry)
            _FACTEURS_TENSION[chemistry] = 1.0
    return _FACTEURS_TENSION[chemistry]


def _ajuster_capacite_exacte(m, cap_kwh, puissance_kw, facteur_tension=1.0):
    """
    Ramène la capacité du parc simulé EXACTEMENT à la capacité de la fiche technique (kWh DC).

    Le dimensionnement PySAM (battery_model_sizing) surdimensionne la batterie :
      - en couplage AC, il divise la capacité demandée par le rendement de conversion (≈ +5 %) ;
      - il arrondit le nombre de strings à l'entier SUPÉRIEUR (grain d'une string : jusqu'à +10 %
        en plomb, dont les cellules font 30 Ah).
    Mesuré : +5 à +7 % en lithium, jusqu'à +15 % en plomb — autant d'énergie stockable fictive qui
    gonflait le taux d'autoconsommation. La capacité des fiches techniques (celle saisie) est une
    capacité nominale DC : on met à l'échelle la capacité de CELLULE (Qfull et les points Qexp/Qnom
    de la courbe de tension, en Ah) du rapport cible / simulée. Tension, nombre de cellules, courbes
    de tension et rendements sont inchangés ; les puissances max sont recalées sur la demande.
    """
    capacite_simulee = float(m.value('batt_computed_bank_capacity'))
    if cap_kwh <= 0 or capacite_simulee <= 0:
        return
    k = cap_kwh / capacite_simulee / facteur_tension
    cell = m.BatteryCell
    cell.batt_Qfull = float(cell.batt_Qfull) * k
    cell.batt_Qfull_flow = cell.batt_Qfull
    for nom in ('batt_Qexp', 'batt_Qnom'):
        try:
            m.value(nom, float(m.value(nom)) * k)
        except Exception:
            pass
    m.value('batt_computed_bank_capacity', float(cap_kwh))
    if int(cell.batt_chem) == 0:
        # CORRECTIF plomb : les capacités à 20 h / 10 h / n h sont lues par le moteur en Ah DU PARC
        # (et non en %), or les défauts PySAM les figent à 100 / 43 / 40 Ah quelle que soit la taille
        # de la batterie — une batterie plomb de 10 kWh (240 Ah) ne restituait que ~40 % de sa
        # capacité. Recalculées à partir du parc avec les ratios par défaut de SAM (C20 = 100 %,
        # C10 = 93,2 %, C1 = 58,12 %).
        q_parc = float(cell.batt_Qfull) * float(m.BatterySystem.batt_computed_strings)
        m.value('LeadAcid_q20_computed', q_parc)
        m.value('LeadAcid_q10_computed', q_parc * 0.932)
        m.value('LeadAcid_qn_computed', q_parc * 0.5812)
        m.value('LeadAcid_tn', 1.0)
    # Puissances max : posées EXPLICITEMENT à partir de la puissance demandée (kW côté AC du
    # modèle), plutôt que déduites du dimensionnement PySAM (gonflées par l'arrondi des strings, et
    # dissymétriques quand il dimensionne côté DC). Côté DC : décharge = P / rendement de décharge,
    # charge = P × rendement de charge ; courants = puissance DC / tension du parc.
    s = m.BatterySystem
    if puissance_kw and puissance_kw > 0:
        rend_decharge = max(float(s.batt_dc_ac_efficiency), 1.0) / 100.0
        rend_charge = max(float(s.batt_ac_dc_efficiency), 1.0) / 100.0
        tension_parc = float(cell.batt_Vnom_default) * float(s.batt_computed_series)
        s.batt_power_discharge_max_kwac = puissance_kw
        s.batt_power_charge_max_kwac = puissance_kw
        s.batt_power_discharge_max_kwdc = puissance_kw / rend_decharge
        s.batt_power_charge_max_kwdc = puissance_kw * rend_charge
        if tension_parc > 0:
            s.batt_current_discharge_max = s.batt_power_discharge_max_kwdc * 1000.0 / tension_parc
            s.batt_current_charge_max = s.batt_power_charge_max_kwdc * 1000.0 / tension_parc
    try:
        m.value('batt_mass', float(m.value('batt_mass')) * k)
        m.value('batt_surface_area', float(m.value('batt_surface_area')) * k)
    except Exception:
        pass


def _size_battery_robust(model, desired_power, desired_capacity, desired_voltage):
    """
    Dimensionne le modèle en essayant plusieurs combinaisons tension/tolérance avant d'abandonner.
    L'algorithme de PySAM arrondit le nombre de strings AU-DESSUS de la capacité désirée ; selon la
    tension système, ce "grain" peut dépasser la tolérance par défaut (5%) — notamment pour de
    petites capacités à tension élevée (cf. SMALL_SYSTEM_CAPACITY_THRESHOLD_KWH ci-dessus). On
    retente donc avec une tolérance plus large, puis avec la tension alternative, avant de
    remonter une erreur claire et actionnable plutôt que l'exception brute de PySAM.
    """
    attempts = [
        (desired_voltage, 0.05),
        (desired_voltage, 0.20),
        (SMALL_SYSTEM_VOLTAGE if desired_voltage != SMALL_SYSTEM_VOLTAGE else LARGE_SYSTEM_VOLTAGE, 0.20),
    ]
    last_error = None
    for attempt_voltage, tol in attempts:
        try:
            # size_by_ac_not_dc=False : la capacité demandée est la capacité DC de la fiche. En mode
            # AC, PySAM la divisait par le rendement de conversion (batterie gonflée de 5 à 35 %,
            # au-delà de sa tolérance pour le plomb) ; capacité et puissances sont de toute façon
            # recalées exactement ensuite (_ajuster_capacite_exacte).
            BatteryTools.battery_model_sizing(
                model, desired_power=desired_power, desired_capacity=desired_capacity,
                desired_voltage=attempt_voltage, size_by_ac_not_dc=False, tol=tol
            )
            # Retourne la tension RÉELLEMENT retenue : elle peut différer de celle demandée quand
            # le dimensionnement PySAM a dû se rabattre sur la tension alternative. L'appelant la
            # remonte à l'utilisateur plutôt que de laisser croire que sa saisie a été appliquée.
            return attempt_voltage
        except Exception as e:
            last_error = e
            logging.warning(
                "Dimensionnement batterie échoué (tension=%sV, tolérance=%.0f%%) : %s — nouvel essai...",
                attempt_voltage, tol * 100, e
            )
    raise ValueError(
        f"Impossible de dimensionner la batterie pour une capacité de {desired_capacity:.1f} kWh "
        f"et une puissance de {desired_power:.1f} kW. Essayez d'augmenter la capacité (ou de réduire "
        f"la puissance de charge/décharge) pour un ratio puissance/capacité plus réaliste. "
        f"(Détail technique : {last_error})"
    )


def _compute_custom_dispatch(hourly_pv, hourly_load, charge_power_kw, discharge_power_kw,
                              recharge_hours, restitution_active, dt, decharge_hours=None):
    """
    Calcule le dispatch souhaité à chaque pas de temps (convention PySAM : positif = décharge,
    négatif = charge, en kW AC) selon une logique unique et simple :
      - Pendant les heures de recharge réseau sélectionnées (si la restitution est activée) :
        charge forcée à pleine puissance (comportement "recharge HC" équivalent à l'ancien).
      - Sinon : maximisation de l'autoconsommation — charge le surplus PV, décharge le déficit,
        la décharge étant limitée aux heures de la plage de décharge si elle est renseignée
        (vide = décharge autorisée à toute heure).
    PySAM détermine ensuite lui-même, à partir de gen/load réels, si l'énergie de charge provient
    du surplus PV ou du réseau (cf. system_to_batt vs grid_to_batt dans les résultats).
    """
    n = len(hourly_pv)
    dispatch = [0.0] * n
    for i in range(n):
        hour_of_day = int((i * dt) % 24)
        if restitution_active and hour_of_day in recharge_hours:
            dispatch[i] = -charge_power_kw
            continue
        surplus = hourly_pv[i] - hourly_load[i]
        if surplus > 0:
            dispatch[i] = -min(surplus, charge_power_kw)
        elif surplus < 0 and (not decharge_hours or hour_of_day in decharge_hours):
            dispatch[i] = min(-surplus, discharge_power_kw)
    return dispatch



def _executer_simulation(cap, charge_power, discharge_power, dod, chemistry, voltage, pv, load,
                         time_step, rendement_charge, rendement_decharge, recharge_hours,
                         restitution_active, decharge_hours, couplage='AC', rendement_onduleur=None,
                         puissance_onduleur_kw=None):
    """
    Construit, paramètre (dispatch personnalisé) et exécute un modèle PySAM.Battery.

    COUPLAGE AC (batterie avec son propre onduleur) : le RTE de la fiche est un rendement AC -> AC,
    réparti en √RTE à la charge et à la décharge (cf. rendements_depuis_rte).

    COUPLAGE DC (onduleur hybride) : le RTE de la fiche est un rendement DC -> DC (cellules + BMS).
    PySAM.Battery ne simule pas un couplage DC sans modèle PV complet : la simulation est donc menée
    SUR LE BUS DC de l'onduleur hybride. Production et consommation (en AC) y sont ramenées en
    divisant par le rendement de l'onduleur ; la charge subit en plus le convertisseur DC/DC (99 %).
    Les flux sont reconvertis en AC par _series_ac. Rendement de bout en bout obtenu :
    charge solaire η DC/DC × RTE, recharge réseau η onduleur² × η DC/DC × RTE
    (cf. configuration_parc_batteries.rendement_systeme).
    La puissance AC de l'onduleur hybride est partagée entre production et décharge : la décharge est
    plafonnée à P onduleur − production, et la recharge réseau à P onduleur.
    """
    dt = time_step / 60.0
    dc = normaliser_couplage(couplage) == 'DC'
    eta = rendement_fraction(rendement_onduleur) if dc else 1.0
    pv_sim = [x / eta for x in pv] if dc else pv
    load_sim = [x / eta for x in load] if dc else load
    model = _build_battery_model(
        cap_kwh=cap, charge_power_kw=charge_power, discharge_power_kw=discharge_power,
        dod_percent=dod, chemistry=chemistry, voltage=voltage, n_timesteps=len(pv),
        timestep_minutes=time_step,
        rendement_charge=rendement_charge * RENDEMENT_DC_DC if dc else rendement_charge,
        rendement_decharge=rendement_decharge
    )
    custom_dispatch = _compute_custom_dispatch(
        pv_sim, load_sim, charge_power, discharge_power, recharge_hours, restitution_active, dt, decharge_hours
    )
    p_ond = float(puissance_onduleur_kw or 0)
    if dc and p_ond > 0:
        for i, consigne in enumerate(custom_dispatch):
            if consigne > 0:
                custom_dispatch[i] = min(consigne, max(0.0, p_ond / eta - pv_sim[i]))
            elif consigne < 0 and restitution_active and int((i * dt) % 24) in recharge_hours:
                custom_dispatch[i] = -min(-consigne, p_ond * eta)
    model.SystemOutput.gen = pv_sim
    model.Load.load = load_sim
    model.__rendement_bus = eta
    model.BatteryDispatch.batt_dispatch_choice = 2  # dispatch personnalisé
    model.BatteryDispatch.batt_custom_dispatch = custom_dispatch
    model.BatteryDispatch.batt_dispatch_auto_can_gridcharge = 1 if restitution_active else 0
    model.BatteryDispatch.batt_dispatch_auto_can_charge = 1
    model.BatteryDispatch.batt_dispatch_auto_can_clipcharge = 0
    model.BatteryDispatch.batt_dispatch_auto_can_curtailcharge = 0
    model.BatteryDispatch.batt_dispatch_auto_can_fuelcellcharge = 0
    model.BatteryDispatch.batt_dispatch_auto_btm_can_discharge_to_grid = 0
    model.BatteryDispatch.batt_dispatch_charge_only_system_exceeds_load = 0
    model.BatteryDispatch.batt_dispatch_discharge_only_load_exceeds_system = 0
    model.execute()
    return model


def _series_ac(model):
    """
    Séries de flux (kW) exprimées côté AC. Couplage AC : sorties PySAM telles quelles. Couplage DC :
    la simulation tourne sur le bus DC (cf. _executer_simulation) — PV consommé, PV stocké et énergie
    restituée repassent par l'onduleur (× η), l'énergie tirée du réseau l'a traversé avant d'arriver
    au bus (÷ η).
    """
    eta = getattr(model, '__rendement_bus', 1.0)
    out = model.Outputs
    if eta == 1.0:
        return {'system_to_load': list(out.system_to_load), 'system_to_batt': list(out.system_to_batt),
                'batt_to_load': list(out.batt_to_load), 'grid_to_batt': list(out.grid_to_batt),
                'batt_power': list(out.batt_power), 'dc': False}
    return {'system_to_load': [x * eta for x in out.system_to_load],
            'system_to_batt': [x * eta for x in out.system_to_batt],
            'batt_to_load': [x * eta for x in out.batt_to_load],
            'grid_to_batt': [x / eta for x in out.grid_to_batt],
            'batt_power': [x * eta for x in out.batt_power], 'dc': True}


def _flux_annuels(model, dt, capacite_utile_kwh):
    """Flux annuels (MWh, côté AC) d'une simulation exécutée + cycles équivalents complets.

    Répartition solaire / réseau de l'énergie restituée au prorata annuel des origines de charge
    (même convention que calculate_storage_data). Cycles = énergie DC déchargée / capacité utile.
    """
    series = _series_ac(model)
    sol_charge = sum(series['system_to_batt']) * dt / 1000.0
    res_charge = sum(series['grid_to_batt']) * dt / 1000.0
    restit = sum(series['batt_to_load']) * dt / 1000.0
    total = sol_charge + res_charge
    ratio = sol_charge / total if total > 0 else 0.0
    decharge_dc_kwh = sum(p for p in model.Outputs.batt_power_dc if p > 0) * dt
    return {
        'e_sol_restit_mwh': restit * ratio,
        'e_sol_charge_mwh': sol_charge,
        'e_res_charge_mwh': res_charge,
        'e_res_restit_mwh': restit * (1 - ratio),
        'cycles_an': decharge_dc_kwh / capacite_utile_kwh if capacite_utile_kwh > 0 else 0.0,
    }


def _moyenne_horaire(serie, pas_minutes):
    """Agrège une série au pas horaire (moyenne des kW de chaque heure)."""
    n = max(1, 60 // pas_minutes)
    if n == 1:
        return list(serie)
    return [sum(serie[i:i + n]) / len(serie[i:i + n]) for i in range(0, len(serie) - len(serie) % n, n)]


# États de santé simulés pour le vieillissement (complétés sous le seuil de fin de vie si besoin).
SOH_SIMULES = (1.0, 0.9, 0.8, 0.7)


def _points_vieillissement(flux_reference, soh_fin_vie_frac, simuler_horaire, time_step):
    """
    Flux annuels pour plusieurs états de santé (capacité × SoH). Les simulations à capacité réduite
    sont faites au pas HORAIRE (4 à 5 fois plus rapides qu'au quart d'heure) et appliquées en
    RAPPORTS à la simulation de référence au pas choisi : on garde la précision du calcul principal,
    seule la sensibilité au SoH vient des simulations horaires.
    """
    niveaux = list(SOH_SIMULES)
    bas = round(soh_fin_vie_frac - 0.1, 2)
    if bas < min(niveaux):
        niveaux.append(max(0.3, bas))
    points = [dict(flux_reference, soh=1.0)]
    base_horaire = flux_reference if time_step == 60 else simuler_horaire(1.0)
    if base_horaire is None:
        return points
    for soh in niveaux[1:]:
        f = simuler_horaire(soh)
        if f is None:
            continue  # capacité réduite non dimensionnable : point ignoré, l'interpolation s'en passe
        point = {'soh': soh}
        for cle, ref in flux_reference.items():
            base = base_horaire[cle]
            point[cle] = ref * f[cle] / base if base > 1e-12 else 0.0
        points.append(point)
    return points

def _heures_valides(heures):
    """Heures de la journée (entiers 0-23) extraites d'une liste reçue du navigateur."""
    resultat = []
    for h in heures or []:
        try:
            h = int(h)
        except (TypeError, ValueError):
            continue
        if 0 <= h <= 23:
            resultat.append(h)
    return resultat


def calculate_storage_data(params):
    """
    Calcule les indicateurs de performance d'un système de stockage via PySAM.Battery.
    """
    try:
        # Contexte PV / autoconsommation existante
        prod_totale_mwh = float(params.get('sto_prod_totale_mwh', 0))
        pr_init = float(params.get('sto_pr_init', 0))

        # Caractéristiques batterie
        cap = float(params.get('sto_cap', 0))
        dod = float(params.get('sto_dod', 0))
        # Un seul rendement aller-retour (cf. rendements_depuis_rte) : c'est la grandeur publiée par
        # les fiches techniques et la seule stockée en base (round_trip_efficiency_pct).
        rte = _lire_rte(params)
        rendement_charge, rendement_decharge = rendements_depuis_rte(rte)
        cycles = float(params.get('sto_cycles', 0))
        degrad_cal_pct = float(params.get('sto_degrad_cal', 0))
        # État de santé en fin de vie : fiche batterie (base matériels) si renseigné, sinon 60 %.
        soh_fin_vie_pct = soh_fin_vie(params.get('sto_soh_fin_vie')) * 100
        chemistry = params.get('sto_chemistry', DEFAULT_CHEMISTRY)
        if chemistry not in VALID_CHEMISTRIES:
            chemistry = DEFAULT_CHEMISTRY
        # Tension système : la valeur SAISIE fait foi (le champ est désormais modifiable, demande
        # explicite), avec repli automatique sur la tension adaptée au gabarit si le dimensionnement
        # PySAM échoue — c'est le compromis retenu : ne jamais empêcher un calcul d'aboutir, mais
        # dire à l'utilisateur quand sa saisie n'a pas pu être appliquée (cf. tension_retenue_v
        # dans les sorties). Sans saisie, on retombe sur le choix automatique historique : 48 V en
        # deçà de 50 kWh, 400 V au-delà — à 400 V le « grain » de dimensionnement d'une string
        # (~0,9 kWh) dépasse la tolérance pour une petite capacité et fait échouer PySAM.
        voltage_demande = params.get('sto_voltage')
        voltage = float(voltage_demande) if voltage_demande not in (None, '') else _pick_system_voltage(cap)

        # Parc de batteries (montage série / parallèle / série-parallèle) : les caractéristiques saisies
        # sont celles d'UNE batterie du catalogue ; capacité, puissances et tension du parc en découlent
        # (cf. configuration_parc_batteries.py). Une configuration interdite bloque le calcul.
        nb_saisi = params.get('sto_nb_batteries', 1)
        nb_batteries = 1 if nb_saisi in (None, '') else nb_saisi
        montage = params.get('sto_montage', 'serie')
        couplage = normaliser_couplage(params.get('sto_couplage'))
        rendement_onduleur = rendement_fraction(params.get('sto_rendement_onduleur'))
        puissance_onduleur_kw = params.get('sto_puissance_onduleur_kw')
        parc = calculer_parc(
            unite={
                'capacite_kwh': cap, 'puissance_charge_kw': params.get('sto_charge_power', 0),
                'puissance_decharge_kw': params.get('sto_discharge_power', 0),
                'tension_v': voltage_demande if voltage_demande not in (None, '') else None,
                'courant_max_a': params.get('sto_courant_max_a'), 'dod_pct': dod,
            },
            montage=montage, nb_total=nb_batteries, nb_serie=params.get('sto_nb_serie'),
            limites={k: params.get('sto_' + k) for k in ('nb_serie_min', 'nb_serie_max', 'nb_parallele_max')},
            onduleur={'couplage': couplage, 'rendement': rendement_onduleur, 'puissance_kw': puissance_onduleur_kw,
                      'hybride': params.get('sto_onduleur_hybride'), 'compatible': params.get('sto_onduleur_compatible')},
        )
        if parc['bloquant']:
            return {
                'outputs': {'parc': parc}, 'bilanEnergetique': {'rows': [], 'total': 0}, 'chartData': {},
                'errorMessage': "Configuration du parc de batteries impossible : " + " ".join(
                    a['message'] for a in parc['alertes'] if a['niveau'] == 'erreur'),
            }
        cap = parc['capacite_nominale_kwh']
        if parc['tension_bus_v']:
            # Tension du bus pour le dimensionnement interne PySAM (bornée à sa plage de travail).
            voltage = min(parc['tension_bus_v'], 1500.0)

        # Planification
        charge_power = parc['puissance_charge_kw']
        discharge_power = parc['puissance_decharge_kw']
        restitution_active = params.get('sto_restitution_toggle') == 'oui'
        recharge_hours = set(_heures_valides(params.get('sto_recharge_hours', [])))
        # Plage de décharge : heures où la batterie a le droit de se décharger. Appliquée UNIQUEMENT
        # avec la recharge réseau (stratégie heures creuses / heures pleines, où elle a un sens) :
        # en stockage solaire seul, restreindre la décharge ne peut que réduire l'autoconsommation
        # (aucun tarif horaire n'est modélisé) — et la plage par défaut (nuit, 22 h-5 h) priverait la
        # batterie du pic de consommation du soir. Vide = décharge à toute heure. Une heure à la fois
        # en recharge et en décharge reste une heure de recharge (cf. _compute_custom_dispatch).
        decharge_hours = set(_heures_valides(params.get('sto_decharge_hours', []))) if restitution_active else set()

        hourly_pv = params.get('hourly_pv', [])
        hourly_cons_ext = params.get('hourly_cons_existante', [])
        hourly_cons_irve = params.get('hourly_cons_irve', [])
        # Module PAC / climatiseur : 3e flux de charge (absent = aucune PAC), fusionné aux deux autres
        # pour le dispatch comme l'IRVE, puis reconstitué au prorata horaire (taux_pac).
        hourly_cons_pac = params.get('hourly_cons_pac', []) or []
        time_step = int(params.get('time_step', 60))
        dt = time_step / 60.0

        if not hourly_pv or not (hourly_cons_ext or hourly_cons_irve or hourly_cons_pac):
            return {
                'outputs': {}, 'bilanEnergetique': {'rows': [], 'total': 0},
                'chartData': {}, 'errorMessage': (
                    "Données horaires (production PV et/ou consommation) manquantes — "
                    "veuillez d'abord lancer \"Calculer et visualiser\"."
                )
            }

        n = len(hourly_pv)
        hourly_load = [
            (hourly_cons_ext[i] if i < len(hourly_cons_ext) else 0.0) +
            (hourly_cons_irve[i] if i < len(hourly_cons_irve) else 0.0) +
            (hourly_cons_pac[i] if i < len(hourly_cons_pac) else 0.0)
            for i in range(n)
        ]

        sto_annuel_mwh = (cap * (dod / 100) * 365) / 1000

        # --- Simulation PySAM.Battery ---
        try:
            model = _executer_simulation(
                cap, charge_power, discharge_power, dod, chemistry, voltage, hourly_pv, hourly_load,
                time_step, rendement_charge, rendement_decharge, recharge_hours, restitution_active,
                decharge_hours, couplage, rendement_onduleur, puissance_onduleur_kw
            )
        except Exception as sim_error:
            logging.exception("Échec de la simulation PySAM.Battery")
            return {
                'outputs': {}, 'bilanEnergetique': {'rows': [], 'total': 0},
                'chartData': {}, 'errorMessage': f"La simulation PySAM n'a pas convergé : {sim_error}"
            }

        hourly_soc = list(model.Outputs.batt_SOC)
        series = _series_ac(model)
        system_to_load = series['system_to_load']
        system_to_batt = series['system_to_batt']
        batt_to_load = series['batt_to_load']
        grid_to_batt = series['grid_to_batt']
        if series['dc']:
            # Couplage DC : pertes côté AC = énergie entrée - énergie restituée (batterie, DC/DC et
            # onduleur), la perte PySAM n'étant exprimée que sur le bus DC.
            batt_annual_energy_loss = max(0.0, (sum(system_to_batt) + sum(grid_to_batt) - sum(batt_to_load)) * dt)
        else:
            batt_annual_energy_loss = float(model.Outputs.batt_annual_energy_loss[0]) if model.Outputs.batt_annual_energy_loss else 0.0

        # CORRECTIF (unités) : les séries PySAM (comme hourly_pv/hourly_cons en entrée) sont des
        # PUISSANCES moyennes en kW par pas de temps, pas des énergies. Énergie = Σ(kW) × durée du pas
        # (dt, en heures) — exactement comme calcul_autoconso.py (step_duration). Sans ce facteur, au
        # pas de 15 min les énergies et les taux étaient multipliés par 4 (×2 à 30 min) ; au pas
        # horaire (dt = 1), résultat strictement inchangé.
        part_solaire_directe_mwh = sum(system_to_load) * dt / 1000.0
        part_solaire_stockee_mwh = sum(system_to_batt) * dt / 1000.0
        batt_to_load_total_mwh = sum(batt_to_load) * dt / 1000.0
        sto_reseau_mwh = sum(grid_to_batt) * dt / 1000.0
        perte_totale_mwh = batt_annual_energy_loss / 1000.0

        # CORRECTIF SCIENTIFIQUE (audit) : la batterie mélange, dans un unique réservoir de SOC, de
        # l'énergie chargée depuis le surplus PV (system_to_batt) ET depuis le réseau (grid_to_batt,
        # pendant la fenêtre de recharge réseau). `batt_to_load` (toute l'énergie restituée à la
        # charge) contient donc les DEUX origines mélangées. Une version précédente comptait TOUTE
        # cette énergie restituée comme "autoconsommation solaire" (taux_stock), ce qui surestimait
        # le taux d'autoconsommation : de l'énergie réseau qui transite par la batterie puis
        # ressort n'est jamais devenue "solaire" — ce n'est qu'un détour, pas de l'autoconsommation.
        # Une fois mélangée, l'énergie stockée n'est plus traçable individuellement (pas de
        # comptage FIFO/LIFO dans PySAM) : on répartit donc la restitution au prorata ANNUEL des
        # origines de charge (convention explicite, documentée, cohérente avec la répartition
        # ext/IRVE déjà utilisée plus bas).
        total_charge_mwh = part_solaire_stockee_mwh + sto_reseau_mwh
        solar_charge_ratio = (part_solaire_stockee_mwh / total_charge_mwh) if total_charge_mwh > 0 else 0.0
        energie_solaire_restituee_mwh = batt_to_load_total_mwh * solar_charge_ratio
        energie_reseau_restituee_mwh = batt_to_load_total_mwh * (1 - solar_charge_ratio)

        # Rendement aller-retour RÉELLEMENT obtenu par la simulation : énergie ressortie de la
        # batterie sur énergie entrée, toutes origines confondues. Il reste légèrement inférieur au
        # RTE demandé (résistance interne de cellule, que PySAM ajoute aux deux rendements de
        # conversion). Remonté explicitement pour que tout écart inattendu soit visible plutôt que
        # de rester enfoui dans la simulation — c'est le meilleur détecteur d'une régression de
        # paramétrage.
        rte_realise = (batt_to_load_total_mwh / total_charge_mwh) if total_charge_mwh > 0 else None

        # PV réellement absorbé sur site heure par heure (direct + part solaire de la restitution
        # batterie, au même prorata annuel), et consommation totale du site (inchangée par le
        # stockage, juste réexposée au même pas de temps) — consommées par main_autoconso.js
        # (renderSeasonalAnalysis) pour recalculer les tableaux mensuel/saisonnier avec le taux
        # d'autoconsommation COMBINÉ (PV + stockage) plutôt que le taux PV seul de la simulation
        # initiale. Somme annuelle cohérente PAR CONSTRUCTION avec taux_combine (même ratio solaire).
        hourly_pv_consumed = [system_to_load[i] + batt_to_load[i] * solar_charge_ratio for i in range(n)]
        hourly_total_consumption = list(hourly_load)

        # Reconstitution a posteriori de la part IRVE vs bâtiment (au prorata horaire), pour
        # préserver l'affichage taux_ext/taux_irve malgré la fusion des 2 flux pour le dispatch.
        pv_to_ext_total = 0.0
        pv_to_irve_total = 0.0
        pv_to_pac_total = 0.0
        batt_to_ext_total = 0.0
        batt_to_irve_total = 0.0
        batt_to_pac_total = 0.0
        for i in range(n):
            ext_kw = hourly_cons_ext[i] if i < len(hourly_cons_ext) else 0.0
            irve_kw = hourly_cons_irve[i] if i < len(hourly_cons_irve) else 0.0
            pac_kw = hourly_cons_pac[i] if i < len(hourly_cons_pac) else 0.0
            total_kw = ext_kw + irve_kw + pac_kw
            if total_kw <= 0:
                continue
            ratio_ext = ext_kw / total_kw
            ratio_pac = pac_kw / total_kw
            ratio_irve = 1 - ratio_ext - ratio_pac
            # Énergies (kWh) : puissance du pas × durée du pas (cf. correctif d'unités plus haut).
            pv_to_ext_total += system_to_load[i] * dt * ratio_ext
            pv_to_irve_total += system_to_load[i] * dt * ratio_irve
            pv_to_pac_total += system_to_load[i] * dt * ratio_pac
            batt_to_ext_total += batt_to_load[i] * dt * ratio_ext
            batt_to_irve_total += batt_to_load[i] * dt * ratio_irve
            batt_to_pac_total += batt_to_load[i] * dt * ratio_pac

        # BUG corrigé (audit) : taux_ext/taux_irve n'intégraient que la part de PV consommée
        # DIRECTEMENT (pv_to_ext_total/pv_to_irve_total) — batt_to_ext_total/batt_to_irve_total
        # étaient calculés puis jamais utilisés (code mort), si bien que taux_ext + taux_irve ne
        # retombait que sur taux_direct, ignorant l'énergie restituée par la batterie. Fixé en
        # additionnant la contribution batterie à chaque flux — SEULEMENT sa part d'origine solaire
        # (solar_charge_ratio, cf. plus haut), pour ne pas compter de l'énergie réseau transitée par
        # la batterie comme de l'autoconsommation. Ceci rétablit l'identité
        # taux_ext + taux_irve == taux_direct + taux_stock == taux_combine (vérifié par test).
        taux_direct = (part_solaire_directe_mwh / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_ext = ((pv_to_ext_total + batt_to_ext_total * solar_charge_ratio) / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_irve = ((pv_to_irve_total + batt_to_irve_total * solar_charge_ratio) / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_pac = ((pv_to_pac_total + batt_to_pac_total * solar_charge_ratio) / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_stock = (energie_solaire_restituee_mwh / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        # Part DIRECTE seule de chaque flux (sans la restitution batterie). taux_ext/taux_irve
        # ci-dessus sont des taux COMBINÉS par flux (direct + batterie) : les afficher côte à côte
        # avec taux_stock puis taux_combine donnait un panneau qui ne s'additionnait pas et laissait
        # croire que la batterie était ignorée dans le taux final (en réalité elle y était comptée
        # deux fois si on faisait la somme à la main). Le panneau de résultats utilise donc ces
        # deux taux directs, pour lesquels
        # taux_ext_direct + taux_irve_direct + taux_stock == taux_combine.
        taux_ext_direct = (pv_to_ext_total / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_irve_direct = (pv_to_irve_total / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        taux_pac_direct = (pv_to_pac_total / 1000.0 / prod_totale_mwh * 100) if prod_totale_mwh > 0 else 0
        sum_taux = taux_direct + taux_stock

        prod_autoconsommee_mwh = part_solaire_directe_mwh + energie_solaire_restituee_mwh
        pr_final = pr_init - (perte_totale_mwh / prod_totale_mwh * 100) if prod_totale_mwh > 0 else pr_init

        # --- Vieillissement (étude économique pluriannuelle) ---
        # Remplace l'ancienne estimation « 1 cycle complet par jour » (cycles / 365 ans), sans lien
        # avec l'usage réel : cycles réellement simulés, dégradation calendaire, sensibilité de
        # l'énergie restituée à la perte de capacité (cf. vieillissement_stockage.py).
        pv_horaire = _moyenne_horaire(hourly_pv, time_step)
        load_horaire = _moyenne_horaire(hourly_load, time_step)

        def simuler_horaire(soh):
            try:
                m = _executer_simulation(
                    cap * soh, charge_power, discharge_power, dod, chemistry, voltage, pv_horaire,
                    load_horaire, 60, rendement_charge, rendement_decharge, recharge_hours,
                    restitution_active, decharge_hours, couplage, rendement_onduleur, puissance_onduleur_kw
                )
                return _flux_annuels(m, 1.0, cap * soh * dod / 100)
            except Exception:
                logging.warning("Simulation de vieillissement impossible à SoH %.0f %%", soh * 100, exc_info=True)
                return None

        flux_reference = _flux_annuels(model, dt, cap * dod / 100)
        vieillissement = {
            'version': 1,
            'restitution_active': restitution_active,
            'capacite_kwh': cap,
            'dod_pct': dod,
            'soh_fin_vie_pct': soh_fin_vie_pct,
            'degrad_cal_pct_an': degrad_cal_pct,
            'cycles_max': cycles,
            'prod_pv_mwh': prod_totale_mwh,
            'e_directe_mwh': part_solaire_directe_mwh,
            'points': _points_vieillissement(flux_reference, soh_fin_vie_pct / 100, simuler_horaire, time_step),
        }
        duree_vie_ans = duree_de_vie_ans(vieillissement)
        vieillissement['duree_vie_ans'] = duree_vie_ans
        energie_totale_vie_mwh = sum(
            a['e_sol_restit_mwh'] + a['e_res_restit_mwh']
            for a in trajectoire(vieillissement, math.ceil(duree_vie_ans), 0.0, 'aucun'))

        # Répartition de la CONSOMMATION couverte (et non de la charge) : la part "stockage" doit
        # représenter l'énergie réellement restituée à la charge, pas l'énergie chargée (qui inclut
        # des pertes non encore décomptées) — cohérent avec la correction ci-dessus.
        chart_data = {
            'labels': ['Stockage Réseau', 'Solaire Direct', 'Solaire Stocké'],
            'datasets': [{
                'data': [energie_reseau_restituee_mwh, part_solaire_directe_mwh, energie_solaire_restituee_mwh],
                'backgroundColor': ['#E1000F', '#FFC107', '#1E8449']
            }]
        }

        return {
            'outputs': {
                # Énergie restituée par la batterie jusqu'à sa fin de vie (sans remplacement), MWh.
                'sto_energie_vie': energie_totale_vie_mwh,
                'sto_duree_vie': round(duree_vie_ans, 1),
                'cycles_an': round(flux_reference['cycles_an'], 1),
                'vieillissement': vieillissement,
                'sto_annuel': sto_annuel_mwh,
                'sto_prod_autoconsommee': prod_autoconsommee_mwh,
                'sto_reseau': sto_reseau_mwh,
                'taux_direct': taux_direct,
                'taux_ext': taux_ext,
                'taux_irve': taux_irve,
                'taux_pac': taux_pac,
                'taux_ext_direct': taux_ext_direct,
                'taux_irve_direct': taux_irve_direct,
                'taux_pac_direct': taux_pac_direct,
                'taux_stock': taux_stock,
                'taux_combine': sum_taux,
                'pr_init': pr_init,
                'pr_final': pr_final,
                'rte_demande_pct': round(rte * 100, 2),
                'rte_realise_pct': round(rte_realise * 100, 2) if rte_realise is not None else None,
                'tension_demandee_v': voltage,
                'tension_retenue_v': getattr(model, '__tension_retenue', voltage),
                'capacite_demandee_kwh': cap,
                'capacite_simulee_kwh': round(float(model.value('batt_computed_bank_capacity')), 3),
                'capacite_utile_kwh': round(float(model.value('batt_computed_bank_capacity')) * dod / 100, 3),
                'plage_decharge_appliquee': bool(decharge_hours),
                'nb_batteries': parc['nb_total'],
                'montage': montage,
                'parc': parc,
                'couplage': couplage,
                'rendement_onduleur_pct': round(rendement_onduleur * 100, 2) if couplage == 'DC' else None,
                'rendement_systeme_theorique_pct': {k: round(v * 100, 2) for k, v in
                                                    rendement_systeme(rte, couplage, rendement_onduleur).items()},
                'hourly_soc': hourly_soc,
                # Convention historique préservée (positif = charge) : l'export Excel existant
                # (main_autoconso.js, colonne "Flux Batterie") a toujours affiché un flux positif
                # pendant la charge. PySAM utilise la convention inverse (positif = décharge), d'où
                # l'inversion de signe ici pour ne pas changer le sens de cette colonne déjà exportée.
                'hourly_batt_flux': [-p for p in series['batt_power']],
                'hourly_pv_consumed': hourly_pv_consumed,
                'hourly_total_consumption': hourly_total_consumption
            },
            'bilanEnergetique': {
                'rows': [
                    {"label": "Énergie solaire Directe", "value": part_solaire_directe_mwh},
                    {"label": "Énergie solaire stockée (Entrante)", "value": part_solaire_stockee_mwh},
                    {"label": "Énergie solaire restituée", "value": energie_solaire_restituee_mwh},
                    {"label": "Énergie réseau stockée (Entrante)", "value": sto_reseau_mwh},
                    {"label": "Énergie réseau restituée", "value": energie_reseau_restituee_mwh},
                    {"label": "Perte d'énergie totale (batterie)", "value": perte_totale_mwh},
                ],
                # Bilan physique complet (charge = décharge + pertes) : direct + tout ce qui est
                # restitué (solaire + réseau) + pertes == PV consommé directement + tout ce qui a
                # transité par la batterie, quelle que soit son origine.
                'total': part_solaire_directe_mwh + energie_solaire_restituee_mwh + energie_reseau_restituee_mwh + perte_totale_mwh
            },
            'chartData': chart_data,
            'errorMessage': ""
        }
    except Exception as e:
        logging.exception("Erreur lors du calcul de stockage (PySAM)")
        return {
            'outputs': {}, 'bilanEnergetique': {'rows': [], 'total': 0},
            'chartData': {}, 'errorMessage': f"Erreur lors du calcul de stockage : {e}"
        }
