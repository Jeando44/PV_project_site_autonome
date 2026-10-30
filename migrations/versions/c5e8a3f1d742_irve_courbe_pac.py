"""add irve_configs.courbe_pac (courbe de charge du module PAC / climatiseur)

Revision ID: c5e8a3f1d742
Revises: b8d2f4a6c931
Create Date: 2026-10-10

Courbe de consommation électrique simulée par le module PAC / climatiseur (Irve/pac_climatisation/),
transmise à l'autoconsommation individuelle PAR LA BASE, comme la courbe IRVE — mais dans une colonne
séparée de load_curve, que POST .../irve/save-curve remplace en entier à chaque calcul IRVE. Copiée
automatiquement dans les variantes de projet (variantes_projet.py copie toutes les colonnes
d'irve_configs).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c5e8a3f1d742'
down_revision = 'b8d2f4a6c931'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'irve_configs' not in inspector.get_table_names():
        return
    colonnes = {c['name'] for c in inspector.get_columns('irve_configs')}
    if 'courbe_pac' not in colonnes:
        op.add_column('irve_configs', sa.Column('courbe_pac', sa.JSON(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'irve_configs' not in inspector.get_table_names():
        return
    colonnes = {c['name'] for c in inspector.get_columns('irve_configs')}
    if 'courbe_pac' in colonnes:
        with op.batch_alter_table('irve_configs') as batch_op:
            batch_op.drop_column('courbe_pac')
