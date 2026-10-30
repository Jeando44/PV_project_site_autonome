#!/usr/bin/env python
import os
import sys

# Ajouter le répertoire racine au path pour s'assurer que les imports fonctionnent
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

# Instanciation de l'application Flask
app = create_app()

if __name__ == "__main__":
    # Cloud Run configure automatiquement la variable d'environnement PORT.
    # Si elle n'est pas définie (ex: en local), on utilise le port 8080 par défaut.
    port = int(os.environ.get("PORT", 8080))
    
    # Lancement de l'application
    app.run(host="0.0.0.0", port=port, debug=False)