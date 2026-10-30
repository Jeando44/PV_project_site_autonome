#!/bin/sh
# Point d'entrée du conteneur : prépare le schéma de base UNE FOIS, puis sert l'application.
#
# POURQUOI CE FICHIER
# -------------------
# `db.create_all()` était appelé dans create_app(), donc à chaque démarrage de worker gunicorn.
# Trois problèmes, qui expliquent les échecs de déploiement et les ALTER TABLE manuels :
#   - create_all() ne sait pas ajouter une COLONNE à une table existante ;
#   - il s'exécutait avant que la connexion Cloud SQL soit garantie établie : un démarrage lent
#     faisait échouer le conteneur, donc le déploiement ;
#   - plusieurs instances démarrant en parallèle émettaient des CREATE TABLE concurrents.
#
# Ici, la préparation est une étape explicite, séquentielle, AVANT gunicorn — et `flask
# preparer-base` prend un verrou nommé MySQL, donc deux instances simultanées ne se marchent pas
# dessus (cf. app/cli.py).
#
# En cas d'échec de la préparation, on refuse de démarrer : mieux vaut un déploiement qui échoue
# franchement qu'une application qui sert des pages avec un schéma incomplet.

set -e

echo "[entrypoint] Préparation du schéma de base de données..."
# preparation_base.py : application réduite (modèles seuls, aucune route) — ~1 s au lieu de charger
# toute l'application deux fois (ici puis par gunicorn) à chaque démarrage à froid.
if ! FLASK_APP=preparation_base.py flask preparer-base; then
    echo "[entrypoint] ÉCHEC de la préparation du schéma — démarrage annulé." >&2
    echo "[entrypoint] Diagnostic : FLASK_APP=preparation_base.py flask preparer-base --verifier" >&2
    exit 1
fi

echo "[entrypoint] Schéma prêt. Démarrage de gunicorn sur le port ${PORT:-8080}."
exec gunicorn --bind ":${PORT:-8080}" --workers 1 --threads 8 --timeout 0 run:app
