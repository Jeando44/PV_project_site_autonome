"""add pompage_solaire_configs table and projets_revisions.pompage_solaire_data

Revision ID: add_pompage_solaire_configs
Revises: add_soft_delete_and_quota
Create Date: 2026-09-28

Persistance en base du module Pompage solaire, rattachée au projet (jusqu'ici : clé localStorage
globale `solarPumpData`, partagée par tous les projets d'un même navigateur).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_pompage_solaire_configs'
down_revision = 'add_soft_delete_and_quota'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'pompage_solaire_configs' not in existing_tables:
        op.create_table(
            'pompage_solaire_configs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('projet_id', sa.Integer(),
                      sa.ForeignKey('parametres_projet.id', ondelete='CASCADE',
                                    name='fk_pompage_solaire_configs_projet_id'),
                      nullable=False),
            sa.Column('saisies', sa.JSON(), nullable=False),
            sa.Column('resultats', sa.JSON(), nullable=True),
            sa.Column('updated_by', sa.String(length=36), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_pompage_solaire_configs_projet_id', 'pompage_solaire_configs',
                        ['projet_id'], unique=True)
        print("Table 'pompage_solaire_configs' creee avec succes")
    else:
        print("La table 'pompage_solaire_configs' existe deja")

    if 'projets_revisions' in existing_tables:
        colonnes = {c['name'] for c in inspector.get_columns('projets_revisions')}
        if 'pompage_solaire_data' not in colonnes:
            with op.batch_alter_table('projets_revisions') as batch_op:
                batch_op.add_column(sa.Column('pompage_solaire_data', sa.JSON(), nullable=True))
            print("Colonne 'projets_revisions.pompage_solaire_data' ajoutee")


def downgrade():
    with op.batch_alter_table('projets_revisions') as batch_op:
        batch_op.drop_column('pompage_solaire_data')
    op.drop_index('ix_pompage_solaire_configs_projet_id', table_name='pompage_solaire_configs')
    op.drop_table('pompage_solaire_configs')
