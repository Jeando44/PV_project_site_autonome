"""add type_etude to parametre_projet

Revision ID: add_type_etude
Revises: c2a4cae457a2
Create Date: 2026-07-07

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_type_etude'
down_revision = 'c2a4cae457a2'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne type_etude à la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'type_etude' not in columns:
            batch_op.add_column(sa.Column('type_etude', sa.String(100), nullable=True))
            print("Colonne 'type_etude' ajoutee avec succes")
        else:
            print("La colonne 'type_etude' existe deja")


def downgrade():
    """Supprime la colonne type_etude de la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('type_etude')
    print("Colonne 'type_etude' supprimee")
