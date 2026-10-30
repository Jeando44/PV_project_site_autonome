"""
Middleware d'authentification par token de partage
Permet aux utilisateurs sans compte d'accéder aux projets partagés
"""
from functools import wraps
from flask import request, jsonify, g, session, redirect, url_for, flash
from app.models import ProjectShare, SharePermissionType


def create_guest_session_from_share(share):
    """
    Créer une session invité temporaire basée sur le partage

    Args:
        share: Instance de ProjectShare

    Returns:
        dict: Informations de l'utilisateur invité
    """
    guest_user = {
        'id': f"guest_{share.id}",
        'email': share.shared_with_email or f"guest_{share.share_token[:8]}@temporary.local",
        'is_guest': True,
        'share_id': share.id,
        'share_token': share.share_token,
        'permission_type': share.permission_type,
        'project_id': share.project_id,
        'can_edit': share.can_edit(),
        'can_admin': share.can_admin(),
        'shared_by_email': share.shared_by_email
    }

    # Stocker dans la session Flask
    session['guest_user'] = guest_user
    session['share_token'] = share.share_token
    session['is_guest_session'] = True

    return guest_user


def get_share_from_token(token):
    """
    Récupérer un partage valide depuis un token

    Args:
        token: Token de partage

    Returns:
        ProjectShare ou None
    """
    share = ProjectShare.query.filter_by(share_token=token).first()

    if not share:
        return None

    if not share.is_valid():
        return None

    return share


def share_token_required(permission_level=None):
    """
    Décorateur pour protéger les routes avec authentification par token de partage

    Args:
        permission_level: 'view', 'edit', ou 'admin' (optionnel)

    Usage:
        @share_token_required('edit')
        def edit_shared_project(token):
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Vérifier si on a un token dans l'URL, les paramètres ou la session
            token = kwargs.get('token') or request.args.get('token') or session.get('share_token')

            if not token:
                flash('Token de partage manquant', 'error')
                return redirect(url_for('index'))

            # Récupérer le partage
            share = get_share_from_token(token)

            if not share:
                flash('Lien de partage invalide ou expiré', 'error')
                return redirect(url_for('index'))

            # Vérifier le mot de passe si requis
            if share.require_password:
                # Vérifier si le mot de passe a déjà été validé dans cette session
                password_validated = session.get(f'password_validated_{token}')

                if not password_validated:
                    # Si c'est une requête POST avec mot de passe
                    if request.method == 'POST':
                        password = request.form.get('password')
                        if share.verify_password(password):
                            session[f'password_validated_{token}'] = True
                        else:
                            flash('Mot de passe incorrect', 'error')
                            return render_template('sharing/share_password.html',
                                                 share=share,
                                                 token=token)
                    else:
                        # Afficher le formulaire de mot de passe
                        from flask import render_template
                        return render_template('sharing/share_password.html',
                                             share=share,
                                             token=token)

            # Vérifier le niveau de permission si spécifié
            if permission_level:
                if permission_level == 'edit' and not share.can_edit():
                    flash('Vous n\'avez pas les permissions de modification', 'error')
                    return redirect(url_for('concevoir_mon_projet.access_shared_project',
                                          token=token))

                if permission_level == 'admin' and not share.can_admin():
                    flash('Vous n\'avez pas les permissions d\'administration', 'error')
                    return redirect(url_for('concevoir_mon_projet.access_shared_project',
                                          token=token))

            # Créer la session invité
            guest_user = create_guest_session_from_share(share)

            # Injecter dans g pour utilisation dans la route
            g.user = guest_user
            g.share = share
            g.is_guest = True

            # Ajouter le share à kwargs pour accès dans la fonction
            kwargs['share'] = share
            kwargs['guest_user'] = guest_user

            return f(*args, **kwargs)

        return decorated_function
    return decorator


def share_token_or_login_required(permission_level=None):
    """
    Décorateur hybride : accepte soit une session normale, soit un token de partage

    Usage:
        @share_token_or_login_required('edit')
        def edit_project(project_id):
            # Accessible aux utilisateurs connectés ET aux invités avec token
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Vérifier d'abord si l'utilisateur est connecté normalement
            if hasattr(g, 'user') and g.user and not g.user.get('is_guest'):
                # Utilisateur connecté normalement
                return f(*args, **kwargs)

            # Sinon, vérifier le token de partage
            token = kwargs.get('token') or request.args.get('token') or session.get('share_token')

            if token:
                # Utiliser l'authentification par token
                share = get_share_from_token(token)

                if share:
                    # Vérifier le mot de passe si requis
                    if share.require_password:
                        password_validated = session.get(f'password_validated_{token}')

                        if not password_validated:
                            if request.method == 'POST':
                                password = request.form.get('password')
                                if share.verify_password(password):
                                    session[f'password_validated_{token}'] = True
                                else:
                                    flash('Mot de passe incorrect', 'error')
                                    from flask import render_template
                                    return render_template('sharing/share_password.html',
                                                         share=share,
                                                         token=token)
                            else:
                                from flask import render_template
                                return render_template('sharing/share_password.html',
                                                     share=share,
                                                     token=token)

                    # Vérifier permissions
                    if permission_level:
                        if permission_level == 'edit' and not share.can_edit():
                            flash('Permissions insuffisantes', 'error')
                            return redirect(url_for('index'))

                        if permission_level == 'admin' and not share.can_admin():
                            flash('Permissions insuffisantes', 'error')
                            return redirect(url_for('index'))

                    # Créer session invité
                    guest_user = create_guest_session_from_share(share)
                    g.user = guest_user
                    g.share = share
                    g.is_guest = True

                    kwargs['share'] = share

                    return f(*args, **kwargs)

            # Ni connecté, ni token valide
            flash('Authentification requise', 'error')
            return redirect(url_for('index'))

        return decorated_function
    return decorator


def get_current_user_or_guest():
    """
    Récupérer l'utilisateur actuel (normal ou invité)

    Returns:
        dict: Informations utilisateur ou None
    """
    # Vérifier si on a un utilisateur normal
    if hasattr(g, 'user') and g.user:
        return g.user

    # Vérifier si on a une session invité
    if session.get('is_guest_session') and session.get('guest_user'):
        return session.get('guest_user')

    # Vérifier si on a un token dans la session
    token = session.get('share_token')
    if token:
        share = get_share_from_token(token)
        if share:
            return create_guest_session_from_share(share)

    return None


def clear_guest_session():
    """
    Nettoyer la session invité
    """
    session.pop('guest_user', None)
    session.pop('share_token', None)
    session.pop('is_guest_session', None)

    # Nettoyer les validations de mot de passe
    keys_to_remove = [key for key in session.keys() if key.startswith('password_validated_')]
    for key in keys_to_remove:
        session.pop(key, None)
