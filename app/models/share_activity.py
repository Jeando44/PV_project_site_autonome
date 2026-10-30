"""
Modèle ShareActivity - Historique des activités sur les partages
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant


class ShareActivity(db.Model):
    """Historique des activités sur les partages"""
    __tablename__ = 'share_activities'

    id = db.Column(db.Integer, primary_key=True)

    # Relation avec partage (CASCADE DELETE)
    share_id = db.Column(
        db.Integer,
        db.ForeignKey('project_shares.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    activity_type = db.Column(db.String(50), nullable=False, index=True)
    user_id = db.Column(db.String(36), nullable=True)
    user_email = db.Column(db.String(200), nullable=True)
    ip_address = db.Column(db.String(50), nullable=True)
    user_agent = db.Column(db.String(500), nullable=True)

    details = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant, index=True)

    def to_dict(self):
        return {
            'id': self.id,
            'share_id': self.share_id,
            'activity_type': self.activity_type,
            'user_email': self.user_email,
            'ip_address': self.ip_address,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'details': self.details
        }
