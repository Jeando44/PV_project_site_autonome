"""add ombriere_dossiers and ombriere_dossier_quotas tables

Revision ID: add_ombriere_dossier_tables
Revises: add_acc_study_usages
Create Date: 2026-09-28

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_ombriere_dossier_tables'
down_revision = 'add_acc_study_usages'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    existing_tables = sa.inspect(conn).get_table_names()

    if 'ombriere_dossiers' not in existing_tables:
        op.create_table(
            'ombriere_dossiers',
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('dossier', sa.JSON(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        print("Table 'ombriere_dossiers' creee avec succes")
    else:
        print("La table 'ombriere_dossiers' existe deja")

    if 'ombriere_dossier_quotas' not in existing_tables:
        op.create_table(
            'ombriere_dossier_quotas',
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('generation_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        print("Table 'ombriere_dossier_quotas' creee avec succes")
    else:
        print("La table 'ombriere_dossier_quotas' existe deja")


def downgrade():
    op.drop_table('ombriere_dossier_quotas')
    op.drop_table('ombriere_dossiers')
    print("Tables 'ombriere_dossiers' et 'ombriere_dossier_quotas' supprimees")
