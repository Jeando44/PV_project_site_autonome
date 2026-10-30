"""
Modèle ProjectShare - Gestion du partage de projets
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant
import secrets
import hashlib


class SharePermissionType:
    """Types de permissions de partage"""
    VIEW = 'view'
    EDIT = 'edit'
    ADMIN = 'admin'


class ProjectShare(db.Model):
    """Modèle pour le partage de projets entre utilisateurs"""
    __tablename__ = 'project_shares'

    id = db.Column(db.Integer, primary_key=True)

    # Projet partagé avec CASCADE DELETE
    project_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE'),
        nullable=False
    )

    # Propriétaire du partage
    shared_by = db.Column(db.String(36), nullable=False)
    shared_by_email = db.Column(db.String(200))

    # Destinataire
    shared_with = db.Column(db.String(36), nullable=True)
    shared_with_email = db.Column(db.String(200), nullable=True)

    # Type de partage
    permission_type = db.Column(
        db.String(20),
        nullable=False,
        default=SharePermissionType.VIEW
    )

    # Lien de partage unique
    share_token = db.Column(db.String(100), unique=True, nullable=False, index=True)

    # Options de partage
    is_active = db.Column(db.Boolean, default=True, index=True)
    expires_at = db.Column(db.DateTime, nullable=True, index=True)
    require_password = db.Column(db.Boolean, default=False)
    password_hash = db.Column(db.String(200), nullable=True)

    # Restrictions
    max_views = db.Column(db.Integer, nullable=True)
    view_count = db.Column(db.Integer, default=0)

    # Options avancées
    allow_download = db.Column(db.Boolean, default=True)
    allow_copy = db.Column(db.Boolean, default=False)
    notify_on_access = db.Column(db.Boolean, default=False)

    # Métadonnées
    created_at = db.Column(db.DateTime, default=utc_maintenant, index=True)
    last_accessed_at = db.Column(db.DateTime, nullable=True)
    accessed_by_ips = db.Column(db.Text, nullable=True)

    # Note personnelle
    note = db.Column(db.Text, nullable=True)

    # Relation avec activités (CASCADE DELETE)
    activities = db.relationship(
        'ShareActivity',
        backref='share',
        lazy='dynamic',
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    @staticmethod
    def generate_token():
        """Générer un token de partage unique et sécurisé"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def hash_password(password):
        """Hasher un mot de passe pour le partage"""
        return hashlib.sha256(password.encode()).hexdigest()

    def verify_password(self, password):
        """Vérifier le mot de passe du partage"""
        if not self.require_password:
            return True
        return self.password_hash == self.hash_password(password)

    def is_valid(self):
        """Vérifier si le partage est toujours valide"""
        if not self.is_active:
            return False

        if self.expires_at and utc_maintenant() > self.expires_at:
            return False

        if self.max_views and self.view_count >= self.max_views:
            return False

        return True

    def can_edit(self):
        """Vérifier si le partage permet la modification"""
        return self.is_valid() and self.permission_type in [SharePermissionType.EDIT, SharePermissionType.ADMIN]

    def can_admin(self):
        """Vérifier si le partage permet l'administration"""
        return self.is_valid() and self.permission_type == SharePermissionType.ADMIN

    def increment_view(self, ip_address=None):
        """Incrémenter le compteur de vues"""
        self.view_count += 1
        self.last_accessed_at = utc_maintenant()

        if ip_address:
            import json
            try:
                ips = json.loads(self.accessed_by_ips) if self.accessed_by_ips else []
                if ip_address not in ips:
                    ips.append(ip_address)
                    self.accessed_by_ips = json.dumps(ips)
            except:
                self.accessed_by_ips = json.dumps([ip_address])

    def to_dict(self, include_token=False):
        """Convertir en dictionnaire"""
        data = {
            'id': self.id,
            'project_id': self.project_id,
            'shared_by_email': self.shared_by_email,
            'shared_with_email': self.shared_with_email,
            'permission_type': self.permission_type,
            'is_active': self.is_active,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'require_password': self.require_password,
            'max_views': self.max_views,
            'view_count': self.view_count,
            'allow_download': self.allow_download,
            'allow_copy': self.allow_copy,
            'notify_on_access': self.notify_on_access,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_accessed_at': self.last_accessed_at.isoformat() if self.last_accessed_at else None,
            'note': self.note,
            'is_valid': self.is_valid()
        }

        if include_token:
            data['share_token'] = self.share_token
            data['share_url'] = f'/concevoir_mon_projet/shared/{self.share_token}'

        return data
