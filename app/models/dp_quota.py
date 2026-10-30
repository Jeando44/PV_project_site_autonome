"""
Modele DpUsageQuota - quota mensuel de generation de Declaration Prealable (DP)
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class DpUsageQuota(db.Model):
    """
    Quota mensuel de generation de dossiers de Declaration Prealable (DP) : un enregistrement par
    utilisateur PV_project (id externe SSO, cf. g.user['id']), remis a zero chaque mois calendaire
    (`period`, format 'YYYY-MM') plutot qu'un compteur a vie.

    La limite effective (max_dp_per_month / max_dp_power_kwc) vient de la licence SSO
    (session['licence_dp'], alimentee par Solakvan_Projet a la connexion), pas d'une config locale
    - cf. app/services/dp/quota.py.
    """
    __tablename__ = "dp_usage_quotas"

    user_id = db.Column(db.String(36), primary_key=True)
    period = db.Column(db.String(7), nullable=False)
    request_count = db.Column(db.Integer, default=0, nullable=False)

    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def __repr__(self) -> str:
        return (
            f"<DpUsageQuota user={self.user_id} period={self.period} "
            f"count={self.request_count}>"
        )
