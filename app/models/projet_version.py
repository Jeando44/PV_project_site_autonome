"""
Version des données d'un projet (verrou optimiste, app/services/version_projet.py).

Une ligne par projet : `version` augmente à chaque enregistrement fait par un onglet de
l'application (requête portant l'en-tête X-Skv-Onglet) ; `dernier_onglet` est l'onglet qui l'a
faite. Un onglet qui écrit à partir d'une version périmée, alors qu'un AUTRE onglet (ou poste) a
écrit depuis, est refusé (409) : il ne peut plus écraser un travail plus récent.

Table séparée de parametres_projet (et non une colonne) : si elle manque (migration pas encore
appliquée), seul le contrôle de version est ignoré, le reste de l'application fonctionne.
Commune à toutes les variantes (registre de app/services/variantes_projet.py).
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class ProjetVersion(db.Model):
    __tablename__ = 'projet_versions'

    projet_id = db.Column(
        db.Integer, db.ForeignKey('parametres_projet.id', ondelete='CASCADE'), primary_key=True)
    version = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    dernier_onglet = db.Column(db.String(64), nullable=True)
    maj_le = db.Column(db.DateTime, nullable=True, default=utc_maintenant)
