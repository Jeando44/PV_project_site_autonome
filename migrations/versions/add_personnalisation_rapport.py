"""add personnalisation_rapport table + rapport_cover_label column

Revision ID: add_perso_rapport
Revises: de1141aff8af
Create Date: 2026-08-27

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_perso_rapport'
down_revision = 'de1141aff8af'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if 'personnalisation_rapport' not in inspector.get_table_names():
        op.create_table(
            'personnalisation_rapport',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.String(length=36), nullable=False),
            sa.Column('logo_base64', sa.Text(), nullable=True),
            sa.Column('nom_entreprise', sa.String(length=200), nullable=True),
            sa.Column('telephone', sa.String(length=50), nullable=True),
            sa.Column('adresse', sa.String(length=300), nullable=True),
            sa.Column('email', sa.String(length=200), nullable=True),
            sa.Column('site_web', sa.String(length=300), nullable=True),
            sa.Column('mission_text', sa.String(length=400), nullable=True),
            sa.Column('services_text', sa.String(length=400), nullable=True),
            sa.Column('stat_installations', sa.Integer(), nullable=True),
            sa.Column('stat_annees_experience', sa.Integer(), nullable=True),
            sa.Column('stat_clients_satisfaits_pct', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('personnalisation_rapport', schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f('ix_personnalisation_rapport_user_id'), ['user_id'], unique=True
            )
        print("Table 'personnalisation_rapport' creee avec succes")
    else:
        print("La table 'personnalisation_rapport' existe deja")

    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        columns = [col['name'] for col in inspector.get_columns('parametres_projet')]
        if 'rapport_cover_label' not in columns:
            batch_op.add_column(sa.Column('rapport_cover_label', sa.String(length=150), nullable=True))
            print("Colonne 'rapport_cover_label' ajoutee avec succes")
        else:
            print("La colonne 'rapport_cover_label' existe deja")


def downgrade():
    with op.batch_alter_table('parametres_projet', schema=None) as batch_op:
        batch_op.drop_column('rapport_cover_label')
    op.drop_table('personnalisation_rapport')
    print("Table 'personnalisation_rapport' et colonne 'rapport_cover_label' supprimees")
