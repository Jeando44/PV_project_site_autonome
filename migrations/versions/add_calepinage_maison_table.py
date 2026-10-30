"""add calepinages_maison table

Revision ID: add_calepinage_maison
Revises: add_equip_pv_tables
Create Date: 2026-08-26

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_calepinage_maison'
down_revision = 'add_equip_pv_tables'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'calepinages_maison' not in existing_tables:
        op.create_table(
            'calepinages_maison',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), nullable=False),
            sa.Column('maison_id', sa.String(length=50), nullable=False),
            sa.Column('coordonnees', sa.JSON(), nullable=False),
            sa.Column('panneau_ref', sa.String(length=200), nullable=True),
            sa.Column('panneau_puissance_wc', sa.Float(), nullable=True),
            sa.Column('systeme_integration_ref', sa.String(length=100), nullable=True),
            sa.Column('onduleur_puissance_kva', sa.Float(), nullable=True),
            sa.Column('onduleur_rendement', sa.Float(), nullable=True),
            sa.Column('onduleur_conso', sa.Float(), nullable=True),
            sa.Column('batterie_ref', sa.String(length=200), nullable=True),
            sa.Column('batterie_capacite_kwh', sa.Float(), nullable=True),
            sa.Column('type_montage', sa.String(length=50), nullable=True),
            sa.Column('perte_pourcent', sa.Float(), nullable=True, server_default='0'),
            sa.Column('affectation_centrale', sa.String(length=150), nullable=True),
            sa.Column('donnees_completes', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('calepinages_maison', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_calepinages_maison_projet_id'), ['projet_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_calepinages_maison_maison_id'), ['maison_id'], unique=False)
        print("Table 'calepinages_maison' creee avec succes")
    else:
        print("La table 'calepinages_maison' existe deja")


def downgrade():
    op.drop_table('calepinages_maison')
    print("Table 'calepinages_maison' supprimee")
