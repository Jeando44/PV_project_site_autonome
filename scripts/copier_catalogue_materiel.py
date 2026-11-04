"""
Copie le catalogue de matériel (7 tables) d'une base source vers la base de production du site
autonome, juste après sa création.

POURQUOI
--------
La base MySQL du site autonome est neuve : `flask preparer-base` (lancé par entrypoint.sh au premier
démarrage Cloud Run) crée le schéma, mais les tables du catalogue restent vides — plus aucun panneau,
onduleur, batterie ni pompe proposé. Ce script recopie le catalogue de la base locale
(instance/site_autonome.db) en conservant les identifiants (les tables de compatibilité y font
référence).

UTILISATION (depuis le poste, une fois le service déployé au moins une fois)
---------------------------------------------------------------------------
1. Ouvrir un accès local à l'instance Cloud SQL (Cloud SQL Auth Proxy sur 127.0.0.1:3306, par ex.).
2. Lancer, depuis la racine du projet :
       set CIBLE_DATABASE_URL=mysql+pymysql://UTILISATEUR:MOT_DE_PASSE@127.0.0.1:3306/NOM_BASE?charset=utf8mb4
       Skvenv313\\Scripts\\python.exe scripts\\copier_catalogue_materiel.py            (contrôle seul)
       Skvenv313\\Scripts\\python.exe scripts\\copier_catalogue_materiel.py --ecrire   (copie)
   Mot de passe avec caractères spéciaux : l'encoder (@ -> %40, ! -> %21, # -> %23...).

Sans --ecrire, rien n'est écrit : le script affiche ce qu'il copierait. Une table cible déjà remplie
est laissée intacte, sauf avec --remplacer (vide puis recopie les 7 tables).
"""
import argparse
import os
import sys

import sqlalchemy as sa

# Parents d'abord : les tables de compatibilité référencent onduleurs, batteries et optimiseurs.
TABLES = [
    'panneaux',
    'onduleurs',
    'batteries',
    'optimiseurs',
    'pompes_solaires',
    'batterie_onduleur_compat',
    'optimiseur_onduleur_compat',
]

SOURCE_PAR_DEFAUT = 'sqlite:///' + os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'instance', 'site_autonome.db'
)


def _url_masquee(url):
    return sa.engine.make_url(url).render_as_string(hide_password=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', default=os.getenv('SOURCE_DATABASE_URL', SOURCE_PAR_DEFAUT))
    parser.add_argument('--cible', default=os.getenv('CIBLE_DATABASE_URL'))
    parser.add_argument('--ecrire', action='store_true', help='effectue réellement la copie')
    parser.add_argument('--remplacer', action='store_true', help='vide les tables cibles déjà remplies')
    args = parser.parse_args()

    if not args.cible:
        sys.exit("Base cible absente : définir CIBLE_DATABASE_URL ou passer --cible.")
    if sa.engine.make_url(args.cible).render_as_string() == sa.engine.make_url(args.source).render_as_string():
        sys.exit("La source et la cible sont identiques.")

    print(f"Source : {_url_masquee(args.source)}")
    print(f"Cible  : {_url_masquee(args.cible)}")

    source = sa.create_engine(args.source)
    cible = sa.create_engine(args.cible, pool_pre_ping=True)
    meta_source = sa.MetaData()
    meta_cible = sa.MetaData()
    meta_source.reflect(bind=source, only=TABLES)
    try:
        meta_cible.reflect(bind=cible, only=TABLES)
    except sa.exc.InvalidRequestError as exc:
        sys.exit(f"Schéma cible incomplet ({exc}). Le service doit avoir démarré une fois "
                 "(flask preparer-base) avant la copie.")

    plan = []
    with source.connect() as cs, cible.connect() as cc:
        for nom in TABLES:
            t_src, t_cib = meta_source.tables[nom], meta_cible.tables[nom]
            colonnes = [c.name for c in t_src.columns if c.name in t_cib.columns]
            ignorees = sorted(set(t_src.columns.keys()) - set(colonnes))
            lignes = [dict(r._mapping) for r in cs.execute(sa.select(*[t_src.c[c] for c in colonnes]))]
            deja = cc.execute(sa.select(sa.func.count()).select_from(t_cib)).scalar()
            plan.append((nom, t_cib, lignes, deja))
            note = f" (colonnes absentes de la cible ignorées : {', '.join(ignorees)})" if ignorees else ''
            etat = 'à copier' if not deja else ('à remplacer' if args.remplacer else 'déjà remplie, laissée')
            print(f"  {nom:28s} {len(lignes):5d} lignes  | cible : {deja:5d}  -> {etat}{note}")

    if not args.ecrire:
        print("\nContrôle seul : relancer avec --ecrire pour copier.")
        return

    with cible.begin() as cc:
        if args.remplacer:
            for nom, t_cib, _, deja in reversed(plan):
                if deja:
                    cc.execute(t_cib.delete())
        for nom, t_cib, lignes, deja in plan:
            if deja and not args.remplacer:
                continue
            if lignes:
                cc.execute(t_cib.insert(), lignes)
    print("\nCopie terminée.")


if __name__ == '__main__':
    main()
