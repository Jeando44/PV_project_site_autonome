"""add current_period to switchgrid_usage_quotas

Revision ID: add_sg_current_period
Revises: add_dp_usage_quotas
Create Date: 2026-09-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_sg_current_period'
down_revision = 'add_dp_usage_quotas'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne current_period a la table switchgrid_usage_quotas (reset mensuel paresseux,
    meme logique que dp_usage_quotas)."""
    with op.batch_alter_table('switchgrid_usage_quotas', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('switchgrid_usage_quotas')]

        if 'current_period' not in columns:
            batch_op.add_column(sa.Column('current_period', sa.String(7), nullable=True))
            print("Colonne 'current_period' ajoutee avec succes")
        else:
            print("La colonne 'current_period' existe deja")


def downgrade():
    with op.batch_alter_table('switchgrid_usage_quotas', schema=None) as batch_op:
        batch_op.drop_column('current_period')
    print("Colonne 'current_period' supprimee")
