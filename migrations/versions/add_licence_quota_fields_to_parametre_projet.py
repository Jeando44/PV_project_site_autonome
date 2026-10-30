"""add puissance_totale_kwc and company_id to parametre_projet

Revision ID: add_licence_quota_fields
Revises: 07e6f21da2bc
Create Date: 2026-07-23

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_licence_quota_fields'
down_revision = 'add_petit_champ_tables'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute puissance_totale_kwc et company_id à parametres_projet (quota de licence)"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        conn = op.get_bind()
        inspector = sa.inspect(conn)
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'puissance_totale_kwc' not in columns:
            batch_op.add_column(sa.Column('puissance_totale_kwc', sa.Float(), nullable=True))
            print("[OK] Colonne 'puissance_totale_kwc' ajoutee avec succes")
        else:
            print("[INFO] La colonne 'puissance_totale_kwc' existe deja")

        if 'company_id' not in columns:
            batch_op.add_column(sa.Column('company_id', sa.String(36), nullable=True))
            batch_op.create_index('ix_parametres_projet_company_id', ['company_id'])
            print("[OK] Colonne 'company_id' ajoutee avec succes")
        else:
            print("[INFO] La colonne 'company_id' existe deja")


def downgrade():
    """Supprime puissance_totale_kwc et company_id de parametres_projet"""
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_index('ix_parametres_projet_company_id')
        batch_op.drop_column('company_id')
        batch_op.drop_column('puissance_totale_kwc')
    print("[OK] Colonnes 'company_id' et 'puissance_totale_kwc' supprimees")
