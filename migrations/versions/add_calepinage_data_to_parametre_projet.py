"""add calepinage_data to parametre_projet

Revision ID: add_calepinage_data
Revises: f44a553d2d82
Create Date: 2025-11-18

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_calepinage_data'
down_revision = 'f44a553d2d82'  # Pointe vers la migration précédente
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne calepinage_data à la table parametres_projet"""
    # Pour SQLite, on utilise batch_alter_table pour gérer les limitations
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        # Vérifier si la colonne existe déjà (SQLite-compatible)
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'calepinage_data' not in columns:
            batch_op.add_column(sa.Column('calepinage_data', sa.Text(), nullable=True))
            print("✅ Colonne 'calepinage_data' ajoutée avec succès")
        else:
            print("ℹ️ La colonne 'calepinage_data' existe déjà")


def downgrade():
    """Supprime la colonne calepinage_data de la table parametres_projet"""
    # Pour SQLite, utiliser batch_alter_table
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('calepinage_data')
    print("✅ Colonne 'calepinage_data' supprimée")
