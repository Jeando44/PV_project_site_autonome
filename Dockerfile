# Image officielle Python 3.13 (version slim pour la légèreté). Le tag suit automatiquement le
# dernier correctif de sécurité 3.13.x à chaque construction. Même version mineure que le poste de
# développement (Skvenv313, cf. .python-version).
FROM python:3.13-slim

# Empêcher Python d'écrire des fichiers .pyc et forcer l'affichage des logs en temps réel
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Définir le répertoire de travail dans le conteneur
WORKDIR /app

# Installer les dépendances système nécessaires (si besoin de compiler certains paquets).
# Toutes les dépendances ont aujourd'hui une version précompilée pour Linux / Python 3.13, mais
# build-essential est conservé : il apporte aussi libgomp, que des bibliothèques de calcul
# précompilées (PySAM...) peuvent charger à l'exécution.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copier d'abord le fichier des dépendances pour profiter du cache Docker
COPY requirements.txt .

# Mettre à jour pip avant d'installer les dépendances
RUN pip install --upgrade pip

# Installer les dépendances Python
RUN pip install --no-cache-dir -r requirements.txt

# Copier tout le reste du code source (app/, run.py, etc.)
COPY . .

# Démarrage à froid plus court, préparé une fois pour toutes dans l'image :
#  - compileall : PYTHONDONTWRITEBYTECODE=1 et le .dockerignore (*.pyc) faisaient recompiler tout le
#    code de l'application à chaque démarrage de conteneur ;
#  - matplotlib construit son cache de polices au premier import (plusieurs secondes) : sans cela,
#    le premier graphique après chaque démarrage à froid (étude éco, rapports) le payait.
RUN python -m compileall -q /app/app /app/run.py /app/wsgi.py /app/preparation_base.py /app/config.py /app/forms.py \
    && python -c "import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot"

# FLASK_APP : commandes `flask` courantes (db migrate, db upgrade...). La préparation du schéma
# lancée par l'entrypoint utilise preparation_base.py (application réduite, cf. entrypoint.sh).
ENV FLASK_APP=run.py

# Cloud Run injecte automatiquement une variable d'environnement PORT (souvent 8080).
#
# Le démarrage passe par entrypoint.sh, qui prépare le schéma de base UNE FOIS (tables manquantes
# + migrations, sous verrou) AVANT de lancer gunicorn. Auparavant, `db.create_all()` s'exécutait
# dans create_app() à chaque démarrage de worker : il ne créait jamais les colonnes manquantes
# (d'où les ALTER TABLE à la main) et pouvait faire échouer le déploiement — connexion Cloud SQL
# pas encore établie, ou CREATE TABLE concurrents entre instances.
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]