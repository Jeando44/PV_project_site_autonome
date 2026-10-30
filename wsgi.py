"""
Point d'entrée WSGI pour les serveurs de production (Gunicorn, App Engine, Cloud Run).

Ce fichier existe parce que `app` est ambigu : le dossier `app/` (le package de
l'application) masque `app.py` à l'import Python. Un `gunicorn app:app` charge donc le
package, qui n'expose aucun objet `app`, et échoue avec
« Failed to find attribute 'app' in 'app' ».

`wsgi` est un nom sans collision : `gunicorn wsgi:app` fonctionne.
`app.py` reste le point d'entrée du serveur de développement (`python app.py`).
"""
from app import create_app

app = create_app()
