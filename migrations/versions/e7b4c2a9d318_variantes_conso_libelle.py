"""Variantes : courbe de charge propre à chaque variante + libellé court

Revision ID: e7b4c2a9d318
Revises: add_sg_quota_licence
Create Date: 2026-11-04

- projets_revisions.libelle (VARCHAR 30, NULL) : libellé saisi par l'utilisateur (infobulle de la
  pastille A/B/C/D dans Mes projets). NULL pour les variantes existantes : aucune infobulle de libellé.
- projets_revisions_fichiers : contenu binaire des courbes de charge copiées dans chaque variante
  (référencé par sha256 depuis projets_revisions.donnees, cf. app/services/variantes_projet.py).
- Reprise des projets existants : la consommation actuelle du projet (consommation_files,
  consommation_files_acc) est copiée dans CHAQUE variante restaurable (format 2) qui n'en contient pas
  encore. Toutes les variantes repartent donc avec la courbe d'aujourd'hui, puis divergent.
Appliquée automatiquement au déploiement (`flask preparer-base`).
"""
import hashlib
import json
from datetime import date, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = 'e7b4c2a9d318'
down_revision = 'add_sg_quota_licence'
branch_labels = None
depends_on = None

TABLE = 'projets_revisions'
FICHIERS = 'projets_revisions_fichiers'
CLE_EMPREINTE = '_fichier_sha256'
# (clé dans la copie, table) ; colonnes copiées : toutes sauf _EXCLUES (file_data va dans FICHIERS)
TABLES_CONSO = (
    ('consommation_files', 'consommation_files'),
    ('consommation_files_acc', 'consommation_files_acc'),
)
_EXCLUES = {'id', 'parametre_projet_id', 'file_data', 'created_at', 'updated_at'}

FichierBinaire = sa.LargeBinary().with_variant(LONGBLOB(), 'mysql')


def _json(valeur):
    if isinstance(valeur, (datetime, date)):
        return valeur.isoformat()
    if isinstance(valeur, bytes):
        return None
    return valeur


def _copie_conso(bind, inspecteur, projet_id, fichiers):
    tables = {}
    for cle, table in TABLES_CONSO:
        if not inspecteur.has_table(table):
            continue
        colonnes = [c['name'] for c in inspecteur.get_columns(table) if c['name'] not in _EXCLUES]
        lignes = bind.execute(sa.text(
            f"SELECT {', '.join(colonnes + ['file_data'])} FROM {table} WHERE parametre_projet_id = :p"
        ), {'p': projet_id}).fetchall()
        copie = []
        for ligne in lignes:
            valeurs = {nom: _json(v) for nom, v in zip(colonnes, ligne[:-1])}
            contenu = bytes(ligne[-1] or b'')
            sha = hashlib.sha256(contenu).hexdigest()
            fichiers[sha] = contenu
            valeurs[CLE_EMPREINTE] = sha
            copie.append(valeurs)
        tables[cle] = copie
    return tables


def upgrade():
    bind = op.get_bind()
    inspecteur = sa.inspect(bind)

    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    if 'libelle' not in colonnes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.add_column(sa.Column('libelle', sa.String(length=30), nullable=True))

    if not inspecteur.has_table(FICHIERS):
        op.create_table(
            FICHIERS,
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('revision_id', sa.Integer(), nullable=False),
            sa.Column('sha256', sa.String(length=64), nullable=False),
            sa.Column('file_data', FichierBinaire, nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['revision_id'], [f'{TABLE}.id'], ondelete='CASCADE',
                                    name='fk_projets_revisions_fichiers_revision_id'),
            sa.UniqueConstraint('revision_id', 'sha256', name='uq_projets_revisions_fichiers_rev_sha'),
        )
        op.create_index('ix_projets_revisions_fichiers_revision_id', FICHIERS, ['revision_id'])

    # Reprise : conso actuelle copiée dans chaque variante restaurable qui n'en a pas.
    inspecteur = sa.inspect(bind)
    revisions = bind.execute(sa.text(f"SELECT id, projet_id, donnees FROM {TABLE}")).fetchall()
    copies_par_projet = {}
    maintenant = datetime.utcnow()
    for rev_id, projet_id, donnees in revisions:
        if isinstance(donnees, (str, bytes)):
            try:
                donnees = json.loads(donnees)
            except ValueError:
                continue
        if not (isinstance(donnees, dict) and donnees.get('format') == 2 and isinstance(donnees.get('tables'), dict)):
            continue
        if all(cle in donnees['tables'] for cle, _t in TABLES_CONSO):
            continue
        if projet_id not in copies_par_projet:
            fichiers = {}
            copies_par_projet[projet_id] = (_copie_conso(bind, inspecteur, projet_id, fichiers), fichiers)
        tables_conso, fichiers = copies_par_projet[projet_id]
        for cle, copie in tables_conso.items():
            donnees['tables'].setdefault(cle, copie)
        bind.execute(sa.text(f"UPDATE {TABLE} SET donnees = :d WHERE id = :i"),
                     {'d': json.dumps(donnees), 'i': rev_id})
        deja = {sha for (sha,) in bind.execute(sa.text(
            f"SELECT sha256 FROM {FICHIERS} WHERE revision_id = :r"), {'r': rev_id}).fetchall()}
        for sha, contenu in fichiers.items():
            if sha not in deja:
                bind.execute(sa.text(
                    f"INSERT INTO {FICHIERS} (revision_id, sha256, file_data, created_at) VALUES (:r, :s, :f, :c)"
                ), {'r': rev_id, 's': sha, 'f': contenu, 'c': maintenant})


def downgrade():
    bind = op.get_bind()
    inspecteur = sa.inspect(bind)
    if inspecteur.has_table(FICHIERS):
        op.drop_table(FICHIERS)
    # Les copies gardent leurs entrées consommation_files* (sans contenu) : à la restauration, l'ancien
    # code les ignore (tables hors registre).
    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    if 'libelle' in colonnes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.drop_column('libelle')
