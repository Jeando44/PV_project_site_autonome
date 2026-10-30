"""add petit_champ_parametres and petit_champ_dossier_quotas tables

Revision ID: add_petit_champ_tables
Revises: add_sg_current_period
Create Date: 2026-09-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_petit_champ_tables'
down_revision = 'add_sg_current_period'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'petit_champ_parametres' not in existing_tables:
        op.create_table(
            'petit_champ_parametres',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), nullable=False),
            sa.Column('pv_id', sa.String(length=50), nullable=False),
            sa.Column('parametres', sa.JSON(), nullable=False),
            sa.Column('dossier', sa.JSON(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('projet_id', 'pv_id', name='uq_petit_champ_parametres_projet_pv'),
        )
        op.create_index('ix_petit_champ_parametres_projet_id', 'petit_champ_parametres', ['projet_id'])
        print("Table 'petit_champ_parametres' creee avec succes")
    else:
        print("La table 'petit_champ_parametres' existe deja")

    if 'petit_champ_dossier_quotas' not in existing_tables:
        op.create_table(
            'petit_champ_dossier_quotas',
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('generation_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        print("Table 'petit_champ_dossier_quotas' creee avec succes")
    else:
        print("La table 'petit_champ_dossier_quotas' existe deja")


def downgrade():
    op.drop_table('petit_champ_dossier_quotas')
    op.drop_index('ix_petit_champ_parametres_projet_id', table_name='petit_champ_parametres')
    op.drop_table('petit_champ_parametres')
    print("Tables 'petit_champ_parametres' et 'petit_champ_dossier_quotas' supprimees")
