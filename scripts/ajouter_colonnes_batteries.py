# -*- coding: utf-8 -*-
"""
Ajoute à la table `batteries` les colonnes introduites par la mise à jour « gestion des batteries »
(cf. app/models/equipements_pv.py). Idempotent : relançable sans risque, n'ajoute que ce qui manque.

    python scripts/ajouter_colonnes_batteries.py            # applique
    python scripts/ajouter_colonnes_batteries.py --verifier  # rapport seul, aucune écriture

POURQUOI PAS UNE MIGRATION ALEMBIC : l'historique du projet comporte déjà TROIS têtes de révision
(5b1e594f168d, add_created_by_name, add_option_reseau) — `flask db upgrade` échoue donc sur
« Multiple head revisions » avant même d'arriver à une nouvelle migration. Ajouter une quatrième
branche ne ferait qu'aggraver la situation. Ces colonnes sont toutes NULLABLE et ajoutées une par
une : un simple ALTER TABLE est sûr, sur SQLite comme sur MySQL. Quand l'historique aura été
fusionné (`flask db merge heads`), cette étape pourra redevenir une migration ordinaire.

`db.create_all()` (appelé au démarrage de l'application) ne suffit PAS : il crée les tables
absentes, jamais les colonnes manquantes d'une table existante.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402

# (nom de colonne, type SQL). Types volontairement génériques : FLOAT et VARCHAR sont compris
# aussi bien par SQLite que par MySQL.
COLONNES = [
    ('dod_max_pct', 'FLOAT'),
    ('raccordement_systeme', 'VARCHAR(100)'),
    ('tension_nominale_dc', 'VARCHAR(100)'),
    ('tension_systeme_mono_v', 'FLOAT'),
    ('tension_systeme_tri_v', 'FLOAT'),
    ('courant_max_charge_decharge_a', 'FLOAT'),
    ('poids_kg', 'FLOAT'),
    ('evolutivite_max', 'VARCHAR(200)'),
    ('lien_fiche_technique', 'VARCHAR(500)'),
]

TABLE = 'batteries'


def main():
    verifier_seulement = '--verifier' in sys.argv
    app = create_app()
    with app.app_context():
        inspecteur = inspect(db.engine)
        if TABLE not in inspecteur.get_table_names():
            print("Table « %s » absente : lancez d'abord l'application une fois "
                  "(db.create_all la créera)." % TABLE)
            return 1

        existantes = {c['name'] for c in inspecteur.get_columns(TABLE)}
        manquantes = [(nom, sql) for nom, sql in COLONNES if nom not in existantes]

        print('Base    : %s' % db.engine.url.render_as_string(hide_password=True))
        print('Table   : %s (%d colonnes)' % (TABLE, len(existantes)))
        print('À ajouter : %d' % len(manquantes))

        if not manquantes:
            print('Rien à faire — toutes les colonnes sont déjà présentes.')
            return 0

        for nom, sql in manquantes:
            print('   - %-32s %s' % (nom, sql))

        if verifier_seulement:
            print('')
            print('(--verifier : aucune écriture effectuée)')
            return 0

        print('')
        for nom, sql in manquantes:
            # Une instruction par colonne : SQLite n'accepte pas plusieurs ADD COLUMN en une fois,
            # et un échec isolé n'empêche pas les suivantes d'aboutir.
            db.session.execute(text('ALTER TABLE %s ADD COLUMN %s %s' % (TABLE, nom, sql)))
            print('   ajoutée : %s' % nom)
        db.session.commit()

        restantes = {c['name'] for c in inspect(db.engine).get_columns(TABLE)}
        manque_encore = [nom for nom, _ in COLONNES if nom not in restantes]
        if manque_encore:
            print('')
            print('ATTENTION — colonnes toujours absentes : %s' % ', '.join(manque_encore))
            return 1
        print('')
        print('Terminé : les %d colonnes sont en place.' % len(COLONNES))
        return 0


if __name__ == '__main__':
    sys.exit(main())
