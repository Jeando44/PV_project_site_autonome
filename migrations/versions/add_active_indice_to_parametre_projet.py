"""add active_indice to parametre_projet

Revision ID: add_active_indice
Revises: e05c61d6561a
Create Date: 2026-07-25

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_active_indice'
down_revision = 'e05c61d6561a'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne active_indice à la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'active_indice' not in columns:
            batch_op.add_column(sa.Column('active_indice', sa.String(1), nullable=True))
            print("Colonne 'active_indice' ajoutee avec succes")
        else:
            print("La colonne 'active_indice' existe deja")


def downgrade():
    """Supprime la colonne active_indice de la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('active_indice')
    print("Colonne 'active_indice' supprimee")
