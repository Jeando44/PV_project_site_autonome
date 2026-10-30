"""Données : typologie_projet ramenée à sa forme canonique (« Residentielle » -> « Résidentielle »)

Revision ID: f1a6d3c8b527
Revises: e3b9c7d1f482
Create Date: 2026-09-14

La variante sans accent, présente en base (projet historique), faisait réafficher la palette d'outils
Pro/Grand projet au rechargement d'un projet résidentiel. La lecture est désormais normalisée
(app/models/parametre_projet.py::normaliser_typologie) ; cette migration corrige aussi la donnée.
Seules les variantes d'accent / de casse / d'espaces des 3 typologies connues sont modifiées.
"""
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = 'f1a6d3c8b527'
down_revision = 'e3b9c7d1f482'
branch_labels = None
depends_on = None

TYPOLOGIES = ('Résidentielle', 'Professionnelle (C&I)', 'Grand projet')


def _cle(valeur):
    texte = unicodedata.normalize('NFD', str(valeur or ''))
    texte = ''.join(c for c in texte if unicodedata.category(c) != 'Mn')
    return ' '.join(texte.lower().split())


def upgrade():
    bind = op.get_bind()
    if 'parametres_projet' not in sa.inspect(bind).get_table_names():
        return
    projets = sa.table('parametres_projet', sa.column('id', sa.Integer), sa.column('typologie_projet', sa.String))
    canoniques = {_cle(t): t for t in TYPOLOGIES}
    lignes = bind.execute(sa.select(projets.c.id, projets.c.typologie_projet)
                          .where(projets.c.typologie_projet.isnot(None))).fetchall()
    for identifiant, typologie in lignes:
        cible = canoniques.get(_cle(typologie))
        if cible and cible != typologie:
            bind.execute(projets.update().where(projets.c.id == identifiant).values(typologie_projet=cible))


def downgrade():
    # Correction de donnée non réversible (la graphie d'origine n'est pas conservée) : sans effet.
    pass
