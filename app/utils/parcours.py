"""
Parcours de création d'un projet : PRO, Résidentiel ou Site autonome.

Le choix du type de connexion et de la typologie se fait sur la page Solakvan, par le bouton qui
ouvre l'application ; « Paramètres projet » ne fait plus ce choix. Ses cartes sont MASQUÉES, jamais
retirées du DOM : tout le formulaire continue de lire et d'écrire les mêmes champs cachés
(#type_de_projet, #typologie_projet, #type_etude), seules les valeurs par défaut viennent du parcours.

Quel parcours ?
  - APPLICATION_EDITION=site_autonome (application PV_project_site_autonome) : toujours site autonome.
  - sinon (PV_project, service cmp-2025-v2) : déduit du chemin de la page.
      /concevoir_mon_projet/residentiel/  -> résidentiel
      /concevoir_mon_projet/              -> PRO
    Les autres pages (export, autoconsommation...) et les appels d'API reprennent le dernier parcours
    ouvert, mémorisé en session. Limite connue : deux onglets ouverts sur deux parcours différents
    partagent cette mémoire pour ces pages secondaires (la page principale, elle, suit son chemin).

Le parcours ne fixe que les valeurs d'un NOUVEAU projet : un projet existant garde les siennes (un
projet Grand projet, ou un ancien projet site autonome, s'ouvre et s'enregistre sans être modifié).
"""
import os

from flask import request, session

PARCOURS_PRO = 'pro'
PARCOURS_RESIDENTIEL = 'residentiel'
PARCOURS_SITE_AUTONOME = 'site_autonome'

EDITION_SITE_AUTONOME = 'site_autonome'

URL_ACCUEIL_PRO = '/concevoir_mon_projet/'
URL_ACCUEIL_RESIDENTIEL = '/concevoir_mon_projet/residentiel/'

# Valeurs stockées en base, identiques aux libellés des cartes de parametre.html.
TYPOLOGIE_RESIDENTIELLE = 'Résidentielle'
TYPOLOGIE_PRO = 'Professionnelle (C&I)'
TYPE_ETUDE_CHIFFRAGE = 'Chiffrage'
TYPE_ETUDE_TECHNICO_ECO = 'Étude technico-économique'

# Fonctions masquées par parcours (onglets, boutons, modales) : lues par les templates
# (`'cle' in parcours_projet.masquer`) et par le JS (window.parcoursMasque('cle')). Masquées, jamais
# supprimées : le code reste en place pour pouvoir les réafficher.
#   loi_aper         : Calculateur APER (menu latéral)
#   acc              : autoconsommation collective (carte du mode de valorisation)
#   plans_ombrieres  : dossier de plans de conception des ombrières (coupes, façades)
#   plans_petit_champ: dossier de plans de conception du petit champ solaire
#   dp               : déclaration préalable
#   ombrieres        : types de structure Ombrière (métal, bois, Solumbra)
#   enedis           : courbe de charge Enedis (Switchgrid)
#   revente_surplus  : case « Prendre en compte la revente du surplus » de l'étude économique
#   indices_projet   : bouton « Ajouter des indices / Indice projet » de Paramètres projet (devenu inutile)
#   dimensionnement  : entrée « Dimensionnement » du menu horizontal
#   carte_enedis     : bouton « Enedis » (réseau électrique) des vues de la carte (ToolBar/mapViews.js)
#   colonne_rc       : colonne « RC » du résumé du calepinage (ToolBar/resuméCalepinage.js)
#   colonne_resume_libelle : 1re colonne « Résumé du calepinage / Total » du même résumé
#
# Types de structure du calepinage masqués pour la typologie Résidentielle (en plus de `ombrieres`).
TYPES_OMBRIERE = ['ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra']

PARCOURS = {
    PARCOURS_PRO: {
        'code': PARCOURS_PRO,
        'libelle': 'Projet connecté au réseau - Professionnel',
        'type_de_projet': 'connecte',
        # « Grand projet » est traité comme PRO partout : il n'est plus proposé à la création.
        'typologies': [TYPOLOGIE_PRO],
        'typologie_defaut': TYPOLOGIE_PRO,
        'type_etude_defaut': TYPE_ETUDE_CHIFFRAGE,
        'url_accueil': URL_ACCUEIL_PRO,
        # Entrée du menu horizontal qui ouvre la modale de consommation (app_irve).
        'titre_consommation': "Consommation d'énergie",
        'masquer': ['indices_projet'],
        'types_structure_masques_residentiel': ['toiture_inclinee'],
    },
    PARCOURS_RESIDENTIEL: {
        'code': PARCOURS_RESIDENTIEL,
        'libelle': 'Projet connecté au réseau - Résidentiel',
        'type_de_projet': 'connecte',
        'typologies': [TYPOLOGIE_RESIDENTIELLE],
        'typologie_defaut': TYPOLOGIE_RESIDENTIELLE,
        'type_etude_defaut': TYPE_ETUDE_TECHNICO_ECO,
        'url_accueil': URL_ACCUEIL_RESIDENTIEL,
        'titre_consommation': "Consommation d'énergie",
        # Ombrières et petit champ solaire proposés (pergolas...), sans leurs dossiers de plans.
        'masquer': ['loi_aper', 'acc', 'plans_ombrieres', 'plans_petit_champ', 'indices_projet'],
        'types_structure_masques_residentiel': ['toiture_inclinee'],
    },
    PARCOURS_SITE_AUTONOME: {
        'code': PARCOURS_SITE_AUTONOME,
        'libelle': 'Site autonome',
        'type_de_projet': 'hors-ligne',
        # Les deux typologies restent enregistrées, mais ne se choisissent plus : elles découlent du
        # profil consommateur (Habitation -> Résidentielle, les autres -> Professionnelle), proposé
        # pour la typologie du système « Alimentation en électricité ». Système hybride et Pompage
        # solaire gardent la typologie par défaut.
        'typologies': [TYPOLOGIE_RESIDENTIELLE, TYPOLOGIE_PRO],
        'typologie_defaut': TYPOLOGIE_RESIDENTIELLE,
        # Le type d'étude se choisit parmi les typologies du système (Alimentation en électricité,
        # Système hybride, Solaire thermique, Pompage solaire) : la carte générique reste masquée,
        # avec cette valeur.
        'type_etude_defaut': TYPE_ETUDE_TECHNICO_ECO,
        'url_accueil': URL_ACCUEIL_PRO,
        # Une seule page par typologie du système (cf. irve_nav_menu.js), sans barre d'onglets.
        'titre_consommation': 'Profil de consommation',
        'masquer': ['dp', 'ombrieres', 'plans_ombrieres', 'enedis', 'revente_surplus', 'indices_projet',
                    'dimensionnement', 'carte_enedis', 'colonne_rc',
                    'colonne_resume_libelle'],
        'types_structure_masques_residentiel': ['toiture_inclinee', 'champ_solaire'],
    },
}


# Seule différence de code avec PV_project : cette copie est l'application Site autonome, même si
# APPLICATION_EDITION est absente de l'environnement.
EDITION_PAR_DEFAUT = EDITION_SITE_AUTONOME


def edition_application():
    """'site_autonome' pour l'application PV_project_site_autonome, '' pour PV_project."""
    return (os.getenv('APPLICATION_EDITION') or EDITION_PAR_DEFAUT).strip().lower()


def _description(code):
    """Copie du parcours, avec la liste complète des types de structure masqués."""
    p = dict(PARCOURS[code])
    p['types_structure_masques'] = list(TYPES_OMBRIERE) if 'ombrieres' in p['masquer'] else []
    return p


def parcours_actif():
    """Description du parcours de la requête courante (copie, modifiable sans risque)."""
    if edition_application() == EDITION_SITE_AUTONOME:
        return _description(PARCOURS_SITE_AUTONOME)

    chemin = request.environ.get('pv.chemin_public', request.path)
    if chemin.startswith(URL_ACCUEIL_RESIDENTIEL.rstrip('/')):
        code = PARCOURS_RESIDENTIEL
    elif chemin == URL_ACCUEIL_PRO:
        code = PARCOURS_PRO
    else:
        code = session.get('parcours')
        if code not in (PARCOURS_PRO, PARCOURS_RESIDENTIEL):
            code = PARCOURS_PRO
    if 'user' in session and session.get('parcours') != code:
        session['parcours'] = code
    return _description(code)


def url_accueil():
    """Page d'accueil (carte de calepinage) du parcours en cours, pour les redirections serveur."""
    return parcours_actif()['url_accueil']
