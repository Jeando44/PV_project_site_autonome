"""add consommation_files_acc table

Revision ID: add_consommation_files_acc
Revises: add_pompage_solaire_configs
Create Date: 2026-09-28

Persistance en base des courbes de charge des participants d'une ACC (une ligne par participant,
rattachée au projet) — jusqu'ici uniquement dans l'IndexedDB du navigateur (clés globales
'accFile_<nom>'). db.create_all() crée aussi la table au démarrage ; cette migration garde
l'historique Alembic aligné sur le modèle.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_consommation_files_acc'
down_revision = 'add_pompage_solaire_configs'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if sa.inspect(bind).has_table('consommation_files_acc'):
        # Déjà créée par db.create_all() au démarrage de l'application.
        return
    op.create_table(
        'consommation_files_acc',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('parametre_projet_id', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(length=100), nullable=False),
        sa.Column('original_name', sa.String(length=255), nullable=False),
        sa.Column('custom_name', sa.String(length=255), nullable=True),
        sa.Column('content_type', sa.String(length=150), nullable=False),
        sa.Column('file_data', sa.LargeBinary(), nullable=False),
        sa.Column('time_step', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('prm', sa.String(length=14), nullable=True),
        sa.Column('annee', sa.String(length=16), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['parametre_projet_id'], ['parametres_projet.id'],
                                name='fk_consommation_files_acc_projet_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('parametre_projet_id', 'original_name', name='uq_consommation_acc_projet_nom'),
    )
    with op.batch_alter_table('consommation_files_acc', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_consommation_files_acc_parametre_projet_id'),
                              ['parametre_projet_id'], unique=False)


def downgrade():
    with op.batch_alter_table('consommation_files_acc', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_consommation_files_acc_parametre_projet_id'))
    op.drop_table('consommation_files_acc')
