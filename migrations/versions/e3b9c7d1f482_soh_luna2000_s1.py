"""Données : état de santé en fin de vie des Huawei LUNA2000-5/7/10/12/14/15/17/19/21-S1 = 60 %

Revision ID: e3b9c7d1f482
Revises: d4e8a2b6c150
Create Date: 2026-09-14

Valeur de garantie constructeur communiquée par l'utilisateur. Posée UNIQUEMENT sur les lignes dont
le SoH n'est pas encore renseigné : une valeur saisie entre-temps dans l'admin n'est jamais écrasée.
À reporter aussi dans Materiels_BD.xlsx (colonne « SOH_Fin_De_Vie (%) ») : le fichier contient des
images qu'une écriture automatique supprimerait, il est donc mis à jour à la main.
"""
import sqlalchemy as sa
from alembic import op

revision = 'e3b9c7d1f482'
down_revision = 'd4e8a2b6c150'
branch_labels = None
depends_on = None

REFERENCES = tuple('LUNA2000-%s-S1' % n for n in (5, 7, 10, 12, 14, 15, 17, 19, 21))
SOH_PCT = 60.0


def _colonne_presente():
    inspecteur = sa.inspect(op.get_bind())
    return ('batteries' in inspecteur.get_table_names()
            and 'soh_fin_vie_pct' in {c['name'] for c in inspecteur.get_columns('batteries')})


def upgrade():
    if not _colonne_presente():
        return
    batteries = sa.table('batteries', sa.column('reference', sa.String), sa.column('soh_fin_vie_pct', sa.Float))
    op.execute(batteries.update()
               .where(batteries.c.reference.in_(REFERENCES))
               .where(batteries.c.soh_fin_vie_pct.is_(None))
               .values(soh_fin_vie_pct=SOH_PCT))


def downgrade():
    if not _colonne_presente():
        return
    batteries = sa.table('batteries', sa.column('reference', sa.String), sa.column('soh_fin_vie_pct', sa.Float))
    op.execute(batteries.update()
               .where(batteries.c.reference.in_(REFERENCES))
               .where(batteries.c.soh_fin_vie_pct == SOH_PCT)
               .values(soh_fin_vie_pct=None))
