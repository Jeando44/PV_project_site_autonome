
from flask import render_template, request, jsonify
import os


def _wants_json_response():
    """
    Détecte si la requête courante attend une réponse JSON (appel fetch/AJAX vers une
    route de calcul ou d'API) plutôt qu'une page HTML (navigation classique du navigateur).
    Évite de renvoyer une page d'erreur HTML à un fetch() qui fait ensuite response.json()
    — ce qui provoque un "Unexpected token '<' is not valid JSON" côté client.
    """
    return request.path.startswith('/api/') or request.method != 'GET'


def register_error_handlers(app):
    """Enregistre tous les gestionnaires d'erreurs personnalisés"""

    @app.errorhandler(400)
    def bad_request(e):
        """Erreur 400 - Mauvaise requête"""
        if _wants_json_response():
            return jsonify({'error': "La requête envoyée est invalide ou mal formée."}), 400
        return render_template('base/error.html',
            error_code=400,
            error_title="Requête invalide",
            error_icon="fa-exclamation-triangle",
            error_message="La requête envoyée est invalide ou mal formée.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 400

    @app.errorhandler(401)
    def unauthorized(e):
        """Erreur 401 - Non authentifié"""
        if _wants_json_response():
            return jsonify({'error': "Vous devez être connecté pour accéder à cette ressource."}), 401
        return render_template('base/error.html',
            error_code=401,
            error_title="Authentification requise",
            error_icon="fa-user-lock",
            error_message="Vous devez être connecté pour accéder à cette ressource.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 401

    @app.errorhandler(403)
    def forbidden(e):
        """Erreur 403 - Accès interdit"""
        if _wants_json_response():
            return jsonify({'error': "Vous n'avez pas les permissions nécessaires pour accéder à cette ressource."}), 403
        return render_template('base/error.html',
            error_code=403,
            error_title="Accès Refusé",
            error_icon="fa-lock",
            error_message="Vous n'avez pas les permissions nécessaires pour accéder à cette ressource.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 403

    @app.errorhandler(404)
    def not_found(e):
        """Erreur 404 - Page non trouvée"""
        if _wants_json_response():
            return jsonify({'error': "La ressource demandée n'existe pas ou a été déplacée."}), 404
        return render_template('base/error.html',
            error_code=404,
            error_title="Page Introuvable",
            error_icon="fa-search",
            error_message="La page que vous recherchez n'existe pas ou a été déplacée.",
            error=f"URL demandée: {request.url}" if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        """Erreur 405 - Méthode non autorisée"""
        if _wants_json_response():
            return jsonify({'error': "La méthode HTTP utilisée n'est pas autorisée pour cette ressource."}), 405
        return render_template('base/error.html',
            error_code=405,
            error_title="Méthode Non Autorisée",
            error_icon="fa-ban",
            error_message="La méthode HTTP utilisée n'est pas autorisée pour cette ressource.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 405

    @app.errorhandler(408)
    def request_timeout(e):
        """Erreur 408 - Délai d'attente dépassé"""
        if _wants_json_response():
            return jsonify({'error': "Le serveur a mis trop de temps à répondre. Veuillez réessayer."}), 408
        return render_template('base/error.html',
            error_code=408,
            error_title="Délai Dépassé",
            error_icon="fa-clock",
            error_message="Le serveur a mis trop de temps à répondre. Veuillez réessayer.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 408

    @app.errorhandler(429)
    def too_many_requests(e):
        """Erreur 429 - Trop de requêtes"""
        if _wants_json_response():
            return jsonify({'error': "Vous avez effectué trop de requêtes. Veuillez patienter avant de réessayer."}), 429
        return render_template('base/error.html',
            error_code=429,
            error_title="Trop de Requêtes",
            error_icon="fa-tachometer-alt",
            error_message="Vous avez effectué trop de requêtes. Veuillez patienter avant de réessayer.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 429

    @app.errorhandler(500)
    def internal_error(e):
        """Erreur 500 - Erreur interne du serveur"""
        if _wants_json_response():
            return jsonify({'error': "Une erreur interne s'est produite. Nos équipes ont été notifiées."}), 500
        return render_template('base/error.html',
            error_code=500,
            error_title="Erreur Interne",
            error_icon="fa-server",
            error_message="Une erreur interne s'est produite. Nos équipes ont été notifiées.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 500

    @app.errorhandler(502)
    def bad_gateway(e):
        """Erreur 502 - Passerelle défectueuse"""
        if _wants_json_response():
            return jsonify({'error': "Le serveur a reçu une réponse invalide. Veuillez réessayer."}), 502
        return render_template('base/error.html',
            error_code=502,
            error_title="Passerelle Défectueuse",
            error_icon="fa-plug",
            error_message="Le serveur a reçu une réponse invalide. Veuillez réessayer.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 502

    @app.errorhandler(503)
    def service_unavailable(e):
        """Erreur 503 - Service indisponible"""
        if _wants_json_response():
            return jsonify({'error': "Le service est temporairement indisponible. Maintenance en cours."}), 503
        return render_template('base/error.html',
            error_code=503,
            error_title="Service Indisponible",
            error_icon="fa-tools",
            error_message="Le service est temporairement indisponible. Maintenance en cours.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 503

    @app.errorhandler(504)
    def gateway_timeout(e):
        """Erreur 504 - Délai d'attente de la passerelle"""
        if _wants_json_response():
            return jsonify({'error': "Le serveur n'a pas reçu de réponse à temps. Veuillez réessayer."}), 504
        return render_template('base/error.html',
            error_code=504,
            error_title="Délai Dépassé",
            error_icon="fa-hourglass-end",
            error_message="Le serveur n'a pas reçu de réponse à temps. Veuillez réessayer.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 504

    @app.errorhandler(Exception)
    def handle_exception(e):
        """Gestionnaire générique pour toutes les exceptions non gérées"""
        # Log l'erreur
        app.logger.error(f"Unhandled exception: {str(e)}", exc_info=True)

        if _wants_json_response():
            return jsonify({'error': "Une erreur inattendue s'est produite. Veuillez réessayer."}), 500

        # Retourner une page d'erreur générique
        return render_template('base/error.html',
            error_code=500,
            error_title="Erreur Inattendue",
            error_icon="fa-exclamation-circle",
            error_message="Une erreur inattendue s'est produite. Veuillez réessayer.",
            error=str(e) if app.debug else None,
            main_app_url=os.getenv('MAIN_APP_URL', '/')
        ), 500
