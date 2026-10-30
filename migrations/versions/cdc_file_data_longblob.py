"""file_data des courbes de charge (ACI et ACC) en LONGBLOB sur MySQL

Un BLOB MySQL est plafonne a 64 Ko : l'import d'une courbe annuelle .xlsx (plusieurs centaines de Ko)
echouait avec l'erreur 1406 « Data too long for column 'file_data' ».

Revision ID: cdc_file_data_longblob
Revises: add_charge_etudes
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGBLOB


# revision identifiers, used by Alembic.
revision = 'cdc_file_data_longblob'
down_revision = 'add_charge_etudes'
branch_labels = None
depends_on = None

TABLES = ('consommation_files', 'consommation_files_acc')


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != 'mysql':
        print("Base non MySQL : LargeBinary deja sans limite, rien a faire")
        return
    tables = sa.inspect(bind).get_table_names()
    for table in TABLES:
        if table not in tables:
            print(f"Table '{table}' absente : rien a faire")
            continue
        op.alter_column(table, 'file_data', existing_type=sa.LargeBinary(),
                        type_=LONGBLOB(), existing_nullable=False)
        print(f"Colonne {table}.file_data passee en LONGBLOB")


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != 'mysql':
        return
    for table in TABLES:
        op.alter_column(table, 'file_data', existing_type=LONGBLOB(),
                        type_=sa.LargeBinary(), existing_nullable=False)
