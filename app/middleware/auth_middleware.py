"""
Middleware d'authentification pour les applications externes (Google Cloud)
À utiliser dans vos calculateurs et l'application projet
"""
import jwt
import requests
from functools import wraps
from flask import request, jsonify, session, redirect, render_template, url_for, g
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
import logging
import os
from dotenv import load_dotenv


logger = logging.getLogger(__name__)
load_dotenv()


def _to_aware(dt_or_str):
    """Convertit un string ISO ou un datetime en datetime timezone-aware (UTC)."""
    dt = datetime.fromisoformat(dt_or_str) if isinstance(dt_or_str, str) else dt_or_str
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _origin_of(url):
    """Retourne 'schéma://hôte[:port]' d'une URL, ou None si elle est vide/invalide."""
    if not url:
        return None
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


class SSOConfig:
    MAIN_APP_URL = os.getenv('MAIN_APP_URL', 'https://solakvan.com')
    SECRET_KEY = os.getenv('FLASK_SECRET_KEY')
    APP_NAME = os.getenv('APP_NAME')
    REQUIRED_PERMISSION = os.getenv('REQUIRED_PERMISSION')
    # Autres clés external_apps de Solakvan qui ouvrent CETTE application (virgules) : le bouton
    # « Concevoir mon projet résidentiel » a sa propre ligne (concevoir_mon_projet_residentiel)
    # pointée sur /concevoir_mon_projet/residentiel/ du même service. Son jeton porte cette audience ;
    # la session la mémorise et la revalidation la renvoie à Solakvan comme app_key.
    AUDIENCES_SUPPLEMENTAIRES = [a.strip() for a in os.getenv('SSO_AUDIENCES_SUPPLEMENTAIRES', '').split(',') if a.strip()]
    SESSION_LIFETIME = int(os.getenv('SESSION_LIFETIME', 8))
    INACTIVITY_TIMEOUT = int(os.getenv('INACTIVITY_TIMEOUT_MINUTES', 20))  # minutes

    # Clé de signature des tokens SSO. Distincte de SECRET_KEY (qui signe les cookies de
    # session de CETTE application) : partagée avec Solakvan_V7, elle ne doit pas permettre
    # de forger des sessions ici, ni l'inverse.
    JWT_SECRET = os.getenv('SSO_JWT_SECRET') or SECRET_KEY

    # Revalidation périodique du token auprès de l'application principale : c'est ce qui
    # fait redescendre le blocage d'un compte, le retrait d'une permission, l'expiration
    # d'une licence et la déconnexion. Sans elle, la session vivait 8 h sans contrôle.
    REVALIDATION_INTERVAL = int(os.getenv('SSO_REVALIDATION_MINUTES', 5))       # minutes
    # Tolérance si l'application principale est injoignable (panne réseau) : on continue
    # d'accepter la session pendant ce délai, puis on ferme. Empêche qu'une coupure de
    # Solakvan_V7 déconnecte tout le monde, sans pour autant rendre la révocation
    # contournable par déni de service.
    REVALIDATION_GRACE = int(os.getenv('SSO_REVALIDATION_GRACE_MINUTES', 15))   # minutes

    # Cookie de session en HTTPS uniquement. Sûr par défaut : il faut poser explicitement
    # SESSION_COOKIE_INSECURE=true pour le désactiver (développement local en HTTP).
    COOKIE_SECURE = os.getenv('SESSION_COOKIE_INSECURE', '').lower() != 'true'

    # Chemins authentifiés par un token de service (et non par un cookie de session).
    SERVICE_API_PREFIXES = (
        '/concevoir_mon_projet/api/internal/',
        '/concevoir_mon_projet/concevoir_mon_projet/api/internal/',
        '/api/internal/',
    )

    @classmethod
    def allowed_origins(cls):
        """Origines autorisées à émettre des requêtes navigateur vers cette application."""
        origins = {_origin_of(cls.MAIN_APP_URL)}
        for extra in os.getenv('CORS_ALLOWED_ORIGINS', '').split(','):
            origins.add(_origin_of(extra.strip()))
        return {o for o in origins if o}


class SSOAuth:
    """Classe pour gérer l'authentification SSO"""

    def __init__(self, app=None):
        self.config = SSOConfig()
        if app:
            self.init_app(app)

    def init_app(self, app):
        """Initialise le middleware avec l'application Flask"""
        app.config['SECRET_KEY'] = self.config.SECRET_KEY
        # Firebase Hosting exige OBLIGATOIREMENT le nom '__session' (tous les autres cookies sont supprimés par le CDN).
        # On restreint le Path à '/concevoir_mon_projet' pour NE PAS écraser le cookie '__session' de Solakvan_Projet (racine '/').
        app.config['SESSION_COOKIE_NAME'] = os.getenv('SESSION_COOKIE_NAME', '__session')
        app.config['SESSION_COOKIE_PATH'] = os.getenv('SESSION_COOKIE_PATH', '/concevoir_mon_projet')
        app.config['SESSION_COOKIE_HTTPONLY'] = True
        app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
        app.config['SESSION_COOKIE_SECURE'] = self.config.COOKIE_SECURE

        if not self.config.COOKIE_SECURE:
            logger.warning(
                "SESSION_COOKIE_INSECURE=true : le cookie de session part sans le flag "
                "Secure. Acceptable en HTTP local uniquement, jamais en production."
            )

        if not os.getenv('SSO_JWT_SECRET'):
            logger.error(
                "SSO_JWT_SECRET absent : repli sur FLASK_SECRET_KEY. La clé de session de "
                "cette application est alors la même que celle qui signe les tokens SSO — "
                "à corriger avant la production."
            )

        # Contrôle d'origine (anti-CSRF) : enregistré avant le contrôle d'authentification
        # pour rejeter une requête forgée sans même toucher à la session.
        @app.before_request
        def check_request_origin():
            return self.check_origin()

        # Middleware pour vérifier l'authentification sur toutes les routes
        @app.before_request
        def check_authentication():
            return self.check_auth()

    # ------------------------------------------------------------------ #
    # Protection CSRF par vérification d'origine
    # ------------------------------------------------------------------ #
    def check_origin(self):
        """Rejette les requêtes de modification provenant d'une origine tierce.

        Défense CSRF par en-têtes standard (OWASP « Verifying Origin With Standard
        Headers ») : les navigateurs envoient obligatoirement `Origin` sur toute requête
        POST/PUT/PATCH/DELETE, y compris same-origin, et un site tiers ne peut pas le
        falsifier. Retenu plutôt que les jetons Flask-WTF parce qu'il protège les ~30
        appels `fetch()` du frontend sans avoir à les modifier un par un.
        """
        if request.method in ('GET', 'HEAD', 'OPTIONS', 'TRACE'):
            return None

        # Endpoints authentifiés par token (webhook signé par son chemin secret, API
        # interne authentifiée par JWT) : pas de cookie en jeu, donc pas de risque CSRF.
        if request.blueprint == 'switchgrid_webhooks':
            return None
        if any(request.path.startswith(p) for p in self.config.SERVICE_API_PREFIXES):
            return None

        origin = request.headers.get('Origin')
        if not origin:
            referer = request.headers.get('Referer')
            origin = _origin_of(referer) if referer else None

        if not origin:
            logger.warning(f"[CSRF] {request.method} {request.path} sans Origin ni Referer")
            return jsonify({
                'success': False,
                'error': 'origin_missing',
                'message': "Requête refusée : en-tête Origin absent."
            }), 403

        allowed = self.config.allowed_origins() | {_origin_of(request.host_url)}
        if origin not in allowed:
            logger.warning(f"[CSRF] Origine refusée pour {request.method} {request.path} : {origin}")
            return jsonify({
                'success': False,
                'error': 'origin_rejected',
                'message': "Requête refusée : origine non autorisée."
            }), 403

        return None

    # ------------------------------------------------------------------ #
    # Tokens
    # ------------------------------------------------------------------ #
    def decode_token(self, token):
        """Décode et valide un token JWT SSO destiné à CETTE application.

        L'audience (`aud`) doit correspondre à APP_NAME ou à une clé de
        SSO_AUDIENCES_SUPPLEMENTAIRES : un token émis pour un autre outil de l'écosystème ne peut
        donc pas être rejoué ici.
        """
        try:
            return jwt.decode(
                token,
                self.config.JWT_SECRET,
                algorithms=['HS256'],
                audience=[self.config.APP_NAME] + self.config.AUDIENCES_SUPPLEMENTAIRES,
                issuer='solakvan'
            )
        except jwt.ExpiredSignatureError:
            logger.warning("Token expiré")
            return None
        except jwt.InvalidAudienceError:
            logger.warning("Token refusé : émis pour une autre application")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Token invalide: {e}")
            return None

    def cle_application(self, payload=None):
        """Clé external_apps du jeton (APP_NAME ou une audience supplémentaire)."""
        aud = (payload or {}).get('aud') if payload else session.get('sso_app_key')
        if isinstance(aud, list):
            aud = next((a for a in aud if a in [self.config.APP_NAME] + self.config.AUDIENCES_SUPPLEMENTAIRES), None)
        return aud or self.config.APP_NAME

    def verify_token_with_main_app(self, token, app_key=None):
        """Vérifie le token auprès de l'application principale.

        Retourne un tuple (statut, données) où statut vaut :
          - 'ok'          : token valide, `données` contient user/permissions/licence_pv
          - 'invalid'     : token refusé (expiré, révoqué, compte bloqué, permission retirée)
          - 'unreachable' : application principale injoignable (réseau, timeout, 5xx)

        La distinction est essentielle : un refus doit fermer la session, une panne réseau
        ne doit pas déconnecter tout le monde (voir REVALIDATION_GRACE).
        """
        verify_url = f"{self.config.MAIN_APP_URL}/sso/verify"

        try:
            response = requests.post(
                verify_url,
                json={'token': token, 'app_key': app_key or self.cle_application()},
                timeout=10
            )
        except requests.exceptions.ConnectionError as e:
            logger.error(f"✗ Connexion impossible à {verify_url}: {e}")
            return 'unreachable', None
        except requests.exceptions.Timeout:
            logger.error(f"✗ Timeout après 10 s sur {verify_url}")
            return 'unreachable', None
        except Exception as e:
            logger.error(f"✗ Erreur inattendue lors de la vérification du token: {e}")
            return 'unreachable', None

        if response.status_code == 200:
            try:
                data = response.json()
            except ValueError:
                logger.error("✗ Réponse non-JSON de l'application principale")
                return 'unreachable', None

            if data.get('success'):
                logger.info(f"✓ Token vérifié pour : {data.get('user', {}).get('email')}")
                return 'ok', data

            logger.warning(f"✗ Vérification refusée : {data.get('error')}")
            return 'invalid', data

        if response.status_code in (401, 403, 404):
            # Token invalide/révoqué, permission retirée, compte bloqué, app inconnue :
            # autant de refus explicites qui doivent fermer la session.
            logger.warning(f"✗ Token refusé par l'application principale ({response.status_code})")
            return 'invalid', None

        logger.error(f"✗ Code de statut inattendu depuis {verify_url} : {response.status_code}")
        return 'unreachable', None

    # ------------------------------------------------------------------ #
    # Contrôle d'accès
    # ------------------------------------------------------------------ #
    def check_auth(self):
        """Vérifie l'authentification et bloque si nécessaire"""

        if request.blueprint == 'switchgrid_webhooks':
            return None

        public_routes = [
            '/static',
            '/health',
            '/favicon.ico',
            '/concevoir_mon_projet/favicon.ico',
            '/concevoir_mon_projet/static/',
            '/concevoir_mon_projet/shared/',
            '/webhooks/switchgrid/'
        ]
        if any(request.path.startswith(route) for route in public_routes):
            return None

        # ✅ Vérifie la session existante
        user = session.get('user')
        token = session.get('token')
        if user and token:
            expires_at = session.get('expires_at')
            if expires_at:
                try:
                    now = datetime.now(timezone.utc)
                    session_encore_valide = now < _to_aware(expires_at)
                except Exception:
                    session_encore_valide = False

                if session_encore_valide:
                    # Vérification de l'inactivité (20 min par défaut)
                    last_activity_str = session.get('last_activity')
                    if last_activity_str:
                        inactif_depuis = (now - _to_aware(last_activity_str)).total_seconds() / 60
                        if inactif_depuis > self.config.INACTIVITY_TIMEOUT:
                            logger.info(
                                f"Session expirée par inactivité ({inactif_depuis:.1f} min) "
                                f"pour {user.get('email', 'inconnu')}"
                            )
                            session.clear()
                            return self.session_closed_response(
                                "Session expirée",
                                "Votre session a expiré après 20 minutes d'inactivité.",
                                icon="fa-clock"
                            )

                    # Revalidation périodique auprès de l'application principale
                    revocation = self.revalidate_if_needed(now)
                    if revocation is not None:
                        return revocation

                    # Session valide — mettre à jour last_activity
                    session['last_activity'] = now.isoformat()
                    g.user = session.get('user')
                    g.permissions = session.get('permissions', [])
                    g.is_admin = g.user.get('is_admin', False) if isinstance(g.user, dict) else False
                    return None

            # Session expirée (durée absolue dépassée)
            logger.info("Session expirée (durée maximale), nettoyage")
            session.clear()

        # ✅ Vérifie le token dans l'URL
        sso_token = request.args.get('sso_token')
        if sso_token:
            logger.info("Token SSO détecté dans l'URL")
            return self.handle_sso_login(sso_token)

        # ✅ Vérifie le token Bearer (uniquement pour les API de service à service)
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            return self.handle_api_auth(auth_header.split(' ', 1)[1])

        # 🚫 Si aucune session ou token, bloquer ici
        logger.warning(f"[SSO] Accès refusé à {request.path} : pas de session ni token")
        if self._is_api_request():
            return jsonify({
                'error': "Connexion requise : votre session est absente ou expirée. Merci de vous reconnecter.",
                'code': 'session_missing',
                'redirect': self.config.MAIN_APP_URL + '/authentification/login'
            }), 401
        return render_template('base/error.html',
                    error_code=302,
                    error_title="Connexion requise",
                    error_icon="fa-user-lock",
                    error_message="Veuillez vous connecter pour accéder à cette application.",
                    actions=[
                        {"text": "Se connecter", "url": f"{self.config.MAIN_APP_URL}/authentification/login", "class": "btn-primary"},
                        {"text": "Retour à l’accueil", "url": self.config.MAIN_APP_URL, "class": "btn-secondary"}
                    ],
                    main_app_url=self.config.MAIN_APP_URL
                ), 302

    def revalidate_if_needed(self, now):
        """Revalide périodiquement la session auprès de l'application principale.

        Retourne None si la session peut continuer, ou une réponse d'erreur si elle a été
        fermée. Rafraîchit au passage les permissions et les quotas de licence, qui ne
        sont donc plus figés à l'instant de la connexion.
        """
        last_verified = session.get('last_verified')

        if last_verified:
            try:
                age_minutes = (now - _to_aware(last_verified)).total_seconds() / 60
            except Exception:
                age_minutes = None
            if age_minutes is not None and age_minutes < self.config.REVALIDATION_INTERVAL:
                return None
        else:
            age_minutes = None

        status, data = self.verify_token_with_main_app(session.get('token'))

        if status == 'ok':
            session['user'] = data.get('user', session.get('user'))
            session['permissions'] = data.get('permissions', [])
            session['licence_pv'] = data.get('licence_pv')
            session['licence_dp'] = data.get('licence_dp')
            session['licence_switchgrid'] = data.get('licence_switchgrid')
            session['licence_acc'] = data.get('licence_acc')
            session['last_verified'] = now.isoformat()
            return None

        if status == 'invalid':
            email = (session.get('user') or {}).get('email', 'inconnu')
            logger.warning(f"Session fermée : token/permission révoqué pour {email}")
            session.clear()
            return self.session_closed_response(
                "Session fermée",
                "Vos droits d'accès ont changé ou votre session a été fermée. "
                "Merci de vous reconnecter.",
                icon="fa-user-lock"
            )

        # 'unreachable' : on tolère la panne pendant REVALIDATION_GRACE
        if age_minutes is not None and age_minutes <= self.config.REVALIDATION_GRACE:
            logger.warning(
                f"Application principale injoignable, session maintenue "
                f"({age_minutes:.1f} min / {self.config.REVALIDATION_GRACE} min de tolérance)"
            )
            return None

        logger.error("Application principale injoignable au-delà du délai de tolérance : session fermée")
        session.clear()
        return self.session_closed_response(
            "Vérification impossible",
            "Impossible de vérifier vos droits auprès de Solakvan. Merci de réessayer.",
            icon="fa-triangle-exclamation"
        )

    @staticmethod
    def _is_api_request():
        """Appel AJAX/API : on répond en JSON (un 302 HTML sans Location est illisible pour fetch)."""
        return request.headers.get('X-Requested-With') == 'XMLHttpRequest' \
            or 'application/json' in request.headers.get('Accept', '') \
            or request.path.startswith(('/api/', '/concevoir_mon_projet/api/'))

    def session_closed_response(self, title, message, icon="fa-user-lock"):
        """Réponse de fermeture de session, en JSON pour les appels AJAX et en HTML sinon."""
        if self._is_api_request():
            return jsonify({
                'error': 'session_expired',
                'message': message,
                'redirect': self.config.MAIN_APP_URL + '/authentification/login'
            }), 401

        return render_template('base/error.html',
            error_code=302,
            error_title=title,
            error_icon=icon,
            error_message=message,
            actions=[
                {"text": "Se reconnecter", "url": f"{self.config.MAIN_APP_URL}/authentification/login", "class": "btn-primary"},
            ],
            main_app_url=self.config.MAIN_APP_URL
        ), 302

    def handle_sso_login(self, token):
        """Gère la connexion SSO avec un token"""
        # Vérifier le token localement (signature, expiration, audience)
        payload = self.decode_token(token)

        if not payload:
            logger.warning("Échec du décodage du token")
            return self.redirect_to_login()

        # Vérifier auprès de l'application principale (permissions, licence, blocage)
        app_key = self.cle_application(payload)
        status, verification = self.verify_token_with_main_app(token, app_key)

        if status != 'ok':
            logger.warning(f"Échec de la vérification du token avec l'app principale ({status})")
            return self.redirect_to_login()

        user_data = verification.get('user', {})
        permissions = verification.get('permissions', [])
        licence_pv = verification.get('licence_pv')

        # Vérifier que l'utilisateur a la permission requise
        if not user_data.get('is_admin') and self.config.REQUIRED_PERMISSION not in permissions:
            logger.warning(f"Permission refusée pour {user_data.get('email')}: {self.config.REQUIRED_PERMISSION} non trouvée")
            return render_template('base/error.html',
                error_code=403,
                error_title="Accès Refusé",
                error_icon="fa-lock",
                error_message=f"Vous n'avez pas la permission requise pour accéder à cette application.",
                error=f"Permission requise: {self.config.REQUIRED_PERMISSION}",
                main_app_url=self.config.MAIN_APP_URL
            ), 403

        # Créer la session
        now = datetime.now(timezone.utc)
        session.clear()  # Nettoyer d'abord
        session['user'] = user_data
        session['token'] = token
        session['sso_app_key'] = app_key
        session['permissions'] = permissions
        session['licence_pv'] = licence_pv
        # Quotas DP / Switch Grid / ACC (cf. app/services/{dp,switchgrid,acc}/quota.py). Les deux
        # premiers avaient été perdus lors de l'intégration licence/SSO (6b613021) : sans eux,
        # DP et Switch Grid étaient refusés à tout utilisateur non admin.
        session['licence_dp'] = verification.get('licence_dp')
        session['licence_switchgrid'] = verification.get('licence_switchgrid')
        session['licence_acc'] = verification.get('licence_acc')
        session['expires_at'] = (now + timedelta(hours=self.config.SESSION_LIFETIME)).isoformat()
        session['last_activity'] = now.isoformat()
        session['last_verified'] = now.isoformat()

        logger.info(f"✓ Connexion SSO réussie pour : {user_data.get('email')}")
        logger.info(f"  Permissions : {permissions}")
        logger.info(f"  Admin : {user_data.get('is_admin')}")

        # Rediriger vers concevoir_mon_projet (ou la page demandée sans le paramètre sso_token)
        # IMPORTANT : Ne PAS rediriger vers '/' car derrière le reverse proxy (https://solakvan.com/concevoir_mon_projet/),
        # '/' renvoie le navigateur vers la page d'accueil de solakvan.com !
        chemin_public = request.environ.get('pv.chemin_public', request.path)
        target_path = chemin_public if chemin_public and chemin_public != '/' else url_for('main.index')
        remaining_args = {k: v for k, v in request.args.items() if k != 'sso_token'}
        if remaining_args:
            from urllib.parse import urlencode
            target_url = f"{target_path}?{urlencode(remaining_args)}"
        else:
            target_url = target_path

        logger.info(f"Redirection post-SSO vers : {target_url}")
        return redirect(target_url)

    def handle_api_auth(self, token):
        """Authentification par token Bearer, réservée aux API de service à service.

        Un token Bearer ne donne PAS accès aux routes applicatives : celles-ci exigent une
        session SSO complète (permission vérifiée, licence chargée). Sans cette
        restriction, tout porteur d'un token valide — quels que soient ses droits —
        franchissait le middleware.
        """
        if not any(request.path.startswith(p) for p in self.config.SERVICE_API_PREFIXES):
            logger.warning(f"[SSO] Token Bearer refusé hors API de service : {request.path}")
            return jsonify({
                'success': False,
                'error': 'Authentification par session requise pour cette ressource'
            }), 401

        payload = self.decode_token(token)

        if not payload:
            return jsonify({
                'success': False,
                'error': 'Token invalide ou expiré'
            }), 401

        g.user = payload
        g.authenticated = True

        return None

    def redirect_to_login(self):
        """Redirige vers la page de connexion de l'application principale"""
        login_url = f"{self.config.MAIN_APP_URL}/authentification/login"
        logger.info(f"Redirection vers : {login_url}")
        return redirect(login_url)

    def get_current_user(self):
        """Retourne l'utilisateur actuellement connecté"""
        return session.get('user')

    def has_permission(self, permission_name):
        """Vérifie si l'utilisateur a une permission"""
        user = session.get('user', {})
        if user.get('is_admin'):
            return True

        permissions = session.get('permissions', [])
        return permission_name in permissions

    def logout(self):
        """Déconnecte l'utilisateur"""
        session.clear()
        logout_url = f"{self.config.MAIN_APP_URL}/authentification/logout"
        logger.info(f"Déconnexion, redirection vers : {logout_url}")
        return redirect(logout_url)


def _wants_json_response():
    """
    Détecte si la requête courante attend une réponse JSON (appel fetch/AJAX vers une
    route de calcul ou d'API) plutôt qu'une page HTML (navigation classique du navigateur).
    Utilisé pour éviter de renvoyer une page d'erreur HTML à un fetch() qui fait
    ensuite response.json() — ce qui provoque un "Unexpected token '<' is not valid JSON".
    """
    return request.path.startswith('/api/') or request.method != 'GET'


def login_required(f):
    """Décorateur pour protéger les routes nécessitant une authentification"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            logger.warning(f"[401] Accès non authentifié à {request.path}")
            main_url = SSOConfig.MAIN_APP_URL
            if _wants_json_response():
                return jsonify({'error': 'Session expirée ou non authentifiée. Veuillez vous reconnecter.'}), 401
            return render_template('base/error.html',
                error_code=401,
                error_title="Authentification requise",
                error_icon="fa-user-lock",
                error_message="Vous devez être connecté pour accéder à cette ressource.",
                actions=[
                    {"text": "Se connecter", "url": f"{main_url}/authentification/login", "class": "btn-primary"},
                    {"text": "Retour à l’accueil", "url": main_url, "class": "btn-secondary"}
                ],
                main_app_url=main_url
            ), 401
        return f(*args, **kwargs)
    return decorated_function


# Permission d'accès à l'application, écrite en dur sur ses routes. Elle suit REQUIRED_PERMISSION :
# l'application PV_project_site_autonome (REQUIRED_PERMISSION=site_autonome) garde les mêmes routes.
PERMISSION_APPLICATION = 'concevoir_mon_projet'


def permission_required(permission_name):
    """Décorateur pour vérifier une permission spécifique"""
    from functools import wraps

    if permission_name == PERMISSION_APPLICATION and SSOConfig.REQUIRED_PERMISSION:
        permission_name = SSOConfig.REQUIRED_PERMISSION

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            main_url = SSOConfig.MAIN_APP_URL
            if 'user' not in session:
                logger.warning(f"[401] Accès refusé à {request.path} : non authentifié")
                return render_template('base/error.html',
                    error_code=401,
                    error_title="Connexion requise",
                    error_icon="fa-user-lock",
                    error_message="Veuillez vous connecter pour accéder à cette application.",
                    actions=[
                        {"text": "Se connecter", "url": f"{main_url}/authentification/login", "class": "btn-primary"},
                        {"text": "Retour à l’accueil", "url": main_url, "class": "btn-secondary"}
                    ],
                    main_app_url=main_url
                ), 401

            user = session.get('user') or {}
            if not isinstance(user, dict):
                logger.error(f"[401] Session malformée sur {request.path}, nettoyage")
                session.clear()
                return render_template('base/error.html',
                    error_code=401,
                    error_title="Session invalide",
                    error_icon="fa-user-lock",
                    error_message="Votre session est invalide. Merci de vous reconnecter.",
                    actions=[
                        {"text": "Se connecter", "url": f"{main_url}/authentification/login", "class": "btn-primary"}
                    ],
                    main_app_url=main_url
                ), 401

            if user.get('is_admin'):
                logger.info(f"Accès autorisé (admin) : {user.get('email')}")
                return f(*args, **kwargs)

            permissions = session.get('permissions', [])
            if permission_name not in permissions:
                logger.warning(f"[403] Permission refusée pour {user.get('email')} → {permission_name}")
                return render_template('base/error.html',
                    error_code=403,
                    error_title="Accès Refusé",
                    error_icon="fa-lock",
                    error_message=f"Vous n’avez pas les permissions nécessaires ({permission_name}).",
                    actions=[
                        {"text": "Retour à l’accueil", "url": main_url, "class": "btn-primary"},
                        {"text": "Contacter Solakvan", "url": "mailto:etudes@solakvan.com", "class": "btn-outline-danger"}
                    ],
                    main_app_url=main_url
                ), 403

            logger.info(f"Accès autorisé ({permission_name}) : {user.get('email')}")
            return f(*args, **kwargs)
        return decorated_function
    return decorator


def get_current_user():
    """Retourne l'utilisateur courant à partir du contexte Flask"""
    return getattr(g, 'user', None)


def active_project_required(f):
    """
    Décorateur pour protéger les routes nécessitant un projet actif sélectionné.

    L'utilisateur doit obligatoirement avoir créé ET sélectionné un projet (cf.
    concevoir_mon_projet.py: creer_parametre_projet / activer_parametre_projet, qui écrivent
    session['active_projet_id']) avant d'accéder aux autres modules (Système, Export, Géométrie,
    Autoconsommation, Étude économique, modales). Sans projet actif en session, redirige vers la
    page de création/sélection de projet plutôt que de laisser la page se charger.
    """
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('active_projet_id'):
            logger.warning(f"[Projet actif requis] Accès refusé à {request.path} : aucun projet actif en session")
            if _wants_json_response():
                return jsonify({
                    'success': False,
                    'error': "Aucun projet actif. Veuillez créer ou sélectionner un projet."
                }), 403
            from app.utils.parcours import url_accueil
            return redirect(url_accueil() + '?no_active_project=1')
        return f(*args, **kwargs)
    return decorated_function



def decode_scoped_token(token):
    """Décode un JWT de service à service émis par Solakvan_V7.

    Utilisé par les routes de service à service (ex: /api/internal/usage) qui reçoivent
    un token de courte durée dont le `sub` est préfixé ('user:<id>' ou 'company:<id>')
    pour porter la portée de la requête dans le token signé lui-même, plutôt que dans un
    paramètre de requête non vérifié. Signé avec la clé SSO et lié à cette application par
    son audience. Retourne le payload décodé, ou None si invalide/expiré.
    """
    try:
        return jwt.decode(
            token,
            SSOConfig.JWT_SECRET,
            algorithms=['HS256'],
            audience=SSOConfig.APP_NAME,
            issuer='solakvan'
        )
    except jwt.PyJWTError as e:
        logger.warning(f"Échec du décodage d'un token de service à service: {type(e).__name__}")
        return None
