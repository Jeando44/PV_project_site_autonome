"""Colonnes pompes_solaires pour la gamme SQFlex : applications, courbes de performance, rendement
hydraulique, code article, raccord de refoulement

Revision ID: f9c3a1d7e214
Revises: cdc_file_data_longblob
Create Date: 2026-10-08

Données : scripts/donnees/pompes_sqflex_grundfos.json (généré par scripts/extraire_pompes_sqflex.py),
importé par l'administration des matériels ou scripts/import_pompes_sqflex.py. Idempotente : une
colonne déjà présente (base créée par create_all après l'ajout au modèle) est laissée telle quelle.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = 'f9c3a1d7e214'
down_revision = 'cdc_file_data_longblob'
branch_labels = None
depends_on = None

TABLE = 'pompes_solaires'
COLONNES = [
    ('applications', sa.Text()),
    # LONGTEXT sur MySQL : un TEXT y est plafonné à 64 Ko (les courbes d'une pompe en font ~6).
    ('courbes_performance', sa.Text().with_variant(mysql.LONGTEXT(), 'mysql')),
    ('rendement_hydraulique_pct', sa.Float()),
    ('code_article', sa.String(50)),
    ('raccord_refoulement', sa.String(50)),
]


def _colonnes_existantes():
    inspecteur = sa.inspect(op.get_bind())
    if TABLE not in inspecteur.get_table_names():
        return None
    return {c['name'] for c in inspecteur.get_columns(TABLE)}


def upgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    a_ajouter = [(nom, type_) for nom, type_ in COLONNES if nom not in existantes]
    if not a_ajouter:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom, type_ in a_ajouter:
            batch_op.add_column(sa.Column(nom, type_, nullable=True))


def downgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom, _ in reversed(COLONNES):
            if nom in existantes:
                batch_op.drop_column(nom)
