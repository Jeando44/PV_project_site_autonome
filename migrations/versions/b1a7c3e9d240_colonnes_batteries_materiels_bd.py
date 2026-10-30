"""Colonnes batteries issues de Materiels_BD.xlsx (DoD, tensions par phase, poids, évolutivité...)

Revision ID: b1a7c3e9d240
Revises: 5b1e594f168d
Create Date: 2026-09-13

Ces 9 colonnes ont d'abord été posées par un script ponctuel
(scripts/ajouter_colonnes_batteries.py) sur la base de développement. Sans cette migration, une base
reconstruite depuis zéro par `flask db upgrade` — la production, notamment — ne les aurait jamais
eues, et l'import des batteries aurait échoué.

IDEMPOTENTE PAR CONSTRUCTION : chaque colonne n'est ajoutée que si elle est absente. C'est
indispensable ici, parce que les bases de ce projet ont été patchées à la main au fil du temps
(ALTER TABLE lancés un par un lors des déploiements) : leur schéma réel diffère d'une instance à
l'autre, et une migration qui présumerait l'absence des colonnes échouerait sur la moitié d'entre
elles. Le même raisonnement vaut pour le downgrade.
"""
import sqlalchemy as sa
from alembic import op

revision = 'b1a7c3e9d240'
down_revision = '5b1e594f168d'
branch_labels = None
depends_on = None

TABLE = 'batteries'

COLONNES = [
    ('dod_max_pct', sa.Float()),
    ('raccordement_systeme', sa.String(length=100)),
    ('tension_nominale_dc', sa.String(length=100)),
    ('tension_systeme_mono_v', sa.Float()),
    ('tension_systeme_tri_v', sa.Float()),
    ('courant_max_charge_decharge_a', sa.Float()),
    ('poids_kg', sa.Float()),
    ('evolutivite_max', sa.String(length=200)),
    ('lien_fiche_technique', sa.String(length=500)),
]


def _colonnes_existantes():
    inspecteur = sa.inspect(op.get_bind())
    if TABLE not in inspecteur.get_table_names():
        return None  # table absente : rien à faire, create_all/une migration antérieure s'en charge
    return {c['name'] for c in inspecteur.get_columns(TABLE)}


def upgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    manquantes = [(nom, type_) for nom, type_ in COLONNES if nom not in existantes]
    if not manquantes:
        return
    # batch_alter_table : requis par SQLite, qui ne sait pas modifier une table en place.
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom, type_ in manquantes:
            batch_op.add_column(sa.Column(nom, type_, nullable=True))


def downgrade():
    existantes = _colonnes_existantes()
    if existantes is None:
        return
    presentes = [nom for nom, _ in COLONNES if nom in existantes]
    if not presentes:
        return
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        for nom in presentes:
            batch_op.drop_column(nom)
