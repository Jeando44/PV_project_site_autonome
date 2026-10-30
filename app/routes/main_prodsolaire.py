"""
Blueprint pour les routes de production solaire / autoconsommation
Extrait de app/routes/main.py : pages et API de calcul s'appuyant sur
app/models/calcul_prodsolaire/ (PVGIS, autoconsommation ACI, vente en totalité, stockage).
"""
from flask import Blueprint, render_template, request, jsonify, send_file, session, g
import io
import json
import logging
import math

from app.extensions import csrf
from app.middleware.auth_middleware import login_required
from app.models.calcul_prodsolaire.calcul_autoconso import (
    extract_values_from_file, extract_consumption, extract_consumption_from_json, irve_curve_vers_utc1, process_data,
    courbe_murale_vers_utc1, avec_courbe_pac,
)
from app.models.calcul_prodsolaire.calage_horaire import utc_vers_utc1
from app.models.calcul_prodsolaire.calcul_acc import process_acc_data
from app.models.calcul_prodsolaire.calcul_prodsolaire import (
    calculate_pv_data, delete_cached_tmy, get_cached_tmy_list, TMY_CACHE_RAYON_AUTO_KM, TMY_CACHE_RAYON_MAX_KM,
)
from app.models.calcul_prodsolaire.calcul_vente_totalite import process_vente_totalite_data
import pydantic

from app.models.calcul_prodsolaire.calcul_stockage import calculate_storage_data
from app.models.calcul_prodsolaire.configuration_parc_batteries import calculer_parc, rendement_systeme
from app.schemas.stockage_schemas import StorageParams, message_erreur_lisible
from app.extensions import db
from app.models.parametre_projet import ParametreProjet
from app.services.resultats_prodsolaire import memoriser_calcul, memoriser_stockage, reference_eco
from app.models.calcul_prodsolaire.calcul_shed_shading import calculate_shed_shading_data
from app.models.calcul_prodsolaire.calcul_shed_shading_terrain import calculate_shed_shading_terrain_data
from app.schemas.ombrage_sheds_terrain_schemas import (
    ShedShadingTerrainParams, message_erreur_lisible as message_erreur_ombrage_terrain)
from app.services.mention_essai import pdf_pour_utilisateur
from app.models.calcul_prodsolaire.time_step_utils import expected_length_for
from app.services.irve_controle import controler_consommation, horodatage as horodatage_irve
from app.services.pac_controle import controler_consommation_pac
from app.services.controle_conso_import import controler_conso_import, IncoherenceConsoImport
from app.services.controle_parametres_pompage import controler_parametres_pompage, IncoherenceParametresPompage
from app.services.licence_quota import check_licence_power_allowance, extract_kwc_from_payload
from app.services.acc.quota import check_acc_quota, register_acc_study, acc_status
from app.services.acc.eco_validation import charger_bornes as charger_bornes_eco_acc, verifier_parametres_eco_acc

prodsolaire_bp = Blueprint('prodsolaire', __name__)


def check_calepinage_distance_coherence(data_or_json):
    """Vérifie que les coordonnées du calepinage ne dépassent pas DISTANCE_MAX_CALEPINAGE (2000m)
    par rapport à l'adresse du projet actif enregistré en BDD."""
    from config import DISTANCE_MAX_CALEPINAGE

    if not data_or_json:
        return True, None

    payload = None
    if isinstance(data_or_json, str):
        try:
            payload = json.loads(data_or_json)
        except Exception:
            return True, None
    elif isinstance(data_or_json, dict):
        payload = data_or_json
    else:
        return True, None

    calep_lat = payload.get('lat')
    calep_lon = payload.get('lon')
    if calep_lat is None or calep_lon is None:
        plants = payload.get('plants') or payload.get('fields')
        if isinstance(plants, list) and len(plants) > 0:
            calep_lat = plants[0].get('lat')
            calep_lon = plants[0].get('lon')

    if calep_lat is None or calep_lon is None:
        return True, None

    active_id = session.get('active_projet_id')
    if not active_id:
        return True, None

    try:
        from app.models.parametre_projet import ParametreProjet
        projet = ParametreProjet.query.get(active_id)
        if not projet or not projet.adresse_projet:
            return True, None

        addr = json.loads(projet.adresse_projet) if isinstance(projet.adresse_projet, str) else projet.adresse_projet
        if not isinstance(addr, dict):
            return True, None
        proj_lat = addr.get('latitude')
        proj_lon = addr.get('longitude')
        if proj_lat is None or proj_lon is None:
            return True, None

        # Haversine
        R = 6371000.0
        phi1 = math.radians(float(proj_lat))
        phi2 = math.radians(float(calep_lat))
        delta_phi = math.radians(float(calep_lat) - float(proj_lat))
        delta_lambda = math.radians(float(calep_lon) - float(proj_lon))

        a = math.sin(delta_phi / 2.0) ** 2 + \
            math.cos(phi1) * math.cos(phi2) * \
            math.sin(delta_lambda / 2.0) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        distance = R * c

        if distance > DISTANCE_MAX_CALEPINAGE:
            msg = (f"Incohérence géographique : la géométrie dessinée est située à {distance / 1000:.2f} km "
                   f"de l'adresse du projet (seuil maximal : {DISTANCE_MAX_CALEPINAGE / 1000:.1f} km). "
                   "Les calculs de productible sont bloqués. Veuillez redessiner votre calepinage.")
            return False, (jsonify({'error': msg, 'distance_meters': distance, 'max_distance': DISTANCE_MAX_CALEPINAGE}), 400)
    except Exception:
        return True, None

    return True, None


# Taille maximale (caractères JSON) d'une scène d'ombrage proche : au-delà, elle est ignorée (le
# calcul se fait sans ombrage proche) plutôt que de bloquer le serveur. Une scène résidentielle pèse
# typiquement 10-500 ko.
TAILLE_MAX_SCENE_OMBRAGE = 6_000_000


def _projet_appartient_utilisateur(projet_id):
    """Le projet existe et appartient à l'utilisateur connecté (tout projet pour un administrateur)."""
    user = getattr(g, 'user', None)
    if not projet_id or not user:
        return False
    try:
        from app.models.parametre_projet import ParametreProjet
        query = ParametreProjet.query.filter_by(id=projet_id)
        if not user.get('is_admin'):
            query = query.filter_by(created_by=user['id'])
        return query.first() is not None
    except Exception:
        logging.exception("Vérification du propriétaire du projet impossible.")
        return False


def _filtrer_scene_ombrage(payload):
    """
    Scène 3D d'ombrage proche (payload['shading_scene'], cf. calepinage_maison_ombrage_scene.js) :
    acceptée seulement si elle appartient au PROJET ACTIF en session et que ce projet appartient à
    l'UTILISATEUR connecté — une scène restée d'un autre projet (autre onglet, localStorage d'une
    session précédente) ou d'un autre compte ne doit jamais influencer un calcul. Sinon elle est
    retirée (calcul sans ombrage proche) et la raison est renvoyée dans
    summary.near_shading_warnings. La géométrie elle-même est validée par
    calcul_ombrage_proche.prepare_near_shading_scene().
    """
    if not isinstance(payload, dict) or not payload.get('shading_scene'):
        return payload
    scene = payload.get('shading_scene')
    raison = None
    if not isinstance(scene, dict):
        raison = "format invalide"
    else:
        try:
            taille = len(json.dumps(scene))
        except (TypeError, ValueError):
            taille = TAILLE_MAX_SCENE_OMBRAGE + 1
        projet_scene = scene.get('projet_id')
        projet_actif = session.get('active_projet_id')
        if taille > TAILLE_MAX_SCENE_OMBRAGE:
            raison = f"scène trop volumineuse ({taille} caractères, maximum {TAILLE_MAX_SCENE_OMBRAGE})"
        elif not projet_scene or not projet_actif or str(projet_scene) != str(projet_actif):
            raison = "elle n'appartient pas au projet actif"
        elif not _projet_appartient_utilisateur(projet_actif):
            raison = "le projet actif n'est pas rattaché à votre compte"
    if raison:
        logging.warning("Scène d'ombrage 3D ignorée : %s.", raison)
        payload = dict(payload)
        payload['shading_scene'] = None
        payload['shading_scene_rejet'] = f"Scène d'ombrage 3D ignorée : {raison}. Calcul sans ombrage proche."
    return payload


# ==========================================
# ROUTES codes calcul autoconsommation Individuelle
# ==========================================

@prodsolaire_bp.route('/index_autoconso')
@prodsolaire_bp.route('/concevoir_mon_projet/index_autoconso')
@login_required
def index_autoconso():
    # Bornes des modales économiques ACC (window.ACC_ECO_BORNES), même fichier que la validation serveur.
    return render_template('concevoir_mon_projet/modals/autoconsommation/index_autoconso.html',
                           acc_eco_bornes=charger_bornes_eco_acc())

@prodsolaire_bp.route('/prodsolaire')
@prodsolaire_bp.route('/concevoir_mon_projet/prodsolaire')
@login_required
def prodsolaire():
    return render_template('concevoir_mon_projet/modals/autoconsommation/prodsolaire.html')


@prodsolaire_bp.route('/prodsolaire_body')
@prodsolaire_bp.route('/concevoir_mon_projet/prodsolaire_body')
@login_required
def prodsolaire_body():
    return render_template('concevoir_mon_projet/modals/autoconsommation/prodsolaire_body.html')

@prodsolaire_bp.route('/calculate', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate', methods=['POST'])
@csrf.exempt
@login_required
def calculate_autoconso():
    try:
        pv_file = request.files.get('pv_file')
        pv_data_json = request.form.get('pv_data_json')
        pv_config_json = request.form.get('pv_config_json')
        cons_file = request.files.get('cons_file')
        time_step = int(request.form.get('time_step', 60))
        priority_mode = request.form.get('priority', 'none')

        # Courbe IRVE : lue EN BASE par le serveur pour le projet de l'utilisateur (elle ne transite
        # plus par le navigateur ; un ancien champ 'irve_curve_json' n'est plus lu, il vaut seulement
        # demande d'utiliser la courbe du projet). Son bilan énergétique sert de référence au contrôle
        # de cohérence de toute consommation IRVE (courbe ou fichier importé, cf. irve_controle.py).
        projet_id = _projet_acc_autorise(request.form.get('projet_id'))
        courbe_irve = _courbe_irve_projet(projet_id)
        irve_demande = request.form.get('irve_source') == 'projet' or bool(request.form.get('irve_curve_json'))
        # Courbe du module PAC / climatiseur : lue EN BASE comme la courbe IRVE, contrôlée contre
        # son bilan (cf. pac_controle.py).
        pac_demande = request.form.get('pac_source') == 'projet'
        courbe_pac = _courbe_pac_projet(projet_id) if pac_demande else None
        # Règle d'affectation du PV entre usages : 'existante' | 'irve' | 'pac' | 'none' | 'ordre'
        # (ordre personnalisé : liste JSON des usages, du plus prioritaire au moins prioritaire).
        try:
            ordre_usages = json.loads(request.form.get('ordre_usages') or 'null')
        except (TypeError, ValueError):
            return jsonify({'error': "Ordre de priorité des usages illisible."}), 400

        if not pv_file and not pv_data_json and not pv_config_json:
            return jsonify({'error': 'Fichier PV ou données synchronisées manquantes'}), 400
        if not cons_file and not irve_demande and not pac_demande:
            return jsonify({'error': 'Fichier de consommation manquant'}), 400
        if pac_demande:
            if not courbe_pac:
                return jsonify({'error': "Aucune courbe PAC enregistrée pour ce projet : lancez le calcul dans le module PAC / Climatiseur."}), 400
            if int(courbe_pac.get('pas_temps_min') or 0) != time_step:
                return jsonify({'error': f"La courbe PAC du projet est au pas de {courbe_pac.get('pas_temps_min')} min, différent du pas sélectionné ({time_step} min)."}), 400
        if irve_demande:
            if not courbe_irve:
                return jsonify({'error': "Aucune courbe IRVE enregistrée pour ce projet : lancez « calculer la consommation » dans le module IRVE."}), 400
            if int(courbe_irve.get('pas_temps_min') or 0) != time_step:
                return jsonify({'error': f"La courbe IRVE du projet est au pas de {courbe_irve.get('pas_temps_min')} min, différent du pas sélectionné ({time_step} min)."}), 400

        expected_length = expected_length_for(time_step)
        dt_h = time_step / 60.0
        bilan_irve = courbe_irve.get('bilan_irve_kwh') if courbe_irve else None
        controle_irve = None

        pv_results = None
        if pv_config_json:
            is_valid_dist, dist_err = check_calepinage_distance_coherence(pv_config_json)
            if not is_valid_dist:
                return dist_err
            kwc = extract_kwc_from_payload(pv_config_json)
            if kwc:
                is_allowed, err = check_licence_power_allowance(kwc)
                if not is_allowed:
                    return err

            # Aucun fichier importé : la production est calculée côté serveur via PVGIS,
            # à partir de la configuration des champs PV (cf. buildPvParams() côté client).
            pv_results = calculate_pv_data(_filtrer_scene_ombrage(json.loads(pv_config_json)))
            if pv_results and 'summary' in pv_results:
                peak_kw = float(pv_results['summary'].get('peak_power_kw', 0) or 0)
                if peak_kw > 0:
                    is_allowed, err = check_licence_power_allowance(peak_kw)
                    if not is_allowed:
                        return err

            raw_pv_data = [h['P_kW'] for h in pv_results['hourly']]
            if len(raw_pv_data) < expected_length:
                return jsonify({'error': f"La production PV calculée contient {len(raw_pv_data)} valeurs ({expected_length} attendues)."}), 400
            # PVGIS est indexé en UTC : calé en UTC+1 fixe, référence commune des consommations
            # et des imports PVsyst (cf. calage_horaire.py).
            raw_pv_data = utc_vers_utc1(raw_pv_data[:expected_length], time_step)
        elif pv_data_json:
            raw_pv_data = json.loads(pv_data_json)
            if len(raw_pv_data) < expected_length:
                return jsonify({'error': f"Les données PV synchronisées contiennent {len(raw_pv_data)} valeurs ({expected_length} attendues)."}), 400
            raw_pv_data = raw_pv_data[:expected_length]
        else:
            raw_pv_data = extract_values_from_file(pv_file, expected_length)

        # CORRECTIF : combinaison courbe Enedis (cons_file) + courbe IRVE (irve_curve_json) quand les
        # deux sont fournies — ex. consommation existante réelle importée séparément de la courbe de
        # charge des bornes IRVE. process_data() sait déjà nativement combiner les labels
        # 'Cons. existante'/'Cons. IRVE'/'Cons. Totale' (cf. plus bas) : on construit juste l'entrée
        # 'Cons. IRVE' depuis le JSON et on recalcule 'Cons. Totale' comme somme élément par élément.
        energies_fichier = {}
        if cons_file and irve_demande:
            # Énergies brutes relevées sans rééchelonner les courbes : seules les courbes conservées du
            # fichier (existante, PAC) sont ramenées à leur énergie brute ci-dessous.
            charge_curves = extract_consumption(cons_file, expected_length, energies_brutes=energies_fichier, reechelonner=False)
            existante = next((c for c in charge_curves if c['label'] == 'Cons. existante'), None)
            if not existante:
                return jsonify({'error': "Le fichier de consommation importé ne contient pas de courbe 'Cons. existante' à combiner avec la courbe IRVE."}), 400
            if len(courbe_irve.get('irve') or []) < expected_length:
                return jsonify({'error': f"La courbe IRVE du projet contient moins de {expected_length} valeurs."}), 400
            irve_data = irve_curve_vers_utc1(courbe_irve, expected_length)
            controle_irve = controler_consommation(sum(irve_data) * dt_h, bilan_irve, "de la courbe enregistrée")
            # Une colonne PAC du fichier est conservée (format à 5 colonnes). La consommation existante et
            # la colonne PAC sont ramenées à l'énergie du fichier, comme sans courbe IRVE : le calage UTC+1
            # (heure d'été) ne doit ni créer ni détruire d'énergie, et le tableau récapitulatif doit
            # afficher la consommation lue à l'import (cf. controle_conso_import.py).
            pac_fichier = [c for c in charge_curves if c['label'] == 'Cons. PAC']
            for c in [existante] + pac_fichier:
                calee = sum(c['data']) * dt_h
                brute = energies_fichier.get(c['label']) or 0.0
                if calee > 0 and brute > 0:
                    c['data'] = [v * brute / calee for v in c['data']]
            usages_fichier = [existante, {'label': 'Cons. IRVE', 'data': irve_data}] + pac_fichier
            total_data = [sum(vals) for vals in zip(*(c['data'] for c in usages_fichier))]
            charge_curves = usages_fichier + [{'label': 'Cons. Totale', 'data': total_data}]
        elif cons_file:
            charge_curves = extract_consumption(cons_file, expected_length, energies_brutes=energies_fichier)
            # Fichier contenant une consommation IRVE (colonne C) : sa somme doit égaler le bilan.
            if any(c['label'] == 'Cons. IRVE' for c in charge_curves):
                controle_irve = controler_consommation(energies_fichier.get('Cons. IRVE') or 0.0, bilan_irve, "du fichier importé")
        elif irve_demande:
            if len(courbe_irve.get('irve') or []) < expected_length:
                return jsonify({'error': f"La courbe IRVE du projet contient moins de {expected_length} valeurs."}), 400
            charge_curves = extract_consumption_from_json(courbe_irve, expected_length)
            irve_curve = next((c for c in charge_curves if c['label'] == 'Cons. IRVE'), None)
            controle_irve = controler_consommation(sum(irve_curve['data']) * dt_h if irve_curve else 0.0, bilan_irve, "de la courbe enregistrée")
        else:
            # Courbe PAC seule (ni fichier ni IRVE).
            charge_curves = []

        controle_pac = None
        bilan_pac = courbe_pac.get('bilan_pac_kwh') if courbe_pac else None
        if pac_demande:
            if len(courbe_pac.get('pac') or []) < expected_length:
                return jsonify({'error': f"La courbe PAC du projet contient moins de {expected_length} valeurs."}), 400
            pac_data = courbe_murale_vers_utc1(courbe_pac['pac'], courbe_pac.get('annee'), expected_length)
            controle_pac = controler_consommation_pac(sum(pac_data) * dt_h, bilan_pac, "de la courbe enregistrée")
            charge_curves = avec_courbe_pac(charge_curves, pac_data)
        elif 'Cons. PAC' in energies_fichier:
            # Colonne PAC d'un fichier importé : contrôlée contre le bilan PAC du projet s'il en a un
            # (un fichier issu d'un autre outil reste accepté quand aucun calcul PAC n'existe).
            courbe_pac_projet = _courbe_pac_projet(projet_id)
            if courbe_pac_projet:
                bilan_pac = courbe_pac_projet.get('bilan_pac_kwh')
                controle_pac = controler_consommation_pac(energies_fichier['Cons. PAC'] or 0.0, bilan_pac, "du fichier importé")

        results = process_data(raw_pv_data, charge_curves, time_step, priority_mode, ordre_usages)

        if cons_file:
            # Consommation lue par le navigateur à l'import = consommation du tableau récapitulatif ;
            # sinon l'étude est bloquée (rien n'est renvoyé ni enregistré).
            try:
                conso_lue = json.loads(request.form.get('conso_lue_kwh') or 'null')
            except (TypeError, ValueError):
                return jsonify({'error': "Consommation lue à l'import illisible : réimportez la courbe de charge."}), 400
            try:
                controle_import = controler_conso_import(conso_lue, results, irve_ajoute=bool(irve_demande), pac_ajoute=bool(pac_demande))
            except IncoherenceConsoImport as e:
                logging.warning("Calcul ACI bloqué (projet %s) : %s", projet_id, e)
                return jsonify({'error': str(e), 'controle_conso_import': {'conforme': False}}), 400
            if controle_import:
                results['controle_conso_import'] = controle_import

        if controle_pac:
            site_pac = ((results.get('sites') or {}).get('Cons. PAC') or {}).get('summary') or {}
            controle_pac = controler_consommation_pac(float(site_pac.get('consumption_mwh') or 0.0) * 1000.0, bilan_pac, "du tableau récapitulatif")
            results['controle_pac'] = controle_pac
        if pac_demande and courbe_pac.get('pac_ecs_solaire'):
            results['gain_ecs_solaire'] = _gain_ecs_solaire(raw_pv_data, charge_curves, courbe_pac, results, time_step,
                                                            expected_length, priority_mode, ordre_usages)

        if controle_irve:
            # Dernier filet : la consommation IRVE du tableau récapitulatif doit être celle du bilan.
            site_irve = (results.get('sites') or {}).get('Cons. IRVE') or {}
            recap_kwh = float((site_irve.get('summary') or {}).get('consumption_mwh') or 0.0) * 1000.0
            controle_irve = controler_consommation(recap_kwh, bilan_irve, "du tableau récapitulatif")
            results['controle_irve'] = controle_irve

        if pv_results:
            # KPIs de production PV (puissance installée, productible P50, PR) et détail par champ,
            # pour l'affichage des cartes de synthèse et du panneau "Résultats détaillés" côté front-end.
            results['pv_summary'] = {
                'summary': pv_results['summary'],
                'fields': pv_results['fields'],
                'plants_summary': pv_results['plants_summary']
            }

        if controle_irve and projet_id:
            _memoriser_autoconso_irve(projet_id, courbe_irve, results, time_step)
        if pac_demande and projet_id:
            _memoriser_autoconso_pac(projet_id, courbe_pac, results, time_step, priority_mode, ordre_usages)
        _memoriser_resultats_prodsolaire(projet_id, 'aci', results)

        return jsonify(results)
    except (ValueError, TypeError, KeyError) as e:
        # CORRECTIF (validation stricte) : erreurs de parsing/données métier invalides (ex. taux
        # d'autoconsommation >100%, cf. rate_utils.py) -> 400 explicite plutôt que 500 générique.
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def _courbe_irve_projet(projet_id):
    """Courbe IRVE enregistrée (IrveConfig.load_curve) du projet déjà autorisé, ou None."""
    if not projet_id:
        return None
    from app.models.irve import IrveConfig
    config = IrveConfig.query.filter_by(projet_id=projet_id).first()
    courbe = config.load_curve if config else None
    return courbe if courbe and courbe.get('irve') else None


def _courbe_pac_projet(projet_id):
    """Courbe PAC enregistrée (IrveConfig.courbe_pac) du projet déjà autorisé, ou None."""
    if not projet_id:
        return None
    from app.models.irve import IrveConfig
    config = IrveConfig.query.filter_by(projet_id=projet_id).first()
    courbe = config.courbe_pac if config else None
    return courbe if courbe and courbe.get('pac') else None


def _bilan_site(results, label):
    s = (((results.get('sites') or {}).get(label) or {}).get('summary')) or {}
    conso = float(s.get('consumption_mwh') or 0.0) * 1000.0
    pv = float(s.get('pv_consumed_mwh') or 0.0) * 1000.0
    return {'conso_kwh': conso, 'pv_kwh': pv, 'reseau_kwh': max(0.0, conso - pv),
            'autoproduction': s.get('autoproduction_rate'), 'autoconsommation': s.get('autoconsumption_rate')}


def _gain_ecs_solaire(raw_pv_data, charge_curves, courbe_pac, results, time_step, expected_length, priority_mode, ordre_usages):
    """
    Gain du décalage de l'ECS sur les heures solaires : même production PV, mêmes autres usages et
    même règle d'affectation, seule la courbe PAC change (variante simulée par le module PAC avec la
    plage de production « heures solaires »).
    """
    variante = courbe_murale_vers_utc1(courbe_pac['pac_ecs_solaire'], courbe_pac.get('annee'), expected_length)
    autres = [c for c in charge_curves if c['label'] in ('Cons. existante', 'Cons. IRVE')]
    resultats_v = process_data(raw_pv_data, avec_courbe_pac(autres, variante), time_step, priority_mode, ordre_usages)
    base, solaire = _bilan_site(results, 'Cons. PAC'), _bilan_site(resultats_v, 'Cons. PAC')
    glob_b, glob_s = _bilan_site(results, 'Cons. Totale'), _bilan_site(resultats_v, 'Cons. Totale')
    return {
        'plage_base': ((courbe_pac.get('resume') or {}).get('plage_ecs')),
        'pac_base': base,
        'pac_solaire': solaire,
        'gain_pv_pac_kwh': solaire['pv_kwh'] - base['pv_kwh'],
        'gain_reseau_kwh': base['reseau_kwh'] - solaire['reseau_kwh'],
        'site_reseau_base_kwh': glob_b['reseau_kwh'],
        'site_reseau_solaire_kwh': glob_s['reseau_kwh'],
        'autoconsommation_base': (results['sites'].get('Global') or {}).get('summary', {}).get('autoconsumption_rate'),
        'autoconsommation_solaire': (resultats_v['sites'].get('Global') or {}).get('summary', {}).get('autoconsumption_rate'),
    }


def _memoriser_autoconso_pac(projet_id, courbe_pac, results, time_step, priority_mode, ordre_usages):
    """
    Mémorise en base le résultat d'autoconsommation de la PAC avec la courbe qui l'a produit (relu
    par la section PAC). Rien n'est écrit si la courbe a changé entre-temps.
    """
    from app.extensions import db
    from app.models.irve import IrveConfig
    try:
        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        actuelle = config.courbe_pac if config else None
        if not actuelle or actuelle.get('enregistre_le') != courbe_pac.get('enregistre_le'):
            return
        pac = _bilan_site(results, 'Cons. PAC')
        kwc = (((results.get('pv_summary') or {}).get('summary')) or {}).get('peak_power_kw')
        config.courbe_pac = dict(actuelle, autoconso_pac={
            'pas_min': time_step,
            'conso_pac_kwh': pac['conso_kwh'],
            'pv_pac_kwh': pac['pv_kwh'],
            'reseau_pac_kwh': pac['reseau_kwh'],
            'autoproduction_pac': pac['autoproduction'],
            'autoconsommation_pac': pac['autoconsommation'],
            'kwc': kwc,
            'regle': priority_mode,
            'ordre': ordre_usages,
            'usages': [k for k in (results.get('site_keys') or []) if k in ('Cons. existante', 'Cons. IRVE', 'Cons. PAC')],
            'gain_ecs_solaire': results.get('gain_ecs_solaire'),
            'calcule_le': horodatage_irve(),
        })
        db.session.commit()
    except Exception as e:
        logging.getLogger(__name__).warning("Mémorisation de l'autoconsommation PAC impossible : %s", e)
        try:
            db.session.rollback()
        except Exception:
            pass


def _memoriser_resultats_prodsolaire(projet_id, type_etude, results):
    """
    Enregistre en base les valeurs du calcul reprises par l'étude économique (puissance,
    productible, taux d'autoconsommation, parts hiver/été — cf. app/services/resultats_prodsolaire.py).
    Un échec n'empêche jamais l'affichage du calcul : l'étude éco reste alors bloquée faute de
    résultat enregistré (« relancez le calcul »), jamais alimentée par une valeur périmée.
    """
    if not projet_id:
        return
    try:
        projet = db.session.get(ParametreProjet, projet_id)
        if projet is None:
            return
        memoriser_calcul(projet, type_etude, results)
        db.session.commit()
        results['prosolaire_enregistre'] = projet_id
        # Site autonome : taux de couverture PV calculé ici, identique à celui de l'étude éco.
        reference = reference_eco(projet_id) or {}
        if reference.get('taux_couverture_pct') is not None:
            results['taux_couverture_pct'] = reference['taux_couverture_pct']
    except Exception as e:
        logging.getLogger(__name__).warning("Enregistrement des résultats ProSolaire impossible : %s", e)
        try:
            db.session.rollback()
        except Exception:
            pass


def _memoriser_autoconso_irve(projet_id, courbe_irve, results, time_step):
    """
    Mémorise en base la part PV consommée par les bornes (UTC+1, pas par pas) avec la courbe IRVE
    qui l'a produite : la section Rentabilité IRVE la relit par le serveur (et non dans le stockage
    local du navigateur). Rien n'est écrit si la courbe a changé entre-temps.
    """
    from app.extensions import db
    from app.models.irve import IrveConfig
    try:
        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        actuelle = config.load_curve if config else None
        if not actuelle or actuelle.get('enregistre_le') != courbe_irve.get('enregistre_le'):
            return
        hd = results.get('hourly_data') or {}
        pv_irve = hd.get('pv_consumed_irve') or []
        site_irve = (results.get('sites') or {}).get('Cons. IRVE') or {}
        site = site_irve.get('summary') or {}
        graphiques = site_irve.get('charts') or {}
        kwc = (((results.get('pv_summary') or {}).get('summary')) or {}).get('peak_power_kw')
        controle = results.get('controle_irve') or {}
        config.load_curve = dict(actuelle, autoconso_irve={
            'pas_min': time_step,
            'pv_irve': [round(float(v), 4) for v in pv_irve],
            'cons_irve_kwh': controle.get('calcul_kwh'),
            'pv_irve_kwh': float(site.get('pv_consumed_mwh') or 0.0) * 1000.0,
            'production_kwh': float(site.get('production_mwh') or 0.0) * 1000.0,
            'kwc': kwc,
            'source': controle.get('source'),
            'calcule_le': horodatage_irve(),
            # Camemberts du site « Cons. IRVE » (mêmes données que le tableau de l'autoconsommation).
            'camemberts': {k: graphiques.get(k) for k in ('pie_autoprod', 'pie_autocons') if graphiques.get(k)},
            'autoconsumption_rate': site.get('autoconsumption_rate'),
            'autoproduction_rate': site.get('autoproduction_rate'),
        })
        db.session.commit()
    except Exception as e:
        logging.getLogger(__name__).warning("Mémorisation de l'autoconsommation IRVE impossible : %s", e)
        try:
            db.session.rollback()
        except Exception:
            pass


def _projet_acc_autorise(projet_id):
    """Id du projet actif s'il appartient à l'utilisateur (ou admin), sinon None.

    Seul un projet réellement accessible sert de clé de comptage des études ACC : un id inconnu
    ou étranger est traité comme « sans projet » (chaque calcul compte alors pour une étude).
    """
    try:
        projet_id = int(projet_id)
    except (TypeError, ValueError):
        return None
    from app.routes.concevoir_mon_projet import _get_project_with_permission
    projet = _get_project_with_permission(projet_id, g.user)
    return projet.id if projet else None


@prodsolaire_bp.route('/api/acc/status', methods=['GET'])
@prodsolaire_bp.route('/concevoir_mon_projet/api/acc/status', methods=['GET'])
@login_required
def acc_quota_status():
    """État du quota ACC de l'utilisateur connecté (?projet_id=... pour savoir si un recalcul est libre)."""
    return jsonify(acc_status(g.user, _projet_acc_autorise(request.args.get('projet_id'))))


@prodsolaire_bp.route('/calculate_acc', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_acc', methods=['POST'])
@csrf.exempt
@login_required
def calculate_acc():
    try:
        pv_file = request.files.get('pv_file')
        pv_config_json = request.form.get('pv_config_json')
        cons_files = request.files.getlist('cons_files[]')
        custom_names_json = request.form.get('custom_names')
        repartition_method = request.form.get('repartition_method', 'dynamic')
        repartition_keys_json = request.form.get('repartition_keys')
        priority_order_json = request.form.get('priority_order')
        # "Affectation prod. hors ACC" (%) : part de la production retirée du partage ACC, bornée 0-15.
        grid_loss_percent = min(max(float(request.form.get('grid_loss_percent', 0)), 0.0), 15.0)
        time_step = int(request.form.get('time_step', 60))

        if not pv_file and not pv_config_json:
            return jsonify({'error': "Fichier PV ou configuration de l'ensoleillement manquants"}), 400
        if not cons_files:
            return jsonify({'error': "Aucun fichier de consommation fourni pour l'ACC"}), 400

        # Permission/quota ACC (session['licence_acc'], cf. app/services/acc/quota.py) : vérifié
        # AVANT tout calcul, l'étude n'est comptée qu'après un calcul réussi (register_acc_study).
        acc_projet_id = _projet_acc_autorise(request.form.get('projet_id'))
        acc_allowed, acc_message = check_acc_quota(g.user, acc_projet_id)
        if not acc_allowed:
            return jsonify({'error': acc_message, 'quota_exceeded': True}), 403

        expected_length = expected_length_for(time_step)

        pv_results = None
        if pv_config_json:
            is_valid_dist, dist_err = check_calepinage_distance_coherence(pv_config_json)
            if not is_valid_dist:
                return dist_err
            kwc = extract_kwc_from_payload(pv_config_json)
            if kwc:
                is_allowed, err = check_licence_power_allowance(kwc)
                if not is_allowed:
                    return err

            # Aucun fichier importé : la production est calculée côté serveur via PVGIS,
            # par centrale (cf. production_by_plant), à partir de la configuration des champs PV.
            pv_results = calculate_pv_data(_filtrer_scene_ombrage(json.loads(pv_config_json)))
            if pv_results and 'summary' in pv_results:
                peak_kw = float(pv_results['summary'].get('peak_power_kw', 0) or 0)
                if peak_kw > 0:
                    is_allowed, err = check_licence_power_allowance(peak_kw)
                    if not is_allowed:
                        return err

            raw_pv_data = pv_results['production_by_plant']
            for plant_id, series in raw_pv_data.items():
                if len(series) < expected_length:
                    return jsonify({'error': f"La production PV calculée contient {len(series)} valeurs ({expected_length} attendues)."}), 400
            # PVGIS est indexé en UTC : calé en UTC+1 fixe comme les consommations (cf. calage_horaire.py).
            raw_pv_data = {plant_id: utc_vers_utc1(series[:expected_length], time_step)
                           for plant_id, series in raw_pv_data.items()}
        else:
            raw_pv_data = extract_values_from_file(pv_file, expected_length)

        custom_names = json.loads(custom_names_json) if custom_names_json else {}
        repartition_keys = json.loads(repartition_keys_json) if repartition_keys_json else {}
        priority_order = json.loads(priority_order_json) if priority_order_json else []

        # CORRECTIF (CAPEX/OPEX sous-estimés) : quand la production vient de PVGIS, pv_results
        # contient la vraie puissance crête nameplate (STC, somme des champs) — à transmettre pour
        # que le dimensionnement financier ACC ne se base pas sur le pic de la courbe de production
        # (toujours < nameplate). En import manuel d'un fichier de production, cette info n'existe
        # pas côté serveur (aucune config de champs) : process_acc_data retombe alors sur l'ancienne
        # approximation, cf. calcul_acc.py.
        true_peak_power_kw = pv_results['summary']['peak_power_kw'] if pv_results else None

        results = process_acc_data(
            raw_pv_data, cons_files, time_step,
            repartition_method=repartition_method,
            repartition_keys=repartition_keys,
            grid_loss_percent=grid_loss_percent,
            custom_names=custom_names,
            priority_order=priority_order,
            true_peak_power_kw=true_peak_power_kw
        )

        if pv_results:
            # KPIs de production PV (puissance installée, productible P50, PR) et détail par champ,
            # pour l'affichage des cartes de synthèse et du panneau "Résultats détaillés" côté front-end.
            results['pv_summary'] = {
                'summary': pv_results['summary'],
                'fields': pv_results['fields'],
                'plants_summary': pv_results['plants_summary']
            }

        register_acc_study(g.user, acc_projet_id)
        _memoriser_resultats_prodsolaire(acc_projet_id, 'acc', results)
        return jsonify(results)
    except (ValueError, TypeError, KeyError) as e:
        # CORRECTIF (validation stricte) : erreurs de parsing/données métier invalides (ex. taux
        # d'autoconsommation/autoproduction ACC >100%, cf. rate_utils.py) -> 400 explicite.
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/calculate_vente_totalite', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_vente_totalite', methods=['POST'])
@csrf.exempt
@login_required
def calculate_vente_totalite():
    try:
        pv_file = request.files.get('pv_file')
        pv_config_json = request.form.get('pv_config_json')
        time_step = int(request.form.get('time_step', 60))
        p90_params_json = request.form.get('p90_params')

        if not pv_file and not pv_config_json:
            return jsonify({'error': "Fichier PV ou configuration de l'ensoleillement manquants"}), 400
        if not p90_params_json:
            return jsonify({'error': 'Paramètres P50/P90 manquants'}), 400

        # Calcul lancé par le pompage solaire : inclinaison et pertes du calepinage = celles du
        # pompage, sinon étude bloquée avant tout calcul (cf. controle_parametres_pompage.py).
        try:
            controle_pompage = controler_parametres_pompage(request.form.get('controle_pompage'))
        except IncoherenceParametresPompage as e:
            return jsonify({'error': str(e), 'controle_parametres_pompage': {'conforme': False}}), 409

        expected_length = expected_length_for(time_step)

        pv_results = None
        if pv_file:
            raw_pv_data = extract_values_from_file(pv_file, expected_length)
        else:
            if pv_config_json:
                is_valid_dist, dist_err = check_calepinage_distance_coherence(pv_config_json)
                if not is_valid_dist:
                    return dist_err
            kwc = extract_kwc_from_payload(pv_config_json)
            if kwc:
                is_allowed, err = check_licence_power_allowance(kwc)
                if not is_allowed:
                    return err

            # Aucun fichier importé : la production est calculée côté serveur via PVGIS,
            # à partir de la configuration des champs PV (cf. buildPvParams() côté client).
            pv_results = calculate_pv_data(_filtrer_scene_ombrage(json.loads(pv_config_json)))
            if pv_results and 'summary' in pv_results:
                peak_kw = float(pv_results['summary'].get('peak_power_kw', 0) or 0)
                if peak_kw > 0:
                    is_allowed, err = check_licence_power_allowance(peak_kw)
                    if not is_allowed:
                        return err

            raw_pv_data = [h['P_kW'] for h in pv_results['hourly']]
            if len(raw_pv_data) < expected_length:
                return jsonify({'error': f"La production PV calculée contient {len(raw_pv_data)} valeurs ({expected_length} attendues)."}), 400
            raw_pv_data = raw_pv_data[:expected_length]

        results = process_vente_totalite_data(raw_pv_data, time_step, p90_params_json)

        if pv_results:
            # KPIs de production PV (puissance installée, productible P50, PR) et détail par champ,
            # pour l'affichage des cartes de synthèse et du panneau "Résultats détaillés" côté front-end.
            results['pv_summary'] = {
                'summary': pv_results['summary'],
                'fields': pv_results['fields'],
                'plants_summary': pv_results['plants_summary']
            }
        if controle_pompage:
            results['controle_parametres_pompage'] = controle_pompage

        _memoriser_resultats_prodsolaire(_projet_acc_autorise(request.form.get('projet_id')), 'vente_totalite', results)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/generate-pdf', methods=['POST'])
@prodsolaire_bp.route('/generate-autoconso-pdf', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/generate-pdf', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/generate-autoconso-pdf', methods=['POST'])
@csrf.exempt # (je poserai la question à Jean roondsen sur cette ligne de code)
@login_required
def generate_autoconso_pdf():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        kwc = extract_kwc_from_payload(data)
        if kwc:
            is_allowed, err = check_licence_power_allowance(kwc)
            if not is_allowed:
                return err

        if data.get('study_type') == 'acc' and data.get('economic_params') is not None:
            try:
                peak_kw = float(((data.get('sites') or {}).get('Global') or {}).get('summary', {}).get('peak_power_kw') or 0)
            except (TypeError, ValueError, AttributeError):
                peak_kw = 0
            erreurs_eco = verifier_parametres_eco_acc(data.get('economic_params'), peak_kw * 1000)
            if erreurs_eco:
                return jsonify({'error': 'Paramètres économiques invalides : ' + ' '.join(erreurs_eco)}), 400

        from app.models.calcul_prodsolaire.rapport_autoconso import generate_pdf_report as generate_autoconso_pdf_report  # import différé : bibliothèque lourde, chargée au premier appel
        pdf_bytes = generate_autoconso_pdf_report(data)

        return send_file(
            pdf_pour_utilisateur(pdf_bytes),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='Rapport_Analyse_Photovoltaique_Serveur.pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/calculate_pv', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_pv', methods=['POST'])
@csrf.exempt
@login_required
def calculate_pv():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        is_valid_dist, dist_err = check_calepinage_distance_coherence(data)
        if not is_valid_dist:
            return dist_err

        kwc = extract_kwc_from_payload(data)
        if kwc:
            is_allowed, err = check_licence_power_allowance(kwc)
            if not is_allowed:
                return err

        results = calculate_pv_data(_filtrer_scene_ombrage(data))
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/api/tmy_cache', methods=['GET'])
@prodsolaire_bp.route('/concevoir_mon_projet/api/tmy_cache', methods=['GET'])
@login_required
def tmy_cache_list():
    """Bases météo locales (cache TMY) à TMY_CACHE_RAYON_MAX_KM au plus du site (?lat=&lon=), compatibles
    avec les réglages PVGIS (?usehorizon=&pv_version=), triées par distance. Sans site valide : liste vide."""
    try:
        lat = float(request.args.get('lat', ''))
        lon = float(request.args.get('lon', ''))
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError
    except (TypeError, ValueError):
        lat = lon = None
    usehorizon = request.args.get('usehorizon', '1')
    pv_version = request.args.get('pv_version', 'v5_3')
    user = getattr(g, 'user', None) or {}
    return jsonify({
        'bases': get_cached_tmy_list(lat, lon, usehorizon, pv_version),
        'rayon_auto_km': TMY_CACHE_RAYON_AUTO_KM,
        'rayon_max_km': TMY_CACHE_RAYON_MAX_KM,
        'can_delete': bool(user.get('is_admin')),
    })


@prodsolaire_bp.route('/api/tmy_cache/<entry_id>', methods=['DELETE'])
@prodsolaire_bp.route('/concevoir_mon_projet/api/tmy_cache/<entry_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def tmy_cache_delete(entry_id):
    """Suppression d'une base météo locale : réservée aux administrateurs (le bouton n'est affiché qu'à
    eux, la règle est revérifiée ici)."""
    user = getattr(g, 'user', None) or {}
    if not user.get('is_admin'):
        return jsonify({'error': "Suppression réservée aux administrateurs."}), 403
    if not delete_cached_tmy(entry_id):
        return jsonify({'error': "Base météo locale introuvable (déjà supprimée ?)."}), 404
    logging.info("Base météo locale %s supprimée par l'administrateur %s.", entry_id, user.get('id'))
    return jsonify({'deleted': entry_id})


@prodsolaire_bp.route('/storage_parc', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/storage_parc', methods=['POST'])
@csrf.exempt
@login_required
def storage_parc():
    """Aperçu du parc de batteries (montage, couplage, contrôles) pendant la saisie du modal stockage.

    Même calcul que celui appliqué par /calculate_storage (configuration_parc_batteries.py) : une seule
    source de vérité, pas de duplication des règles côté navigateur.
    """
    try:
        data = request.get_json(silent=True) or {}
        params = StorageParams.model_validate({**{
            'sto_cap': 1, 'sto_charge_power': 0.5, 'sto_discharge_power': 0.5, 'sto_dod': 100,
            'sto_cycles': 6000, 'sto_degrad_cal': 1}, **data})
        v = params.model_dump()
        parc = calculer_parc(
            unite={'capacite_kwh': v['sto_cap'], 'puissance_charge_kw': v['sto_charge_power'],
                   'puissance_decharge_kw': v['sto_discharge_power'], 'tension_v': data.get('sto_voltage'),
                   'courant_max_a': v['sto_courant_max_a'], 'dod_pct': v['sto_dod']},
            montage=v['sto_montage'], nb_total=v['sto_nb_batteries'], nb_serie=v['sto_nb_serie'],
            limites={k: v['sto_' + k] for k in ('nb_serie_min', 'nb_serie_max', 'nb_parallele_max')},
            onduleur={'couplage': v['sto_couplage'], 'rendement': v['sto_rendement_onduleur'],
                      'puissance_kw': v['sto_puissance_onduleur_kw'], 'hybride': v['sto_onduleur_hybride'],
                      'compatible': v['sto_onduleur_compatible']},
        )
        parc['rendement_systeme_pct'] = {k: round(x * 100, 2) for k, x in rendement_systeme(
            v['sto_rte'], v['sto_couplage'], v['sto_rendement_onduleur']).items()}
        return jsonify(parc)
    except pydantic.ValidationError as e:
        return jsonify({'error': message_erreur_lisible(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@prodsolaire_bp.route('/calculate_storage', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_storage', methods=['POST'])
@csrf.exempt
@login_required
def calculate_storage():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        # Validation stricte des CARACTÉRISTIQUES BATTERIE avant d'atteindre PySAM (demande
        # explicite, principe « aucune confiance dans la saisie »). Sans elle, une capacité nulle
        # ou un DOD aberrant partait tel quel dans le moteur, qui répondait par une exception de
        # précheck remontée en HTTP 500 — sans jamais dire à l'utilisateur quel champ corriger.
        # Le payload validé est FUSIONNÉ dans les données reçues plutôt que de les remplacer : les
        # séries horaires (production, consommation) ne sont pas des saisies et ne passent pas par
        # le schéma.
        params = StorageParams.model_validate(data)
        data.update(params.model_dump())

        results = calculate_storage_data(data)
        # Taux combiné et parts hiver/été avec batterie, repris par l'étude éco (cf.
        # app/services/resultats_prodsolaire.py).
        projet_id = _projet_acc_autorise(data.get('projet_id'))
        if projet_id:
            try:
                memoriser_stockage(projet_id, data, results)
                db.session.commit()
                results['prosolaire_enregistre'] = projet_id
            except Exception as e:
                logging.getLogger(__name__).warning("Enregistrement du stockage pour l'étude éco impossible : %s", e)
                db.session.rollback()
        return jsonify(results)
    except pydantic.ValidationError as e:
        # 400 et message désignant le champ fautif : c'est une saisie à corriger, pas une panne.
        return jsonify({'error': message_erreur_lisible(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/calculate_shed_shading', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_shed_shading', methods=['POST'])
@csrf.exempt
@login_required
def calculate_shed_shading():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        kwc = extract_kwc_from_payload(data)
        if kwc:
            is_allowed, err = check_licence_power_allowance(kwc)
            if not is_allowed:
                return err

        results = calculate_shed_shading_data(data)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/calculate_shed_shading_terrain', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/calculate_shed_shading_terrain', methods=['POST'])
@csrf.exempt
@login_required
def calculate_shed_shading_terrain():
    """Perte d'ombrage entre sheds avec le relief (calcul_shed_shading_terrain.py)."""
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        kwc = extract_kwc_from_payload(data)
        if kwc:
            is_allowed, err = check_licence_power_allowance(kwc)
            if not is_allowed:
                return err

        params = ShedShadingTerrainParams.model_validate(data)
        results = calculate_shed_shading_terrain_data(params.model_dump())
        return jsonify(results)
    except pydantic.ValidationError as e:
        return jsonify({'error': message_erreur_ombrage_terrain(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@prodsolaire_bp.route('/generate_pv_pdf', methods=['POST'])
@prodsolaire_bp.route('/concevoir_mon_projet/generate_pv_pdf', methods=['POST'])
@csrf.exempt
@login_required
def generate_pv_pdf():
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'Aucune donnée fournie'}), 400

        kwc = extract_kwc_from_payload(data)
        if kwc:
            is_allowed, err = check_licence_power_allowance(kwc)
            if not is_allowed:
                return err

        from app.models.rapport_prodsolaire import generate_pv_pdf_report  # import différé : bibliothèque lourde, chargée au premier appel
        pdf_bytes = generate_pv_pdf_report(data)
        return send_file(
            pdf_pour_utilisateur(pdf_bytes),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='Rapport_Production_PV.pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
