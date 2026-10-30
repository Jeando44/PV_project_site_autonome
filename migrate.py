#!/usr/bin/env python
"""
Script de migration de base de données
Gestion propre des migrations Flask-Migrate/Alembic

Usage:
    python migrate.py init       - Initialiser Flask-Migrate
    python migrate.py create     - Créer une nouvelle migration
    python migrate.py upgrade    - Appliquer les migrations
    python migrate.py downgrade  - Revenir en arrière d'une migration
    python migrate.py current    - Afficher la migration actuelle
    python migrate.py history    - Afficher l'historique des migrations
    python migrate.py status     - Afficher le statut des migrations
"""

import sys
import os
from pathlib import Path

# Ajouter le répertoire du projet au path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def print_header(text):
    """Affiche un en-tête formaté"""
    print("\n" + "=" * 70)
    print(f"  {text}")
    print("=" * 70 + "\n")


def print_success(text):
    """Affiche un message de succès"""
    print(f"✅ {text}")


def print_error(text):
    """Affiche un message d'erreur"""
    print(f"❌ {text}")


def print_info(text):
    """Affiche un message d'information"""
    print(f"ℹ️  {text}")


def print_warning(text):
    """Affiche un message d'avertissement"""
    print(f"⚠️  {text}")


def check_environment():
    """Vérifie que l'environnement est correctement configuré"""
    print_header("VÉRIFICATION DE L'ENVIRONNEMENT")

    # Vérifier que le virtualenv est activé
    if not hasattr(sys, 'real_prefix') and not (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix):
        print_warning("Le virtualenv ne semble pas être activé")
        print_info("Activez-le avec: source monenv/bin/activate")
        return False

    print_success("Virtualenv activé")

    # Vérifier que Flask-Migrate est installé
    try:
        import flask_migrate
        version = getattr(flask_migrate, '__version__', 'détectée')
        print_success(f"Flask-Migrate installé (version {version})")
    except ImportError:
        print_error("Flask-Migrate n'est pas installé")
        print_info("Installez-le avec: pip install Flask-Migrate")
        return False

    # Vérifier que l'application peut être importée
    try:
        from app import create_app
        print_success("Application Flask importée avec succès")
    except ImportError as e:
        print_error(f"Impossible d'importer l'application: {e}")
        return False

    # Vérifier que le fichier .env existe
    if not Path('.env').exists():
        print_warning("Fichier .env introuvable")
        print_info("Créez un fichier .env avec les variables d'environnement nécessaires")
    else:
        print_success("Fichier .env trouvé")

    return True


def init_migrations():
    """Initialise Flask-Migrate"""
    print_header("INITIALISATION DE FLASK-MIGRATE")

    from flask_migrate import init
    from app import create_app, db

    app = create_app()

    # Vérifier si migrations/ existe déjà
    if Path('migrations').exists():
        print_warning("Le répertoire 'migrations/' existe déjà")
        response = input("Voulez-vous le réinitialiser ? (y/N): ")
        if response.lower() != 'y':
            print_info("Initialisation annulée")
            return False

        # Supprimer le répertoire existant
        import shutil
        shutil.rmtree('migrations')
        print_success("Répertoire 'migrations/' supprimé")

    with app.app_context():
        try:
            init(directory='migrations')
            print_success("Flask-Migrate initialisé avec succès")
            print_info("Répertoire 'migrations/' créé")
            return True
        except Exception as e:
            print_error(f"Erreur lors de l'initialisation: {e}")
            return False


def create_migration(message=None):
    """Crée une nouvelle migration"""
    print_header("CRÉATION D'UNE NOUVELLE MIGRATION")

    from flask_migrate import migrate
    from app import create_app, db

    app = create_app()

    # Vérifier que migrations/ existe
    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        print_info("Initialisez d'abord Flask-Migrate avec: python migrate.py init")
        return False

    # Demander un message si non fourni
    if not message:
        message = input("Message de la migration (ex: 'Ajout table users'): ").strip()
        if not message:
            message = "Auto-migration"

    with app.app_context():
        try:
            print_info(f"Détection des changements dans les modèles...")
            migrate(directory='migrations', message=message)
            print_success(f"Migration créée: {message}")
            print_info("Fichier de migration créé dans migrations/versions/")
            print_warning("N'oubliez pas de vérifier le fichier de migration avant de l'appliquer")
            return True
        except Exception as e:
            print_error(f"Erreur lors de la création de la migration: {e}")
            import traceback
            traceback.print_exc()
            return False


def upgrade_database(revision='head'):
    """Applique les migrations"""
    print_header("APPLICATION DES MIGRATIONS")

    from flask_migrate import upgrade
    from app import create_app, db

    app = create_app()

    # Vérifier que migrations/ existe
    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        print_info("Initialisez d'abord Flask-Migrate avec: python migrate.py init")
        return False

    with app.app_context():
        try:
            print_info(f"Application des migrations jusqu'à: {revision}")
            upgrade(directory='migrations', revision=revision)
            print_success("Migrations appliquées avec succès")

            # Afficher la version actuelle
            from flask_migrate import current
            print_info("Version actuelle de la base de données:")
            current(directory='migrations')

            return True
        except Exception as e:
            print_error(f"Erreur lors de l'application des migrations: {e}")
            import traceback
            traceback.print_exc()
            return False


def downgrade_database(revision='-1'):
    """Revient en arrière d'une migration"""
    print_header("RETOUR EN ARRIÈRE D'UNE MIGRATION")

    from flask_migrate import downgrade
    from app import create_app, db

    app = create_app()

    # Vérifier que migrations/ existe
    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        return False

    print_warning("Cette opération peut entraîner une perte de données")
    response = input(f"Confirmer le retour en arrière vers {revision} ? (y/N): ")
    if response.lower() != 'y':
        print_info("Opération annulée")
        return False

    with app.app_context():
        try:
            print_info(f"Retour en arrière vers: {revision}")
            downgrade(directory='migrations', revision=revision)
            print_success("Retour en arrière effectué avec succès")

            # Afficher la version actuelle
            from flask_migrate import current
            print_info("Version actuelle de la base de données:")
            current(directory='migrations')

            return True
        except Exception as e:
            print_error(f"Erreur lors du retour en arrière: {e}")
            import traceback
            traceback.print_exc()
            return False


def show_current():
    """Affiche la migration actuelle"""
    print_header("VERSION ACTUELLE DE LA BASE DE DONNÉES")

    from flask_migrate import current
    from app import create_app

    app = create_app()

    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        return False

    with app.app_context():
        try:
            current(directory='migrations', verbose=True)
            return True
        except Exception as e:
            print_error(f"Erreur: {e}")
            return False


def show_history():
    """Affiche l'historique des migrations"""
    print_header("HISTORIQUE DES MIGRATIONS")

    from flask_migrate import history
    from app import create_app

    app = create_app()

    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        return False

    with app.app_context():
        try:
            history(directory='migrations', verbose=True)
            return True
        except Exception as e:
            print_error(f"Erreur: {e}")
            return False


def show_status():
    """Affiche le statut des migrations"""
    print_header("STATUT DES MIGRATIONS")

    from flask_migrate import current, heads
    from app import create_app

    app = create_app()

    if not Path('migrations').exists():
        print_error("Le répertoire 'migrations/' n'existe pas")
        print_info("Initialisez Flask-Migrate avec: python migrate.py init")
        return False

    with app.app_context():
        try:
            print_info("Version actuelle:")
            current(directory='migrations', verbose=True)

            print("\n" + "-" * 70 + "\n")

            print_info("Dernière version disponible:")
            heads(directory='migrations', verbose=True)

            return True
        except Exception as e:
            print_error(f"Erreur: {e}")
            return False


def backup_database():
    """Crée une sauvegarde de la base de données"""
    print_header("SAUVEGARDE DE LA BASE DE DONNÉES")

    from datetime import datetime
    import shutil

    db_path = Path('instance/concevoir_mon_projet.db')

    if not db_path.exists():
        print_error("Base de données introuvable")
        return False

    # Créer le répertoire de backup
    backup_dir = Path('backups')
    backup_dir.mkdir(exist_ok=True)

    # Nom du fichier de backup
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = backup_dir / f'concevoir_mon_projet_{timestamp}.db'

    try:
        shutil.copy2(db_path, backup_file)
        print_success(f"Sauvegarde créée: {backup_file}")
        print_info(f"Taille: {backup_file.stat().st_size / 1024:.2f} KB")
        return True
    except Exception as e:
        print_error(f"Erreur lors de la sauvegarde: {e}")
        return False


def print_usage():
    """Affiche l'aide d'utilisation"""
    print("""
╔═══════════════════════════════════════════════════════════════╗
║              SCRIPT DE MIGRATION DE BASE DE DONNÉES           ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
    python migrate.py <commande> [options]

COMMANDES:
    init            Initialiser Flask-Migrate
    create          Créer une nouvelle migration
    upgrade         Appliquer toutes les migrations
    downgrade       Revenir en arrière d'une migration
    current         Afficher la version actuelle
    history         Afficher l'historique des migrations
    status          Afficher le statut complet
    backup          Créer une sauvegarde de la base de données
    help            Afficher cette aide

EXEMPLES:
    # Première utilisation (initialisation)
    python migrate.py init

    # Créer une migration après modification des modèles
    python migrate.py create

    # Appliquer les migrations
    python migrate.py upgrade

    # Sauvegarder la base de données avant une migration
    python migrate.py backup

    # Voir l'état actuel
    python migrate.py status

WORKFLOW RECOMMANDÉ:
    1. Modifier les modèles dans app/models.py
    2. python migrate.py backup          (sauvegarde)
    3. python migrate.py create          (créer migration)
    4. Vérifier le fichier dans migrations/versions/
    5. python migrate.py upgrade         (appliquer)
    6. python migrate.py status          (vérifier)

NOTES:
    • Activez le virtualenv avant d'utiliser ce script
    • Les sauvegardes sont créées dans backups/
    • Les migrations sont dans migrations/versions/

═══════════════════════════════════════════════════════════════
""")


def main():
    """Point d'entrée principal"""

    # Afficher l'aide si aucun argument
    if len(sys.argv) < 2:
        print_usage()
        return 0

    command = sys.argv[1].lower()

    # Commandes qui ne nécessitent pas de vérification d'environnement
    if command in ['help', '--help', '-h']:
        print_usage()
        return 0

    # Vérifier l'environnement pour les autres commandes
    if not check_environment():
        print_error("Environnement non valide")
        return 1

    # Exécuter la commande
    success = True

    if command == 'init':
        success = init_migrations()

    elif command == 'create':
        message = sys.argv[2] if len(sys.argv) > 2 else None
        success = create_migration(message)

    elif command == 'upgrade':
        revision = sys.argv[2] if len(sys.argv) > 2 else 'head'
        success = upgrade_database(revision)

    elif command == 'downgrade':
        revision = sys.argv[2] if len(sys.argv) > 2 else '-1'
        success = downgrade_database(revision)

    elif command == 'current':
        success = show_current()

    elif command == 'history':
        success = show_history()

    elif command == 'status':
        success = show_status()

    elif command == 'backup':
        success = backup_database()

    else:
        print_error(f"Commande inconnue: {command}")
        print_info("Utilisez 'python migrate.py help' pour voir les commandes disponibles")
        return 1

    # Retourner le code de sortie
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
