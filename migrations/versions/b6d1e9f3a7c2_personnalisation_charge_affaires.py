"""Personnalisation du rapport : chargé(e) d'affaires

Revision ID: b6d1e9f3a7c2
Revises: e7b4c2a9d318
Create Date: 2026-11-04

- personnalisation_rapport.charge_affaires (VARCHAR 100, NULL) : « Prénom & Nom chargé(e)
  d'affaires » saisi dans Paramètres du projet > Personnalisation du rapport. Le champ existait dans
  le formulaire mais n'était jamais enregistré : il est désormais imprimé dans les rapports et le devis.
Appliquée automatiquement au déploiement (`flask preparer-base`).
"""
import sqlalchemy as sa
from alembic import op

revision = 'b6d1e9f3a7c2'
down_revision = 'e7b4c2a9d318'
branch_labels = None
depends_on = None

TABLE = 'personnalisation_rapport'


def upgrade():
    inspecteur = sa.inspect(op.get_bind())
    if not inspecteur.has_table(TABLE):
        return
    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    if 'charge_affaires' not in colonnes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.add_column(sa.Column('charge_affaires', sa.String(length=100), nullable=True))


def downgrade():
    inspecteur = sa.inspect(op.get_bind())
    if not inspecteur.has_table(TABLE):
        return
    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    if 'charge_affaires' in colonnes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.drop_column('charge_affaires')
