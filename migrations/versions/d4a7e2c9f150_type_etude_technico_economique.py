"""Type d'étude : « Pré-étude de faisabilité » (affichée « Offre commerciale ») -> « Étude technico-économique »

Revision ID: d4a7e2c9f150
Revises: c5f1e8a3d702
Create Date: 2026-10-09

Migration de DONNÉES uniquement (colonnes texte libre, aucun changement de schéma) :
parametres_projet.type_etude et normes_calcul.type_etude. Les variantes d'écriture de l'ancienne
valeur (avec/sans accents, casse) sont reconnues en Python plutôt qu'en SQL, pour ne pas dépendre
de la collation MySQL/SQLite. Idempotente. Le code accepte encore l'ancienne valeur
(app.models.parametre_projet.normaliser_type_etude), au cas où une base ne serait pas migrée.
Appliquée automatiquement au déploiement (`flask preparer-base`).
"""
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = 'd4a7e2c9f150'
down_revision = 'c5f1e8a3d702'
branch_labels = None
depends_on = None

TABLES = ('parametres_projet', 'normes_calcul')
NOUVELLE = 'Étude technico-économique'
ANCIENNE = 'Pré-étude de faisabilité'


def _cle(valeur):
    texte = unicodedata.normalize('NFD', str(valeur or ''))
    texte = ''.join(c for c in texte if unicodedata.category(c) != 'Mn')
    return ' '.join(texte.lower().split())


def _est_ancienne(valeur):
    cle = _cle(valeur)
    return 'pre-etude' in cle or 'preetude' in cle


def _remplacer(predicat, valeur_cible):
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table in TABLES:
        if table not in tables:
            continue
        lignes = bind.execute(sa.text(
            f"SELECT id, type_etude FROM {table} WHERE type_etude IS NOT NULL"
        )).fetchall()
        ids = [id_ for id_, valeur in lignes if predicat(valeur)]
        for id_ in ids:
            bind.execute(sa.text(f"UPDATE {table} SET type_etude = :v WHERE id = :id"),
                         {'v': valeur_cible, 'id': id_})


def upgrade():
    _remplacer(_est_ancienne, NOUVELLE)


def downgrade():
    _remplacer(lambda v: _cle(v) == _cle(NOUVELLE), ANCIENNE)
