"""localisation des participants ACC (adresse, latitude, longitude)

Revision ID: add_acc_participant_localisation
Revises: add_ombriere_dossier_tables
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_acc_participant_localisation'
down_revision = 'add_ombriere_dossier_tables'
branch_labels = None
depends_on = None

COLONNES = (
    ('adresse', sa.String(length=500)),
    ('latitude', sa.Float()),
    ('longitude', sa.Float()),
)


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if 'consommation_files_acc' not in inspector.get_table_names():
        print("Table 'consommation_files_acc' absente : rien a faire")
        return
    # `flask preparer-base` ajoute deja les colonnes manquantes avant upgrade() : idempotent.
    existantes = {c['name'] for c in inspector.get_columns('consommation_files_acc')}
    with op.batch_alter_table('consommation_files_acc') as batch_op:
        for nom, type_ in COLONNES:
            if nom not in existantes:
                batch_op.add_column(sa.Column(nom, type_, nullable=True))
                print(f"Colonne consommation_files_acc.{nom} ajoutee")


def downgrade():
    with op.batch_alter_table('consommation_files_acc') as batch_op:
        for nom, _ in reversed(COLONNES):
            batch_op.drop_column(nom)
