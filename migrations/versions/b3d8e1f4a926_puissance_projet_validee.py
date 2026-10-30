"""Puissance projet figée au calcul / à l'export (colonne « Puissance projet (kWc) » de Mes projets)

Revision ID: b3d8e1f4a926
Revises: a7e2c4b9d361
Create Date: 2026-10-08

Ajoute à parametres_projet :
  - puissance_projet_kwc    : puissance du calepinage enregistré, figée par « Calculer et
                              visualiser », un export ou « Sauvegarder le projet » ;
  - puissance_projet_maj_le : date de cette mise à jour ;
  - puissance_projet_source : geste qui l'a déclenchée (calculer / export / sauvegarder).
Les projets existants partent à NULL (tiret) : la puissance s'affichera au prochain calcul ou export.
Appliquée automatiquement au déploiement (`flask preparer-base`).
"""
import sqlalchemy as sa
from alembic import op

revision = 'b3d8e1f4a926'
down_revision = 'a7e2c4b9d361'
branch_labels = None
depends_on = None

TABLE = 'parametres_projet'
COLONNES = (
    ('puissance_projet_kwc', sa.Float()),
    ('puissance_projet_maj_le', sa.DateTime()),
    ('puissance_projet_source', sa.String(length=20)),
)


def upgrade():
    existantes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom, type_ in COLONNES:
            if nom not in existantes:
                batch_op.add_column(sa.Column(nom, type_, nullable=True))


def downgrade():
    existantes = {c['name'] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom, _ in reversed(COLONNES):
            if nom in existantes:
                batch_op.drop_column(nom)
