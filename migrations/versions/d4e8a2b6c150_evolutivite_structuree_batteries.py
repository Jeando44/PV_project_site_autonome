"""Colonnes batteries nb_serie_min / nb_serie_max / nb_parallele_max (évolutivité structurée)

Revision ID: d4e8a2b6c150
Revises: c7d2e4f1a930
Create Date: 2026-09-14

Remplacent, pour les contrôles de montage série / parallèle, le texte libre `evolutivite_max`.
NULL = non renseigné : montage non vérifié (avertissement). Idempotente, comme b1a7c3e9d240.
"""
import sqlalchemy as sa
from alembic import op

revision = 'd4e8a2b6c150'
down_revision = 'c7d2e4f1a930'
branch_labels = None
depends_on = None

TABLE = 'batteries'
COLONNES = ('nb_serie_min', 'nb_serie_max', 'nb_parallele_max')


def _colonnes_existantes():
    inspecteur = sa.inspect(op.get_bind())
    if TABLE not in inspecteur.get_table_names():
        return None
    return {c['name'] for c in inspecteur.get_columns(TABLE)}


def upgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    manquantes = [c for c in COLONNES if c not in existantes]
    if not manquantes:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom in manquantes:
            batch_op.add_column(sa.Column(nom, sa.Integer(), nullable=True))


def downgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    presentes = [c for c in COLONNES if c in existantes]
    if not presentes:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom in presentes:
            batch_op.drop_column(nom)
