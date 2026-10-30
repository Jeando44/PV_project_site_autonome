"""
Verrou optimiste des données d'un projet (demande explicite 2026-10-17 : protéger un projet ouvert
dans deux onglets ou sur deux postes).

Écritures concernées (cf. _FAMILLES) : POST / PUT / PATCH / DELETE sous /parametre-projet/<id>/...
(calepinages, étude éco, devis, Loi APER, IRVE, consommation, PAC, variantes...) et PUT des
paramètres / dossiers du petit champ, des dossiers de plans et du dossier ombrières ; envoyées par un
onglet de l'application (en-têtes posés par static/.../services/version_projet.js) :
  - X-Skv-Onglet  : identifiant de l'onglet (une valeur par chargement de page) ;
  - X-Skv-Version : dernière version des données que cet onglet connaît.

Règle : refus (409, `conflit_version`) si la version envoyée n'est plus la version en base ET que la
dernière écriture vient d'un AUTRE onglet — un onglet resté sur un état périmé ne peut plus écraser
un travail plus récent. Les écritures successives (ou parallèles) d'un même onglet passent toujours.
Après une écriture réussie (hors réponses « inchangé »), la version augmente et la nouvelle valeur
est renvoyée dans l'en-tête X-Skv-Version ; les lectures (GET) la renvoient aussi.

Modales chargées en iframe (consommation, IRVE, autoconsommation) : elles reprennent l'identifiant
et la version de l'onglet parent (même onglet, jamais de faux conflit avec lui).
Génération de dossier (POST .../generer, quota) : non contrôlée.
Requêtes SANS X-Skv-Onglet (anciens scripts en cache, écritures pendant la fermeture de la page) : ni contrôlées ni comptées — comportement d'avant, jamais de faux conflit.
Table absente (migration non appliquée) : contrôle ignoré, jamais d'erreur.
"""
import logging
import re
from datetime import datetime
from app.utils.dates import utc_maintenant

from flask import g, jsonify, request, session
from sqlalchemy.exc import SQLAlchemyError

from app.extensions import db

logger = logging.getLogger(__name__)

_METHODES_ECRITURE = {'POST', 'PUT', 'PATCH', 'DELETE'}
_PREFIXE = r'^(?:/concevoir_mon_projet)?'
# (adresse, méthodes contrôlées) : groupe 1 = n° du projet, groupe 2 = suffixe (filtré ci-dessous).
_FAMILLES = (
    (re.compile(_PREFIXE + r'/parametre-projet/(\d+)(/.*)$'), _METHODES_ECRITURE),
    (re.compile(_PREFIXE + r'/api/petit_champ/(\d+)/[^/]+/(?:parametres|dossier)()$'), {'PUT'}),
    (re.compile(_PREFIXE + r'/api/dossier_plans/[^/]+/(\d+)()$'), {'PUT'}),
    (re.compile(_PREFIXE + r'/api/ombrieres/dossier/(\d+)()$'), {'PUT'}),
)
# Écritures non contrôlées : activation de session, vérifications sans écriture, valeur dérivée
# recalculée depuis la base (puissance projet), suppression du projet lui-même.
_SUFFIXES_IGNORES = ('/activer', '/verifier', '/verifier-totaux', '/puissance-projet')
EN_TETE_ONGLET = 'X-Skv-Onglet'
EN_TETE_VERSION = 'X-Skv-Version'

MESSAGE_CONFLIT = ("Ce projet a été modifié depuis un autre onglet ou un autre poste. Rechargez la page "
                   "pour repartir de la dernière version enregistrée : les modifications de cet "
                   "onglet n'ont pas été enregistrées.")


def _projet_de_la_requete():
    """(n° du projet, écriture contrôlée ?) ; (None, False) hors des adresses suivies."""
    chemin = request.path or ''
    for motif, methodes in _FAMILLES:
        m = motif.match(chemin)
        if m:
            controlee = request.method in methodes and not (m.group(2) or '').endswith(_SUFFIXES_IGNORES)
            return int(m.group(1)), controlee
    return None, False


def _autorise(projet_id):
    """Le projet appartient-il à l'utilisateur de la session (ou admin) ? La route revérifie."""
    from app.models.parametre_projet import ParametreProjet
    user = session.get('user') or {}
    if not user.get('id'):
        return False
    projet = db.session.get(ParametreProjet, projet_id)
    return bool(projet) and (bool(user.get('is_admin')) or str(projet.created_by) == str(user['id']))


def lire_etat(projet_id):
    """(version, dernier onglet) des données du projet ((0, None) si jamais écrit), (None, None)
    si la table manque."""
    from app.models.projet_version import ProjetVersion
    try:
        ligne = db.session.get(ProjetVersion, projet_id)
        return (ligne.version, ligne.dernier_onglet) if ligne else (0, None)
    except SQLAlchemyError:
        db.session.rollback()
        return None, None


def lire_version(projet_id):
    """Version actuelle des données du projet (0 si jamais écrit), None si la table manque."""
    return lire_etat(projet_id)[0]


def _controler():
    if request.method not in _METHODES_ECRITURE:
        return None
    onglet = (request.headers.get(EN_TETE_ONGLET) or '').strip()[:64]
    if not onglet:
        return None
    projet_id, controlee = _projet_de_la_requete()
    if projet_id is None or not controlee:
        return None
    from app.models.projet_version import ProjetVersion
    try:
        if not _autorise(projet_id):
            return None
        ligne = db.session.get(ProjetVersion, projet_id)
    except SQLAlchemyError:
        db.session.rollback()
        return None
    g.skv_version_projet = (projet_id, onglet)
    version_client = request.headers.get(EN_TETE_VERSION)
    if ligne is None or version_client is None or not version_client.strip().isdigit():
        return None
    if int(version_client) != ligne.version and ligne.dernier_onglet != onglet:
        g.skv_version_projet = None
        logger.info('Écriture refusée (version %s, base %s) sur le projet %s', version_client, ligne.version, projet_id)
        reponse = jsonify({'success': False, 'conflit_version': True, 'message': MESSAGE_CONFLIT,
                           'version': ligne.version})
        reponse.status_code = 409
        reponse.headers[EN_TETE_VERSION] = str(ligne.version)
        return reponse
    return None


def _reponse_inchangee(reponse):
    if not reponse.is_json:
        return False
    try:
        corps = reponse.get_json(silent=True)
    except Exception:  # noqa: BLE001 - corps illisible : on compte l'écriture
        return False
    if not isinstance(corps, dict):
        return False
    return corps.get('success') is False or bool(corps.get('inchange') or corps.get('skipped') or corps.get('omitted'))


def _apres(reponse):
    try:
        cible = getattr(g, 'skv_version_projet', None)
        if cible and 200 <= reponse.status_code < 300 and not _reponse_inchangee(reponse):
            from app.models.projet_version import ProjetVersion
            projet_id, onglet = cible
            ligne = db.session.get(ProjetVersion, projet_id)
            if ligne is None:
                ligne = ProjetVersion(projet_id=projet_id, version=0)
                db.session.add(ligne)
            ligne.version = (ligne.version or 0) + 1
            ligne.dernier_onglet = onglet
            ligne.maj_le = utc_maintenant()
            db.session.commit()
            reponse.headers[EN_TETE_VERSION] = str(ligne.version)
            return reponse
        if request.method == 'GET' and reponse.status_code == 200 and EN_TETE_VERSION not in reponse.headers:
            projet_id, _ = _projet_de_la_requete()
            if projet_id is not None and session.get('user'):
                version = lire_version(projet_id)
                if version is not None:
                    reponse.headers[EN_TETE_VERSION] = str(version)
        elif cible and EN_TETE_VERSION not in reponse.headers:
            version = lire_version(cible[0])
            if version is not None:
                reponse.headers[EN_TETE_VERSION] = str(version)
    except SQLAlchemyError:
        db.session.rollback()
        logger.warning('Version du projet non mise à jour', exc_info=True)
    return reponse


def init_app(app):
    app.before_request(_controler)
    app.after_request(_apres)
