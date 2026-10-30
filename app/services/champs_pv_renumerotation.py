"""
Données serveur rattachées au N° d'un champ PV (PV1, PV2...) : elles suivent le champ quand il est
supprimé ou renuméroté.

Le calepinage renumérote les champs sans trou (PV1, PV2, PV3 -> suppression de PV1 -> PV1, PV2 ; cf.
calepinage_maison_orchestrateur.js::renumeroterChampsPV). Sans ce suivi, les paramètres du petit champ
solaire (petit_champ_parametres), la géométrie des configurateurs (geometrie_projet) et les champs
exclus du dossier ombrières restaient sur l'ANCIEN numéro : l'ex-PV2 devenu PV1 héritait des
paramètres du PV1 supprimé.

Appelé dans la MÊME transaction que l'enregistrement du calepinage maison : les données suivent
exactement ce qui est enregistré (une sauvegarde refusée ne déplace rien).
"""
from typing import Dict, Iterable, Optional, Set, Tuple

from app.extensions import db
from app.services.petit_champ_solaire.validation import valider_pv_id

MAX_RENUMEROTATIONS = 500


def valider_renumerotation(valeur) -> Optional[Dict[str, str]]:
    """{ancien n°: nouveau n°} ou None ; lève ValueError si le format est invalide."""
    if valeur in (None, {}):
        return None
    if not isinstance(valeur, dict) or len(valeur) > MAX_RENUMEROTATIONS:
        raise ValueError("Renumérotation des champs PV : format invalide.")
    if not all(valider_pv_id(k) and valider_pv_id(v) for k, v in valeur.items()):
        raise ValueError("Renumérotation des champs PV : identifiant de champ invalide.")
    if len(set(valeur.values())) != len(valeur):
        raise ValueError("Renumérotation des champs PV : deux champs vers le même numéro.")
    return dict(valeur)


def planifier(anciens: Iterable[str], nouveaux: Iterable[str],
              renumerotation: Optional[Dict[str, str]]) -> Tuple[Dict[str, str], Set[str]]:
    """(renommages {ancien: nouveau}, n° supprimés) à partir des champs avant/après l'enregistrement.

    Un ancien n° est conservé s'il est encore présent et qu'aucun autre champ n'a été renuméroté vers
    lui ; renommé s'il est source d'une renumérotation dont la cible est présente ; supprimé sinon.
    """
    renumerotation = renumerotation or {}
    nouveaux = set(nouveaux)
    cibles = set(renumerotation.values())
    renommages, supprimes = {}, set()
    for ancien in set(anciens):
        if ancien in renumerotation:
            if renumerotation[ancien] in nouveaux:
                renommages[ancien] = renumerotation[ancien]
            else:
                supprimes.add(ancien)
        elif ancien in nouveaux and ancien not in cibles:
            continue
        else:
            supprimes.add(ancien)
    return renommages, supprimes


def _deplacer_lignes(modele, projet_id, renommages, supprimes):
    """Supprime puis renomme en 2 temps (n° temporaires) : PV2 -> PV1 alors que PV1 existe encore
    ne doit jamais heurter la contrainte d'unicité (projet, pv_id)."""
    concernes = set(renommages) | set(renommages.values()) | supprimes
    if not concernes:
        return
    lignes = modele.query.filter(modele.projet_id == projet_id, modele.pv_id.in_(concernes)).all()
    a_renommer = []
    for ligne in lignes:
        if ligne.pv_id in renommages:
            a_renommer.append(ligne)
        elif ligne.pv_id in supprimes or ligne.pv_id in renommages.values():
            # Champ supprimé, ou ligne restée sur un n° qu'un autre champ va reprendre.
            db.session.delete(ligne)
    db.session.flush()
    for ligne in a_renommer:
        ligne.pv_id = f"__renum__{ligne.pv_id}"
    db.session.flush()
    for ligne in a_renommer:
        ligne.pv_id = renommages[ligne.pv_id[len("__renum__"):]]
    db.session.flush()


def _suivre_champs_exclus(dossier, renommages: Dict[str, str], supprimes: Set[str]) -> None:
    if not isinstance(dossier.dossier, dict) or not isinstance(dossier.dossier.get("champsExclus"), list):
        return
    exclus = []
    for pv in dossier.dossier["champsExclus"]:
        # Exclusion attachée à l'ANCIEN n° : elle suit le champ renuméroté, disparaît avec le
        # champ supprimé (même si son n° est repris par un autre champ).
        if pv in renommages:
            exclus.append(renommages[pv])
        elif pv not in supprimes:
            exclus.append(pv)
    dossier.dossier = {**dossier.dossier, "champsExclus": sorted(set(exclus))}


def appliquer(projet_id: int, anciens: Iterable[str], nouveaux: Iterable[str],
              renumerotation: Optional[Dict[str, str]]) -> Tuple[Dict[str, str], Set[str]]:
    """Fait suivre aux données rattachées au n° de champ la suppression / renumérotation."""
    from app.models.calepinage import GeometrieProjet
    from app.models.dossier_plans import DossierPlans
    from app.models.ombriere_dossier import OmbriereDossier
    from app.models.petit_champ_solaire import PetitChampParametres

    renommages, supprimes = planifier(anciens, nouveaux, renumerotation)
    if not renommages and not supprimes:
        return renommages, supprimes

    _deplacer_lignes(PetitChampParametres, projet_id, renommages, supprimes)
    _deplacer_lignes(GeometrieProjet, projet_id, renommages, supprimes)

    # Champs exclus des dossiers de plans (ombrières, toitures, mixte) : même suivi des n°.
    for dossier in [*OmbriereDossier.query.filter_by(projet_id=projet_id).all(),
                    *DossierPlans.query.filter_by(projet_id=projet_id).all()]:
        _suivre_champs_exclus(dossier, renommages, supprimes)
    return renommages, supprimes
