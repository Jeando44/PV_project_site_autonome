"""add option_reseau to parametre_projet

Revision ID: add_option_reseau
Revises: add_calepinage_data
Create Date: 2026-03-01

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_option_reseau'
down_revision = 'add_calepinage_data'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne option_reseau à la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'option_reseau' not in columns:
            batch_op.add_column(sa.Column('option_reseau', sa.String(200), nullable=True))
            print("✅ Colonne 'option_reseau' ajoutée avec succès")
        else:
            print("ℹ️ La colonne 'option_reseau' existe déjà")


def downgrade():
    """Supprime la colonne option_reseau de la table parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('option_reseau')
    print("✅ Colonne 'option_reseau' supprimée")
