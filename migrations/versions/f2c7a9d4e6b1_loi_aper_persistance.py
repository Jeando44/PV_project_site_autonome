"""Loi APER en base : polygones, % solarisables et surface projetée du calepinage résidentiel

Revision ID: f2c7a9d4e6b1
Revises: e4b8d1a6c372
Create Date: 2026-10-17

Remplace le localStorage du calculateur Loi APER (calcul_APER.js) :
  - aper_configs   : % Solarisable APER / Huwart (valeur + libellé), une ligne par projet ;
  - aper_polygones : un polygone APER par ligne (surface « + » / exclusion « - »), rattaché au
                     projet et à la lettre de sa variante (indice_projet) ;
  - parametres_projet.surface_projetee_maison_m2 : surface projetée au sol des panneaux du
                     calepinage résidentiel enregistré (« Surface projetée champ PV »).
Tables propres à la variante (registre de app/services/variantes_projet.py). Les projets existants
partent sans saisie APER (les anciennes saisies du navigateur ne sont pas reprises : elles n'étaient
pas fiables d'un projet à l'autre) et avec une surface projetée inconnue, complétée à la prochaine
sauvegarde du calepinage.

Appliquée automatiquement au déploiement (`flask preparer-base`) ; idempotente (tables déjà créées
par create_all, colonne déjà présente).
"""
import sqlalchemy as sa
from alembic import op

revision = 'f2c7a9d4e6b1'
down_revision = 'e4b8d1a6c372'
branch_labels = None
depends_on = None

TABLE_PROJET = 'parametres_projet'
COLONNE_SURFACE = 'surface_projetee_maison_m2'


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if 'aper_configs' not in tables:
        op.create_table(
            'aper_configs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('projet_id', sa.Integer(),
                      sa.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_aper_configs_projet_id'),
                      nullable=False),
            sa.Column('indice_projet', sa.String(length=1), nullable=True),
            sa.Column('pourcent_solarisable_aper', sa.Float(), nullable=True),
            sa.Column('libelle_solarisable_aper', sa.String(length=100), nullable=True),
            sa.Column('pourcent_solarisable_huwart', sa.Float(), nullable=True),
            sa.Column('libelle_solarisable_huwart', sa.String(length=100), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_aper_configs_projet_id', 'aper_configs', ['projet_id'], unique=True)

    if 'aper_polygones' not in tables:
        op.create_table(
            'aper_polygones',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('projet_id', sa.Integer(),
                      sa.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_aper_polygones_projet_id'),
                      nullable=False),
            sa.Column('indice_projet', sa.String(length=1), nullable=True),
            sa.Column('type_polygone', sa.String(length=20), nullable=False),
            sa.Column('ordre', sa.Integer(), nullable=False),
            sa.Column('coordonnees', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_aper_polygones_projet_id', 'aper_polygones', ['projet_id'], unique=False)

    existantes = {c['name'] for c in inspector.get_columns(TABLE_PROJET)}
    if COLONNE_SURFACE not in existantes:
        with op.batch_alter_table(TABLE_PROJET, schema=None) as batch_op:
            batch_op.add_column(sa.Column(COLONNE_SURFACE, sa.Float(), nullable=True))


def downgrade():
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    existantes = {c['name'] for c in inspector.get_columns(TABLE_PROJET)}
    if COLONNE_SURFACE in existantes:
        with op.batch_alter_table(TABLE_PROJET, schema=None) as batch_op:
            batch_op.drop_column(COLONNE_SURFACE)

    if 'aper_polygones' in tables:
        op.drop_index('ix_aper_polygones_projet_id', table_name='aper_polygones')
        op.drop_table('aper_polygones')
    if 'aper_configs' in tables:
        op.drop_index('ix_aper_configs_projet_id', table_name='aper_configs')
        op.drop_table('aper_configs')
