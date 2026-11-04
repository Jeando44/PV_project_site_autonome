"""
Factory Flask pour l'application
Point d'entrée principal avec pattern Factory
"""
from flask import Flask, session, render_template, request, g, jsonify, send_from_directory
from dotenv import load_dotenv
import os
import sqlite3
from sqlalchemy import event
from sqlalchemy.engine import Engine
import pymysql
from urllib.parse import quote_plus

from config import config
from app.extensions import db, csrf, mail, migrate, cors

# Les blueprints, les middlewares et les services sont importés DANS create_app(), pas ici.
# Tout import d'un sous-module (`from app.models.x import ...`, `from app.cli import ...`) exécute
# d'abord ce fichier : des imports en tête chargeaient donc toute l'application — pvlib, pandas,
# fpdf, ezdxf, ~6 s — y compris pour `flask preparer-base`, qui n'a besoin que des modèles
# (cf. creer_app_preparation_base ci-dessous).


# Initialisation du driver PyMySQL (nécessaire pour SQLAlchemy)
pymysql.install_as_MySQLdb()

# Gestion win32api pour Windows
import sys
if sys.platform == "win32":
    try:
        import win32api
    except Exception:
        win32api = None

# Activer les contraintes de clés étrangères pour SQLite
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Active les contraintes FK pour SQLite"""
    if isinstance(dbapi_conn, sqlite3.Connection):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def _charger_environnement(config_name):
    """Charge le .env local s'il existe et renvoie le nom de configuration à utiliser."""
    if os.path.exists('.env'):
        load_dotenv()
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'production')
    return config_name


def _configurer_base_de_donnees(app, config_name):
    """
    Configuration et connexion à la base, PARTAGÉES par l'application complète (create_app) et
    par l'application réduite de préparation du schéma (creer_app_preparation_base) : les deux
    doivent viser exactement la même base.
    """
    # On utilise .get() pour éviter le KeyError
    config_obj = config.get(config_name, config.get('production'))
    app.config.from_object(config_obj)

    # --- Configuration Base de données (Production Réseau Privé & Local) ---
    db_user = os.getenv('DB_USER')
    db_pass = os.getenv('DB_PASS')
    db_name = os.getenv('DB_NAME')
    db_host = os.getenv('DB_HOST')

    # Surcharge explicite de l'URI (DATABASE_URL) : prioritaire sur tout le reste. Permet de
    # pointer une base de recette, de rejouer `flask preparer-base` sur une base vierge pour
    # vérifier qu'elle se reconstruit intégralement, ou de basculer de moteur sans toucher au code.
    uri_explicite = os.getenv('DATABASE_URL')

    if uri_explicite:
        app.config['SQLALCHEMY_DATABASE_URI'] = uri_explicite
    elif db_user and db_pass and db_name and db_host:
        # Encodage du mot de passe pour protéger et rendre lisible les caractères spéciaux (!, @, #, etc.)
        db_pass_encoded = quote_plus(db_pass)

        # Deux façons de joindre Cloud SQL, choisies d'après la forme de DB_HOST :
        #  - nom de connexion d'instance « projet:region:instance » (ou chemin /cloudsql/...) :
        #    socket Unix monté par Cloud Run (connexion Cloud SQL ajoutée au service), comme
        #    Solakvan_Projet — aucun VPC nécessaire ;
        #  - adresse IP / nom d'hôte : TCP standard (IP privée via Direct VPC Egress).
        if db_host.startswith('/cloudsql/') or db_host.count(':') == 2:
            socket_cloudsql = db_host if db_host.startswith('/cloudsql/') else f"/cloudsql/{db_host}"
            app.config['SQLALCHEMY_DATABASE_URI'] = (
                f"mysql+pymysql://{db_user}:{db_pass_encoded}@/{db_name}"
                f"?unix_socket={socket_cloudsql}&charset=utf8mb4"
            )
        else:
            app.config['SQLALCHEMY_DATABASE_URI'] = (
                f"mysql+pymysql://{db_user}:{db_pass_encoded}@{db_host}/{db_name}?charset=utf8mb4"
            )

        # Correctif de sécurité réseau Cloud SQL (Évite les coupures de connexion)
        # pool_size/max_overflow explicites (au lieu des défauts SQLAlchemy 5/10) : avec
        # --threads 8 par instance gunicorn, un pool_size de 5 forçait systématiquement au
        # moins 3 requêtes concurrentes à passer par l'overflow. Ajustables sans toucher au
        # code via DB_POOL_SIZE / DB_POOL_MAX_OVERFLOW selon le palier Cloud SQL réel.
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
            'pool_recycle': 1800,  # Recycler les connexions toutes les 30 minutes
            'pool_pre_ping': True,  # Vérifier si la connexion est vivante avant d'envoyer une requête
            'pool_size': int(os.getenv('DB_POOL_SIZE', 10)),
            'max_overflow': int(os.getenv('DB_POOL_MAX_OVERFLOW', 5)),
        }
    else:
        # Configuration pour le développement local (Fallback)
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///concevoir_mon_projet.db'

    db.init_app(app)
    migrate.init_app(app, db)


def creer_app_preparation_base(config_name=None):
    """
    Application RÉDUITE, utilisée uniquement par `flask preparer-base` (cf. preparation_base.py et
    entrypoint.sh) : configuration, base, migrations et modèles — aucune route, aucun middleware.

    POURQUOI : entrypoint.sh prépare le schéma avant de lancer gunicorn, à chaque démarrage à froid.
    Avec l'application complète, l'import de toutes les routes (pvlib, pandas, fpdf, ezdxf...) était
    payé deux fois : une fois ici, une fois par gunicorn. Les modèles seuls se chargent en ~1 s.
    """
    config_name = _charger_environnement(config_name)
    app = Flask(__name__)
    _configurer_base_de_donnees(app, config_name)

    # Tous les modèles doivent être déclarés, sinon create_all() ne créerait pas leurs tables.
    from app.models import importer_tous_les_modeles
    importer_tous_les_modeles()

    from app.cli import register_cli
    register_cli(app)
    return app


def create_app(config_name=None):
    """
    Factory Flask - Crée et configure l'application
    """
    from app.middleware.auth_middleware import SSOAuth, SSOConfig
    from app.middleware.error_handler import register_error_handlers
    from app.middleware.security_headers import register_security_headers
    from app.services.decalage_parcelles_acces import acces_decalage_parcelles

    # 1. Chargement de l'environnement (Local vs Cloud Run)
    config_name = _charger_environnement(config_name)

    # ========== Vérifications initiales ==========
    required_env_vars = [
        'FLASK_SECRET_KEY',
        'RECAPTCHA_PUBLIC_KEY',
        'RECAPTCHA_PRIVATE_KEY',
        'RECAPTCHA_VERIFY_URL',
        'MAIL_USERNAME',
        'MAIL_PASSWORD',
        'MAIL_DEFAULT_SENDER'
    ]

    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    if missing_vars:
        print(f"CRITICAL: Variables manquantes dans Cloud Run: {', '.join(missing_vars)}")

    # ========== Création de l'application ==========
    app = Flask(__name__)

    # Dit à Flask de faire confiance aux en-têtes de Google Cloud / Firebase (force le HTTPS et le bon hôte pour les assets)
    from werkzeug.middleware.proxy_fix import ProxyFix
    from app.middleware.prefix_alias import PrefixAliasMiddleware
    app.wsgi_app = ProxyFix(PrefixAliasMiddleware(app.wsgi_app, app),
                            x_for=1, x_proto=1, x_host=1, x_prefix=1)

    # ========== Configuration (dont la base, cf. _configurer_base_de_donnees) ==========
    _configurer_base_de_donnees(app, config_name)

    app.config['WTF_CSRF_ENABLED'] = False

    # Configuration depuis les variables d'environnement
    app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')
    app.config['RECAPTCHA_PUBLIC_KEY'] = os.getenv('RECAPTCHA_PUBLIC_KEY')
    app.config['RECAPTCHA_PRIVATE_KEY'] = os.getenv('RECAPTCHA_PRIVATE_KEY')
    app.config['RECAPTCHA_VERIFY_URL'] = os.getenv('RECAPTCHA_VERIFY_URL')

    # Configuration email
    app.config['MAIL_SERVER'] = 'smtp.gmail.com'
    app.config['MAIL_PORT'] = 587
    app.config['MAIL_USE_TLS'] = True
    app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
    app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
    app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_DEFAULT_SENDER')

    # Secret key pour la session — aucun repli : une valeur par défaut publique signerait les
    # sessions de façon prévisible et permettrait de les falsifier.
    flask_secret_key = os.getenv('FLASK_SECRET_KEY')
    if not flask_secret_key:
        raise RuntimeError(
            "FLASK_SECRET_KEY manquant — démarrage refusé. "
            "Définissez cette variable d'environnement avant de lancer l'application."
        )
    app.secret_key = flask_secret_key

    # Cookie de session : SameSite=Lax / HttpOnly / Secure sont posés par le middleware SSO
    # (app/middleware/auth_middleware.py::SSOAuth.init_app, exécuté plus bas) — un seul endroit de
    # configuration, pour éviter deux réglages contradictoires. C'est ce « SameSite=Lax » qui empêche
    # déjà un site tiers de déclencher une action authentifiée par POST/PUT/DELETE.

    # ========== Initialisation des extensions ==========
    csrf.init_app(app)

    # ========== Anti-CSRF : vérification de l'origine, côté serveur ==========
    # Deuxième barrière derrière le « SameSite=Lax » du cookie de session, et surtout : elle ne
    # demande AUCUNE modification du code applicatif — ni jeton dans les 123 appels `fetch`, ni champ
    # caché dans les formulaires, ni retrait des 20 `@csrf.exempt` déjà posés. Le principe, recommandé
    # par l'OWASP : un navigateur envoie toujours un en-tête `Origin` sur une requête mutante
    # déclenchée depuis un autre site. Si cette origine n'est pas la nôtre, la requête ne peut pas
    # venir de l'application : on la rejette avant même de toucher à la session.
    #
    # Ce qui n'est volontairement PAS rejeté :
    #  - les méthodes de lecture (GET, HEAD, OPTIONS), qui ne modifient rien ;
    #  - les requêtes sans `Origin` ni `Referer` : ce sont des appels serveur-à-serveur (webhook
    #    Switchgrid, supervision, curl). Une attaque CSRF passe forcément par un navigateur, et un
    #    navigateur envoie toujours l'en-tête — l'absence d'origine n'est donc pas un vecteur ;
    #  - l'application principale (MAIN_APP_URL), d'où arrive l'utilisateur authentifié.
    #
    # Réglages : PROTECTION_ORIGINE=observation journalise sans bloquer (déploiement prudent),
    # PROTECTION_ORIGINE=off désactive. ORIGINES_AUTORISEES ajoute des domaines, séparés par des
    # virgules, si un jour un autre site doit poster vers l'application.
    mode_origine = os.getenv('PROTECTION_ORIGINE', 'actif').lower()
    if mode_origine != 'off':
        from urllib.parse import urlparse

        hotes_autorises = set()
        for url_confiance in ([os.getenv('MAIN_APP_URL', 'https://solakvan.com')]
                              + os.getenv('ORIGINES_AUTORISEES', '').split(',')):
            url_confiance = (url_confiance or '').strip()
            if url_confiance:
                hotes_autorises.add(urlparse(url_confiance).netloc or url_confiance)

        @app.before_request
        def verifier_origine_requete():
            if request.method in ('GET', 'HEAD', 'OPTIONS'):
                return None
            origine = request.headers.get('Origin') or request.headers.get('Referer')
            if not origine:
                return None
            hote_appelant = urlparse(origine).netloc
            if hote_appelant == request.host or hote_appelant in hotes_autorises:
                return None
            app.logger.warning(
                '[origine] %s %s — appelée depuis %s (attendu : %s)%s',
                request.method, request.path, hote_appelant or origine, request.host,
                ' — observation, non bloquée' if mode_origine == 'observation' else '',
            )
            if mode_origine == 'observation':
                return None
            return jsonify({'error': "Requête refusée : origine non autorisée."}), 403

    # db et migrate : déjà initialisés par _configurer_base_de_donnees.
    mail.init_app(app)
    # ========== CORS : fermé par défaut ==========
    # Aucune API externe n'appelle cette application : tout le JavaScript est servi par le même
    # domaine, et l'entrée SSO se fait par une navigation (GET ?sso_token=…), jamais par une requête
    # cross-origin. Les services tiers (PVGIS, Enedis, Géoportail) sont appelés DEPUIS le serveur :
    # ils ne mettent pas CORS en jeu.
    # L'ancien `cors.init_app(app, supports_credentials=True)` renvoyait l'origine de l'appelant avec
    # `Allow-Credentials: true` : n'importe quel site pouvait LIRE les réponses authentifiées d'un
    # utilisateur connecté. CORS n'est donc activé que si des origines sont explicitement déclarées
    # dans CORS_ORIGINS. Les deux proxys d'images (cadastre, tuiles) posent leurs propres en-têtes.
    origines_cors = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
    if origines_cors:
        cors.init_app(app, origins=origines_cors, supports_credentials=True)
    else:
        cors.init_app(
            app,
            origins=sorted(SSOConfig.allowed_origins()),
            supports_credentials=True
        )

    # ✅ Import de TOUS les modèles (Switchgrid compris) AVANT db.create_all() : les routes, qui les
    # importaient par effet de bord, ne sont plus chargées qu'en fin de create_app().
    from app.models import importer_tous_les_modeles
    importer_tous_les_modeles()

    # ========== Schéma de base de données ==========
    # `db.create_all()` N'EST PLUS appelé ici. Il l'était à chaque démarrage de worker gunicorn, y
    # compris en production, et c'est la cause des échecs de déploiement :
    #   - il ne sait pas ajouter une COLONNE à une table existante (d'où les ALTER TABLE manuels) ;
    #   - il s'exécute avant que la connexion Cloud SQL soit garantie établie : un démarrage lent
    #     fait échouer le conteneur, donc le déploiement ;
    #   - plusieurs instances démarrant en parallèle émettent des CREATE TABLE concurrents.
    # La préparation du schéma est désormais une ÉTAPE EXPLICITE ET UNIQUE, hors du chemin de
    # démarrage : `flask preparer-base` (cf. app/cli.py), lancée par entrypoint.sh avant gunicorn.
    #
    # Repli de confort pour le développement local uniquement : sans base SQLite existante, on crée
    # les tables au premier lancement pour ne pas imposer une commande supplémentaire. Jamais en
    # production (dès que DB_HOST est défini), et désactivable par AUTO_CREATE_DB=0.
    if not os.getenv('DB_HOST') and os.getenv('AUTO_CREATE_DB', '1') != '0':
        with app.app_context():
            db.create_all()

    from app.cli import register_cli
    register_cli(app)
    # ========== Initialisation du middleware d'authentification ==========
    sso_auth = SSOAuth(app)
    register_error_handlers(app)
    register_security_headers(app)
    # Anti-aspiration (audit de novembre 2026) : plus de téléchargement direct du code JS/JSON par
    # un robot, et limites de requêtes. Avant cache_statiques_versionnes, cf. protection_statiques.init_app.
    from app.middleware import protection_statiques, limites_requetes
    protection_statiques.init_app(app)
    limites_requetes.init_app(app)
    # Verrou optimiste des données d'un projet (deux onglets / deux postes), cf. le module.
    from app.services.version_projet import init_app as init_version_projet
    init_version_projet(app)

    # ========== Context processors ==========
    # Filtre Jinja `adresse_affichee` : texte lisible de `adresse_projet`, stocké en JSON
    # ({adresse, latitude, longitude, adresse_complete...}, parfois sérialisé plusieurs fois). Renvoie
    # le champ `adresse` (adresse courte) ; valeur brute si ce n'est pas du JSON.
    @app.template_filter('adresse_affichee')
    def adresse_affichee(valeur):
        import json as _json
        courant = valeur
        for _ in range(3):
            if not isinstance(courant, str):
                break
            try:
                courant = _json.loads(courant)
            except (ValueError, TypeError):
                break
        if isinstance(courant, dict):
            texte = courant.get('adresse')
            if isinstance(texte, str) and texte.strip().startswith('{'):
                return adresse_affichee(texte)
            return texte or ''
        return courant if isinstance(courant, str) else (valeur or '')

    @app.context_processor
    def inject_user():
        from app.services.mention_essai import mention_essai_active, MENTION_ESSAI_TEXTE
        """Injecte les données utilisateur dans tous les templates"""
        # NOUVEAU : is_materiels_admin pilote l'affichage du bouton d'administration des matériels
        # (menu.html) — même règle que app/routes/admin_materiels.py::materiels_admin_required, qui
        # revérifie indépendamment côté serveur (un oubli d'affichage ici ne donnerait jamais accès).
        user_email = (session.get('user') or {}).get('email')
        is_materiels_admin = bool(
            app.config.get('MATERIELS_ADMIN_ENABLED')
            and user_email
            and user_email.strip().lower() in app.config.get('MATERIELS_ADMIN_EMAILS', [])
        )
        tolerance_pct = float(app.config.get('LICENCE_POWER_TOLERANCE_PERCENT', 10.0))
        licence_pv = session.get('licence_pv')
        max_kwc = licence_pv.get('max_kwc') if licence_pv else None
        max_kwc_allowed = round(float(max_kwc) * (1.0 + tolerance_pct / 100.0), 2) if max_kwc is not None else None

        return {
            'current_user': session.get('user'),
            'permissions': session.get('permissions', []),
            'licence_pv': licence_pv,
            'licence_power_tolerance_percent': tolerance_pct,
            'licence_max_kwc_allowed': max_kwc_allowed,
            'is_authenticated': 'user' in session,
            'is_materiels_admin': is_materiels_admin,
            # Champ solaire depuis le cadastre : réglé dans config.py (DECALAGE_PARCELLES_*), même
            # règle que la sauvegarde du calepinage (cf. app/services/decalage_parcelles_acces.py).
            'decalage_parcelles_autorise': acces_decalage_parcelles(app.config, session.get('user')),
            # Mention « période d'essai » des documents générés (permission Solakvan
            # mention_periode_essai, jamais pour un admin) : lue par le partiel
            # components/mention_essai.html, cf. app/services/mention_essai.py.
            'mention_essai_active': mention_essai_active(),
            'mention_essai_texte': MENTION_ESSAI_TEXTE,
        }

    # ========== Hooks de requête ==========
    @app.before_request
    def block_direct_access():
        
        if request.blueprint == 'switchgrid_webhooks':
            return None
        
        public_routes = ('health', 'static', 'favicon')
        public_paths = [
            '/concevoir_mon_projet/shared/',
            '/webhooks/switchgrid/',
            '/api/export_pdf',
            '/api/export_dxf',
            '/concevoir_mon_projet/api/internal/',
            '/concevoir_mon_projet/concevoir_mon_projet/api/internal/',
            '/api/internal/',
            '/favicon.ico',
            '/concevoir_mon_projet/favicon.ico',
            '/concevoir_mon_projet/static/',
            '/health'
        ]

        is_public_endpoint = request.endpoint and any(request.endpoint.startswith(r) for r in public_routes)
        is_public_path = any(request.path.startswith(path) for path in public_paths)

        if not session.get('user') and not is_public_endpoint and not is_public_path:
            app.logger.warning(f"[401] Accès non authentifié tenté sur {request.path}")

            if request.path.startswith('/api/'):
                return jsonify({'error': 'Authentification requise'}), 401

            return render_template(
                'base/error.html',
                error_code=401,
                error_title="Connexion requise",
                error_icon="fa-user-lock",
                error_message="Vous devez être connecté pour accéder à cette application.",
                actions=[
                    {
                        "text": "Se connecter",
                        "url": f"{SSOConfig.MAIN_APP_URL}/authentification/login",
                        "class": "btn-primary"
                    },
                    {
                        "text": "Retour à l'accueil Solakvan",
                        "url": SSOConfig.MAIN_APP_URL,
                        "class": "btn-secondary"
                    }
                ],
                main_app_url=SSOConfig.MAIN_APP_URL
            ), 401

    @app.after_request
    def cache_statiques_versionnes(response):
        """Fichiers statiques appelés avec ?v=N : gardés en cache navigateur (cf. config.py,
        STATIC_VERSIONNE_MAX_AGE) au lieu d'être revalidés auprès du serveur à chaque chargement."""
        max_age = app.config.get('STATIC_VERSIONNE_MAX_AGE', 0)
        if (max_age and 'v' in request.args and response.status_code in (200, 304)
                and request.endpoint in ('static', 'concevoir_static_fallback')):
            response.cache_control.public = True
            response.cache_control.no_cache = None
            response.cache_control.max_age = max_age
        return response

    # ========== Enregistrement des blueprints ==========
    from app.routes.main import main_bp
    from app.routes.main_prodsolaire import prodsolaire_bp
    from app.routes.concevoir_mon_projet import concevoir_mon_projet_bp
    from app.routes.__init__ import graph_modal_bp
    from app.routes.main_calcul_consommation import consommation_bp
    from app.routes.irve_verification import irve_verification_bp
    from app.routes.pac_verification import pac_verification_bp
    from app.routes.onduleur_hors_reseau import onduleur_hors_reseau_bp
    from app.routes.main_dxf import dxf_bp
    from app.routes.orthophoto import orthophoto_bp
    from app.routes.main_pdf import pdf_bp
    from app.routes.admin_materiels import admin_materiels_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(prodsolaire_bp)
    app.register_blueprint(concevoir_mon_projet_bp)
    app.register_blueprint(graph_modal_bp)
    app.register_blueprint(consommation_bp)
    app.register_blueprint(irve_verification_bp)
    app.register_blueprint(pac_verification_bp)
    app.register_blueprint(onduleur_hors_reseau_bp)
    app.register_blueprint(dxf_bp)
    app.register_blueprint(orthophoto_bp)
    app.register_blueprint(pdf_bp)
    app.register_blueprint(admin_materiels_bp)

    from app.routes.switchgrid_routes import switchgrid_bp
    app.register_blueprint(switchgrid_bp)

    from app.routes.dp_routes import dp_bp
    app.register_blueprint(dp_bp)

    from app.routes.petit_champ_solaire_routes import petit_champ_bp
    app.register_blueprint(petit_champ_bp)

    from app.routes.loi_aper_routes import loi_aper_bp
    app.register_blueprint(loi_aper_bp)

    from app.routes.ombrieres_dossier_routes import ombrieres_dossier_bp
    app.register_blueprint(ombrieres_dossier_bp)

    from app.routes.dossier_plans_routes import dossier_plans_bp
    app.register_blueprint(dossier_plans_bp)

    from app.routes.terrain_routes import terrain_bp
    app.register_blueprint(terrain_bp)

    from app.routes.switchgrid_webhooks import switchgrid_webhooks_bp
    app.register_blueprint(switchgrid_webhooks_bp)

    # Blueprint debug : uniquement en mode DEBUG, jamais en production
    if app.config.get('DEBUG'):
        from app.routes.switchgrid_debug import switchgrid_debug_bp
        app.register_blueprint(switchgrid_debug_bp)

    # Route de secours pour servir les fichiers statiques si appelés avec le préfixe /concevoir_mon_projet/static/
    @app.route('/concevoir_mon_projet/static/<path:filename>')
    def concevoir_static_fallback(filename):
        return send_from_directory(app.static_folder, filename)

    return app