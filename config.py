import os
from dotenv import load_dotenv

load_dotenv()


def emails_depuis_env(nom_variable, defaut=None):
    """
    Liste d'adresses e-mail lue dans une variable d'environnement : séparateurs virgule ou point-
    virgule, espaces ignorés, comparaison insensible à la casse (tout est mis en minuscules).
    Variable absente ou vide -> `defaut` (liste vide si non fourni).
    """
    brut = os.getenv(nom_variable, '')
    emails = [e.strip().lower() for e in brut.replace(';', ',').split(',') if e.strip()]
    return emails if emails else [e.lower() for e in (defaut or [])]


class Config:
    SECRET_KEY = os.getenv('FLASK_SECRET_KEY')
    RECAPTCHA_PUBLIC_KEY = os.getenv('RECAPTCHA_PUBLIC_KEY')
    RECAPTCHA_PRIVATE_KEY = os.getenv('RECAPTCHA_PRIVATE_KEY')
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER')
    MAIL_RECIPIENT = os.getenv('MAIL_RECIPIENT')

    # ------------------------------------------------------------------ #
    # Switchgrid
    # ------------------------------------------------------------------ #
    SWITCHGRID_API_KEY = os.getenv('SWITCHGRID_API_KEY')
    SWITCHGRID_BASE_URL = os.getenv('SWITCHGRID_BASE_URL', 'https://api.switchgrid.tech')
    SWITCHGRID_API_VERSION = os.getenv('SWITCHGRID_API_VERSION', 'v0')

    #'true' et non == 'false'
    SWITCHGRID_TEST_ENV = os.getenv('SWITCHGRID_TEST_ENV', 'false').lower() == 'true'

    #obligatoire pour que le webhook fonctionne
    SWITCHGRID_WEBHOOK_PATH_TOKEN = os.getenv('SWITCHGRID_WEBHOOK_PATH_TOKEN')

    # Quota d'essai : nombre de requêtes de courbe de charge Enedis (création d'un Order Switchgrid
    # C68+R63) autorisées par utilisateur tant qu'il n'est pas licencié (cf.
    # app/services/switchgrid/quota.py, app/models/switchgrid.py::SwitchgridUsageQuota). Modifiable
    # ici uniquement, sans toucher au code métier.
    SWITCHGRID_TRIAL_QUOTA = int(os.getenv('SWITCHGRID_TRIAL_QUOTA', 1))
    # Durée (en jours) de la période d'essai, décomptée à partir de la première requête de
    # l'utilisateur — valeur informative (exposée aux messages d'erreur), le blocage réel se fait
    # sur SWITCHGRID_TRIAL_QUOTA tant que l'utilisateur n'est pas licencié.
    SWITCHGRID_TRIAL_DAYS = int(os.getenv('SWITCHGRID_TRIAL_DAYS', 7))

    # ------------------------------------------------------------------ #
    # Distances et Validation Géographique
    # ------------------------------------------------------------------ #
    # Seuil de déplacement d'adresse d'un projet existant (en mètres).
    # Déplacement <= 300 m : autorisé (ajustement de localisation).
    # Déplacement > 300 m : considéré comme un nouveau projet (consomme un quota projet).
    DISTANCE_SEUIL_PROJET = int(os.getenv('DISTANCE_SEUIL_PROJET', 300))

    # Distance maximale autorisée entre l'adresse du projet et le calepinage (en mètres, soit 2 km).
    # Au-delà de 2000 m : calculs de productible bloqués pour éviter les erreurs de saisie.
    DISTANCE_MAX_CALEPINAGE = int(os.getenv('DISTANCE_MAX_CALEPINAGE', 2000))

    # Rayon d'action maximal (en km) historique
    PROJECT_RADIUS_LIMIT_KM = float(os.getenv('PROJECT_RADIUS_LIMIT_KM', 2))

    # ------------------------------------------------------------------ #
    # Quotas de Licence & Tolérance de Puissance
    # ------------------------------------------------------------------ #
    # Marge de tolérance (en %) appliquée sur la puissance crête maximale autorisée
    # par la licence (ex. 10.0% permet 110 kWc pour une licence de 100 kWc).
    # Modifiable via variable d'environnement LICENCE_POWER_TOLERANCE_PERCENT.
    LICENCE_POWER_TOLERANCE_PERCENT = float(os.getenv('LICENCE_POWER_TOLERANCE_PERCENT', 10.0))

    # ------------------------------------------------------------------ #
    # Calepinage Shed
    # ------------------------------------------------------------------ #
    # Puissance crête max autorisée par défaut pour un shed (kWc) — cf.
    # app/models/calepinage_systeme/verification.py::_verify_shed. Modifiable via variable
    # d'environnement si besoin, sans toucher au code.
    SHED_MAX_POWER_KWC = float(os.getenv('SHED_MAX_POWER_KWC', 2000))

    # ------------------------------------------------------------------ #
    # Calepinage maison : surface maximale d'un contour dessiné
    # ------------------------------------------------------------------ #
    # La limite du polygone s'applique aussi aux champs créés par le bouton de décalage de parcelles
    # cadastrales (DecalageParcelles.js).
    # Au-delà, le tracé est refusé (frontend : polygon_maison.js / calepinage_maison_dessin.js) et
    # l'utilisateur doit le reprendre ; le backend revérifie à la sauvegarde et à la vérification
    # (cf. app/models/calepinage_maison_verification/surface_contour.py), filet de sécurité si le
    # verrou frontend est contourné. Valeurs en m², modifiables ici ou par variable d'environnement.
    CALEPINAGE_SURFACE_MAX_RECT_M2 = float(os.getenv('CALEPINAGE_SURFACE_MAX_RECT_M2', 25000))
    CALEPINAGE_SURFACE_MAX_POLYGONE_M2 = float(os.getenv('CALEPINAGE_SURFACE_MAX_POLYGONE_M2', 50000))

    # ------------------------------------------------------------------ #
    # Cache navigateur des fichiers statiques versionnés (URL avec ?v=N)
    # ------------------------------------------------------------------ #
    # Sans durée de cache, le navigateur redemande chaque script au serveur à chaque ouverture d'une
    # modale en iframe (une trentaine de requêtes pour « Consommation d'énergie »). Un fichier dont
    # le ?v= est incrémenté à chaque modification peut être gardé tel quel ; un fichier modifié SANS
    # incrémenter son ?v= reste servi depuis le cache jusqu'à cette durée (en secondes). 0 = désactivé.
    STATIC_VERSIONNE_MAX_AGE = int(os.getenv('STATIC_VERSIONNE_MAX_AGE', 86400))

    # ------------------------------------------------------------------ #
    # Schéma unifilaire : bibliothèque de symboles (palette de gauche)
    # ------------------------------------------------------------------ #
    # True  : palette visible et utilisable par l'administrateur SEULEMENT (les utilisateurs gardent
    #         le schéma complet : Générer auto, Circuit PV, liaisons, annotations, export PDF).
    # False : palette ouverte à tous les utilisateurs.
    # Lu par app/routes/main.py::_schema_unifilaire_symboles_autorises() (template + API de la
    # palette, qui répond 403 aux non-admins). Cf. docs/schema_unifilaire_symboles_acces.md.
    SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL = os.getenv(
        'SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL', 'true').strip().lower() in ('1', 'true', 'yes', 'on')

    # ------------------------------------------------------------------ #
    # Taille maximale du corps de requête (uploads)
    # ------------------------------------------------------------------ #
    # Aucune limite n'existait auparavant : un fichier de courbe de consommation (Excel/CSV) ou une
    # image de calepinage volumineuse était intégralement chargée en mémoire avant tout traitement.
    # 20 Mo couvre largement un fichier de courbe de charge annuelle au pas 10 min et une image de
    # calibration — à relever via MAX_CONTENT_LENGTH_MB si un usage Grand-projet légitime le dépasse.
    MAX_CONTENT_LENGTH = int(os.getenv('MAX_CONTENT_LENGTH_MB', 20)) * 1024 * 1024

    # ------------------------------------------------------------------ #
    # Interface d'administration des matériels (Panneaux/Onduleurs/Batteries)
    # ------------------------------------------------------------------ #
    # Outil interne, réservé au(x) compte(s) listé(s) ci-dessous — jamais accessible aux utilisateurs
    # finaux (cf. app/routes/admin_materiels.py::materiels_admin_required, qui revérifie ces deux
    # conditions indépendamment du bouton de menu, lui-même masqué pour tout autre compte). Double
    # verrou demandé explicitement : interrupteur global ET liste d'emails, tous deux modifiables ici
    # sans toucher au code.
    MATERIELS_ADMIN_ENABLED = True
    # Adresse(s) autorisée(s) : variable d'environnement MATERIELS_ADMIN_EMAILS (plusieurs adresses
    # séparées par des virgules). Base commune SANS adresse par défaut : chaque environnement fixe la
    # sienne ci-dessous (développement : repli sur l'adresse locale ; production : variable seule).
    MATERIELS_ADMIN_EMAILS = emails_depuis_env('MATERIELS_ADMIN_EMAILS')

    # ------------------------------------------------------------------ #
    # Champ solaire depuis le cadastre (bouton « Créer une forme de décalage »)
    # ------------------------------------------------------------------ #
    # Accès temporairement restreint (cf. app/services/decalage_parcelles_acces.py) : comptes
    # administrateurs + adresses listées ci-dessous. Pour OUVRIR À TOUS LES UTILISATEURS : passer
    # DECALAGE_PARCELLES_POUR_TOUS à True (ou variable d'environnement DECALAGE_PARCELLES_POUR_TOUS=true),
    # puis redémarrer le serveur. Le bouton et la sauvegarde suivent tous deux ce réglage.
    DECALAGE_PARCELLES_POUR_TOUS = os.getenv('DECALAGE_PARCELLES_POUR_TOUS', 'false').lower() == 'true'
    # Adresse(s) autorisée(s) en plus des administrateurs : variable DECALAGE_PARCELLES_EMAILS
    # (plusieurs adresses séparées par des virgules), vide par défaut.
    DECALAGE_PARCELLES_EMAILS = emails_depuis_env('DECALAGE_PARCELLES_EMAILS')


class DevelopmentConfig(Config):
    DEBUG = True
    DEVELOPMENT = True
    # CORRECTIF : run.py démarre toujours le serveur avec app.run(debug=False) (indépendamment de
    # DEBUG ci-dessus), pour ne pas exposer le débogueur interactif Werkzeug ni activer l'auto-reload
    # du PROCESSUS — mais Flask calcule TEMPLATES_AUTO_RELOAD (Jinja) à partir de app.debug quand cette
    # clé n'est pas définie explicitement, donc ce debug=False désactivait AUSSI silencieusement le
    # rechargement des templates .html : une fois le serveur démarré, toute modification d'un fichier
    # .html (ex. app_irve_v1.16.html) restait invisible pour le reste de la durée de vie du processus,
    # quel que soit le nombre de rechargements navigateur (cache navigateur ou pas) — seul un redémarrage
    # complet du serveur la faisait apparaître. En le fixant ici explicitement, Jinja revérifie la date
    # de modification du fichier à CHAQUE rendu, sans dépendre de app.debug/du reloader Werkzeug.
    TEMPLATES_AUTO_RELOAD = True
    # En dev : lit le .env, défaut true (sandbox gratuit)
    SWITCHGRID_TEST_ENV = os.getenv('SWITCHGRID_TEST_ENV', 'true').lower() == 'true'
    # Administration des matériels en local : adresse historique par défaut, surchargeable par la
    # variable MATERIELS_ADMIN_EMAILS (.env) si besoin.
    MATERIELS_ADMIN_EMAILS = emails_depuis_env('MATERIELS_ADMIN_EMAILS', ['solakvan@gmail.com'])


class ProductionConfig(Config):
    DEBUG = False
    DEVELOPMENT = False
    # Administration des matériels en production : UNIQUEMENT la variable d'environnement
    # MATERIELS_ADMIN_EMAILS (définie dans l'interface de déploiement). Aucune adresse codée en dur :
    # si la variable est absente, personne n'a accès (le bouton est masqué et les routes renvoient 404).
    MATERIELS_ADMIN_EMAILS = emails_depuis_env('MATERIELS_ADMIN_EMAILS')
    # En prod : lit le .env, défaut false (vraies données)
    SWITCHGRID_TEST_ENV = os.getenv('SWITCHGRID_TEST_ENV', 'false').lower() == 'true'


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}

# Exportations directes au niveau du module
DISTANCE_SEUIL_PROJET = Config.DISTANCE_SEUIL_PROJET
DISTANCE_MAX_CALEPINAGE = Config.DISTANCE_MAX_CALEPINAGE
LICENCE_POWER_TOLERANCE_PERCENT = Config.LICENCE_POWER_TOLERANCE_PERCENT
CALEPINAGE_SURFACE_MAX_RECT_M2 = Config.CALEPINAGE_SURFACE_MAX_RECT_M2
CALEPINAGE_SURFACE_MAX_POLYGONE_M2 = Config.CALEPINAGE_SURFACE_MAX_POLYGONE_M2
SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL = Config.SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL
