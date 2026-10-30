import math
import os
import numpy_financial as npf
import requests
from functools import lru_cache
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import traceback

# Configuration d'une session avec stratégie de retry pour plus de robustesse
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504])
session.mount('https://', HTTPAdapter(max_retries=retries))

@lru_cache(maxsize=128)
def get_pvgis_daily_irradiation(lat, lon, angle, aspect, loss):
    """
    Récupère les données d'irradiation mensuelles via API (PVGIS)
    et les convertit en irradiation journalière moyenne (kWh/m²/jour).
    Résultats mis en cache pour accélérer les appels répétés.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PVProject/1.0',
        'Accept': 'application/json'
    }
    params = {
        'lat': lat,
        'lon': lon,
        'peakpower': 1, # 1 kWc pour avoir l'irradiation normalisée
        'loss': loss,
        'angle': angle,
        'aspect': aspect,
        'outputformat': 'json'
    }

    env_url = os.getenv('PVGIS_CALC_URL')
    urls = [env_url] if env_url else [
        "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc",
        "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc"
    ]

    for url in urls:
        if not url:
            continue
        try:
            response = session.get(url, params=params, headers=headers, timeout=12)
            response.raise_for_status()
            data = response.json()
            
            monthly_data = data['outputs']['monthly']['fixed']
            days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            
            # H(i)_m est en kWh/m²/mois -> conversion en kWh/m²/jour
            daily_irradiation = []
            for i, m in enumerate(monthly_data):
                h_m = m['H(i)_m']
                daily_irradiation.append(h_m / days_in_month[i])
                
            return daily_irradiation
        except Exception as e:
            print(f"Erreur API Irradiation sur {url}: {e}")
            continue

    return None

# ---------------------------------------------------------------------------------------------
# Type de système de pompage solaire (section 1 du module)
# ---------------------------------------------------------------------------------------------
#   - 'fil_soleil' : PV -> contrôleur -> pompe -> réservoir. Pas d'appoint : le déficit des mois peu
#     ensoleillés n'est PAS pompé (besoin non couvert) ; le réservoir assure la nuit et les jours couverts.
#   - 'groupe' : pompe solaire + groupe électrogène d'appoint, qui pompe le déficit (tout le besoin servi).
#   - 'batteries' : pompe solaire + batteries de secours. Hypothèse prudente : TOUTE l'énergie PV
#     transite par la batterie (rendement aller-retour appliqué) ; la pompe, alimentée par la batterie,
#     tourne à son point nominal (pas de perte au seuil de démarrage : le coefficient de réduction est
#     remplacé par le rendement de la batterie). La batterie déplace l'énergie dans la journée, elle n'en
#     crée pas : le déficit mensuel reste non couvert. Capacité nominale = énergie de pompage journalière
#     x autonomie / (profondeur de décharge x racine du rendement aller-retour, part de décharge).
SYSTEMES_POMPAGE = ('fil_soleil', 'groupe', 'batteries')
# Réservoir de stockage conseillé, en jours de besoin (règle usuelle) : plus grand sans appoint.
JOURS_RESERVOIR = {'fil_soleil': 3, 'groupe': 1, 'batteries': 1}
# Groupe d'appoint conseillé : puissance électrique de la pompe x marge de démarrage / cos phi.
MARGE_DEMARRAGE_GE = 1.5
COS_PHI_GE = 0.8
AUTONOMIE_BATTERIE_DEFAUT_J = 1.0
DOD_BATTERIE_DEFAUT_PCT = 80.0
RENDEMENT_BATTERIE_DEFAUT_PCT = 90.0
COEF_SURDIMENSIONNEMENT_DEFAUT = 1.10


def systeme_pompage(valeur, defaut='fil_soleil'):
    return valeur if valeur in SYSTEMES_POMPAGE else defaut


def recommandations_systeme(systeme, volume_reservoir_m3, jours_reservoir, puissance_ge_kva, capacite_batterie_kwh):
    """Recommandations propres au type de système (ajoutées après les recommandations générales)."""
    if systeme == 'groupe':
        return [
            f"Groupe électrogène d'appoint : {puissance_ge_kva:.1f} kVA au moins, avec un inverseur de source solaire / groupe compatible avec le contrôleur de la pompe",
            f"Réservoir de stockage conseillé : {volume_reservoir_m3:.0f} m³ ({jours_reservoir} jour(s) de besoin)",
        ]
    if systeme == 'batteries':
        return [
            f"Batteries de secours : {capacite_batterie_kwh:.1f} kWh nominaux, avec régulateur de charge (protection contre la décharge profonde) et local ventilé",
            f"Réservoir de stockage conseillé : {volume_reservoir_m3:.0f} m³ ({jours_reservoir} jour(s) de besoin)",
        ]
    return [f"Pompage au fil du soleil : réservoir de stockage d'au moins {volume_reservoir_m3:.0f} m³ ({jours_reservoir} jours de besoin) pour la nuit et les jours couverts"]


def generate_recommendations(hmt, req_pv, debit_m3h, min_rad, avg_rad):
    """Génère la liste des recommandations techniques."""
    recs = []
    if hmt > 100:
        recs.append('HMT élevée : privilégier une pompe immergée haute pression')
    if req_pv > 5000:
        recs.append('Puissance élevée : envisager un système triphasé avec onduleur adapté')
    if debit_m3h > 10:
        recs.append('Débit important : vérifier le diamètre des conduites (min. 50mm recommandé)')
    if min_rad < 4.5:
        recs.append('Faible irradiation en saison basse : prévoir un stockage tampon ou réduire les besoins')
    if (avg_rad - min_rad) > 1.5:
        recs.append('Forte variation saisonnière : dimensionner sur le pire mois')
    
    recs.append('Installer un contrôleur MPPT pour optimiser la production')
    recs.append('Prévoir une protection contre la marche à sec')
    return recs

def safe_float(value, default=0.0):
    """Convertit une valeur en float de manière sécurisée, retournant une valeur par défaut si vide ou invalide."""
    try:
        if value is None or str(value).strip() == "":
            return default
        # Gestion des virgules comme séparateur décimal pour robustesse
        val_str = str(value).replace(',', '.')
        return float(val_str)
    except (ValueError, TypeError):
        return default

def process_simulation(data):
    """Orchestre le calcul complet de dimensionnement."""
    if data is None:
        return {"error": "Aucune donnée reçue (JSON invalide ou manquant)"}

    try:
        # 1. Extraction et conversion des entrées
        lat = safe_float(data.get('lat'), 0)
        lon = safe_float(data.get('lon'), 0)
        angle = safe_float(data.get('angle'), 35)
        aspect = safe_float(data.get('aspect'), 0)
        v_day = safe_float(data.get('daily_need'), 0)
        h_asp = safe_float(data.get('h_aspiration'), 0)
        h_tank = safe_float(data.get('h_tank'), 0)
        losses_pipe_pct = safe_float(data.get('losses_pipe'), 0)
        pump_eff = safe_float(data.get('pump_efficiency'), 0.6)
        installed_pv_kw = safe_float(data.get('puissance_reelle_installee_kwc'), 0)
        
        # Nouveaux paramètres de design
        perte_systeme = safe_float(data.get('perte_systeme'), 14) # Défaut 14% (Standard PVGIS)
        sys_eff = 1.0 - (perte_systeme / 100.0) # PR calculé
        
        coef_reduction_pomp = safe_float(data.get('coef_reduction_pomp'), 0.95) # Défaut 95%
        # Marge appliquée à la puissance PV nécessaire (1 à 2, défaut 1,10).
        coef_surdimensionnement = safe_float(data.get('coef_surdimensionnement'), COEF_SURDIMENSIONNEMENT_DEFAUT)
        conso_specifique_ge = safe_float(data.get('conso_specifique_ge'), 0.5) # L/kWh (borne basse du formulaire)
        facteur_emission_co2 = safe_float(data.get('facteur_emission_co2'), 0.58) # kgCO2/kWh

        systeme = systeme_pompage(data.get('systeme'))
        avec_batteries = systeme == 'batteries'
        rend_batterie = safe_float(data.get('rendement_batterie_pct'), RENDEMENT_BATTERIE_DEFAUT_PCT) / 100.0 if avec_batteries else 1.0
        dod_batterie = safe_float(data.get('dod_batterie_pct'), DOD_BATTERIE_DEFAUT_PCT) / 100.0
        autonomie_batterie = safe_float(data.get('autonomie_batterie_j'), AUTONOMIE_BATTERIE_DEFAUT_J)
        # Part de l'énergie électrique transformée en eau : seuil de démarrage (pompe au fil du soleil)
        # ou rendement aller-retour de la batterie (cf. SYSTEMES_POMPAGE).
        coef_volume = rend_batterie if avec_batteries else coef_reduction_pomp
        # Sans groupe électrogène (fil du soleil, batteries) : aucun carburant ni aucune émission de
        # groupe ne sont comptés (carburant économisé, CO2 évité et carburant de référence à 0).
        if systeme != 'groupe':
            conso_specifique_ge = 0.0
            facteur_emission_co2 = 0.0

    except Exception as e:
        print(f"Erreur dans process_simulation: {e}")
        traceback.print_exc()
        return {"error": f"Données d'entrée invalides: {str(e)}"}

    # Production mensuelle REELLE du calepinage (kWh AC, 12 valeurs, ombrage proche 3D / PR / ecretage
    # compris), issue du calcul « vente en totalite » : remplace l'estimation kWc x irradiation x PR,
    # seulement avec une puissance installee (celle du calepinage).
    prod_brute = data.get('production_mensuelle_kwh')
    prod_reelle = [safe_float(v, 0) for v in prod_brute] if isinstance(prod_brute, list) and len(prod_brute) == 12 else None
    avec_prod_reelle = bool(prod_reelle) and installed_pv_kw > 0

    # 2. Calculs Physiques de base
    h_geo = h_asp + h_tank
    hmt = h_geo * (1 + losses_pipe_pct / 100.0)

    # 3. Récupération Irradiation
    daily_irradiation = get_pvgis_daily_irradiation(lat, lon, angle, aspect, perte_systeme)
    
    using_fallback = False
    if not daily_irradiation:
        # Données de secours (Profil type Sahel/Dakar)
        daily_irradiation = [5.1, 5.5, 6.0, 6.2, 5.8, 5.2, 4.8, 4.5, 4.9, 5.3, 5.2, 5.0]
        using_fallback = True

    worst_month_rad = min(daily_irradiation)
    avg_month_rad = sum(daily_irradiation) / len(daily_irradiation)

    # 4. Dimensionnement
    # P_PV = (1000 * 9.81 * HMT * V_day) / (3600 * H_sun_min * PR * eta_pompe [* eta_batterie])
    if worst_month_rad > 0 and sys_eff > 0 and pump_eff > 0 and rend_batterie > 0:
        req_pv = (1000 * 9.81 * hmt * v_day) / (3600 * worst_month_rad * sys_eff * pump_eff * rend_batterie)
        # Puissance PV nécessaire = puissance calculée x coefficient de surdimensionnement.
        req_pv *= coef_surdimensionnement
    else:
        req_pv = 0

    # Détermine la puissance PV à utiliser pour les calculs hydrauliques (Priorité Design Personnalisé)
    pv_power_for_hydraulic_calc_kw = installed_pv_kw if installed_pv_kw > 0 else (req_pv / 1000.0)

    debit_moyen = v_day / 6.0 # Hypothèse de 6h de pompage solaire effectif

    # Puissance Pompe
    pump_power_w = (1000 * 9.81 * hmt * (debit_moyen / 3600.0)) / pump_eff if pump_eff > 0 else 0
    pump_power_kw = pump_power_w / 1000.0
    # 1 CV (cheval-vapeur, unite du libelle affiche) = 735,5 W. 0.7457 kW etait la valeur du
    # HP mecanique anglo-saxon : le backend et l'interface donnaient donc deux chiffres
    # differents pour la meme ligne (l'affichage divisait deja par 735.5 et ignorait cette
    # valeur-ci). Ecart de 1,4 % sur la puissance annoncee en CV.
    pump_power_cv = pump_power_w / 735.5

    # 5. Bilan Énergétique Annuel
    elec_energy_day_kwh = (9.81 * hmt * v_day) / (3600 * pump_eff) if pump_eff > 0 else 0
    energy_pumping_mwh_yr = (elec_energy_day_kwh * 365) / 1000.0

    # Estimation production solaire annuelle
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    total_solar_kwh = 0
    
    # Variables pour le graphique de l'eau
    monthly_needs = []
    monthly_pumped = []
    total_annual_irradiation = 0
    monthly_missing = []
    total_solar_prod_design_kwh = 0 # Pour CO2
    monthly_pumped_design = [] # Pour le calcul design spécifique

    for i, daily in enumerate(daily_irradiation):
        monthly_rad = daily * days_in_month[i] # Irradiation mensuelle pour le mois i
        total_solar_kwh += (req_pv / 1000.0) * monthly_rad * sys_eff
        
        # Calculs hydrauliques mensuels
        total_annual_irradiation += monthly_rad
        m_need = v_day * days_in_month[i]
        monthly_needs.append(m_need)
        
        # Volume pompé potentiel (basé sur la puissance prioritaire)
        # V = (E_elec_kwh * 3600 * pump_eff) / (9.81 * HMT)
        e_elec_month = prod_reelle[i] if avec_prod_reelle else pv_power_for_hydraulic_calc_kw * daily * sys_eff * days_in_month[i]
        m_pumped_raw = (e_elec_month * 3600 * pump_eff) / (9.81 * hmt) if hmt > 0 else 0
        
        # Volume effectif (coef de réduction pour simuler le seuil, ou rendement de la batterie)
        m_pumped = m_pumped_raw * coef_volume
        monthly_pumped.append(m_pumped)

        # Déficit (basé sur le volume pompé plafonné au besoin pour le calcul du manque, 
        # mais ici on veut afficher le déficit réel. Si on pompe plus que le besoin, déficit = 0)
        # Note: Pour le graphique, on garde m_pumped tel quel (capacité de pompage), 
        # mais pour le taux de satisfaction, on plafonnera.
        monthly_missing.append(max(0, m_need - m_pumped)) 

        # Energie produite par le système installé (pour CO2)
        if installed_pv_kw > 0:
            total_solar_prod_design_kwh += prod_reelle[i] if avec_prod_reelle else installed_pv_kw * monthly_rad * sys_eff
    
    # Calculs énergétiques globaux
    energy_solar_mwh_yr = total_solar_kwh / 1000.0
    
    # KPI: Volume d'eau requis annuel
    annual_water_need_m3 = v_day * 365
    
    # KPI: Taux de satisfaction (Théorique ou Design selon la priorité définie plus haut)
    # CORRECTION: Le volume pompé utile ne peut pas dépasser le besoin mensuel.
    # Si m_pumped > m_need, on ne compte que m_need pour le taux de satisfaction.
    total_pumped_useful_m3 = 0
    for i, m_p in enumerate(monthly_pumped):
        m_n = monthly_needs[i]
        total_pumped_useful_m3 += min(m_p, m_n)

    satisfaction_rate = (total_pumped_useful_m3 / annual_water_need_m3 * 100) if annual_water_need_m3 > 0 else 0
    
    # Calcul de l'économie de carburant
    # Basée sur le volume pompé solaire réel (effective) et la consommation spécifique du GE
    # Energie hydraulique totale (kWh)
    e_hyd_total_kwh = (9.81 * hmt * total_pumped_useful_m3) / 3600.0
    # Energie électrique équivalente (kWh) avec rendement pompe
    e_elec_equiv_kwh = e_hyd_total_kwh / pump_eff if pump_eff > 0 else 0
    fuel_savings_liters = e_elec_equiv_kwh * conso_specifique_ge
    # Carburant qu'un groupe electrogene brulerait pour pomper TOUT le besoin, et ce qu'il reste a lui
    # faire pomper avec le solaire (deficit des mois peu ensoleilles). Base de analyse_economique().
    fuel_without_solar_liters = elec_energy_day_kwh * 365 * conso_specifique_ge
    fuel_residual_liters = max(0, fuel_without_solar_liters - fuel_savings_liters)

    # Grandeurs propres au type de système.
    deficit_m3 = sum(monthly_missing)
    jours_reservoir = JOURS_RESERVOIR[systeme]
    volume_reservoir_m3 = v_day * jours_reservoir
    puissance_ge_kva = pump_power_kw * MARGE_DEMARRAGE_GE / COS_PHI_GE if systeme == 'groupe' else 0.0
    capacite_utile_kwh = elec_energy_day_kwh * autonomie_batterie if avec_batteries else 0.0
    capacite_nominale_kwh = (capacite_utile_kwh / (dod_batterie * math.sqrt(rend_batterie))
                             if avec_batteries and dod_batterie > 0 and rend_batterie > 0 else 0.0)

    # 6. Calcul Design Personnalisé (si puissance installée fournie)
    energy_solar_design_mwh_yr = 0
    satisfaction_rate_design = 0
    co2_avoided_tonnes = 0
    
    if installed_pv_kw > 0:
        energy_solar_design_mwh_yr = total_solar_prod_design_kwh / 1000.0
        # Le taux de satisfaction calculé plus haut (satisfaction_rate) utilise déjà installed_pv_kw 
        # car pv_power_for_hydraulic_calc_kw priorise installed_pv_kw dans la boucle principale.
        satisfaction_rate_design = satisfaction_rate
        
        # On doit recalculer le taux théorique (basé sur req_pv) pour l'affichage "Taux de satisfaction (théorique)"
        # car la boucle principale a utilisé installed_pv_kw.
        total_pumped_useful_theo_m3 = 0
        for i, daily in enumerate(daily_irradiation):
            m_n = monthly_needs[i]
            # Recalcul théorique
            e_elec_daily_theo = (req_pv / 1000.0) * daily * sys_eff
            v_pumped_daily_theo = (e_elec_daily_theo * 3600 * pump_eff) / (9.81 * hmt) if hmt > 0 else 0
            m_pumped_theo = v_pumped_daily_theo * days_in_month[i] * coef_volume
            total_pumped_useful_theo_m3 += min(m_pumped_theo, m_n)

        satisfaction_rate = (total_pumped_useful_theo_m3 / annual_water_need_m3 * 100) if annual_water_need_m3 > 0 else 0

    # KPI: Emissions CO2 évitées = électricité que le groupe électrogène aurait produite pour pomper le
    # MÊME volume utile (e_elec_equiv_kwh, celui du carburant économisé). Auparavant toute la production
    # PV était comptée, y compris le surplus des mois ensoleillés qui ne pompe aucune eau utile : le CO2
    # évité était surestimé, et incohérent avec le carburant économisé.
    co2_avoided_tonnes = (e_elec_equiv_kwh * facteur_emission_co2) / 1000.0

    # 6. Recommandations
    recommendations = generate_recommendations(hmt, req_pv, debit_moyen, worst_month_rad, avg_month_rad) \
        + recommandations_systeme(systeme, volume_reservoir_m3, jours_reservoir, puissance_ge_kva, capacite_nominale_kwh)

    return {
        "success": True,
        "systeme": systeme,
        "production_reelle": avec_prod_reelle,
        "using_fallback": using_fallback,
        "hmt": round(hmt, 2),
        "h_geo": round(h_geo, 2),
        "req_pv_w": round(req_pv, 2),
        "debit_moyen_m3h": round(debit_moyen, 2),
        "pump_power_w": round(pump_power_w, 2),
        "pump_power_kw": round(pump_power_kw, 2),
        "pump_power_cv": round(pump_power_cv, 2),
        "energy_pumping_mwh_yr": round(energy_pumping_mwh_yr, 2),
        "energy_solar_mwh_yr": round(energy_solar_mwh_yr, 2),
        "solar_coverage": round(satisfaction_rate, 2), # Renvoie le taux de satisfaction
        "worst_month_rad": round(worst_month_rad, 2),
        "energy_solar_design_mwh_yr": round(energy_solar_design_mwh_yr, 2),
        "solar_coverage_design": round(satisfaction_rate_design, 2),
        "daily_irradiation": daily_irradiation,
        "total_annual_irradiation": round(total_annual_irradiation, 2),
        "monthly_needs": monthly_needs,
        "monthly_pumped": monthly_pumped,
        "monthly_missing": monthly_missing,
        "fuel_savings_liters": round(fuel_savings_liters, 0),
        "fuel_without_solar_liters": round(fuel_without_solar_liters, 2),
        "fuel_residual_liters": round(fuel_residual_liters, 2),
        "annual_water_need_m3": round(annual_water_need_m3, 2),
        "co2_avoided_tonnes": round(co2_avoided_tonnes, 2),
        # Type de système : besoin non couvert (sans appoint), appoint du groupe, batteries, réservoir.
        "besoin_non_couvert_m3": round(deficit_m3, 2) if systeme != 'groupe' else 0.0,
        "volume_groupe_m3_an": round(deficit_m3, 2) if systeme == 'groupe' else 0.0,
        "puissance_groupe_kva": round(puissance_ge_kva, 2),
        "capacite_batterie_utile_kwh": round(capacite_utile_kwh, 2),
        "capacite_batterie_nominale_kwh": round(capacite_nominale_kwh, 2),
        "rendement_batterie_pct": round(rend_batterie * 100, 2) if avec_batteries else None,
        "volume_reservoir_m3": round(volume_reservoir_m3, 2),
        "jours_reservoir": jours_reservoir,
        "recommendations": recommendations
    }

# ---------------------------------------------------------------------------------------------
# Analyse economique : pompage solaire vs pompage au groupe electrogene seul
# ---------------------------------------------------------------------------------------------
# IMPLEMENTATION DE REFERENCE de PompageSolaireCalculs.analyseEconomique (pompage_solaire_calculs.js),
# calculee dans le navigateur ; tests/pompage_solaire/test_parite_pompage.py verifie la parite.
#
# Evolution dans le temps (communes a l'analyse economique et au plan d'affaires) :
#   - besoin en eau de l'annee t = besoin x evolution_besoins^(t-1) (applique des l'annee 2) ;
#   - volume pompe au solaire de l'annee t = volume de l'annee 1 x (1 - degradation_pv)^(t-1) ;
#   - volume solaire UTILE = somme sur les 12 mois de min(pompe solaire, besoin) ; le groupe
#     electrogene pompe le reste (deficit). Carburant = litres par m3 pompes au groupe x volume.
#
# Sans solaire : le groupe pompe tout le besoin -> carburant (indexe sur l'inflation carburant)
#   + Opex du groupe + remplacement du groupe l'annee ANNEE_REMPLACEMENT_GE.
# Avec solaire : Capex en annee 0, Opex de la centrale (indexe sur indexation_opex_pv), remplacement de
#   l'onduleur/controleur de pompe l'annee ANNEE_REMPLACEMENT_ONDULEUR, et le groupe ne pompe plus que le deficit ;
#   son Opex et son remplacement sont proratises sur sa part residuelle de l'annee (l'usure suit les heures de marche).
# Gain annuel = cout sans solaire - cout avec solaire (hors Capex).
#
# Selon le type de système (SYSTEMES_POMPAGE) :
#   - 'groupe' : modèle ci-dessus (le groupe d'appoint pompe le déficit, tout le besoin est servi).
#   - 'fil_soleil' et 'batteries' : AUCUN groupe électrogène, ni avec le solaire ni en référence :
#     Opex, remplacement, carburant du groupe forcés à 0 (quelles que soient les saisies). L'analyse
#     devient une analyse des COÛTS du système (gain = - coût) : coût global actualisé et coût
#     actualisé du m³ pompé. Le déficit n'est pas pompé : besoin non couvert publié à part.
# Coût actualisé du m³ (tous types) = (investissement + coûts annuels actualisés) / volumes servis
#   actualisés (besoin avec groupe d'appoint, volume solaire utile sinon).
#   - 'batteries' : Capex des batteries en année 0, remplacées aux années multiples de leur durée de
#     vie (annees_remplacement_batterie).
# Sans `systeme` (anciens appels), le modèle 'groupe' historique est conservé.

DUREE_ANALYSE_ANS = 20
DUREE_VIE_BATTERIE_DEFAUT = 10


def annees_remplacement_batterie(duree_vie, horizon):
    """Années de remplacement des batteries : multiples de la durée de vie, dans l'horizon, avant la
    20e année (pas de remplacement la dernière année d'une étude de 20 ans). Durée de vie 10 ans :
    année 10 seule, comme les autres remplacements du module."""
    duree_vie = int(duree_vie or 0)
    if duree_vie <= 0:
        return []
    return list(range(duree_vie, min(int(horizon), DUREE_ANALYSE_ANS - 1) + 1, duree_vie))
ANNEE_REMPLACEMENT_GE = 10
ANNEE_REMPLACEMENT_ONDULEUR = 10
EVOLUTION_BESOINS_DEFAUT = 1.10   # coefficient annuel (borne 1 - 2)
DEGRADATION_PV_DEFAUT = 0.3       # %/an (borne 0,1 - 5)


def _van(flux, taux):
    return sum(f / (1 + taux) ** t for t, f in enumerate(flux))


def _tri(flux):
    """TRI par dichotomie sur [-99 %, 1000 %] ; None si la VAN ne change pas de signe."""
    bas, haut = -0.99, 10.0
    v_bas, v_haut = _van(flux, bas), _van(flux, haut)
    if v_bas * v_haut > 0:
        return None
    for _ in range(200):
        milieu = (bas + haut) / 2
        v_milieu = _van(flux, milieu)
        if v_milieu == 0:
            return milieu
        if v_bas * v_milieu < 0:
            haut = milieu
        else:
            bas, v_bas = milieu, v_milieu
    return (bas + haut) / 2


def _annee_retour(lignes, cle, cle_gain):
    if lignes and lignes[0][cle] >= 0:
        return 0.0  # investissement entierement finance des l'annee 0
    for i in range(1, len(lignes)):
        if lignes[i][cle] >= 0:
            avant = lignes[i - 1][cle]
            gain = lignes[i][cle_gain]
            return (i - 1) + (-avant / gain) if gain > 0 else i
    return None


def profil_pompage(resultat):
    """(pompe mensuel m3, besoin mensuel m3, litres de carburant par m3 pompe au groupe).

    Repli pour un ancien resultat sans tableaux mensuels : un seul « mois » reconstruit a partir du
    carburant (1 L = 1 « m3 »), qui redonne exactement l'annee 1.
    """
    resultat = resultat or {}
    pompes, besoins = resultat.get('monthly_pumped'), resultat.get('monthly_needs')
    carb_sans = safe_float(resultat.get('fuel_without_solar_liters'), 0)
    if isinstance(pompes, list) and isinstance(besoins, list) and len(pompes) == 12 and len(besoins) == 12:
        p = [max(0.0, safe_float(v, 0)) for v in pompes]
        b = [max(0.0, safe_float(v, 0)) for v in besoins]
        total = sum(b)
        return p, b, (carb_sans / total if total > 0 else 0.0)
    carb_resid = safe_float(resultat.get('fuel_residual_liters'), 0)
    return [max(0.0, carb_sans - carb_resid)], [carb_sans], 1.0


def volumes_annee(pompes, besoins, t, evolution, degradation):
    """(besoin, volume solaire utile) en m3 l'annee t >= 1. degradation en fraction (0,003)."""
    g = evolution ** (t - 1)
    d = (1 - degradation) ** (t - 1)
    besoin = sum(b * g for b in besoins)
    utile = sum(min(p * d, b * g) for p, b in zip(pompes, besoins))
    return besoin, utile


def analyse_economique(resultat, params):
    """resultat : sortie de process_simulation ; params : capex, opex_pv, opex_ge, remplacement_ge,
    prix_carburant, inflation_carburant (%), taux_actualisation (%), indexation_opex_pv (%),
    remplacement_onduleur, evolution_besoins (coefficient), degradation_pv (%/an)."""
    params = params or {}
    pompes, besoins, litres_m3 = profil_pompage(resultat)
    capex = safe_float(params.get('capex'), 0)
    opex_pv = safe_float(params.get('opex_pv'), 0)
    opex_ge = safe_float(params.get('opex_ge'), 1000)
    rempl_ge = safe_float(params.get('remplacement_ge'), 7000)
    prix = safe_float(params.get('prix_carburant'), 0)
    infl = safe_float(params.get('inflation_carburant'), 3) / 100.0
    taux = safe_float(params.get('taux_actualisation'), 3) / 100.0
    index_opex_pv = safe_float(params.get('indexation_opex_pv'), 3) / 100.0
    rempl_onduleur = safe_float(params.get('remplacement_onduleur'), 2000)
    evolution = safe_float(params.get('evolution_besoins'), EVOLUTION_BESOINS_DEFAUT)
    degradation = safe_float(params.get('degradation_pv'), DEGRADATION_PV_DEFAUT) / 100.0
    systeme = systeme_pompage(params.get('systeme'), defaut='groupe')
    appoint = systeme == 'groupe'
    avec_batteries = systeme == 'batteries'
    capex_batterie = safe_float(params.get('capex_batterie'), 0) if avec_batteries else 0.0
    rempl_batterie = safe_float(params.get('remplacement_batterie'), 0) if avec_batteries else 0.0
    duree_vie_batterie = int(safe_float(params.get('duree_vie_batterie'), DUREE_VIE_BATTERIE_DEFAUT))
    annees_batterie = annees_remplacement_batterie(duree_vie_batterie, DUREE_ANALYSE_ANS) if avec_batteries else []
    invest = capex + capex_batterie
    if not appoint:
        opex_ge = rempl_ge = prix = 0.0
    cout_global_act = invest
    volume_act = volume_total = 0.0

    lignes = [{
        'annee': 0, 'besoin_m3': 0, 'non_couvert_m3': 0, 'carburant_sans_l': 0, 'carburant_avec_l': 0,
        'cout_carburant_sans': 0, 'cout_sans': 0, 'cout_carburant_avec': 0,
        'cout_avec': invest, 'opex_pv': 0, 'remplacement_batterie': 0, 'gain': -invest, 'cumul': -invest,
        'gain_actualise': -invest, 'cumul_actualise': -invest,
    }]
    flux = [-invest]
    cumul = cumul_act = -invest
    total_sans, total_avec, total_gains, carb_economise = 0, invest, 0, 0
    part_annee_1 = 0
    non_couvert_1 = 0.0
    # Volume solaire utile perdu par la degradation des panneaux (ecart avec des panneaux sans
    # degradation) : nul tant que le surplus de capacite des mois ensoleilles absorbe la baisse.
    perte_degradation = 0.0
    annee_effet_degradation = None

    for t in range(1, DUREE_ANALYSE_ANS + 1):
        besoin, utile = volumes_annee(pompes, besoins, t, evolution, degradation)
        perte = volumes_annee(pompes, besoins, t, evolution, 0.0)[1] - utile
        perte_degradation += perte
        if annee_effet_degradation is None and perte > 1e-9:
            annee_effet_degradation = t
        if appoint:
            carb_sans = litres_m3 * besoin
            carb_resid = litres_m3 * max(0.0, besoin - utile)
            non_couvert = 0.0
        else:
            # Volume d'eau égal : le groupe de référence pompe le volume utile du solaire.
            carb_sans = litres_m3 * utile
            carb_resid = 0.0
            non_couvert = max(0.0, besoin - utile)
        part = min(1.0, carb_resid / carb_sans) if carb_sans > 0 else 0.0
        if t == 1:
            part_annee_1 = part
            non_couvert_1 = non_couvert
        index_carb = (1 + infl) ** (t - 1)
        remplacement = rempl_ge if t == ANNEE_REMPLACEMENT_GE else 0
        carburant_sans = carb_sans * prix * index_carb
        cout_sans = carburant_sans + opex_ge + remplacement
        carburant_avec = carb_resid * prix * index_carb
        opex_pv_annee = opex_pv * (1 + index_opex_pv) ** (t - 1)
        remplacement_onduleur = rempl_onduleur if t == ANNEE_REMPLACEMENT_ONDULEUR else 0
        remplacement_batt = rempl_batterie if t in annees_batterie else 0
        cout_avec = (opex_pv_annee + remplacement_onduleur + remplacement_batt + carburant_avec
                     + (opex_ge + remplacement) * part)
        gain = cout_sans - cout_avec
        gain_act = gain / (1 + taux) ** t
        cumul += gain
        cumul_act += gain_act
        servi = besoin if appoint else utile
        volume_total += servi
        volume_act += servi / (1 + taux) ** t
        cout_global_act += cout_avec / (1 + taux) ** t
        total_sans += cout_sans
        total_avec += cout_avec
        total_gains += gain
        carb_economise += carb_sans - carb_resid
        flux.append(gain)
        lignes.append({
            'annee': t,
            'besoin_m3': round(besoin, 2),
            'non_couvert_m3': round(non_couvert, 2),
            'remplacement_batterie': round(remplacement_batt, 2),
            'carburant_sans_l': round(carb_sans, 2),
            'carburant_avec_l': round(carb_resid, 2),
            'cout_carburant_sans': round(carburant_sans, 2),
            'cout_sans': round(cout_sans, 2),
            'cout_carburant_avec': round(carburant_avec, 2),
            'opex_pv': round(opex_pv_annee, 2),
            'cout_avec': round(cout_avec, 2),
            'gain': round(gain, 2),
            'cumul': round(cumul, 2),
            'gain_actualise': round(gain_act, 2),
            'cumul_actualise': round(cumul_act, 2),
        })

    tri = _tri(flux)
    retour = _annee_retour(lignes, 'cumul', 'gain')
    retour_act = _annee_retour(lignes, 'cumul_actualise', 'gain_actualise')
    return {
        'success': True,
        'systeme': systeme,
        'capex_batterie': round(capex_batterie, 2),
        'annees_remplacement_batterie': annees_batterie,
        'besoin_non_couvert_an1_m3': round(non_couvert_1, 2),
        'duree_ans': DUREE_ANALYSE_ANS,
        'annee_remplacement_ge': ANNEE_REMPLACEMENT_GE,
        'annee_remplacement_onduleur': ANNEE_REMPLACEMENT_ONDULEUR,
        'evolution_besoins': evolution,
        'degradation_pv_pct': round(degradation * 100, 4),
        'volume_perdu_degradation_m3': round(perte_degradation, 2),
        'annee_effet_degradation': annee_effet_degradation,
        'part_residuelle_ge_pct': round(part_annee_1 * 100, 2),
        'van': round(cumul_act, 2),
        'tri_pct': None if tri is None else round(tri * 100, 2),
        'retour_simple_ans': None if retour is None else round(retour, 2),
        'retour_actualise_ans': None if retour_act is None else round(retour_act, 2),
        'gains_totaux': round(total_gains, 2),
        'cout_total_sans': round(total_sans, 2),
        'cout_total_avec': round(total_avec, 2),
        'gain_annee_1': lignes[1]['gain'],
        'carburant_economise_total_l': round(carb_economise, 2),
        'volume_servi_total_m3': round(volume_total, 2),
        'cout_global_actualise': round(cout_global_act, 2),
        'cout_actualise_m3': round(cout_global_act / volume_act, 4) if volume_act > 0 else None,
        'tableau': lignes,
    }


# ---------------------------------------------------------------------------------------------
# Plan d'affaires : vente de l'eau
# ---------------------------------------------------------------------------------------------
# SOURCE DE VERITE du plan d'affaires. Le navigateur en calcule un miroir (PompageSolaireCalculs
# .planAffaires) pour afficher le resultat sans attendre, puis le soumet a
# /api/pompage_solaire/plan_affaires : en cas d'ecart (ecartPlanAffaires cote JS), les valeurs du
# serveur remplacent celles du navigateur. VAN et TRI par numpy-financial.
#
# Volumes (annee t) : besoin et pompage solaire evoluent comme dans l'analyse economique
#   (volumes_annee). Volume pompe = solaire utile (plafonne au besoin de chaque mois) + groupe
#   (hybride : le groupe pompe le deficit, tout le besoin est donc pompe). Tout le volume pompe est
#   vendu ; la part perdue ou impayee n'est pas facturee : volume facture = pompe x (1 - pertes).
# Recettes = volume facture x tarif au m3 (indexe des l'annee 2).
# Charges d'exploitation (indexees) : entretien de l'installation, entretien du groupe (hybride),
#   carburant du groupe (litres par m3 x volume pompe au groupe x prix indexe) ; remplacements de
#   l'onduleur / controleur, du groupe (hybride) et de la batterie (stockage) l'annee 10.
# Financement : subvention et emprunt encaisses en annee 0 ; emprunt rembourse par annuites
#   constantes (le capital restant du a l'horizon est rembourse cette annee-la).
# Capex : trois lots de la pompe solaire, terrain (acquisition), PV / groupe / batteries selon le type de
#   système. Le terrain n'est pas amorti et reste en valeur résiduelle (à son coût d'acquisition).
# Impots (option) : taux x max(0, recettes - charges - dotation aux amortissements - interets),
#   sans report de deficit. Amortissement du Capex initial : lineaire sur une duree, ou montant
#   constant par an (plafonne au Capex). Valeur residuelle (option) : valeur nette comptable a
#   l'horizon, encaissee la derniere annee.
# Flux net = recettes - charges - remplacements - impots - interets - capital rembourse
#   (+ valeur residuelle la derniere annee) ; annee 0 : -Capex + subvention + emprunt.
# Prix d'equilibre : tarif de l'annee 1 (indexe ensuite comme le tarif saisi) qui annule la VAN,
#   par dichotomie (la VAN croit avec le tarif, y compris avec l'impot). Cout de revient : meme
#   calcul a tarif constant.

HORIZONS_PLAN_AFFAIRES = (5, 10, 15, 20)
ANNEE_REMPLACEMENT_PLAN = 10
TRI_MIN, TRI_MAX = -0.99, 10.0  # TRI publie seulement dans [-99 %, 1000 %] (sinon « n.d. »)
VERSION_PLAN_AFFAIRES = 2


def echeancier_emprunt(capital, taux, duree, horizon):
    """[(interets, capital rembourse)] des annees 1..horizon ; annuites constantes."""
    lignes = []
    restant = capital
    if capital <= 0 or duree <= 0:
        return [(0.0, 0.0)] * horizon
    annuite = capital / duree if taux == 0 else capital * taux / (1 - (1 + taux) ** -duree)
    for t in range(1, horizon + 1):
        if t <= duree and restant > 0:
            interets = restant * taux
            principal = restant if t == duree else min(restant, annuite - interets)
        else:
            interets, principal = 0.0, 0.0
        if t == horizon:
            principal = restant  # solde du capital restant du a l'horizon
        restant -= principal
        lignes.append((interets, principal))
    return lignes


def dotations_amortissement(base, methode, duree, montant, horizon):
    """Dotations des annees 1..horizon : lineaire (base / duree) ou montant constant, plafonnees a la base."""
    lignes = []
    cumul = 0.0
    for t in range(1, horizon + 1):
        if methode == 'constant':
            d = montant
        else:
            d = base / duree if duree > 0 and t <= duree else 0.0
        d = max(0.0, min(d, base - cumul))
        cumul += d
        lignes.append(d)
    return lignes


def _preparer_plan(p):
    """Grandeurs du plan independantes du tarif."""
    hybride = bool(p.get('hybride'))
    stockage = bool(p.get('stockage'))
    impots = bool(p.get('impots'))
    vr_active = bool(p.get('valeur_residuelle'))
    lots = {
        'materiel_pompage': safe_float(p.get('capex_materiel_pompage'), 0),
        'genie_civil_pose': safe_float(p.get('capex_genie_civil_pose'), 0),
        'transport': safe_float(p.get('capex_transport'), 0),
        'terrain': max(0.0, safe_float(p.get('capex_terrain'), 0)),
        'pv': safe_float(p.get('capex_pv'), 0) if (hybride or stockage) else 0.0,
        'groupe_electrogene': safe_float(p.get('capex_ge'), 0) if hybride else 0.0,
        'batterie': safe_float(p.get('capex_batterie'), 0) if stockage else 0.0,
    }
    capex = sum(lots.values())
    horizon = int(safe_float(p.get('horizon'), 20))
    if horizon not in HORIZONS_PLAN_AFFAIRES:
        horizon = 20
    subvention = max(0.0, safe_float(p.get('subvention'), 0))
    emprunt = max(0.0, safe_float(p.get('emprunt'), 0))
    taux_emprunt = safe_float(p.get('taux_emprunt'), 5) / 100.0
    duree_emprunt = int(safe_float(p.get('duree_emprunt'), 10))
    idx_entretien = safe_float(p.get('indexation_entretien'), 3) / 100.0
    entretien = safe_float(p.get('entretien'), 200)
    entretien_ge = safe_float(p.get('entretien_ge'), 0) if hybride else 0.0
    prix_carb = safe_float(p.get('prix_carburant'), 0) if hybride else 0.0
    infl_carb = safe_float(p.get('inflation_carburant'), 3) / 100.0
    evolution = safe_float(p.get('evolution_besoins'), EVOLUTION_BESOINS_DEFAUT)
    degradation = safe_float(p.get('degradation_pv'), DEGRADATION_PV_DEFAUT) / 100.0
    pertes = safe_float(p.get('part_pertes'), 10) / 100.0
    remplacement = safe_float(p.get('remplacement_onduleur'), 2000) \
        + (safe_float(p.get('remplacement_ge'), 0) if hybride else 0.0)
    # Batteries : remplacées aux années multiples de leur durée de vie (10 ans par défaut : année 10).
    rempl_batterie = safe_float(p.get('remplacement_batterie'), 0) if stockage else 0.0
    annees_batterie = annees_remplacement_batterie(
        int(safe_float(p.get('duree_vie_batterie'), DUREE_VIE_BATTERIE_DEFAUT)), horizon) if stockage else []
    methode = 'constant' if p.get('methode_amortissement') == 'constant' else 'lineaire'
    amortir = impots or vr_active
    # Le terrain ne s'amortit pas : hors base d'amortissement, il reste dans la valeur résiduelle.
    base_amortissable = capex - lots['terrain']
    dotations = dotations_amortissement(
        base_amortissable, methode, int(safe_float(p.get('duree_amortissement'), 20)),
        safe_float(p.get('amortissement_annuel'), 0), horizon) if amortir else [0.0] * horizon
    vr = max(0.0, base_amortissable - sum(dotations)) + lots['terrain'] if vr_active else 0.0

    pompes = [max(0.0, safe_float(v, 0)) for v in (p.get('monthly_pumped') or [])][:12]
    besoins = [max(0.0, safe_float(v, 0)) for v in (p.get('monthly_needs') or [])][:12]
    total_besoin = sum(besoins)
    litres_m3 = safe_float(p.get('carburant_sans_solaire_l'), 0) / total_besoin if total_besoin > 0 else 0.0

    annees = []
    dette = echeancier_emprunt(emprunt, taux_emprunt, duree_emprunt, horizon)
    for t in range(1, horizon + 1):
        besoin, utile = volumes_annee(pompes, besoins, t, evolution, degradation)
        groupe = max(0.0, besoin - utile) if hybride else 0.0
        pompe = utile + groupe
        ie = (1 + idx_entretien) ** (t - 1)
        annees.append({
            'annee': t,
            'besoin_m3': besoin,
            'volume_solaire_m3': utile,
            'volume_groupe_m3': groupe,
            'volume_pompe_m3': pompe,
            'volume_facture_m3': pompe * (1 - pertes),
            'entretien': entretien * ie,
            'entretien_ge': entretien_ge * ie,
            'carburant_l': litres_m3 * groupe,
            'carburant': litres_m3 * groupe * prix_carb * (1 + infl_carb) ** (t - 1),
            'remplacements': (remplacement if t == ANNEE_REMPLACEMENT_PLAN else 0.0)
                             + (rempl_batterie if t in annees_batterie else 0.0),
            'dotation': dotations[t - 1],
            'interets': dette[t - 1][0],
            'principal': dette[t - 1][1],
            'valeur_residuelle': vr if t == horizon else 0.0,
        })
    return {
        'hybride': hybride, 'stockage': stockage, 'impots': impots, 'vr_active': vr_active,
        'taux_impot': safe_float(p.get('taux_impot'), 10) / 100.0 if impots else 0.0,
        'lots': lots, 'capex': capex, 'horizon': horizon, 'subvention': subvention, 'emprunt': emprunt,
        'taux': safe_float(p.get('taux_actualisation'), 3) / 100.0,
        'idx_tarif': safe_float(p.get('indexation_tarif'), 3) / 100.0,
        'methode': methode, 'valeur_residuelle': vr, 'annees': annees,
        'annees_batterie': annees_batterie,
    }


def _flux_plan(c, tarif, idx_tarif):
    """(lignes non arrondies, flux) pour un tarif de l'annee 1 donne (par m3)."""
    flux0 = -c['capex'] + c['subvention'] + c['emprunt']
    lignes = []
    flux = [flux0]
    for a in c['annees']:
        t = a['annee']
        tarif_t = tarif * (1 + idx_tarif) ** (t - 1)
        recettes = a['volume_facture_m3'] * tarif_t
        charges = a['entretien'] + a['entretien_ge'] + a['carburant'] + a['remplacements']
        resultat = recettes - charges - a['dotation'] - a['interets']
        impot = c['taux_impot'] * resultat if resultat > 0 else 0.0
        f = recettes - charges - impot - a['interets'] - a['principal'] + a['valeur_residuelle']
        flux.append(f)
        lignes.append(dict(a, tarif_m3=tarif_t, recettes=recettes, resultat_imposable=resultat, impot=impot, flux=f))
    return lignes, flux


def _tarif_equilibre(c, idx_tarif):
    """Tarif de l'annee 1 qui annule la VAN (dichotomie) ; None sans volume facture ou introuvable."""
    if sum(a['volume_facture_m3'] for a in c['annees']) <= 0:
        return None
    van = lambda x: _van(_flux_plan(c, x, idx_tarif)[1], c['taux'])  # noqa: E731
    if van(0.0) >= 0:
        return 0.0
    haut = 1.0
    for _ in range(80):
        if van(haut) >= 0:
            break
        haut *= 2
    else:
        return None
    bas = 0.0
    for _ in range(100):
        milieu = (bas + haut) / 2
        if van(milieu) >= 0:
            haut = milieu
        else:
            bas = milieu
    return haut


def _changements_de_signe(flux):
    signes = [f > 0 for f in flux if f != 0]
    return sum(1 for a, b in zip(signes, signes[1:]) if a != b)


def plan_affaires(params):
    """params : voir PlanAffairesRequest (app/schemas/pompage_solaire_schemas.py)."""
    p = params or {}
    c = _preparer_plan(p)
    tarif = safe_float(p.get('tarif_m3'), 5)
    lignes_brutes, flux = _flux_plan(c, tarif, c['idx_tarif'])

    flux0 = flux[0]
    lignes = [{
        'annee': 0, 'besoin_m3': 0, 'volume_solaire_m3': 0, 'volume_groupe_m3': 0, 'volume_pompe_m3': 0,
        'volume_facture_m3': 0, 'tarif_m3': 0, 'recettes': 0, 'entretien': 0, 'entretien_ge': 0,
        'carburant_l': 0, 'carburant': 0, 'remplacements': 0, 'dotation': 0, 'interets': 0, 'principal': 0,
        'impot': 0, 'valeur_residuelle': 0, 'investissement': round(c['capex'], 2),
        'financement': round(c['subvention'] + c['emprunt'], 2),
        'flux': round(flux0, 2), 'cumul': round(flux0, 2), 'flux_actualise': round(flux0, 2),
        'cumul_actualise': round(flux0, 2),
    }]
    cumul = cumul_act = flux0
    for a, f in zip(lignes_brutes, flux[1:]):
        t = a['annee']
        f_act = f / (1 + c['taux']) ** t
        cumul += f
        cumul_act += f_act
        ligne = {k: round(a[k], 2) for k in (
            'besoin_m3', 'volume_solaire_m3', 'volume_groupe_m3', 'volume_pompe_m3', 'volume_facture_m3',
            'recettes', 'entretien', 'entretien_ge', 'carburant_l', 'carburant', 'remplacements', 'dotation',
            'interets', 'principal', 'impot', 'valeur_residuelle')}
        ligne.update({'annee': t, 'tarif_m3': round(a['tarif_m3'], 4), 'investissement': 0, 'financement': 0,
                      'flux': round(f, 2), 'cumul': round(cumul, 2), 'flux_actualise': round(f_act, 2),
                      'cumul_actualise': round(cumul_act, 2)})
        lignes.append(ligne)

    van = float(npf.npv(c['taux'], flux))
    ambigu = _changements_de_signe(flux) > 1
    tri = _tri(flux)
    if not ambigu and tri is not None:
        # Flux a un seul changement de signe : TRI unique, celui de numpy-financial.
        t_npf = float(npf.irr(flux))
        if not math.isnan(t_npf):
            tri = t_npf
    if tri is not None and not (TRI_MIN <= tri <= TRI_MAX):
        tri = None
    prix_eq = _tarif_equilibre(c, c['idx_tarif'])
    cout_revient = _tarif_equilibre(c, 0.0)
    retour = _annee_retour(lignes, 'cumul', 'flux')
    retour_act = _annee_retour(lignes, 'cumul_actualise', 'flux_actualise')
    somme = lambda cle: round(sum(a[cle] for a in lignes_brutes), 2)  # noqa: E731
    a1 = lignes[1]
    return {
        'success': True,
        'version': VERSION_PLAN_AFFAIRES,
        'horizon': c['horizon'],
        'hybride': c['hybride'],
        'stockage': c['stockage'],
        'impots': c['impots'],
        'valeur_residuelle_active': c['vr_active'],
        'annee_remplacement': ANNEE_REMPLACEMENT_PLAN,
        'annees_remplacement_batterie': c['annees_batterie'],
        'capex_lots': {k: round(v, 2) for k, v in c['lots'].items()},
        'capex_total': round(c['capex'], 2),
        'subvention': round(c['subvention'], 2),
        'emprunt': round(c['emprunt'], 2),
        'fonds_propres': round(c['capex'] - c['subvention'] - c['emprunt'], 2),
        'besoin_m3_an1': a1['besoin_m3'],
        'volume_pompe_m3_an1': a1['volume_pompe_m3'],
        'volume_groupe_m3_an1': a1['volume_groupe_m3'],
        'volume_facture_m3_an1': a1['volume_facture_m3'],
        'carburant_l_an1': a1['carburant_l'],
        'van': round(van, 2),
        'tri_pct': None if tri is None else round(tri * 100, 2),
        'tri_ambigu': ambigu,
        'retour_simple_ans': None if retour is None else round(retour, 2),
        'retour_actualise_ans': None if retour_act is None else round(retour_act, 2),
        'prix_equilibre_m3': None if prix_eq is None else round(prix_eq, 4),
        'cout_revient_m3': None if cout_revient is None else round(cout_revient, 4),
        'volume_facture_total_m3': somme('volume_facture_m3'),
        'recettes_totales': somme('recettes'),
        'entretien_total': round(sum(a['entretien'] + a['entretien_ge'] for a in lignes_brutes), 2),
        'carburant_total': somme('carburant'),
        'remplacements_total': somme('remplacements'),
        'impots_total': somme('impot'),
        'service_dette_total': round(sum(a['interets'] + a['principal'] for a in lignes_brutes), 2),
        'valeur_residuelle': round(c['valeur_residuelle'], 2),
        'flux_annee_1': a1['flux'],
        'tableau': lignes,
    }


# ---------------------------------------------------------------------------------------------
# Pompes à courbes de performance (gamme SQFlex) : suggestion et montage série / parallèle
# ---------------------------------------------------------------------------------------------
# IMPLEMENTATION DE REFERENCE de PompageSolaireCalculs.evaluerMontage / suggererPompes
# (pompage_solaire_calculs.js) ; parité vérifiée par tests/pompage_solaire/test_parite_pompage.py.
#
# Les courbes du constructeur donnent le débit Q [m3/h] en fonction de la puissance absorbée P1 [W],
# pour plusieurs hauteurs manométriques. Pour une hauteur donnée, la courbe est interpolée
# linéairement entre les deux hauteurs encadrantes ; sous la plus petite hauteur publiée on garde
# celle-ci (prudent : la pompe débiterait davantage), au-dessus de la plus grande la pompe est hors
# plage. Sous le seuil de démarrage (début de courbe) la pompe ne débite pas ; au-delà de la fin de
# courbe elle est à son maximum (vitesse ou P1 max) : débit et puissance absorbée plafonnés.
#
# Journée type du mois : 12 h d'ensoleillement, éclairement en demi-sinusoïde dont l'intégrale vaut
# l'irradiation journalière du mois (kWh/m²/j) ; puissance disponible = Wc x G x PR (G en kW/m²).
# Le volume journalier est intégré par pas de 15 min.
# PR (pr_pompe) = (1 - pertes système) x FACTEUR_TEMPERATURE : l'irradiation PVGIS H(i)_m ne contient
# pas l'échauffement des modules (PVGIS ne le retire que de sa production PV), et une pompe au fil du
# soleil n'a pas d'onduleur. 0,88 = cellules vers 55 °C pour 30 °C ambiant (-0,4 %/°C), conditions de
# la plage de performance publiée par Grundfos (livret SQFlex p. 4 : 6 kWh/m²/j, 30 °C). Avec les
# pertes par défaut (14 %), le modèle retrouve cette plage sans biais notable, écart type ~15 %
# (= écart type annoncé des courbes) — vérifié par tests/pompage_solaire/test_parite_pompage.py.
#
# Montages (n pompes identiques, chacune avec son propre générateur PV de Wc/n) :
#   - parallèle : chaque pompe refoule à la HMT complète et fournit le n-ième du besoin ;
#   - série (étages successifs avec bâche de reprise) : chaque pompe relève HMT/n et fournit tout le besoin.

DUREE_JOUR_H = 12.0
PAS_PROFIL_JOUR = 48
FACTEUR_TEMPERATURE = 0.88
PV_MAX_PAR_POMPE_WC = 3000.0
NB_POMPES_MAX = 4
MONTAGES = ('unique', 'parallele', 'serie')
JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def pr_pompe(perte_systeme_pct):
    """Rapport puissance absorbée par la pompe / (Wc x éclairement) — cf. FACTEUR_TEMPERATURE."""
    return (1.0 - safe_float(perte_systeme_pct, 14) / 100.0) * FACTEUR_TEMPERATURE


def _courbes_triees(courbes):
    """[(hmt_m, [(P1, Q), ...]), ...] par hauteur croissante, points par P1 croissante."""
    if courbes and isinstance(courbes[0], tuple):
        return courbes  # déjà normalisées
    sortie = []
    for c in courbes or []:
        pts = sorted((float(p[0]), float(p[1])) for p in (c.get('points') or []) if len(p) >= 2)
        if len(pts) >= 2:
            sortie.append((float(c.get('hmt_m')), pts))
    sortie.sort(key=lambda x: x[0])
    return sortie


def _interp(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]


def _point_courbe(pts, p1):
    """(Q, P1 absorbée) sur une courbe : 0 sous le seuil de démarrage, plafonné en fin de courbe."""
    if p1 < pts[0][0]:
        return 0.0, 0.0
    p_abs = min(p1, pts[-1][0])
    return _interp(p_abs, [p[0] for p in pts], [p[1] for p in pts]), p_abs


def plage_pompe(courbes):
    """Plage de fonctionnement publiée : hauteurs, débit maximal, puissance absorbée."""
    c = _courbes_triees(courbes)
    if not c:
        return None
    return {
        'hmt_min_m': c[0][0], 'hmt_max_m': c[-1][0],
        'debit_max_m3h': round(max(q for _, pts in c for _, q in pts), 3),
        'p1_demarrage_min_w': round(min(pts[0][0] for _, pts in c), 1),
        'p1_max_w': round(max(pts[-1][0] for _, pts in c), 1),
    }


def debit_pompe(courbes, hmt, p1):
    """(Q m3/h, P1 absorbée W) à la hauteur `hmt` pour une puissance disponible `p1` ; None hors plage."""
    c = _courbes_triees(courbes)
    if not c or hmt > c[-1][0] + 1e-9:
        return None
    if hmt <= c[0][0]:
        return _point_courbe(c[0][1], p1)
    for i in range(1, len(c)):
        if hmt <= c[i][0]:
            (h0, a), (h1, b) = c[i - 1], c[i]
            t = (hmt - h0) / (h1 - h0)
            if p1 < a[0][0] + t * (b[0][0] - a[0][0]):  # seuil de démarrage interpolé
                return 0.0, 0.0
            qa, pa = _point_courbe(a, p1)
            qb, pb = _point_courbe(b, p1)
            return qa + t * (qb - qa), pa + t * (pb - pa)
    return None


def volume_journalier(courbes, hmt, pv_wc, irradiation_jour, pr):
    """(volume m3/j, énergie absorbée kWh/j) d'UNE pompe sur la journée type."""
    c = _courbes_triees(courbes)
    if not c or hmt > c[-1][0] + 1e-9 or pv_wc <= 0 or irradiation_jour <= 0 or pr <= 0:
        return 0.0, 0.0
    g_max = math.pi * irradiation_jour / (2 * DUREE_JOUR_H)  # kW/m²
    dt = DUREE_JOUR_H / PAS_PROFIL_JOUR
    volume = energie = 0.0
    for k in range(PAS_PROFIL_JOUR):
        g = g_max * math.sin(math.pi * (k + 0.5) / PAS_PROFIL_JOUR)
        q, p_abs = debit_pompe(c, hmt, pv_wc * g * pr)
        volume += q * dt
        energie += p_abs * dt / 1000.0
    return volume, energie


def pv_requise(courbes, hmt, volume_jour, irradiation_jour, pr):
    """Puissance PV (Wc) pour qu'UNE pompe fournisse `volume_jour` ; None si impossible
    (hors plage de hauteur, ou débit insuffisant même avec PV_MAX_PAR_POMPE_WC)."""
    if volume_jour <= 0:
        return 0.0
    if volume_journalier(courbes, hmt, PV_MAX_PAR_POMPE_WC, irradiation_jour, pr)[0] < volume_jour:
        return None
    bas, haut = 0.0, PV_MAX_PAR_POMPE_WC
    for _ in range(40):
        milieu = (bas + haut) / 2
        if volume_journalier(courbes, hmt, milieu, irradiation_jour, pr)[0] >= volume_jour:
            haut = milieu
        else:
            bas = milieu
    return haut


def evaluer_montage(courbes, montage, nombre, hmt, besoin_jour, irradiation, pr, pv_installe_wc=0):
    """Note de dimensionnement d'un montage de `nombre` pompes identiques.

    irradiation : 12 moyennes journalières (kWh/m²/j) ; dimensionnement sur le mois le plus faible.
    pv_installe_wc > 0 : volumes mensuels calculés avec cette puissance (répartie sur les pompes),
    sinon avec la puissance requise.
    """
    montage = montage if montage in MONTAGES else 'unique'
    n = 1 if montage == 'unique' else max(2, min(NB_POMPES_MAX, int(nombre or 2)))
    h_pompe = hmt / n if montage == 'serie' else hmt
    v_pompe = besoin_jour / n if montage == 'parallele' else besoin_jour
    irr = [safe_float(x, 0) for x in (irradiation or [])][:12]
    irr_min = min(irr) if len(irr) == 12 else 0
    courbes = _courbes_triees(courbes)
    plage = plage_pompe(courbes)
    res = {
        'montage': montage, 'nombre': n, 'hmt_par_pompe_m': round(h_pompe, 2),
        'volume_par_pompe_m3j': round(v_pompe, 2), 'plage': plage, 'faisable': False, 'motif': None,
        'pv_par_pompe_wc': None, 'pv_totale_wc': None, 'rendement_global_pct': None,
        'volume_max_m3j': None, 'pv_utilisee_wc': None, 'volumes_journaliers_m3': [],
        'couverture_pct': None,
    }
    if not plage or irr_min <= 0:
        res['motif'] = 'donnees'
        return res
    if h_pompe > plage['hmt_max_m']:
        res['motif'] = 'hmt'
        return res
    multiple = n if montage == 'parallele' else 1
    res['volume_max_m3j'] = round(
        volume_journalier(courbes, h_pompe, PV_MAX_PAR_POMPE_WC, irr_min, pr)[0] * multiple, 2)
    pv = pv_requise(courbes, h_pompe, v_pompe, irr_min, pr)
    if pv is None:
        res['motif'] = 'debit'
        return res
    res['faisable'] = True
    res['pv_par_pompe_wc'] = round(pv, 1)
    res['pv_totale_wc'] = round(pv * n, 1)
    v_min, e_min = volume_journalier(courbes, h_pompe, pv, irr_min, pr)
    if e_min > 0:
        res['rendement_global_pct'] = round(9.81 * h_pompe * v_min / 3600.0 / e_min * 100, 1)

    pv_calcul = pv_installe_wc if pv_installe_wc and pv_installe_wc > 0 else pv * n
    res['pv_utilisee_wc'] = round(pv_calcul, 1)
    utile = 0.0
    for i, h_jour in enumerate(irr):
        v = volume_journalier(courbes, h_pompe, pv_calcul / n, h_jour, pr)[0] * multiple
        res['volumes_journaliers_m3'].append(round(v, 3))
        utile += min(v, besoin_jour) * JOURS_PAR_MOIS[i]
    res['couverture_pct'] = round(utile / (besoin_jour * 365) * 100, 2) if besoin_jour > 0 else 0
    return res


def suggerer_pompes(pompes, hmt, besoin_jour, irradiation, pr, pv_installe_wc=0):
    """pompes : [{'id', 'courbes': [...]}]. Renvoie les pompes uniques faisables (PV croissante) et, si
    aucune ne suffit seule, les meilleurs montages série / parallèle (moins de pompes, puis moins de PV)."""
    uniques, combinaisons = [], []
    for p in pompes:
        ev = evaluer_montage(p['courbes'], 'unique', 1, hmt, besoin_jour, irradiation, pr, pv_installe_wc)
        if ev['faisable']:
            uniques.append(dict(ev, id=p['id']))
    uniques.sort(key=lambda e: (e['pv_totale_wc'], str(e['id'])))
    if not uniques:
        for n in range(2, NB_POMPES_MAX + 1):
            for montage in ('parallele', 'serie'):
                for p in pompes:
                    ev = evaluer_montage(p['courbes'], montage, n, hmt, besoin_jour, irradiation, pr, pv_installe_wc)
                    if ev['faisable']:
                        combinaisons.append(dict(ev, id=p['id']))
            if combinaisons:
                break  # le plus petit nombre de pompes qui convient
        combinaisons.sort(key=lambda e: (e['nombre'], e['pv_totale_wc'], str(e['id'])))
    return {'uniques': uniques, 'combinaisons': combinaisons[:6]}


def calculate_economy(capex_ke, opex_ke, inflation, price_mwh, annual_prods_mwh):
    """Calcule VAN, TRI et LCOE."""
    # Investissement initial (négatif)
    cash_flows = [-capex_ke * 1000]
    total_costs_lcoe = capex_ke * 1000
    total_prod_lcoe = 0
    
    for i, prod in enumerate(annual_prods_mwh):
        year = i + 1
        # Revenus
        revenue = prod * price_mwh
        # Dépenses (OPEX indexé sur l'inflation)
        costs = (opex_ke * 1000) * ((1 + inflation/100) ** (year - 1))
        
        cash_flows.append(revenue - costs)
        
        # Pour le LCOE simplifié (somme actualisée peut être plus précise)
        total_costs_lcoe += costs
        total_prod_lcoe += prod

    # Calculs financiers
    van = npf.npv(0.04, cash_flows) # Taux d'actualisation 4%
    tri = npf.irr(cash_flows)
    lcoe = total_costs_lcoe / total_prod_lcoe if total_prod_lcoe > 0 else 0

    return {
        "van": round(van, 2),
        "tri": round(tri * 100, 2) if tri else "N/A",
        "lcoe": round(lcoe, 2),
        "payback": "N/A" # Placeholder propre
    }