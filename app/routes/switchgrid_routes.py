"""
Routes internes : appelées par le frontend de PV_project, qui ne parle
JAMAIS directement à l'API Switchgrid. Ce blueprint fait l'intermédiaire :

    Frontend  -->  /api/switchgrid/...  -->  services/switchgrid/*  -->  Switchgrid

Toutes les routes nécessitent une authentification applicative standard de
PV_project (décorateur `@login_required` ou équivalent existant) — à
brancher selon votre middleware d'auth actuel.
"""
from __future__ import annotations

from datetime import datetime
from app.utils.dates import utc_maintenant
from functools import wraps

from flask import Blueprint, Response, current_app, jsonify, request, g
from werkzeug.exceptions import HTTPException

from app.extensions import db
from app.models.parametre_projet import ParametreProjet
from app.models.switchgrid import SwitchgridConsent, SwitchgridOrder, SwitchgridRequest
from app.services.switchgrid import get_switchgrid_client
from app.services.switchgrid.asks import create_ask, get_ask
from app.services.switchgrid.contracts import search_contract
from app.services.switchgrid.donnees_brutes import charger_json_compact, preparer_pour_stockage
from app.services.switchgrid.exceptions import SwitchgridError
from app.services.switchgrid.orders import create_order, get_order
from app.services.switchgrid.quota import (
    QuotaSwitchgridAtteint,
    check_trial_quota,
    quota_status,
    register_switchgrid_request,
)
from app.services.switchgrid.suivi import (
    STATUTS_CONSENT_REFUSES,
    STATUTS_ORDER_TERMINAUX,
    creer_order_pour_consent,
    order_du_consent,
    rafraichir_order,
    synchroniser_consent,
)

# NOTE AUTHENTIFICATION : ces routes n'ont pas besoin d'un @login_required local — le middleware
# SSO global (app/middleware/auth_middleware.py: SSOAuth.check_auth, avant_request sur toute
# l'application) bloque déjà toute requête sans session valide sur ce préfixe /api/switchgrid
# (seuls /static, /health, /webhooks/switchgrid/... et le blueprint switchgrid_webhooks sont
# publics). g.user est donc garanti déjà peuplé ici par ce middleware.
# from app.middleware.auth import login_required  # à adapter à votre projet

switchgrid_bp = Blueprint("switchgrid", __name__, url_prefix="/api/switchgrid")


def _verify_project_ownership(project_id):
    """
    Vérifie que project_id appartient bien à l'utilisateur actuellement connecté.
    Sans ce contrôle, un utilisateur authentifié pouvait soumettre le project_id de
    n'importe quel autre projet (mélange de courbes de charge entre utilisateurs/projets).
    Retourne le ParametreProjet si l'appartenance est confirmée, sinon None.
    """
    user = getattr(g, "user", None)
    if not user or not user.get("id"):
        return None
    if user.get("is_admin"):
        return ParametreProjet.query.filter_by(id=project_id).first()
    return ParametreProjet.query.filter_by(id=project_id, created_by=user["id"]).first()


def _verify_consent_ownership(consent) -> bool:
    """
    Vérifie que le projet rattaché à ce consentement appartient à l'utilisateur courant. À appeler
    sur toute route qui lit/modifie un SwitchgridConsent existant à partir d'un consent_id fourni
    par le client (sinon un utilisateur authentifié connaissant/devinant un consent_id d'un tiers
    pourrait accéder à son statut de consentement ou déclencher une commande en son nom).
    """
    return _verify_project_ownership(consent.project_id) is not None


def _verify_order_ownership(order) -> bool:
    """Idem _verify_consent_ownership, pour un SwitchgridOrder (accès aux données de consommation)."""
    return _verify_project_ownership(order.project_id) is not None


@switchgrid_bp.errorhandler(SwitchgridError)
def handle_switchgrid_error(err: SwitchgridError):
    """
    Traduction centralisée des erreurs Switchgrid en réponses HTTP propres.
    Ne jamais renvoyer err.payload brut au frontend (peut contenir des
    détails internes Switchgrid) : on logge le détail côté serveur et on
    renvoie un message générique + un code adapté.
    """
    from flask import current_app

    current_app.logger.error("Erreur Switchgrid: %s", err, exc_info=True)
    status_map = {
        "SwitchgridValidationError": 400,
        "SwitchgridAuthError": 502,  # erreur de notre côté (clé), pas celle du client final
        "SwitchgridNotFoundError": 404,
        "SwitchgridRateLimitError": 503,
        "SwitchgridTimeoutError": 504,
        "SwitchgridDataNotReadyError": 202,  # pas une erreur : pas encore prêt
    }
    http_status = status_map.get(type(err).__name__, 502)
    return jsonify({"error": err.message}), http_status


def _stocker_raw_dataset(req, raw) -> None:
    """
    Met en cache la donnée brute téléchargée pour une request. Un échec d'écriture (MySQL : paquet
    trop gros, JSON refusé…) ne doit ni perdre la donnée déjà téléchargée pour la réponse en cours,
    ni laisser la session en échec (sinon PendingRollbackError à la lecture suivante -> 500).
    """
    from app.models.switchgrid import SwitchgridRawDataset

    request_id, request_type, prm = req.id, req.request_type, req.prm
    try:
        db.session.add(SwitchgridRawDataset(request_id=request_id, content_json=preparer_pour_stockage(raw)))
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception(
            "Mise en cache impossible de la donnée %s du PRM %s (request %s) : servie sans cache.",
            request_type, prm, request_id,
        )


def _erreur_lecture_order(vue):
    """
    Routes de lecture des données d'un order (export, courbes préparées) : toute exception non
    prévue passait par le gestionnaire global (« Une erreur inattendue s'est produite ») sans
    aucun indice côté utilisateur, et la session SQLAlchemy restait en échec. Ici : rollback,
    trace complète journalisée avec l'order, et le type d'erreur renvoyé (1re ligne seulement,
    tronquée — jamais la requête SQL ni les octets de la donnée brute).
    """
    @wraps(vue)
    def enveloppe(order_id, *args, **kwargs):
        try:
            return vue(order_id, *args, **kwargs)
        except (HTTPException, SwitchgridError):
            raise
        except Exception as e:
            db.session.rollback()
            current_app.logger.exception("Erreur inattendue sur %s pour l'order %s", request.path, order_id)
            resume = (str(e).splitlines() or [""])[0][:200]
            return jsonify({
                "error": f"Erreur lors de la lecture des données Enedis ({type(e).__name__}) : {resume}"
            }), 500
    return enveloppe


@switchgrid_bp.route("/contracts/search", methods=["POST"])
# @login_required
def route_search_contract():
    """
    Body attendu: {"name": "...", "address": "...", "prm": "..." (un des deux)}
    """
    payload = request.get_json(force=True) or {}
    client = get_switchgrid_client()
    results = search_contract(
        client,
        name=payload.get("name", ""),
        address=payload.get("address"),
        prm=payload.get("prm"),
    )
    return jsonify({"results": results})


@switchgrid_bp.route("/consents", methods=["POST"])
# @login_required
def route_create_consent():
    """
    Crée un Ask Switchgrid et persiste le consentement en base.

    Body attendu:
    {
      "project_id": 123,
      "contracts": ["<uuid-search_contract>"],
      "signer_first_name": "Jean",
      "signer_last_name": "Dupont",
      "redirect_to": "https://monapp.fr/dimensionnement/123/confirmation"
    }
    """
    payload = request.get_json(force=True) or {}
    project_id = payload.get("project_id")
    contracts = payload.get("contracts")
    if not project_id or not contracts:
        return jsonify({"error": "project_id et contracts sont requis."}), 400

    if not _verify_project_ownership(project_id):
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas accès."}), 403

    # Cf. route_workflow_initiate : seules les requêtes effectuées comptent ; le quota est revérifié
    # à la création de l'order (suivi.creer_order_pour_consent).
    quota_ok, quota_message = check_trial_quota(g.user)
    if not quota_ok:
        return jsonify({"error": quota_message, "quota_exceeded": True}), 403

    sg_client = get_switchgrid_client()
    ask_response = create_ask(
        sg_client,
        contracts=contracts,
        signer_first_name=payload.get("signer_first_name", ""),
        signer_last_name=payload.get("signer_last_name", ""),
        redirect_to=payload.get("redirect_to"),
    )

    consent = SwitchgridConsent(
        project_id=project_id,
        user_id=g.user["id"],
        switchgrid_ask_id=ask_response["id"],
        status=ask_response.get("status", "PENDING_USER_ACTION"),
        signature_url=ask_response.get("consentCollectionDetails", {}).get("userUrl"),
    )
    db.session.add(consent)
    db.session.commit()

    return jsonify(
        {
            "consent_id": consent.id,
            "switchgrid_ask_id": consent.switchgrid_ask_id,
            "status": consent.status,
            "signature_url": consent.signature_url,
        }
    ), 201


@switchgrid_bp.route("/consents/<consent_id>", methods=["GET"])
# @login_required
def route_get_consent_status(consent_id: str):
    """
    Vérifie le statut d'un consentement. Source de vérité = appel direct à
    Switchgrid (pas seulement la base, qui peut être en retard si le webhook
    n'est pas encore arrivé) ; on met à jour la base au passage.
    """
    consent = SwitchgridConsent.query.get_or_404(consent_id)
    if not _verify_consent_ownership(consent):
        return jsonify({"error": "Consentement introuvable ou vous n'y avez pas accès."}), 403

    sg_client = get_switchgrid_client()
    ask_data = get_ask(sg_client, consent.switchgrid_ask_id)

    consent.status = ask_data.get("status", consent.status)
    if consent.status == "ACCEPTED" and not consent.signed_at:
        consent.signed_at = utc_maintenant()
    db.session.commit()

    return jsonify({"consent_id": consent.id, "status": consent.status})


@switchgrid_bp.route("/orders", methods=["POST"])
# @login_required
def route_create_order():
    """
    Crée une commande C68 + R63 pour un consentement signé.

    Body attendu:
    {
      "consent_id": "...",
      "prms": ["00045855908792"],
      "r63_since": "2024-06-01",   (optionnel)
      "r63_until": "2024-12-01"    (optionnel)
    }
    """
    payload = request.get_json(force=True) or {}
    consent_id = payload.get("consent_id")
    prms = payload.get("prms")
    if not consent_id or not prms:
        return jsonify({"error": "consent_id et prms sont requis."}), 400

    consent = SwitchgridConsent.query.get_or_404(consent_id)
    if not _verify_consent_ownership(consent):
        return jsonify({"error": "Consentement introuvable ou vous n'y avez pas accès."}), 403
    if consent.status != "ACCEPTED":
        return jsonify({"error": "Le consentement n'est pas encore signé (ACCEPTED)."}), 409

    # Quota d'essai : une commande C68+R63 EST la requête de courbe de charge Enedis à limiter
    # pendant l'essai (cf. app/services/switchgrid/quota.py) — vérifié avant l'appel Switchgrid pour
    # ne rien facturer si le quota est déjà épuisé.
    quota_ok, quota_message = check_trial_quota(g.user)
    if not quota_ok:
        return jsonify({"error": quota_message, "quota_exceeded": True}), 403

    sg_client = get_switchgrid_client()
    order_response = create_order(
        sg_client,
        prms=prms,
        r63_since=payload.get("r63_since"),
        r63_until=payload.get("r63_until"),
    )

    order = SwitchgridOrder(
        consent_id=consent.id,
        project_id=consent.project_id,
        user_id=g.user["id"],
        switchgrid_order_id=order_response["id"],
        status=order_response.get("status", "CREATED"),
    )
    db.session.add(order)
    db.session.flush()   # ← force l'INSERT en base → order.id est maintenant défini

    for req in order_response.get("requests", []):
        for prm in prms:
            db.session.add(SwitchgridRequest(
                order_id=order.id,   # ← contient maintenant le vrai UUID
                request_type=req["type"],
                prm=prm,
                status=req.get("status", "NOT_STARTED"),
                ordered_at=_parse_dt(req.get("orderedAt")),
            ))
    db.session.commit()

    # Compte cette requête dans le quota d'essai UNIQUEMENT après succès (cf. docstring
    # check_trial_quota) — un échec de create_order() ne consomme pas le quota de l'utilisateur.
    register_switchgrid_request(g.user["id"])

    return jsonify(
        {"order_id": order.id, "switchgrid_order_id": order.switchgrid_order_id, "status": order.status}
    ), 201


@switchgrid_bp.route("/orders/<order_id>", methods=["GET"])
# @login_required
def route_get_order_status(order_id: str):
    """Statut détaillé d'une commande (utilisé en polling de secours par le frontend)."""
    order = SwitchgridOrder.query.get_or_404(order_id)
    if not _verify_order_ownership(order):
        return jsonify({"error": "Commande introuvable ou vous n'y avez pas accès."}), 403

    sg_client = get_switchgrid_client()
    order_data = get_order(sg_client, order.switchgrid_order_id)

    order.status = order_data.get("status", order.status)
    db.session.commit()

    return jsonify(
        {
            "order_id": order.id,
            "status": order.status,
            "requests": order_data.get("requests", []),
        }
    )


@switchgrid_bp.route("/orders/latest", methods=["GET"])
def route_get_latest_order_for_project():
    """
    Retrouve le dernier order Switchgrid connu pour un projet directement en base — permet au
    frontend de récupérer l'order_id de façon fiable (même sur un autre navigateur/machine, ou après
    un vidage de cache) plutôt que de dépendre uniquement de localStorage.solarProjectData.switchgrid
    .lastOrderId (cf. switchgrid_data.js).

    Query param : project_id (obligatoire).
    """
    project_id = request.args.get("project_id", type=int)
    if not project_id:
        return jsonify({"error": "project_id est requis."}), 400
    if not _verify_project_ownership(project_id):
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas accès."}), 403

    order = (
        SwitchgridOrder.query
        .filter_by(project_id=project_id)
        .order_by(SwitchgridOrder.created_at.desc())
        .first()
    )
    if not order:
        return jsonify({"order_id": None}), 200

    return jsonify({
        "order_id": order.id,
        "switchgrid_order_id": order.switchgrid_order_id,
        "status": order.status,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }), 200


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


# ================================================================== #
# Route d'export des données stockées (JSON propre pour le frontend)  #
# ================================================================== #

@switchgrid_bp.route("/orders/<order_id>/export", methods=["GET"])
@_erreur_lecture_order
def route_export_order_data(order_id: str):
    import uuid
    from app.models.switchgrid import SwitchgridRawDataset
    from app.services.switchgrid.mapping import map_c68_to_contrat, map_r63_json_to_courbe
    from app.services.switchgrid.orders import get_order, download_request_data
    from app.services.switchgrid.exceptions import (
        SwitchgridError, SwitchgridDataNotReadyError,
        SwitchgridNotFoundError, SwitchgridAuthError
    )

    # 1. Vérifier que l'ID est un UUID valide
    try:
        uuid.UUID(order_id)
    except ValueError:
        return jsonify({"error": "L'identifiant fourni n'est pas un UUID valide."}), 400

    # 2. Récupérer l'ordre en base
    order = SwitchgridOrder.query.get_or_404(order_id)
    if not _verify_order_ownership(order):
        return jsonify({"error": "Commande introuvable ou vous n'y avez pas accès."}), 403

    # 3. Vérifier le statut terminal
    STATUTS_TERMINAUX = STATUTS_ORDER_TERMINAUX
    # Statut relu chez Switchgrid avant de répondre « pas prêt » : sans ça, un order dont le webhook
    # n'est pas arrivé (local, URL non configurée, webhook perdu) restait bloqué indéfiniment une
    # fois le navigateur fermé (seul son polling rafraîchissait le statut).
    if order.status not in STATUTS_TERMINAUX:
        try:
            rafraichir_order(get_switchgrid_client(), order)
        except SwitchgridError as e:
            current_app.logger.warning("Rafraîchissement du statut de l'order %s impossible : %s", order.id, e)
    if order.status not in STATUTS_TERMINAUX:
        return jsonify({
            "error": f"Les données ne sont pas encore disponibles. Statut actuel : {order.status}.",
            "status": order.status
        }), 202

    result = {"order_id": order.id, "c68": {}, "r63": {}, "prms": []}
    errors = []

    # 4. Récupérer le payload Switchgrid — UNIQUEMENT si au moins une requête n'a pas encore de
    # donnée brute en base (cf. SwitchgridRawDataset persisté par le webhook ou un appel précédent
    # à cette route). Si tout est déjà en base, on sert la donnée locale sans aucun appel API externe.
    all_requests = order.requests.all()
    needs_switchgrid_call = any(req.raw_dataset is None for req in all_requests)

    sg_client = None
    sg_order_data = None
    if needs_switchgrid_call:
        sg_client = get_switchgrid_client()
        try:
            sg_order_data = get_order(sg_client, order.switchgrid_order_id)
        except SwitchgridError as e:
            current_app.logger.error(f"Erreur Switchgrid lors du get_order : {e}")
            return jsonify({"error": f"Impossible de contacter Switchgrid : {e.message}"}), 502
    else:
        current_app.logger.info(
            "Order %s : toutes les données (C68/R63) sont déjà en base — aucun appel à l'API "
            "Switchgrid.", order_id
        )

    # 5. Parcourir les requêtes associées. Multi-PRM (ACC) : une request Switchgrid par type couvre
    # tous les PRM -> un seul téléchargement par type, réutilisé pour chaque PRM (cache ci-dessous).
    raw_par_type = {}
    courbes_r63 = {}
    for req in all_requests:
        prm = req.prm
        result["prms"].append(prm)

        # Essayer de récupérer les données brutes
        raw = None
        if req.raw_dataset is not None:
            raw = req.raw_dataset.content_json
        else:
            # Tenter de télécharger depuis Switchgrid
            try:
                if req.request_type not in raw_par_type:
                    raw_par_type[req.request_type] = charger_json_compact(
                        download_request_data(sg_client, sg_order_data, req.request_type)
                    )
                raw = raw_par_type[req.request_type]
            except SwitchgridDataNotReadyError:
                errors.append(f"PRM {prm} - {req.request_type} : données pas encore prêtes.")
                continue
            except SwitchgridError as e:
                errors.append(f"PRM {prm} - {req.request_type} : erreur Switchgrid - {e.message}")
                current_app.logger.warning(f"Erreur téléchargement {req.request_type} pour {prm} : {e}")
                continue
            except Exception as e:
                errors.append(f"PRM {prm} - {req.request_type} : erreur inattendue - {type(e).__name__}")
                current_app.logger.exception(f"Erreur inattendue pour {req.request_type} {prm}")
                continue
            # Stocker pour les prochains appels (un échec n'empêche pas de servir la donnée)
            _stocker_raw_dataset(req, raw)

        # 6. Mapping des données
        if req.request_type == "C68":
            try:
                contrat = map_c68_to_contrat(prm, raw)
                result["c68"][prm] = {
                    # ── Identifiant ──────────────────────────────────────
                    "prm": contrat.prm,
 
                    # ── Contrat / Tarif ──────────────────────────────────
                    "puissance_souscrite_kva": contrat.puissance_souscrite_kva,
                    "puissance_raccordement_kva": contrat.puissance_raccordement_kva,
                    "option_tarifaire_code": contrat.option_tarifaire_code,
                    "option_tarifaire_libelle": contrat.option_tarifaire_libelle,
                    "calendrier_tarifaire_code": contrat.calendrier_tarifaire_code,
                    "calendrier_tarifaire_libelle": contrat.calendrier_tarifaire_libelle,
                    "a_heures_creuses": contrat.a_heures_creuses,
                    "horaires_hp": contrat.horaires_hp,
                    "horaires_hc": contrat.horaires_hc,
                    "plages_heures_creuses": contrat.plages_heures_creuses,
 
                    # ── Comptage ─────────────────────────────────────────
                    "type_comptage_code": contrat.type_comptage_code,
                    "type_comptage_libelle": contrat.type_comptage_libelle,
                    "matricule_compteur": contrat.matricule_compteur,
 
                    # ── Alimentation ─────────────────────────────────────
                    "domaine_tension_code": contrat.domaine_tension_code,
                    "domaine_tension_libelle": contrat.domaine_tension_libelle,
                    "tension_livraison": contrat.tension_livraison,
 
                    # ── Données générales ─────────────────────────────────
                    "segment_client_code": contrat.segment_client_code,
                    "niveau_ouverture_services": contrat.niveau_ouverture_services,
 
                    # ── Adresse d'installation ────────────────────────────
                    "adresse_rue": contrat.adresse_rue,
                    "adresse_code_postal": contrat.adresse_code_postal,
                    "adresse_commune": contrat.adresse_commune,
                    "adresse_code_commune": contrat.adresse_code_commune,
                }
            except Exception as e:
                current_app.logger.warning("Erreur mapping C68 pour PRM %s : %s", prm, e)
                result["c68"][prm] = {"raw": raw, "mapping_error": str(e)}

        


        elif req.request_type == "R63":
            try:
                # ✅ Passage direct à map_r63_json_to_courbe
                # Le mapper détecte automatiquement le format (mesures, liste, ou normalisé)
                courbe = map_r63_json_to_courbe(prm, raw)

                if not courbe.points:
                    # Points vides : Enedis n'a pas encore fourni les données
                    # (cas normal après activation de la collecte — un nouveau webhook arrivera)
                    result["r63"][prm] = []
                    current_app.logger.info(
                        "R63 PRM %s : structure reçue mais points vides "
                        "(Enedis en cours d'activation — les données arriveront via webhook).",
                        prm
                    )
                else:
                    # Points écrits en flux à la fin (cf. _flux_json_export) : une R63 5 min
                    # pluriannuelle = ~600 000 dict en mémoire sinon (conteneur tué, 503).
                    courbes_r63[prm] = courbe
                    result["r63"][prm] = None

            except Exception as e:
                current_app.logger.warning(
                    "Erreur mapping R63 PRM %s : %s", prm, e, exc_info=True
                )
                result["r63"][prm] = {"mapping_error": str(e)}

    result["prms"] = list(set(result["prms"]))
    result["errors"] = errors

    # Si aucune donnée n'a été récupérée, renvoyer une erreur 202 avec explication
    if not result["c68"] and not result["r63"]:
        if errors:
            return jsonify({
                "error": "Aucune donnée n'a pu être récupérée. Détails : " + " ; ".join(errors),
                "errors": errors,
                "status": order.status
            }), 202
        else:
            return jsonify({
                "error": "Aucune donnée disponible pour cet order.",
                "status": order.status
            }), 202

    # ⚠️ IMPORTANT : ce return final garantit une réponse
    if not courbes_r63:
        return jsonify(result), 200
    return Response(_flux_json_export(result, courbes_r63), status=200, mimetype="application/json")


def _horodatages_utc_entiers(points) -> bool:
    """Vrai si tous les points sont en UTC à la seconde près (reconstruits à l'identique côté JS)."""
    for p in points:
        h = p.horodatage
        if h.tzinfo is None or h.utcoffset().total_seconds() != 0 or h.microsecond:
            return False
    return True


def _flux_json_export(result: dict, courbes_r63: dict):
    """
    Corps JSON de route_export_order_data, produit par blocs (jamais la liste complète des points
    ni son texte en mémoire).

    Courbe R63 en colonnes : {"format": "colonnes-v1", "pas_s", "t0" (epoch s du 1er point),
    "dt" (écart en s avec le point précédent, 0 pour le 1er), "w" (puissances W)}. Le format
    point par point ({"horodatage", "puissance_w", "energie_kwh"}) pesait ~56 Mo pour une R63
    5 min pluriannuelle : Cloud Run tronque toute réponse à 32 Mio (« Unterminated string in
    JSON » côté navigateur). switchgrid_data.js::_sgDeplierR63 reconstruit les mêmes objets.
    Repli point par point si les horodatages ne sont pas en UTC à la seconde (formats non Enedis).
    """
    import json

    reste = json.dumps({k: v for k, v in result.items() if k != "r63"})
    yield reste[:-1] + ', "r63": {'
    for i, (prm, valeur) in enumerate(result["r63"].items()):
        yield ("" if i == 0 else ", ") + json.dumps(prm) + ": "
        courbe = courbes_r63.get(prm)
        if courbe is None:
            yield json.dumps(valeur)
            continue
        points = courbe.points
        if _horodatages_utc_entiers(points):
            yield (f'{{"format": "colonnes-v1", "pas_s": {int(courbe.pas_de_temps_secondes)}, '
                   f'"t0": {int(points[0].horodatage.timestamp())}, "dt": [')
            precedent = points[0].horodatage
            for debut in range(0, len(points), 20000):
                bloc = points[debut:debut + 20000]
                ecarts = []
                for p in bloc:
                    ecarts.append(str(int((p.horodatage - precedent).total_seconds())))
                    precedent = p.horodatage
                yield ("" if debut == 0 else ",") + ",".join(ecarts)
            yield '], "w": ['
            for debut in range(0, len(points), 20000):
                yield ("" if debut == 0 else ",") + ",".join(
                    json.dumps(p.puissance_w) for p in points[debut:debut + 20000]
                )
            yield "]}"
            continue
        pas_h = courbe.pas_de_temps_secondes / 3600.0
        yield "["
        for debut in range(0, len(points), 5000):
            yield ("" if debut == 0 else ", ") + ", ".join(
                json.dumps({
                    "horodatage": p.horodatage.isoformat(),
                    "puissance_w": p.puissance_w,
                    "energie_kwh": round(p.puissance_w / 1000.0 * pas_h, 6),
                })
                for p in points[debut:debut + 5000]
            )
        yield "]"
    yield "}}"


# ================================================================== #
# Route de préparation : nettoyage/enrichissement des courbes R63    #
# (additive — ne modifie ni n'appelle route_export_order_data)       #
# ================================================================== #

@switchgrid_bp.route("/orders/<order_id>/courbes-preparees", methods=["GET"])
@_erreur_lecture_order
def route_courbes_preparees(order_id: str):
    """
    Récupère les données brutes d'un order (comme route_export_order_data, mais en
    autonome pour ne rien modifier de la route existante) puis les passe au pipeline
    de nettoyage/enrichissement (app.models.calcul_prodsolaire.calcul_courbe_enedis)
    pour produire, par année disponible (+ une courbe "moyenne" si plusieurs années),
    une courbe standardisée exploitable directement par le calcul d'autoconsommation.

    Query param optionnel : time_step (60|30|15, défaut : pas de réception natif des
    données si celui-ci vaut 60, 30 ou 15, sinon 30).

    Query param optionnel : prm (PDL à 14 chiffres). Sans lui, le premier PRM disposant d'un
    R63 exploitable est traité (cas ACI mono-PRM, comportement historique). En ACC (order
    multi-PRM), le frontend visualise les courbes une par une en passant `prm` ; la réponse
    liste toujours `prms_disponibles` pour construire le sélecteur de participants.
    """
    import uuid

    try:
        uuid.UUID(order_id)
    except ValueError:
        return jsonify({"error": "L'identifiant fourni n'est pas un UUID valide."}), 400

    time_step_minutes, prm_demande, erreur = _parametres_courbes_preparees()
    if erreur:
        return jsonify({"error": erreur}), 400

    order = SwitchgridOrder.query.get_or_404(order_id)
    if not _verify_order_ownership(order):
        return jsonify({"error": "Commande introuvable ou vous n'y avez pas accès."}), 403

    corps, http_status = _courbes_preparees_order(order, prm_demande, time_step_minutes)
    return jsonify(corps), http_status


def _parametres_courbes_preparees():
    """Lit et valide time_step / prm (cf. route_courbes_preparees). Retourne (time_step, prm, erreur)."""
    time_step_param = request.args.get("time_step")
    time_step_minutes = None
    if time_step_param is not None:
        try:
            time_step_minutes = int(time_step_param)
        except (TypeError, ValueError):
            time_step_minutes = -1
        if time_step_minutes not in (60, 30, 15, 10):
            return None, None, "time_step doit être 60, 30, 15 ou 10."
    prm_demande = (request.args.get("prm") or "").strip() or None
    if prm_demande is not None and (len(prm_demande) != 14 or not prm_demande.isdigit()):
        return None, None, "prm doit être un PDL de 14 chiffres."
    return time_step_minutes, prm_demande, None


def _courbes_preparees_order(order, prm_demande, time_step_minutes):
    """
    Cœur de route_courbes_preparees pour un order dont l'accès a déjà été vérifié — partagé avec la
    vue projet ACC (route_courbes_preparees_projet). Retourne (corps JSON, statut HTTP).
    """
    from app.models.calcul_prodsolaire import calcul_courbe_enedis
    from app.services.switchgrid.mapping import map_c68_to_contrat, map_r63_json_to_courbe
    from app.services.switchgrid.orders import get_order, download_request_data
    from app.services.switchgrid.exceptions import SwitchgridError, SwitchgridDataNotReadyError

    order_id = order.id
    STATUTS_TERMINAUX = STATUTS_ORDER_TERMINAUX
    # Statut relu chez Switchgrid avant de répondre « pas prêt » : sans ça, un order dont le webhook
    # n'est pas arrivé (local, URL non configurée, webhook perdu) restait bloqué indéfiniment une
    # fois le navigateur fermé (seul son polling rafraîchissait le statut).
    if order.status not in STATUTS_TERMINAUX:
        try:
            rafraichir_order(get_switchgrid_client(), order)
        except SwitchgridError as e:
            current_app.logger.warning("Rafraîchissement du statut de l'order %s impossible : %s", order.id, e)
    if order.status not in STATUTS_TERMINAUX:
        return ({
            "error": f"Les données ne sont pas encore disponibles. Statut actuel : {order.status}.",
            "status": order.status
        }), 202

    # Récupération brute par PRM (indépendante de route_export_order_data). Appel à l'API Switchgrid
    # UNIQUEMENT si au moins une requête n'a pas encore de donnée brute en base — mêmes principes que
    # route_export_order_data (éviter un appel API redondant quand tout est déjà persisté).
    all_requests = order.requests.all()
    needs_switchgrid_call = any(req.raw_dataset is None for req in all_requests)

    sg_client = None
    sg_order_data = None
    if needs_switchgrid_call:
        sg_client = get_switchgrid_client()
        try:
            sg_order_data = get_order(sg_client, order.switchgrid_order_id)
        except SwitchgridError as e:
            current_app.logger.error(f"Erreur Switchgrid lors du get_order : {e}")
            return ({"error": f"Impossible de contacter Switchgrid : {e.message}"}), 502
    else:
        current_app.logger.info(
            "Order %s : toutes les données (C68/R63) sont déjà en base — aucun appel à l'API "
            "Switchgrid.", order_id
        )

    raw_par_prm = {}
    raw_par_type = {}  # un téléchargement par type, partagé entre PRM (cf. route_export_order_data)
    for req in all_requests:
        raw = None
        if req.raw_dataset is not None:
            raw = req.raw_dataset.content_json
        else:
            try:
                if req.request_type not in raw_par_type:
                    raw_par_type[req.request_type] = charger_json_compact(
                        download_request_data(sg_client, sg_order_data, req.request_type)
                    )
                raw = raw_par_type[req.request_type]
            except SwitchgridDataNotReadyError:
                continue
            except SwitchgridError as e:
                current_app.logger.warning(f"Erreur téléchargement {req.request_type} pour {req.prm} : {e}")
                continue
            except Exception:
                current_app.logger.exception(f"Erreur inattendue pour {req.request_type} {req.prm}")
                continue
            _stocker_raw_dataset(req, raw)
        raw_par_prm.setdefault(req.prm, {})[req.request_type] = raw

    # PRM exploitables = ceux disposant d'un R63 (le C68 n'apporte que l'en-tête contrat et le
    # segment client : un C68 manquant/en échec pour UN participant ne doit pas rendre sa courbe
    # inaccessible en ACC). Ordre stable = ordre de saisie des PDL (ordre des requests en base).
    prms_ordre = []
    for req in all_requests:
        if req.prm not in prms_ordre:
            prms_ordre.append(req.prm)
    prms_disponibles = [
        {"prm": prm, "has_c68": raw_par_prm.get(prm, {}).get("C68") is not None}
        for prm in prms_ordre
        if raw_par_prm.get(prm, {}).get("R63") is not None
    ]

    if not prms_disponibles:
        return ({
            "error": "Aucun PRM de cet order ne dispose d'une courbe de charge (R63) exploitable.",
            "status": order.status
        }), 202

    if prm_demande is not None:
        if prm_demande not in [p["prm"] for p in prms_disponibles]:
            return ({
                "error": f"Aucune courbe de charge exploitable pour le PRM {prm_demande} dans cet order.",
                "prms_disponibles": prms_disponibles,
            }), 404
        prm_choisi = prm_demande
    else:
        # Historique ACI : premier PRM complet (C68 + R63), sinon premier PRM avec un R63.
        prm_choisi = next((p["prm"] for p in prms_disponibles if p["has_c68"]), prms_disponibles[0]["prm"])

    c68_raw = raw_par_prm[prm_choisi].get("C68")
    try:
        contrat = map_c68_to_contrat(prm_choisi, c68_raw if c68_raw is not None else {})
    except Exception as e:
        current_app.logger.warning("Erreur mapping C68 pour PRM %s : %s", prm_choisi, e)
        return ({"error": f"Erreur de lecture des données contractuelles (C68) : {e}"}), 500

    try:
        courbe = map_r63_json_to_courbe(prm_choisi, raw_par_prm[prm_choisi]["R63"])
    except Exception as e:
        current_app.logger.warning("Erreur mapping R63 pour PRM %s : %s", prm_choisi, e)
        return ({"error": f"Erreur de lecture de la courbe de charge (R63) : {e}"}), 500

    if not courbe.points:
        return ({
            "error": "La courbe R63 pour ce PRM est vide (Enedis en cours d'activation).",
            "status": order.status,
            "prm": prm_choisi,
            "prms_disponibles": prms_disponibles,
        }), 202

    pas_natif_minutes = calcul_courbe_enedis.detecter_pas_natif_minutes(courbe)
    if time_step_minutes is None:
        # Par défaut : le pas auquel les données ont été reçues (30 min si indétectable ou
        # hors des granularités proposées), plutôt qu'un pas fixe sans rapport avec la donnée.
        time_step_minutes = pas_natif_minutes if pas_natif_minutes in (60, 30, 15, 10) else 30

    resultat = calcul_courbe_enedis.preparer_courbes(
        courbe, contrat.segment_client_code, time_step_minutes
    )

    return ({
        "order_id": order.id,
        "prm": prm_choisi,
        "prms_disponibles": prms_disponibles,
        "time_step_minutes": time_step_minutes,
        "pas_natif_minutes": pas_natif_minutes,
        "contrat_header": {
            "prm": contrat.prm,
            "puissance_souscrite_kva": contrat.puissance_souscrite_kva,
            "puissance_raccordement_kva": contrat.puissance_raccordement_kva,
            "segment_client_code": contrat.segment_client_code,
        },
        **resultat,
    }), 200


def _prms_disponibles_projet(project_id: int):
    """
    ACC à demandes successives (un consentement, donc un order, par participant) : PRM disposant
    d'une courbe R63 sur l'ensemble des orders terminés du projet, dans l'ordre d'ajout des
    participants. Un PRM redemandé est servi par son order le plus récent. Aucune donnée brute n'est
    chargée ici (seulement l'existence du cache) : une R63 manquante/vide pour un PRM est signalée
    par _courbes_preparees_order au moment de sa visualisation, sans bloquer les autres.
    Retourne [{"prm", "has_c68", "order_id"}].
    """
    from app.models.switchgrid import SwitchgridRawDataset

    lignes = (
        db.session.query(
            SwitchgridRequest.prm, SwitchgridRequest.request_type, SwitchgridRequest.status,
            SwitchgridRawDataset.id, SwitchgridOrder.id,
        )
        .join(SwitchgridOrder, SwitchgridRequest.order_id == SwitchgridOrder.id)
        .outerjoin(SwitchgridRawDataset, SwitchgridRawDataset.request_id == SwitchgridRequest.id)
        .filter(
            SwitchgridOrder.project_id == project_id,
            SwitchgridOrder.status.in_(STATUTS_ORDER_TERMINAUX),
        )
        .order_by(SwitchgridOrder.created_at.asc())
        .all()
    )
    # (order, prm) -> types exploitables (cache présent, ou request pas en échec : téléchargée à la demande)
    types_par_order_prm = {}
    for prm, type_req, statut, raw_id, order_id in lignes:
        types = types_par_order_prm.setdefault((order_id, prm), set())
        if raw_id is not None or statut != "FAILED":
            types.add(type_req)

    par_prm = {}  # insertion = ordre d'ajout ; un order plus récent remplace l'entrée d'un PRM
    for (order_id, prm), types in types_par_order_prm.items():
        if "R63" in types:
            par_prm[prm] = {"prm": prm, "has_c68": "C68" in types, "order_id": order_id}
    return list(par_prm.values())


@switchgrid_bp.route("/projects/<int:project_id>/courbes-preparees", methods=["GET"])
def route_courbes_preparees_projet(project_id: int):
    """
    Vue ACC « en ensemble » : comme /orders/<id>/courbes-preparees, mais sur TOUS les orders du
    projet (chaque participant a pu signer son propre consentement, cf. switchgrid_workflow.js).
    `prms_disponibles` liste les courbes de tous les participants (avec l'order_id qui porte chacune)
    pour que l'utilisateur choisisse celles à retenir pour le calcul ; `prm` désigne la courbe affichée
    (défaut : la première). Mêmes query params que la route par order.
    """
    if not _verify_project_ownership(project_id):
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas accès."}), 403

    time_step_minutes, prm_demande, erreur = _parametres_courbes_preparees()
    if erreur:
        return jsonify({"error": erreur}), 400

    # Orders dont le webhook n'est pas arrivé : statut relu chez Switchgrid (cf. route par order).
    en_cours = SwitchgridOrder.query.filter(
        SwitchgridOrder.project_id == project_id,
        ~SwitchgridOrder.status.in_(STATUTS_ORDER_TERMINAUX),
    ).all()
    if en_cours:
        try:
            sg_client = get_switchgrid_client()
            for order in en_cours:
                rafraichir_order(sg_client, order)
        except SwitchgridError as e:
            current_app.logger.warning("Projet %s : rafraîchissement des orders impossible : %s", project_id, e)

    prms_disponibles = _prms_disponibles_projet(project_id)
    if not prms_disponibles:
        return jsonify({
            "error": "Aucune courbe de charge (R63) n'est encore disponible pour ce projet."
                     + (f" {len(en_cours)} demande(s) en cours de collecte." if en_cours else ""),
            "prms_disponibles": [],
        }), 202

    if prm_demande is None:
        prm_demande = prms_disponibles[0]["prm"]
    entree = next((p for p in prms_disponibles if p["prm"] == prm_demande), None)
    if entree is None:
        return jsonify({
            "error": f"Aucune courbe de charge exploitable pour le PRM {prm_demande} dans ce projet.",
            "prms_disponibles": prms_disponibles,
        }), 404

    order = SwitchgridOrder.query.get(entree["order_id"])
    try:
        corps, http_status = _courbes_preparees_order(order, prm_demande, time_step_minutes)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Courbes préparées du projet %s (PRM %s) en erreur", project_id, prm_demande)
        corps = {"error": f"Erreur lors de la lecture des données Enedis ({type(e).__name__}) : "
                          + (str(e).splitlines() or [""])[0][:200]}
        http_status = 500
    # Le sélecteur porte sur tout le projet, pas seulement sur l'order de la courbe affichée.
    corps["prms_disponibles"] = prms_disponibles
    corps.setdefault("prm", prm_demande)
    return jsonify(corps), http_status


# ================================================================== #
# Route 1 : Initiation (search_contract + create_ask)                #
# ================================================================== #
 
@switchgrid_bp.route("/workflow/initiate", methods=["POST"])
def route_workflow_initiate():
    """
    Étape 1 du workflow depuis l'interface.
 
    Body JSON :
    {
      "project_id": 1,
      "clients": [
        {"name": "Jean Dupont", "pdl": "14263386353506"},
        {"name": "Marie Martin", "pdl": "12345678901234"}
      ],
      "signer_first_name": "Jean",
      "signer_last_name": "Dupont"
    }
 
    Actions pour chaque client :
      1. Tente search_contract(name, pdl) → récupère l'uuid Enedis
      2. Fallback : construit un contrat manuel si non trouvé
      3. Crée UN seul Ask avec tous les contrats (1 signature pour tous)
 
    Retourne :
    {
      "consent_id": "...",
      "switchgrid_ask_id": "...",
      "signature_url": "...",
      "status": "PENDING_USER_ACTION",
      "clients_resolved": [
        {"name": "...", "pdl": "...", "contract_source": "search|manual", "contract_id": "..."}
      ]
    }
    """
    payload = request.get_json(force=True) or {}
    project_id = payload.get("project_id")
    clients = payload.get("clients", [])
    signer_first = payload.get("signer_first_name", "").strip()
    signer_last = payload.get("signer_last_name", "").strip()
 
    if not project_id:
        return jsonify({"error": "project_id est requis. Enregistrez d'abord le projet."}), 400
    if not _verify_project_ownership(project_id):
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas accès."}), 403
    if not clients:
        return jsonify({"error": "Aucun client fourni."}), 400
    if not signer_first or not signer_last:
        return jsonify({"error": "Le nom du signataire est requis."}), 400

    # Quota vérifié DÈS le lancement : un utilisateur dont le quota est déjà consommé ne fait pas
    # signer son client pour rien. Seules les requêtes effectuées (orders créés) comptent — les
    # demandes lancées mais pas encore signées ne réservent plus de place (elles bloquaient à tort
    # des utilisateurs dès leur première demande). Le quota est revérifié à la création de l'order,
    # y compris côté serveur sans session (cf. suivi.creer_order_pour_consent).
    quota_ok, quota_message = check_trial_quota(g.user)
    if not quota_ok:
        return jsonify({"error": quota_message, "quota_exceeded": True}), 403

    sg_client = get_switchgrid_client()
 
    # ── Résolution des contrats ──────────────────────────────────────────
    from app.services.switchgrid.contracts import search_contract as sg_search_contract
    from app.services.switchgrid.asks import build_electricity_contract_manual
 
    contracts_payload = []
    clients_resolved = []
 
    for client in clients:
        name = (client.get("name") or "").strip()
        pdl = (client.get("pdl") or "").strip()
 
        # Validation PDL côté backend (double sécurité)
        if not pdl or len(pdl) != 14 or not pdl.isdigit():
            return jsonify({
                "error": f"PDL invalide pour le client '{name}' : doit être 14 chiffres."
            }), 400
 
        # Tentative search_contract
        contract_source = "manual"
        contract_value = None
 
        try:
            results = sg_search_contract(sg_client, name=name, prm=pdl)
            if results:
                contract_value = results[0]["id"]
                contract_source = "search"
        except Exception as e:
            current_app.logger.info(
                "search_contract échec pour %s/%s : %s — fallback manuel", name, pdl, e
            )
 
        # Fallback : contrat manuel avec juste le PDL et le nom
        if contract_value is None:
            contract_value = build_electricity_contract_manual(
                prm=pdl,
                holder_full_name=name,
                address_rue="",
                address_code_postal="",
                address_commune="",
            )
 
        contracts_payload.append(contract_value)
        clients_resolved.append({
            "name": name,
            "pdl": pdl,
            "contract_source": contract_source,
            "contract_id": contract_value if isinstance(contract_value, str) else None,
        })
 
    # ── Création de l'Ask (un seul pour tous les clients) ────────────────
    from app.services.switchgrid.asks import create_ask
 
    ask_response = create_ask(
        sg_client,
        contracts=contracts_payload,
        signer_first_name=signer_first,
        signer_last_name=signer_last,
    )
 
    # ── Persistance en base ──────────────────────────────────────────────
    pdls = [c["pdl"] for c in clients_resolved]
 
    consent = SwitchgridConsent(
        project_id=project_id,
        user_id=g.user["id"],
        switchgrid_ask_id=ask_response["id"],
        status=ask_response.get("status", "PENDING_USER_ACTION"),
        prms=pdls,
        signature_url=ask_response.get("consentCollectionDetails", {}).get("userUrl"),
    )
    db.session.add(consent)
    db.session.commit()
 
    return jsonify({
        "consent_id": consent.id,
        "switchgrid_ask_id": consent.switchgrid_ask_id,
        "signature_url": consent.signature_url,
        "status": consent.status,
        "clients_resolved": clients_resolved,
    }), 201
 
 
# ================================================================== #
# Route 2 : Finalisation (create_order après consentement signé)      #
# ================================================================== #
 
@switchgrid_bp.route("/workflow/finalize", methods=["POST"])
def route_workflow_finalize():
    """
    Étape 2 du workflow depuis l'interface.
 
    Body JSON :
    {
      "consent_id": "uuid interne PV_project",
      "pdls": ["14263386353506", "12345678901234"]
    }
 
    Vérifie que le consentement est ACCEPTED, puis crée l'order C68 + R63.
 
    Retourne :
    {
      "order_id": "...",
      "switchgrid_order_id": "...",
      "status": "CREATED|COMPLETED",
      "pdls": [...]
    }
    """
    payload = request.get_json(force=True) or {}
    consent_id = payload.get("consent_id")
    pdls = payload.get("pdls", [])
 
    if not consent_id or not pdls:
        return jsonify({"error": "consent_id et pdls sont requis."}), 400
 
    consent = SwitchgridConsent.query.get_or_404(consent_id)
    if not _verify_consent_ownership(consent):
        return jsonify({"error": "Consentement introuvable ou vous n'y avez pas accès."}), 403

    # ── Vérification du statut (resync depuis Switchgrid) ────────────────
    sg_client = get_switchgrid_client()
    order, _cree = synchroniser_consent(sg_client, consent, creer_order=False)

    if consent.status != "ACCEPTED":
        return jsonify({
            "error": f"Le consentement n'est pas encore signé (statut : {consent.status}).",
            "status": consent.status,
        }), 409

    # Order déjà créé côté serveur (webhook ask.accepted ou reprise à l'ouverture du projet) : on
    # le renvoie tel quel, sans re-vérifier le quota (il vient d'être incrémenté par cette création).
    if order is None:
        # Quota : cf. route_create_order — vérifié avant l'appel Switchgrid.
        quota_ok, quota_message = check_trial_quota(g.user)
        if not quota_ok:
            return jsonify({"error": quota_message, "quota_exceeded": True}), 403

        # Les PDL signés (consent.prms) font foi ; ceux envoyés par le navigateur ne servent que de
        # repli pour les consentements anciens créés sans prms.
        try:
            order, _cree = creer_order_pour_consent(sg_client, consent, prms=consent.prms or pdls)
        except QuotaSwitchgridAtteint as e:
            return jsonify({"error": str(e), "quota_exceeded": True}), 403

    return jsonify({
        "order_id": order.id,
        "switchgrid_order_id": order.switchgrid_order_id,
        "status": order.status,
        "pdls": consent.prms or pdls,
    })


# ================================================================== #
# Route : reprise du suivi à l'ouverture du projet                    #
# ================================================================== #

# Au-delà, un consentement jamais signé n'est plus présenté comme « en attente » (et n'est plus
# relu chez Switchgrid à chaque ouverture du projet).
DUREE_SUIVI_CONSENTEMENT_JOURS = 30

# Garde-fou : nombre maximal de demandes (consentements / orders) relues à chaque suivi d'un projet.
MAX_DEMANDES_SUIVIES = 50


@switchgrid_bp.route("/projects/<int:project_id>/suivi", methods=["GET"])
def route_suivi_projet(project_id: int):
    """
    État de TOUTES les demandes de courbe de charge du projet (une par lien de consentement : en ACC,
    chaque participant signe son propre lien, cf. switchgrid_workflow.js), pour le suivi en direct
    et sa reprise après une fermeture de l'application ou un changement de projet. Fait au passage
    avancer chaque demande côté serveur :
      - consentement signé sans order -> l'order est créé et persisté (rattrapage si le webhook
        n'est pas arrivé) ; c'est ce qui rend l'Order ID visible sans recharger le projet ;
      - order non terminé -> statut relu chez Switchgrid.

    Retourne {"demandes": [...], "etape", "consent", "order", "message"} : `demandes` liste chaque
    demande (plus récente d'abord) avec son etape ∈ attente_signature | consentement_refuse |
    collecte_en_cours | donnees_pretes ; les autres clés décrivent la plus récente (format historique).
    """
    from datetime import timedelta

    if not _verify_project_ownership(project_id):
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas accès."}), 403

    consents = (
        SwitchgridConsent.query.filter_by(project_id=project_id)
        .order_by(SwitchgridConsent.created_at.desc()).limit(MAX_DEMANDES_SUIVIES).all()
    )
    orders = (
        SwitchgridOrder.query.filter_by(project_id=project_id)
        .order_by(SwitchgridOrder.created_at.desc()).limit(MAX_DEMANDES_SUIVIES).all()
    )
    message = None
    message_injoignable = "Impossible de joindre Switchgrid pour le moment : état affiché depuis la base."
    limite_signature = utc_maintenant() - timedelta(days=DUREE_SUIVI_CONSENTEMENT_JOURS)
    sg_client = None

    # Une demande = un consentement et, une fois signé, son order. Un consentement jamais signé
    # au-delà de DUREE_SUIVI_CONSENTEMENT_JOURS n'est plus suivi (ni relu chez Switchgrid).
    demandes = []  # [(consent|None, order|None)]
    orders_rattaches = set()
    for consent in consents:
        order = order_du_consent(consent)
        if order is None and consent.created_at < limite_signature:
            continue
        if order is not None:
            orders_rattaches.add(order.id)
        demandes.append([consent, order])
    # Orders sans consentement en base (consentement supprimé, order créé hors workflow).
    demandes += [[None, o] for o in orders if o.id not in orders_rattaches and o.consent_id is None]

    for demande in demandes:
        consent, order = demande
        try:
            if order is None and consent.status not in STATUTS_CONSENT_REFUSES:
                sg_client = sg_client or get_switchgrid_client()
                demande[1], _cree = synchroniser_consent(sg_client, consent)
            elif order is not None and order.status not in STATUTS_ORDER_TERMINAUX:
                sg_client = sg_client or get_switchgrid_client()
                rafraichir_order(sg_client, order)
        except QuotaSwitchgridAtteint as e:
            message = f"Un client a signé, mais sa demande n'a pas pu être envoyée : {e}"
        except (SwitchgridError, ValueError) as e:
            db.session.rollback()
            current_app.logger.warning("Suivi projet %s : synchro d'une demande impossible : %s", project_id, e)
            message = message or message_injoignable

    def _date(d):
        return d.isoformat() if d else None

    def _etape(consent, order):
        if order is not None:
            return "donnees_pretes" if order.status in STATUTS_ORDER_TERMINAUX else "collecte_en_cours"
        return "consentement_refuse" if consent.status in STATUTS_CONSENT_REFUSES else "attente_signature"

    def _vue_consent(consent):
        return None if consent is None else {
            "consent_id": consent.id,
            "status": consent.status,
            "signature_url": consent.signature_url,
            "prms": consent.prms or [],
            "created_at": _date(consent.created_at),
            "signed_at": _date(consent.signed_at),
        }

    def _vue_order(order):
        return None if order is None else {
            "order_id": order.id,
            "switchgrid_order_id": order.switchgrid_order_id,
            "status": order.status,
            "created_at": _date(order.created_at),
            "prms": sorted({r.prm for r in order.requests}),
        }

    vues = [{
        "etape": _etape(consent, order),
        "consent": _vue_consent(consent),
        "order": _vue_order(order),
        "prms": (consent.prms if consent is not None and consent.prms else None)
                or (_vue_order(order) or {}).get("prms", []),
    } for consent, order in demandes]
    vues.sort(key=lambda v: (v["consent"] or v["order"])["created_at"] or "", reverse=True)

    derniere = vues[0] if vues else None
    return jsonify({
        "demandes": vues,
        "message": message,
        "etape": derniere["etape"] if derniere else "aucune",
        "consent": derniere["consent"] if derniere and derniere["order"] is None else None,
        "order": derniere["order"] if derniere else None,
    }), 200


# ================================================================== #
# Route : statut du quota (permet au frontend de desactiver/masquer  #
# le bouton de lancement de facon proactive, avant meme d'entamer le #
# workflow - cf. switchgrid_workflow.js::_sgRefreshQuotaStatus)       #
# ================================================================== #

@switchgrid_bp.route("/quota-status", methods=["GET"])
def route_quota_status():
    return jsonify(quota_status(g.user))