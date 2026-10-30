"""add irve_configs.rentabilite (saisies de la section Rentabilité économique du projet IRVE)

Revision ID: b8d2f4a6c931
Revises: e7b3d91f4a26
Create Date: 2026-10-10

Persistance en base, par projet, des saisies de la section « 3. Rentabilité économique du projet
IRVE » (jusqu'ici : localStorage par utilisateur et par projet) et des frises heures creuses /
heures de pointe. Colonne copiée automatiquement dans les variantes de projet (variantes_projet.py
copie toutes les colonnes d'irve_configs).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b8d2f4a6c931'
down_revision = 'e7b3d91f4a26'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'irve_configs' not in inspector.get_table_names():
        return
    colonnes = {c['name'] for c in inspector.get_columns('irve_configs')}
    if 'rentabilite' not in colonnes:
        op.add_column('irve_configs', sa.Column('rentabilite', sa.JSON(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'irve_configs' not in inspector.get_table_names():
        return
    colonnes = {c['name'] for c in inspector.get_columns('irve_configs')}
    if 'rentabilite' in colonnes:
        with op.batch_alter_table('irve_configs') as batch_op:
            batch_op.drop_column('rentabilite')
