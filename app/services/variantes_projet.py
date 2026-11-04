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

Courbes de charge (2026-11-04, remplace la décision « conso commune » du 2026-10-09) : chaque variante
a ses propres fichiers de consommation (consommation_files, consommation_files_acc). Leur contenu
binaire (plusieurs Mo) n'entre pas dans le JSON de la copie : il est rangé dans
projets_revisions_fichiers et référencé par son empreinte sha256 (cf. capturer_etat(fichiers=...),
synchroniser_fichiers, lire_fichiers).
"""
import hashlib
import html
import re
import unicodedata
from datetime import date, datetime
from app.utils.dates import utc_maintenant

from sqlalchemy import Date, DateTime

from app.extensions import db

INDICES = ('A', 'B', 'C', 'D')
FORMAT_VERSION = 2

# Données communes à toutes les variantes (jamais capturées ni restaurées) :
#  - parametres_projet hors COLONNES_PROJET_VARIANTE (nom, adresse, zones climatiques, type d'étude...) ;
#  - project_shares, quotas (dossiers, DP, ACC, Switchgrid) ;
#  - calepinages : ancien moteur de calepinage, remplacé par calepinages_maison.
#  - projet_versions : version des données du projet (verrou optimiste, services/version_projet.py).
TABLES_COMMUNES = (
    'project_shares', 'calepinages', 'projets_revisions_fichiers',
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
_COLONNES_EXCLUES = {'id', 'projet_id', 'parametre_projet_id', 'created_at', 'updated_at', COLONNE_INDICE}

# Colonne binaire des tables de fichiers : remplacée dans la copie JSON par son empreinte (clé ci-dessous).
COLONNE_FICHIER = 'file_data'
CLE_EMPREINTE = '_fichier_sha256'


def tables_variante():
    """(clé de la copie, modèle) de chaque table de travail propre à la variante. Import différé :
    ce module est importé par les routes, avant que tous les modèles ne soient chargés."""
    from app.models.calepinage import CalepinageMaison, GeometrieProjet
    from app.models.consommation_file import ConsommationFile, ConsommationFileAcc
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
        # Courbes de charge du site (ACI et participants ACC), propres à chaque variante.
        ('consommation_files', ConsommationFile),
        ('consommation_files_acc', ConsommationFileAcc),
    )


def _colonne_projet(modele):
    """Nom de la colonne de rattachement au projet (projet_id, ou parametre_projet_id pour la conso)."""
    return 'projet_id' if 'projet_id' in modele.__table__.columns else 'parametre_projet_id'


def _lignes_du_projet(modele, projet_id):
    return modele.query.filter_by(**{_colonne_projet(modele): projet_id})


def _colonnes_copiees(modele):
    return [c for c in modele.__table__.columns
            if c.name not in _COLONNES_EXCLUES and c.name != COLONNE_FICHIER]


def _a_fichier(modele):
    return COLONNE_FICHIER in modele.__table__.columns


def empreinte(contenu):
    return hashlib.sha256(contenu or b'').hexdigest()


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


def capturer_etat(projet, fichiers=None):
    """Copie de l'état de conception du projet, sérialisable en JSON (colonne ProjetRevision.donnees).

    `fichiers` (dict) reçoit le contenu binaire des fichiers référencés ({sha256: octets}), à ranger
    avec synchroniser_fichiers(). Sans dict, les tables de fichiers ne sont pas capturées (absentes de
    la copie, elles seraient laissées telles quelles à l'ouverture)."""
    tables = {}
    for cle, modele in tables_variante():
        if _a_fichier(modele) and fichiers is None:
            continue
        colonnes = _colonnes_copiees(modele)
        copie = []
        for ligne in _lignes_du_projet(modele, projet.id).all():
            valeurs = {c.name: _vers_json(c, getattr(ligne, c.name)) for c in colonnes}
            if _a_fichier(modele):
                contenu = getattr(ligne, COLONNE_FICHIER) or b''
                sha = empreinte(contenu)
                fichiers[sha] = contenu
                valeurs[CLE_EMPREINTE] = sha
            copie.append(valeurs)
        tables[cle] = copie

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


def restaurer_etat(projet, donnees, fichiers=None):
    """Réécrit les tables de travail du projet depuis une copie (sans commit : à l'appelant de
    valider la transaction, tout ou rien). Retourne les avertissements (tables absentes de la copie).

    `fichiers` : {sha256: octets} de la variante (lire_fichiers). Un fichier référencé introuvable
    lève ValueError : mieux vaut refuser l'ouverture que restaurer une courbe vide."""
    if not copie_restaurable(donnees):
        raise ValueError('Copie de variante dans un format non restaurable')

    fichiers = fichiers or {}
    avertissements = []
    tables = donnees['tables']
    for cle, modele in tables_variante():
        if cle not in tables:
            avertissements.append(f"{cle} : absente de la copie, données actuelles conservées")
            continue
        avec_fichier = _a_fichier(modele)
        if avec_fichier:
            manquants = [v for v in tables[cle] or [] if (v or {}).get(CLE_EMPREINTE) not in fichiers]
            if manquants:
                raise ValueError(f"{cle} : {len(manquants)} fichier(s) de la variante introuvable(s)")
        _lignes_du_projet(modele, projet.id).delete(synchronize_session=False)
        colonnes = {c.name: c for c in _colonnes_copiees(modele)}
        for valeurs in tables[cle] or []:
            ligne = modele(**{_colonne_projet(modele): projet.id})
            for nom, valeur in (valeurs or {}).items():
                if nom in colonnes:  # colonne supprimée du modèle depuis la capture : ignorée
                    setattr(ligne, nom, _depuis_json(colonnes[nom], valeur))
            if avec_fichier:
                setattr(ligne, COLONNE_FICHIER, fichiers[valeurs[CLE_EMPREINTE]])
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
            _lignes_du_projet(modele, projet.id).update(
                {COLONNE_INDICE: indice}, synchronize_session=False)


def prochain_indice_libre(indices_existants):
    """Première lettre libre de A à D (les trous laissés par une suppression sont réutilisés), None si complet."""
    existants = {str(i).upper() for i in indices_existants}
    for indice in INDICES:
        if indice not in existants:
            return indice
    return None



def synchroniser_fichiers(revision, fichiers):
    """Range le contenu des fichiers capturés ({sha256: octets}) dans la variante (sans commit) :
    ajoute les nouveaux, supprime ceux qui ne sont plus référencés, ne réécrit pas les autres."""
    from app.models.projet_revision import ProjetRevisionFichier
    if revision.id is None:
        db.session.flush()
    existants = {sha for (sha,) in db.session.query(ProjetRevisionFichier.sha256)
                 .filter_by(revision_id=revision.id).all()}
    perimes = existants - set(fichiers)
    if perimes:
        ProjetRevisionFichier.query.filter(
            ProjetRevisionFichier.revision_id == revision.id,
            ProjetRevisionFichier.sha256.in_(perimes),
        ).delete(synchronize_session=False)
    for sha, contenu in fichiers.items():
        if sha not in existants:
            db.session.add(ProjetRevisionFichier(revision_id=revision.id, sha256=sha, file_data=contenu))


def lire_fichiers(revision):
    """{sha256: octets} des fichiers rangés dans la variante."""
    from app.models.projet_revision import ProjetRevisionFichier
    return {f.sha256: f.file_data for f in ProjetRevisionFichier.query.filter_by(revision_id=revision.id).all()}


_BALISE = re.compile(r'<[^>]*>')
_ESPACES = re.compile(r'\s+')


def nettoyer_libelle(valeur, longueur_max=None):
    """Libellé court d'une variante : texte brut sur une ligne, sans balise ni caractère de contrôle,
    espaces regroupés. Retourne (libellé ou None si vide, message d'erreur ou None).
    Refus (pas de troncature silencieuse) au-delà de `longueur_max` caractères."""
    from app.models.projet_revision import LIBELLE_MAX
    longueur_max = longueur_max or LIBELLE_MAX
    if valeur is None:
        return None, None
    if not isinstance(valeur, str):
        return None, 'Le libellé de la variante doit être un texte.'
    texte = html.unescape(_BALISE.sub('', valeur))
    texte = ''.join(' ' if unicodedata.category(ch)[0] == 'C' else ch for ch in texte)
    texte = _ESPACES.sub(' ', unicodedata.normalize('NFC', texte)).strip()
    if len(texte) > longueur_max:
        return None, f'Le libellé de la variante ne doit pas dépasser {longueur_max} caractères ({len(texte)} saisis).'
    return (texte or None), None
