"""
Point d'entrée de l'application Flask
Utilisé pour le développement local
"""
import os

from app import create_app
# fichier de lance app
app = create_app()

if __name__ == '__main__':
    # Port lu dans PORT (.env ou variable posée par le lanceur) : en local, les applications tournent
    # ensemble — PRO 5000, Résidentiel 5001, Site autonome 5002 (cf. lancer_applications_local.ps1).
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)
    
    