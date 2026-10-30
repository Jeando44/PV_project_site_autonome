"""colonne charge_etudes (Chargé(e) d'études) sur parametres_projet

Revision ID: add_charge_etudes
Revises: add_acc_participant_localisation
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_charge_etudes'
down_revision = 'add_acc_participant_localisation'
branch_labels = None
depends_on = None


def upgrade():
    columns = [c['name'] for c in sa.inspect(op.get_bind()).get_columns('parametres_projet')]
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        if 'charge_etudes' not in columns:
            batch_op.add_column(sa.Column('charge_etudes', sa.String(length=30), nullable=True))
            print("Colonne 'charge_etudes' ajoutee avec succes")
        else:
            print("La colonne 'charge_etudes' existe deja")


def downgrade():
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('charge_etudes')
