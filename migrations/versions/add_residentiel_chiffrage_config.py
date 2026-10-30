"""add residentiel_chiffrage_configs table

Revision ID: add_resi_chiffrage
Revises: add_perso_rapport
Create Date: 2026-08-28

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_resi_chiffrage'
down_revision = 'add_perso_rapport'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'residentiel_chiffrage_configs' not in existing_tables:
        op.create_table(
            'residentiel_chiffrage_configs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column(
                'projet_id', sa.Integer(),
                sa.ForeignKey('parametres_projet.id', ondelete='CASCADE',
                               name='fk_residentiel_chiffrage_configs_projet_id'),
                nullable=False
            ),
            sa.Column('data', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('residentiel_chiffrage_configs', schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f('ix_residentiel_chiffrage_configs_projet_id'), ['projet_id'], unique=True
            )
        print("Table 'residentiel_chiffrage_configs' creee avec succes")
    else:
        print("La table 'residentiel_chiffrage_configs' existe deja")


def downgrade():
    op.drop_table('residentiel_chiffrage_configs')
    print("Table 'residentiel_chiffrage_configs' supprimee")
