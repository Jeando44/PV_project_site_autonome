"""
Puissance (kWc) des panneaux RÉELLEMENT présents dans le calepinage enregistré en base.

Sert à :
  - figer la « Puissance projet (kWc) » de « Mes projets » (colonne puissance_projet_kwc), sur
    « Calculer et visualiser », un export ou « Sauvegarder le projet » (route valider_puissance_projet) ;
  - détecter un calepinage modifié depuis (écart avec la valeur figée -> « cliquez sur Calculer ») ;
  - le quota de licence (puissance_totale_kwc, réécrite à chaque sauvegarde de calepinage).
Elle n'est jamais reprise d'un total mis en cache par le navigateur (solarProjectData.totals.totalPower
du localStorage) : souvent périmé ou issu d'un autre projet (ex. 1 347,96 kWc affichés pour 522,60).

Sources : lignes `Calepinage` (grands projets : panelCount x puissancePanneau de calepinage_data) et
lignes `CalepinageMaison` + `puissance_maison_kwc` (moteur unique : toitures, ombrières, sheds du petit
champ solaire, dômes — les configurateurs d'ombrière/petit champ n'ont pas de panneaux à eux).
Aucun calepinage ou aucun panneau -> None.
"""
import json
from typing import Any, Optional


def _nombre_positif(valeur: Any) -> Optional[float]:
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return None
    return v if v > 0 and v == v and v != float('inf') else None


def kwc_grands_projets(calepinage_data: Any, pv_ids_enregistres=None) -> float:
    """Somme nb panneaux x puissance unitaire (Wc) / 1000 sur les champs du calepinage grands
    projets. `pv_ids_enregistres` limite le calcul aux champs ayant une ligne `Calepinage`."""
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
    for pv_id, shape in shapes.items():
        if pv_ids_enregistres is not None and pv_id not in pv_ids_enregistres:
            continue
        if not isinstance(shape, dict):
            continue
        nb_panneaux = _nombre_positif((shape.get('gridInfo') or {}).get('panelCount'))
        puissance_wc = _nombre_positif((form_data.get(pv_id) or {}).get('puissancePanneau'))
        if nb_panneaux and puissance_wc:
            total += nb_panneaux * puissance_wc / 1000.0
    return total


def puissance_calepinage_kwc(projet) -> Optional[float]:
    """Puissance (kWc, 2 décimales) des panneaux du calepinage enregistré, ou None."""
    from app.models import Calepinage, CalepinageMaison

    if projet is None or projet.id is None:
        return None

    pv_ids = {row.pv_id for row in Calepinage.query.with_entities(Calepinage.pv_id)
              .filter_by(projet_id=projet.id).all()}
    total = kwc_grands_projets(projet.calepinage_data, pv_ids) if pv_ids else 0.0

    a_des_maisons = CalepinageMaison.query.filter_by(projet_id=projet.id).first() is not None
    if a_des_maisons:
        total += _nombre_positif(projet.puissance_maison_kwc) or 0.0

    return round(total, 2) if total > 0 else None
