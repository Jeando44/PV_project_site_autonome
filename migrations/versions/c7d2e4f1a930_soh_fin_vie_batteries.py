"""Colonne batteries.soh_fin_vie_pct (état de santé en fin de vie garantie)

Revision ID: c7d2e4f1a930
Revises: b1a7c3e9d240
Create Date: 2026-09-14

Utilisée par le calcul de vieillissement du stockage (étude économique). NULL = non renseigné : le
calcul retient le défaut du modèle de vieillissement (60 % depuis e3b9c7d1f482). Idempotente, comme b1a7c3e9d240 (les schémas réels diffèrent d'une base à
l'autre).
"""
import sqlalchemy as sa
from alembic import op

revision = 'c7d2e4f1a930'
down_revision = 'b1a7c3e9d240'
branch_labels = None
depends_on = None

TABLE = 'batteries'
COLONNE = 'soh_fin_vie_pct'


def _colonnes_existantes():
    inspecteur = sa.inspect(op.get_bind())
    if TABLE not in inspecteur.get_table_names():
        return None
    return {c['name'] for c in inspecteur.get_columns(TABLE)}


def upgrade():
    existantes = _colonnes_existantes()
    if existantes is None or COLONNE in existantes:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        batch_op.add_column(sa.Column(COLONNE, sa.Float(), nullable=True))


def downgrade():
    existantes = _colonnes_existantes()
    if existantes is None or COLONNE not in existantes:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        batch_op.drop_column(COLONNE)
