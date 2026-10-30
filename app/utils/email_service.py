"""
Service d'envoi d'emails pour l'application
"""
from flask import current_app, render_template_string
from flask_mail import Mail, Message
from datetime import datetime
from app.utils.dates import utc_maintenant
import os


def send_email_notification(recipient_email, subject, body, html_body=None):
    """
    Envoie un email de notification

    Args:
        recipient_email (str): Email du destinataire
        subject (str): Sujet de l'email
        body (str): Corps de l'email en texte brut
        html_body (str, optional): Corps de l'email en HTML

    Returns:
        bool: True si l'email a été envoyé avec succès, False sinon
    """
    try:
        # Récupérer l'instance Mail depuis l'application
        mail = current_app.extensions.get('mail')

        if not mail:
            print("⚠️ Flask-Mail n'est pas initialisé")
            return False

        # Créer le message
        msg = Message(
            subject=subject,
            recipients=[recipient_email],
            sender=current_app.config.get('MAIL_DEFAULT_SENDER'),
            body=body
        )

        # Ajouter le corps HTML si fourni
        if html_body:
            msg.html = html_body

        # Envoyer l'email
        mail.send(msg)
        print(f"✅ Email envoyé à {recipient_email}: {subject}")
        return True

    except Exception as e:
        print(f"❌ Erreur lors de l'envoi de l'email à {recipient_email}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def send_share_notification_email(share, projet, share_url):
    """
    Envoie une notification par email lors du partage d'un projet

    Args:
        share: Instance de ProjectShare
        projet: Instance de ParametreProjet
        share_url: URL complète du partage

    Returns:
        bool: True si l'email a été envoyé avec succès
    """
    if not share.shared_with_email:
        return False

    # Déterminer le niveau d'accès en français
    permission_labels = {
        'view': 'Lecture seule',
        'edit': 'Modification',
        'admin': 'Administration complète'
    }
    permission_label = permission_labels.get(share.permission_type, share.permission_type)

    # Corps de l'email en texte brut
    expiration_text = 'Ce lien expirera le : ' + share.expires_at.strftime('%d/%m/%Y à %H:%M') if share.expires_at else "Ce lien n'expire pas."
    max_views_text = f'Nombre maximum de vues autorisées : {share.max_views}' if share.max_views else ''
    note_text = f'Note de {share.shared_by_email} : {share.note}' if share.note else ''
    password_warning = "⚠️ Ce lien est protégé par un mot de passe. Contactez l'expéditeur pour l'obtenir." if share.require_password else ''

    body = f"""
Bonjour,

{share.shared_by_email} a partagé le projet "{projet.nom_projet}" avec vous.

Niveau d'accès : {permission_label}

Accédez au projet via ce lien :
{share_url}

{expiration_text}

{max_views_text}

{note_text}

{password_warning}

Cordialement,
L'équipe SolakVan
    """.strip()

    # Corps HTML enrichi
    html_expiration = f'<div class="info-box"><strong>Expiration :</strong> {share.expires_at.strftime("%d/%m/%Y à %H:%M")}</div>' if share.expires_at else ''
    html_max_views = f'<div class="info-box"><strong>Vues autorisées :</strong> {share.max_views}</div>' if share.max_views else ''
    html_note = f'<div class="info-box"><strong>Note :</strong><br>{share.note}</div>' if share.note else ''
    html_password_warning = '<div class="warning">⚠️ <strong>Attention :</strong> Ce lien est protégé par un mot de passe. Contactez l\'expéditeur pour l\'obtenir.</div>' if share.require_password else ''

    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #8b0000 0%, #de0000 30%, #ff0000 60%, #ff6b6b 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }}
        .content {{
            background: #ffffff;
            padding: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 0 0 8px 8px;
        }}
        .project-name {{
            font-size: 20px;
            font-weight: bold;
            color: #de0000;
            margin: 15px 0;
        }}
        .info-box {{
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #de0000;
            margin: 15px 0;
        }}
        .button {{
            display: inline-block;
            padding: 12px 30px;
            background: #de0000;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
        }}
        .button:hover {{
            background: #ff0000;
        }}
        .permission-badge {{
            display: inline-block;
            padding: 5px 15px;
            background: #e7eaf6;
            color: #667eea;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
        }}
        .footer {{
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }}
        .warning {{
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 15px 0;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Projet partagé</h1>
    </div>
    <div class="content">
        <p>Bonjour,</p>
        <p><strong>{share.shared_by_email}</strong> a partagé un projet avec vous :</p>

        <div class="project-name">
            📁 {projet.nom_projet}
        </div>

        <div class="info-box">
            <strong>Niveau d'accès :</strong><br>
            <span class="permission-badge">{permission_label}</span>
        </div>

        {html_expiration}

        {html_max_views}

        {html_note}

        {html_password_warning}

        <div style="text-align: center;">
            <a href="{share_url}" class="button">
                🔗 Accéder au projet
            </a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 20px;">
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
            <code style="background: #f0f0f0; padding: 5px; display: inline-block; margin-top: 5px;">{share_url}</code>
        </p>
    </div>
    <div class="footer">
        <p>Cet email a été envoyé automatiquement par SolakVan.<br>
        Merci de ne pas répondre à cet email.</p>
    </div>
</body>
</html>
    """

    subject = f"📊 Projet partagé : {projet.nom_projet}"

    return send_email_notification(
        recipient_email=share.shared_with_email,
        subject=subject,
        body=body,
        html_body=html_body
    )


def send_access_notification_email(share):
    """
    Notifie le propriétaire lors d'un accès au partage

    Args:
        share: Instance de ProjectShare

    Returns:
        bool: True si l'email a été envoyé avec succès
    """
    body = f"""
Bonjour,

Votre projet "{share.project.nom_projet}" a été consulté via un lien de partage.

Statistiques :
- Nombre total de vues : {share.view_count}
- Dernier accès : {share.last_accessed_at.strftime('%d/%m/%Y à %H:%M') if share.last_accessed_at else 'N/A'}

{'Partagé avec : ' + share.shared_with_email if share.shared_with_email else 'Partage via lien public'}

Cordialement,
L'équipe SolakVan
    """

    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #8b0000 0%, #de0000 30%, #ff0000 60%, #ff6b6b 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }}
        .content {{
            background: #ffffff;
            padding: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 0 0 8px 8px;
        }}
        .stats-box {{
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #de0000;
            margin: 15px 0;
        }}
        .footer {{
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>👁️ Notification d'accès</h1>
    </div>
    <div class="content">
        <p>Bonjour,</p>
        <p>Votre projet <strong>"{share.project.nom_projet}"</strong> a été consulté via un lien de partage.</p>

        <div class="stats-box">
            <strong>📊 Statistiques :</strong><br>
            <ul style="margin: 10px 0;">
                <li>Nombre total de vues : <strong>{share.view_count}</strong></li>
                <li>Dernier accès : <strong>{share.last_accessed_at.strftime('%d/%m/%Y à %H:%M') if share.last_accessed_at else 'N/A'}</strong></li>
                {f'<li>Partagé avec : <strong>{share.shared_with_email}</strong></li>' if share.shared_with_email else '<li>Partage via <strong>lien public</strong></li>'}
            </ul>
        </div>
    </div>
    <div class="footer">
        <p>Cet email a été envoyé automatiquement par SolakVan.<br>
        Merci de ne pas répondre à cet email.</p>
    </div>
</body>
</html>
    """

    subject = f"👁️ Accès au projet partagé : {share.project.nom_projet}"

    return send_email_notification(
        recipient_email=share.shared_by_email,
        subject=subject,
        body=body,
        html_body=html_body
    )


def send_modification_notification_email(share, projet, modifier_email):
    """
    Notifie le propriétaire lors d'une modification du projet par un invité

    Args:
        share: Instance de ProjectShare
        projet: Instance de ParametreProjet
        modifier_email: Email de la personne qui a modifié le projet

    Returns:
        bool: True si l'email a été envoyé avec succès
    """
    # Ne pas envoyer d'email si le propriétaire modifie son propre projet
    if share.shared_by_email == modifier_email:
        return False

    # Déterminer le niveau d'accès en français
    permission_labels = {
        'view': 'Lecture seule',
        'edit': 'Modification',
        'admin': 'Administration complète'
    }
    permission_label = permission_labels.get(share.permission_type, share.permission_type)

    # Corps de l'email en texte brut
    body = f"""
Bonjour,

Votre projet "{projet.nom_projet}" vient d'être modifié.

Modifié par : {modifier_email}
Niveau d'accès : {permission_label}
Date de modification : {projet.updated_at.strftime('%d/%m/%Y à %H:%M') if projet.updated_at else 'N/A'}

Pour consulter les modifications, vous pouvez accéder à votre projet depuis votre tableau de bord.

Cordialement,
L'équipe SolakVan
    """.strip()

    # Corps HTML enrichi
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #8b0000 0%, #de0000 30%, #ff0000 60%, #ff6b6b 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }}
        .content {{
            background: #ffffff;
            padding: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 0 0 8px 8px;
        }}
        .project-name {{
            font-size: 20px;
            font-weight: bold;
            color: #de0000;
            margin: 15px 0;
        }}
        .info-box {{
            background: #fff3cd;
            padding: 15px;
            border-left: 4px solid #ffc107;
            margin: 15px 0;
        }}
        .stats-box {{
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #de0000;
            margin: 15px 0;
        }}
        .footer {{
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>✏️ Projet modifié</h1>
    </div>
    <div class="content">
        <p>Bonjour,</p>
        <p>Votre projet a été modifié par un utilisateur invité :</p>

        <div class="project-name">
            📁 {projet.nom_projet}
        </div>

        <div class="info-box">
            <strong>⚠️ Une modification a été apportée à votre projet</strong>
        </div>

        <div class="stats-box">
            <strong>📊 Détails de la modification :</strong><br>
            <ul style="margin: 10px 0;">
                <li>Modifié par : <strong>{modifier_email}</strong></li>
                <li>Niveau d'accès : <strong>{permission_label}</strong></li>
                <li>Date : <strong>{projet.updated_at.strftime('%d/%m/%Y à %H:%M') if projet.updated_at else 'N/A'}</strong></li>
            </ul>
        </div>

        <p style="margin-top: 20px;">
            Pour consulter les modifications, connectez-vous à votre tableau de bord.
        </p>
    </div>
    <div class="footer">
        <p>Cet email a été envoyé automatiquement par SolakVan.<br>
        Merci de ne pas répondre à cet email.</p>
    </div>
</body>
</html>
    """

    subject = f"✏️ Modification du projet : {projet.nom_projet}"

    return send_email_notification(
        recipient_email=share.shared_by_email,
        subject=subject,
        body=body,
        html_body=html_body
    )


def send_deletion_notification_email(share, projet_name, deleter_email):
    """
    Notifie le propriétaire lors de la suppression du projet par un invité

    Args:
        share: Instance de ProjectShare
        projet_name: Nom du projet supprimé
        deleter_email: Email de la personne qui a supprimé le projet

    Returns:
        bool: True si l'email a été envoyé avec succès
    """
    # Déterminer le niveau d'accès en français
    permission_labels = {
        'view': 'Lecture seule',
        'edit': 'Modification',
        'admin': 'Administration complète'
    }
    permission_label = permission_labels.get(share.permission_type, share.permission_type)

    # Corps de l'email en texte brut
    body = f"""
Bonjour,

⚠️ ALERTE : Votre projet "{projet_name}" a été SUPPRIMÉ.

Supprimé par : {deleter_email}
Niveau d'accès : {permission_label}
Date de suppression : {utc_maintenant().strftime('%d/%m/%Y à %H:%M')}

Cette action est irréversible. Toutes les données du projet ont été définitivement supprimées.

Si cette suppression n'était pas autorisée, veuillez contacter immédiatement l'administrateur système.

Cordialement,
L'équipe SolakVan
    """.strip()

    # Corps HTML enrichi
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #8b0000 0%, #c00000 30%, #de0000 60%, #ff0000 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 8px 8px 0 0;
        }}
        .content {{
            background: #ffffff;
            padding: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 0 0 8px 8px;
        }}
        .project-name {{
            font-size: 20px;
            font-weight: bold;
            color: #de0000;
            margin: 15px 0;
        }}
        .alert-box {{
            background: #f8d7da;
            padding: 20px;
            border-left: 4px solid #dc3545;
            margin: 15px 0;
            color: #721c24;
        }}
        .stats-box {{
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #de0000;
            margin: 15px 0;
        }}
        .footer {{
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🗑️ Projet supprimé</h1>
    </div>
    <div class="content">
        <p>Bonjour,</p>

        <div class="alert-box">
            <strong>⚠️ ALERTE DE SUPPRESSION</strong><br>
            Votre projet a été définitivement supprimé par un utilisateur invité.
        </div>

        <div class="project-name">
            📁 {projet_name}
        </div>

        <div class="stats-box">
            <strong>📊 Détails de la suppression :</strong><br>
            <ul style="margin: 10px 0;">
                <li>Supprimé par : <strong>{deleter_email}</strong></li>
                <li>Niveau d'accès : <strong>{permission_label}</strong></li>
                <li>Date : <strong>{utc_maintenant().strftime('%d/%m/%Y à %H:%M')}</strong></li>
            </ul>
        </div>

        <div style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0;">
            <strong>⚠️ Attention :</strong> Cette action est irréversible. Toutes les données du projet ont été définitivement supprimées.
        </div>

        <p style="margin-top: 20px; color: #666;">
            Si cette suppression n'était pas autorisée, veuillez contacter immédiatement votre administrateur système.
        </p>
    </div>
    <div class="footer">
        <p>Cet email a été envoyé automatiquement par SolakVan.<br>
        Merci de ne pas répondre à cet email.</p>
    </div>
</body>
</html>
    """

    subject = f"🗑️ ALERTE : Suppression du projet {projet_name}"

    return send_email_notification(
        recipient_email=share.shared_by_email,
        subject=subject,
        body=body,
        html_body=html_body
    )
