"""
Modèles SQLAlchemy pour l'intégration Switchgrid — PV_project.

Architecture métier :
    L'application tourne autour des PROJETS (table : parametres_projet).
    Toutes les références à "client_id" ont été remplacées par "project_id".

Note sur les relationships :
    Les FK vers parametres_projet.id garantissent l'intégrité en base.
    Aucune relationship() Python vers ParametresProjet n'est définie ici
    pour éviter tout conflit de registre SQLAlchemy avec les modèles
    existants du projet. À ajouter plus tard si nécessaire.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


def _uuid_str() -> str:
    return str(uuid.uuid4())


class SwitchgridConsent(db.Model):
    """
    Représente un `Ask` Switchgrid (demande de consentement Enedis),
    rattaché à un projet PV_project (parametres_projet).
    """
    __tablename__ = "switchgrid_consents"

    id = db.Column(db.String(36), primary_key=True, default=_uuid_str)

    # Référence au projet PV_project (parametres_projet.id)
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("parametres_projet.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Identité (id externe SSO, cf. g.user['id']) de l'utilisateur ayant initié la demande —
    # isolation multi-tenant explicite sur la donnée elle-même, en plus de la vérification faite via
    # project_id -> ParametreProjet.created_by (cf. _verify_project_ownership dans switchgrid_routes.py).
    # Nullable pour rester compatible avec les lignes déjà existantes en base avant cette colonne ;
    # toujours renseigné pour toute nouvelle création (cf. routes).
    user_id = db.Column(db.String(36), nullable=True, index=True)

    switchgrid_ask_id = db.Column(db.String(64), unique=True, nullable=False, index=True)

    # PENDING_USER_ACTION | ACCEPTED | NOT_VALID | REVOKED
    status = db.Column(db.String(32), nullable=False, default="PENDING_USER_ACTION", index=True)

    prms             = db.Column(db.JSON,       nullable=False, default=list)
    consent_duration = db.Column(db.String(32), nullable=True)
    purposes         = db.Column(db.JSON,       nullable=True)
    signature_url    = db.Column(db.String(512), nullable=True)
    signed_at        = db.Column(db.DateTime,   nullable=True)
    revoked_at       = db.Column(db.DateTime,   nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant, nullable=False)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    # Relation interne Switchgrid uniquement (pas de relation vers ParametresProjet)
    orders = db.relationship(
        "SwitchgridOrder", back_populates="consent", lazy="dynamic"
    )

    def __repr__(self) -> str:
        return (
            f"<SwitchgridConsent ask={self.switchgrid_ask_id} "
            f"project={self.project_id} status={self.status}>"
        )


class SwitchgridOrder(db.Model):
    """
    Représente un `Order` Switchgrid (commande de données C68 + R63)
    pour un projet PV_project donné.
    """
    __tablename__ = "switchgrid_orders"

    id = db.Column(db.String(36), primary_key=True, default=_uuid_str)

    consent_id = db.Column(
        db.String(36),
        db.ForeignKey("switchgrid_consents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Référence au projet PV_project (parametres_projet.id)
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("parametres_projet.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Idem SwitchgridConsent.user_id (voir commentaire ci-dessus).
    user_id = db.Column(db.String(36), nullable=True, index=True)

    switchgrid_order_id = db.Column(db.String(64), unique=True, nullable=False, index=True)

    # CREATED | PENDING_REQUESTS | SOME_REQUESTS_FAILED | SUCCESS
    status = db.Column(db.String(32), nullable=False, default="CREATED", index=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant, nullable=False)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    # Relations internes Switchgrid uniquement
    consent = db.relationship("SwitchgridConsent", back_populates="orders")
    requests = db.relationship(
        "SwitchgridRequest",
        back_populates="order",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return (
            f"<SwitchgridOrder order={self.switchgrid_order_id} "
            f"project={self.project_id} status={self.status}>"
        )


class SwitchgridRequest(db.Model):
    """
    Sous-requête au sein d'un Order (une par type C68/R63 et par PRM).
    C68 et R63 se terminent à des moments différents — cette granularité
    permet de suivre chaque donnée indépendamment.
    """
    __tablename__ = "switchgrid_requests"

    id = db.Column(db.String(36), primary_key=True, default=_uuid_str)
    order_id = db.Column(
        db.String(36),
        db.ForeignKey("switchgrid_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    switchgrid_request_id = db.Column(db.String(64), nullable=True, index=True)

    # "C68" (données contractuelles) | "R63" (courbe de charge)
    request_type = db.Column(db.String(16), nullable=False)

    # PDL / PRM à 14 chiffres
    prm           = db.Column(db.String(14), nullable=False, index=True)

    # NOT_STARTED | QUEUED | PENDING | PENDING_ADDRESS_CHECK | SUCCESS | FAILED
    status        = db.Column(db.String(32), nullable=False, default="NOT_STARTED", index=True)
    error_message = db.Column(db.Text,      nullable=True)
    ordered_at    = db.Column(db.DateTime,  nullable=True)
    completed_at  = db.Column(db.DateTime,  nullable=True)

    order = db.relationship("SwitchgridOrder", back_populates="requests")
    raw_dataset = db.relationship(
        "SwitchgridRawDataset",
        back_populates="request",
        uselist=False,
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        db.UniqueConstraint(
            "order_id", "request_type", "prm", name="uq_order_type_prm"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<SwitchgridRequest type={self.request_type} "
            f"prm={self.prm} status={self.status}>"
        )


class SwitchgridRawDataset(db.Model):
    """
    Donnée brute téléchargée depuis Switchgrid pour une request réussie.
    Stockée telle quelle pour traçabilité et rejouabilité des calculs PV.
    """
    __tablename__ = "switchgrid_raw_datasets"

    id = db.Column(db.String(36), primary_key=True, default=_uuid_str)
    request_id = db.Column(
        db.String(36),
        db.ForeignKey("switchgrid_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    content_json  = db.Column(db.JSON,     nullable=False)
    downloaded_at = db.Column(db.DateTime, default=utc_maintenant, nullable=False)

    request = db.relationship("SwitchgridRequest", back_populates="raw_dataset")

    def __repr__(self) -> str:
        return f"<SwitchgridRawDataset request={self.request_id}>"


class SwitchgridWebhookEvent(db.Model):
    """
    Journal des événements webhook reçus depuis Switchgrid.
    Contrainte d'unicité pour garantir l'idempotence (Switchgrid retente 3x).
    """
    __tablename__ = "switchgrid_webhook_events"

    id = db.Column(db.String(36), primary_key=True, default=_uuid_str)

    # ask.accepted | ask.revoked | order.request_success | order.request_failed
    event_tag    = db.Column(db.String(64), nullable=False, index=True)
    ask_id       = db.Column(db.String(64), nullable=True,  index=True)
    order_id     = db.Column(db.String(64), nullable=True,  index=True)
    request_id   = db.Column(db.String(64), nullable=True,  index=True)
    request_type = db.Column(db.String(16), nullable=True)

    payload          = db.Column(db.JSON,     nullable=False)
    received_at      = db.Column(db.DateTime, default=utc_maintenant, nullable=False)
    processed_at     = db.Column(db.DateTime, nullable=True)
    processing_error = db.Column(db.Text,     nullable=True)

    __table_args__ = (
        db.UniqueConstraint(
            "event_tag", "ask_id", "order_id", "request_id",
            name="uq_webhook_event_idempotency",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<SwitchgridWebhookEvent tag={self.event_tag} "
            f"order={self.order_id}>"
        )


class SwitchgridUsageQuota(db.Model):
    """
    Quota d'essai Switchgrid : un enregistrement par utilisateur PV_project (id externe SSO, cf.
    g.user['id']), qui compte le nombre de requêtes de courbe de charge Enedis (créations d'Order
    C68+R63) effectuées — cf. app/services/switchgrid/quota.py pour la logique de vérification et
    config.py pour le paramétrage (SWITCHGRID_TRIAL_QUOTA / SWITCHGRID_TRIAL_DAYS).

    `is_licensed` : bascule manuelle donnant un accès illimité (ex. après souscription d'une
    licence). PV_project n'a aujourd'hui aucun accès à un vrai signal d'abonnement/licence côté
    application principale (le payload SSO ne transporte que id/email/is_admin/permissions) — ce
    champ est donc, pour l'instant, à activer manuellement en base pour un utilisateur donné. À
    remplacer par un vrai signal (ex. permission SSO dédiée) si/quand il devient disponible.
    """
    __tablename__ = "switchgrid_usage_quotas"

    user_id = db.Column(db.String(36), primary_key=True)

    # Date de la première requête de courbe de charge Enedis de cet utilisateur — sert de point de
    # départ informatif de sa période d'essai (PV_project n'a pas accès à sa date d'inscription
    # réelle, gérée par l'application principale).
    first_request_at = db.Column(db.DateTime, default=utc_maintenant, nullable=False)

    request_count = db.Column(db.Integer, default=0, nullable=False)
    is_licensed   = db.Column(db.Boolean, default=False, nullable=False)

    # Mois calendaire courant du compteur ci-dessus (format 'YYYY-MM'), pour le reset mensuel
    # paresseux — cf. app/services/switchgrid/quota.py. None (lignes existant avant l'ajout de cette
    # colonne) est traite comme "different du mois courant", donc reset au prochain acces, ce qui est
    # le comportement voulu (on passe d'un compteur a vie a un quota mensuel).
    current_period = db.Column(db.String(7), nullable=True)

    # Dernier quota mensuel connu de la licence SSO de l'utilisateur (session['licence_switchgrid'],
    # None = illimité) et date de cette mémorisation (None = jamais mémorisé). Permet de vérifier le
    # quota là où il n'y a pas de session : création de l'order côté serveur à la signature du client
    # (webhook ask.accepted) — cf. app/services/switchgrid/quota.py::verifier_quota_creation_order.
    quota_licence_max = db.Column(db.Integer, nullable=True)
    quota_licence_maj_le = db.Column(db.DateTime, nullable=True)

    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def __repr__(self) -> str:
        return (
            f"<SwitchgridUsageQuota user={self.user_id} "
            f"count={self.request_count} licensed={self.is_licensed}>"
        )