"""add dossier_plans and dossier_plans_quotas tables (dossiers Toitures et Mixte du Chiffrage)

Revision ID: e7b3d91f4a26
Revises: d4a7e2c9f150
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7b3d91f4a26'
down_revision = 'd4a7e2c9f150'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    existing_tables = sa.inspect(conn).get_table_names()

    if 'dossier_plans' not in existing_tables:
        op.create_table(
            'dossier_plans',
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('type_dossier', sa.String(length=20), primary_key=True),
            sa.Column('dossier', sa.JSON(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )

    if 'dossier_plans_quotas' not in existing_tables:
        op.create_table(
            'dossier_plans_quotas',
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('type_dossier', sa.String(length=20), primary_key=True),
            sa.Column('generation_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )


def downgrade():
    conn = op.get_bind()
    existing_tables = sa.inspect(conn).get_table_names()
    if 'dossier_plans_quotas' in existing_tables:
        op.drop_table('dossier_plans_quotas')
    if 'dossier_plans' in existing_tables:
        op.drop_table('dossier_plans')
