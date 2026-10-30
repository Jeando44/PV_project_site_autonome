"""
Accès au « champ solaire depuis le cadastre » (décalage de parcelles, cf.
static/.../components/decalage_parcelles/DecalageParcelles.js).

Réglé dans config.py, sans toucher au code :
- DECALAGE_PARCELLES_POUR_TOUS : True -> tous les utilisateurs y ont accès ;
- sinon, seuls les comptes administrateurs (is_admin) et les adresses de DECALAGE_PARCELLES_EMAILS.

La même règle sert à afficher la fonctionnalité (context processor, app/__init__.py::inject_user)
et à la faire respecter à la sauvegarde du calepinage (route calepinage-maison/save) : un
utilisateur non autorisé ne peut pas enregistrer un NOUVEAU champ issu du cadastre, mais peut
toujours sauvegarder un projet contenant des champs créés par un compte autorisé (données de
décalage renvoyées telles qu'elles sont déjà en base).
"""
import json


def acces_decalage_parcelles(config, user):
    """Vrai si `user` (dict de session : email, is_admin) peut utiliser la fonctionnalité."""
    if config.get('DECALAGE_PARCELLES_POUR_TOUS'):
        return True
    if not isinstance(user, dict):
        return False
    if user.get('is_admin'):
        return True
    email = (user.get('email') or '').strip().lower()
    return bool(email) and email in (config.get('DECALAGE_PARCELLES_EMAILS') or [])


def _empreinte(origine):
    return json.dumps(origine, sort_keys=True, ensure_ascii=False)


def origines_nouvelles(maisons, origines_existantes):
    """
    Identifiants des maisons du payload dont `origineParcelles` n'existe pas déjà en base pour ce
    projet (comparaison du contenu, indépendante du numéro PVn qui peut changer au renumérotage).

    :param maisons: payload { maisonId: { ..., origineParcelles?: {...} } }
    :param origines_existantes: itérable des `origineParcelles` déjà enregistrés pour le projet
    """
    connues = {_empreinte(o) for o in origines_existantes if o is not None}
    nouvelles = []
    for maison_id, info in (maisons or {}).items():
        origine = info.get('origineParcelles') if isinstance(info, dict) else None
        if origine is not None and _empreinte(origine) not in connues:
            nouvelles.append(maison_id)
    return nouvelles
