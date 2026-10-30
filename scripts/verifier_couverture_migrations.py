# -*- coding: utf-8 -*-
"""Les migrations suffisent-elles a construire le schema complet, sans db.create_all() ?

Reconstruit une base VIERGE avec le seul `flask db upgrade`, puis compare la liste des tables
obtenues a celle que les modeles SQLAlchemy definissent. Toute table manquante est une table que
create_all() creait silencieusement au demarrage — donc une table qui disparaitrait si on retirait
create_all() du chemin de production.
"""
import os
import sqlite3
import sys

# Lance depuis scripts/ : la racine du projet doit etre sur le chemin d'import.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('FLASK_SECRET_KEY', 'test-local-uniquement')

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from flask_migrate import upgrade  # noqa: E402

chemin = os.path.abspath(os.path.join('instance', 'test_vierge.db'))
if os.path.exists(chemin):
    os.remove(chemin)

app = create_app()
with app.app_context():
    modeles = set(db.metadata.tables.keys())

uri = 'sqlite:///' + chemin.replace(os.sep, '/')
app.config['SQLALCHEMY_DATABASE_URI'] = uri
with app.app_context():
    db.engine.dispose()
    upgrade()

con = sqlite3.connect(chemin)
migrees = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
con.close()
migrees -= {'alembic_version', 'sqlite_sequence'}

print('')
print('Tables definies par les MODELES  : %d' % len(modeles))
print('Tables creees par les MIGRATIONS : %d' % len(migrees))
manquantes = sorted(modeles - migrees)
print('')
if manquantes:
    print('ABSENTES des migrations (%d) — create_all() les creait silencieusement :' % len(manquantes))
    for t in manquantes:
        print('   -', t)
else:
    print('Aucune table manquante : les migrations suffisent a elles seules.')
sys.exit(1 if manquantes else 0)
