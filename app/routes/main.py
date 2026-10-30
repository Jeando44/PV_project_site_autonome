"""
Blueprint principal pour les routes de base de l'application
Contient: login, logout, homepage, newsletter, API routes, routes concevoir_mon_projet (anciennement ombridesign)
"""
from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for, session, Response, g, send_file, send_from_directory, current_app
from flask_mail import Message
from flask_login import LoginManager, login_user, current_user
import requests
import sqlite3
import bcrypt
import json
import math
import os
import re
import datetime
import io
import secrets
from werkzeug.utils import secure_filename
from sqlalchemy import desc
# matplotlib n'est plus importé ici (aucun usage dans ce fichier) : les modules qui tracent
# (etude_economique, GraphModal, rapport_prodsolaire) forcent eux-mêmes le backend 'Agg'.

from app.middleware.auth_middleware import login_required, permission_required, active_project_required, SSOConfig
from app.extensions import db, csrf
from app.models import ParametreProjet
from app.services.version_projet import lire_etat
from app.models.parametre_projet import normaliser_typologie, normaliser_type_etude
from forms import ContactForm

# Imports pour la liste de matériels
from app.models.liste_de_materiels import logic_calcul_liste_de_materiels, calculer_total_ht
from app.services.mention_essai import pdf_pour_utilisateur
from app.utils.parcours import (parcours_actif, url_accueil, edition_application, _description, PARCOURS_PRO,
                                PARCOURS_SITE_AUTONOME, EDITION_SITE_AUTONOME)
from app.models.calcul_pompage_solaire import get_pvgis_daily_irradiation, process_simulation, plan_affaires
from app.schemas.pompage_solaire_schemas import PompageSolaireRequest, PlanAffairesRequest
import pydantic


# Création du blueprint principal
main_bp = Blueprint('main', __name__)


# ========== Fonctions utilitaires ===========
def _compute_active_projet_typologie():
    """Typologie (Résidentielle/Professionnelle (C&I)/Grand projet) du projet actif en session,
    vérifiée en base (pas seulement présente en session). Exposée en JS via
    window.ACTIVE_PROJECT_TYPOLOGIE (cf. parametre.html) pour filtrer certains outils/panneaux
    selon la typologie — utilisée par toutes les pages incluant parametre.html (index, systeme,
    export, geometrie, autoconsommation, etude_economique, calculateur_APER), pas seulement
    index.html qui héberge la carte.
    """
    active_projet_id = session.get('active_projet_id')
    if not active_projet_id or not g.user:
        return ''
    query = ParametreProjet.query.filter_by(id=active_projet_id)
    if not g.user.get('is_admin'):
        query = query.filter_by(created_by=g.user['id'])
    projet_actif = query.first()
    if projet_actif and projet_actif.typologie_projet:
        # Forme canonique : une variante historique sans accent (« Residentielle ») faisait échouer
        # la comparaison stricte du frontend (window.isResidentialPath) au rechargement.
        return normaliser_typologie(projet_actif.typologie_projet)
    return ''


def _active_projet_en_session():
    """Projet actif en session, vérifié en base (jamais sur la seule foi de la session), ou None.

    Une seule requête, partagée par les valeurs exposées au frontend ci-dessous.
    """
    active_projet_id = session.get('active_projet_id')
    user = getattr(g, 'user', None)
    if not active_projet_id or not user:
        return None
    query = ParametreProjet.query.filter_by(id=active_projet_id)
    if not user.get('is_admin'):
        query = query.filter_by(created_by=user['id'])
    return query.first()


def _compute_active_projet_type_connexion():
    """Type de connexion du projet actif ('connecte' / 'hors-ligne'), vérifié en base.

    Exposée en JS via window.ACTIVE_PROJECT_TYPE_CONNEXION (cf. parametre.html et
    app_irve_v1.16.html), sur le même modèle que _compute_active_projet_typologie() ci-dessus.

    Nécessaire car la seule source disponible jusqu'ici côté frontend était
    localStorage.solarProjectData.projectInfo.typeDeProjet, écrite par StorageManager.js depuis le
    DOM du formulaire : vide après un rechargement, sur un autre navigateur, ou pour un projet
    simplement rechargé depuis la base sans repasser par "Paramètres du projet". Les masquages qui
    en dépendaient (onglets Enedis / Borne de recharge / Import CdC du modal IRVE, cf.
    irve_nav_menu.js) retombaient alors silencieusement sur le comportement "projet connecté".
    """
    projet_actif = _active_projet_en_session()
    return (projet_actif.type_de_projet or '') if projet_actif else ''


def _compute_active_projet_pays():
    """Pays du projet actif, vérifié en base.

    Exposé en JS via window.ACTIVE_PROJECT_PAYS (cf. parametre.html) et consommé par
    PdfUtilities.getPays(), qui décide quels contenus propres à la réglementation française
    apparaissent dans le rapport (références cadastrales, arrêté tarifaire S21).

    Nécessaire car les deux sources dont disposait le frontend sont toutes deux prises en défaut
    pour un projet simplement rechargé : `solarProjectData.projectInfo.pays` n'est écrit NULLE PART
    (StorageManager.js ne collecte pas ce champ), et le `<select id="pays">` du formulaire
    "Paramètres du projet" n'est renseigné que si l'utilisateur ouvre ce formulaire en édition —
    sinon il garde sa valeur par défaut, France. Les contenus France-only s'affichaient donc pour
    un projet à l'étranger.
    """
    projet_actif = _active_projet_en_session()
    return (projet_actif.pays or '') if projet_actif else ''


def _session_caches():
    """Identifiant opaque de la session de connexion (aucune valeur d'authentification) : le
    navigateur écarte les caches locaux des projets dès qu'il change (nouvelle connexion, session
    expirée ou fermée), cf. services/version_projet.js. Créé à la première page rendue de la session."""
    if 'user' not in session:
        return None
    if not session.get('skv_session_caches'):
        session['skv_session_caches'] = secrets.token_hex(8)
    return session['skv_session_caches']


def _parcours_sans_erreur():
    try:
        return parcours_actif()
    except Exception:
        return _description(PARCOURS_SITE_AUTONOME if edition_application() == EDITION_SITE_AUTONOME else PARCOURS_PRO)


@main_bp.app_context_processor
def _inject_active_projet_contexte():
    """Rend `active_projet_type_connexion` et `active_projet_pays` disponibles dans TOUS les
    templates, sans avoir à les ajouter à chacun des render_template() du module (contrairement à
    active_projet_typologie, passé explicitement route par route) — et en UNE SEULE requête.
    Défensif par construction : un contexte sans utilisateur ni projet actif (page de login, page
    d'erreur) doit rendre des chaînes vides, jamais lever.
    """
    try:
        projet_actif = _active_projet_en_session()
        etat_version = lire_etat(projet_actif.id) if projet_actif else (None, None)
        current_u = getattr(g, 'user', None)
        is_admin_flag = bool(current_u and current_u.get('is_admin'))
        return {
            'is_admin': is_admin_flag,
            'active_projet_type_connexion': (projet_actif.type_de_projet or '') if projet_actif else '',
            'active_projet_pays': (projet_actif.pays or '') if projet_actif else '',
            # Type de projet (Toiture / Ombrière / Petit champ solaire / Autres) : repli du chiffrage
            # CAPEX PRO pour afficher les lignes de structure quand le calepinage est encore vide.
            'active_projet_type_projet': (projet_actif.type_projet or '') if projet_actif else '',
            # Mode de valorisation / option hors ligne : pilote la section Pompage solaire des
            # formulaires de calepinage, et le type d'étude ACI / ACC (import mono ou multi-fichiers)
            # d'index_autoconso.html et de la section Import CdC de l'IRVE.
            'active_projet_mode_valorisation': (projet_actif.mode_de_valorisation or '') if projet_actif else '',
            # Type d'étude (« Chiffrage » / « Étude technico-économique » / « Étude de faisabilité
            # détaillée ») : pilote le parcours Chiffrage (menu, modal de chiffrage, export du
            # dossier plans) — le localStorage solarProjectData.projectInfo.typeEtude n'est pas fiable.
            'active_projet_type_etude': (normaliser_type_etude(projet_actif.type_etude) or '') if projet_actif else '',
            # Adresse du projet actif (JSON : libellé + latitude/longitude), telle qu'elle a été
            # saisie dans « Paramètres du projet ». Exposée ici pour que les modales n'aient pas à
            # la reconstituer depuis localStorage — lequel est vide dès qu'on n'est pas passé par ce
            # formulaire dans la session courante (projet rechargé depuis la base, autre navigateur,
            # stockage vidé). Même raisonnement que pour `active_projet_type_connexion`, dont le
            # repli localStorage avait déjà causé un bug de ce type.
            'active_projet_adresse': (projet_actif.adresse_projet or '') if projet_actif else '',
            # Identifiant du projet actif VÉRIFIÉ en base contre l'utilisateur (le localStorage
            # `current_projet_id` peut désigner un autre projet) : clé de la persistance du module
            # Pompage solaire (pompage_solaire_section.js).
            'active_projet_id_verifie': projet_actif.id if projet_actif else None,
            # Version des données du projet actif au rendu de la page (verrou optimiste et
            # cohérence des caches locaux, cf. app/services/version_projet.py) ; None : inconnue.
            'active_projet_version': etat_version[0],
            'active_projet_dernier_onglet': etat_version[1],
            # Session de connexion (cf. _session_caches) : caches locaux écartés si elle a changé.
            'skv_session_caches': _session_caches(),
            # Nom du projet actif (vérifié en base) : rattachement des saisies PAC stockées localement.
            'active_projet_nom': (projet_actif.nom_projet or '') if projet_actif else '',
            # Utilisateur connecté : clé (avec le projet) du stockage local du système hybride.
            'active_utilisateur_id': current_u.get('id') if current_u else None,
            'distance_seuil_projet': current_app.config.get('DISTANCE_SEUIL_PROJET', 300),
            'distance_max_calepinage': current_app.config.get('DISTANCE_MAX_CALEPINAGE', 2000),
            # Surface maximale d'un contour de calepinage maison (m²), cf. config.py.
            'calepinage_surface_max_rect_m2': current_app.config.get('CALEPINAGE_SURFACE_MAX_RECT_M2', 25000),
            'calepinage_surface_max_polygone_m2': current_app.config.get('CALEPINAGE_SURFACE_MAX_POLYGONE_M2', 50000),
            # Parcours (PRO / Résidentiel / Site autonome) : valeurs imposées à la création d'un
            # projet et page d'accueil vers laquelle revenir (cf. app/utils/parcours.py).
            'parcours_projet': parcours_actif(),
        }
    except Exception:
        current_u = getattr(g, 'user', None)
        return {'is_admin': bool(current_u and current_u.get('is_admin')),
                'active_projet_type_connexion': '', 'active_projet_pays': '',
                'active_projet_type_projet': '',
                'active_projet_mode_valorisation': '', 'active_projet_adresse': '',
                'active_projet_type_etude': '',
                'active_projet_id_verifie': None, 'active_projet_version': None, 'active_projet_dernier_onglet': None, 'active_projet_nom': '', 'skv_session_caches': None,
                'active_utilisateur_id': current_u.get('id') if current_u else None,
                'distance_seuil_projet': 300, 'distance_max_calepinage': 2000,
                'calepinage_surface_max_rect_m2': 25000, 'calepinage_surface_max_polygone_m2': 50000,
                'parcours_projet': _parcours_sans_erreur()}


def load_users():
    """Charge les utilisateurs depuis users.json"""
    with open('users.json') as f:
        return json.load(f)


def wgs84_to_tile_coords(lat, lon, zoom):
    """
    Convertit les coordonnées WGS84 (lat, lon) en coordonnées de tuile WMTS.
    """
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)

    # Calcul des coordonnées du pixel dans la tuile
    tile_size = 256

    # Coordonnées en pixels sur la carte globale au niveau de zoom donné
    pixel_x = ((lon + 180.0) / 360.0) * n * tile_size
    pixel_y = ((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0) * n * tile_size

    # Coordonnées du pixel à l'intérieur de la tuile
    pixel_i = int(pixel_x % tile_size)
    pixel_j = int(pixel_y % tile_size)

    return xtile, ytile, pixel_i, pixel_j


# ========== Route racine ===========
@main_bp.route('/')
def home():
    """Redirige vers la page principale de l'application"""
    return redirect(url_accueil())


# ========== Routes d'authentification ===========
@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    """Route de connexion : redirige vers le portail Solakvan (SSO)"""
    return redirect(f"{SSOConfig.MAIN_APP_URL}/authentification/login")


@main_bp.route('/logout')
def logout():
    """Ferme la session locale et renvoie vers la déconnexion de l'application principale."""
    session.clear()
    return redirect(f"{SSOConfig.MAIN_APP_URL}/authentification/logout")


@main_bp.route('/api/session/heartbeat', methods=['POST'])
@csrf.exempt
@login_required
def session_heartbeat():
    """Renouvelle le timestamp d'activité pour éviter l'expiration par inactivité."""
    session['last_activity'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return jsonify({'status': 'ok'})


@main_bp.route('/api/session/expire', methods=['POST'])
@csrf.exempt
def session_expire():
    """Invalide la session côté serveur (appelé par le JS lors d'un logout par inactivité)."""
    session.clear()
    return jsonify({'status': 'ok'})



# ========== Routes Ombridesign ===========
@main_bp.route('/concevoir_mon_projet/')
@permission_required('concevoir_mon_projet')
@login_required
def index():
    """Page principale Ombridesign"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    # Récupérer les permissions de l'utilisateur depuis la session
    user_permissions = session.get('permissions', [])
    user = session.get('user', {})
    is_admin = user.get('is_admin', False)

    google_maps_key = os.getenv('GOOGLE_MAP_KEY', '')

    # Pré-remplir l'adresse du projet actif (cf. GeometryUtils.getProjectAddressLatLng() côté
    # frontend, utilisé pour la restriction géographique à PROJECT_RADIUS_LIMIT_KM) : sans ce
    # pré-remplissage, #parametre_project_hidden reste vide après un rechargement de page (le
    # localStorage 'solarProjectData' est vidé à la création d'un projet), ce qui désactivait
    # silencieusement le contrôle de distance (fail-open) pour tout projet fraîchement créé.
    project_address_json = ''
    # Typologie du projet actif : exposée en JS (window.ACTIVE_PROJECT_TYPOLOGIE, cf.
    # parametre.html) pour filtrer certains outils/panneaux selon la typologie — cf.
    # ButtonControl.js et le masquage du panneau calepinage.
    active_projet_typologie = _compute_active_projet_typologie()
    # Id du projet actif, vérifié en base (pas seulement présent en session) — exposé en JS
    # (window.ACTIVE_PROJECT_ID) pour que le frontend puisse détecter un désaccord avec
    # localStorage.current_projet_id (cf. index.html) : le calepinage résidentiel et le calepinage
    # grands-projets stockent leurs données dans des clés localStorage jamais scopées par projet —
    # un projet supprimé (y compris son calepinage maison) continuait sinon d'apparaître sur la carte
    # indéfiniment, même après un rechargement complet de la page.
    valid_active_projet_id = None
    active_projet_id = session.get('active_projet_id')
    if active_projet_id and g.user:
        query = ParametreProjet.query.filter_by(id=active_projet_id)
        if not g.user.get('is_admin'):
            query = query.filter_by(created_by=g.user['id'])
        projet_actif = query.first()
        if projet_actif:
            valid_active_projet_id = projet_actif.id
            if projet_actif.adresse_projet:
                project_address_json = projet_actif.adresse_projet

    return render_template(
        'concevoir_mon_projet/pages/index.html',
        user_permissions=user_permissions,
        is_admin=is_admin,
        google_maps_key=google_maps_key,
        project_radius_limit_km=current_app.config.get('PROJECT_RADIUS_LIMIT_KM', 0.5),
        project_address_json=project_address_json,
        active_projet_typologie=active_projet_typologie,
        active_projet_id=valid_active_projet_id
    )


# Deuxième entrée de la même page : parcours Résidentiel (bouton « Concevoir mon projet
# résidentiel » de Solakvan). Le parcours est déduit du chemin, cf. app/utils/parcours.py.
# Endpoint distinct : url_for('main.index') reste l'accueil PRO.
@main_bp.route('/concevoir_mon_projet/residentiel/')
@permission_required('concevoir_mon_projet')
@login_required
def index_residentiel():
    return index()


@main_bp.route('/api/config/maps-key')
@login_required
def maps_key():
    """Retourne la clé Google Maps uniquement aux utilisateurs authentifiés."""
    key = os.getenv('GOOGLE_MAP_KEY', '')
    if not key:
        return jsonify({'error': 'Clé Maps non configurée'}), 500
    return jsonify({'key': key})


@main_bp.route('/concevoir_mon_projet/bd-materiels-irve')
@permission_required('concevoir_mon_projet') # cette ligne gère l'accès au module ( main route et midleware)
@login_required
def bd_materiels_irve():
    """Base de données matériels IRVE"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template(
        'concevoir_mon_projet/modals/irve/app_irve_v1.16.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/prestations-autoconso')
@permission_required('concevoir_mon_projet')
@login_required
def prestations_autoconso():
    """Prestations autoconsommation"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/autoconso_gemini.html')


@main_bp.route('/concevoir_mon_projet/modal/ombriere_metal')
@permission_required('concevoir_mon_projet')
@login_required
def ombriere_metal():
    """Modal ombrière métal"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/geometrie/ombriere_metal_full.html')


@main_bp.route('/concevoir_mon_projet/modal/schema_unifilaire')
@permission_required('concevoir_mon_projet')
@login_required
def schema_unifilaire():
    """Modal éditeur de schéma unifilaire (bibliothèque de symboles électriques + canevas)"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/schema_unifilaire/schema_unifilaire.html',
                           symboles_autorises=_schema_unifilaire_symboles_autorises())


def _schema_unifilaire_symboles_autorises():
    """Accès à la palette de symboles du schéma unifilaire, selon
    config.SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL (True : administrateur seulement)."""
    if not current_app.config.get('SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL', True):
        return True
    user = getattr(g, 'user', None)
    return bool(user and user.get('is_admin'))


@main_bp.route('/concevoir_mon_projet/api/schema_unifilaire/palette')
@permission_required('concevoir_mon_projet')
@login_required
def schema_unifilaire_palette():
    """Filet de sécurité de la palette : le JS ne construit la bibliothèque de symboles qu'après
    une réponse 200 ici. Un non-admin qui réafficherait le panneau à la main n'obtient qu'un 403."""
    if not _schema_unifilaire_symboles_autorises():
        return jsonify({'autorise': False,
                        'message': 'Bibliothèque de symboles réservée à l\'administrateur.'}), 403
    return jsonify({'autorise': True})



# @main_bp.route('/concevoir_mon_projet/modal/batiment_metal')
# @permission_required('concevoir_mon_projet')
# @login_required
# def batiment_metal():
#     """Modal bâtiment métal"""
#     if 'user' not in session:
#         return redirect(url_for('main.login'))

#     return render_template('concevoir_mon_projet/modals/geometrie/batiment_metal_full.html')





@main_bp.route('/concevoir_mon_projet/geometrie/batiment_metal')
@permission_required('concevoir_mon_projet')
@login_required
def batiment_metal():
    """Bâtiment métal"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/geometrie/batiment_metal.html')


@main_bp.route('/concevoir_mon_projet/pre-etudes-geocoding')
@permission_required('concevoir_mon_projet')
@login_required
def pre_etudes_geocoding():
    """Pré-études géocoding"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/geocoding.html')



# ========== Liste de matériels ===========

@main_bp.route('/concevoir_mon_projet/modal/liste_de_materiels')
@permission_required('concevoir_mon_projet')
@login_required
def liste_de_materiels():
    """Liste de matériels"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/liste_de_materiels/liste_de_materiels.html')


# ========== API Routes ===========
@main_bp.route('/api/pvgis', methods=['GET'])
def get_pvgis_data():
    """Proxy pour l'API PVGIS"""
    lat = request.args.get('lat')
    lng = request.args.get('lon')
    peak_power = request.args.get('peakpower')
    mounting_place = request.args.get('mountingplace')
    loss = request.args.get('loss')
    angle = request.args.get('angle')
    aspect = request.args.get('aspect')
    use_horizon = request.args.get('usehorizon', 1)  # Utiliser l'horizon par défaut

    print("aspect is:", aspect)
    print("angle is:", angle)
    print("loss is:", loss)
    print("mounting_place is:", mounting_place)
    print("peak_power is:", peak_power)
    print("use_horizon is:", use_horizon)
    print("lat is:", lat)
    print("lng is:", lng)

    # Vérification des paramètres obligatoires
    if not lat or not lng:
        return jsonify({'error': 'Latitude et longitude sont requises'}), 400

    url = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc"
    params = {
        'lat': lat,
        'lon': lng,
        'peakpower': peak_power,
        'mountingplace': mounting_place,
        'loss': loss,
        'angle': angle,
        'aspect': aspect,
        'usehorizon': use_horizon,
        'outputformat': 'json'
    }

    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
        data = response.json()
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        print(f"Erreur PVGIS: {str(e)}")
        print(f"URL appelée: {response.url if 'response' in locals() else url}")
        return jsonify({'error': 'Erreur lors de la récupération des données d\'ensoleillement'}), 500


@main_bp.route('/api/cadastre-geoportail', methods=['GET'])
def get_parcelle_data():
    """Récupère les données cadastrales depuis Géoportail"""
    try:
        lat_str = request.args.get('lat')
        lng_str = request.args.get('lng')

        if not lat_str or not lng_str:
            return jsonify({'error': 'Les paramètres latitude et longitude sont requis'}), 400

        lat = float(lat_str)
        lng = float(lng_str)
        zoom = 19

        tile_x, tile_y, pixel_i, pixel_j = wgs84_to_tile_coords(lat, lng, zoom)

        url = (
            f"https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetFeatureInfo"
            f"&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&TILEMATRIXSET=PM&FORMAT=image/png"
            f"&STYLE=PCI%20vecteur&INFOFORMAT=text/html&TILEMATRIX={zoom}"
            f"&TILECOL={tile_x}&TILEROW={tile_y}&I={pixel_i}&J={pixel_j}"
        )

        response = requests.get(url, timeout=8)
        response.raise_for_status()
        from bs4 import BeautifulSoup  # import différé : bibliothèque lourde, chargée au premier appel
        soup = BeautifulSoup(response.content, 'html.parser')

        # Recherche des données dans le HTML
        popup_div = soup.find('div', class_='geoportail-popup-content')
        if not popup_div:
            return jsonify({}), 200

        data = {}
        paragraphs = popup_div.find_all('p')
        for p in paragraphs:
            text = p.get_text(strip=True)
            if ':' in text:
                key, value = text.split(':', 1)
                key = key.strip()
                value = value.strip()

                if key == "N° parcelle":
                    data['numero'] = value
                elif key == "Feuille":
                    data['feuille'] = value
                elif key == "Section":
                    data['section'] = value
                elif key == "Contenance":
                    # Tolère « 1 234 m² » / « 1234 m2 » : int() direct renvoyait None.
                    chiffres = re.match(r'[\d\s  ]+', value)
                    chiffres = re.sub(r'\D', '', chiffres.group(0)) if chiffres else ''
                    data['surface'] = int(chiffres) if chiffres else None

        if not data:
            return jsonify({}), 200

        return jsonify(data)

    except requests.exceptions.RequestException as e:
        print(f"Erreur lors de l'appel à l'API WMTS: {e}")
        return jsonify({'error': "Erreur lors de la récupération des données de la parcelle"}), 500
    except (ValueError, TypeError) as e:
        print(f"Erreur de conversion des coordonnées: {e}")
        return jsonify({'error': 'Les coordonnées fournies sont invalides'}), 400
    except Exception as e:
        print(f"Une erreur inattendue est survenue: {e}")
        return jsonify({'error': 'Une erreur interne est survenue'}), 500


@main_bp.route('/api/cadastre-proxy/<code_insee>', methods=['GET'])
@csrf.exempt
def cadastre_proxy(code_insee):
    """
    Proxy pour le service WMS cadastre.gouv.fr INSPIRE
    Permet de contourner les restrictions CORS
    """
    try:
        # Récupérer tous les paramètres de la requête
        service = request.args.get('SERVICE', 'WMS')
        version = request.args.get('VERSION', '1.3.0')
        req = request.args.get('REQUEST', 'GetMap')
        format_type = request.args.get('FORMAT', 'image/png')
        transparent = request.args.get('TRANSPARENT', 'true')
        layers = request.args.get('LAYERS', '')
        styles = request.args.get('STYLES', '')
        crs = request.args.get('CRS', 'EPSG:3857')
        bbox = request.args.get('BBOX', '')
        width = request.args.get('WIDTH', '256')
        height = request.args.get('HEIGHT', '256')

        # Validation du code INSEE (5 caractères numériques)
        if not code_insee or not code_insee.isdigit() or len(code_insee) != 5:
            return jsonify({'error': 'Code INSEE invalide'}), 400

        if not bbox:
            print(f"❌ BBOX manquant")
            return jsonify({'error': 'BBOX requis'}), 400

        # Construire l'URL manuellement pour éviter les problèmes d'encodage
        from urllib.parse import quote

        # Encoder uniquement les valeurs, pas les caractères spéciaux WMS
        layers_encoded = quote(layers, safe=':,')
        styles_encoded = quote(styles, safe=':,')

        wms_url = (
            f"https://inspire.cadastre.gouv.fr/scpc/{code_insee}.wms?"
            f"SERVICE={service}&VERSION={version}&REQUEST={req}&"
            f"FORMAT={quote(format_type)}&TRANSPARENT={transparent}&"
            f"LAYERS={layers_encoded}&STYLES={styles_encoded}&"
            f"CRS={crs}&BBOX={bbox}&WIDTH={width}&HEIGHT={height}"
        )

        # Faire la requête au service WMS avec l'URL complète
        response = requests.get(wms_url, timeout=10)

        if response.status_code != 200:
            print(f"❌ Erreur {response.status_code}")
            print(f"Réponse du serveur: {response.text[:500]}")

        response.raise_for_status()

        # Retourner l'image avec les headers CORS appropriés
        return Response(
            response.content,
            mimetype=response.headers.get('Content-Type', 'image/png'),
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Cache-Control': 'public, max-age=3600'
            }
        )

    except requests.exceptions.Timeout:
        print(f"❌ Timeout du service WMS")
        return jsonify({'error': 'Délai d\'attente dépassé pour le service cadastre'}), 504
    except requests.exceptions.RequestException as e:
        print(f"❌ Erreur lors de l'appel au service WMS cadastre: {e}")
        if hasattr(e.response, 'text'):
            print(f"Réponse complète: {e.response.text}")
        return jsonify({'error': 'Erreur lors de la récupération des données cadastrales'}), 500
    except Exception as e:
        print(f"❌ Erreur inattendue dans le proxy cadastre: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Une erreur interne est survenue'}), 500


@main_bp.route('/api/osm-tile-proxy/<int:z>/<int:x>/<int:y>', methods=['GET'])
@csrf.exempt
def osm_tile_proxy(z, x, y):
    """
    Proxy pour les tuiles OpenStreetMap (tile.openstreetmap.fr), utilisé uniquement par
    l'export de plans (voir export_plans_pdf_dxf/utils/MapLayerSwitcher.js). Ces tuiles
    externes ne renvoient pas d'en-têtes CORS : html2canvas ne peut alors ni les lire
    pour convertir la capture en image, ni générer un canvas exportable (canvas
    "tainted"). Même principe que /api/cadastre-proxy ci-dessus, qui résout le même
    problème pour les tuiles cadastre.gouv.fr.
    """
    import random
    subdomain = random.choice(['a', 'b', 'c'])
    tile_url = f"https://{subdomain}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
    try:
        response = requests.get(tile_url, timeout=10)
        response.raise_for_status()
        return Response(
            response.content,
            mimetype=response.headers.get('Content-Type', 'image/png'),
            headers={
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=86400',
            },
        )
    except requests.exceptions.RequestException as e:
        print(f"❌ Erreur proxy tuile OSM ({z}/{x}/{y}): {e}")
        return jsonify({'error': 'Tuile OSM indisponible'}), 502


@main_bp.route('/update_project_creator', methods=['POST'])
@login_required
def update_project_creator():
    """
    Met à jour le nom du créateur d'un projet
    """
    try:
        current_user = g.user
        data = request.get_json(silent=True) or {}
        projet_id = data.get('projet_id')
        creator_name = data.get('creator_name', '').strip()

        if not projet_id:
            return jsonify({
                'success': False,
                'message': 'ID du projet manquant'
            }), 400

        if not creator_name:
            return jsonify({
                'success': False,
                'message': 'Le nom du créateur ne peut pas être vide'
            }), 400

        # Récupérer le projet (vérifier qu'il appartient à l'utilisateur ou admin)
        query = ParametreProjet.query.filter_by(id=projet_id)
        if not current_user.get('is_admin'):
            query = query.filter_by(created_by=current_user['id'])
        projet = query.first()

        if not projet:
            return jsonify({
                'success': False,
                'message': 'Projet non trouvé ou accès non autorisé'
            }), 404

        # Mettre à jour le champ created_by_name avec le nom complet
        projet.created_by_name = creator_name
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Nom du créateur mis à jour avec succès',
            'creator_name': creator_name
        })

    except Exception as e:
        db.session.rollback()
        print(f"❌ Erreur lors de la mise à jour du nom du créateur: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Erreur serveur: {str(e)}'
        }), 500



# ========== SolakVan Home & Newsletter ===========
# @main_bp.route("/", methods=['POST', 'GET'])
# @csrf.exempt
# def index():
#     """Page d'accueil avec formulaire de contact"""
#     form = ContactForm()
#     if request.method == 'POST':
#         if form.validate_on_submit():
#             # Vérification du reCAPTCHA v3
#             recaptcha_response = request.form.get('g-recaptcha-response')
#             verify_url = request.app.config['RECAPTCHA_VERIFY_URL']
#             payload = {
#                 'secret': request.app.config['RECAPTCHA_PRIVATE_KEY'],
#                 'response': recaptcha_response
#             }

#             response = requests.post(verify_url, data=payload)
#             result = response.json()

#             if result['success'] and result['score'] >= 0.5:
#                 try:
#                     from flask import current_app
#                     from app.extensions import mail
#                     import os

#                     msg = Message(
#                         subject='Nouveau message de contact - SolakVan',
#                         recipients=[os.getenv('MAIL_RECIPIENT')],
#                         body=f"""
#                         Nouveau message de contact reçu :

#                         Nom: {form.firstname.data} {form.lastname.data}
#                         Email: {form.email.data}
#                         Message:
#                         {form.message.data}
#                         """
#                     )
#                     mail.send(msg)
#                     flash('Votre message a été envoyé avec succès!', 'success')
#                 except Exception as e:
#                     print(f"Erreur d'envoi d'email: {str(e)}")
#                     flash('Une erreur est survenue lors de l\'envoi du message.', 'error')
#             else:
#                 flash('Erreur de validation reCAPTCHA.', 'error')

#     return render_template("solakvan/home/index.html", form=form)


# @main_bp.route('/concevoir_mon_projet/subscribe', methods=['POST'])
# @csrf.exempt
# def subscribe():
#     """Route pour s'abonner à la newsletter"""
#     email = request.form.get('email')

#     if not email:
#         flash("Veuillez entrer un email valide.", "error")
#         return redirect(url_for('main.index'))

#     # Connexion à SQLite
#     conn = sqlite3.connect("newsletter.db")
#     cursor = conn.cursor()
#     cursor.execute('''
#         CREATE TABLE IF NOT EXISTS subscribers (
#             id INTEGER PRIMARY KEY AUTOINCREMENT,
#             email TEXT UNIQUE NOT NULL
#         )
#     ''')

#     try:
#         cursor.execute("INSERT INTO subscribers (email) VALUES (?)", (email,))
#         conn.commit()

#         # Envoyer un email de confirmation en HTML
#         from app.extensions import mail
#         msg = Message("Bienvenue dans la Newsletter Solakvan !", recipients=[email])
#         msg.html = render_template("/solakvan/home/newsletter_email.html", email=email)
#         mail.send(msg)

#         # Notification à l'admin
#         admin_msg = Message("Nouvel abonnement", recipients=["email@gmail.com"])
#         admin_msg.body = f"Nouvelle inscription à la newsletter : {email}"
#         mail.send(admin_msg)

#         flash("Merci ! Vous êtes maintenant abonné(e) et un email de confirmation a été envoyé.", "success")
#     except sqlite3.IntegrityError:
#         flash("Cet email est déjà inscrit.", "info")
#     except Exception as e:
#         flash(f"Une erreur est survenue : ", "error")

#     conn.close()
#     return redirect(url_for('main.index'))


# ========== Routes Concevoir Mon Projet (anciennement Ombridesign) ===========

@main_bp.route('/concevoir_mon_projet/projet', methods=['GET', 'POST'])
@permission_required('concevoir_mon_projet')
@login_required
def projet():
    """Créer un projet"""
    if request.method == 'POST':
        ID='1'
        fichier="OMBD"+"_"+ID
        TypeOmbrière = request.form["TypeOmbrière"]

        ParamètreProjet=request.form.to_dict()
        ParamètresModele=json.loads(ParamètreProjet['ParamètresModeleDefault'])
        return render_template('concevoir_mon_projet/pages/index.html',)
    else:
        return render_template('concevoir_mon_projet/pages/index.html')


@main_bp.route('/concevoir_mon_projet/projet-ouvert', methods=['GET', 'POST'])
@permission_required('concevoir_mon_projet')
@login_required
def projet_ouvert():
    """Ouvrir un projet"""
    if request.method == 'POST':
        Présentation="graphes"
        ParamètreProjet=request.form.to_dict()
        ParamètresModele=json.loads(ParamètreProjet['ParamètresModele'])
        modeles='Ouvrir projet'

        return render_template('concevoir_mon_projet/pages/index.html',)
    else:
        return render_template('concevoir_mon_projet/pages/index.html')


@main_bp.route('/concevoir_mon_projet/projet-supprime', methods=['GET', 'POST'])
def projet_supprime():
    """Supprimer un projet"""
    if request.method == 'POST':
        ID='1'
        Projet= request.form['projet']
        Fichier=Projet+'_'+ID
        return redirect(url_for('main.index'))
    else:
        return render_template('concevoir_mon_projet/index.html')


@main_bp.route('/concevoir_mon_projet/menu')
def menu():
    """Menu principal"""
    return render_template('concevoir_mon_projet/components/menu.html')


@main_bp.route('/concevoir_mon_projet/parametres-projet')
@permission_required('concevoir_mon_projet')
@login_required
def parametres_projet():
    """Paramètres du projet"""
    return render_template('concevoir_mon_projet/menu/parametres_projet.html')


@main_bp.route('/concevoir_mon_projet/formule')
@permission_required('concevoir_mon_projet')
@login_required
def formule():
    """API formule"""
    projets = "Merde"
    return jsonify({
        "success": True,
        "projets": projets
    })


@main_bp.route('/api/parametre', methods=['GET'])
@permission_required('concevoir_mon_projet')
@login_required
def get_test_projects():
    """
    Génère et renvoie des données de projets de test au format JSON.
    Cette route est utilisée pour tester l'affichage des projets dans le tableau.
    """
    projets = [
        {
            "id": 1,
            "nom": "Projet Solaire pour école",
            "adresse": "24 Rue de la Liberté, Port-au-Prince",
            "date_edition": "2025-08-01",
            "auteur": "Jean Dupont",
            "statut": "En cours"
        },
        {
            "id": 2,
            "nom": "Projet de Rénovation Éolienne",
            "adresse": "10 Route Nationale 1, Cap-Haïtien",
            "date_edition": "2025-07-25",
            "auteur": "Marie Paul",
            "statut": "Terminé"
        },
        {
            "id": 3,
            "nom": "Projet Hydraulique Rurale",
            "adresse": "Village de Marigot, Jacmel",
            "date_edition": "2025-06-15",
            "auteur": "Alex Pierre",
            "statut": "Annulé"
        },
        {
            "id": 4,
            "nom": "Installation de panneaux photovoltaïques",
            "adresse": "Delmas 33, Port-au-Prince",
            "date_edition": "2025-05-10",
            "auteur": "Pierre Louis",
            "statut": "En cours"
        },
        {
            "id": 5,
            "nom": "Extension du réseau électrique",
            "adresse": "Pétion-Ville, Ouest",
            "date_edition": "2025-04-01",
            "auteur": "Sophie Martin",
            "statut": "En attente"
        }
    ]

    return jsonify({
        "success": True,
        "projets": projets
    })


@main_bp.route('/concevoir_mon_projet/fichier')
def fichier():
    """Page fichier"""
    return render_template('concevoir_mon_projet/menu/fichier.html')


@main_bp.route('/concevoir_mon_projet/systeme')
@active_project_required
def systeme():
    """Page système"""
    return render_template(
        'concevoir_mon_projet/pages/systeme.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/export')
@active_project_required
def exporter():
    """Page export"""
    return render_template(
        'concevoir_mon_projet/pages/export.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/geometrie')
@active_project_required
def geometrie():
    """Page géométrie"""
    return render_template(
        'concevoir_mon_projet/pages/geometrie.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/autoconsommation')
@active_project_required
def autoconsommation():
    """Page autoconsommation"""
    return render_template(
        'concevoir_mon_projet/pages/autoconsommation.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/etude_economique')
@active_project_required
def etude_economique():
    """Page étude économique"""
    return render_template(
        'concevoir_mon_projet/pages/etude_economique.html',
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/calculateur_APER')
@permission_required('concevoir_mon_projet')
@login_required
def calculateur_aper():
    """Page Calculateur APER"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    google_maps_key = os.getenv('GOOGLE_MAP_KEY', '')
    return render_template(
        'concevoir_mon_projet/pages/calculateur_APER.html',
        google_maps_key=google_maps_key,
        active_projet_typologie=_compute_active_projet_typologie()
    )


@main_bp.route('/concevoir_mon_projet/systeme-electrique')
@permission_required('concevoir_mon_projet')
@login_required
def systeme_electrique():
    """Page de dimensionnement électrique (système)"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/systeme_elec.html')



@main_bp.route('/concevoir_mon_projet/modal/<modal_name>')
@permission_required('concevoir_mon_projet')
@login_required
@active_project_required
def render_modal(modal_name):
    """
    Route pour servir les fichiers modals HTML
    """
    # Sécuriser le nom du fichier pour éviter les attaques de type path traversal
    modal_name = secure_filename(modal_name)

    # Ajouter l'extension .html si elle n'est pas présente
    if not modal_name.endswith('.html'):
        modal_name += '.html'

    # Rendre le template depuis le dossier templates/concevoir_mon_projet/menu/modele/modal/
    try:
        return render_template(f'concevoir_mon_projet/menu/modele/modal/{modal_name}')
    except Exception as e:
        return f"Erreur lors du chargement du modal: {str(e)}", 404


@main_bp.route('/concevoir_mon_projet/api/etude-economique', methods=['POST'])
@permission_required('concevoir_mon_projet')
@login_required
def api_etude_economique():
    """
    API pour le calcul de l'étude économique côté backend.
    """
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({"success": False, "message": "Données JSON manquantes."}), 400
        # Projet transmis : puissance, productible et taux d'autoconsommation doivent être ceux du
        # calcul ProSolaire enregistré (cf. app/services/resultats_prodsolaire.py), sinon refus.
        projet_id = data.pop('projetId', None)
        if projet_id is not None:
            from app.routes.concevoir_mon_projet import _get_project_with_permission
            from app.services import resultats_prodsolaire
            try:
                projet = _get_project_with_permission(int(projet_id), g.user)
            except (TypeError, ValueError):
                projet = None
            if not projet:
                return jsonify({"success": False, "message": "Projet introuvable ou accès non autorisé."}), 404
            ecarts = resultats_prodsolaire.verifier_saisies_eco(
                resultats_prodsolaire.reference_eco(projet.id),
                {'puissance': data.get('puissance'), 'productible': data.get('productible'),
                 'taux_autoconsommation': data.get('tauxAuto'), 'consommation_energie_site': data.get('consoSite'),
                 'taux_de_couverture_PV': data.get('tauxCouv'), 'type_systeme': data.get('typeSys')},
                champs=('puissance', 'productible', 'taux_autoconsommation', 'consommation_energie_site',
                        'taux_de_couverture_PV'))
            if ecarts:
                return jsonify({"success": False, "message": " ".join(ecarts), "ecarts": ecarts}), 409
            # Vieillissement de la batterie : celui du stockage enregistré, jamais celui du client.
            reference = resultats_prodsolaire.reference_eco(projet.id) or {}
            data['stockage'] = reference.get('stockage_vieillissement') if data.get('typeSys') != 'hybride' else None
        from app.models.etude_economique import EtudeEconomiqueService  # import différé : bibliothèque lourde, chargée au premier appel
        result = EtudeEconomiqueService.run_simulation(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@main_bp.route('/concevoir_mon_projet/sauvegarde', methods=['GET', 'POST'])
def sauvegarder():
    """Sauvegarder un projet"""
    if request.method == 'POST':
        ID='1'
        ParamètresModele=(request.form['SGParamètresModele'])
        ParamètresProjet=(request.form['SGParamètresProjet'])

        try:
            A=1+1
            try:
                if (request.form['SGParamètresVérification'])=="": ParamètresVérification=""
                else:
                    ParamètresVérification=json.loads(request.form['SGParamètresVérification'])
                    if 'ParamètresModele' in ParamètresVérification: del(ParamètresVérification['ParamètresModele'])
                    ParamètresVérification=str(ParamètresVérification)
                RésultatsVérification=(request.form['SGRésultatsVérification'])

                Projet=request.form['SGprojet']
                NomFichier=Projet+'_'+ID


                if fichier:
                    fichier.ParamètresProjet = ParamètresProjet
                    fichier.ParamètresModele = ParamètresModele
                    fichier.ParamètresVérification = ParamètresVérification
                    fichier.RésultatsVérification = RésultatsVérification
                    fichier.registered_on =datetime.datetime.now()

                    message="Modifications sauvegardées."

                else:
                    message="Projet sauvegardé."
                Category="succes"
            except:
                message="Erreur de sauvegarde."
                Category="error"
        except:
            message="Échec. Veuillez vérifier les paramètres!"
            Category="error"

        if request.form["Action"]=="Sauvegarde":
            flash(message, Category)
            return redirect(request.referrer)
        else:
            fichier="OMBD"+"_"+ID

            fichier="OMBD"+"_"+ID
            route='app/static/concevoir_mon_projet/graphes/'+fichier
            files=['_calepinage.png', '_coupe.png', '_Toiture.png', '_CoupeTransversaleBardage.png', '_facade.png', '_implantation.png', '_EmplacementParkings.png', '_empannage.png']

            for file in files:
                try:
                    if os.path.isfile(str(route+file)):
                        os.remove(str(route+file))
                except: None

            route_plans='app/static/concevoir_mon_projet/plans/'+fichier
            plans=['_calepinage.png', '_coupe.png', '_Toiture.png', '_PlanMasse.png', '_PlanMasseToiture.png', '_CoupeTransversaleBardage.png', '_facade.png', '_facadeNord.png', '_facadeOuest.png', '_facadeEst.png', '_implantation.png', '_empannage.png', '_EmplacementParkings.png', '_ZonePression.png']
            for plan in plans:
                try:
                    if os.path.isfile(str(route_plans+plan)):
                        os.remove(str(route_plans+plan))
                except: None

            try:
                if os.path.isfile(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.docx')):
                    os.remove(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.docx'))
            except:None
            try:
                if os.path.isfile(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.pdf')):
                    os.remove(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.pdf'))
            except:None

            return redirect(url_for('main.index'))


@main_bp.route('/concevoir_mon_projet/modele', methods=['GET', 'POST'])
@permission_required('concevoir_mon_projet')
@login_required
def modele():
    """Page modèle"""
    if request.method == 'POST':
        ID='1'
        Présentation="graphes"
        ParamètresModele=request.form.to_dict()
        modeles=request.form['submit']
        return render_template('concevoir_mon_projet/pages/index.html',)
    else:
        return render_template('concevoir_mon_projet/pages/index.html')


@main_bp.route('/concevoir_mon_projet/modele_plus', methods=['GET', 'POST'])
@permission_required('concevoir_mon_projet')
@login_required
def modele_plus():
    """Page modèle plus"""
    if request.method == 'POST':
        ID='1'
        Présentation="graphes"
        ParamètresModele=request.form.to_dict()
        modeles=request.form['submit']
        return render_template('concevoir_mon_projet/pages/index.html',)
    else:
        return render_template('concevoir_mon_projet/pages/index.html')


@main_bp.route('/concevoir_mon_projet/verification', methods=['GET', 'POST'])
def verification():
    """Page vérification"""
    if request.method =='POST':
        ID='1'
        ParamètresModele=json.loads(request.form['ParamètresModele'])
        ParamètresVérification=request.form.to_dict()

        return render_template('concevoir_mon_projet/menu/verification.html',)
    else:
        return render_template('concevoir_mon_projet/menu/verification.html')


@main_bp.route('/concevoir_mon_projet/emplacement')
def emplacement():
    """Page emplacement"""
    return render_template('concevoir_mon_projet/menu/emplacement.html')


@main_bp.route('/concevoir_mon_projet/export-rapport', methods=['GET', 'POST'])
def export():
    """Export rapport"""
    ID='1'
    fichier="OMBD_"+ID

    if request.method == 'POST' and request.args.get("Export")=='Rapport':

        #PARAMETRES IMPRESSION
        format=request.form['format']
        papier=request.form['papier']
        orientation=request.form['OrientationFeuille']
        exports=request.form.getlist('exports')
        PlanMasseEchelle = 1/ float(request.form['PlanMasseEchelle'])

        #PARAMETRES
        ParamètresProjet=json.loads(request.form['ParamètresProjet'])
        ParamètresModele=json.loads(request.form['ParamètresModele'])
        if 'PlanMasseMassifs' in exports or 'PlanMasseToiture' in exports:
            ParamètresPlanMasse=json.loads(request.form['ParamètresPlanMasse'])
            ParamètresPlanMasse['PlanMasseEchelle']=PlanMasseEchelle
        else:
            ParamètresPlanMasse=""

        if 'noteCalcul' in exports: ParamètresVérification=json.loads(request.form['ParamètresVérification'])
        else: ParamètresVérification=""
        # secure_filename() empêche toute traversée de chemin ('../', séparateurs) : fichier vient
        # directement du JSON client et sert ensuite à construire des chemins send_file/os.path plus bas.
        fichier=secure_filename(ParamètresModele['fichier'])

        try:
            LogoEntreprise=request.files['LogoEntreprise']
            secure_filename(LogoEntreprise.filename)
        except: LogoEntreprise='N/A'

        Présentation="plans"

        if format=='docx':
            path='static/concevoir_mon_projet/rapport/'+fichier+'.docx'
            return  send_file(path, as_attachment=True, download_name='Rapport.docx')
        elif format=='pdf':
            path='static/concevoir_mon_projet/rapport/'+fichier+'.pdf'
            with current_app.open_resource(path) as f:
                return send_file(pdf_pour_utilisateur(f.read()), as_attachment=True,
                                 download_name='Rapport.pdf', mimetype='application/pdf')
        message="Rapport généré avec succès!"
        Category="succes"

        return render_template('concevoir_mon_projet/menu/export.html')

    #EXPORT PLANS AUTOCAD EN DWG OU DXF
    elif request.method == 'POST':

        if os.path.isfile(str('app/static/concevoir_mon_projet/plansDXF/'+fichier+'_Plans.dxf')):
            try:
                os.remove(str('app/static/concevoir_mon_projet/plansDXF/'+fichier+'_Plans.dxf'))
            except:None
        ParamètresModele=request.form.to_dict()
        format=request.form['format']

        ParamètresModele=json.loads(request.form['ParamètresModeleDXF'])

        try:
            path='static/concevoir_mon_projet/plansDXF/'+fichier+'_Plans.dxf'
            return send_file(path, as_attachment=True, download_name='plans.dxf')
        except:None
        return render_template('concevoir_mon_projet/menu/export.html')
    else:
        return render_template('concevoir_mon_projet/menu/export.html')


@main_bp.route('/concevoir_mon_projet/terminer')
def terminer():
    """Terminer et nettoyer"""
    ID='1'
    fichier="OMBD"+"_"+ID
    route='app/static/concevoir_mon_projet/graphes/'+fichier
    files=['_calepinage.png', '_coupe.png', '_Toiture.png', '_CoupeTransversaleBardage.png', '_facade.png', '_implantation.png', '_EmplacementParkings.png', '_empannage.png']

    for file in files:
        try:
            if os.path.isfile(str(route+file)):
                os.remove(str(route+file))
        except: None

    route_plans='app/static/concevoir_mon_projet/plans/'+fichier
    plans=['_calepinage.png', '_coupe.png', '_Toiture.png', '_PlanMasse.png', '_PlanMasseToiture.png', '_CoupeTransversaleBardage.png', '_facade.png', '_facadeNord.png', '_facadeOuest.png', '_facadeEst.png', '_implantation.png', '_empannage.png', '_EmplacementParkings.png', '_ZonePression.png']
    for plan in plans:
        try:
            if os.path.isfile(str(route_plans+plan)):
                os.remove(str(route_plans+plan))
        except: None

    try:
        if os.path.isfile(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.docx')):
            os.remove(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.docx'))
    except:None
    try:
        if os.path.isfile(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.pdf')):
            os.remove(str('app/static/concevoir_mon_projet/rapport/'+fichier+'.pdf'))
    except:None
    return redirect(url_for('main.index'))


@main_bp.route('/tutoriels/<filename>')
@login_required
def serve_tutoriels(filename):
    """Route simplifiée pour servir les PDFs de tutoriels."""
    if filename not in ['tutoriel.pdf', 'versions.pdf']:
        return "Fichier non autorisé", 403
    
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_dir = os.path.join(app_dir, 'static', 'concevoir_mon_projet', 'docs', 'tuto_version')
    
    if not os.path.exists(os.path.join(target_dir, filename)):
        return "Fichier introuvable", 404
        
    return send_from_directory(target_dir, filename, mimetype='application/pdf')



# ==========================================
# ROUTES import fichier excel)
# ==========================================

        

@main_bp.route('/concevoir_mon_projet/docs/modeles/<filename>')
@login_required
def serve_modeles(filename):
    """Route pour servir les fichiers modèles (Excel, etc.)."""
    # Sécurité : ne servir que les fichiers autorisés
    allowed_files = ['Modele_de_CdC.xlsx']
    if filename not in allowed_files:
        return "Fichier non autorisé", 403
    
    # Correction : Utiliser la même méthode de construction de chemin que pour les tutoriels
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    directory = os.path.join(app_dir, 'static', 'concevoir_mon_projet', 'docs', 'modeles')
    return send_from_directory(directory, filename, as_attachment=True)


# ==========================================
# ROUTES Liste de matériels (déplacé depuis concevoir_mon_projet.py pour corriger le préfixe d'URL)
# ==========================================




# ==========================================
# ROUTES Liste de matériels (déplacé depuis concevoir_mon_projet.py pour corriger le préfixe d'URL)
# ==========================================

@main_bp.route('/api/liste-materiels/calculate', methods=['POST'])
def calculate():
    """API de calcul pour la liste de matériels."""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    # Logique de calcul exportée dans le fichier dédié
    result = logic_calcul_liste_de_materiels(data)
    return jsonify(result)


@main_bp.route('/api/generate-pdf', methods=['POST'])
def generate_pdf():
    """API de génération de PDF pour la liste de matériels."""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données JSON manquantes ou invalides"}), 400
    



    # --- VÉRIFICATION SÉCURITÉ CHIFFRAGE (TOLÉRANCE DE 0.05 €) ---
    items = data.get('items', [])
    total_ht_front_raw = data.get('total_ht_front')
    try:
        total_ht_front = float(total_ht_front_raw) if total_ht_front_raw is not None else 0.0
    except (ValueError, TypeError):
        total_ht_front = 0.0

    total_ht_back = calculer_total_ht(items)
    delta = abs(total_ht_front - total_ht_back)

    # Si le frontend n'a rien envoyé (ou explicitement 0.0) alors qu'il y a du montant, le Backend prend le relais
    if total_ht_front_raw is None or (total_ht_front == 0.0 and total_ht_back > 0):
        print(f"\n⚠️ SÉCURITÉ PDF: Le Frontend n'a pas envoyé le total! Le Backend prend le relais: {total_ht_back:.2f} €\n")
    elif delta > 0.10:
        print(f"\n❌ SÉCURITÉ PDF: Écart détecté! Front a envoyé: {total_ht_front:.2f} €, Backend a calculé: {total_ht_back:.2f} €\n")
        return jsonify({
            "error": "Chiffrage non conforme",
            "details": f"Écart détecté. Front: {total_ht_front:.2f} €, Back: {total_ht_back:.2f} €"
        }), 422
    # -------------------------------------------------------------
    

    from app.models.rapport_liste_de_materiels import generate_pdf_report as generate_materiels_pdf_report  # import différé : bibliothèque lourde, chargée au premier appel
    pdf_buffer = pdf_pour_utilisateur(generate_materiels_pdf_report(data))
    return send_file(
        pdf_buffer,
        as_attachment=True,
        download_name=f"Liste_Materiel_{data.get('nom_projet', 'DEBONO')}.pdf",
        mimetype='application/pdf'
    )

# ==========================================
# ROUTES codes calcul autoconsommation Individuelle
# ==========================================


@main_bp.route('/calcul', methods=['POST'])
@csrf.exempt
@login_required
def calcul():
    """Dimensionnement complet du pompage solaire, côté serveur.

    N'est PLUS le chemin utilisé par l'interface : depuis l'intégration du pompage solaire dans la
    modale de consommation, le dimensionnement est fait dans le navigateur
    (Irve/pompage_solaire/pompage_solaire_calculs.js), qui ne demande au serveur que l'irradiation
    (cf. /api/pompage_solaire/irradiation ci-dessous). `process_simulation` reste l'IMPLÉMENTATION
    DE RÉFÉRENCE : le portage JS en est un miroir exact, et
    tests/pompage_solaire/test_parite_pompage.py compare les deux sur un jeu de cas. Toute
    évolution d'une formule doit être faite des DEUX côtés, le test de parité le vérifie.

    (Cette route était jusqu'ici cassée : `process_simulation` n'était importé nulle part dans ce
    module, tout appel levait donc NameError.)
    """
    data = request.get_json(silent=True) or {}
    erreur = _valider_pompage_solaire(data)
    if erreur:
        return jsonify({'error': erreur}), 400
    result = process_simulation(data)
    return jsonify(result)


def _valider_pompage_solaire(data):
    """Valide les saisies du pompage solaire (bornes de la spec, cf. pompage_solaire_schemas.py).
    Renvoie None si tout est valide, sinon un message lisible (1re erreur), comme calculer_autonomie."""
    try:
        PompageSolaireRequest.model_validate(data)
        return None
    except pydantic.ValidationError as e:
        premiere = e.errors()[0] if e.errors() else None
        if not premiere:
            return str(e)
        champ = '.'.join(str(p) for p in premiere['loc'])
        message = premiere['msg'].replace('Value error, ', '')
        return f"Champ '{champ}' invalide : {message}" if champ else message


@main_bp.route('/api/pompage_solaire/irradiation', methods=['POST'])
@main_bp.route('/concevoir_mon_projet/api/pompage_solaire/irradiation', methods=['POST'])
@csrf.exempt
@login_required
def pompage_solaire_irradiation():
    """Irradiation journalière moyenne par mois (12 valeurs, kWh/m²/jour) pour un site.

    Seul appel serveur du pompage solaire : les données solaires viennent de PVGIS via le modèle
    Python existant (`get_pvgis_daily_irradiation`, mémoïsé par lru_cache), tout le
    dimensionnement se fait ensuite dans le navigateur. `using_fallback` signale un profil de
    secours, pour que l'interface le dise au lieu d'afficher des chiffres muets.
    """
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Latitude et longitude requises'}), 400

    # Toutes les saisies du formulaire accompagnent la demande : elles sont validées ici (bornes de
    # la spec, miroir de la validation du front) avant tout appel à PVGIS.
    erreur = _valider_pompage_solaire(data)
    if erreur:
        return jsonify({'error': erreur, 'validation': True}), 400

    angle = float(data.get('angle'))
    aspect = float(data.get('aspect'))
    loss = float(data.get('perte_systeme'))

    daily = get_pvgis_daily_irradiation(lat, lon, angle, aspect, loss)
    if not daily:
        # Même profil de secours que process_simulation : les deux chemins doivent rendre les mêmes
        # chiffres quand PVGIS est injoignable.
        return jsonify({
            'daily_irradiation': [5.1, 5.5, 6.0, 6.2, 5.8, 5.2, 4.8, 4.5, 4.9, 5.3, 5.2, 5.0],
            'using_fallback': True,
        })
    return jsonify({'daily_irradiation': daily, 'using_fallback': False})


@main_bp.route('/api/pompage_solaire/plan_affaires', methods=['POST'])
@main_bp.route('/concevoir_mon_projet/api/pompage_solaire/plan_affaires', methods=['POST'])
@csrf.exempt
@login_required
def pompage_solaire_plan_affaires():
    """Plan d'affaires du pompage solaire (vente d'eau au litre) : SOURCE DE VÉRITÉ.

    Le navigateur affiche d'abord son propre calcul (PompageSolaireCalculs.planAffaires), puis
    soumet les mêmes saisies ici ; en cas d'écart, ce résultat (numpy-financial) remplace le sien.
    """
    data = request.get_json(silent=True) or {}
    try:
        params = PlanAffairesRequest.model_validate(data)
    except pydantic.ValidationError as e:
        premiere = e.errors()[0] if e.errors() else None
        if not premiere:
            return jsonify({'error': str(e)}), 400
        champ = '.'.join(str(p) for p in premiere['loc'])
        message = premiere['msg'].replace('Value error, ', '')
        return jsonify({'error': f"Champ '{champ}' invalide : {message}" if champ else message}), 400
    return jsonify(plan_affaires(params.model_dump()))
