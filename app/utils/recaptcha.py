"""
Vérification reCAPTCHA Enterprise côté serveur (création d'une évaluation « assessment »).

Chaque formulaire protégé envoie un jeton généré au moment de l'envoi
(grecaptcha.enterprise.execute) ; le serveur le soumet à l'API reCAPTCHA Enterprise :
    POST https://recaptchaenterprise.googleapis.com/v1/projects/<projet>/assessments

La requête n'est acceptée que si :
  - tokenProperties.valid est vrai ;
  - tokenProperties.action correspond à l'action attendue ;
  - riskAnalysis.score >= RECAPTCHA_SCORE_THRESHOLD (0.5 par défaut).
Tout le reste est refusé (« fail closed ») : jeton manquant, clé API absente, erreur Google,
délai dépassé, réponse illisible.

Variables d'environnement (serveur uniquement) :
  RECAPTCHA_API_KEY          clé API Google Cloud limitée à l'API reCAPTCHA Enterprise (obligatoire)
  RECAPTCHA_PUBLIC_KEY       clé de site (déjà utilisée par les gabarits)
  RECAPTCHA_PROJECT_ID       projet Google Cloud (défaut : cmp-2025)
  RECAPTCHA_SCORE_THRESHOLD  seuil de score (défaut : 0.5)
  RECAPTCHA_TIMEOUT          délai maximal de l'appel en secondes (défaut : 5)

Ni le jeton ni la clé API ne sont jamais journalisés. La clé passe dans l'en-tête
X-goog-api-key (équivalent du paramètre ?key=) pour ne jamais apparaître dans une URL
ni dans un message d'exception.
"""
import logging
import os

import requests
from flask import abort, current_app, jsonify, request

logger = logging.getLogger(__name__)

ASSESSMENTS_URL = 'https://recaptchaenterprise.googleapis.com/v1/projects/{projet}/assessments'
PROJET_PAR_DEFAUT = 'cmp-2025'
SEUIL_PAR_DEFAUT = 0.5
DELAI_PAR_DEFAUT = 5.0

# Message unique renvoyé au client, quel que soit le motif du refus.
MESSAGE_REFUS = 'Vérification de sécurité échouée. Veuillez réessayer.'


def _reglage(nom, defaut):
    """Lit un réglage dans la configuration Flask, puis dans l'environnement."""
    valeur = current_app.config.get(nom) if current_app else None
    if valeur in (None, ''):
        valeur = os.getenv(nom)
    return defaut if valeur in (None, '') else valeur


def _nombre(nom, defaut):
    try:
        return float(_reglage(nom, defaut))
    except (TypeError, ValueError):
        logger.error('reCAPTCHA : réglage %s invalide, valeur par défaut %s utilisée', nom, defaut)
        return float(defaut)


def creer_evaluation(token, action_attendue):
    """Crée une évaluation reCAPTCHA Enterprise et décide si la requête est acceptée.

    Renvoie (accepte: bool, details: dict). `details` ne contient jamais le jeton ni la clé :
    motif, score, action, invalid_reason, action_attendue, seuil.
    """
    seuil = _nombre('RECAPTCHA_SCORE_THRESHOLD', SEUIL_PAR_DEFAUT)
    details = {'action_attendue': action_attendue, 'seuil': seuil,
               'score': None, 'action': None, 'invalid_reason': None, 'motif': None}

    def refuser(motif):
        details['motif'] = motif
        logger.warning('reCAPTCHA refusé : motif=%s action_attendue=%s action=%s score=%s '
                       'seuil=%s invalidReason=%s', motif, action_attendue, details['action'],
                       details['score'], seuil, details['invalid_reason'])
        return False, details

    if not token or not isinstance(token, str) or token == 'undefined':
        return refuser('jeton_manquant')

    cle_api = _reglage('RECAPTCHA_API_KEY', None)
    cle_site = _reglage('RECAPTCHA_SITE_KEY', None) or _reglage('RECAPTCHA_PUBLIC_KEY', None)
    projet = _reglage('RECAPTCHA_PROJECT_ID', PROJET_PAR_DEFAUT)
    if not cle_api or not cle_site:
        logger.error('reCAPTCHA : RECAPTCHA_API_KEY ou clé de site non configurée')
        return refuser('configuration_manquante')

    evenement = {'token': token, 'expectedAction': action_attendue, 'siteKey': cle_site}
    try:
        # Signaux facultatifs qui améliorent l'analyse de risque.
        if request.user_agent and request.user_agent.string:
            evenement['userAgent'] = request.user_agent.string
        if request.remote_addr:
            evenement['userIpAddress'] = request.remote_addr
    except RuntimeError:
        pass  # hors contexte de requête (appel direct)

    try:
        reponse = requests.post(
            ASSESSMENTS_URL.format(projet=projet),
            json={'event': evenement},
            headers={'X-goog-api-key': cle_api},
            timeout=_nombre('RECAPTCHA_TIMEOUT', DELAI_PAR_DEFAUT),
        )
    except requests.Timeout:
        return refuser('delai_depasse')
    except requests.RequestException as erreur:
        # Uniquement le type d'exception : son message pourrait contenir des données de requête.
        details['invalid_reason'] = type(erreur).__name__
        return refuser('erreur_reseau')

    if reponse.status_code != 200:
        statut = ''
        try:
            statut = (reponse.json().get('error') or {}).get('status') or ''
        except ValueError:
            pass
        details['invalid_reason'] = f'HTTP {reponse.status_code} {statut}'.strip()
        return refuser('erreur_api_google')

    try:
        resultat = reponse.json()
    except ValueError:
        return refuser('reponse_illisible')

    proprietes = resultat.get('tokenProperties') or {}
    analyse = resultat.get('riskAnalysis') or {}
    details['action'] = proprietes.get('action')
    details['invalid_reason'] = proprietes.get('invalidReason')
    score = analyse.get('score')
    details['score'] = score

    if proprietes.get('valid') is not True:
        return refuser('jeton_invalide')
    if proprietes.get('action') != action_attendue:
        return refuser('mauvaise_action')
    if not isinstance(score, (int, float)) or score < seuil:
        return refuser('score_trop_bas')

    details['motif'] = 'accepte'
    logger.info('reCAPTCHA accepté : action=%s score=%s seuil=%s invalidReason=%s',
                details['action'], score, seuil, details['invalid_reason'])
    return True, details


def reponse_refus():
    """Réponse 403 générique pour une requête refusée par reCAPTCHA.

    - appel AJAX (X-Requested-With) : JSON {success: False, status: 'error', message}, code 403 ;
    - sinon : page d'erreur 403 du site (gestionnaire errorhandler(403)).
    """
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'success': False, 'status': 'error', 'message': MESSAGE_REFUS}), 403
    abort(403)
