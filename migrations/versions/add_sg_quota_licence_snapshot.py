"""add quota_licence_max / quota_licence_maj_le to switchgrid_usage_quotas

Revision ID: add_sg_quota_licence
Revises: a7d3e9f1c2b4
Create Date: 2026-10-20

Dernier quota Switch Grid connu de la licence SSO, mémorisé pour vérifier le quota à la création de
l'order côté serveur (webhook, sans session) — cf. app/services/switchgrid/quota.py.

Appliquée automatiquement au déploiement (`flask preparer-base`) ; idempotente.
"""
import sqlalchemy as sa
from alembic import op

revision = 'add_sg_quota_licence'
down_revision = 'a7d3e9f1c2b4'
branch_labels = None
depends_on = None


def upgrade():
    existantes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('switchgrid_usage_quotas')}
    with op.batch_alter_table('switchgrid_usage_quotas', schema=None) as batch_op:
        if 'quota_licence_max' not in existantes:
            batch_op.add_column(sa.Column('quota_licence_max', sa.Integer(), nullable=True))
        if 'quota_licence_maj_le' not in existantes:
            batch_op.add_column(sa.Column('quota_licence_maj_le', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('switchgrid_usage_quotas', schema=None) as batch_op:
        batch_op.drop_column('quota_licence_maj_le')
        batch_op.drop_column('quota_licence_max')
