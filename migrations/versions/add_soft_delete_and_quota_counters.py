"""add is_deleted and deleted_at to parametre_projet and create project_quota_counters table

Revision ID: add_soft_delete_and_quota
Revises: add_licence_quota_fields
Create Date: 2026-09-25 15:00:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_soft_delete_and_quota'
down_revision = 'add_licence_quota_fields'
branch_labels = None
depends_on = None


def upgrade():
    """Ajoute le soft-delete à parametres_projet et crée la table project_quota_counters"""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # 1. Colonnes is_deleted et deleted_at sur parametres_projet
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]

        if 'is_deleted' not in columns:
            batch_op.add_column(sa.Column('is_deleted', sa.Boolean(), nullable=True, server_default='0'))
            batch_op.create_index('ix_parametres_projet_is_deleted', ['is_deleted'])
            print("[OK] Colonne 'is_deleted' ajoutee avec succes")
        else:
            print("[INFO] La colonne 'is_deleted' existe deja")

        if 'deleted_at' not in columns:
            batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
            print("[OK] Colonne 'deleted_at' ajoutee avec succes")
        else:
            print("[INFO] La colonne 'deleted_at' existe deja")

    # 2. Table project_quota_counters
    if 'project_quota_counters' not in existing_tables:
        op.create_table(
            'project_quota_counters',
            sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
            sa.Column('user_id', sa.String(length=100), nullable=False),
            sa.Column('total_projects_created', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_created_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_project_quota_counters_user_id', 'project_quota_counters', ['user_id'], unique=True)
        print("[OK] Table 'project_quota_counters' creee avec succes")
    else:
        print("[INFO] La table 'project_quota_counters' existe deja")


def downgrade():
    """Supprime la table project_quota_counters et les colonnes soft-delete"""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'project_quota_counters' in existing_tables:
        op.drop_table('project_quota_counters')
        print("[OK] Table 'project_quota_counters' supprimee")

    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_index('ix_parametres_projet_is_deleted')
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('is_deleted')
    print("[OK] Colonnes 'is_deleted' et 'deleted_at' supprimees de parametres_projet")
