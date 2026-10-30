"""
Variantes d'un projet (Indices A, B, C, D) : capture et restauration de l'état de conception.

Principe : les tables de travail du projet (calepinage résidentiel, géométries, IRVE, étude
économique...) contiennent toujours la variante ACTIVE (`ParametreProjet.active_indice`). Chaque
variante est une copie figée de ces tables (`ProjetRevision.donnees`), réécrite dans les tables de
travail quand on l'ouvre.

Ce module est le registre UNIQUE de ce qui dépend de la variante. Toute nouvelle table liée au
projet doit y être ajoutée (TABLES_VARIANTE) ou déclarée commune (TABLES_COMMUNES) — sinon elle
passera d'une variante à l'autre sans que personne ne s'en aperçoive (bug d'origine : le calepinage
résidentiel n'était pas dans la copie, toutes les variantes affichaient le même calepinage).

Restauration symétrique : une table présente dans la copie avec 0 ligne VIDE la table de travail
(sinon une variante sans IRVE héritait de l'IRVE de la variante ouverte avant elle). Seule une table
ABSENTE de la copie (ajoutée au registre après la capture) est laissée telle quelle.
"""
from datetime import date, datetime
from app.utils.dates import utc_maintenant

from sqlalchemy import Date, DateTime

from app.extensions import db

INDICES = ('A', 'B', 'C', 'D')
FORMAT_VERSION = 2

# Données communes à toutes les variantes (jamais capturées ni restaurées) :
#  - parametres_projet hors COLONNES_PROJET_VARIANTE (nom, adresse, zones climatiques, type d'étude...) ;
#  - consommation_files / consommation_files_acc : consommation du SITE, pas une hypothèse de conception ;
#  - project_shares, quotas (dossiers, DP, ACC, Switchgrid) ;
#  - calepinages : ancien moteur de calepinage, remplacé par calepinages_maison.
#  - projet_versions : version des données du projet (verrou optimiste, services/version_projet.py).
TABLES_COMMUNES = (
    'consommation_files', 'consommation_files_acc', 'project_shares', 'calepinages',
    'ombriere_dossier_quotas', 'petit_champ_dossier_quotas', 'dossier_plans_quotas', 'dp_usage_quotas',
    'switchgrid_consents', 'switchgrid_orders',
    'projet_versions',
)

# Colonnes de parametres_projet propres à la variante : état du calepinage (solarProjectData) et
# puissances qui en découlent (colonne « Puissance projet » de Mes projets, quota max_kwc).
COLONNES_PROJET_VARIANTE = (
    'calepinage_data',
    'puissance_maison_kwc',
    'puissance_totale_kwc',
    'puissance_projet_kwc',
    'puissance_projet_maj_le',
    'puissance_projet_source',
    'surface_projetee_maison_m2',
)

# Colonnes de parametres_projet DÉDUITES d'une table de la variante (calepinages_maison) : absentes
# d'une copie (capturée avant leur création), elles sont remises à NULL (« inconnue, à recalculer »)
# au lieu de garder la valeur de la variante ouverte avant.
COLONNES_PROJET_DERIVEES = ('surface_projetee_maison_m2',)

# Lettre de la variante portée par certaines tables (Loi APER) : jamais copiée telle quelle (une copie
# reprise sous une autre lettre garderait l'ancienne), réécrite par rattacher_indice().
COLONNE_INDICE = 'indice_projet'

# Colonnes jamais copiées : clé technique, rattachement au projet, horodatage propre à la ligne.
_COLONNES_EXCLUES = {'id', 'projet_id', 'created_at', 'updated_at', COLONNE_INDICE}


def tables_variante():
    """(clé de la copie, modèle) de chaque table de travail propre à la variante. Import différé :
    ce module est importé par les routes, avant que tous les modèles ne soient chargés."""
    from app.models.calepinage import CalepinageMaison, GeometrieProjet
    from app.models.dossier_plans import DossierPlans
    from app.models.etude_economique_config import EtudeEconomiqueConfig
    from app.models.irve import IrveConfig
    from app.models.loi_aper import AperConfig, AperPolygone
    from app.models.ombriere_dossier import OmbriereDossier
    from app.models.petit_champ_solaire import PetitChampParametres
    from app.models.pompage_solaire_config import PompageSolaireConfig
    from app.models.residentiel_chiffrage_config import ResidentielChiffrageConfig
    from app.models.resultat_prodsolaire import ResultatProdSolaire, AutonomieSite
    return (
        ('calepinages_maison', CalepinageMaison),
        ('geometries_projet', GeometrieProjet),
        ('petit_champ_parametres', PetitChampParametres),
        ('ombriere_dossiers', OmbriereDossier),
        ('dossier_plans', DossierPlans),
        ('irve_configs', IrveConfig),
        ('etudes_economiques_configs', EtudeEconomiqueConfig),
        ('residentiel_chiffrage_configs', ResidentielChiffrageConfig),
        ('pompage_solaire_configs', PompageSolaireConfig),
        ('resultats_prodsolaire', ResultatProdSolaire),
        ('autonomies_site', AutonomieSite),
        ('aper_configs', AperConfig),
        ('aper_polygones', AperPolygone),
    )


def _colonnes_copiees(modele):
    return [c for c in modele.__table__.columns if c.name not in _COLONNES_EXCLUES]


def _vers_json(colonne, valeur):
    if valeur is not None and isinstance(colonne.type, (DateTime, Date)):
        return valeur.isoformat()
    return valeur


def _depuis_json(colonne, valeur):
    if valeur is None or not isinstance(valeur, str):
        return valeur
    if isinstance(colonne.type, DateTime):
        return datetime.fromisoformat(valeur)
    if isinstance(colonne.type, Date):
        return date.fromisoformat(valeur)
    return valeur


def capturer_etat(projet):
    """Copie de l'état de conception du projet, sérialisable en JSON (colonne ProjetRevision.donnees)."""
    tables = {}
    for cle, modele in tables_variante():
        colonnes = _colonnes_copiees(modele)
        lignes = modele.query.filter_by(projet_id=projet.id).all()
        tables[cle] = [{c.name: _vers_json(c, getattr(ligne, c.name)) for c in colonnes} for ligne in lignes]

    colonnes_projet = {c.name: c for c in projet.__table__.columns}
    projet_valeurs = {
        nom: _vers_json(colonnes_projet[nom], getattr(projet, nom))
        for nom in COLONNES_PROJET_VARIANTE if nom in colonnes_projet
    }
    return {
        'format': FORMAT_VERSION,
        'capture_le': utc_maintenant().isoformat(),
        'projet': projet_valeurs,
        'tables': tables,
    }


def copie_restaurable(donnees):
    """Une copie antérieure au format 2 ne contient pas le calepinage résidentiel : la restaurer
    afficherait le calepinage de la variante précédente sous la lettre demandée."""
    return isinstance(donnees, dict) and donnees.get('format') == FORMAT_VERSION \
        and isinstance(donnees.get('tables'), dict)


def restaurer_etat(projet, donnees):
    """Réécrit les tables de travail du projet depuis une copie (sans commit : à l'appelant de
    valider la transaction, tout ou rien). Retourne les avertissements (tables absentes de la copie)."""
    if not copie_restaurable(donnees):
        raise ValueError('Copie de variante dans un format non restaurable')

    avertissements = []
    tables = donnees['tables']
    for cle, modele in tables_variante():
        if cle not in tables:
            avertissements.append(f"{cle} : absente de la copie, données actuelles conservées")
            continue
        modele.query.filter_by(projet_id=projet.id).delete(synchronize_session=False)
        colonnes = {c.name: c for c in _colonnes_copiees(modele)}
        for valeurs in tables[cle] or []:
            ligne = modele(projet_id=projet.id)
            for nom, valeur in (valeurs or {}).items():
                if nom in colonnes:  # colonne supprimée du modèle depuis la capture : ignorée
                    setattr(ligne, nom, _depuis_json(colonnes[nom], valeur))
            db.session.add(ligne)

    colonnes_projet = {c.name: c for c in projet.__table__.columns}
    valeurs_projet = donnees.get('projet') or {}
    for nom in COLONNES_PROJET_VARIANTE:
        if nom in valeurs_projet and nom in colonnes_projet:
            setattr(projet, nom, _depuis_json(colonnes_projet[nom], valeurs_projet[nom]))
        elif nom in COLONNES_PROJET_DERIVEES and nom in colonnes_projet:
            setattr(projet, nom, None)
    return avertissements


def rattacher_indice(projet, indice):
    """Écrit la lettre de la variante active dans les tables de travail qui la portent (sans commit).
    Appelée dès que active_indice change : enregistrement (A créée, nouvelle variante) et ouverture."""
    db.session.flush()  # lignes tout juste restaurées par restaurer_etat() comprises
    for _cle, modele in tables_variante():
        if COLONNE_INDICE in modele.__table__.columns:
            modele.query.filter_by(projet_id=projet.id).update(
                {COLONNE_INDICE: indice}, synchronize_session=False)


def prochain_indice_libre(indices_existants):
    """Première lettre libre de A à D (les trous laissés par une suppression sont réutilisés), None si complet."""
    existants = {str(i).upper() for i in indices_existants}
    for indice in INDICES:
        if indice not in existants:
            return indice
    return None
