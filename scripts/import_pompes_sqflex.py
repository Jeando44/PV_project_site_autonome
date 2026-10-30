# -*- coding: utf-8 -*-
"""
Importe (ou met à jour) les pompes Grundfos SQFlex dans la base de l'application, à partir de
scripts/donnees/pompes_sqflex_grundfos.json (généré par scripts/extraire_pompes_sqflex.py).

Même règle que l'import JSON de l'administration des matériels : rapprochement par référence, seules
les colonnes connues de PompeSolaire sont écrites, les autres pompes ne sont pas touchées.

En production, préférer « Administration des matériels > Importer JSON » avec le même fichier (aucun
accès direct à la base de production nécessaire).

Lancement (racine du dépôt) :
    python scripts/import_pompes_sqflex.py --simulation   # affiche ce qui serait fait, n'écrit rien
    python scripts/import_pompes_sqflex.py
"""
import argparse
import json
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)
FICHIER_DEFAUT = os.path.join(RACINE, 'scripts', 'donnees', 'pompes_sqflex_grundfos.json')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fichier', default=FICHIER_DEFAUT)
    parser.add_argument('--simulation', action='store_true', help="n'écrit rien en base")
    args = parser.parse_args()

    with open(args.fichier, encoding='utf-8') as f:
        lignes = json.load(f).get('pompe_solaire') or []

    from app import create_app
    from app.extensions import db
    from app.models.equipements_pv import PompeSolaire
    from app.routes.admin_materiels import POMPE_SOLAIRE_FIELDS

    autorises = {nom for nom, *_ in POMPE_SOLAIRE_FIELDS}
    app = create_app()
    with app.app_context():
        print(f"Base : {db.engine.dialect.name}")
        crees, maj = [], []
        for brut in lignes:
            valeurs = {k: v for k, v in brut.items() if k in autorises}
            existant = PompeSolaire.query.filter_by(reference=valeurs['reference']).first()
            if existant:
                for k, v in valeurs.items():
                    setattr(existant, k, v)
                maj.append(valeurs['reference'])
            else:
                db.session.add(PompeSolaire(**valeurs))
                crees.append(valeurs['reference'])
        if args.simulation:
            db.session.rollback()
            print('SIMULATION : rien n\'a été écrit.')
        else:
            db.session.commit()
        print(f"{len(crees)} créée(s) : {', '.join(crees) or '-'}")
        print(f"{len(maj)} mise(s) à jour : {', '.join(maj) or '-'}")
        hors_fichier = [p.reference for p in PompeSolaire.query.filter(PompeSolaire.fabricant == 'Grundfos').all()
                        if p.reference not in {l['reference'] for l in lignes}]
        if hors_fichier:
            print(f"Grundfos en base absentes du livret (non modifiées) : {', '.join(hors_fichier)}")


if __name__ == '__main__':
    main()
