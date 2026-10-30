"""add nb_onduleurs and fraction_repartition_onduleur to calepinages

Revision ID: add_nb_onduleurs_fraction
Revises: add_active_indice
Create Date: 2026-07-26

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_nb_onduleurs_fraction'
down_revision = 'add_active_indice'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute les colonnes nb_onduleurs et fraction_repartition_onduleur à la table calepinages"""
    with op.batch_alter_table('calepinages', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('calepinages')]

        if 'nb_onduleurs' not in columns:
            batch_op.add_column(sa.Column('nb_onduleurs', sa.Integer(), nullable=True, server_default='1'))
            print("Colonne 'nb_onduleurs' ajoutee avec succes")
        else:
            print("La colonne 'nb_onduleurs' existe deja")

        if 'fraction_repartition_onduleur' not in columns:
            batch_op.add_column(sa.Column('fraction_repartition_onduleur', sa.Float(), nullable=True, server_default='100.0'))
            print("Colonne 'fraction_repartition_onduleur' ajoutee avec succes")
        else:
            print("La colonne 'fraction_repartition_onduleur' existe deja")


def downgrade():
    """Supprime les colonnes nb_onduleurs et fraction_repartition_onduleur de la table calepinages"""
    with op.batch_alter_table('calepinages', schema=None) as batch_op:
        batch_op.drop_column('fraction_repartition_onduleur')
        batch_op.drop_column('nb_onduleurs')
    print("Colonnes 'nb_onduleurs' et 'fraction_repartition_onduleur' supprimees")
