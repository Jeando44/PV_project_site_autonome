"""
Point d'entrée de `flask preparer-base` (cf. entrypoint.sh et app/cli.py).

Application réduite — configuration, base, migrations et modèles, sans aucune route : le schéma se
prépare en ~1 s au lieu de charger toute l'application (pvlib, pandas, fpdf, ezdxf...), que
gunicorn recharge de toute façon juste après.

    FLASK_APP=preparation_base.py flask preparer-base [--verifier]

Les autres commandes `flask` (db migrate, db upgrade...) continuent de passer par run.py.
"""
from app import creer_app_preparation_base

app = creer_app_preparation_base()
