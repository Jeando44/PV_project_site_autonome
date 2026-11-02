"""
Limites de requêtes (anti-aspiration, anti-force brute).
========================================================

Avant ce module, l'application n'avait AUCUNE limite : un compte valide (ou un lien de partage)
pouvait appeler les API de calcul en boucle et aspirer résultats et données, et le mot de passe d'un
lien de partage protégé pouvait être essayé sans fin.

Règles (fenêtres fixes ; la première règle dépassée renvoie 429 + Retry-After) :

  partage_mdp   POST /shared/<jeton>            20 / 15 min par LIEN (quelle que soit l'adresse IP :
                                                une rotation d'adresses ne contourne donc rien)
  partage       toute requête /shared/...       60 / min et 600 / h par adresse IP
  ecriture      POST/PUT/PATCH/DELETE           120 / min et 2 000 / h par utilisateur
                (calculs, sauvegardes, exports)
  global        toute requête hors statiques    600 / min et 10 000 / h par utilisateur
                                                (adresse IP pour un visiteur anonyme)

Les seuils sont très au-dessus d'un usage humain (600 / min = 10 requêtes par seconde pendant une
minute entière) : ils n'arrêtent que les automates. Exemptés : fichiers statiques (protégés par
protection_statiques.py), /health, favicon, webhooks Switchgrid (appels serveur à serveur).

Compteurs EN MÉMOIRE, propres à chaque instance Cloud Run : avec N instances, un automate peut
au pire obtenir N fois la limite. Pour des compteurs partagés, voir le stockage en base de
Solakvan_Projet (app/utils/limites.py), transposable ici.

Adresse IP : X-Forwarded-For lu depuis la fin (entrées ajoutées par nos propres proxys), comme
dans Solakvan_Projet ; PROXYS_DE_CONFIANCE règle leur nombre (2 : Firebase Hosting + frontal Cloud
Run).

Réglage LIMITES_REQUETES : actif (défaut) | observation (journalise sans bloquer) | off.
"""
import ipaddress
import math
import os
import threading
import time

from flask import jsonify, render_template, request, session

METHODES_ECRITURE = ('POST', 'PUT', 'PATCH', 'DELETE')
PREFIXES_EXEMPTES = ('/health', '/favicon.ico', '/concevoir_mon_projet/favicon.ico', '/webhooks/')
ENDPOINTS_EXEMPTES = ('static', 'concevoir_static_fallback')

# (nom, limite, fenêtre en secondes)
LIMITES = {
    'partage_mdp': [(20, 15 * 60)],
    'partage': [(60, 60), (600, 3600)],
    'ecriture': [(120, 60), (2000, 3600)],
    'global': [(600, 60), (10000, 3600)],
}


# ------------------------------------------------------------------------------------- compteurs

class CompteursMemoire:
    """Compteurs à fenêtre fixe, protégés par un verrou (gunicorn --threads)."""

    INTERVALLE_NETTOYAGE = 300

    def __init__(self):
        self._compteurs = {}
        self._verrou = threading.Lock()
        self._dernier_nettoyage = time.time()

    def incrementer(self, cle, fenetre, maintenant=None):
        """Incrémente le compteur de la fenêtre en cours ; renvoie (valeur, secondes restantes)."""
        maintenant = time.time() if maintenant is None else maintenant
        debut = math.floor(maintenant / fenetre) * fenetre
        fin = debut + fenetre
        with self._verrou:
            if maintenant - self._dernier_nettoyage > self.INTERVALLE_NETTOYAGE:
                self._compteurs = {k: v for k, v in self._compteurs.items() if v[1] > maintenant}
                self._dernier_nettoyage = maintenant
            valeur, expire = self._compteurs.get((cle, fenetre), (0, fin))
            if expire <= maintenant:
                valeur, expire = 0, fin
            valeur += 1
            self._compteurs[(cle, fenetre)] = (valeur, expire)
        return valeur, max(1, int(math.ceil(expire - maintenant)))


# ------------------------------------------------------------------------------------- identité

def _normaliser_ip(texte):
    texte = (texte or '').strip().strip('"')
    if texte.startswith('['):
        texte = texte[1:texte.find(']')] if ']' in texte else texte
    elif texte.count(':') == 1:
        texte = texte.split(':')[0]
    try:
        ip = ipaddress.ip_address(texte)
    except ValueError:
        return None
    if ip.version == 6:
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f'{ip}/64', strict=False))   # un abonné reçoit un /64
    return str(ip)


def adresse_client(x_forwarded_for, adresse_directe, proxys_de_confiance=2):
    """Entrée ajoutée par le premier de nos proxys : la N-ième en partant de la fin."""
    entrees = [e for e in (x_forwarded_for or '').split(',') if e.strip()]
    if entrees and proxys_de_confiance > 0:
        candidate = entrees[-proxys_de_confiance] if len(entrees) >= proxys_de_confiance else entrees[0]
        adresse = _normaliser_ip(candidate)
        if adresse:
            return adresse
    return _normaliser_ip(adresse_directe) or (adresse_directe or 'inconnue')


def _adresse_requete():
    try:
        proxys = max(0, int(os.getenv('PROXYS_DE_CONFIANCE', 2)))
    except ValueError:
        proxys = 2
    # ProxyFix a déjà réécrit REMOTE_ADDR ; l'adresse du dernier saut réel est conservée ici.
    directe = request.environ.get('werkzeug.proxy_fix.orig', {}).get('REMOTE_ADDR') or request.remote_addr
    return adresse_client(request.headers.get('X-Forwarded-For'), directe, proxys)


def _identifiant():
    utilisateur = session.get('user')
    if isinstance(utilisateur, dict) and utilisateur.get('id') is not None:
        return f"u:{utilisateur['id']}"
    return f"ip:{_adresse_requete()}"


def _jeton_partage(chemin):
    """Jeton d'un chemin …/shared/<jeton>[/…] ; None si le chemin n'est pas un lien de partage."""
    morceaux = chemin.split('/shared/', 1)
    if len(morceaux) != 2:
        return None
    return morceaux[1].split('/', 1)[0] or None


def regles_applicables(methode, chemin, identifiant, adresse):
    """Liste (nom de règle, clé de comptage) à appliquer à la requête, de la plus précise à la plus large."""
    regles = []
    jeton = _jeton_partage(chemin)
    if jeton and jeton != 'delete-success':
        if methode == 'POST' and chemin.rstrip('/').endswith(jeton):
            regles.append(('partage_mdp', f'jeton:{jeton}'))
        regles.append(('partage', f'ip:{adresse}'))
    if methode in METHODES_ECRITURE:
        regles.append(('ecriture', identifiant))
    regles.append(('global', identifiant))
    return regles


# ------------------------------------------------------------------------------------- Flask

def _reponse_429(attente):
    message = "Trop de requêtes en peu de temps. Merci de patienter quelques instants avant de réessayer."
    if request.path.startswith(('/api/', '/concevoir_mon_projet/api/')) or request.is_json \
            or 'application/json' in request.headers.get('Accept', ''):
        reponse = jsonify({'error': message, 'code': 'trop_de_requetes', 'retry_after': attente})
    else:
        reponse = render_template('base/error.html', error_code=429, error_title="Trop de requêtes",
                                  error_icon="fa-hourglass-half", error_message=message)
    return reponse, 429, {'Retry-After': str(attente)}


def init_app(app, compteurs=None):
    mode = os.getenv('LIMITES_REQUETES', 'actif').lower()
    if mode == 'off':
        return
    compteurs = compteurs or CompteursMemoire()
    app.extensions['limites_requetes'] = compteurs

    @app.before_request
    def appliquer_limites_requetes():
        if (request.endpoint in ENDPOINTS_EXEMPTES or request.path.startswith(PREFIXES_EXEMPTES)
                or request.blueprint == 'switchgrid_webhooks' or request.method == 'OPTIONS'):
            return None
        identifiant = _identifiant()
        adresse = identifiant[3:] if identifiant.startswith('ip:') else _adresse_requete()
        for nom, cle in regles_applicables(request.method, request.path, identifiant, adresse):
            for limite, fenetre in LIMITES[nom]:
                valeur, attente = compteurs.incrementer(f'{nom}|{cle}', fenetre)
                if valeur > limite:
                    if valeur == limite + 1:            # une seule ligne de journal par fenêtre
                        app.logger.warning('[limites] %s dépassée (%d/%ds) par %s sur %s %s%s',
                                           nom, limite, fenetre, cle, request.method, request.path,
                                           ' — observation, non bloquée' if mode == 'observation' else '')
                    if mode != 'observation':
                        return _reponse_429(attente)
        return None
