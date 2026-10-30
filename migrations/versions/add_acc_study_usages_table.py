"""add acc_study_usages table

Revision ID: add_acc_study_usages
Revises: add_consommation_files_acc
Create Date: 2026-09-28

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_acc_study_usages'
down_revision = 'add_consommation_files_acc'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # `flask preparer-base` cree deja les tables manquantes (create_all) avant upgrade() :
    # la migration ne doit donc rien faire si la table existe.
    if 'acc_study_usages' not in existing_tables:
        op.create_table(
            'acc_study_usages',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('user_id', sa.String(length=36), nullable=False),
            sa.Column('period', sa.String(length=7), nullable=False),
            sa.Column('projet_key', sa.String(length=64), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', 'period', 'projet_key', name='uq_acc_study_user_period_projet'),
        )
        op.create_index('ix_acc_study_usages_user_id', 'acc_study_usages', ['user_id'])
        print("Table 'acc_study_usages' creee avec succes")
    else:
        print("La table 'acc_study_usages' existe deja")


def downgrade():
    op.drop_index('ix_acc_study_usages_user_id', table_name='acc_study_usages')
    op.drop_table('acc_study_usages')
    print("Table 'acc_study_usages' supprimee")
