"""
Alias `/concevoir_mon_projet/<chemin>` -> `/<chemin>` pour les routes déclarées à la racine.

Le cookie de session `__session` est restreint au Path `/concevoir_mon_projet` (voir
SSOAuth.init_app) pour ne pas écraser celui de Solakvan_Projet. Le navigateur ne l'envoie
donc pas aux routes déclarées à la racine (`/api/switchgrid/...`, `/api/dp/...`, etc.) :
elles tombent sur « pas de session ».

Le frontend appelle ces routes sous `/concevoir_mon_projet/...` (cookie envoyé) et ce
middleware réécrit le chemin vers la route racine, UNIQUEMENT si le chemin préfixé ne
correspond à aucune route existante et que le chemin racine, lui, en trouve une. Les routes
déjà déclarées sous `/concevoir_mon_projet` ne sont donc jamais détournées.

La réécriture a lieu avant Flask : `request.path` vaut le chemin racine, si bien que les
contrôles d'accès (SSOAuth.check_auth, block_direct_access) s'appliquent exactement comme
pour un appel direct à la route racine.
"""
from werkzeug.exceptions import MethodNotAllowed, NotFound
from werkzeug.routing import RequestRedirect

PREFIX = '/concevoir_mon_projet'


class PrefixAliasMiddleware:
    def __init__(self, wsgi_app, flask_app):
        self.wsgi_app = wsgi_app
        self.flask_app = flask_app

    def _route_existe(self, environ, path):
        adapter = self.flask_app.url_map.bind_to_environ(environ)
        try:
            adapter.match(path, method=environ.get('REQUEST_METHOD', 'GET'))
            return True
        except (MethodNotAllowed, RequestRedirect):
            return True
        except NotFound:
            return False

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        if path.startswith(PREFIX + '/'):
            chemin_racine = path[len(PREFIX):]
            if not self._route_existe(environ, path) and self._route_existe(environ, chemin_racine):
                # Chemin public d'origine, pour les redirections (ex. post-SSO) : derrière
                # Firebase Hosting, seul /concevoir_mon_projet/** atteint ce service.
                environ['pv.chemin_public'] = path
                environ['PATH_INFO'] = chemin_racine
        return self.wsgi_app(environ, start_response)
