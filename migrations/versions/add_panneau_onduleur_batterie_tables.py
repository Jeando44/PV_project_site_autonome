"""add panneaux, onduleurs, batteries tables

Revision ID: add_equip_pv_tables
Revises: add_load_curve_irve
Create Date: 2026-08-19

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_equip_pv_tables'
down_revision = 'add_load_curve_irve'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'panneaux' not in existing_tables:
        op.create_table(
            'panneaux',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('fabricant', sa.String(length=100), nullable=False),
            sa.Column('reference', sa.String(length=150), nullable=False),
            sa.Column('puissance_wc', sa.Float(), nullable=False),
            sa.Column('longueur_mm', sa.Float(), nullable=True),
            sa.Column('largeur_mm', sa.Float(), nullable=True),
            sa.Column('epaisseur_mm', sa.Float(), nullable=True),
            sa.Column('i_mpp', sa.Float(), nullable=True),
            sa.Column('i_sc', sa.Float(), nullable=True),
            sa.Column('v_mpp', sa.Float(), nullable=True),
            sa.Column('v_oc', sa.Float(), nullable=True),
            sa.Column('coef_voc_pct_c', sa.Float(), nullable=True),
            sa.Column('coef_isc_pct_c', sa.Float(), nullable=True),
            sa.Column('coef_pmax_pct_c', sa.Float(), nullable=True),
            sa.Column('type_module', sa.String(length=100), nullable=True),
            sa.Column('nb_cellules', sa.Integer(), nullable=True),
            sa.Column('tension_systeme_max', sa.Float(), nullable=True, server_default='1500'),
            sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('panneaux', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_panneaux_reference'), ['reference'], unique=True)
            batch_op.create_index(batch_op.f('ix_panneaux_is_active'), ['is_active'], unique=False)
        print("Table 'panneaux' creee avec succes")
    else:
        print("La table 'panneaux' existe deja")

    if 'onduleurs' not in existing_tables:
        op.create_table(
            'onduleurs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('fabricant', sa.String(length=100), nullable=False),
            sa.Column('reference', sa.String(length=150), nullable=False),
            sa.Column('puissance_max_dc_kw', sa.Float(), nullable=True),
            sa.Column('p_nominale_kva', sa.Float(), nullable=True),
            sa.Column('p_apparente_max_kva', sa.Float(), nullable=True),
            sa.Column('nb_entrees_mppt', sa.Integer(), nullable=True),
            sa.Column('nb_mppt_par_entree', sa.Integer(), nullable=True),
            sa.Column('tension_max_dc', sa.Float(), nullable=True),
            sa.Column('tension_min_dc', sa.Float(), nullable=True),
            sa.Column('plage_mppt_min', sa.Float(), nullable=True),
            sa.Column('plage_mppt_max', sa.Float(), nullable=True),
            sa.Column('courant_max_mppt', sa.Float(), nullable=True),
            sa.Column('rendement_max_pct', sa.Float(), nullable=True),
            sa.Column('rendement_europeen_pct', sa.Float(), nullable=True),
            sa.Column('courant_max_sortie_ac', sa.Float(), nullable=True),
            sa.Column('type_tension', sa.String(length=50), nullable=True),
            sa.Column('tension_nominale_ac', sa.String(length=100), nullable=True),
            sa.Column('compat_optimiseur', sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column('hybride', sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column('poids_kg', sa.Float(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('onduleurs', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_onduleurs_reference'), ['reference'], unique=True)
            batch_op.create_index(batch_op.f('ix_onduleurs_is_active'), ['is_active'], unique=False)
        print("Table 'onduleurs' creee avec succes")
    else:
        print("La table 'onduleurs' existe deja")

    if 'batteries' not in existing_tables:
        op.create_table(
            'batteries',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('fabricant', sa.String(length=100), nullable=False),
            sa.Column('reference', sa.String(length=150), nullable=False),
            sa.Column('chimie', sa.String(length=50), nullable=True),
            sa.Column('capacite_nominale_kwh', sa.Float(), nullable=True),
            sa.Column('capacite_utilisable_kwh', sa.Float(), nullable=True),
            sa.Column('compatibilite_systeme', sa.String(length=100), nullable=True),
            sa.Column('type_couplage', sa.String(length=20), nullable=True),
            sa.Column('soc_min_pct', sa.Float(), nullable=True, server_default='0'),
            sa.Column('soc_max_pct', sa.Float(), nullable=True, server_default='100'),
            sa.Column('puissance_charge_kw', sa.Float(), nullable=True),
            sa.Column('puissance_decharge_kw', sa.Float(), nullable=True),
            sa.Column('round_trip_efficiency_pct', sa.Float(), nullable=True),
            sa.Column('courant_max_sortie_triphase_ac', sa.Float(), nullable=True),
            sa.Column('tension_nominale_ac', sa.String(length=50), nullable=True),
            sa.Column('tension_fonctionnement_triphase', sa.String(length=50), nullable=True),
            sa.Column('tension_fonctionnement_monophase', sa.String(length=50), nullable=True),
            sa.Column('conso_aux_monophase_kw', sa.Float(), nullable=True),
            sa.Column('conso_veille_w', sa.Float(), nullable=True),
            sa.Column('dimensions_mm', sa.String(length=100), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        with op.batch_alter_table('batteries', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_batteries_reference'), ['reference'], unique=True)
            batch_op.create_index(batch_op.f('ix_batteries_is_active'), ['is_active'], unique=False)
        print("Table 'batteries' creee avec succes")
    else:
        print("La table 'batteries' existe deja")


def downgrade():
    op.drop_table('batteries')
    op.drop_table('onduleurs')
    op.drop_table('panneaux')
    print("Tables 'panneaux', 'onduleurs', 'batteries' supprimees")
