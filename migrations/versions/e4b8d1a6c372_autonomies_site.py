"""add autonomies_site (pré-dimensionnement site isolé enregistré par le serveur pour l'étude éco)

Revision ID: e4b8d1a6c372
Revises: d7a2c9e4f158
Create Date: 2026-10-13

Consommation annuelle d'énergie du site (et besoin journalier, puissance PV nécessaire) calculée par
/api/consommation/calculer_autonomie, écrite par cette route et relue par la modale « Études
économiques » d'un projet Site autonome / Hybride (consommation du site + taux de couverture PV).
Table propre à la variante (registre de app/services/variantes_projet.py).

Appliquée automatiquement au déploiement (`flask preparer-base`, lancé par entrypoint.sh) : la
table est d'abord créée par create_all (modèle déclaré), cette révision ne fait alors rien.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e4b8d1a6c372'
down_revision = 'd7a2c9e4f158'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'autonomies_site' in inspector.get_table_names():
        return
    op.create_table(
        'autonomies_site',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('projet_id', sa.Integer(),
                  sa.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_autonomies_site_projet_id'),
                  nullable=False),
        sa.Column('besoin_journalier_kwh', sa.Float(), nullable=True),
        sa.Column('consommation_annuelle_kwh', sa.Float(), nullable=True),
        sa.Column('puissance_pv_necessaire_kwc', sa.Float(), nullable=True),
        sa.Column('calcule_le', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_autonomies_site_projet_id', 'autonomies_site', ['projet_id'], unique=True)


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'autonomies_site' not in inspector.get_table_names():
        return
    op.drop_index('ix_autonomies_site_projet_id', table_name='autonomies_site')
    op.drop_table('autonomies_site')
