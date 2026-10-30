"""
Loi APER : lecture / enregistrement des saisies du calculateur (polygones, % solarisables) et
« Surface projetée champ PV » calculée depuis le calepinage ENREGISTRÉ en base.

La surface projetée n'est plus reprise du localStorage (solarProjectData, calepinage_maison_v1),
souvent périmé ou issu d'un autre projet. Même principe que la puissance projet
(app/services/puissance_projet.py) :
  - lignes `Calepinage` (ancien calepinage grands projets) : recalculée ici depuis calepinage_data
    (gridInfo.totalPanelLength x totalPanelWidth x cos(inclinaison), formule historique de
    calcul_APER.js) ;
  - lignes `CalepinageMaison` (moteur unique : toitures, ombrières, sheds, dômes) :
    parametres_projet.surface_projetee_maison_m2, calculée par le moteur de calepinage pour les
    champs envoyés à chaque sauvegarde (CM.getAllPvFieldSummaries, comme puissance_maison_kwc).
"""
import json
import math
from typing import Any, Optional

from app.extensions import db
from app.models.loi_aper import (
    AperConfig, AperPolygone, LIBELLE_SOLARISABLE_APER, LIBELLE_SOLARISABLE_HUWART,
)
from app.services.puissance_projet import _nombre_positif


def valider_surface_projetee_m2(valeur: Any, nb_champs: int, surface_max_contour_m2: Optional[float]):
    """Surface projetée envoyée avec la sauvegarde du calepinage résidentiel. None si absente ;
    ValueError si non numérique, négative ou impossible (au-delà de 2 x la surface maximale d'un
    contour par champ, marge large : les panneaux ne débordent jamais autant de leur contour)."""
    if valeur is None:
        return None
    if isinstance(valeur, bool):
        raise ValueError('Surface projetée des panneaux invalide.')
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        raise ValueError('Surface projetée des panneaux invalide.')
    if not math.isfinite(v) or v < 0:
        raise ValueError('Surface projetée des panneaux invalide.')
    plafond = max(1, int(nb_champs or 0)) * 2 * float(surface_max_contour_m2 or 50000)
    if v > plafond:
        raise ValueError(f'Surface projetée des panneaux invalide ({v:.0f} m² pour {nb_champs} champ(s)).')
    return round(v, 2)


def surface_grands_projets_m2(calepinage_data: Any, pv_ids_enregistres=None) -> float:
    """Surface projetée des champs de l'ancien calepinage grands projets (calepinage_data)."""
    if not calepinage_data:
        return 0.0
    if isinstance(calepinage_data, str):
        try:
            calepinage_data = json.loads(calepinage_data)
        except (TypeError, ValueError):
            return 0.0
    if not isinstance(calepinage_data, dict):
        return 0.0
    shapes = calepinage_data.get('shapes') or {}
    form_data = calepinage_data.get('formData') or {}
    if not isinstance(shapes, dict) or not isinstance(form_data, dict):
        return 0.0

    total = 0.0
    for pv_id, valeurs in form_data.items():
        if pv_ids_enregistres is not None and pv_id not in pv_ids_enregistres:
            continue
        shape = shapes.get(pv_id)
        if not isinstance(shape, dict) or not isinstance(valeurs, dict):
            continue
        grille = shape.get('gridInfo') or {}
        longueur = _nombre_positif(grille.get('totalPanelLength')) or 0.0
        largeur = _nombre_positif(grille.get('totalPanelWidth')) or 0.0
        try:
            inclinaison = float(valeurs.get('inclinaison') or 0)
        except (TypeError, ValueError):
            inclinaison = 0.0
        if not math.isfinite(inclinaison):
            inclinaison = 0.0
        total += longueur * largeur * math.cos(math.radians(inclinaison))
    return total


def surface_projetee_champ_pv(projet) -> dict:
    """{'valeurM2': float|None, 'connue': bool} — `connue` False quand le projet a un calepinage
    résidentiel enregistré dont la surface n'a pas encore été transmise (valeur partielle ou None)."""
    from app.models import Calepinage, CalepinageMaison

    pv_ids = {row.pv_id for row in Calepinage.query.with_entities(Calepinage.pv_id)
              .filter_by(projet_id=projet.id).all()}
    total = surface_grands_projets_m2(projet.calepinage_data, pv_ids) if pv_ids else 0.0

    connue = True
    if CalepinageMaison.query.filter_by(projet_id=projet.id).first() is not None:
        if projet.surface_projetee_maison_m2 is None:
            connue = False
        else:
            total += max(0.0, float(projet.surface_projetee_maison_m2))

    if not connue and total <= 0:
        return {'valeurM2': None, 'connue': False}
    return {'valeurM2': round(total, 2), 'connue': connue}


def charger_donnees_aper(projet) -> dict:
    """Saisies APER enregistrées du projet (variante active), au format attendu par calcul_APER.js."""
    config = AperConfig.query.filter_by(projet_id=projet.id).first()
    lignes = (AperPolygone.query.filter_by(projet_id=projet.id)
              .order_by(AperPolygone.type_polygone, AperPolygone.ordre, AperPolygone.id).all())
    polygones = {'surface': [], 'exclusion': []}
    for ligne in lignes:
        if ligne.type_polygone in polygones and isinstance(ligne.coordonnees, list):
            polygones[ligne.type_polygone].append(ligne.coordonnees)
    return {
        'projetId': projet.id,
        'indiceProjet': projet.active_indice,
        'config': config.to_dict() if config else None,
        'polygones': polygones,
        'surfaceProjetee': surface_projetee_champ_pv(projet),
    }


def enregistrer_donnees_aper(projet, sauvegarde) -> None:
    """Remplace les saisies APER du projet (sans commit). `sauvegarde` : AperSauvegarde validée."""
    indice = projet.active_indice
    config = AperConfig.query.filter_by(projet_id=projet.id).first()
    if config is None:
        config = AperConfig(projet_id=projet.id)
        db.session.add(config)
    config.indice_projet = indice
    config.pourcent_solarisable_aper = sauvegarde.variables.solarisableAper.valeur
    config.libelle_solarisable_aper = sauvegarde.variables.solarisableAper.libelle or LIBELLE_SOLARISABLE_APER
    config.pourcent_solarisable_huwart = sauvegarde.variables.solarisableHuwart.valeur
    config.libelle_solarisable_huwart = sauvegarde.variables.solarisableHuwart.libelle or LIBELLE_SOLARISABLE_HUWART

    AperPolygone.query.filter_by(projet_id=projet.id).delete(synchronize_session=False)
    for type_polygone in ('surface', 'exclusion'):
        for ordre, contour in enumerate(getattr(sauvegarde.polygones, type_polygone)):
            db.session.add(AperPolygone(
                projet_id=projet.id, indice_projet=indice, type_polygone=type_polygone, ordre=ordre,
                coordonnees=[{'lat': p.lat, 'lng': p.lng} for p in contour],
            ))
