"""Données : pompes Grundfos SQFlex (22 références, courbes de performance comprises)

Revision ID: a7e2c4b9d361
Revises: f9c3a1d7e214
Create Date: 2026-10-08

Migration de DONNÉES, appliquée automatiquement au déploiement (`flask preparer-base`) : aucune
manipulation dans l'administration des matériels n'est nécessaire.

Ne touche QUE la table `pompes_solaires`, et seulement les références présentes dans
scripts/donnees/pompes_sqflex_grundfos.json (généré par scripts/extraire_pompes_sqflex.py) :
  - référence déjà en base -> ses champs sont mis à jour ;
  - référence absente -> elle est créée.
Panneaux, onduleurs, batteries, optimiseurs et les autres pompes (Lorentz, SQF 11A-3...) ne sont pas
lus ni modifiés. Rejouable sans risque (même résultat).

Une mise à jour ULTÉRIEURE du fichier JSON ne sera pas reprise par cette migration (Alembic ne
l'exécute qu'une fois par base) : la réimporter alors par l'administration (« Importer JSON ») ou
par une nouvelle migration du même modèle.
"""
import json
import os
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = 'a7e2c4b9d361'
down_revision = 'f9c3a1d7e214'
branch_labels = None
depends_on = None

TABLE = 'pompes_solaires'
FICHIER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                       'scripts', 'donnees', 'pompes_sqflex_grundfos.json')


def upgrade():
    bind = op.get_bind()
    inspecteur = sa.inspect(bind)
    if TABLE not in inspecteur.get_table_names():
        print(f"Table '{TABLE}' absente : rien a faire")
        return
    if not os.path.exists(FICHIER):
        print(f"Fichier {FICHIER} absent : pompes SQFlex non importees")
        return
    with open(FICHIER, encoding='utf-8') as f:
        lignes = json.load(f).get('pompe_solaire') or []

    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    table = sa.table(TABLE, *[sa.column(nom) for nom in colonnes])
    maintenant = datetime.utcnow()
    crees = maj = 0
    for brut in lignes:
        valeurs = {k: v for k, v in brut.items() if k in colonnes and k not in ('id', 'created_at', 'updated_at')}
        if not valeurs.get('reference') or not valeurs.get('fabricant'):
            continue
        existe = bind.execute(sa.select(table.c.id).where(table.c.reference == valeurs['reference'])).first()
        if existe:
            bind.execute(table.update().where(table.c.id == existe[0]).values(updated_at=maintenant, **valeurs))
            maj += 1
        else:
            bind.execute(table.insert().values(created_at=maintenant, updated_at=maintenant, **valeurs))
            crees += 1
    print(f"Pompes SQFlex : {crees} creee(s), {maj} mise(s) a jour (table {TABLE} uniquement)")


def downgrade():
    # Données : rien à défaire (les colonnes sont retirées par f9c3a1d7e214 si besoin).
    pass
