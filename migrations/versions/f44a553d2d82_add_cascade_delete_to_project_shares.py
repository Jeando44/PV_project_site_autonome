"""add_cascade_delete_to_project_shares

Revision ID: f44a553d2d82
Revises: 49ae57fd2be4
Create Date: 2025-11-09 14:38:37.203951

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f44a553d2d82'
down_revision = '49ae57fd2be4'
branch_labels = None
depends_on = None


def upgrade():
    # SQLite ne permet pas de modifier les contraintes de clés étrangères
    # Il faut recréer les tables avec les bonnes contraintes CASCADE

    # 1. Créer les nouvelles tables temporaires avec CASCADE DELETE
    op.execute('''
        CREATE TABLE project_shares_new (
            id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            shared_by VARCHAR(36) NOT NULL,
            shared_by_email VARCHAR(200),
            shared_with VARCHAR(36),
            shared_with_email VARCHAR(200),
            permission_type VARCHAR(20) NOT NULL,
            share_token VARCHAR(100) NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            expires_at DATETIME,
            require_password BOOLEAN DEFAULT 0,
            password_hash VARCHAR(200),
            max_views INTEGER,
            view_count INTEGER DEFAULT 0,
            allow_download BOOLEAN DEFAULT 1,
            allow_copy BOOLEAN DEFAULT 0,
            notify_on_access BOOLEAN DEFAULT 0,
            created_at DATETIME,
            last_accessed_at DATETIME,
            accessed_by_ips TEXT,
            note TEXT,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES parametres_projet (id) ON DELETE CASCADE,
            UNIQUE (share_token)
        )
    ''')

    op.execute('''
        CREATE INDEX ix_project_shares_new_share_token ON project_shares_new (share_token)
    ''')

    op.execute('''
        CREATE INDEX ix_project_shares_new_is_active ON project_shares_new (is_active)
    ''')

    op.execute('''
        CREATE INDEX ix_project_shares_new_expires_at ON project_shares_new (expires_at)
    ''')

    op.execute('''
        CREATE INDEX ix_project_shares_new_created_at ON project_shares_new (created_at)
    ''')

    # 2. Copier les données
    op.execute('''
        INSERT INTO project_shares_new
        SELECT * FROM project_shares
    ''')

    # 3. Créer la nouvelle table share_activities avec CASCADE DELETE
    op.execute('''
        CREATE TABLE share_activities_new (
            id INTEGER NOT NULL,
            share_id INTEGER NOT NULL,
            activity_type VARCHAR(50) NOT NULL,
            user_id VARCHAR(36),
            user_email VARCHAR(200),
            ip_address VARCHAR(50),
            user_agent VARCHAR(500),
            details TEXT,
            created_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(share_id) REFERENCES project_shares (id) ON DELETE CASCADE
        )
    ''')

    op.execute('''
        CREATE INDEX ix_share_activities_new_share_id ON share_activities_new (share_id)
    ''')

    op.execute('''
        CREATE INDEX ix_share_activities_new_activity_type ON share_activities_new (activity_type)
    ''')

    op.execute('''
        CREATE INDEX ix_share_activities_new_created_at ON share_activities_new (created_at)
    ''')

    # 4. Copier les données de share_activities
    op.execute('''
        INSERT INTO share_activities_new
        SELECT * FROM share_activities
    ''')

    # 5. Supprimer les anciennes tables
    op.execute('DROP TABLE share_activities')
    op.execute('DROP TABLE project_shares')

    # 6. Renommer les nouvelles tables
    op.execute('ALTER TABLE project_shares_new RENAME TO project_shares')
    op.execute('ALTER TABLE share_activities_new RENAME TO share_activities')


def downgrade():
    # Revenir à l'état précédent sans CASCADE
    op.execute('''
        CREATE TABLE project_shares_old (
            id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            shared_by INTEGER NOT NULL,
            shared_by_email VARCHAR(200),
            shared_with INTEGER,
            shared_with_email VARCHAR(200),
            permission_type VARCHAR(20) NOT NULL,
            share_token VARCHAR(100) NOT NULL,
            is_active BOOLEAN,
            expires_at DATETIME,
            require_password BOOLEAN,
            password_hash VARCHAR(200),
            max_views INTEGER,
            view_count INTEGER,
            allow_download BOOLEAN,
            allow_copy BOOLEAN,
            notify_on_access BOOLEAN,
            created_at DATETIME,
            last_accessed_at DATETIME,
            accessed_by_ips TEXT,
            note TEXT,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES parametres_projet (id),
            UNIQUE (share_token)
        )
    ''')

    op.execute('INSERT INTO project_shares_old SELECT * FROM project_shares')

    op.execute('''
        CREATE TABLE share_activities_old (
            id INTEGER NOT NULL,
            share_id INTEGER NOT NULL,
            activity_type VARCHAR(50) NOT NULL,
            user_id INTEGER,
            user_email VARCHAR(200),
            ip_address VARCHAR(50),
            user_agent VARCHAR(500),
            details TEXT,
            created_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(share_id) REFERENCES project_shares (id)
        )
    ''')

    op.execute('INSERT INTO share_activities_old SELECT * FROM share_activities')

    op.execute('DROP TABLE share_activities')
    op.execute('DROP TABLE project_shares')

    op.execute('ALTER TABLE project_shares_old RENAME TO project_shares')
    op.execute('ALTER TABLE share_activities_old RENAME TO share_activities')
