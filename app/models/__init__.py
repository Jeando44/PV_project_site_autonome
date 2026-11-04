"""
Modèles de données de l'application
"""
from app.models.norme_calcul import NormeCalcul
from app.models.parametre_projet import ParametreProjet
from app.models.project_share import ProjectShare, SharePermissionType
from app.models.share_activity import ShareActivity
from app.models.materiel_catalogue import MaterielCatalogue
from app.models.equipements_pv import (
    Panneau, Onduleur, Batterie, Optimiseur, PompeSolaire,
    OptimiseurOnduleurCompat, BatterieOnduleurCompat,
)
from app.models.calepinage import Calepinage, GeometrieProjet, CalepinageMaison
from app.models.irve import IrveConfig
from app.models.pompage_solaire_config import PompageSolaireConfig
from app.models.etude_economique_config import EtudeEconomiqueConfig
from app.models.resultat_prodsolaire import ResultatProdSolaire, AutonomieSite
from app.models.residentiel_chiffrage_config import ResidentielChiffrageConfig
from app.models.projet_revision import ProjetRevision, ProjetRevisionFichier
from app.models.parametre_rapport_perso import PersonnalisationRapport
from app.models.consommation_file import ConsommationFile, ConsommationFileAcc
from app.models.loi_aper import AperConfig, AperPolygone
from app.models.projet_version import ProjetVersion

__all__ = [
    'NormeCalcul',
    'ParametreProjet',
    'ProjectShare',
    'SharePermissionType',
    'ShareActivity',
    'MaterielCatalogue',
    'Panneau',
    'Onduleur',
    'Batterie',
    'Optimiseur',
    'PompeSolaire',
    'OptimiseurOnduleurCompat',
    'BatterieOnduleurCompat',
    'Calepinage',
    'GeometrieProjet',
    'CalepinageMaison',
    'IrveConfig',
    'PompageSolaireConfig',
    'EtudeEconomiqueConfig',
    'ResultatProdSolaire',
    'AutonomieSite',
    'ResidentielChiffrageConfig',
    'ProjetRevision',
    'ProjetRevisionFichier',
    'PersonnalisationRapport',
    'ConsommationFile',
    'ConsommationFileAcc',
    'AperConfig',
    'AperPolygone',
    'ProjetVersion',
]


def importer_tous_les_modeles():
    """
    Importe tous les fichiers de app/models/ qui déclarent une table (`class X(db.Model)`), pour que
    db.metadata soit complet avant create_all() ou une migration.

    Les imports ci-dessus n'en couvrent qu'une partie (acc_quota, dp_quota, switchgrid... n'y sont
    pas) : jusqu'ici, c'était l'import de toutes les routes qui complétait la liste par effet de
    bord. La recherche est automatique pour qu'un nouveau modèle ne puisse pas être oublié — une
    table oubliée ne serait pas créée au déploiement. Seuls les fichiers à la racine de app/models/
    sont parcourus : les sous-dossiers (calculs, rapports) ne contiennent aucun modèle et chargent
    des bibliothèques lourdes.
    """
    import importlib
    import pathlib
    import re

    motif = re.compile(r'^class \w+\(.*\bdb\.Model\b', re.MULTILINE)
    for fichier in sorted(pathlib.Path(__file__).parent.glob('*.py')):
        if motif.search(fichier.read_text(encoding='utf-8')):
            importlib.import_module(f'app.models.{fichier.stem}')
