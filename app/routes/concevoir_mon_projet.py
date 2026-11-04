from flask import Blueprint, request, jsonify, render_template, g, url_for, flash, redirect, session, send_file, current_app, abort
from app.services.mention_essai import pdf_pour_utilisateur
from datetime import datetime
from app.utils.dates import utc_maintenant
import io
import json
import re
import pydantic
from app.models import ParametreProjet, NormeCalcul, ProjectShare, ShareActivity, SharePermissionType
from app.models import Calepinage, GeometrieProjet, MaterielCatalogue, CalepinageMaison
from app.models import (
    Panneau, Onduleur, Batterie, Optimiseur, PompeSolaire,
    OptimiseurOnduleurCompat, BatterieOnduleurCompat,
)
from app.models import IrveConfig, EtudeEconomiqueConfig, ResidentielChiffrageConfig, ProjetRevision
from app.models import PompageSolaireConfig
from app.services.variantes_projet import (
    capturer_etat, restaurer_etat, prochain_indice_libre, rattacher_indice,
    synchroniser_fichiers, lire_fichiers, nettoyer_libelle,
)
from app.models import PersonnalisationRapport
from app.models import ConsommationFile, ConsommationFileAcc
from app.models.calcul_prodsolaire.calcul_autoconso import extract_consumption
from app.schemas.irve_schemas import IrveCurveSchema, IrveConfigDataSchema
from app.schemas.pac_schemas import PacCurveSchema
from app.services.pac_controle import verifier_courbe_pac
from app.services.irve_controle import (
    verifier_courbe_a_enregistrer, horodatage as horodatage_irve,
    energie_kwh as irve_energie_kwh, ecart_admis as irve_ecart_admis,
)
from app.schemas.pompage_solaire_schemas import PompageSolaireSauvegarde, TAILLE_MAX_SAUVEGARDE_POMPAGE
from app.schemas.residentiel_chiffrage_schemas import (
    ResidentielCapexSchema, ResidentielOpexSchema, ResidentielRuleError, validate_capex_business_rules,
    calculer_totaux_capex, TOLERANCE_TOTAUX_EUR, extraire_taux_conversion, valider_taux_conversion,
    valider_capex_simple, CAPEX_MODES_SIMPLES
)
from app.models.parametre_projet import normaliser_typologie, normaliser_type_etude
from app.schemas.calepinage_dimensionnement_schemas import (
    DimensionnementValidationError, valider_champs_dimensionnement, valider_cablage_dc,
    valider_champs_geometrie_toiture, valider_reglages_creation_contour
)
from app.schemas.decalage_parcelles_schemas import valider_origine_parcelles
from app.services.decalage_parcelles_acces import acces_decalage_parcelles, origines_nouvelles
from app.middleware.auth_middleware import login_required, permission_required, decode_scoped_token
from app.extensions import db
from sqlalchemy.orm import defer, load_only
from app.utils.email_service import send_share_notification_email, send_access_notification_email, send_modification_notification_email, send_deletion_notification_email
from app.utils.share_token_auth import share_token_required, share_token_or_login_required, get_current_user_or_guest

from app.models.ombriere_metal import calculate_ombriere
from app.models.calepinage_ombriere import calculate_calepinage, get_system_dropdown, get_system_data
from app.models.ombriere_solumbra import calculate_ombriere as calculate_ombriere_solumbra
from app.models.batiment_metal import calculate_building_geometry_batiment_metal
from app.models.ombriere_bois import calculate_ombriere_bois
from app.models.calepinage_maison_verification import verify_maison_state, verify_maison_state_geodesic
from app.models.calepinage_maison_verification.surface_contour import (
    SurfaceContourError, verifier_surface_maison, verifier_surface_etat_verification,
)
from app.services.licence_quota import get_power_tolerance_ratio
from app.services.puissance_projet import puissance_calepinage_kwc
from app.services.loi_aper import valider_surface_projetee_m2
from app.services import resultats_prodsolaire
from app.services.champs_pv_renumerotation import (
    appliquer as appliquer_renumerotation_champs, valider_renumerotation,
)
from app.models.parametre_projet import ProjectQuotaCounter
from config import DISTANCE_SEUIL_PROJET, DISTANCE_MAX_CALEPINAGE
import math


def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """Calcule la distance en mètres entre deux coordonnées géographiques (formule de Haversine)."""
    R = 6371000.0
    try:
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        delta_phi = math.radians(float(lat2) - float(lat1))
        delta_lambda = math.radians(float(lon2) - float(lon1))

        a = math.sin(delta_phi / 2.0) ** 2 + \
            math.cos(phi1) * math.cos(phi2) * \
            math.sin(delta_lambda / 2.0) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        return R * c
    except Exception:
        return 0.0



def _clamp_number(val, min_val, max_val, fallback=None):
    """Miroir Python de ClampUtils.js::clampNumber — ne jamais faire confiance au bornage client."""
    try:
        n = float(val)
    except (TypeError, ValueError):
        return fallback
    return max(min_val, min(max_val, n))


def _clamp_word_count(val, max_words, max_chars):
    """Miroir Python de ClampUtils.js::clampWordCount, avec une limite de caractères en plus."""
    words = str(val or '').strip().split()
    return ' '.join(words[:max_words])[:max_chars]


def _clean_charge_etudes(val):
    """Chargé(e) d'études : texte libre, espaces normalisés, 30 caractères max, None si vide."""
    return ' '.join(str(val or '').split())[:30].strip() or None


# Valeurs exactes produites par les 3 cartes de sélection de typologie (parametre.html, step
# #step_typologie) — le JS écrit le texte du <h5> tel quel dans le champ (cf.
# parametreProjetFormManager.js::singleSelections). Définies avec la normalisation dans le modèle.
from app.models.parametre_projet import TYPOLOGIES_PROJET_VALIDES, normaliser_typologie  # noqa: E402


def _normalize_typologie_projet(val):
    """Validation SOUPLE de typologie_projet à l'écriture (audit du 2026-09-07 : colonne libre en
    base, 14 projets existants à NULL et au moins 1 avec 'Residentielle' sans accent — une
    contrainte stricte en base casserait ces données historiques, cf. décision explicite de ne pas
    ajouter de contrainte ENUM). Corrige la faute de frappe déjà observée en production, journalise
    sans jamais bloquer l'enregistrement si la valeur est inconnue (une 4ᵉ typologie future, par
    exemple, ne doit pas faire échouer la sauvegarde).
    """
    if not val or not val.strip():
        return val
    # Accent manquant, casse, espaces : forme canonique (cf. normaliser_typologie).
    val = normaliser_typologie(val)
    if val not in TYPOLOGIES_PROJET_VALIDES:
        current_app.logger.warning(
            f"typologie_projet inattendue reçue et enregistrée telle quelle : {val!r}"
        )
    return val


def _sanitize_adresse_dict(data):
    """CORRECTIF (demande explicite : "réfuser les données corrompues" sur l'adresse
    texte/coordonnées GPS) : dernier filet de sécurité, appliqué quel que soit le format d'origine
    reconnu par _normalize_adresse() — ne fait jamais confiance à ce qu'envoie le client (même
    principe que _clamp_number() plus haut). Retire latitude/longitude si elles ne sont pas des
    nombres valides ou sortent des plages géographiques réelles (jamais de coordonnées corrompues
    stockées telles quelles), et retire un texte d'adresse vide/blanc — sans jamais faire échouer
    toute la requête : une adresse partiellement invalide est simplement nettoyée plutôt que
    rejetée en bloc, la validation bloquante côté formulaire (parametreProjetFormManager.js)
    restant la première ligne de défense pour guider l'utilisateur.
    """
    if not data:
        return data
    result = dict(data)

    lat = result.get('latitude')
    lng = result.get('longitude')
    if lat is not None and lng is not None:
        try:
            lat_f, lng_f = float(lat), float(lng)
            if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
                raise ValueError('Coordonnées hors plage')
            result['latitude'], result['longitude'] = lat_f, lng_f
        except (TypeError, ValueError):
            result.pop('latitude', None)
            result.pop('longitude', None)

    adresse = result.get('adresse')
    if isinstance(adresse, str) and not adresse.strip():
        result.pop('adresse', None)

    # Texte libre renvoyé par le client : borné, et retiré s'il n'est pas une chaîne non vide.
    complete = result.get('adresse_complete')
    if not isinstance(complete, str) or not complete.strip():
        result.pop('adresse_complete', None)
    else:
        result['adresse_complete'] = complete.strip()[:500]

    return result


def _normalize_adresse(raw_value):
    """Extrait {adresse, latitude, longitude, radius, type} depuis n'importe quel format de sérialisation.
    Gère : JSON simple, double-sérialisé, et {"adresse": "<json string>"} (bug historique de la route create).
    """
    if not raw_value:
        return {}
    current = raw_value
    for _ in range(3):
        if not isinstance(current, str):
            break
        try:
            current = json.loads(current)
        except (json.JSONDecodeError, TypeError):
            return _sanitize_adresse_dict({'adresse': current})
    if not isinstance(current, dict):
        return _sanitize_adresse_dict({'adresse': str(current)})
    # Coordonnées directement disponibles
    if current.get('latitude') is not None and current.get('longitude') is not None:
        return _sanitize_adresse_dict({k: v for k, v in {
            'adresse': current.get('adresse', ''),
            'latitude': current['latitude'],
            'longitude': current['longitude'],
            'radius': current.get('radius', 3000),
            'type': current.get('type', ''),
            # Adresse d'origine du géocodeur ; `adresse` porte désormais l'adresse COURTE affichée
            # partout (cf. static/.../parametreProjetMap/adresseCourte.js).
            'adresse_complete': current.get('adresse_complete'),
        }.items() if v is not None})
    # Cas du bug historique : {"adresse": "<json string avec lat/lng>"}
    adresse_field = current.get('adresse', '')
    if isinstance(adresse_field, str) and adresse_field.strip().startswith('{'):
        try:
            inner = json.loads(adresse_field)
            if isinstance(inner, dict) and inner.get('latitude') is not None:
                return _sanitize_adresse_dict({k: v for k, v in {
                    'adresse': inner.get('adresse', adresse_field),
                    'latitude': inner['latitude'],
                    'longitude': inner['longitude'],
                    'radius': inner.get('radius', 3000),
                    'type': inner.get('type', ''),
                    'adresse_complete': inner.get('adresse_complete'),
                }.items() if v is not None})
        except (json.JSONDecodeError, TypeError):
            pass
    return _sanitize_adresse_dict({k: v for k, v in current.items() if v is not None})



def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def _get_project_with_permission(projet_id, user, allow_deleted=False):
    """
    Récupère un projet selon les droits de l'utilisateur :
    - Administrateur (is_admin=True) : accès à n'importe quel projet existant.
    - Utilisateur standard : accès strictement limité aux projets qu'il a créés (created_by == user['id']).
    """
    if not user or not user.get('id'):
        return None
    query = ParametreProjet.query.filter_by(id=projet_id)
    if not user.get('is_admin'):
        query = query.filter_by(created_by=user['id'])
    if not allow_deleted:
        query = query.filter(
            db.or_(ParametreProjet.is_deleted == False, ParametreProjet.is_deleted.is_(None))
        )
    return query.first()

# Blueprint principal
concevoir_mon_projet_bp = Blueprint(
    'concevoir_mon_projet', __name__, url_prefix='/concevoir_mon_projet')


# ==========================================
# ROUTES PARAMETRES PROJET
# ==========================================

@concevoir_mon_projet_bp.route('/parametres-projets', methods=['GET'])
@login_required
def liste_parametres_projets():
    """Liste les projets : tous les projets pour l'admin, propres projets pour l'utilisateur standard"""
    try:
        current_user = g.user
        search = request.args.get('search', '')
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        # Bornes : évite une page vide/négative et une requête géante (la liste charge aussi
        # les révisions de chaque projet).
        per_page = max(1, min(per_page or 10, 200))
        page = max(1, page or 1)
        created_by_filter = (request.args.get('created_by') or '').strip()
        is_admin = bool(current_user and current_user.get('is_admin'))

        base_query = ParametreProjet.query.filter(
            db.or_(ParametreProjet.is_deleted == False, ParametreProjet.is_deleted.is_(None))
        )

        # 🔒 Sécurité : si non-admin, isolation stricte aux projets créés par l'utilisateur
        if not is_admin:
            base_query = base_query.filter(ParametreProjet.created_by == current_user['id'])

        query = base_query
        # Filtre admin « Créé(e) par » (ignoré pour un non-admin, déjà limité à ses projets)
        if is_admin and created_by_filter:
            query = query.filter(ParametreProjet.created_by == created_by_filter)

        # Recherche
        if search:
            search_conditions = [
                ParametreProjet.nom_projet.ilike(f'%{search}%'),
                ParametreProjet.adresse_projet.ilike(f'%{search}%')
            ]
            if is_admin:
                search_conditions.extend([
                    ParametreProjet.created_by_name.ilike(f'%{search}%'),
                    ParametreProjet.created_by_email.ilike(f'%{search}%')
                ])
            query = query.filter(db.or_(*search_conditions))

        # Pagination (page ramenée à la dernière page existante si elle la dépasse, ex. après
        # une suppression ou un changement de filtre)
        ordered = query.order_by(ParametreProjet.created_at.desc())
        pagination = ordered.paginate(page=page, per_page=per_page, error_out=False)
        if pagination.pages and page > pagination.pages:
            page = pagination.pages
            pagination = ordered.paginate(page=page, per_page=per_page, error_out=False)

        projets = []
        for p in pagination.items:
            p_dict = p.to_dict(include_norme=True)
            # Colonne « Puissance projet (kWc) » : puissance_projet_kwc (figée au dernier calcul/
            # export, None -> tiret) comparée à la puissance du calepinage enregistré : un écart
            # signifie « calepinage modifié depuis, cliquer sur Calculer ».
            p_dict['puissance_calepinage_kwc'] = puissance_calepinage_kwc(p)
            p_dict['revisions'] = [_resume_revision(r) for r in _revisions_du_projet(p.id)]
            projets.append(p_dict)

        # Liste des créateurs (filtre admin « Créé(e) par ») : tous les projets non supprimés,
        # indépendamment de la recherche/pagination en cours.
        createurs = []
        if is_admin:
            rows = db.session.query(
                ParametreProjet.created_by,
                db.func.max(ParametreProjet.created_by_name),
                db.func.max(ParametreProjet.created_by_email),
                db.func.count(ParametreProjet.id)
            ).filter(
                db.or_(ParametreProjet.is_deleted == False, ParametreProjet.is_deleted.is_(None))
            ).group_by(ParametreProjet.created_by).all()
            createurs = sorted(
                [{'id': r[0], 'nom': r[1] or r[2] or r[0], 'email': r[2], 'nb_projets': r[3]} for r in rows],
                key=lambda c: (c['nom'] or '').lower()
            )

        return jsonify({
            'success': True,
            'projets': projets,
            'total': pagination.total,
            'pages': pagination.pages,
            'current_page': page,
            'per_page': per_page,
            'is_admin': is_admin,
            'createurs': createurs
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


def _revisions_du_projet(projet_id):
    return ProjetRevision.query.filter_by(projet_id=projet_id).order_by(ProjetRevision.indice).all()


def _resume_revision(revision):
    """Résumé d'une variante pour les listes (Mes projets, modale de sauvegarde du rapport)."""
    return {
        'id': revision.id,
        'indice': revision.indice,
        'description': revision.description,
        'libelle': revision.libelle,
        'restaurable': revision.restaurable,
        'updated_at': revision.updated_at.isoformat() if revision.updated_at else None,
    }


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/revisions', methods=['GET'])
@login_required
def list_project_revisions(projet_id):
    """Variantes du projet, variante active et prochaine lettre libre (None si A-D complets)."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404

        revisions = _revisions_du_projet(projet_id)
        return jsonify({
            'success': True,
            'revisions': [_resume_revision(r) for r in revisions],
            'active_indice': projet.active_indice,
            'next_suggested': prochain_indice_libre(r.indice for r in revisions),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/revision/save', methods=['POST'])
@login_required
def save_project_revision(projet_id):
    """Fige l'état de conception du projet (tables de travail, déjà enregistrées par le navigateur)
    dans une variante. Actions :
      - 'enregistrer' : aucune variante -> crée l'Indice A ; sinon met à jour la variante ACTIVE ;
      - 'creer_variante' : crée la prochaine lettre libre (B, C, D), seulement si A existe ;
        la nouvelle variante devient active ;
      - 'ecraser' + 'indice' : remplace la variante EXISTANTE choisie par l'état actuel ; elle devient
        active, la variante ouverte avant garde sa dernière copie enregistrée (décision 2026-11-04).
    'libelle' (facultatif, 30 caractères max, nettoyé) : absent = libellé inchangé, '' = effacé."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        req_data = request.get_json(silent=True) or {}
        action = req_data.get('action', 'enregistrer')
        if action not in ('enregistrer', 'creer_variante', 'ecraser'):
            return jsonify({'success': False, 'message': 'Action de sauvegarde de variante inconnue'}), 400

        libelle_fourni = 'libelle' in req_data
        libelle, erreur_libelle = nettoyer_libelle(req_data.get('libelle'))
        if erreur_libelle:
            return jsonify({'success': False, 'message': erreur_libelle}), 400

        revisions = {r.indice.upper(): r for r in _revisions_du_projet(projet_id)}

        if action == 'ecraser':
            indice = str(req_data.get('indice') or '').strip().upper()
            if indice not in revisions:
                return jsonify({'success': False, 'message': f"La variante {indice or '?'} n'existe pas : rien n'a été écrasé."}), 400
            revision = revisions[indice]
        elif action == 'creer_variante':
            if 'A' not in revisions:
                return jsonify({'success': False, 'message': "Enregistrez d'abord le projet (variante A) avant de créer une variante."}), 400
            indice = prochain_indice_libre(revisions.keys())
            if not indice:
                return jsonify({'success': False, 'message': 'Limite atteinte : les variantes A à D existent déjà.'}), 400
            revision = None
        elif not revisions:
            indice, revision = 'A', None
        else:
            indice = (projet.active_indice or '').upper()
            if indice not in revisions:
                # Variante active inconnue (projet antérieur aux variantes) : la variante de référence.
                indice = 'A' if 'A' in revisions else sorted(revisions)[0]
            revision = revisions[indice]

        if revision is None:
            revision = ProjetRevision(
                projet_id=projet_id, indice=indice,
                description='Version initiale' if indice == 'A' else f'Variante {indice}',
            )
            db.session.add(revision)

        fichiers = {}
        revision.donnees = capturer_etat(projet, fichiers)
        synchroniser_fichiers(revision, fichiers)
        if libelle_fourni:
            revision.libelle = libelle
        revision.updated_at = utc_maintenant()
        projet.active_indice = indice
        rattacher_indice(projet, indice)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'La variante {indice} a été enregistrée.',
            'revision': _resume_revision(revision),
            'active_indice': indice,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/revision/<string:indice>/load', methods=['POST'])
@login_required
def load_project_revision(projet_id, indice):
    """Ouvre une variante : réécrit TOUTES les tables de travail depuis sa copie (une table vide dans
    la copie vide la table de travail), dans une seule transaction. Le navigateur doit avoir
    enregistré la variante active avant (sinon ses modifications non enregistrées sont perdues)."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        indice = indice.upper()
        revision = ProjetRevision.query.filter_by(projet_id=projet_id, indice=indice).first()
        if not revision:
            return jsonify({'success': False, 'message': f'Variante {indice} introuvable pour ce projet'}), 404
        if not revision.restaurable:
            return jsonify({'success': False, 'message': (
                f"La variante {indice} a été enregistrée avec une ancienne version de l'application et ne "
                f"contient pas le calepinage : elle ne peut pas être ouverte. Ouvrez le projet sur cette "
                f"variante et enregistrez-la de nouveau depuis le rapport.")}), 409

        avertissements = restaurer_etat(projet, revision.donnees, lire_fichiers(revision))
        projet.active_indice = indice
        rattacher_indice(projet, indice)
        projet.updated_at = utc_maintenant()
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'Variante {indice} ouverte.',
            'active_indice': indice,
            'avertissements': avertissements,
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/revision/<string:indice>', methods=['DELETE'])
@login_required
def delete_project_revision(projet_id, indice):
    """Supprime une variante B, C ou D (les lettres suivantes ne sont pas renommées)."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404

        indice = indice.upper()
        if indice == 'A':
            return jsonify({'success': False, 'message': "La variante A est la variante de référence du projet et ne peut pas être supprimée individuellement."}), 400
        if (projet.active_indice or '').upper() == indice:
            return jsonify({'success': False, 'message': f"La variante {indice} est ouverte : ouvrez une autre variante avant de la supprimer."}), 400

        revision = ProjetRevision.query.filter_by(projet_id=projet_id, indice=indice).first()
        if not revision:
            return jsonify({'success': False, 'message': f'Variante {indice} introuvable'}), 404

        db.session.delete(revision)
        db.session.commit()
        return jsonify({'success': True, 'message': f'La variante {indice} a été supprimée.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/etude-economique/save', methods=['POST'])
@login_required
def save_etude_economique_config(projet_id):
    """Sauvegarder les paramètres de configuration de l'étude économique"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        # Page restée sur un ancien projet (autre onglet, projet changé entre-temps) : refusé, comme
        # le calepinage, pour ne jamais écrire le chiffrage / l'étude éco d'un projet dans un autre.
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        req_data = request.get_json(silent=True) or {}
        if not req_data or 'data' not in req_data:
            return jsonify({'success': False, 'message': 'Aucune donnée fournie'}), 400

        # Récupérer ou initialiser la configuration de l'étude économique
        config = EtudeEconomiqueConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = EtudeEconomiqueConfig(projet_id=projet_id)
            db.session.add(config)

        # Mise à jour des attributs — les saisies des modales éco ACC, rangées dans le même blob
        # (CLE_ACC_PARAMETRES_ECO), ne sont jamais écrasées par l'étude économique.
        nouvelles = dict(req_data.get('data') or {})
        try:
            extraire_taux_conversion(nouvelles)
        except ValueError as err_conv:
            return jsonify({'success': False, 'message': str(err_conv)}), 400
        nouvelles.pop(CLE_ACC_PARAMETRES_ECO, None)
        if config.data and CLE_ACC_PARAMETRES_ECO in config.data:
            nouvelles[CLE_ACC_PARAMETRES_ECO] = config.data[CLE_ACC_PARAMETRES_ECO]
        config.data = nouvelles
        config.updated_at = utc_maintenant()
        db.session.commit()
        
        print(f"✅ [Flask Terminal] Données d'étude économique sauvegardées en base pour le projet {projet_id}")
        return jsonify({
            'success': True,
            'message': 'Configuration de l\'étude économique sauvegardée avec succès'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/etude-economique/load', methods=['GET'])
@login_required
def load_etude_economique_config(projet_id):
    """Charger la configuration d'étude économique d'un projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        config = EtudeEconomiqueConfig.query.filter_by(projet_id=projet_id).first()
        # Saisies ACC (route acc-parametres-eco) retirées : propres aux modales ACC. Un blob qui ne
        # contient qu'elles = étude économique jamais enregistrée.
        donnees = {k: v for k, v in ((config.data if config else None) or {}).items() if k != CLE_ACC_PARAMETRES_ECO}
        if not config or not donnees:
            return jsonify({'success': True, 'config_exists': False})

        config_dict = config.to_dict()
        config_dict['data'] = donnees
        return jsonify({
            'success': True,
            'config_exists': True,
            'nom_projet': projet.nom_projet,
            'config': config_dict
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# Saisies des modales « Paramètres économiques détaillés (ACC) » ('tarifs') et « Analyse financière
# avancée (Producteur) » ('avance'), rangées sous cette clé du blob etudes_economiques_configs.data :
# pas de table ni de migration dédiées, et copiées avec les variantes (services/variantes_projet.py).
CLE_ACC_PARAMETRES_ECO = '_acc_parametres_eco'
_ACC_PARAMETRES_ECO_PARTIES = ('tarifs', 'avance')
_ACC_PARAMETRES_ECO_TAILLE_MAX = 200_000  # octets JSON (30 participants max : quelques Ko)


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/acc-parametres-eco', methods=['GET'])
@login_required
def load_acc_parametres_eco(projet_id):
    """Saisies des modales éco ACC enregistrées pour ce projet ({} si aucune)."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    config = EtudeEconomiqueConfig.query.filter_by(projet_id=projet_id).first()
    saisies = ((config.data if config else None) or {}).get(CLE_ACC_PARAMETRES_ECO) or {}
    return jsonify({'success': True, 'parametres': saisies})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/acc-parametres-eco', methods=['POST'])
@login_required
def save_acc_parametres_eco(projet_id):
    """Enregistre une partie ('tarifs' ou 'avance') des saisies des modales éco ACC, sans toucher à
    l'autre partie ni aux saisies de l'étude économique rangées dans le même blob."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        req_data = request.get_json(silent=True) or {}
        partie = req_data.get('partie')
        valeurs = req_data.get('valeurs')
        if partie not in _ACC_PARAMETRES_ECO_PARTIES or not isinstance(valeurs, dict):
            return jsonify({'success': False, 'message': 'Données invalides'}), 400
        if len(json.dumps(valeurs)) > _ACC_PARAMETRES_ECO_TAILLE_MAX:
            return jsonify({'success': False, 'message': 'Données trop volumineuses'}), 400

        config = EtudeEconomiqueConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = EtudeEconomiqueConfig(projet_id=projet_id, data={})
            db.session.add(config)
        # Nouveaux dictionnaires : une colonne JSON n'est vue modifiée que si elle est réaffectée.
        data = dict(config.data or {})
        saisies = dict(data.get(CLE_ACC_PARAMETRES_ECO) or {})
        saisies[partie] = valeurs
        data[CLE_ACC_PARAMETRES_ECO] = saisies
        config.data = data
        config.updated_at = utc_maintenant()
        db.session.commit()
        return jsonify({'success': True})
    except Exception:
        db.session.rollback()
        return jsonify({'success': False, 'message': "Enregistrement des paramètres économiques ACC impossible."}), 500


# ==========================================
# RÉSULTATS PROSOLAIRE REPRIS PAR L'ÉTUDE ÉCONOMIQUE
# ==========================================
# Écrits par les routes de calcul ProSolaire (main_prodsolaire.py), jamais par le client : il peut
# seulement les lire, les déclarer périmés (courbes ou calepinage modifiés, stockage retiré) et
# demander au serveur si le formulaire éco leur est conforme.

@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/resultats-prodsolaire', methods=['GET'])
@login_required
def lire_resultats_prodsolaire(projet_id):
    """Valeurs du dernier calcul ProSolaire à afficher dans la modale « Études économiques »."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    reference = resultats_prodsolaire.reference_eco(projet.id)
    return jsonify({'success': True, 'disponible': reference is not None, 'reference': reference})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/resultats-prodsolaire', methods=['DELETE'])
@login_required
def invalider_resultats_prodsolaire(projet_id):
    """Résultats périmés (?partie=stockage : seul le stockage est retiré)."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    try:
        if request.args.get('partie') == 'stockage':
            resultats_prodsolaire.supprimer_stockage(projet.id)
        else:
            resultats_prodsolaire.supprimer(projet.id)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/resultats-prodsolaire/stockage-affiche', methods=['POST'])
@login_required
def stockage_affiche_resultats_prodsolaire(projet_id):
    """« Intégration du stockage » Oui/Non dans ProSolaire : le stockage déjà calculé entre ou non
    dans l'étude éco, comme dans les résultats affichés (aucune valeur n'est reçue du client)."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    affiche = (request.get_json(silent=True) or {}).get('affiche')
    if not isinstance(affiche, bool):
        return jsonify({'success': False, 'message': "Paramètre 'affiche' attendu (booléen)"}), 400
    try:
        modifie = resultats_prodsolaire.afficher_stockage(projet.id, affiche)
        db.session.commit()
        return jsonify({'success': True, 'stockage_present': modifie})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/puissance-etude', methods=['GET'])
@login_required
def puissance_etude(projet_id):
    """Puissance (kWc) du projet pour l'étude éco et le devis, décidée par le serveur :
    projet « Chiffrage » -> panneaux du calepinage ENREGISTRÉ (pas de calcul ProSolaire en
    avant-projet) ; sinon -> puissance du calcul ProSolaire enregistré. None si inconnue."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    source, puissance = _puissance_etude_kwc(projet)
    return jsonify({'success': True, 'source': source, 'puissance_kwc': puissance})


def _puissance_etude_kwc(projet):
    """(source, puissance kWc ou None) : calepinage enregistré pour un projet « Chiffrage », sinon
    calcul ProSolaire enregistré. Même valeur que le champ « Puissance installée » de l'étude éco."""
    if str(normaliser_type_etude(projet.type_etude) or '').strip().lower() == 'chiffrage':
        return 'calepinage', puissance_calepinage_kwc(projet)
    reference = resultats_prodsolaire.reference_eco(projet.id)
    return 'prosolaire', (reference.get('puissance_kwc') if reference else None)


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/resultats-prodsolaire/verifier', methods=['POST'])
@login_required
def verifier_resultats_prodsolaire(projet_id):
    """Contrôle bloquant : valeurs du formulaire éco == valeurs du calcul ProSolaire enregistré."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    saisies = request.get_json(silent=True) or {}
    if not isinstance(saisies, dict):
        return jsonify({'success': False, 'message': 'Données illisibles'}), 400
    reference = resultats_prodsolaire.reference_eco(projet.id)
    ecarts = resultats_prodsolaire.verifier_saisies_eco(reference, saisies)
    return jsonify({'success': True, 'conforme': not ecarts, 'ecarts': ecarts, 'reference': reference})


def _profil_chiffrage(projet):
    """Profil du tableau de chiffrage CAPEX : même aiguillage que window.isResidentialPath()
    (parametre.html) — parcours résidentiel pour une typologie Résidentielle ou un projet Site
    autonome, sinon PRO / Grand projet (bornes élargies, cartes Structure / Génie civil / EP).
    Décidé ici à partir du projet en base, jamais sur la foi du client."""
    if normaliser_typologie(projet.typologie_projet) == 'Résidentielle' or projet.type_de_projet == 'hors-ligne':
        return 'residentiel'
    return 'pro'


# Chiffrage initial (avant-projet) : copie du devis figée côté serveur tant que le projet est en
# type d'étude « Chiffrage », rangée dans le blob ResidentielChiffrageConfig.data sous cette clé
# (même ligne : suit les variantes sans table ni colonne supplémentaire). Jamais écrite par le
# navigateur ; rouverte par « Ouvrir le chiffrage initial » une fois le projet passé en Étude
# technico-économique / de conception.
CLE_CHIFFRAGE_INITIAL = 'chiffrageInitial'


def _est_chiffrage(projet):
    return str(normaliser_type_etude(projet.type_etude) or '').strip().lower() == 'chiffrage'


def _instantane_chiffrage(data):
    return {'capex': data.get('capex'), 'opex': data.get('opex'), 'fige_le': utc_maintenant().isoformat()}


def _figer_chiffrage_initial_si_absent(projet):
    """Projet quittant le type Chiffrage : chiffrage enregistré avant cette fonctionnalité (aucune
    copie figée) -> copie prise maintenant, avant le changement de type (sans commit)."""
    config = ResidentielChiffrageConfig.query.filter_by(projet_id=projet.id).first()
    if not config or not isinstance(config.data, dict) or config.data.get(CLE_CHIFFRAGE_INITIAL):
        return
    if not config.data.get('capex'):
        return
    config.data = {**config.data, CLE_CHIFFRAGE_INITIAL: _instantane_chiffrage(config.data)}


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/residentiel-chiffrage/save', methods=['POST'])
@login_required
def save_residentiel_chiffrage_config(projet_id):
    """Sauvegarder la configuration du chiffrage résidentiel (CAPEX/OPEX/TVA) du projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        # Page restée sur un ancien projet (autre onglet, projet changé entre-temps) : refusé, comme
        # le calepinage, pour ne jamais écrire le chiffrage / l'étude éco d'un projet dans un autre.
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        req_data = request.get_json(silent=True) or {}
        if not req_data or 'data' not in req_data:
            return jsonify({'success': False, 'message': 'Aucune donnée fournie'}), 400

        # CORRECTIF (demande explicite : "validation stricte... rejet strict... ne jamais modifier,
        # tronquer ou corriger silencieusement") : jusqu'ici, ce blob JSON était écrit tel quel en
        # base sans aucune vérification. On valide désormais le CAPEX (forme via Pydantic, puis
        # règles métier quantité/PU HT par sous-type via validate_capex_business_rules()) ET l'OPEX
        # (charges annuelles, bornes fixes par charge) avant toute écriture — la moindre donnée
        # invalide rejette la requête ENTIÈRE, rien n'est persisté.
        data_blob = req_data.get('data') or {}
        capex_payload = data_blob.get('capex')
        # NB : malgré le commentaire d'en-tête de ResidentielChiffrageDB.js ("opex: {charges}"), le
        # payload réellement envoyé par Opex.getData() est le flat {assurances, communication,
        # visiteTechnique, autres} directement sous 'opex' (pas de sous-clé 'charges').
        opex_payload = data_blob.get('opex')
        profil = _profil_chiffrage(projet)
        try:
            taux_conv = extraire_taux_conversion(data_blob, capex_payload if isinstance(capex_payload, dict) else None)
            if capex_payload:
                capex_with_rate = {**capex_payload, 'tauxConversion': taux_conv} if isinstance(capex_payload, dict) else capex_payload
                capex = ResidentielCapexSchema.model_validate(capex_with_rate)
                # « Prix au Wc » / « CAPEX total » : saisies bornées (tranche selon la puissance du
                # projet, décidée ici) ; lignes du devis conservées mais hors totaux, donc non
                # contrôlées — comme ResidentielCapexTable.js::erreursValidation.
                puissance_kwc = _puissance_etude_kwc(projet)[1] if capex.capexMode == 'fixe' else None
                valider_capex_simple(capex, puissance_kwc, taux_conv)
                if capex.capexMode not in CAPEX_MODES_SIMPLES:
                    validate_capex_business_rules(
                        [p.model_dump() for p in capex.postes], capex.conversionType,
                        profil=profil, lignes_exclues=capex.lignesExclues or (),
                        inclure_main_oeuvre=capex.inclureMainOeuvre,
                        taux_conversion=taux_conv,
                    )
            # PRO / Grand projet : l'OPEX reste celui du formulaire standard (etude-economique/save).
            if opex_payload and profil == 'residentiel':
                opex_with_rate = {**opex_payload, 'tauxConversion': taux_conv} if isinstance(opex_payload, dict) else opex_payload
                ResidentielOpexSchema.model_validate(opex_with_rate)
        except ValueError as e:
            return jsonify({'success': False, 'message': str(e)}), 400
        except pydantic.ValidationError as e:
            first_error = e.errors()[0] if e.errors() else None
            field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
            message = first_error['msg'] if first_error else str(e)
            return jsonify({'success': False, 'message': f"Champ '{field}' invalide : {message}"}), 400
        except ResidentielRuleError as e:
            return jsonify({'success': False, 'message': f"Champ '{e.field}' invalide : {e.message}"}), 400

        # Récupérer ou initialiser la configuration du chiffrage résidentiel
        config = ResidentielChiffrageConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = ResidentielChiffrageConfig(projet_id=projet_id)
            db.session.add(config)

        # Mise à jour des attributs. Copie du chiffrage initial : refaite à chaque enregistrement
        # tant que le projet est en Chiffrage, conservée telle quelle ensuite (jamais reprise du client).
        ancien = config.data if isinstance(config.data, dict) else {}
        nouvelles = {k: v for k, v in data_blob.items() if k != CLE_CHIFFRAGE_INITIAL}
        if _est_chiffrage(projet):
            nouvelles[CLE_CHIFFRAGE_INITIAL] = _instantane_chiffrage(nouvelles)
        elif ancien.get(CLE_CHIFFRAGE_INITIAL):
            nouvelles[CLE_CHIFFRAGE_INITIAL] = ancien[CLE_CHIFFRAGE_INITIAL]
        config.data = nouvelles
        config.updated_at = utc_maintenant()
        db.session.commit()

        print(f"✅ [Flask Terminal] Données de chiffrage résidentiel sauvegardées en base pour le projet {projet_id}")
        return jsonify({
            'success': True,
            'message': 'Configuration du chiffrage résidentiel sauvegardée avec succès'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/residentiel-chiffrage/load', methods=['GET'])
@login_required
def load_residentiel_chiffrage_config(projet_id):
    """Charger la configuration du chiffrage résidentiel d'un projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        config = ResidentielChiffrageConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            return jsonify({'success': True, 'config_exists': False})

        # Copie du chiffrage initial retirée : lue seulement par la route chiffrage-initial.
        config_dict = config.to_dict()
        if isinstance(config_dict.get('data'), dict):
            config_dict['data'] = {k: v for k, v in config_dict['data'].items() if k != CLE_CHIFFRAGE_INITIAL}
        return jsonify({
            'success': True,
            'config_exists': True,
            'nom_projet': projet.nom_projet,
            'config': config_dict
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/residentiel-chiffrage/chiffrage-initial', methods=['GET'])
@login_required
def load_chiffrage_initial(projet_id):
    """Chiffrage figé pendant le type d'étude « Chiffrage » (bouton « Ouvrir le chiffrage initial »).
    Ne persiste rien : le navigateur l'applique au tableau puis l'enregistre par la route save."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    config = ResidentielChiffrageConfig.query.filter_by(projet_id=projet_id).first()
    data = config.data if config and isinstance(config.data, dict) else {}
    initial = data.get(CLE_CHIFFRAGE_INITIAL)
    # Projet encore en Chiffrage (copie pas encore prise) : le chiffrage enregistré fait foi.
    if not initial and _est_chiffrage(projet) and data.get('capex'):
        initial = _instantane_chiffrage(data)
    if not isinstance(initial, dict) or not initial.get('capex'):
        return jsonify({'success': True, 'disponible': False})
    return jsonify({
        'success': True,
        'disponible': True,
        'capex': initial.get('capex'),
        'opex': initial.get('opex'),
        'fige_le': initial.get('fige_le'),
    })


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/residentiel-chiffrage/verifier-totaux', methods=['POST'])
@login_required
def verifier_totaux_chiffrage(projet_id):
    """Vérification Python du devis AVANT son impression (pièce « Devis » du dossier de plans) :
    mêmes contrôles que l'enregistrement (forme + règles métier), puis totaux HT / TTC recalculés
    ici et comparés à ceux du navigateur — un écart > TOLERANCE_TOTAUX_EUR bloque la génération.
    Ne persiste rien."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

    req_data = request.get_json(silent=True) or {}
    capex_payload = req_data.get('capex')
    totaux = req_data.get('totaux') or {}
    if not isinstance(capex_payload, dict) or not isinstance(totaux, dict):
        return jsonify({'success': False, 'message': 'Devis absent ou mal formé.'}), 400
    try:
        taux_conv = extraire_taux_conversion(req_data, capex_payload)
        capex_with_rate = {**capex_payload, 'tauxConversion': taux_conv}
        capex = ResidentielCapexSchema.model_validate(capex_with_rate)
        if capex.capexMode in CAPEX_MODES_SIMPLES:
            libelle = 'Prix au Wc' if capex.capexMode == 'wc' else 'CAPEX total'
            return jsonify({'success': False, 'message': (
                f"Devis indisponible : le CAPEX est chiffré en « {libelle} ». Choisissez « Chiffrage "
                "détaillé » dans « Chiffrage CAPEX (Devis) » pour générer un devis.")}), 400
        validate_capex_business_rules(
            [p.model_dump() for p in capex.postes], capex.conversionType,
            profil=_profil_chiffrage(projet), lignes_exclues=capex.lignesExclues or (),
            inclure_main_oeuvre=capex.inclureMainOeuvre,
            taux_conversion=taux_conv,
        )
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'success': False, 'message': f"Devis invalide ({field or 'chiffrage'}) : {message}"}), 400
    except ResidentielRuleError as e:
        return jsonify({'success': False, 'message': f"Devis invalide ({e.field}) : {e.message}"}), 400

    total_ht, total_ttc = calculer_totaux_capex(capex_payload)
    try:
        ecart_ht = abs(float(totaux.get('totalHt')) - total_ht)
        ecart_ttc = abs(float(totaux.get('totalTtc')) - total_ttc)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Totaux du devis absents ou non numériques.'}), 400
    if ecart_ht > TOLERANCE_TOTAUX_EUR or ecart_ttc > TOLERANCE_TOTAUX_EUR:
        return jsonify({
            'success': False,
            'message': (f"Totaux du devis incohérents : saisis {float(totaux.get('totalHt')):.2f} HT / "
                        f"{float(totaux.get('totalTtc')):.2f} TTC, recalculés {total_ht:.2f} HT / {total_ttc:.2f} TTC."),
        }), 422
    return jsonify({'success': True, 'totalHt': round(total_ht, 2), 'totalTtc': round(total_ttc, 2)})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/irve/save', methods=['POST'])
@login_required
def save_irve_config(projet_id):
    """Sauvegarder les paramètres de configuration de la modale IRVE"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        req_data = request.get_json(silent=True) or {}
        if not req_data or 'data' not in req_data:
            return jsonify({'success': False, 'message': 'Aucune donnée fournie'}), 400

        data_blob = req_data.get('data')
        if not isinstance(data_blob, dict):
            return jsonify({'success': False, 'message': "Le champ 'data' doit être un objet."}), 400

        # CORRECTIF (validation stricte, légère) : `data` reste un instantané libre du formulaire
        # (tables, uiState, etc. non contraints), mais les quelques champs numériques connus de la
        # spec métier (Section 1), s'ils sont présents dans simpleInputs, doivent respecter leurs
        # bornes — sinon 400 explicite plutôt qu'une valeur corrompue silencieusement acceptée.
        simple_inputs = data_blob.get('simpleInputs') or {}
        known_fields = {
            k: v for k, v in simple_inputs.items()
            if k in IrveConfigDataSchema.model_fields and v not in (None, '')
        }
        if known_fields:
            IrveConfigDataSchema.model_validate(known_fields)

        # Récupérer ou initialiser la configuration de l'étude IRVE
        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = IrveConfig(projet_id=projet_id)
            db.session.add(config)

        # Mise à jour des attributs
        config.data = data_blob
        db.session.commit()

        print(f"✅ [Flask Terminal] Données de la modale IRVE sauvegardées en base pour le projet {projet_id}")
        return jsonify({
            'success': True,
            'message': 'Configuration IRVE sauvegardée avec succès'
        })
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'success': False, 'message': f"Champ '{field}' invalide : {message}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/irve/save-curve', methods=['POST'])
@login_required
def save_irve_curve(projet_id):
    """
    Sauvegarde la courbe de charge IRVE calculée (résolution native, cf. calculateEnergie() dans
    calcul_irve.js) — remplace la synchronisation par localStorage (stagedIrveData/sharedIrveData),
    peu fiable, utilisée par l'autoconsommation individuelle (cf. GET .../irve/load côté lecture).
    """
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        req_data = request.get_json(silent=True) or {}
        if not req_data:
            return jsonify({'success': False, 'message': 'Aucune donnée fournie'}), 400

        # CORRECTIF (validation stricte) : cette courbe alimente directement le moteur de calcul
        # d'autoconsommation (extract_consumption_from_json) — un payload corrompu ici se propagerait
        # silencieusement jusqu'au calcul. Validé avant écriture en base.
        curve = IrveCurveSchema.model_validate(req_data)
        courbe = curve.model_dump()
        # Contrôle de cohérence (365 jours, valeurs finies, somme = bilan énergétique IRVE) : une
        # courbe qui ne correspond pas au bilan affiché est refusée (cf. irve_controle.py).
        try:
            courbe['irve_kwh'] = verifier_courbe_a_enregistrer(courbe)
        except ValueError as e:
            return jsonify({'success': False, 'message': str(e)}), 400
        courbe['enregistre_le'] = horodatage_irve()

        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = IrveConfig(projet_id=projet_id, data={})
            db.session.add(config)

        # Nouvelle courbe : les résultats d'autoconsommation IRVE mémorisés (clé 'autoconso_irve')
        # disparaissent avec l'ancienne — ils ne correspondent plus au bilan.
        config.load_curve = courbe
        db.session.commit()

        return jsonify({'success': True, 'message': 'Courbe de charge IRVE sauvegardée avec succès'})
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'success': False, 'message': f"Champ '{field}' invalide : {message}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/irve/curve', methods=['DELETE'])
@login_required
def delete_irve_curve(projet_id):
    """
    Supprime la courbe de charge IRVE synchronisée du projet (demande explicite : supprimée depuis
    l'import de consommation — autoconsommation ou modal IRVE — ou quand il ne reste plus aucune
    borne, elle ne doit plus réapparaître au calcul). Les saisies du formulaire IRVE (`data`) sont
    conservées.
    """
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        if config and config.load_curve is not None:
            config.load_curve = None
            db.session.commit()
        return jsonify({'success': True, 'message': 'Courbe de charge IRVE supprimée'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# Module PAC / climatiseur : courbe de consommation simulée, transmise à l'autoconsommation PAR LA
# BASE comme la courbe IRVE (colonne irve_configs.courbe_pac, séparée de load_curve). Contrôle de
# cohérence : app/services/pac_controle.py.

def _ecrire_courbe_pac(projet_id, valeur):
    config = IrveConfig.query.filter_by(projet_id=projet_id).first()
    if not config:
        if valeur is None:
            return
        config = IrveConfig(projet_id=projet_id, data={})
        db.session.add(config)
    config.courbe_pac = valeur
    db.session.commit()


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/pac/save-curve', methods=['POST'])
@login_required
def save_pac_curve(projet_id):
    """Enregistre la courbe PAC calculée (et sa variante « ECS aux heures solaires »)."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        req_data = request.get_json(silent=True) or {}
        if not req_data:
            return jsonify({'success': False, 'message': 'Aucune donnée fournie'}), 400
        courbe = PacCurveSchema.model_validate(req_data).model_dump()
        try:
            courbe['pac_kwh'] = verifier_courbe_pac(courbe)
        except ValueError as e:
            return jsonify({'success': False, 'message': str(e)}), 400
        # Nouvelle courbe : le dernier résultat d'autoconsommation PAC ('autoconso_pac') ne
        # correspond plus et disparaît avec l'ancienne.
        courbe['enregistre_le'] = horodatage_irve()
        _ecrire_courbe_pac(projet_id, courbe)
        return jsonify({'success': True, 'message': "Courbe PAC transmise à l'autoconsommation.",
                        'enregistre_le': courbe['enregistre_le']})
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'success': False, 'message': f"Champ '{field}' invalide : {message}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/pac/curve', methods=['DELETE'])
@login_required
def delete_pac_curve(projet_id):
    """Supprime la courbe PAC transmise : elle ne sera plus proposée à l'autoconsommation."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        _ecrire_courbe_pac(projet_id, None)
        return jsonify({'success': True, 'message': 'Courbe PAC supprimée'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/pac/curve-info', methods=['GET'])
@login_required
def pac_curve_info(projet_id):
    """Description de la courbe PAC enregistrée, SANS les séries (légère) : pas, année, bilan,
    empreinte, résumé et dernier résultat d'autoconsommation PAC. ?series=1 ajoute la courbe."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        config = IrveConfig.query.filter_by(projet_id=projet_id).first()
        courbe = config.courbe_pac if config else None
        if not courbe or not courbe.get('pac'):
            return jsonify({'success': True, 'courbe': None})
        info = {k: courbe.get(k) for k in ('pas_temps_min', 'annee', 'bilan_pac_kwh', 'bilan_pac_ecs_solaire_kwh',
                                            'resume', 'enregistre_le', 'autoconso_pac')}
        info['variante_ecs_solaire'] = courbe.get('pac_ecs_solaire') is not None
        if request.args.get('series') == '1':
            info['pac'] = courbe['pac']
        return jsonify({'success': True, 'courbe': info})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/irve/rentabilite-donnees', methods=['GET'])
@login_required
def irve_rentabilite_donnees(projet_id):
    """
    Données de la section Rentabilité IRVE, lues en base (et non dans le stockage local du
    navigateur) : courbe IRVE du bilan énergétique (heure murale) et part PV consommée par les
    bornes mémorisée par le dernier calcul d'autoconsommation (UTC+1). Les deux sont recontrôlées
    contre le bilan avant d'être renvoyées (cf. irve_controle.py).
    """
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        config = IrveConfig.query.options(load_only(IrveConfig.load_curve)).filter_by(projet_id=projet_id).first()
        courbe = config.load_curve if config else None
        if not courbe or not courbe.get('irve'):
            return jsonify({'success': True, 'courbe': None, 'autoconso': None})

        pas = int(courbe.get('pas_temps_min') or 60)
        bilan = courbe.get('bilan_irve_kwh')
        calcule = irve_energie_kwh(courbe['irve'], pas)
        integre = bilan is not None and irve_ecart_admis(calcule, float(bilan))

        auto = courbe.get('autoconso_irve')
        if auto:
            auto = dict(auto)
            auto['conforme'] = bool(integre and irve_ecart_admis(float(auto.get('cons_irve_kwh') or 0), float(bilan)))
        return jsonify({
            'success': True,
            'courbe': {
                'pas_temps_min': pas,
                'annee': courbe.get('annee'),
                'irve': courbe['irve'],
                'bilan_irve_kwh': bilan,
                'irve_kwh': calcule,
                'integre': integre,
                'enregistre_le': courbe.get('enregistre_le'),
            },
            'autoconso': auto,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/irve/load', methods=['GET'])
@login_required
def load_irve_config(projet_id):
    """Charger la configuration d'étude IRVE d'un projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        # ?sans_courbe=1 : restauration du formulaire à l'ouverture de la modale, qui n'a pas besoin
        # de la courbe de charge (plusieurs Mo au pas de 5 min). courbe_pac n'est jamais renvoyée.
        sans_courbe = request.args.get('sans_courbe') == '1'
        colonnes_differees = [defer(IrveConfig.courbe_pac)]
        if sans_courbe:
            colonnes_differees.append(defer(IrveConfig.load_curve))
        config = IrveConfig.query.options(*colonnes_differees).filter_by(projet_id=projet_id).first()
        if not config:
            return jsonify({'success': True, 'config_exists': False})

        if sans_courbe:
            config_dict = {
                'id': config.id,
                'projet_id': config.projet_id,
                'data': config.data,
                'rentabilite': config.rentabilite
            }
        else:
            config_dict = config.to_dict()
        return jsonify({
            'success': True,
            'config_exists': True,
            'config': config_dict
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# Module Pompage solaire : saisies + dernier calcul, rattachés au PROJET (une ligne par projet) et
# accessibles au seul propriétaire du projet (ou à un administrateur). Remplace la clé localStorage
# globale `solarPumpData`, qui faisait réapparaître le pompage d'un projet dans tous les autres.

@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/pompage-solaire/load', methods=['GET'])
@login_required
def load_pompage_solaire(projet_id):
    """Charger les saisies et le dernier calcul du pompage solaire d'un projet."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        config = PompageSolaireConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            return jsonify({'success': True, 'config_exists': False})
        return jsonify({'success': True, 'config_exists': True, 'config': config.to_dict()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/pompage-solaire/save', methods=['POST'])
@login_required
def save_pompage_solaire(projet_id):
    """Enregistrer les saisies (brouillon) et, s'il est fourni, le dernier calcul du pompage solaire.

    Corps : {"saisies": {"champs": {...}, "integration_calepinage": bool}, "resultats": {...}|null}.
    `resultats` absent = conserver le dernier calcul enregistré ; null = l'effacer.
    """
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        if request.content_length and request.content_length > TAILLE_MAX_SAUVEGARDE_POMPAGE:
            return jsonify({'success': False, 'message': 'Requête trop volumineuse.'}), 413
        corps = request.get_json(silent=True)
        if not isinstance(corps, dict):
            return jsonify({'success': False, 'message': 'Corps JSON attendu.'}), 400
        donnees = PompageSolaireSauvegarde.model_validate(corps)

        config = PompageSolaireConfig.query.filter_by(projet_id=projet_id).first()
        if not config:
            config = PompageSolaireConfig(projet_id=projet_id)
            db.session.add(config)
        config.saisies = donnees.saisies.model_dump()
        if 'resultats' in corps:
            config.resultats = donnees.resultats
        config.updated_by = g.user.get('id')
        db.session.commit()
        return jsonify({'success': True, 'updated_at': config.updated_at.isoformat() if config.updated_at else None})
    except pydantic.ValidationError as e:
        first_error = e.errors()[0] if e.errors() else None
        field = '.'.join(str(p) for p in first_error['loc']) if first_error else '?'
        message = first_error['msg'] if first_error else str(e)
        return jsonify({'success': False, 'message': f"Champ '{field}' invalide : {message}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# NOUVEAU (demande explicite : "assurez-vous que l'import de CDC est bien intégré dans la base de
# données") : persistance serveur de la courbe de charge (CDC), jusqu'ici uniquement stockée côté
# navigateur (IndexedDB, clé globale fixe 'consFile' — cf. le bug de fuite entre projets corrigé dans
# parametreProjetFormManager.js::clearAllProjectLocalState()). Isolation stricte projet + compte
# utilisateur (demande explicite) : chaque route vérifie d'abord que le projet appartient bien à
# l'utilisateur courant (même motif que load_irve_config ci-dessus), et la CDC est toujours retrouvée
# par (parametre_projet_id) — jamais par un identifiant global partagé. Couvre aussi bien l'import
# manuel que la courbe Enedis/Switchgrid choisie par l'utilisateur pour l'étude (cf.
# persistence.js::saveConsFileToIDBAndDB(), source='import'|'enedis').

def _expected_length_for_time_step(time_step):
    """Miroir du freq_map de extract_consumption() (calcul_autoconso.py) — pas de temps en minutes."""
    return {10: 52560, 15: 35040, 30: 17520, 60: 8760}.get(time_step, 8760)


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc', methods=['POST'])
@login_required
@permission_required('concevoir_mon_projet')
def save_cdc(projet_id):
    """Sauvegarde (upsert) la CDC du projet en base, après validation du format/des données."""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        file = request.files.get('cons_file')
        if not file or not file.filename:
            return jsonify({'success': False, 'message': 'Aucun fichier reçu'}), 400

        source = request.form.get('source', 'import')
        if source not in ('import', 'enedis'):
            source = 'import'

        try:
            time_step = int(request.form.get('time_step', 60))
        except (TypeError, ValueError):
            time_step = 60

        expected_length = _expected_length_for_time_step(time_step)

        # Validation AVANT toute sauvegarde en base — réutilise la même logique déjà éprouvée au
        # moment du calcul (extract_consumption : colonnes, dates, longueur cohérente avec le pas de
        # temps déclaré). En cas d'échec, rien n'est persisté ; la copie IndexedDB déjà faite côté
        # client n'est pas affectée (le calcul via IndexedDB reste possible comme avant).
        try:
            file.stream.seek(0)
            valid_curves = extract_consumption(file, expected_length)
        except Exception as e:
            return jsonify({'success': False, 'message': f"Fichier de consommation invalide : {e}"}), 400

        if not valid_curves:
            return jsonify({
                'success': False,
                'message': "Fichier de consommation invalide : aucune donnée exploitable détectée."
            }), 400

        file.stream.seek(0)
        file_data = file.read()

        # Une seule CDC par projet (upsert par parametre_projet_id, jamais par un identifiant global).
        record = ConsommationFile.query.filter_by(parametre_projet_id=projet_id).first()
        if not record:
            record = ConsommationFile(parametre_projet_id=projet_id, created_by=current_user['id'])
            db.session.add(record)

        record.filename = file.filename
        record.content_type = file.content_type or 'application/octet-stream'
        record.file_data = file_data
        record.time_step = time_step
        record.source = source
        record.uploaded_at = utc_maintenant()

        db.session.commit()

        return jsonify({'success': True, 'id': record.id})
    except Exception:
        db.session.rollback()
        # Jamais l'exception brute au client (requête SQL + octets du fichier dans le message).
        current_app.logger.exception('save_cdc : échec de la sauvegarde de la CDC (projet %s)', projet_id)
        return jsonify({'success': False,
                        'message': "La courbe de charge n'a pas pu être enregistrée en base."}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc', methods=['GET'])
@login_required
def get_cdc(projet_id):
    """Restaure la CDC sauvegardée en base pour ce projet (ex. après vidage de l'IndexedDB locale)."""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        record = ConsommationFile.query.filter_by(parametre_projet_id=projet_id).first()
        if not record:
            return jsonify({'success': False, 'message': 'Aucune courbe de charge sauvegardée pour ce projet'}), 404

        return send_file(
            io.BytesIO(record.file_data),
            mimetype=record.content_type,
            as_attachment=True,
            download_name=record.filename
        )
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc', methods=['DELETE'])
@login_required
def delete_cdc(projet_id):
    """Supprime la CDC sauvegardée en base pour ce projet."""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        record = ConsommationFile.query.filter_by(parametre_projet_id=projet_id).first()
        if record:
            db.session.delete(record)
            db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


# ------------------------------------------------------------------------------------------------ #
# Courbes de charge des participants ACC (une par participant) — même isolation projet + compte que
# la CDC ACI ci-dessus. Point d'entrée frontend : prodsolaire/persistence.js (saveAccFileToDB,
# restoreAccFilesFromDBIfMissing, ...), appelé par main_acc.js à chaque import/renommage/suppression
# et par Irve/switchgrid_data.js quand une courbe Enedis est ajoutée à l'étude ACC.
# ------------------------------------------------------------------------------------------------ #

ACC_MAX_PARTICIPANTS = 30  # même plafond que l'UI (main_acc.js, maxFiles)
_ACC_NOM_INTERDIT = re.compile(r'[<>"\\/\x00-\x1f]')


def _nom_participant_acc_valide(nom, max_len=255):
    return bool(nom) and len(nom) <= max_len and not _ACC_NOM_INTERDIT.search(nom)


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc', methods=['GET'])
@login_required
def list_cdc_acc(projet_id):
    """Liste (métadonnées) des courbes de charge ACC sauvegardées pour ce projet."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    records = (ConsommationFileAcc.query.filter_by(parametre_projet_id=projet_id)
               .order_by(ConsommationFileAcc.id).all())
    return jsonify({'success': True, 'fichiers': [r.to_dict() for r in records]})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc/<int:fichier_id>', methods=['GET'])
@login_required
def get_cdc_acc(projet_id, fichier_id):
    """Contenu d'une courbe ACC (le fichier lui-même), restreint au projet de l'utilisateur."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    record = ConsommationFileAcc.query.filter_by(id=fichier_id, parametre_projet_id=projet_id).first()
    if not record:
        return jsonify({'success': False, 'message': 'Courbe introuvable pour ce projet'}), 404
    return send_file(io.BytesIO(record.file_data), mimetype=record.content_type,
                     as_attachment=True, download_name=record.original_name)


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc', methods=['POST'])
@login_required
@permission_required('concevoir_mon_projet')
def save_cdc_acc(projet_id):
    """
    Sauvegarde (upsert par original_name) la courbe d'UN participant ACC, après la même validation
    que la CDC ACI (extract_consumption). Champs multipart : cons_file, original_name (défaut : nom
    du fichier), custom_name, source ('import'|'enedis'), time_step, prm, annee.
    """
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        file = request.files.get('cons_file')
        if not file or not file.filename:
            return jsonify({'success': False, 'message': 'Aucun fichier reçu'}), 400

        original_name = (request.form.get('original_name') or file.filename).strip()
        custom_name = (request.form.get('custom_name') or '').strip() or None
        if not _nom_participant_acc_valide(original_name):
            return jsonify({'success': False, 'message': 'Nom de fichier invalide'}), 400
        if custom_name is not None and not _nom_participant_acc_valide(custom_name):
            return jsonify({'success': False, 'message': 'Nom de participant invalide'}), 400

        source = request.form.get('source', 'import')
        if source not in ('import', 'enedis'):
            source = 'import'
        prm = (request.form.get('prm') or '').strip() or None
        if prm is not None and (len(prm) != 14 or not prm.isdigit()):
            return jsonify({'success': False, 'message': 'PRM invalide (14 chiffres attendus)'}), 400
        annee = (request.form.get('annee') or '').strip() or None
        if annee is not None and not re.fullmatch(r'\d{4}|moyenne', annee):
            return jsonify({'success': False, 'message': 'Année de référence invalide'}), 400

        try:
            time_step = int(request.form.get('time_step', 60))
        except (TypeError, ValueError):
            time_step = 60
        if time_step not in (10, 15, 30, 60):
            return jsonify({'success': False, 'message': 'Pas de temps invalide (10, 15, 30 ou 60 min)'}), 400

        record = ConsommationFileAcc.query.filter_by(
            parametre_projet_id=projet_id, original_name=original_name).first()
        if not record:
            nb = ConsommationFileAcc.query.filter_by(parametre_projet_id=projet_id).count()
            if nb >= ACC_MAX_PARTICIPANTS:
                return jsonify({'success': False,
                                'message': f'Limite de {ACC_MAX_PARTICIPANTS} participants atteinte pour ce projet'}), 400

        try:
            file.stream.seek(0)
            valid_curves = extract_consumption(file, _expected_length_for_time_step(time_step))
        except Exception as e:
            return jsonify({'success': False, 'message': f"Fichier de consommation invalide : {e}"}), 400
        if not valid_curves:
            return jsonify({'success': False,
                            'message': "Fichier de consommation invalide : aucune donnée exploitable détectée."}), 400

        file.stream.seek(0)
        file_data = file.read()

        if not record:
            record = ConsommationFileAcc(parametre_projet_id=projet_id, created_by=g.user['id'],
                                         original_name=original_name)
            db.session.add(record)
        record.custom_name = custom_name
        record.content_type = file.content_type or 'application/octet-stream'
        record.file_data = file_data
        record.time_step = time_step
        record.source = source
        record.prm = prm
        record.annee = annee
        record.uploaded_at = utc_maintenant()
        db.session.commit()

        return jsonify({'success': True, 'fichier': record.to_dict()})
    except Exception:
        db.session.rollback()
        # Jamais l'exception brute au client (requête SQL + octets du fichier dans le message).
        current_app.logger.exception('save_cdc_acc : échec de la sauvegarde (projet %s)', projet_id)
        return jsonify({'success': False,
                        'message': "La courbe du participant n'a pas pu être enregistrée en base."}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc', methods=['PATCH'])
@login_required
@permission_required('concevoir_mon_projet')
def rename_cdc_acc(projet_id):
    """Renomme un participant (JSON : original_name, custom_name)."""
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    payload = request.get_json(silent=True) or {}
    original_name = (payload.get('original_name') or '').strip()
    custom_name = (payload.get('custom_name') or '').strip()
    if not _nom_participant_acc_valide(original_name) or not _nom_participant_acc_valide(custom_name):
        return jsonify({'success': False, 'message': 'Nom invalide'}), 400
    record = ConsommationFileAcc.query.filter_by(
        parametre_projet_id=projet_id, original_name=original_name).first()
    if not record:
        return jsonify({'success': False, 'message': 'Participant introuvable pour ce projet'}), 404
    record.custom_name = custom_name
    db.session.commit()
    return jsonify({'success': True, 'fichier': record.to_dict()})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc/localisation', methods=['PATCH'])
@login_required
@permission_required('concevoir_mon_projet')
def localiser_cdc_acc(projet_id):
    """
    Localise un participant ACC (carte des participants, page calepinage). JSON : original_name,
    adresse (texte, optionnel), latitude, longitude — latitude/longitude à null effacent la
    localisation.
    """
    projet = _get_project_with_permission(projet_id, g.user)
    if not projet:
        return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
    payload = request.get_json(silent=True) or {}
    original_name = (payload.get('original_name') or '').strip() if isinstance(payload.get('original_name'), str) else ''
    if not _nom_participant_acc_valide(original_name):
        return jsonify({'success': False, 'message': 'Nom invalide'}), 400
    record = ConsommationFileAcc.query.filter_by(
        parametre_projet_id=projet_id, original_name=original_name).first()
    if not record:
        return jsonify({'success': False, 'message': 'Participant introuvable pour ce projet'}), 404

    lat, lng = payload.get('latitude'), payload.get('longitude')
    if lat is None and lng is None:
        record.adresse = record.latitude = record.longitude = None
    else:
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'message': 'Coordonnées invalides'}), 400
        if isinstance(payload.get('latitude'), bool) or isinstance(payload.get('longitude'), bool)                 or not (math.isfinite(lat) and math.isfinite(lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return jsonify({'success': False, 'message': 'Coordonnées invalides'}), 400
        adresse = payload.get('adresse')
        if adresse is not None and (not isinstance(adresse, str) or len(adresse.strip()) > 500):
            return jsonify({'success': False, 'message': 'Adresse invalide (500 caractères au plus)'}), 400
        record.adresse = adresse.strip() or None if isinstance(adresse, str) else None
        record.latitude, record.longitude = lat, lng
    db.session.commit()
    return jsonify({'success': True, 'fichier': record.to_dict()})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/cdc-acc', methods=['DELETE'])
@login_required
def delete_cdc_acc(projet_id):
    """Supprime la courbe d'un participant (?original_name=...) ou toutes (?tout=1)."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404
        query = ConsommationFileAcc.query.filter_by(parametre_projet_id=projet_id)
        if request.args.get('tout') != '1':
            original_name = (request.args.get('original_name') or '').strip()
            if not original_name:
                return jsonify({'success': False, 'message': 'original_name requis'}), 400
            query = query.filter_by(original_name=original_name)
        nb = query.delete(synchronize_session=False)
        db.session.commit()
        return jsonify({'success': True, 'supprimes': nb})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


def _licence_scope_query(current_user, licence_pv, include_deleted=True):
    """Requête de base délimitant le périmètre du quota : l'entreprise si la licence est
    partagée, l'utilisateur sinon."""
    if licence_pv.get('scope') == 'company' and licence_pv.get('company_id'):
        query = ParametreProjet.query.filter_by(company_id=licence_pv['company_id'])
    else:
        query = ParametreProjet.query.filter_by(created_by=current_user['id'])
    if not include_deleted:
        query = query.filter(db.or_(ParametreProjet.is_deleted == False, ParametreProjet.is_deleted.is_(None)))
    return query


def _licence_company_id(licence_pv):
    """company_id à porter sur un projet créé sous une licence d'entreprise (None sinon).

    Doit être appliqué à TOUTE création de projet, y compris les copies : un projet sans
    company_id sort du périmètre de comptage de l'entreprise et échappe donc au quota.
    """
    return licence_pv.get('company_id') if licence_pv.get('scope') == 'company' else None


def _get_licence_pv(current_user):
    """Retourne (licence_pv, erreur).

    `erreur` est une réponse prête à renvoyer si la licence est introuvable en session.
    Refus par défaut (fail-closed) : une session sans `licence_pv` — session antérieure au
    déploiement, réponse SSO incomplète — donnait auparavant un accès sans aucune limite.
    Les administrateurs ne sont pas soumis aux quotas.
    """
    if current_user.get('is_admin'):
        return None, None

    licence_pv = session.get('licence_pv')
    if not licence_pv:
        return None, (jsonify({
            'success': False,
            'message': "Licence introuvable pour votre session. Merci de vous reconnecter "
                       "depuis Solakvan pour recharger vos droits."
        }), 403)

    return licence_pv, None


def _get_or_create_quota_counter(current_user, licence_pv):
    """Récupère ou initialise le compteur persistant de projets créés."""
    company_id = licence_pv.get('company_id') if licence_pv and licence_pv.get('scope') == 'company' else None
    user_id = str(current_user.get('id'))
    if company_id:
        counter = ProjectQuotaCounter.query.filter_by(company_id=company_id).first()
        if not counter:
            counter = ProjectQuotaCounter(user_id=user_id, company_id=company_id, total_projects_created=0)
            db.session.add(counter)
    else:
        counter = ProjectQuotaCounter.query.filter_by(user_id=user_id, company_id=None).first()
        if not counter:
            counter = ProjectQuotaCounter(user_id=user_id, company_id=None, total_projects_created=0)
            db.session.add(counter)
    return counter


def _count_consumed_projects(current_user, licence_pv):
    """Comptabilisation définitive des projets consommés :
    Un projet supprimé ne doit PAS libérer de place dans le quota. Tout projet créé,
    même s'il est supprimé par la suite, reste comptabilisé dans le nombre total de
    projets consommés par l'utilisateur pour éviter les abus (suppression/recréation)."""
    base_query = _licence_scope_query(current_user, licence_pv, include_deleted=True)
    db_count = base_query.count()
    counter = _get_or_create_quota_counter(current_user, licence_pv)
    counter_count = counter.total_projects_created if counter else 0
    return max(db_count, counter_count)


def _record_project_creation(current_user, licence_pv, is_relocation=False):
    """Incrémente ou synchronise de façon irréversible le quota de projets consommés.
    - Nouvelle création : synchronise le compteur avec le total BDD (actifs + supprimés).
    - Relocalisation > 300m : consomme un quota de projet supplémentaire (+1)."""
    counter = _get_or_create_quota_counter(current_user, licence_pv)
    base_query = _licence_scope_query(current_user, licence_pv, include_deleted=True)
    db_count = base_query.count()
    current_counter = counter.total_projects_created or 0

    if is_relocation:
        counter.total_projects_created = max(db_count, current_counter) + 1
    else:
        counter.total_projects_created = max(db_count, current_counter)

    db.session.add(counter)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def _licence_quota_error(current_user):
    """Vérifie le quota de licence (max_projects) avant la création d'un nouveau
    projet ou un déplacement de localisation > 300m."""
    licence_pv, erreur = _get_licence_pv(current_user)
    if erreur:
        return erreur
    if licence_pv is None:      # administrateur : illimité
        return None

    max_projects = licence_pv.get('max_projects')
    consumed_projects = _count_consumed_projects(current_user, licence_pv)
    if max_projects is not None and consumed_projects >= max_projects:
        return jsonify({
            'success': False,
            'message': f"Quota de projets atteint pour votre licence ({max_projects} projet(s) maximum). Tout projet créé, même supprimé, reste comptabilisé."
        }), 403

    return None


def _process_address_change(projet, new_adresse_data, current_user):
    """Règle des 300 mètres pour la modification de l'adresse du projet :
    - Déplacement <= 300m : modification autorisée sans impact quota.
    - Déplacement > 300m : considéré comme un nouveau projet, vérifie le quota restant
      et consomme un quota de projet supplémentaire.
    """
    from config import DISTANCE_SEUIL_PROJET

    if not new_adresse_data or not isinstance(new_adresse_data, dict):
        return None, None

    new_lat = new_adresse_data.get('latitude')
    new_lng = new_adresse_data.get('longitude')
    if new_lat is None or new_lng is None:
        return None, None

    old_lat, old_lng = None, None
    if projet.adresse_projet:
        try:
            old_addr = json.loads(projet.adresse_projet) if isinstance(projet.adresse_projet, str) else projet.adresse_projet
            if isinstance(old_addr, dict):
                old_lat = old_addr.get('latitude')
                old_lng = old_addr.get('longitude')
        except Exception:
            pass

    if old_lat is not None and old_lng is not None:
        try:
            distance = calculate_distance_meters(old_lat, old_lng, new_lat, new_lng)
        except Exception:
            distance = 0.0

        if distance > DISTANCE_SEUIL_PROJET:
            # Vérifier si l'utilisateur a un quota disponible pour un nouveau projet
            quota_err = _licence_quota_error(current_user)
            if quota_err:
                return (jsonify({
                    'success': False,
                    'message': f"Le déplacement du projet ({int(distance)} m) dépasse le seuil autorisé de {DISTANCE_SEUIL_PROJET} m et est considéré comme un nouveau projet. Votre quota de projets est atteint."
                }), 403), distance

            # Consommer un nouveau projet sur le quota via relocalisation.
            # _get_licence_pv renvoie None pour un administrateur : `or {}` comme à la création
            # (sinon _licence_scope_query plante sur None.get).
            licence_pv, _ = _get_licence_pv(current_user)
            _record_project_creation(current_user, licence_pv or {}, is_relocation=True)

        return None, distance

    return None, None


def _empreinte_maisons(maisons):
    """Empreinte canonique d'un calepinage maison {maison_id: donnees_completes} : clés triées,
    nombres arrondis au millionième (un recalcul à l'ouverture n'est pas une modification)."""
    def canonique(v):
        if isinstance(v, bool) or v is None or isinstance(v, str):
            return v
        if isinstance(v, (int, float)):
            return round(float(v), 6) if math.isfinite(v) else None
        if isinstance(v, dict):
            return {str(k): canonique(x) for k, x in v.items() if x is not None}
        if isinstance(v, (list, tuple)):
            return [canonique(x) for x in v]
        return str(v)
    return json.dumps(canonique(maisons or {}), sort_keys=True)


def _maj_puissance_projet(current_user, projet):
    """Recalcule puissance_totale_kwc depuis le calepinage en session (cf. puissance_projet.py) et
    vérifie le quota de licence. Renvoie la réponse d'erreur (session annulée) ou None."""
    db.session.flush()
    puissance = puissance_calepinage_kwc(projet)
    if puissance is not None:
        kwc_error = _licence_kwc_error(current_user, projet, puissance)
        if kwc_error:
            db.session.rollback()
            return kwc_error
    projet.puissance_totale_kwc = puissance
    return None


def _licence_kwc_error(current_user, projet, nouvelle_puissance):
    """Vérifie que la puissance enregistrée sur un projet respecte la limite max_kwc
    autorisée par projet individuel avec la marge de tolérance configurée (ex. +10%).

    Le contrôle s'applique par projet individuel : chaque projet ne doit pas dépasser
    le seuil maximal unitaire autorisé par la licence (kWc maximum + tolérance).
    """
    licence_pv, erreur = _get_licence_pv(current_user)
    if erreur:
        return erreur
    if licence_pv is None:      # administrateur : illimité
        return None

    max_kwc = licence_pv.get('max_kwc')
    if max_kwc is None:
        return None

    ratio = get_power_tolerance_ratio()
    seuil_max = round(float(max_kwc) * ratio, 2)
    valeur_puissance = float(nouvelle_puissance or 0.0)

    if valeur_puissance > seuil_max:
        try:
            pct = current_app.config.get('LICENCE_POWER_TOLERANCE_PERCENT', 10.0)
        except Exception:
            pct = 10.0
        return jsonify({
            'success': False,
            'message': (
                f"Quota de puissance dépassé : votre licence autorise {max_kwc} kWc maximum par projet "
                f"(soit {seuil_max:.2f} kWc avec la marge de tolérance de {pct}%), "
                f"mais ce projet atteint {valeur_puissance:.2f} kWc."
            )
        }), 403

    return None



@concevoir_mon_projet_bp.route('/api/internal/usage', methods=['GET'])
@concevoir_mon_projet_bp.route('/concevoir_mon_projet/api/internal/usage', methods=['GET'])
def get_licence_usage():
    """Endpoint interne (service-à-service) : renvoie la consommation actuelle du quota
    de licence (nombre de projets, somme des kWc) pour un utilisateur ou une entreprise.

    Appelé uniquement par Solakvan_V7 (voir socalts_routes.py côté Solakvan_V7) avec un
    token signé de courte durée dont le `sub` est préfixé ('user:<id>'/'company:<id>') —
    jamais exposé au navigateur, donc pas de @login_required ici.
    """
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({'success': False, 'message': 'Token manquant'}), 401

    payload = decode_scoped_token(auth_header.split(' ', 1)[1])
    if not payload or ':' not in payload.get('sub', ''):
        return jsonify({'success': False, 'message': 'Token invalide'}), 401

    scope, scoped_id = payload['sub'].split(':', 1)
    if scope not in ('user', 'company'):
        return jsonify({'success': False, 'message': 'Portée de token invalide'}), 400

    if scope == 'company':
        base_query = ParametreProjet.query.filter_by(company_id=scoped_id)
    else:
        base_query = ParametreProjet.query.filter_by(created_by=scoped_id)

    sum_kwc = base_query.with_entities(
        db.func.coalesce(db.func.sum(ParametreProjet.puissance_totale_kwc), 0)
    ).scalar() or 0

    max_single_kwc = base_query.with_entities(
        db.func.coalesce(db.func.max(ParametreProjet.puissance_totale_kwc), 0)
    ).scalar() or 0

    return jsonify({
        'success': True,
        'scope': scope,
        'count_projects': base_query.count(),
        'sum_kwc': float(sum_kwc),
        'max_single_kwc': float(max_single_kwc)
    })


@concevoir_mon_projet_bp.route('/parametre-projet/creer', methods=['POST'])
@login_required
@permission_required('concevoir_mon_projet')
def creer_parametre_projet():
    """Créer ou mettre à jour un paramètre de projet"""
    try:
        current_user = g.user
        data = request.form
        projet_id = data.get('projet_id')

        # Mise à jour ou création
        if projet_id:
            projet = _get_project_with_permission(projet_id, current_user)
            if not projet:
                abort(404)
        else:
            # ✅ Contrôle du quota de licence (max_projects / max_kwc)
            quota_error = _licence_quota_error(current_user)
            if quota_error:
                return quota_error

            licence_pv = session.get('licence_pv') or {}

            # ✅ VALIDATION ANTI-DUPLICATION
            # Vérifier si un projet avec le même nom a été créé dans les dernières 10 secondes
            nom_projet = data.get('nom_projet', '').strip()
            if nom_projet:
                from datetime import timedelta
                temps_limite = utc_maintenant() - timedelta(seconds=10)

                projet_recent = ParametreProjet.query.filter(
                    ParametreProjet.created_by == current_user['id'],
                    ParametreProjet.nom_projet == nom_projet,
                    ParametreProjet.created_at >= temps_limite
                ).first()

                if projet_recent:
                    # Un projet identique existe déjà, retourner ce projet au lieu d'en créer un nouveau
                    return jsonify({
                        'success': True,
                        'message': 'Ce projet existe déjà (double soumission détectée)',
                        'projet_id': projet_recent.id,
                        'redirect': f'/concevoir_mon_projet/projet/{projet_recent.id}',
                        'duplicate_detected': True
                    })

            projet = ParametreProjet(
                created_by=current_user['id'],
                created_by_email=current_user['email'],
                created_by_name=current_user.get('email', 'Utilisateur'),  # Initialiser avec l'email par défaut
                company_id=_licence_company_id(licence_pv)
            )

        # Informations générales
        projet.nom_projet = data.get('nom_projet', '').strip()
        projet.type_de_projet = data.get('type_de_projet')
        if projet_id:
            # CORRECTIF défensif (fiabilité de la typologie sur les projets existants) : cette route
            # sert aussi de mise à jour quand projet_id est fourni — contrairement à update_project()/
            # edit_shared_project(), elle écrasait typologie_projet inconditionnellement, y compris
            # avec None si le champ était absent du formulaire soumis, ce qui aurait fait basculer un
            # projet existant sur l'UI Pro/Grand par défaut. On aligne sur le même garde-fou : on ne
            # touche au champ que s'il est réellement fourni.
            if data.get('typologie_projet'):
                projet.typologie_projet = _normalize_typologie_projet(data.get('typologie_projet'))
        else:
            projet.typologie_projet = _normalize_typologie_projet(data.get('typologie_projet'))
        projet.mode_de_valorisation = data.get('mode_de_valorisation')
        projet.option_reseau = data.get('option_reseau')
        projet.type_projet = data.get('autre_type_projet_select') if data.get('type_projet_select') == 'Autres' else data.get('type_projet_select')
        # Le champ "Autre classification" n'est plus affiché : sans précision, on conserve "Autres".
        projet.type_ouvrage = (data.get('autre_type_ouvrage') or 'Autres') if data.get('type_ouvrage') == 'Autres' else data.get('type_ouvrage')
        projet.nature_des_traveaux = data.get('autre_nature_des_traveaux') if data.get('nature_des_traveaux') == 'Autres' else data.get('nature_des_traveaux')
        if 'charge_etudes' in data:
            projet.charge_etudes = _clean_charge_etudes(data.get('charge_etudes'))

        # Type d'étude (Chiffrage / Étude technico-économique / Étude de faisabilité détaillée),
        # choisi directement par l'utilisateur — indépendant de toute norme de calcul associée.
        # Normalisé : l'ancienne valeur « Pré-étude de faisabilité » peut venir d'un JS en cache.
        if data.get('type_etude'):
            projet.type_etude = normaliser_type_etude(data.get('type_etude'))

        # Date de livraison
        if data.get('date_livrable'):
            try:
                projet.date_livrable = datetime.strptime(
                    data.get('date_livrable'),
                    '%Y-%m-%d'
                ).date()
            except ValueError:
                pass

        # Le JS envoie le champ sous le nom 'adresse_projet' (anciennement 'parametre_project_hidden')
        adresse_raw = data.get('adresse_projet') or data.get('parametre_project_hidden')
        adresse_data = _normalize_adresse(adresse_raw)

        # ✅ Validation obligatoire de l'adresse (Exigence 3)
        if not adresse_data or not adresse_data.get('latitude') or not adresse_data.get('longitude'):
            return jsonify({
                'success': False,
                'message': "La localisation du projet (adresse ou coordonnées géographiques) est obligatoire."
            }), 400

        # ✅ Règle des 300 mètres en cas de mise à jour d'un projet existant
        if projet_id:
            addr_err, _ = _process_address_change(projet, adresse_data, current_user)
            if addr_err:
                return addr_err

        projet.adresse_projet = json.dumps(adresse_data)
        projet.pays = data.get('pays')

        # Zones climatiques (clés sans le préfixe 'input_' car le JS les envoie ainsi)
        # Si le pays n'est ni France ni Haïti, utiliser les champs de saisie libre
        pays = data.get('pays')
        if pays not in ['France', 'Haïti']:
            projet.zone_de_vent = data.get('autre_zone_vent')
            projet.categorie_de_terrain = data.get('autre_categorie_terrain')
            projet.zone_de_neige = data.get('autre_zone_neige')
            projet.zone_sismique = data.get('autre_zone_sismique')
        else:
            projet.zone_de_vent = data.get('zone_de_vent')
            projet.categorie_de_terrain = data.get('categorie_de_terrain')
            projet.zone_de_neige = data.get('zone_de_neige')
            projet.zone_sismique = data.get('zone_sismique')

        if data.get('niveau_keraunique'):
            projet.niveau_keraunique = float(data.get('niveau_keraunique'))

        # Environnement salin
        projet.environnement_salin = data.get('environnementSalin') == 'on'

        # Indices projet
        if data.get('indices_projet'):
            projet.indices_projet = data.get('indices_projet')

        # Règlements
        projet.reglement_urbanisme = data.get('reglement_urbanisme')
        projet.contraintes_specifiques = data.get('contraintes_specifiques')
        projet.hypotheses_de_conception = data.get('hypotheses_de_conception')

        # Norme de calcul (si sélectionnée)
        if data.get('norme_calcul_id'):
            projet.norme_calcul_id = int(data.get('norme_calcul_id'))

        db.session.add(projet)
        db.session.commit()

        # ✅ Enregistrer la consommation de quota pour un nouveau projet
        if not projet_id:
            _record_project_creation(current_user, licence_pv)

        # Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
        # un projet nouvellement créé (ou mis à jour) devient automatiquement le projet actif de la
        # session, sans appel frontend supplémentaire nécessaire.
        session['active_projet_id'] = projet.id

        # Pas de variante à la création : l'Indice A est créé à la première sauvegarde du rapport
        # (cf. save_project_revision).

        return jsonify({
            'success': True,
            'message': 'Paramètres du projet sauvegardés avec succès',
            'projet_id': projet.id,
            'redirect': f'/concevoir_mon_projet/projet/{projet.id}'
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Erreur lors de la sauvegarde: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>', methods=['GET'])
@login_required
def get_parametre_projet(projet_id):
    """Récupérer un paramètre de projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            abort(404)

        return jsonify({
            'success': True,
            'projet': projet.to_dict(include_norme=True)
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 404


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/activer', methods=['POST'])
@login_required
def activer_parametre_projet(projet_id):
    """
    Définit le projet donné comme projet actif de la session (cf.
    app/middleware/auth_middleware.py:active_project_required). Appelée côté frontend depuis
    CalepinageDataService.setCurrentProjet() à chaque sélection/ouverture d'un projet existant
    (double-clic dans "Mes projets", chargement de calepinage...) — la création passe déjà par
    creer_parametre_projet, qui définit la session directement.
    """
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            abort(404)

        session['active_projet_id'] = projet.id

        return jsonify({'success': True, 'projet_id': projet.id})

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 404


@concevoir_mon_projet_bp.route('/parametre-projet/desactiver', methods=['POST'])
@login_required
def desactiver_parametre_projet():
    """
    « Créer un nouveau projet » (bug 2026-11-04 : le formulaire restait en modification du projet
    actif) : la page est rechargée sans projet actif. La session est vidée AVANT le rechargement,
    sinon la page rendue reprendrait l'adresse et la typologie de l'ancien projet (cf. main.index).
    Le projet lui-même n'est pas touché.
    """
    session.pop('active_projet_id', None)
    return jsonify({'success': True})


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>', methods=['DELETE'])
@login_required
def supprimer_parametre_projet(projet_id):
    """Supprimer un paramètre de projet"""
    try:
        current_user = g.user
        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            abort(404)

        # Utiliser safe_delete_project qui gère déjà la suppression complète
        success, message = safe_delete_project(projet.id, current_user['id'], is_admin=current_user.get('is_admin'))

        if not success:
            return jsonify({
                'success': False,
                'message': message
            }), 500

        # Si le projet supprimé était le projet actif, retirer la garde d'accès (cf.
        # active_project_required) — sinon la session pointerait vers un projet qui n'existe plus.
        if session.get('active_projet_id') == projet_id:
            session.pop('active_projet_id', None)

        return jsonify({
            'success': True,
            'message': 'Projet supprimé avec succès'
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/statut', methods=['PATCH'])
@login_required
def modifier_statut_projet(projet_id):
    """Modifier le statut d'un projet"""
    try:
        current_user = g.user
        data = request.get_json(silent=True) or {}
        nouveau_statut = data.get('statut')

        if nouveau_statut not in ['En cours', 'Terminé', 'Archivé']:
            return jsonify({
                'success': False,
                'message': 'Statut invalide'
            }), 400

        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            abort(404)

        projet.statut_prestation = nouveau_statut
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Statut mis à jour',
            'statut': nouveau_statut
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

@concevoir_mon_projet_bp.route('/share-project', methods=['POST'])
@login_required
def create_share():
    """Créer un nouveau partage de projet"""
    try:
        current_user=g.user
        data = request.get_json(silent=True) or {}
        project_id = data.get('project_id')
        
        # Vérifier que le projet existe et appartient à l'utilisateur (ou admin)
        projet = ParametreProjet.query.get(project_id)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404
        
        if not current_user.get('is_admin') and projet.created_by != current_user['id']:
            return jsonify({'success': False, 'message': 'Non autorisé'}), 403
        
        # Créer le partage
        share = ProjectShare(
            project_id=project_id,
            shared_by=current_user['id'],
            shared_by_email=current_user['email'],
            shared_with_email=data.get('shared_with_email'),
            permission_type=data.get('permission_type', SharePermissionType.VIEW),
            share_token=ProjectShare.generate_token(),
            require_password=data.get('require_password', False),
            allow_download=data.get('allow_download', True),
            allow_copy=data.get('allow_copy', False),
            notify_on_access=data.get('notify_on_access', False),
            note=data.get('note')
        )
        
        # Gérer l'expiration
        if data.get('expires_at'):
            share.expires_at = datetime.fromisoformat(data['expires_at'])
        
        # Gérer le mot de passe
        if share.require_password and data.get('password'):
            share.password_hash = ProjectShare.hash_password(data['password'])
        
        # Gérer la limite de vues
        if data.get('max_views'):
            share.max_views = int(data['max_views'])
        
        db.session.add(share)
        db.session.commit()
        
        # Envoyer un email si destinataire spécifié
        if share.shared_with_email:
            share_url = url_for('concevoir_mon_projet.access_shared_project',
                               token=share.share_token, _external=True)
            send_share_notification_email(share, projet, share_url)
        
        # Logger l'activité
        activity = ShareActivity(
            share_id=share.id,
            activity_type='created',
            user_id=current_user['id'],
            user_email=current_user['email'],
            ip_address=request.remote_addr
        )
        db.session.add(activity)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Partage créé avec succès',
            'share': share.to_dict(include_token=True),
            'share_url': url_for('concevoir_mon_projet.access_shared_project', 
                                 token=share.share_token, _external=True)
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"Erreur création partage: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500
    
@concevoir_mon_projet_bp.route('/shared/<token>', methods=['GET', 'POST'])
def access_shared_project(token):
    """Accéder à un projet via un lien de partage"""
    share = ProjectShare.query.filter_by(share_token=token).first()
    
    if not share:
        flash('Lien de partage invalide', 'error')
        return redirect(url_for('index'))
    
    if not share.is_valid():
        flash('Ce lien de partage a expiré ou n\'est plus valide', 'error')
        return redirect(url_for('index'))
    
    # Vérifier le mot de passe si requis
    if share.require_password:
        if request.method == 'POST':
            password = request.form.get('password')
            if not share.verify_password(password):
                flash('Mot de passe incorrect', 'error')
                return render_template('sharing/share_password.html', share=share)
        else:
            return render_template('sharing/share_password.html', share=share)
    
    # Incrémenter le compteur de vues
    share.increment_view(request.remote_addr)
    
    # Logger l'accès
    current_user = g.user if hasattr(g, 'user') else None
    activity = ShareActivity(
        share_id=share.id,
        activity_type='viewed',
        user_id=current_user['id'] if current_user else None,
        user_email=current_user['email'] if current_user else None,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent')
    )
    db.session.add(activity)
    db.session.commit()

    # Notifier le propriétaire si activé
    if share.notify_on_access:
        send_access_notification_email(share)
    
    # Charger le projet
    projet = share.project

    # Créer une session invité si l'utilisateur peut modifier
    from utils.share_token_auth import create_guest_session_from_share
    if share.can_edit() or share.can_admin():
        guest_user = create_guest_session_from_share(share)
        g.user = guest_user

    return render_template('sharing/shared_project.html',
                         projet=projet,
                         share=share,
                         can_edit=share.can_edit(),
                         can_admin=share.can_admin(),
                         share_token=token)
    
@concevoir_mon_projet_bp.route('/parametre-projet/<int:project_id>/copy', methods=['POST'])
@login_required
def copy_project(project_id):
    """Créer une copie d'un projet existant"""
    try:
        current_user=g.user
        data = request.get_json(silent=True) or {}

        # Charger le projet original
        original_projet = ParametreProjet.query.get(project_id)
        if not original_projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404
        
        # Vérifier les permissions
        if not current_user.get('is_admin') and original_projet.created_by != current_user['id']:
            # Vérifier si l'utilisateur a un partage avec permission de copie
            share = ProjectShare.query.filter_by(
                project_id=project_id,
                shared_with_email=current_user['email'],
                is_active=True
            ).first()
            
            if not share or not share.allow_copy:
                return jsonify({'success': False, 'message': 'Non autorisé'}), 403
        
        # Une copie est une création : elle est soumise au quota de licence au même
        # titre que /parametre-projet/creer, sinon le quota se contourne en copiant.
        quota_error = _licence_quota_error(current_user)
        if quota_error:
            return quota_error

        # Vérifier que le projet d'origine respecte la puissance maximale unitaire autorisée
        if original_projet.puissance_totale_kwc:
            kwc_error = _licence_kwc_error(current_user, original_projet, original_projet.puissance_totale_kwc)
            if kwc_error:
                return kwc_error

        licence_pv = session.get('licence_pv') or {}

        # Créer le nouveau projet
        new_projet = ParametreProjet(
            nom_projet=data.get('new_name', f"Copie de {original_projet.nom_projet}"),
            type_de_projet=original_projet.type_de_projet,
            # CORRECTIF (bug "l'UI Pro/Grand projet s'affiche pour un projet Résidentielle copié") :
            # typologie_projet n'était jamais reporté sur la copie (colonne nullable, sans défaut),
            # donc toute copie d'un projet Résidentielle repartait avec typologie_projet=NULL —
            # _compute_active_projet_typologie() (main.py) retombe alors sur '' pour ce projet à
            # chaque ouverture/rechargement, ce qui fait échouer tous les gates JS
            # `=== 'Résidentielle'` et affiche l'UI Pro/Grand par défaut.
            typologie_projet=original_projet.typologie_projet,
            mode_de_valorisation=original_projet.mode_de_valorisation,
            type_projet=original_projet.type_projet,
            type_ouvrage=original_projet.type_ouvrage,
            autre_type_ouvrage=original_projet.autre_type_ouvrage,
            charge_etudes=original_projet.charge_etudes,
            nature_des_traveaux=original_projet.nature_des_traveaux,
            date_livrable=original_projet.date_livrable,
            adresse_projet=original_projet.adresse_projet,
            pays=original_projet.pays,
            zone_de_vent=original_projet.zone_de_vent,
            categorie_de_terrain=original_projet.categorie_de_terrain,
            zone_de_neige=original_projet.zone_de_neige,
            zone_sismique=original_projet.zone_sismique,
            niveau_keraunique=original_projet.niveau_keraunique,
            environnement_salin=original_projet.environnement_salin,
            created_by=current_user['id'],
            created_by_email=current_user['email'],
            created_by_name=current_user.get('email', 'Utilisateur'),  # Initialiser avec l'email par défaut
            company_id=_licence_company_id(licence_pv)
        )
        
        if data.get('copy_norme', True) and original_projet.norme_calcul_id:
            new_projet.norme_calcul_id = original_projet.norme_calcul_id
        
        # Copier les paramètres techniques si demandé
        if data.get('copy_parameters', True):
            pass
        
        db.session.add(new_projet)
        db.session.commit()

        # ✅ Enregistrer la consommation de quota pour la copie
        _record_project_creation(current_user, licence_pv)
        
        return jsonify({
            'success': True,
            'message': 'Projet copié avec succès',
            'projet_id': new_projet.id,
            'redirect': url_for('concevoir_mon_projet.liste_parametres_projets', project_id=new_projet.id)
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"Erreur copie projet: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:project_id>/update', methods=['POST'])
@login_required
def update_project(project_id):
    """Mettre à jour un projet existant"""
    try:
        current_user = g.user
        projet = ParametreProjet.query.get(project_id)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable'}), 404
        
        # Vérifier les permissions
        if not current_user.get('is_admin') and projet.created_by != current_user['id']:
            share = ProjectShare.query.filter_by(
                project_id=project_id,
                shared_with_email=current_user['email'],
                is_active=True
            ).first()
            
            if not share or not share.can_edit():
                return jsonify({'success': False, 'message': 'Non autorisé'}), 403
        
        # Les données sont en FormData
        data = request.form
        
        print(f"Données reçues: {dict(data)}")  # Convertir en dict pour mieux voir
        
        # Mettre à jour les champs de base
        if 'nom_projet' in data:
            projet.nom_projet = data['nom_projet']
        
        if 'type_de_projet' in data:
            projet.type_de_projet = data['type_de_projet']

        if 'typologie_projet' in data:
            projet.typologie_projet = _normalize_typologie_projet(data['typologie_projet'])

        # Libellé "projet + adresse" de la page de garde du rapport résidentiel (≤10 mots) —
        # jamais faire confiance uniquement au bornage client (cf. ClampUtils.js côté JS).
        if 'rapport_cover_label' in data:
            projet.rapport_cover_label = _clamp_word_count(data['rapport_cover_label'], 10, 150)

        if 'charge_etudes' in data:
            projet.charge_etudes = _clean_charge_etudes(data['charge_etudes'])

        # Planning de réalisation (rapport PDF résidentiel) — demande explicite : "valider les
        # saisies... valeur limite entre 1-365 jours, rejeter toute autre valeur, caractères
        # spéciaux". _clamp_number renvoie le fallback (jamais une exception) si la valeur n'est
        # pas un nombre valide (texte, caractères spéciaux, vide) — jamais de valeur aberrante
        # stockée, jamais de plantage, quel que soit ce qu'envoie le client.
        if 'planning_j_visite_technique' in data:
            projet.planning_j_visite_technique = int(_clamp_number(data['planning_j_visite_technique'], 1, 365, 2))
        if 'planning_j_demarches' in data:
            projet.planning_j_demarches = int(_clamp_number(data['planning_j_demarches'], 1, 365, 15))
        if 'planning_j_installation' in data:
            projet.planning_j_installation = int(_clamp_number(data['planning_j_installation'], 1, 365, 3))
        if 'planning_j_mise_en_service' in data:
            projet.planning_j_mise_en_service = int(_clamp_number(data['planning_j_mise_en_service'], 1, 365, 5))

        if 'mode_de_valorisation' in data:
            projet.mode_de_valorisation = data['mode_de_valorisation']

        if 'option_reseau' in data:
            projet.option_reseau = data['option_reseau']

        if 'type_projet' in data:
            projet.type_projet = data['type_projet']

        if 'type_ouvrage' in data:
            projet.type_ouvrage = data['type_ouvrage']

        if 'autre_type_ouvrage' in data:
            projet.autre_type_ouvrage = data['autre_type_ouvrage']

        if 'nature_des_traveaux' in data:
            projet.nature_des_traveaux = data['nature_des_traveaux']

        if 'autre_nature_des_traveaux' in data:
            projet.autre_nature_des_traveaux = data['autre_nature_des_traveaux']

        # Type d'étude (Chiffrage / Étude technico-économique / Étude de faisabilité détaillée)
        if 'type_etude' in data and data['type_etude']:
            nouveau_type = normaliser_type_etude(data['type_etude'])
            if _est_chiffrage(projet) and str(nouveau_type or '').strip().lower() != 'chiffrage':
                _figer_chiffrage_initial_si_absent(projet)
            projet.type_etude = nouveau_type

        # Date de livraison
        if 'date_livrable' in data and data['date_livrable']:
            try:
                projet.date_livrable = datetime.strptime(data['date_livrable'], '%Y-%m-%d').date()
            except ValueError as e:
                print(f"Erreur conversion date: {e}")
        
        # Adresse - normaliser depuis n'importe quel format
        if 'adresse_projet' in data and data['adresse_projet']:
            adresse_data = _normalize_adresse(data['adresse_projet'])
            if adresse_data:
                # ✅ Règle des 300 mètres
                addr_err, _ = _process_address_change(projet, adresse_data, current_user)
                if addr_err:
                    return addr_err
                projet.adresse_projet = json.dumps(adresse_data)
        
        # Champs texte simples
        if 'pays' in data:
            projet.pays = data['pays']

        # Zones climatiques avec logique conditionnelle
        pays = data.get('pays', projet.pays)
        if pays not in ['France', 'Haïti']:
            # Pour les autres pays, utiliser les champs de saisie libre
            if 'autre_zone_vent' in data:
                projet.zone_de_vent = data['autre_zone_vent']
            if 'autre_categorie_terrain' in data:
                projet.categorie_de_terrain = data['autre_categorie_terrain']
            if 'autre_zone_neige' in data:
                projet.zone_de_neige = data['autre_zone_neige']
            if 'autre_zone_sismique' in data:
                projet.zone_sismique = data['autre_zone_sismique']
        else:
            # Pour France et Haïti, utiliser les champs standards
            if 'zone_de_vent' in data:
                projet.zone_de_vent = data['zone_de_vent']
            if 'categorie_de_terrain' in data:
                projet.categorie_de_terrain = data['categorie_de_terrain']
            if 'zone_de_neige' in data:
                projet.zone_de_neige = data['zone_de_neige']
            if 'zone_sismique' in data:
                projet.zone_sismique = data['zone_sismique']
        
        # Niveau kéraunique
        if 'niveau_keraunique' in data and data['niveau_keraunique']:
            try:
                projet.niveau_keraunique = float(data['niveau_keraunique'])
            except (ValueError, TypeError) as e:
                print(f"Erreur conversion niveau_keraunique: {e}")
        
        # Environnement salin
        if 'environnement_salin' in data:
            env_value = data['environnement_salin']
            if isinstance(env_value, str):
                projet.environnement_salin = env_value.lower() in ['true', '1', 'on', 'yes', 'oui']
            else:
                projet.environnement_salin = bool(env_value)
        
        # Norme de calcul
        if 'norme_calcul_id' in data and data['norme_calcul_id']:
            try:
                projet.norme_calcul_id = int(data['norme_calcul_id'])
            except (ValueError, TypeError) as e:
                print(f"Erreur conversion norme_calcul_id: {e}")
        
        projet.updated_at = utc_maintenant()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Projet mis à jour avec succès',
            'projet': projet.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"Erreur mise à jour projet: {str(e)}")
        import traceback
        print(f"Traceback complet: {traceback.format_exc()}")
        return jsonify({'success': False, 'message': f'Erreur serveur: {str(e)}'}), 500
    
@concevoir_mon_projet_bp.route('/personnalisation-rapport', methods=['GET'])
@login_required
def get_personnalisation_rapport():
    """Récupère le profil de personnalisation du rapport (logo, coordonnées, textes, stats) de
    l'utilisateur connecté — un seul profil par utilisateur, réutilisé sur tous ses projets
    Résidentielle (cf. PdfResidentialReportGenerator.js)."""
    profil = PersonnalisationRapport.query.filter_by(user_id=g.user['id']).first()
    return jsonify({'success': True, 'data': profil.to_dict() if profil else None})


@concevoir_mon_projet_bp.route('/personnalisation-rapport', methods=['POST'])
@login_required
def save_personnalisation_rapport():
    """Crée ou met à jour le profil de personnalisation du rapport de l'utilisateur connecté
    (upsert par user_id). Borne systématiquement les valeurs côté serveur, même si le client les
    borne déjà (cf. ClampUtils.js) — évite tout plantage/valeur aberrante en base."""
    try:
        data = request.get_json(silent=True) or {}
        profil = PersonnalisationRapport.query.filter_by(user_id=g.user['id']).first()
        if not profil:
            profil = PersonnalisationRapport(user_id=g.user['id'])
            db.session.add(profil)

        if 'logo_base64' in data:
            # CORRECTIF (demande explicite : "valider tous les champs avant l'envoi dans la BD...
            # pour ne pas faire planter l'application") : seul champ de cette route jusqu'ici sans
            # aucune validation — un data URI arbitraire (mauvais type MIME, non-image, taille
            # démesurée) pouvait être stocké tel quel. Accepté uniquement s'il ressemble à un vrai
            # data URI image, plafonné à ~2 Mo encodé (large pour un logo) ; sinon ignoré
            # silencieusement (comme une valeur vide) plutôt que de faire échouer toute la requête.
            logo_val = data['logo_base64']
            if not logo_val:
                profil.logo_base64 = None
            elif (isinstance(logo_val, str) and len(logo_val) <= 2_000_000
                    and re.match(r'^data:image/(png|jpe?g|gif|webp);base64,', logo_val)):
                profil.logo_base64 = logo_val
        if 'nom_entreprise' in data:
            profil.nom_entreprise = str(data['nom_entreprise'] or '')[:200]
        if 'telephone' in data:
            profil.telephone = str(data['telephone'] or '')[:50]
        if 'adresse' in data:
            profil.adresse = str(data['adresse'] or '')[:300]
        if 'email' in data:
            profil.email = str(data['email'] or '')[:200]
        if 'site_web' in data:
            profil.site_web = str(data['site_web'] or '')[:300]
        if 'charge_affaires' in data:
            profil.charge_affaires = str(data['charge_affaires'] or '').strip()[:100]
        if 'mission_text' in data:
            profil.mission_text = _clamp_word_count(data['mission_text'], 30, 400)
        if 'services_text' in data:
            profil.services_text = _clamp_word_count(data['services_text'], 30, 400)
        if 'stat_installations' in data:
            profil.stat_installations = _clamp_number(data['stat_installations'], 0, 2000, 0)
        if 'stat_annees_experience' in data:
            profil.stat_annees_experience = _clamp_number(data['stat_annees_experience'], 1, 50, 1)
        if 'stat_clients_satisfaits_pct' in data:
            profil.stat_clients_satisfaits_pct = _clamp_number(data['stat_clients_satisfaits_pct'], 50, 100, 50)

        profil.updated_at = utc_maintenant()
        db.session.commit()

        return jsonify({'success': True, 'data': profil.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Erreur serveur: {str(e)}'}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:project_id>/shares', methods=['GET'])
@login_required
def list_project_shares(project_id):
    """Lister tous les partages d'un projet"""
    try:
        current_user = g.user
        projet = ParametreProjet.query.get(project_id)
        if not projet or (not current_user.get('is_admin') and projet.created_by != current_user['id']):
            return jsonify({'success': False, 'message': 'Non autorisé'}), 403

        shares = ProjectShare.query.filter_by(project_id=project_id).all()

        return jsonify({
            'success': True,
            'shares': [share.to_dict(include_token=True) for share in shares]
        })

    except Exception as e:
        print(f"Erreur liste partages: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500
    
@concevoir_mon_projet_bp.route('/share/<int:share_id>/revoke', methods=['POST'])
@login_required
def revoke_share(share_id):
    """Révoquer un partage existant"""
    try:
        current_user = g.user
        share = ProjectShare.query.get(share_id)
        if not share:
            return jsonify({'success': False, 'message': 'Partage introuvable'}), 404

        # Vérifier que l'utilisateur est le propriétaire du partage
        if share.shared_by != current_user['id']:
            return jsonify({'success': False, 'message': 'Non autorisé'}), 403

        share.is_active = False

        # Logger l'activité
        activity = ShareActivity(
            share_id=share.id,
            activity_type='revoked',
            user_id=current_user['id'],
            user_email=current_user['email'],
            ip_address=request.remote_addr
        )
        db.session.add(activity)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Partage révoqué avec succès'
        })

    except Exception as e:
        db.session.rollback()
        print(f"Erreur révocation partage: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


# Note: Les fonctions d'envoi d'email sont maintenant dans utils/email_service.py
# send_share_notification_email et send_access_notification_email


# ==========================================
# ROUTES POUR ÉDITION DE PROJETS PARTAGÉS (SANS COMPTE)
# ==========================================

@concevoir_mon_projet_bp.route('/shared/<token>/edit', methods=['GET', 'POST'])
@share_token_required('edit')
def edit_shared_project(token, share=None, guest_user=None):
    """
    Afficher et traiter le formulaire d'édition pour un projet partagé
    Accessible aux invités avec token de partage (permission edit ou admin)
    """
    try:
        projet = share.project

        if request.method == 'GET':
            # Afficher le formulaire pré-rempli
            # Charger les normes publiques pour le formulaire
            normes = NormeCalcul.query.filter_by(is_public=True).all()

            return render_template('sharing/shared_project_edit.html',
                                 projet=projet,
                                 share=share,
                                 guest_user=guest_user,
                                 share_token=token,
                                 normes=normes,
                                 can_admin=share.can_admin())

        # POST - Sauvegarder les modifications
        elif request.method == 'POST':
            data = request.form

            # Mettre à jour les champs (même logique que update_project)
            if 'nom_projet' in data:
                projet.nom_projet = data['nom_projet']

            if 'type_de_projet' in data:
                projet.type_de_projet = data['type_de_projet']

            if 'typologie_projet' in data:
                projet.typologie_projet = _normalize_typologie_projet(data['typologie_projet'])

            if 'mode_de_valorisation' in data:
                projet.mode_de_valorisation = data['mode_de_valorisation']

            if 'option_reseau' in data:
                projet.option_reseau = data['option_reseau']

            if 'type_projet' in data:
                projet.type_projet = data['type_projet']

            if 'type_ouvrage' in data:
                projet.type_ouvrage = data['type_ouvrage']

            if 'autre_type_ouvrage' in data:
                projet.autre_type_ouvrage = data['autre_type_ouvrage']

            if 'charge_etudes' in data:
                projet.charge_etudes = _clean_charge_etudes(data['charge_etudes'])

            if 'nature_des_traveaux' in data:
                projet.nature_des_traveaux = data['nature_des_traveaux']

            if 'autre_nature_des_traveaux' in data:
                projet.autre_nature_des_traveaux = data['autre_nature_des_traveaux']

            # Date de livraison
            if 'date_livrable' in data and data['date_livrable']:
                try:
                    projet.date_livrable = datetime.strptime(data['date_livrable'], '%Y-%m-%d').date()
                except ValueError as e:
                    print(f"Erreur conversion date: {e}")

            # Adresse - gérer le double JSON
            if 'adresse_projet' in data and data['adresse_projet']:
                adresse_value = data['adresse_projet']
                try:
                    first_parse = json.loads(adresse_value)
                    if isinstance(first_parse, str):
                        final_adresse = json.loads(first_parse)
                        projet.adresse_projet = json.dumps(final_adresse)
                    else:
                        projet.adresse_projet = json.dumps(first_parse)
                except (json.JSONDecodeError, TypeError) as e:
                    print(f"Erreur parsing adresse: {e}")
                    projet.adresse_projet = adresse_value

            # Champs climatiques
            if 'pays' in data:
                projet.pays = data['pays']

            # Zones climatiques avec logique conditionnelle
            pays = data.get('pays', projet.pays)
            if pays not in ['France', 'Haïti']:
                # Pour les autres pays, utiliser les champs de saisie libre
                if 'autre_zone_vent' in data:
                    projet.zone_de_vent = data['autre_zone_vent']
                if 'autre_categorie_terrain' in data:
                    projet.categorie_de_terrain = data['autre_categorie_terrain']
                if 'autre_zone_neige' in data:
                    projet.zone_de_neige = data['autre_zone_neige']
                if 'autre_zone_sismique' in data:
                    projet.zone_sismique = data['autre_zone_sismique']
            else:
                # Pour France et Haïti, utiliser les champs standards
                if 'zone_de_vent' in data:
                    projet.zone_de_vent = data['zone_de_vent']
                if 'categorie_de_terrain' in data:
                    projet.categorie_de_terrain = data['categorie_de_terrain']
                if 'zone_de_neige' in data:
                    projet.zone_de_neige = data['zone_de_neige']
                if 'zone_sismique' in data:
                    projet.zone_sismique = data['zone_sismique']

            # Niveau kéraunique
            if 'niveau_keraunique' in data and data['niveau_keraunique']:
                try:
                    projet.niveau_keraunique = float(data['niveau_keraunique'])
                except (ValueError, TypeError) as e:
                    print(f"Erreur conversion niveau_keraunique: {e}")

            # Environnement salin
            if 'environnement_salin' in data:
                env_value = data['environnement_salin']
                if isinstance(env_value, str):
                    projet.environnement_salin = env_value.lower() in ['true', '1', 'on', 'yes', 'oui']
                else:
                    projet.environnement_salin = bool(env_value)

            # Norme de calcul
            if 'norme_calcul_id' in data and data['norme_calcul_id']:
                try:
                    projet.norme_calcul_id = int(data['norme_calcul_id'])
                except (ValueError, TypeError) as e:
                    print(f"Erreur conversion norme_calcul_id: {e}")

            projet.updated_at = utc_maintenant()

            db.session.commit()

            # Logger l'activité
            activity = ShareActivity(
                share_id=share.id,
                activity_type='modified',
                user_id=guest_user['id'],
                user_email=guest_user['email'],
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent'),
                details=json.dumps({'action': 'project_updated'})
            )
            db.session.add(activity)
            db.session.commit()

            # Envoyer une notification email au propriétaire
            try:
                send_modification_notification_email(share, projet, guest_user['email'])
            except Exception as e:
                print(f"Erreur envoi email notification: {str(e)}")
                # Ne pas bloquer la modification si l'email échoue

            # Rediriger vers la page de succès
            return render_template('base/action_success.html',
                success_title='Projet modifié avec succès',
                success_icon='fa-edit',
                success_message='Vos modifications ont été enregistrées et le propriétaire du projet a été notifié.',
                details=[
                    {'label': 'Projet', 'value': projet.nom_projet},
                    {'label': 'Modifié par', 'value': guest_user['email']},
                    {'label': 'Date', 'value': utc_maintenant().strftime('%d/%m/%Y à %H:%M')}
                ],
                info_message='Les modifications seront visibles immédiatement pour tous les utilisateurs ayant accès à ce projet.',
                actions=[
                    {'text': 'Voir le projet', 'url': url_for('concevoir_mon_projet.access_shared_project', token=token), 'class': 'btn-success', 'icon': 'fa-eye'},
                    {'text': 'Continuer à modifier', 'url': url_for('concevoir_mon_projet.edit_shared_project', token=token), 'class': 'btn-outline', 'icon': 'fa-edit'}
                ]
            )

    except Exception as e:
        db.session.rollback()
        print(f"Erreur modification projet partagé: {str(e)}")
        import traceback
        traceback.print_exc()
        flash(f'Erreur lors de la modification: {str(e)}', 'error')
        return redirect(url_for('concevoir_mon_projet.access_shared_project', token=token))


@concevoir_mon_projet_bp.route('/shared/<token>/update-api', methods=['POST'])
@share_token_required('edit')
def update_shared_project_api(token, share=None, guest_user=None):
    """
    API pour mettre à jour un projet partagé (pour AJAX depuis le frontend)
    """
    try:
        projet = share.project
        data = request.get_json(silent=True) or {}

        # Mettre à jour les champs fournis
        for field in ['nom_projet', 'type_de_projet', 'mode_de_valorisation', 'option_reseau', 'type_projet',
                     'type_ouvrage', 'autre_type_ouvrage', 'nature_des_traveaux',
                     'pays', 'zone_de_vent', 'categorie_de_terrain', 'zone_de_neige',
                     'zone_sismique', 'environnement_salin']:
            if field in data:
                setattr(projet, field, data[field])
        if 'charge_etudes' in data:
            projet.charge_etudes = _clean_charge_etudes(data['charge_etudes'])

        if 'date_livrable' in data and data['date_livrable']:
            try:
                projet.date_livrable = datetime.strptime(data['date_livrable'], '%Y-%m-%d').date()
            except ValueError:
                pass

        if 'adresse_projet' in data:
            if isinstance(data['adresse_projet'], dict):
                projet.adresse_projet = json.dumps(data['adresse_projet'])
            else:
                projet.adresse_projet = data['adresse_projet']

        if 'niveau_keraunique' in data:
            try:
                projet.niveau_keraunique = float(data['niveau_keraunique'])
            except (ValueError, TypeError):
                pass

        if 'norme_calcul_id' in data:
            try:
                projet.norme_calcul_id = int(data['norme_calcul_id'])
            except (ValueError, TypeError):
                pass

        projet.updated_at = utc_maintenant()
        db.session.commit()

        # Logger l'activité
        activity = ShareActivity(
            share_id=share.id,
            activity_type='modified',
            user_id=guest_user['id'],
            user_email=guest_user['email'],
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details=json.dumps({'action': 'api_update', 'fields': list(data.keys())})
        )
        db.session.add(activity)
        db.session.commit()

        # Envoyer une notification email au propriétaire
        try:
            send_modification_notification_email(share, projet, guest_user['email'])
        except Exception as e:
            print(f"Erreur envoi email notification: {str(e)}")
            # Ne pas bloquer la modification si l'email échoue

        return jsonify({
            'success': True,
            'message': 'Projet mis à jour avec succès',
            'projet': projet.to_dict()
        })

    except Exception as e:
        db.session.rollback()
        print(f"Erreur API update projet partagé: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Erreur: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/shared/<token>/delete', methods=['POST'])
@share_token_required('admin')
def delete_shared_project(token, share=None, guest_user=None):
    """
    Supprimer un projet partagé (réservé aux invités avec permission admin)
    """
    try:
        projet = share.project
        projet_name = projet.nom_projet  # Sauvegarder le nom avant suppression

        # Logger l'activité de suppression avant de supprimer
        activity = ShareActivity(
            share_id=share.id,
            activity_type='deleted',
            user_id=guest_user['id'],
            user_email=guest_user['email'],
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details=json.dumps({'project_name': projet_name})
        )
        db.session.add(activity)

        # Envoyer une notification email au propriétaire AVANT de supprimer le projet
        try:
            send_deletion_notification_email(share, projet_name, guest_user['email'])
        except Exception as e:
            print(f"Erreur envoi email notification suppression: {str(e)}")
            # Ne pas bloquer la suppression si l'email échoue
            
        safe_delete_project(projet.id, guest_user['id'])

        # Suppression logique (soft delete) : le projet reste tracé pour le quota
        projet.is_deleted = True
        projet.deleted_at = utc_maintenant()
        db.session.commit()

        flash('Projet supprimé avec succès', 'success')
        return jsonify({
            'success': True,
            'message': 'Projet supprimé avec succès',
            'redirect_url': url_for('concevoir_mon_projet.delete_success', project_name=projet_name, guest_email=guest_user['email'])
        })

    except Exception as e:
        db.session.rollback()
        print(f"Erreur suppression projet partagé: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Erreur: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/shared/delete-success', methods=['GET'])
def delete_success():
    """
    Page de confirmation après suppression réussie d'un projet partagé
    """
    project_name = request.args.get('project_name', 'le projet')
    guest_email = request.args.get('guest_email', 'l\'invité')

    return render_template('base/action_success.html',
        success_title='Projet supprimé avec succès',
        success_icon='fa-trash-alt',
        success_message='Le projet a été supprimé définitivement. Cette action est irréversible.',
        details=[
            {'label': 'Projet supprimé', 'value': project_name},
            {'label': 'Supprimé par', 'value': guest_email},
            {'label': 'Date', 'value': utc_maintenant().strftime('%d/%m/%Y à %H:%M')}
        ],
        info_message='Le propriétaire du projet a été notifié de cette suppression. Le lien de partage n\'est plus valide.',
        actions=[
            {'text': 'Fermer la fenêtre', 'url': 'javascript:window.close()', 'class': 'btn-secondary', 'icon': 'fa-times'}
        ]
    )


# ==========================================
# ROUTES NORMES DE CALCUL
# ==========================================

@concevoir_mon_projet_bp.route('/normes-calcul', methods=['GET'])
@login_required
def liste_normes_calcul():
    """Liste toutes les normes de calcul disponibles"""
    try:
        current_user = g.user  # ✅ CORRECTION CRITIQUE
        # Récupérer les normes publiques + celles de l'utilisateur
        normes = NormeCalcul.query.filter(
            db.or_(
                NormeCalcul.is_public == True,
                NormeCalcul.created_by == current_user['id']  # ✅ Correction
            )
        ).order_by(NormeCalcul.created_at.desc()).all()

        return jsonify({
            'success': True,
            'normes': [n.to_dict() for n in normes]
        })

    except Exception as e:
        print(f"Erreur dans liste_normes_calcul: {str(e)}")  # ✅ Log pour debug
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/mode-de-calcul-norme/creer', methods=['POST'])
@login_required
def creer_norme_calcul():
    """Créer ou mettre à jour une norme de calcul"""
    try:
        current_user = g.user  # ✅ Ajout
        data = request.form
        norme_id = data.get('norme_id')

        # Mise à jour ou création
        if norme_id:
            norme = NormeCalcul.query.filter_by(
                id=norme_id,
                created_by=current_user['id']
            ).first_or_404()
        else:
            # ✅ VALIDATION ANTI-DUPLICATION POUR NORMES DE CALCUL
            # Vérifier si une norme similaire a été créée dans les dernières 10 secondes
            type_etude = data.get('type_etude')
            type_tension = data.get('type_tension')

            if type_etude:
                from datetime import timedelta
                temps_limite = utc_maintenant() - timedelta(seconds=10)

                norme_recente = NormeCalcul.query.filter(
                    NormeCalcul.created_by == current_user['id'],
                    NormeCalcul.type_etude == type_etude,
                    NormeCalcul.type_tension == type_tension,
                    NormeCalcul.created_at >= temps_limite
                ).first()

                if norme_recente:
                    # Une norme identique existe déjà, retourner cette norme au lieu d'en créer une nouvelle
                    return jsonify({
                        'success': True,
                        'message': 'Cette norme existe déjà (double soumission détectée)',
                        'norme_id': norme_recente.id,
                        'redirect': '/concevoir-mon-projet',
                        'duplicate_detected': True
                    })

            norme = NormeCalcul(created_by=current_user['id'])

        # Nom automatique ou personnalisé
        nom = data.get('nom_norme')
        if not nom:
            nom = f"Norme {data.get('type_etude', 'Personnalisée')} - {datetime.now().strftime('%Y%m%d%H%M')}"
        norme.nom = nom

        norme.description = data.get('description')
        norme.type_etude = data.get('type_etude')
        norme.type_tension = data.get('type_tension')
        norme.tension_personnalisee = data.get('tension_personnalisee')

        # Normes électriques (liste convertie en texte)
        norme.normes_electriques = data.get('norme_electrique', '')

        # Paramètres techniques
        try:
            norme.chute_tension_pv = float(data.get('chute_tension_pv', 3.0))
            norme.chute_tension_soutirage = float(
                data.get('chute_tension_soutirage', 8.0))
            norme.temperature_minimale = float(
                data.get('temperature_minimale', -10.0))
            norme.temperature_maximale = float(
                data.get('temperature_maximale', 50.0))
            norme.cosinus_phi = float(data.get('cosinus_phi', 0.94))
            norme.ratio_surdimensionnement = float(
                data.get('ratio_surdimensionnement', 0.80))
            norme.coefficient_degradation = float(
                data.get('coefficient_degradation', 0.25))
            norme.incertitude_p90 = float(data.get('incertitude_P90', 4.90))
        except (ValueError, TypeError):
            pass

        # Visibilité
        norme.is_public = data.get('is_public') == 'on'

        db.session.add(norme)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Norme de calcul sauvegardée avec succès',
            'norme_id': norme.id,
            'redirect': '/concevoir-mon-projet'
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Erreur lors de la sauvegarde: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/norme-calcul/<int:norme_id>', methods=['GET'])
@login_required
def get_norme_calcul(norme_id):
    """Récupérer une norme de calcul"""
    try:
        current_user = g.user  # ✅ Ajout
        norme = NormeCalcul.query.filter(
            NormeCalcul.id == norme_id,
            db.or_(
                NormeCalcul.is_public == True,
                NormeCalcul.created_by == current_user['id']  # ✅ Correction
            )
        ).first_or_404()

        return jsonify({
            'success': True,
            'norme': norme.to_dict()
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 404


@concevoir_mon_projet_bp.route('/norme-calcul/<int:norme_id>', methods=['DELETE'])
@login_required
def supprimer_norme_calcul(norme_id):
    """Supprimer une norme de calcul"""
    try:
        current_user = g.user  # ✅ Ajout
        norme = NormeCalcul.query.filter_by(
            id=norme_id,
            created_by=current_user['id']  # ✅ Correction
        ).first_or_404()

        # Vérifier si la norme est utilisée dans des projets
        projets_utilisant = ParametreProjet.query.filter_by(
            norme_calcul_id=norme_id
        ).count()

        if projets_utilisant > 0:
            return jsonify({
                'success': False,
                'message': f'Cette norme est utilisée dans {projets_utilisant} projet(s)'
            }), 400

        db.session.delete(norme)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Norme supprimée avec succès'
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/norme-calcul/<int:norme_id>/dupliquer', methods=['POST'])
@login_required
def dupliquer_norme_calcul(norme_id):
    """Dupliquer une norme de calcul"""
    try:
        current_user = g.user  # ✅ Ajout
        norme_originale = NormeCalcul.query.filter(
            NormeCalcul.id == norme_id,
            db.or_(
                NormeCalcul.is_public == True,
                NormeCalcul.created_by == current_user['id']  # ✅ Correction
            )
        ).first_or_404()

        # Créer une copie
        nouvelle_norme = NormeCalcul(
            nom=f"{norme_originale.nom} (Copie)",
            description=norme_originale.description,
            type_etude=norme_originale.type_etude,
            type_tension=norme_originale.type_tension,
            tension_personnalisee=norme_originale.tension_personnalisee,
            normes_electriques=norme_originale.normes_electriques,
            chute_tension_pv=norme_originale.chute_tension_pv,
            chute_tension_soutirage=norme_originale.chute_tension_soutirage,
            temperature_minimale=norme_originale.temperature_minimale,
            temperature_maximale=norme_originale.temperature_maximale,
            cosinus_phi=norme_originale.cosinus_phi,
            ratio_surdimensionnement=norme_originale.ratio_surdimensionnement,
            coefficient_degradation=norme_originale.coefficient_degradation,
            incertitude_p90=norme_originale.incertitude_p90,
            is_public=False,
            created_by=current_user['id']  # ✅ Correction
        )

        db.session.add(nouvelle_norme)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Norme dupliquée avec succès',
            'norme': nouvelle_norme.to_dict()
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

# ==========================================
# ROUTES UTILITAIRES
# ==========================================


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/associer-norme', methods=['POST'])
@login_required
def associer_norme_a_projet(projet_id):
    """Associer une norme de calcul à un projet"""
    try:
        current_user = g.user
        data = request.get_json(silent=True) or {}
        norme_id = data.get('norme_id')

        if not norme_id:
            return jsonify({
                'success': False,
                'message': 'ID de norme requis'
            }), 400

        projet = _get_project_with_permission(projet_id, current_user)
        if not projet:
            abort(404)

        # Vérifier que la norme existe et est accessible
        norme = NormeCalcul.query.filter(
            NormeCalcul.id == norme_id,
            db.or_(
                NormeCalcul.is_public == True,
                NormeCalcul.created_by == current_user['id']
            )
        ).first_or_404()

        projet.norme_calcul_id = norme_id
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Norme associée au projet',
            'norme': norme.to_dict()
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/statistiques', methods=['GET'])
@login_required
def statistiques_utilisateur():
    """Statistiques de l'utilisateur"""
    try:
        current_user = g.user
        total_projets = ParametreProjet.query.filter_by(
            created_by=current_user['id']
        ).count()

        projets_en_cours = ParametreProjet.query.filter_by(
            created_by=current_user['id'],
            statut_prestation='En cours'
        ).count()

        projets_termines = ParametreProjet.query.filter_by(
            created_by=current_user['id'],
            statut_prestation='Terminé'
        ).count()

        total_normes = NormeCalcul.query.filter_by(
            created_by=current_user['id']
        ).count()

        return jsonify({
            'success': True,
            'statistiques': {
                'total_projets': total_projets,
                'projets_en_cours': projets_en_cours,
                'projets_termines': projets_termines,
                'total_normes': total_normes
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ==========================================
# ROUTES CALEPINAGE - SAUVEGARDE ET CHARGEMENT
# ==========================================

SOURCES_PUISSANCE_PROJET = ('calculer', 'export', 'sauvegarder', 'auto')
# 2026-10-09 (demande explicite : "à la suppression d'un champ PV, retirer la puissance projet (kWc)
# de « Mes projets »") : seul geste qui VIDE la valeur au lieu de la figer — tiret jusqu'au prochain
# Calculer / export / Sauvegarder (ou sauvegarde automatique).
SOURCE_PUISSANCE_RETIREE = 'suppression_champ'


def _refus_projet_hors_session(projet_id):
    """Garde-fou (bug rapporté : « le projet ouvert n'est pas celui sélectionné, un calepinage est
    écrasé par celui d'un autre projet ») : le calepinage et la puissance projet ne s'écrivent que
    dans le projet ACTIF de la session. Une page restée sur un ancien projet (autre onglet, projet
    changé entre-temps) est refusée au lieu d'écrire ses données dans un autre projet.
    Session sans projet actif : pas de refus (comportement inchangé)."""
    actif = session.get('active_projet_id')
    if actif is not None and str(actif) != str(projet_id):
        return jsonify({
            'success': False, 'projet_hors_session': True,
            'message': (f"Enregistrement refusé : le projet ouvert dans cette page ({projet_id}) n'est plus "
                        f"le projet actif ({actif}). Rechargez la page pour ne pas écraser un autre projet."),
        }), 409
    return None


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/puissance-projet', methods=['POST'])
@login_required
def valider_puissance_projet(projet_id):
    """Fige la puissance projet affichée dans « Mes projets » (Calculer et visualiser, export ou
    Sauvegarder le projet). La valeur est recalculée ici depuis le calepinage ENREGISTRÉ : le client
    n'envoie que le geste qui la déclenche, jamais une puissance."""
    try:
        projet = _get_project_with_permission(projet_id, g.user)
        if not projet:
            return jsonify({'success': False, 'message': 'Projet introuvable ou accès non autorisé'}), 404

        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        source = (request.get_json(silent=True) or {}).get('source')
        if source not in SOURCES_PUISSANCE_PROJET and source != SOURCE_PUISSANCE_RETIREE:
            return jsonify({'success': False, 'message': 'Source de mise à jour de la puissance invalide'}), 400

        puissance = None if source == SOURCE_PUISSANCE_RETIREE else puissance_calepinage_kwc(projet)
        projet.puissance_projet_kwc = puissance
        projet.puissance_projet_maj_le = utc_maintenant()
        projet.puissance_projet_source = source
        db.session.commit()
        return jsonify({'success': True, 'puissance_projet_kwc': puissance})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Erreur lors de la mise à jour de la puissance : {e}'}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/calepinage/save', methods=['POST'])
@login_required
def save_calepinage_data(projet_id):
    """Sauvegarder les données de calepinage (solarProjectData du localStorage)"""
    try:
        current_user = g.user
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        # Vérifier que le projet appartient à l'utilisateur (ou admin)
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({
                'success': False,
                'message': 'Projet introuvable ou accès non autorisé'
            }), 404

        # Récupérer les données JSON envoyées
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({
                'success': False,
                'message': 'Aucune donnée fournie'
            }), 400

        # Scène d'ombrage proche : donnée dérivée du calepinage, propre au navigateur et au projet actif
        # (reconstruite à chaque écriture des champs PV) — jamais persistée en base, même si un client
        # d'une version antérieure l'envoie encore (cf. CalepinageDataService.saveToDatabase).
        data.pop('shadingScene', None)

        # Extraire les indices de révision s'ils existent
        if 'indicesRevision' in data:
            projet.indices_projet = json.dumps(data['indicesRevision'])

        projet.updated_at = utc_maintenant()

        # --- SYNCHRONISATION/UPSERT STRUCTURÉ ---
        shapes = data.get('shapes', {}) or {}
        form_data = data.get('formData', {})

        # NOUVEAU (demande explicite : "valider les données dans le front et backend, éviter la
        # collecte de données corrompues en base") : les 6 champs du sous-outil Dimensionnement
        # (puissance/rendement/conso onduleur, nb onduleurs, répartition, perte système) sont validés
        # pour CHAQUE champ PV avant toute écriture — la requête entière est rejetée au premier écart
        # trouvé, sans rien persister (même garde que save_residentiel_chiffrage_config plus haut).
        try:
            for pv_id, f_data in (form_data or {}).items():
                perte = (f_data.get('pertePourcent') or f_data.get('perte_pourcent')
                         or f_data.get('pertes') or f_data.get('perte'))
                valider_champs_dimensionnement(
                    f_data, pv_id,
                    cle_puissance='puissance_onduleur', cle_rendement='rendementOnduleur',
                    cle_conso='consoOnduleur', cle_nb_onduleurs='nbOnduleurs',
                    cle_fraction='fractionRepartitionOnduleur', perte_valeur=perte
                )
        except DimensionnementValidationError as e:
            return jsonify({'success': False, 'message': f'Champ de dimensionnement invalide : {e}'}), 400

        # Marqueur transitoire (jamais persisté, cf. CalepinageDataService.js::saveToDatabase) posé
        # UNIQUEMENT par une suppression de forme délibérée côté utilisateur (DrawingControl.js::
        # deleteSelectedShape) : autorise à faire confiance à un `shapes` vide même si le projet avait
        # déjà des calepinages en base (cf. garde-fou juste en dessous). Retiré de `data` avant toute
        # sérialisation/stockage : ce n'est qu'un signal pour CETTE requête, pas une donnée de projet.
        explicit_shape_deletion = bool(data.pop('explicitShapeDeletion', False))

        # GARDE-FOU CRITIQUE (bug de perte de données confirmé — projets vidés sans suppression
        # explicite) : cette route faisait auparavant un "clean replace" inconditionnel (purge de
        # TOUS les calepinages existants puis réinsertion depuis `shapes`), sans jamais vérifier que
        # `shapes` contenait réellement quelque chose. Un payload sans clé "shapes" (ou avec un objet
        # vide) — provenant par exemple d'un état frontend local incomplet/désynchronisé au moment de
        # l'appel (solarProjectData reconstruit avant que les tracés y soient réinjectés) — passait le
        # seul garde-fou existant (`if not data`, qui ne bloque qu'un JSON entièrement vide/null) et
        # effaçait alors silencieusement et définitivement toutes les formes déjà enregistrées.
        # Règle de persistance : les données ne doivent disparaître que via une suppression EXPLICITE
        # du projet (cf. safe_delete_project) OU une suppression explicite de forme (explicit_shape_
        # deletion ci-dessus), jamais comme effet de bord accidentel d'une sauvegarde de calepinage.
        # Si le projet a déjà des calepinages en base, que ce payload n'en contient aucun, ET qu'aucune
        # suppression explicite n'a été signalée, on ignore ce remplacement destructeur plutôt que de
        # perdre les données existantes.
        existing_calepinage_count = Calepinage.query.filter_by(projet_id=projet_id).count()
        skip_calepinage_replace = (not shapes) and existing_calepinage_count > 0 and not explicit_shape_deletion

        if skip_calepinage_replace:
            print(f"⚠️ [Flask Terminal] Sauvegarde de calepinage IGNORÉE pour le projet {projet_id} : "
                  f"payload sans 'shapes' alors que {existing_calepinage_count} forme(s) existent déjà "
                  "en base — protection contre une perte de données accidentelle.")

        # Puissance projet (kWc) : n'est PLUS reprise de data['totals']['totalPower'] (total mis en
        # cache dans le localStorage par SummaryModal, souvent périmé au moment de ce clic, voire
        # issu d'un autre projet) — recalculée plus bas depuis le calepinage effectivement
        # enregistré (cf. app/services/puissance_projet.py).

        # Stocker les données de calepinage (texte brut, relu par le frontend au chargement) —
        # seulement si on ne vient pas de décider de préserver l'état existant.
        if not skip_calepinage_replace:
            projet.calepinage_data = json.dumps(data)

        # 1. Purger les anciens calepinages pour ce projet pour faire un clean replace (seulement si
        #    le payload contient réellement des formes, ou si le projet n'en avait aucune de toute façon)
        if not skip_calepinage_replace:
            Calepinage.query.filter_by(projet_id=projet_id).delete()

        # 2. Insérer chaque forme de dessin de manière structurée
        for pv_id, shape_info in ({} if skip_calepinage_replace else shapes).items():
            f_data = form_data.get(pv_id, {})
            
            # Résoudre optionnellement le matériel du catalogue par référence (Panneau, Onduleur, Batterie)
            ref_panneau = f_data.get('referencePanneau') or f_data.get('panneau_ref')
            panneau_id = None
            if ref_panneau:
                mat = MaterielCatalogue.query.filter_by(reference=ref_panneau, type_equipement='panneau').first()
                if mat:
                    panneau_id = mat.id
            
            ref_onduleur = f_data.get('referenceOnduleur') or f_data.get('onduleur_ref')
            onduleur_id = None
            if ref_onduleur:
                mat_ond = MaterielCatalogue.query.filter_by(reference=ref_onduleur, type_equipement='onduleur').first()
                if mat_ond:
                    onduleur_id = mat_ond.id

            ref_batterie = f_data.get('referenceBatterie') or f_data.get('batterie_ref')
            batterie_id = None
            if ref_batterie:
                mat_bat = MaterielCatalogue.query.filter_by(reference=ref_batterie, type_equipement='batterie').first()
                if mat_bat:
                    batterie_id = mat_bat.id

            calep = Calepinage(
                projet_id=projet_id,
                pv_id=pv_id,
                coordonnees=shape_info.get('points', []),
                inclinaison=_safe_float(shape_info.get('inclinaison', 0.0)),
                azimut=_safe_float(shape_info.get('azimuth', 0.0)),
                systeme_integration=f_data.get('referenceSI'),
                disposition=shape_info.get('gridInfo', {}).get('disposition'),
                mode_pose=f_data.get('modePose'),
                panneau_id=panneau_id,
                onduleur_id=onduleur_id,
                batterie_id=batterie_id,
                type_toiture=f_data.get('typeToiture') or f_data.get('type_toiture'),
                esp_bordure=_safe_float(f_data.get('espBordure') or f_data.get('esp_bordure') or f_data.get('espacement_bordure')),
                joint_dilatation=_safe_float(f_data.get('jointDilatation') or f_data.get('joint_dilatation')),
                long_max=_safe_float(f_data.get('longMax') or f_data.get('long_max') or f_data.get('longueur_max')),
                type_montage=f_data.get('typeMontage') or f_data.get('type_montage'),
                perte_pourcent=_safe_float(f_data.get('pertePourcent') or f_data.get('perte_pourcent') or f_data.get('pertes') or f_data.get('perte')),
                affectation_centrale=f_data.get('affectationCentrale') or f_data.get('affectation_centrale') or f_data.get('affectation'),
                nb_onduleurs=int(_safe_float(f_data.get('nbOnduleurs'), 1)),
                fraction_repartition_onduleur=_safe_float(f_data.get('fractionRepartitionOnduleur'), 100.0),
                donnees_completes=shape_info
            )
            db.session.add(calep)

        # 3. Synchroniser la géométrie structurée (geometriePlansData) — même garde-fou que ci-dessus :
        #    ne purge/remplace que si le payload contient réellement des entrées de géométrie, ou si
        #    le projet n'en avait aucune de toute façon.
        geometrie_plans_data = data.get('geometriePlansData', {}) or {}
        geometrie_entries = {
            k: v for k, v in geometrie_plans_data.items()
            if k != 'savedAt' and isinstance(v, dict)
        } if isinstance(geometrie_plans_data, dict) else {}

        existing_geometrie_count = GeometrieProjet.query.filter_by(projet_id=projet_id).count()
        skip_geometrie_replace = (not geometrie_entries) and existing_geometrie_count > 0

        if skip_geometrie_replace:
            print(f"⚠️ [Flask Terminal] Synchronisation géométrie IGNORÉE pour le projet {projet_id} : "
                  f"payload sans 'geometriePlansData' alors que {existing_geometrie_count} entrée(s) "
                  "existent déjà en base — protection contre une perte de données accidentelle.")
        else:
            GeometrieProjet.query.filter_by(projet_id=projet_id).delete()
            for pv_id, geom_info in geometrie_entries.items():

                # Détecter ou inférer le type de structure technique
                type_structure = (
                    geom_info.get('type_structure') or 
                    geom_info.get('postModel') or 
                    geom_info.get('typeDeStructure') or 
                    'inconnu'
                )
                
                geom_entry = GeometrieProjet(
                    projet_id=projet_id,
                    pv_id=pv_id,
                    type_structure=type_structure,
                    parametres_calcul=geom_info
                )
                db.session.add(geom_entry)

        # Puissance projet recalculée depuis le calepinage tel qu'il vient d'être enregistré ; le
        # quota de licence (max_kwc par projet) est vérifié sur cette même valeur.
        erreur_puissance = _maj_puissance_projet(current_user, projet)
        if erreur_puissance:
            return erreur_puissance

        db.session.commit()

        # Message de confirmation dans le terminal de VS Code
        print(f"✅ [Flask Terminal] Données de calepinage sauvegardées en base de données pour le projet {projet_id}")

        return jsonify({
            'success': True,
            'message': 'Données de calepinage sauvegardées avec succès',
            'projet_id': projet.id
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Erreur lors de la sauvegarde: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/catalogue/materiels', methods=['GET'])
@login_required
def get_catalogue_materiels():
    """API d'interrogation du catalogue des matériels"""
    try:
        type_equipement = request.args.get('type')
        query = MaterielCatalogue.query.filter_by(is_active=True)
        if type_equipement:
            query = query.filter_by(type_equipement=type_equipement)
        
        materiels = query.all()
        return jsonify({
            'success': True,
            'materiels': [m.to_dict() for m in materiels]
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/catalogue/panneaux', methods=['GET'])
@login_required
def get_catalogue_panneaux():
    """API d'interrogation du catalogue des panneaux (bd_panneaux_pv.js)"""
    try:
        panneaux = Panneau.query.filter_by(is_active=True).all()
        return jsonify({'success': True, 'panneaux': [p.to_dict() for p in panneaux]})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/catalogue/onduleurs', methods=['GET'])
@login_required
def get_catalogue_onduleurs():
    """API d'interrogation du catalogue des onduleurs (bd_onduleurs.js)"""
    try:
        onduleurs = Onduleur.query.filter_by(is_active=True).all()
        return jsonify({'success': True, 'onduleurs': [o.to_dict() for o in onduleurs]})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/catalogue/batteries', methods=['GET'])
@login_required
def get_catalogue_batteries():
    """API d'interrogation du catalogue des batteries (bd_batteries.js)"""
    try:
        batteries = Batterie.query.filter_by(is_active=True).all()
        result = []
        for b in batteries:
            d = b.to_dict()
            # NOUVEAU (demande explicite : "tenir compte du type de batterie par modèle d'onduleur
            # hybride") : références des onduleurs compatibles, pour un filtre strict côté front sans
            # aller-retour serveur supplémentaire à chaque changement d'onduleur (même principe que
            # window.onduleurCatalogFromApi, déjà 100% client-side).
            d['compatible_onduleur_refs'] = [
                c.onduleur.reference for c in b.compat_onduleurs if c.onduleur and c.onduleur.is_active
            ]
            result.append(d)
        return jsonify({'success': True, 'batteries': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/catalogue/optimiseurs', methods=['GET'])
@login_required
def get_catalogue_optimiseurs():
    """API d'interrogation du catalogue des optimiseurs (NOUVEAU, demande explicite : ajout matériels
    BD). Embarque, pour chaque optimiseur, les bornes de compatibilité PAR modèle d'onduleur (longueur
    de chaîne min/max, puissance PV max) — table OptimiseurOnduleurCompat, cf. équipements_pv.py."""
    try:
        optimiseurs = Optimiseur.query.filter_by(is_active=True).all()
        result = []
        for o in optimiseurs:
            d = o.to_dict()
            d['compatible_onduleurs'] = [
                {
                    'reference': c.onduleur.reference,
                    'chaine_min': c.chaine_min,
                    'chaine_max': c.chaine_max,
                    'puissance_max_w': c.puissance_max_w,
                }
                for c in o.compat_onduleurs if c.onduleur and c.onduleur.is_active
            ]
            result.append(d)
        return jsonify({'success': True, 'optimiseurs': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/catalogue/pompes-solaires', methods=['GET'])
@login_required
def get_catalogue_pompes_solaires():
    """API d'interrogation du catalogue des pompes solaires (NOUVEAU, demande explicite : "ajouter les
    données de pompage solaire aussi").

    Les courbes de performance (~6 Ko par pompe) ne sont envoyées qu'avec ?avec_courbes=1 (section
    Pompage solaire) : le catalogue est aussi chargé à chaque page par le formulaire résidentiel."""
    try:
        avec_courbes = request.args.get('avec_courbes') == '1'
        pompes = PompeSolaire.query.filter_by(is_active=True).all()
        resultat = []
        for p in pompes:
            d = p.to_dict()
            if not avec_courbes:
                d['courbes_performance'] = None
            resultat.append(d)
        return jsonify({'success': True, 'pompes_solaires': resultat})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/calepinage/load', methods=['GET'])
@login_required
def load_calepinage_data(projet_id):
    """Charger les données de calepinage pour un projet"""
    try:
        current_user = g.user

        # Vérifier que le projet appartient à l'utilisateur (ou admin)
        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({
                'success': False,
                'message': 'Projet introuvable ou accès non autorisé'
            }), 404

        # Initialiser created_by_name avec l'email si NULL (pour les projets existants)
        if not projet.created_by_name and projet.created_by_email:
            projet.created_by_name = projet.created_by_email
            db.session.commit()
            print(f'✅ Initialisation de created_by_name pour le projet {projet_id}')

        # Retourner les données de calepinage
        calepinage_data = None
        if projet.calepinage_data:
            try:
                calepinage_data = json.loads(projet.calepinage_data)
            except json.JSONDecodeError:
                calepinage_data = None

        # Si calepinage_data est None ou vide, initialiser avec les données du projet
        if calepinage_data is None:
            calepinage_data = {}

        # Injecter ou mettre à jour projectInfo avec les données de la base de données
        # pour s'assurer que les informations du projet sont toujours présentes
        calepinage_data['projectInfo'] = {
            'nomProjet': projet.nom_projet or 'N/A',
            # Priorité au champ direct type_etude (choix utilisateur) ; repli sur la norme
            # associée pour compatibilité avec d'anciens projets liés uniquement via une norme.
            'typeEtude': normaliser_type_etude(projet.type_etude or (projet.norme.type_etude if projet.norme else None)) or 'N/A',
            'typeProjet': projet.type_projet or 'N/A',
            'typeOuvrage': projet.type_ouvrage or 'N/A',
            'modeDeValorisation': projet.mode_de_valorisation or 'N/A',
            'optionReseau': projet.option_reseau or 'N/A',
            'adresseProjet': projet.adresse_projet or 'N/A',
            'reglementUrbanisme': projet.reglement_urbanisme or 'N/A',
            'contraintesSpecifiques': projet.contraintes_specifiques or 'N/A',
            'hypothesesDeConception': projet.hypotheses_de_conception or 'N/A',
            'typeDeProjet': projet.type_de_projet or 'N/A',
            'autreTypeProjet': projet.autre_type_projet or 'N/A',
            'autreTypeOuvrage': projet.autre_type_ouvrage or 'N/A',
            'createdBy': projet.created_by_name or projet.created_by_email or 'N/A',
            'chargeEtudes': projet.charge_etudes or '',
        }

        # Injecter les données météo depuis la base de données
        calepinage_data['meteoData'] = {
            'vent': projet.zone_de_vent or 'N/A',
            'terrain': projet.categorie_de_terrain or 'N/A',
            'neige': projet.zone_de_neige or 'N/A',
            'sismique': projet.zone_sismique or 'N/A',
            'keraunique': str(projet.niveau_keraunique) if projet.niveau_keraunique is not None else 'N/A',
        }

        # Injecter les normes électriques si elles existent dans la norme de calcul
        if projet.norme and projet.norme.normes_electriques:
            try:
                normes_list = json.loads(projet.norme.normes_electriques) if isinstance(projet.norme.normes_electriques, str) else projet.norme.normes_electriques
                if isinstance(normes_list, list):
                    calepinage_data['normesElectriques'] = normes_list
            except (json.JSONDecodeError, TypeError):
                # Si le parsing échoue, ne rien faire (les normes ne seront pas ajoutées)
                pass

        # Injecter les indices de révision si ils existent
        if projet.indices_projet:
            try:
                indices_list = json.loads(projet.indices_projet) if isinstance(projet.indices_projet, str) else projet.indices_projet
                if isinstance(indices_list, list):
                    calepinage_data['indicesRevision'] = indices_list
                else:
                    # Si ce n'est pas une liste, initialiser avec une valeur par défaut
                    calepinage_data['indicesRevision'] = [{
                        'index': 'A',
                        'date': utc_maintenant().strftime('%d/%m/%Y'),
                        'description': 'Création du projet',
                        'redigerPar': projet.created_by_name or projet.created_by_email or 'N/A'
                    }]
            except (json.JSONDecodeError, TypeError):
                # Si le parsing échoue, initialiser avec une valeur par défaut
                calepinage_data['indicesRevision'] = [{
                    'index': 'A',
                    'date': utc_maintenant().strftime('%d/%m/%Y'),
                    'description': 'Création du projet',
                    'redigerPar': projet.created_by_name or projet.created_by_email or 'N/A'
                }]
        else:
            # Si pas d'indices enregistrés, initialiser avec une valeur par défaut
            calepinage_data['indicesRevision'] = [{
                'index': 'A',
                'date': utc_maintenant().strftime('%d/%m/%Y'),
                'description': 'Création du projet',
                'redigerPar': projet.created_by_name or projet.created_by_email or 'N/A'
            }]

        # Charger les données géométriques structurées
        geometries = GeometrieProjet.query.filter_by(projet_id=projet_id).all()
        geometrie_plans_data = {}
        for geom in geometries:
            geometrie_plans_data[geom.pv_id] = geom.parametres_calcul
        if geometrie_plans_data:
            geometrie_plans_data['savedAt'] = utc_maintenant().isoformat()

        return jsonify({
            'success': True,
            'projet_id': projet.id,
            'nom_projet': projet.nom_projet,
            'calepinage_data': calepinage_data,
            'geometrie_plans_data': geometrie_plans_data
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Erreur lors du chargement: {str(e)}'
        }), 500


# --------------------------------------------------------------------------------------------
# Calepinage résidentiel (toiture multi-typologie) — persistance BD, table dédiée
# (CalepinageMaison, cf. app/models/calepinage.py), module volontairement indépendant du
# calepinage rectangulaire/polygonale/shed ci-dessus (aucune dépendance sur `shapes`/`formData`/
# `Calepinage`). Mêmes garde-fous (propriété du projet, anti-perte-de-données) que
# save_calepinage_data/load_calepinage_data, par cohérence.
# --------------------------------------------------------------------------------------------
@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/calepinage-maison/save', methods=['POST'])
@login_required
def save_calepinage_maison_data(projet_id):
    """Sauvegarde les maisons du calepinage "toiture multi-typologie" (contour + équipements)."""
    try:
        current_user = g.user
        refus = _refus_projet_hors_session(projet_id)
        if refus:
            return refus

        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({
                'success': False,
                'message': 'Projet introuvable ou accès non autorisé'
            }), 404

        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({
                'success': False,
                'message': 'Aucune donnée fournie'
            }), 400

        # maisons : { [maisonId]: { coordonnees: [{lat,lng}], state: {...calepinage_maison_v1...} } }
        maisons = data.get('maisons', {}) or {}

        # NOUVEAU (demande explicite : "valider les données dans le front et backend, éviter la
        # collecte de données corrompues en base") : mêmes 6 champs, mêmes bornes que
        # save_calepinage_data (Pro/Grand) ci-dessus — rejet net de la requête entière au premier
        # écart trouvé, avant toute écriture.
        try:
            for maison_id, maison_info in maisons.items():
                state = maison_info.get('state', {}) or {}
                valider_champs_dimensionnement(
                    state, f"maison {maison_id}",
                    cle_puissance='onduleurPuissanceKva', cle_rendement='onduleurRendement',
                    cle_conso='onduleurConso', cle_nb_onduleurs='nbOnduleurs',
                    cle_fraction='fractionRepartitionOnduleur', perte_valeur=state.get('perteSysteme')
                )
                valider_cablage_dc(state.get('cablageDc'), f"maison {maison_id}")
                # NOUVEAU (demande explicite : "valider... toutes données qui vont au backend") :
                # champs numériques de géométrie de toiture/matériels non couverts ci-dessus (asymétrie,
                # porte-à-faux, pente, espacements shed/dôme/bordures, dimensions panneau, capacité
                # batterie, garanties, affectation centrale) — cf. calepinage_dimensionnement_schemas.py.
                valider_champs_geometrie_toiture(state, f"maison {maison_id}")
                # Contour issu d'un décalage de parcelles cadastrales : recul 1 à 50 m, tracés bornés.
                valider_origine_parcelles(maison_info.get('origineParcelles'), f"maison {maison_id}")
                # Type de structure imposé à la création du contour (ex. champ solaire) : liste blanche.
                valider_reglages_creation_contour(maison_info, f"maison {maison_id}")
        except DimensionnementValidationError as e:
            return jsonify({'success': False, 'message': f'Champ de dimensionnement invalide : {e}'}), 400

        # Surface maximale des contours (config.py : CALEPINAGE_SURFACE_MAX_RECT_M2 /
        # _POLYGONE_M2) — filet de sécurité du verrou frontend, rejet avant toute écriture.
        try:
            for maison_id, maison_info in maisons.items():
                verifier_surface_maison(maison_info, current_app.config, f"Champ {maison_id}")
        except SurfaceContourError as e:
            return jsonify({'success': False, 'message': str(e)}), 400

        # Champ solaire depuis le cadastre : accès réglé dans config.py (DECALAGE_PARCELLES_*). Un
        # utilisateur non autorisé ne peut pas enregistrer de NOUVEAU champ issu du cadastre ; ceux
        # déjà en base pour ce projet (créés par un compte autorisé) restent sauvegardables.
        if not acces_decalage_parcelles(current_app.config, current_user):
            origines_en_base = [
                (row.donnees_completes or {}).get('origineParcelles')
                for row in CalepinageMaison.query.filter_by(projet_id=projet_id).all()
            ]
            refusees = origines_nouvelles(maisons, origines_en_base)
            if refusees:
                return jsonify({
                    'success': False,
                    'message': "Le champ solaire depuis le cadastre n'est pas disponible pour votre compte "
                               f"({', '.join(refusees)}).",
                }), 403

        # Même garde-fou anti-perte-de-données que save_calepinage_data ci-dessus : un payload sans
        # maison alors que le projet en a déjà en base est ignoré, sauf suppression explicite
        # signalée par le frontend (maison supprimée via "Supprimer le polygone").
        explicit_deletion = bool(data.get('explicitDeletion', False))
        # Renumérotation des champs (PV2 -> PV1 après suppression de PV1) : les données rattachées au
        # n° de champ (paramètres du petit champ, géométrie des configurateurs...) la suivent.
        try:
            renumerotation = valider_renumerotation(data.get('renumerotation'))
        except ValueError as e:
            return jsonify({'success': False, 'message': str(e)}), 400

        # Surface projetée au sol des panneaux (m², calcul du moteur de calepinage, comme
        # puissanceTotaleKwc) : relue par le calculateur Loi APER. Absente (page d'avant ce champ)
        # -> inconnue (NULL) ; valeur aberrante -> requête refusée avant toute écriture.
        try:
            surface_projetee_m2 = valider_surface_projetee_m2(
                data.get('surfaceProjeteeTotaleM2'), len(maisons),
                current_app.config.get('CALEPINAGE_SURFACE_MAX_POLYGONE_M2'))
        except ValueError as e:
            return jsonify({'success': False, 'message': str(e)}), 400

        # Calepinage identique à celui déjà en base (projet rouvert sans modification, changement
        # de projet...) : rien n'est réécrit — ni les lignes, ni la puissance enregistrée. Seule
        # exception : la surface projetée encore inconnue (calepinage enregistré avant son ajout)
        # est complétée, sans quoi la Loi APER resterait sans surface tant que rien ne change.
        lignes_existantes = CalepinageMaison.query.filter_by(projet_id=projet_id).all()
        if (not explicit_deletion and not renumerotation and lignes_existantes
                and _empreinte_maisons({r.maison_id: r.donnees_completes for r in lignes_existantes})
                == _empreinte_maisons(maisons)):
            if projet.surface_projetee_maison_m2 is None and surface_projetee_m2 is not None:
                projet.surface_projetee_maison_m2 = surface_projetee_m2
                db.session.commit()
            return jsonify({'success': True, 'inchange': True,
                            'message': 'Calepinage maison inchangé', 'projet_id': projet.id,
                            'surfaceProjeteeEnregistree': projet.surface_projetee_maison_m2 is not None})

        existing_count = len(lignes_existantes)
        skip_replace = (not maisons) and existing_count > 0 and not explicit_deletion

        if skip_replace:
            # CORRECTIF (bug rapporté en testant la validation ci-dessus : "500 sur toute sauvegarde
            # réussie") : émojis dans un print() -> UnicodeEncodeError sur la console Windows par
            # défaut (codepage cp1252, ne sait pas encoder ⚠️/✅), non rattrapée par le except générique
            # plus bas puisqu'elle survient APRÈS db.session.commit() — la sauvegarde réussissait bien
            # en base, mais la réponse renvoyée au frontend était un faux 500. Émojis retirés.
            print(f"[Flask Terminal] Sauvegarde de calepinage maison IGNOREE pour le projet {projet_id} : "
                  f"payload sans maison alors que {existing_count} maison(s) existent deja en base — "
                  "protection contre une perte de donnees accidentelle.")
        else:
            # Puissance des maisons (kWc), calculée par le moteur de calepinage pour CES maisons (cf.
            # getAllPvFieldSummaries(), calepinage_maison_persistence_db.js). La puissance projet
            # (puissance_totale_kwc) est recalculée plus bas, une fois les lignes réécrites.
            projet.puissance_maison_kwc = _safe_float(data.get('puissanceTotaleKwc'), None)
            projet.surface_projetee_maison_m2 = surface_projetee_m2

            # Champs supprimés / renumérotés : leurs données rattachées au n° suivent (même transaction).
            appliquer_renumerotation_champs(
                projet_id, [r.maison_id for r in lignes_existantes], list(maisons.keys()), renumerotation)

            CalepinageMaison.query.filter_by(projet_id=projet_id).delete()
            for maison_id, maison_info in maisons.items():
                state = maison_info.get('state', {}) or {}
                calep_maison = CalepinageMaison(
                    projet_id=projet_id,
                    maison_id=maison_id,
                    coordonnees=maison_info.get('coordonnees', []),
                    panneau_ref=state.get('panelRef'),
                    panneau_puissance_wc=_safe_float(state.get('panelPowerWc')),
                    systeme_integration_ref=state.get('systemeIntegrationRef'),
                    onduleur_puissance_kva=_safe_float(state.get('onduleurPuissanceKva')),
                    onduleur_rendement=_safe_float(state.get('onduleurRendement')),
                    onduleur_conso=_safe_float(state.get('onduleurConso')),
                    batterie_ref=state.get('batteryRef'),
                    batterie_capacite_kwh=_safe_float(state.get('batteryCapaciteKwh')),
                    type_montage=state.get('typeMontage') or maison_info.get('typeMontageInitial'),
                    perte_pourcent=_safe_float(state.get('perteSysteme')),
                    affectation_centrale=state.get('affectationCentrale'),
                    donnees_completes=maison_info
                )
                db.session.add(calep_maison)

            erreur_puissance = _maj_puissance_projet(current_user, projet)
            if erreur_puissance:
                return erreur_puissance

        db.session.commit()

        print(f"[Flask Terminal] Calepinage maison sauvegarde en base de donnees pour le projet {projet_id}")

        return jsonify({
            'success': True,
            'message': 'Calepinage maison sauvegardé avec succès',
            'projet_id': projet.id,
            'surfaceProjeteeEnregistree': projet.surface_projetee_maison_m2 is not None,
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Erreur lors de la sauvegarde: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/parametre-projet/<int:projet_id>/calepinage-maison/load', methods=['GET'])
@login_required
def load_calepinage_maison_data(projet_id):
    """Charge les maisons du calepinage "toiture multi-typologie" pour un projet."""
    try:
        current_user = g.user

        projet = _get_project_with_permission(projet_id, current_user)

        if not projet:
            return jsonify({
                'success': False,
                'message': 'Projet introuvable ou accès non autorisé'
            }), 404

        maisons_rows = CalepinageMaison.query.filter_by(projet_id=projet_id).all()
        maisons = {}
        for row in maisons_rows:
            info = row.donnees_completes or {}
            # CORRECTIF (bug rapporté : calepinage rectangulaire desorganise au retour sur un
            # projet) : le mode de trace ('rect'/'polygon') est desormais renvoye avec le contour.
            # Il voyage dans la colonne JSON `donnees_completes` (le payload frontend y est stocke
            # entier), donc aucune migration n'est necessaire. Absent pour les maisons enregistrees
            # avant ce correctif : le frontend retombe alors sur l'etat de la maison puis sur une
            # deduction geometrique (cf. MaisonPolygonManager.inferModeFromPath).
            maisons[row.maison_id] = {
                'coordonnees': row.coordonnees,
                'mode': info.get('mode'),
                'state': info.get('state', {}),
                # Limite de propriété / trait et valeur du décalage (champ issu de parcelles
                # cadastrales), absent pour un contour trace a la main.
                'origineParcelles': info.get('origineParcelles'),
                # CORRECTIF (calepinage rouvert désorganisé) : enregistrés par la sauvegarde mais
                # jamais renvoyés — le client (hydrateFromDatabaseIfEmpty) les relit pourtant, et
                # sans eux un champ solaire revenait en type de structure par défaut.
                'typeMontageInitial': info.get('typeMontageInitial'),
                'reglagesInitiaux': info.get('reglagesInitiaux'),
            }

        return jsonify({
            'success': True,
            'projet_id': projet.id,
            'maisons': maisons,
            # False : le client renverra la surface projetée à sa prochaine sauvegarde, même si le
            # calepinage n'a pas changé (cf. save_calepinage_maison_data, Loi APER).
            'surfaceProjeteeEnregistree': projet.surface_projetee_maison_m2 is not None,
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Erreur lors du chargement: {str(e)}'
        }), 500


@concevoir_mon_projet_bp.route('/calepinage-maison/verify', methods=['POST'])
@login_required
def verify_calepinage_maison():
    """Double (voire triple) vérification backend du nombre de panneaux du calepinage résidentiel
    (tous poseMode : incliné/à-plat/shed/dôme) — TEMPORAIRE, endpoint de diagnostic (cf.
    calepinage_maison_verif_test.js).

    - `pans`/`totalPanelCount` (residentiel_engine) : reproduit calepinage_maison_calculs.js sur
      les MÊMES mètres locaux déjà calculés par le frontend — détecte les bugs d'algorithme de
      remplissage.
    - `geodesic` (geodesic_engine, pyproj+Shapely) : reprojette CHAQUE sommet/centre d'obstacle
      depuis ses coordonnées géographiques réelles, indépendamment de la conversion
      équirectangulaire du frontend — détecte EN PLUS une éventuelle erreur de projection
      elle-même (demande explicite : "s'il y a une erreur au niveau de la conversion du front, le
      backend ne le détectera[it] pas car ils dépendent de la même source" pour le calcul ci-dessus
      seul). `geodesic.available` est False si la maison n'a aucune référence géographique (image
      importée) — jamais une approximation de repli à la place.

    Aucune lecture/écriture en base : purement un calcul, à partir de l'état CM.state envoyé tel
    quel (le même state que celui déjà persisté par ailleurs via /calepinage-maison/save)."""
    try:
        data = request.get_json(silent=True) or {}
        state = data.get('state') or {}
        if not isinstance(state, dict) or not state.get('pans'):
            return jsonify({'success': False, 'message': 'État de maison invalide ou sans pan.'}), 400
        # Surface maximale du contour (config.py) : pas de calcul sur un contour trop grand.
        try:
            verifier_surface_etat_verification(state, current_app.config)
        except SurfaceContourError as e:
            return jsonify({'success': False, 'message': str(e)}), 400

        # inclure_positions (demande explicite : "mettre en place le remplacement des panneaux si
        # les résultats sont différents") : opt-in (coût de sérialisation non nul sur une grande
        # toiture) — cf. calepinage_maison_verif_test.js, qui ne demande les positions que pour
        # appliquer un correctif, jamais pour le simple affichage du tableau de comparaison.
        include_positions = bool(data.get('inclure_positions'))
        result = verify_maison_state(state, include_positions=include_positions)
        geodesic_result = verify_maison_state_geodesic(state, include_positions=include_positions)
        return jsonify({'success': True, **result, 'geodesic': geodesic_result})

    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur de vérification: {str(e)}'}), 500


@concevoir_mon_projet_bp.route('/parametres-projets/with-calepinage', methods=['GET'])
@login_required
def liste_projets_avec_calepinage():
    """Liste les projets qui ont des données de calepinage (tous pour admin, propres projets sinon)"""
    try:
        current_user = g.user

        # Requête pour récupérer les projets avec données de calepinage
        query = ParametreProjet.query.filter(
            ParametreProjet.calepinage_data.isnot(None),
            ParametreProjet.calepinage_data != '',
            db.or_(ParametreProjet.is_deleted == False, ParametreProjet.is_deleted.is_(None))
        )
        if not current_user.get('is_admin'):
            query = query.filter(ParametreProjet.created_by == current_user['id'])

        projets = query.order_by(ParametreProjet.updated_at.desc()).all()

        # Formater les données
        projets_list = []
        for projet in projets:
            revisions = _revisions_du_projet(projet.id)
            projets_list.append({
                'id': projet.id,
                'nom_projet': projet.nom_projet,
                'adresse_projet': projet.adresse_projet,
                'updated_at': projet.updated_at.isoformat() if projet.updated_at else None,
                'norme_calcul': projet.norme.to_dict() if projet.norme else None,
                'active_indice': projet.active_indice,
                'revisions': [_resume_revision(r) for r in revisions]
            })

        return jsonify({
            'success': True,
            'projets': projets_list
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500


def safe_delete_project(project_id, user_id, is_admin=False):
    '''Supprime un projet et tous ses partages en toute sécurité'''
    from app.models import ParametreProjet, ProjectShare, ShareActivity

    query = ParametreProjet.query.filter_by(id=project_id)
    if not is_admin:
        query = query.filter_by(created_by=user_id)
    project = query.first()

    if not project:
        return False, "Projet introuvable"

    try:
        # Supprimer d'abord les activités
        ShareActivity.query.filter(
            ShareActivity.share_id.in_(
                db.session.query(ProjectShare.id).filter_by(project_id=project_id)
            )
        ).delete(synchronize_session=False)

        # Supprimer les partages
        ProjectShare.query.filter_by(project_id=project_id).delete()

        # Suppression logique (soft delete) : le projet est marqué supprimé
        # mais reste définitivement comptabilisé dans les quotas de licence consommés
        project.is_deleted = True
        project.deleted_at = utc_maintenant()
        db.session.commit()

        return True, "Projet supprimé avec succès"

    except Exception as e:
        db.session.rollback()
        return False, str(e)
    
# ===============================================
# ROUTES GÉOMÉTRIE (OMBRIÈRE METAL & CALEPINAGE)
# ===============================================

@concevoir_mon_projet_bp.route('/geometrie/ombriere')
@login_required
def geometrie_ombriere():
    """Page principale de l'ombrière métal"""
    return render_template('concevoir_mon_projet/modals/geometrie/ombriere_metal.html')



@concevoir_mon_projet_bp.route('/geometrie/petit_champ_')
@login_required
def geometrie_petit_champ_solaire():
    """Page principale de petit champ solaire"""
    # Bornes de saisie injectées dans la page : même fichier que la validation serveur.
    from app.services.petit_champ_solaire.validation import charger_limites
    return render_template('concevoir_mon_projet/modals/geometrie/petit_champ_solaire.html',
                           petit_champ_limites=charger_limites())



@concevoir_mon_projet_bp.route('/geometrie/calepinage')
@login_required
def geometrie_calepinage():
    """Page de calepinage (intégrée dans l'iframe)"""
    return render_template('concevoir_mon_projet/modals/geometrie/calepinage_ombriere.html')

@concevoir_mon_projet_bp.route('/api/calculate', methods=['POST'])
@login_required
def calepinage_calculate():
    """API de calcul du calepinage"""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    result = calculate_calepinage(data)
    return jsonify(result)

@concevoir_mon_projet_bp.route('/api/ombriere/calculate', methods=['POST'])
@login_required
def ombriere_calculate():
    """API de calcul de l'ombrière (géométrie, hauteurs, etc.)"""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    try:
        result = calculate_ombriere(data)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@concevoir_mon_projet_bp.route('/api/ombriere/export-python-a3', methods=['POST'])
@login_required
def ombriere_export_python_a3():
    """
    Export PDF via Python (optionnel).
    Si la fonctionnalité n'est pas encore implémentée, on peut retourner une erreur.
    """
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    # TODO: Implémenter la génération PDF avec rapport.py si nécessaire
    # Pour l'instant, on délègue à la version JS (déjà fonctionnelle)
    return jsonify({"error": "Cet export n'est pas encore disponible : utilisez l'export du rapport."}), 501


# ==========================================
# ROUTES OMBRIÈRE SOLUMBRA
# ==========================================

@concevoir_mon_projet_bp.route('/geometrie/ombriere_solumbra')
@login_required
def geometrie_ombriere_solumbra():
    return render_template('concevoir_mon_projet/modals/geometrie/ombriere_solumbra/ombriere_solumbra.html')

@concevoir_mon_projet_bp.route('/geometrie/ombriere_solumbra/calepinage')
@login_required
def geometrie_ombriere_solumbra_calepinage():
    return render_template('concevoir_mon_projet/modals/geometrie/ombriere_solumbra/calepinage_ombriere.html')

@concevoir_mon_projet_bp.route('/api/ombriere_solumbra/calculate', methods=['POST'])
@login_required
def ombriere_solumbra_calculate():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    try:
        result = calculate_ombriere_solumbra(data)   # <-- ici
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@concevoir_mon_projet_bp.route('/api/ombriere_solumbra/calepinage/calculate', methods=['POST'])
@login_required
def calepinage_ombriere_solumbra_calculate():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    result = calculate_calepinage(data)    # <-- ici
    return jsonify(result)

# ==========================================
# ROUTES Bâtiment métal_bois
# ==========================================

@concevoir_mon_projet_bp.route('/geometrie/batiment_metal/calepinage')
@login_required
def geometrie_calepinage_batiment_metal():
    """Page de calepinage (intégrée dans l'iframe)"""
    return render_template('concevoir_mon_projet/modals/geometrie/calepinage_ombriere.html')


@concevoir_mon_projet_bp.route('/geometrie/batiment_metal')
@permission_required('concevoir_mon_projet')
@login_required
def batiment_metal():
    """Bâtiment métal"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/geometrie/batiment_metal.html')

@concevoir_mon_projet_bp.route('/api/calculate_building', methods=['POST'])
@login_required
def calculate_building_batiment_metal():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    result = calculate_building_geometry_batiment_metal(data)
    return jsonify(result)


@concevoir_mon_projet_bp.route('/api/generate_report', methods=['POST'])
def generate_report_batiment_metal():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    try:
        from rapport_batiment_metal import generate_a3_pdf_batiment_metal
        pdf_stream = pdf_pour_utilisateur(generate_a3_pdf_batiment_metal(data))
        return send_file(pdf_stream, download_name="plans-batiment.pdf", as_attachment=True, mimetype='application/pdf')
    except Exception as e:
        return jsonify({"error": str(e)}), 500



# ==========================================
# ROUTES Ombrière bois
# ==========================================


@concevoir_mon_projet_bp.route('/modal/ombriere_bois')
@permission_required('concevoir_mon_projet')
@login_required
def ombriere_bois():
    """Modal ombrière bois"""
    if 'user' not in session:
        return redirect(url_for('main.login'))

    return render_template('concevoir_mon_projet/modals/geometrie/ombriere_bois/ombriere_bois.html')

@concevoir_mon_projet_bp.route('/geometrie/ombriere_bois/calepinage')
@login_required
def geometrie_calepinage_ombriere_bois():
    """Page de calepinage (intégrée dans l'iframe)"""
    return render_template('concevoir_mon_projet/modals/geometrie/calepinage_ombriere.html')

#CODE CONSERVÉ AU CAS OÙ (Logique migrée en local JS) ---
@concevoir_mon_projet_bp.route('/api/ombriere_bois/calculate', methods=['POST'])
@login_required
def ombriere_calculate_bois():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400
    try:
        result = calculate_ombriere_bois(data)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@concevoir_mon_projet_bp.route('/api/ombriere_bois/export-python-a3', methods=['POST'])
@login_required
def ombriere_export_python_a3_bois():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Données manquantes"}), 400

    try:
        from rapport import generate_a3_pdf_bois
        pdf_buffer = pdf_pour_utilisateur(generate_a3_pdf_bois(data))
        return send_file(pdf_buffer, as_attachment=True, download_name='Rapport_A3.pdf', mimetype='application/pdf')
    except Exception as e:
        return jsonify({"error": f"Erreur lors de la génération du rapport : {str(e)}"}), 500