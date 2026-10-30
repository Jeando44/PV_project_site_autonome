"""
Modele AccStudyUsage - etudes ACC (Autoconsommation Collective) consommees par mois
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class AccStudyUsage(db.Model):
    """
    Une ligne = une etude ACC consommee : un projet distinct sur lequel l'utilisateur (id externe
    SSO, cf. g.user['id']) a lance un calcul ACC pendant le mois calendaire `period` ('YYYY-MM').
    Les recalculs sur un meme projet dans le mois ne creent pas de nouvelle ligne.

    `projet_key` vaut l'id du projet, ou un identifiant unique quand le calcul est lance sans
    projet actif (chaque calcul compte alors pour une etude).

    La limite effective (max_studies_per_month) vient de la licence SSO (session['licence_acc'],
    alimentee par Solakvan_Projet a la connexion) - cf. app/services/acc/quota.py.
    """
    __tablename__ = "acc_study_usages"
    __table_args__ = (
        db.UniqueConstraint("user_id", "period", "projet_key", name="uq_acc_study_user_period_projet"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(36), nullable=False, index=True)
    period = db.Column(db.String(7), nullable=False)
    projet_key = db.Column(db.String(64), nullable=False)

    created_at = db.Column(db.DateTime, default=utc_maintenant)

    def __repr__(self) -> str:
        return f"<AccStudyUsage user={self.user_id} period={self.period} projet={self.projet_key}>"
