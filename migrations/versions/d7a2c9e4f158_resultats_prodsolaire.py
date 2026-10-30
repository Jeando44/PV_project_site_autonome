"""add resultats_prodsolaire (résultats ProSolaire enregistrés par le serveur pour l'étude éco)

Revision ID: d7a2c9e4f158
Revises: c5e8a3f1d742
Create Date: 2026-10-13

Puissance installée, productible spécifique, taux d'autoconsommation initial et parts hiver/été de
la production autoconsommée du dernier calcul ProSolaire d'un projet (+ résultat du stockage),
écrits par les routes de calcul et relus par la modale « Études économiques ». Table propre à la
variante (registre de app/services/variantes_projet.py).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7a2c9e4f158'
down_revision = 'c5e8a3f1d742'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'resultats_prodsolaire' in inspector.get_table_names():
        return
    op.create_table(
        'resultats_prodsolaire',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('projet_id', sa.Integer(),
                  sa.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_resultats_prodsolaire_projet_id'),
                  nullable=False),
        sa.Column('type_etude', sa.String(length=20), nullable=False),
        sa.Column('source_production', sa.String(length=20), nullable=False, server_default='calcul'),
        sa.Column('puissance_kwc', sa.Float(), nullable=True),
        sa.Column('productible_kwh_kwc', sa.Float(), nullable=True),
        sa.Column('taux_autoconso_pct', sa.Float(), nullable=True),
        sa.Column('part_hiver_pct', sa.Float(), nullable=True),
        sa.Column('part_ete_pct', sa.Float(), nullable=True),
        sa.Column('empreinte_courbes', sa.String(length=64), nullable=True),
        sa.Column('calcule_le', sa.DateTime(), nullable=True),
        sa.Column('stockage', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_resultats_prodsolaire_projet_id', 'resultats_prodsolaire', ['projet_id'], unique=True)


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'resultats_prodsolaire' not in inspector.get_table_names():
        return
    op.drop_index('ix_resultats_prodsolaire_projet_id', table_name='resultats_prodsolaire')
    op.drop_table('resultats_prodsolaire')
