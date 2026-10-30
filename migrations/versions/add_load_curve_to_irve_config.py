"""add load_curve to irve_configs

Revision ID: add_load_curve_irve
Revises: add_nb_onduleurs_fraction
Create Date: 2026-07-31

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_load_curve_irve'
down_revision = 'add_nb_onduleurs_fraction'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne load_curve (courbe de charge IRVE calculée) à irve_configs."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'irve_configs' not in inspector.get_table_names():
        print("La table 'irve_configs' n'existe pas, colonne non ajoutee (table geree hors migrations)")
        return

    columns = [col['name'] for col in inspector.get_columns('irve_configs')]
    if 'load_curve' not in columns:
        with op.batch_alter_table('irve_configs', schema=None) as batch_op:
            batch_op.add_column(sa.Column('load_curve', sa.JSON(), nullable=True))
        print("Colonne 'load_curve' ajoutee avec succes")
    else:
        print("La colonne 'load_curve' existe deja")


def downgrade():
    """Supprime la colonne load_curve de irve_configs"""
    with op.batch_alter_table('irve_configs', schema=None) as batch_op:
        batch_op.drop_column('load_curve')
    print("Colonne 'load_curve' supprimee")
