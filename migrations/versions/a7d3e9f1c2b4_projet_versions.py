"""Version des données d'un projet (verrou optimiste entre onglets / postes)

Revision ID: a7d3e9f1c2b4
Revises: f2c7a9d4e6b1
Create Date: 2026-10-17

Table projet_versions (app/models/projet_version.py, app/services/version_projet.py) : une ligne par
projet, créée à la première écriture. Commune à toutes les variantes. Les projets existants partent
sans ligne (version 0).

Appliquée automatiquement au déploiement (`flask preparer-base`) ; idempotente (table déjà créée par
create_all en local).
"""
import sqlalchemy as sa
from alembic import op

revision = 'a7d3e9f1c2b4'
down_revision = 'f2c7a9d4e6b1'
branch_labels = None
depends_on = None


def upgrade():
    if 'projet_versions' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'projet_versions',
        sa.Column('projet_id', sa.Integer(), sa.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('dernier_onglet', sa.String(length=64), nullable=True),
        sa.Column('maj_le', sa.DateTime(), nullable=True),
    )


def downgrade():
    if 'projet_versions' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('projet_versions')
