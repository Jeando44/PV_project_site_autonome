"""
Modèle ConsommationFile - Persistance en base de la courbe de charge (CDC) importée pour un projet.

NOUVEAU (demande explicite : "assurez-vous que l'import de CDC est bien intégré dans la base de
données") : jusqu'ici, le fichier de consommation importé (manuellement ou via Enedis/Switchgrid) ne
vivait QUE dans l'IndexedDB du navigateur (clé globale fixe 'consFile', cf. prodsolaire/
persistence.js) — jamais persisté côté serveur, donc perdu au moindre vidage de cache et, avant le
correctif associé, partagé par erreur entre projets. Une seule CDC par projet (upsert à chaque
nouvel import/injection) — `unique=True` sur `parametre_projet_id`, même convention que IrveConfig
(one-to-one projet).

Isolation projet + compte utilisateur (demande explicite) : `parametre_projet_id` restreint la CDC à
UN SEUL projet (jamais un identifiant global partagé, contrairement au bug corrigé côté IndexedDB) ;
`created_by` duplique en plus l'identité du propriétaire directement sur la ligne (même convention que
ParametreProjet.created_by) — la vérification d'accès réelle se fait par requête (cf. les routes),
mais ce champ rend l'isolation explicite au niveau de la donnée elle-même, pas seulement au niveau du
code applicatif.
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant
from sqlalchemy.dialects.mysql import LONGBLOB

# `db.LargeBinary` seul devient un BLOB MySQL plafonné à 64 Ko : une courbe annuelle .xlsx pèse
# plusieurs centaines de Ko (erreur 1406 « Data too long for column 'file_data' »). LONGBLOB sur MySQL,
# LargeBinary inchangé ailleurs (SQLite des tests).
FichierBinaire = db.LargeBinary().with_variant(LONGBLOB(), 'mysql')


class ConsommationFile(db.Model):
    """Fichier de courbe de charge (CDC) importé, associé à un unique projet et à son propriétaire."""
    __tablename__ = 'consommation_files'

    id = db.Column(db.Integer, primary_key=True)

    parametre_projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_consommation_files_projet_id'),
        nullable=False,
        unique=True,
        index=True
    )

    # Identité du compte ayant importé/injecté cette CDC — même convention que ParametreProjet
    # (created_by = id utilisateur). Non utilisé comme unique garde d'accès (les routes vérifient
    # toujours parametre_projet_id + created_by du PROJET, cf. concevoir_mon_projet.py), mais rend
    # l'appartenance explicite sur la donnée elle-même.
    created_by = db.Column(db.String(100), nullable=False)

    filename = db.Column(db.String(255), nullable=False)
    content_type = db.Column(db.String(150), nullable=False)
    file_data = db.Column(FichierBinaire, nullable=False)

    # Pas de temps déclaré au moment de l'import (60/30/15/10 minutes) — nécessaire pour revalider la
    # structure du fichier (nombre de lignes attendu) sans dépendre d'un état frontend éphémère.
    time_step = db.Column(db.Integer, nullable=False, default=60)

    # Traçabilité de la provenance (demande explicite : couvrir aussi Enedis/Switchgrid, pas
    # seulement l'import manuel) — 'import' (fichier Excel déposé par l'utilisateur) ou 'enedis'
    # (courbe R63/Enedis choisie via le module Switchgrid).
    source = db.Column(db.String(20), nullable=False, default='import')

    uploaded_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'parametre_projet_id': self.parametre_projet_id,
            'filename': self.filename,
            'content_type': self.content_type,
            'time_step': self.time_step,
            'source': self.source,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


class ConsommationFileAcc(db.Model):
    """
    Courbes de charge des participants d'une opération d'autoconsommation collective (ACC) : une
    ligne PAR PARTICIPANT, rattachée à un unique projet et à son propriétaire.

    Jusqu'ici ces fichiers ne vivaient que dans l'IndexedDB du navigateur (clés globales
    'accFile_<nom>', cf. prodsolaire/main_acc.js) — jamais en base, contrairement à la CDC ACI
    (ConsommationFile ci-dessus, une seule par projet). Même conventions d'isolation :
    `parametre_projet_id` + `created_by`, accès toujours vérifié par les routes via le projet.

    `original_name` est la clé fonctionnelle du participant côté frontend (clé de la Map
    accConsFiles) : unique par projet, un nouvel import sous le même nom remplace la courbe.
    """
    __tablename__ = 'consommation_files_acc'

    id = db.Column(db.Integer, primary_key=True)

    parametre_projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_consommation_files_acc_projet_id'),
        nullable=False,
        index=True
    )
    created_by = db.Column(db.String(100), nullable=False)

    original_name = db.Column(db.String(255), nullable=False)
    custom_name = db.Column(db.String(255), nullable=True)
    content_type = db.Column(db.String(150), nullable=False)
    file_data = db.Column(FichierBinaire, nullable=False)
    time_step = db.Column(db.Integer, nullable=False, default=60)

    # 'import' (fichier déposé) | 'enedis' (courbe R63 validée depuis le modal de préparation)
    source = db.Column(db.String(20), nullable=False, default='import')
    # Renseignés pour source='enedis' : PDL du participant et année de référence retenue
    # ('2025', 'moyenne'...) — permet de réafficher le choix fait pour chaque courbe.
    prm = db.Column(db.String(14), nullable=True)
    annee = db.Column(db.String(16), nullable=True)

    # Localisation du participant (bâtiment / adresse), saisie depuis la carte des participants de
    # la page calepinage (components/acc_participants/acc_participants_carte.js) : contrôle du
    # périmètre géographique de l'opération et carte du rapport.
    adresse = db.Column(db.String(500), nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)

    uploaded_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    __table_args__ = (
        db.UniqueConstraint('parametre_projet_id', 'original_name', name='uq_consommation_acc_projet_nom'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'parametre_projet_id': self.parametre_projet_id,
            'original_name': self.original_name,
            'custom_name': self.custom_name,
            'content_type': self.content_type,
            'time_step': self.time_step,
            'source': self.source,
            'prm': self.prm,
            'annee': self.annee,
            'adresse': self.adresse,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
        }
