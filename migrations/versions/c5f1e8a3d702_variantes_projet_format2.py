"""Variantes de projet : copie complète (format 2) + une seule copie par lettre

Revision ID: c5f1e8a3d702
Revises: b3d8e1f4a926
Create Date: 2026-10-09

- projets_revisions.donnees (JSON) : copie complète de l'état de conception, cf.
  app/services/variantes_projet.py. Les anciennes colonnes (sans calepinage résidentiel) restent en
  lecture seule ; une copie sans `donnees` n'est plus restaurable.
- Suppression des Indices A vides créés automatiquement à la création du projet (« Création du
  projet », aucune donnée) : la variante A est désormais créée à la première sauvegarde du rapport.
  active_indice remis à NULL pour les projets qui n'ont plus aucune variante.
- Doublons (projet, lettre) supprimés en gardant la copie la plus récente, puis contrainte d'unicité.
Appliquée automatiquement au déploiement (`flask preparer-base`).
"""
import sqlalchemy as sa
from alembic import op

revision = 'c5f1e8a3d702'
down_revision = 'b3d8e1f4a926'
branch_labels = None
depends_on = None

TABLE = 'projets_revisions'
CONTRAINTE = 'uq_projets_revisions_projet_indice'
ANCIENNES_COLONNES = ('calepinage_data', 'geometrie_plans_data', 'irve_data',
                      'etude_economique_data', 'pompage_solaire_data')


def _vide(valeur):
    return valeur is None or (isinstance(valeur, str) and valeur.strip() in ('', 'null', '{}'))


def upgrade():
    bind = op.get_bind()
    inspecteur = sa.inspect(bind)
    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}

    if 'donnees' not in colonnes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.add_column(sa.Column('donnees', sa.JSON(), nullable=True))

    # Indices A vides (créés à la création du projet, jamais remplis)
    anciennes = [c for c in ANCIENNES_COLONNES if c in colonnes]
    lignes = bind.execute(sa.text(
        f"SELECT id, {', '.join(anciennes) if anciennes else 'NULL'} FROM {TABLE} WHERE indice = 'A'"
    )).fetchall()
    vides = [ligne[0] for ligne in lignes if all(_vide(v) for v in ligne[1:])]
    for id_ in vides:
        bind.execute(sa.text(f"DELETE FROM {TABLE} WHERE id = :id"), {'id': id_})

    # Doublons (projet, lettre) : on garde l'id le plus élevé (dernière copie écrite)
    doublons = bind.execute(sa.text(
        f"SELECT projet_id, UPPER(indice), MAX(id) FROM {TABLE} GROUP BY projet_id, UPPER(indice) HAVING COUNT(*) > 1"
    )).fetchall()
    for projet_id, indice, id_max in doublons:
        bind.execute(sa.text(
            f"DELETE FROM {TABLE} WHERE projet_id = :p AND UPPER(indice) = :i AND id <> :m"
        ), {'p': projet_id, 'i': indice, 'm': id_max})

    bind.execute(sa.text(
        f"UPDATE parametres_projet SET active_indice = NULL "
        f"WHERE id NOT IN (SELECT DISTINCT projet_id FROM {TABLE})"
    ))

    contraintes = {c['name'] for c in inspecteur.get_unique_constraints(TABLE)}
    if CONTRAINTE not in contraintes:
        with op.batch_alter_table(TABLE, schema=None) as batch_op:
            batch_op.create_unique_constraint(CONTRAINTE, ['projet_id', 'indice'])


def downgrade():
    inspecteur = sa.inspect(op.get_bind())
    contraintes = {c['name'] for c in inspecteur.get_unique_constraints(TABLE)}
    colonnes = {c['name'] for c in inspecteur.get_columns(TABLE)}
    with op.batch_alter_table(TABLE, schema=None) as batch_op:
        if CONTRAINTE in contraintes:
            batch_op.drop_constraint(CONTRAINTE, type_='unique')
        if 'donnees' in colonnes:
            batch_op.drop_column('donnees')
