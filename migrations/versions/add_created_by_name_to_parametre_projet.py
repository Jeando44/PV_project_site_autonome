"""add created_by_name to parametre_projet

Revision ID: add_created_by_name
Revises: add_calepinage_data
Create Date: 2025-12-30

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_created_by_name'
down_revision = 'add_calepinage_data'  # Pointe vers la migration précédente
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute la colonne created_by_name à la table parametres_projet"""
    # Pour SQLite, on utilise batch_alter_table pour gérer les limitations
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        # Vérifier si la colonne existe déjà (SQLite-compatible)
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'created_by_name' not in columns:
            batch_op.add_column(sa.Column('created_by_name', sa.String(200), nullable=True))
            print("✅ Colonne 'created_by_name' ajoutée avec succès")
        else:
            print("ℹ️ La colonne 'created_by_name' existe déjà")


def downgrade():
    """Supprime la colonne created_by_name de la table parametres_projet"""
    # Pour SQLite, utiliser batch_alter_table
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('created_by_name')
    print("✅ Colonne 'created_by_name' supprimée")
