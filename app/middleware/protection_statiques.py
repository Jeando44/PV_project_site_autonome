"""
Code JavaScript et données JSON : réservés aux utilisateurs connectés.
=====================================================================

Constat (audit anti-aspiration, novembre 2026) : les ~190 000 lignes de JavaScript de l'application
— calculs de rentabilité, d'autoconsommation, de pompage, de PAC, données d'équipements — étaient
téléchargeables par n'importe quel script (curl, wget, aspirateur de site), sans compte ni licence.

Le cookie de session est limité au chemin /concevoir_mon_projet (cf. middleware/prefix_alias.py) :
le navigateur ne l'envoie PAS aux adresses /static/concevoir_mon_projet/... Les scripts et données
sont donc servis sous /concevoir_mon_projet/static/... (route concevoir_static_fallback, déjà
couverte par la réécriture Firebase /concevoir_mon_projet/**), où le cookie arrive :
  - url_for('static', filename='…js|json') produit cette adresse (cf. _url_for_code_sous_prefixe) ;
  - les adresses écrites en dur dans les gabarits et les import() JavaScript l'utilisent (lot D).
Les scripts chargés par chemin relatif (import './x.js', currentScript.src) suivent d'eux-mêmes.

Un fichier .js, .mjs, .json ou .map n'est alors servi qu'à une session ouverte. Sinon : 404, sans
confirmer l'existence du fichier (curl, wget, requests, aspirateurs, moteurs de recherche, onglet
ouvert sur l'adresse d'un script sans être connecté).

Les fichiers sont aussi marqués « Cache-Control: private » : un cache partagé (CDN de Firebase
Hosting) ne doit pas les redistribuer, sinon il servirait le fichier sans repasser par ce contrôle.
Les CSS, images, polices et documents restent publics (page d'erreur, partages, e-mails).

Réglage PROTECTION_STATIQUES :
  - session (défaut)  : session obligatoire ;
  - actif             : solution d'attente du lot B, sans session : fichier servi si le navigateur
                        déclare le charger pour une page du site (Sec-Fetch-Site same-origin /
                        same-site, ou, navigateur ancien, Referer du site). Repli en cas d'incident ;
  - observation       : journalise ce que « session » refuserait, sans bloquer ;
  - off               : aucun contrôle (les adresses restent sous /concevoir_mon_projet/static/).
"""
import os
from urllib.parse import urlparse

from flask import request, session, url_for

EXTENSIONS_PROTEGEES = ('.js', '.mjs', '.json', '.map')
ENDPOINTS_STATIQUES = ('static', 'concevoir_static_fallback')
ENDPOINT_SOUS_PREFIXE = 'concevoir_static_fallback'
SITES_AUTORISES = ('same-origin', 'same-site')


def _fichier_protege():
    return (request.endpoint in ENDPOINTS_STATIQUES
            and request.path.lower().endswith(EXTENSIONS_PROTEGEES))


def _url_for_code_sous_prefixe(endpoint, **values):
    """url_for des gabarits : les scripts et données passent sous /concevoir_mon_projet/static/."""
    if endpoint == 'static' and str(values.get('filename', '')).lower().endswith(EXTENSIONS_PROTEGEES):
        endpoint = ENDPOINT_SOUS_PREFIXE
    return url_for(endpoint, **values)


def _demande_d_une_page_du_site():
    site = request.headers.get('Sec-Fetch-Site')
    if site is not None:
        return site in SITES_AUTORISES
    referer = request.headers.get('Referer')
    return bool(referer) and urlparse(referer).netloc == request.host


def demande_legitime(mode='session'):
    """Vrai si le fichier peut être servi : session ouverte (ou, en mode « actif », page du site)."""
    if session.get('user'):
        return True
    return mode == 'actif' and _demande_d_une_page_du_site()


def init_app(app):
    """
    À appeler AVANT l'enregistrement de cache_statiques_versionnes (app/__init__.py) : les fonctions
    after_request s'exécutent dans l'ordre inverse de leur enregistrement, et « private » doit être
    posé après que cette fonction a mis les fichiers versionnés en cache « public ».
    """
    # Adresses sous préfixe dans tous les modes : elles fonctionnent avec ou sans contrôle.
    app.jinja_env.globals['url_for'] = _url_for_code_sous_prefixe

    mode = os.getenv('PROTECTION_STATIQUES', 'session').lower()
    if mode == 'off':
        return

    @app.before_request
    def refuser_telechargement_direct():
        if not _fichier_protege() or demande_legitime(mode):
            return None
        app.logger.warning('[statiques] %s sans session (Sec-Fetch-Site=%s, UA=%s)%s',
                           request.path, request.headers.get('Sec-Fetch-Site', '-'),
                           request.headers.get('User-Agent', '-')[:120],
                           ' — observation, non bloqué' if mode == 'observation' else '')
        if mode == 'observation':
            return None
        return 'Not Found', 404

    @app.after_request
    def cache_prive_pour_le_code(response):
        if _fichier_protege() and response.status_code in (200, 304):
            response.cache_control.public = False
            response.cache_control.private = True
        return response
