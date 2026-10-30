# -*- coding: utf-8 -*-
"""
Commande de préparation du schéma de base de données, à lancer UNE FOIS au déploiement.

    flask preparer-base            # applique
    flask preparer-base --verifier # rapport seul, aucune écriture

POURQUOI CETTE COMMANDE EXISTE
------------------------------
Le schéma de ce projet a deux sources historiques, et c'est la racine des difficultés de
déploiement :

1. `db.create_all()` crée les TABLES manquantes. Il était appelé dans `create_app()`, donc à chaque
   démarrage de worker gunicorn, y compris en production. Trois conséquences :
   - il ne sait PAS ajouter une colonne à une table existante — d'où les `ALTER TABLE` lancés à la
     main, une colonne après l'autre, à chaque mise en production ;
   - il s'exécute avant même que la connexion Cloud SQL soit garantie disponible : un démarrage
     lent fait échouer le conteneur, donc le déploiement ;
   - plusieurs instances qui démarrent en parallèle émettent des `CREATE TABLE` concurrents, que
     MySQL sanctionne par des verrous ou des erreurs.

2. Les migrations Alembic n'ont jamais créé que 8 des 27 tables : les 42 autres révisions se
   contentent d'ajouter des colonnes à des tables supposées déjà présentes. `flask db upgrade`
   seul ne sait donc PAS reconstruire la base.

Cette commande réconcilie les deux, en une étape unique et explicite, hors du chemin de démarrage :

  - elle crée les tables manquantes (`checkfirst=True` : ne touche jamais à l'existant) ;
  - elle ajoute les colonnes manquantes en jouant les migrations (`upgrade`) ;
  - sur une base neuve, elle marque l'historique à jour (`stamp head`) au lieu de rejouer des
    migrations qui échoueraient sur des tables fraîchement créées au bon schéma.

Elle est IDEMPOTENTE : la relancer ne fait rien de plus. Et elle prend un verrou nommé sur MySQL,
pour que deux instances qui démarrent en même temps ne la jouent pas en concurrence.
"""

import click
from flask.cli import with_appcontext
import sqlalchemy as sa

from app.extensions import db

NOM_VERROU = 'pv_project_preparer_base'
DELAI_VERROU_S = 120


def _est_mysql(moteur):
    return moteur.dialect.name.startswith('mysql')


class VerrouDeploiement:
    """
    Verrou nommé MySQL (`GET_LOCK`), pour sérialiser la préparation entre instances concurrentes.

    Sans lui, deux conteneurs Cloud Run démarrant simultanément exécuteraient les mêmes `CREATE
    TABLE` / `ALTER TABLE` en parallèle — au mieux l'un échoue, au pire la table reste à moitié
    construite. Sans effet sur SQLite (une seule instance par fichier, verrouillé par le moteur).
    """

    def __init__(self, connexion):
        self.connexion = connexion
        self.actif = False

    def __enter__(self):
        if _est_mysql(self.connexion.engine):
            obtenu = self.connexion.execute(
                sa.text("SELECT GET_LOCK(:nom, :delai)"),
                {'nom': NOM_VERROU, 'delai': DELAI_VERROU_S}).scalar()
            if obtenu != 1:
                raise RuntimeError(
                    "Impossible d'obtenir le verrou de préparation de base après %ds — "
                    "une autre instance est probablement en cours de migration." % DELAI_VERROU_S)
            self.actif = True
            click.echo('   verrou de déploiement obtenu')
        return self

    def __exit__(self, *exc):
        if self.actif:
            self.connexion.execute(sa.text("SELECT RELEASE_LOCK(:nom)"), {'nom': NOM_VERROU})
            click.echo('   verrou de déploiement libéré')
        return False


def _tables_manquantes(moteur):
    presentes = set(sa.inspect(moteur).get_table_names())
    return [nom for nom in db.metadata.tables if nom not in presentes]


def _historique_present(moteur):
    return 'alembic_version' in sa.inspect(moteur).get_table_names()


def _revisions_enregistrees(moteur):
    """Révisions inscrites dans `alembic_version` ([] si la table est absente OU vide)."""
    if not _historique_present(moteur):
        return []
    with moteur.connect() as c:
        return [r[0] for r in c.execute(sa.text('SELECT version_num FROM alembic_version')) if r[0]]


def _colonnes_manquantes(moteur):
    """[(table, colonne)] déclarées dans les modèles mais absentes des tables EXISTANTES."""
    inspecteur = sa.inspect(moteur)
    presentes = set(inspecteur.get_table_names())
    manquantes = []
    for nom_table, table in db.metadata.tables.items():
        if nom_table not in presentes:
            continue  # table absente : créée entière par create_all
        existantes = {c['name'] for c in inspecteur.get_columns(nom_table)}
        manquantes.extend((table, col) for col in table.columns if col.name not in existantes)
    return manquantes


def _ajouter_colonnes_manquantes(moteur, manquantes):
    """
    Ajoute les colonnes manquantes, TOUJOURS en NULL autorisé et sans valeur par défaut imposée :
    une opération purement additive, qui ne peut ni échouer sur des lignes existantes (contrainte
    NOT NULL sans défaut) ni modifier une donnée. Les contraintes plus strictes, si besoin, relèvent
    d'une vraie migration.
    """
    quote = moteur.dialect.identifier_preparer.quote
    with moteur.begin() as c:
        for table, col in manquantes:
            type_sql = col.type.compile(dialect=moteur.dialect)
            c.execute(sa.text('ALTER TABLE %s ADD COLUMN %s %s NULL'
                              % (quote(table.name), quote(col.name), type_sql)))
            click.echo('   colonne ajoutée : %s.%s (%s)' % (table.name, col.name, type_sql))


@click.command('preparer-base')
@click.option('--verifier', is_flag=True, help="N'écrit rien : affiche seulement ce qui serait fait.")
@with_appcontext
def preparer_base(verifier):
    """Met le schéma de la base à niveau (tables manquantes + migrations)."""
    from flask_migrate import stamp, upgrade

    moteur = db.engine
    click.echo('Base    : %s' % moteur.url.render_as_string(hide_password=True))

    manquantes = _tables_manquantes(moteur)
    historique = _historique_present(moteur)
    revisions = _revisions_enregistrees(moteur)
    click.echo('Tables manquantes  : %d%s' % (len(manquantes),
                                              (' (%s)' % ', '.join(manquantes[:6])) if manquantes else ''))
    if not historique:
        click.echo('Historique Alembic : absent (base neuve)')
    elif not revisions:
        click.echo('Historique Alembic : présent mais VIDE (aucune révision enregistrée)')
    else:
        click.echo('Historique Alembic : présent (%s)' % ', '.join(revisions))

    # CORRECTIF (déploiement en échec : "Table 'normes_calcul' already exists") : la base de
    # production possède la table `alembic_version` mais VIDE — ses tables ont été créées par
    # create_all() et complétées par des ALTER TABLE manuels, sans que l'historique soit jamais
    # enregistré. `upgrade()` repartait alors de la toute première migration et échouait sur son
    # CREATE TABLE. Un historique vide est donc traité comme un historique à INITIALISER, pas à
    # rejouer : on complète d'abord les colonnes manquantes (ajouts purement additifs), puis on
    # marque la révision courante.
    a_initialiser = not revisions
    colonnes = _colonnes_manquantes(moteur) if a_initialiser else []
    if a_initialiser:
        click.echo('Colonnes manquantes: %d%s' % (len(colonnes), (' (%s)' % ', '.join(
            '%s.%s' % (t.name, c.name) for t, c in colonnes[:8])) if colonnes else ''))

    if verifier:
        click.echo('')
        click.echo('(--verifier : aucune écriture effectuée)')
        return

    with moteur.connect() as connexion:
        with VerrouDeploiement(connexion):
            # Harmonisation : si une base (ex: locale de test) avait enregistré l'ancien nom trop long
            if _historique_present(moteur):
                try:
                    connexion.execute(sa.text(
                        "UPDATE alembic_version SET version_num = 'add_soft_delete_and_quota' "
                        "WHERE version_num = 'add_soft_delete_and_quota_counters'"
                    ))
                    connexion.commit()
                except Exception:
                    pass

            # 1. Tables manquantes. `checkfirst=True` : une table existante n'est jamais touchée,
            # donc aucune donnée ne peut être perdue, même si le schéma a dérivé.
            if manquantes:
                db.metadata.create_all(bind=moteur, checkfirst=True)
                click.echo('   %d table(s) créée(s)' % len(manquantes))

            # 2. Historique des migrations.
            if a_initialiser:
                # Base neuve, OU base existante dont l'historique n'a jamais été enregistré (table
                # alembic_version absente ou vide) : les tables sont au schéma des modèles (créées
                # à l'instant, ou complétées ci-dessous). Rejouer les migrations y recréerait des
                # tables/colonnes déjà présentes et échouerait. On marque donc l'historique à jour ;
                # les migrations futures partiront de là.
                colonnes = _colonnes_manquantes(moteur)
                if colonnes:
                    _ajouter_colonnes_manquantes(moteur, colonnes)
                stamp(revision='head')
                click.echo("   historique initialisé à la révision courante (stamp head)")
            else:
                # Sécurité MySQL : par défaut Alembic crée version_num en VARCHAR(32).
                # On élargit préventivement à VARCHAR(64) pour éviter l'erreur DataError (1406)
                # si un nom de révision dépasse 32 caractères.
                if _est_mysql(moteur) and _historique_present(moteur):
                    try:
                        with moteur.begin() as c_alter:
                            c_alter.execute(sa.text("ALTER TABLE alembic_version MODIFY COLUMN version_num VARCHAR(64) NOT NULL"))
                    except Exception:
                        pass
                upgrade()
                click.echo('   migrations appliquées (upgrade)')

    restantes = _tables_manquantes(moteur)
    if restantes:
        raise click.ClickException('Tables toujours absentes : %s' % ', '.join(restantes))
    click.echo('')
    click.echo('Base prête.')


def register_cli(app):
    """Enregistre les commandes CLI du projet (appelé par create_app)."""
    app.cli.add_command(preparer_base)
