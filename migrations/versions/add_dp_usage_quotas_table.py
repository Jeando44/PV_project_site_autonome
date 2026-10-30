"""add dp_usage_quotas table

Revision ID: add_dp_usage_quotas
Revises: f1a6d3c8b527
Create Date: 2026-09-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_dp_usage_quotas'
down_revision = 'f1a6d3c8b527'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'dp_usage_quotas' not in existing_tables:
        op.create_table(
            'dp_usage_quotas',
            sa.Column('user_id', sa.String(length=36), primary_key=True),
            sa.Column('period', sa.String(length=7), nullable=False),
            sa.Column('request_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        print("Table 'dp_usage_quotas' creee avec succes")
    else:
        print("La table 'dp_usage_quotas' existe deja")


def downgrade():
    op.drop_table('dp_usage_quotas')
    print("Table 'dp_usage_quotas' supprimee")
