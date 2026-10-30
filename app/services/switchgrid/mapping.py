"""
Mapping métier : transforme les données brutes Switchgrid (C68, R63) en
structures directement consommables par les modules de calcul existants
(`calcul_autoconso.py`, `calcul_prodsun.py`, `etude_economique.py`, ...).

Ce module ne fait AUCUN appel réseau : il prend en entrée du JSON déjà
téléchargé et retourne des dataclasses / dicts normalisés.

NB : le format exact du JSON C68 brut Enedis peut varier légèrement selon
le type de compteur et le distributeur ; les clés ci-dessous sont celles
documentées par Switchgrid/Enedis pour C68. Il est recommandé de stocker
le JSON brut (voir models/switchgrid.py: SwitchgridRawDataset) et de
n'ajuster que ce fichier en cas d'écart constaté en prod, sans jamais
perdre la donnée source.
"""
from __future__ import annotations
 
from dataclasses import dataclass, field
from datetime import datetime
from app.utils.dates import utc_maintenant
from typing import Any, Dict, List, Optional

from .donnees_brutes import CLE_POINTS_COMPACTS, lire_stockage
 
 
# --------------------------------------------------------------------------- #
# C68 -> informations contractuelles COMPLÈTES
# --------------------------------------------------------------------------- #
 
@dataclass
class ContratEnedis:
    """
    Toutes les informations contractuelles Enedis disponibles dans C68.
    """
    # ── Identifiant ─────────────────────────────────────────────────────────
    prm: str
 
    # ── Contrat / Tarif ──────────────────────────────────────────────────────
    puissance_souscrite_kva: Optional[float] = None        # ex: 9.0
    puissance_raccordement_kva: Optional[float] = None     # ex: 12.0 (≠ souscrite)
    option_tarifaire_code: Optional[str] = None            # ex: "BTINFCU4"
    option_tarifaire_libelle: Optional[str] = None         # ex: "Tarif BT<=36kVA Courte Utilisation..."
    calendrier_tarifaire_code: Optional[str] = None        # ex: "FC000032"
    calendrier_tarifaire_libelle: Optional[str] = None     # ex: "Heures Pleines/Creuses"
    a_heures_creuses: bool = False
    plages_heures_creuses: List[Dict[str, str]] = field(default_factory=list)
    horaires_hp: Optional[str] = None                      # ex: "6H30-22H30"
    horaires_hc: Optional[str] = None                      # ex: "22H30-6H30"
 
    # ── Comptage ─────────────────────────────────────────────────────────────
    type_comptage_code: Optional[str] = None               # ex: "LINKY"
    type_comptage_libelle: Optional[str] = None            # ex: "Compteur Linky"
    matricule_compteur: Optional[str] = None               # ex: "12345678901234"
 
    # ── Alimentation ─────────────────────────────────────────────────────────
    domaine_tension_code: Optional[str] = None             # ex: "BTINF"
    domaine_tension_libelle: Optional[str] = None          # ex: "BT<=36kVA"
    tension_livraison: Optional[str] = None                # ex: "230/400 V"
 
    # ── Données générales ────────────────────────────────────────────────────
    segment_client_code: Optional[str] = None              # ex: "C5"
    niveau_ouverture_services: Optional[str] = None        # ex: "2"
 
    # ── Adresse d'installation ───────────────────────────────────────────────
    adresse_rue: Optional[str] = None                      # ex: "1 rue de la paix"
    adresse_code_postal: Optional[str] = None              # ex: "75001"
    adresse_commune: Optional[str] = None                  # ex: "Paris"
    adresse_code_commune: Optional[str] = None             # ex: "75101"
 
    # ── Méta ─────────────────────────────────────────────────────────────────
    date_extraction: datetime = field(default_factory=utc_maintenant)
    donnees_brutes: Dict[str, Any] = field(default_factory=dict)
 
 
def map_c68_to_contrat(prm: str, c68_raw: Dict[str, Any]) -> ContratEnedis:
    """
    Transforme un JSON C68 brut Enedis (structure réelle observée)
    en ContratEnedis complet avec TOUS les champs disponibles.

    Multi-PRM (ACC) : la même request C68 couvre tous les PRM de l'order, donc la donnée brute
    stockée pour CHAQUE PRM est le document complet — on y retrouve le point du PRM demandé
    (cf. _selectionner_point_c68) au lieu de prendre le premier venu pour tout le monde.
    """
    c68_raw = lire_stockage(c68_raw)
    point = _selectionner_point_c68(prm, c68_raw)
 
    # ── Données générales ────────────────────────────────────────────────────
    donnees_generales = point.get("donneesGenerales", {})
    segment = donnees_generales.get("segment", {})
    adresse_inst = donnees_generales.get("adresseInstallation", {})
    commune_obj = adresse_inst.get("commune", {})
 
    # ── Situation contractuelle ──────────────────────────────────────────────
    structure_tar = (
        point.get("situationContractuelle", {})
             .get("structureTarifaire", {})
    )
    fta = structure_tar.get("formuleTarifaireAcheminement", {})
    calendrier = structure_tar.get("calendrierFrn", {})
    puissance_souscrite_raw = structure_tar.get("puissanceSouscriteMax", {})
 
    # ── Situation alimentation ───────────────────────────────────────────────
    alim = (
        point.get("situationAlimentation", {})
             .get("alimentationPrincipale", {})
    )
    domaine_tension = alim.get("domaineTension", {})
    tension_livraison = alim.get("tensionLivraison", {})
    puissance_raccord_raw = alim.get("puissanceRaccordementSoutirage", {})
 
    # ── Situation comptage ───────────────────────────────────────────────────
    dispositif = (
        point.get("situationComptage", {})
             .get("dispositifComptage", {})
    )
    type_comptage = dispositif.get("typeComptage", {})
    compteurs_list = dispositif.get("compteurs", {}).get("compteur", [])
    premier_compteur = compteurs_list[0] if compteurs_list else {}
    matricule = premier_compteur.get("matricule")
 
    # ── Plages HP/HC ─────────────────────────────────────────────────────────
    plages_brutes = (
        premier_compteur
        .get("programmationHoraire", {})
        .get("programmationPosteHoraire", [])
    )
    plages_normalisees = [
        {
            "code": p.get("attributes", {}).get("code", ""),
            "libelle": p.get("libelle", ""),
            "horaires": p.get("periodesHoraires", ""),
        }
        for p in plages_brutes
    ]
    a_hc = any(p["code"] == "HC" for p in plages_normalisees)
 
    # Extraction séparée des horaires HP et HC pour lisibilité dans l'Excel
    horaires_hp = next(
        (p["horaires"] for p in plages_normalisees if p["code"] == "HP"), None
    )
    horaires_hc = next(
        (p["horaires"] for p in plages_normalisees if p["code"] == "HC"), None
    )
 
    return ContratEnedis(
        prm=prm,
 
        # Contrat
        puissance_souscrite_kva=_safe_float(puissance_souscrite_raw.get("valeur")),
        puissance_raccordement_kva=_safe_float(puissance_raccord_raw.get("valeur")),
        option_tarifaire_code=fta.get("attributes", {}).get("code"),
        option_tarifaire_libelle=fta.get("libelle"),
        calendrier_tarifaire_code=calendrier.get("attributes", {}).get("code"),
        calendrier_tarifaire_libelle=calendrier.get("libelle"),
        a_heures_creuses=a_hc,
        plages_heures_creuses=plages_normalisees,
        horaires_hp=horaires_hp,
        horaires_hc=horaires_hc,
 
        # Comptage
        type_comptage_code=type_comptage.get("attributes", {}).get("code"),
        type_comptage_libelle=type_comptage.get("libelle"),
        matricule_compteur=matricule,
 
        # Alimentation
        domaine_tension_code=domaine_tension.get("attributes", {}).get("code"),
        domaine_tension_libelle=domaine_tension.get("libelle"),
        tension_livraison=tension_livraison.get("libelle"),
 
        # Données générales
        segment_client_code=segment.get("attributes", {}).get("code"),
        niveau_ouverture_services=donnees_generales.get("niveauOuvertureServices"),
 
        # Adresse
        adresse_rue=adresse_inst.get("numeroEtNomVoie"),
        adresse_code_postal=adresse_inst.get("codePostal"),
        adresse_commune=commune_obj.get("libelle"),
        adresse_code_commune=commune_obj.get("attributes", {}).get("code"),
 
        donnees_brutes=c68_raw,
    )
 
 
# --------------------------------------------------------------------------- #
# R63 -> courbe de charge (inchangé)
# --------------------------------------------------------------------------- #
 
@dataclass(slots=True)  # ~600 000 points pour une R63 5 min pluriannuelle : pas de __dict__ par point
class PointCourbeCharge:
    horodatage: datetime
    puissance_w: float
 
 
@dataclass
class CourbeChargeNormalisee:
    prm: str
    pas_de_temps_secondes: int
    points: List[PointCourbeCharge] = field(default_factory=list)
    # Formats R63 Enedis : l'horodatage marque la FIN du pas d'intégration (et non son début).
    horodatage_fin_de_pas: bool = False
 
    def to_kwh_serie(self) -> List[float]:
        pas_h = self.pas_de_temps_secondes / 3600.0
        return [p.puissance_w / 1000.0 * pas_h for p in self.points]
 
    def consommation_totale_kwh(self) -> float:
        return sum(self.to_kwh_serie())
 
 
def map_r63_json_to_courbe(prm: str, r63_data) -> 'CourbeChargeNormalisee':
    """
    Transforme les données R63 en CourbeChargeNormalisee.

    Détecte automatiquement :
      - Dict avec clé "mesures" (format Enedis réel)
      - Liste de points (format brut alternatif)
      - Dict Switchgrid normalisé (format LOADCURVE)
    Accepte aussi la forme compressée stockée en base (cf. donnees_brutes.preparer_pour_stockage).
    """
    r63_data = lire_stockage(r63_data)
    if isinstance(r63_data, list):
        # Liste de documents {"header", "mesures"} (fragments dataUrls non fusionnés, cf.
        # orders.merge_json_chunks) : on les fusionne pour appliquer le filtre par idPrm.
        if r63_data and all(isinstance(d, dict) and "mesures" in d for d in r63_data):
            mesures = [m for d in r63_data for m in (d.get("mesures") or [])]
            return _map_r63_mesures_format(prm, {"mesures": mesures})
        return _map_r63_enedis_raw(prm, r63_data)
    elif isinstance(r63_data, dict):
        # Nouveau : détection du format mesures
        if "mesures" in r63_data:
            return _map_r63_mesures_format(prm, r63_data)
        else:
            return _map_r63_switchgrid_normalized(prm, r63_data)
    else:
        return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=1800, points=[])
    


def _map_r63_mesures_format(prm: str, r63_json: dict) -> 'CourbeChargeNormalisee':
    """
    Parse le format Enedis réel : {mesures: [{idPrm, grandeur: [{points: "csv" ou liste}]}]}
    points peut être une chaîne CSV (lignes "date;valeur") ou une liste d'objets {d, n, p, v}.
    """
    from datetime import datetime, timezone

    points_out = []
    pas_secondes = 1800  # valeur par défaut, sera ajustée si trouvée

    for mesure in r63_json.get("mesures", []):
        if mesure.get("idPrm") != prm:
            continue  # ignorer les autres PRM

        for grandeur in mesure.get("grandeur", []):
            # ---- Cas 0 : points compactés au décodage (donnees_brutes) : lignes "d;v;p;n" ----
            # Même règles que le cas 2 (liste d'objets {d, n, p, v}) dont ils proviennent.
            compacts = grandeur.get(CLE_POINTS_COMPACTS)
            if isinstance(compacts, str):
                derniere_periode = None
                for ligne in compacts.split("\n"):
                    date_str, val_str, periode_str, direction = (ligne.split(";") + ["", "", "", ""])[:4]
                    if direction.upper() == "I" or not date_str or not val_str:
                        continue
                    try:
                        dt = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
                        val = float(val_str)
                    except (ValueError, TypeError):
                        continue
                    derniere_periode = periode_str or "PT30M"
                    points_out.append(PointCourbeCharge(horodatage=dt, puissance_w=val))
                if derniere_periode is not None:
                    pas_secondes = _parse_iso8601_duration_seconds(derniere_periode)
                continue

            raw_points = grandeur.get("points")
            unite = grandeur.get("unite", "W")  # Peut être W, kW, Wh, etc.

            if not raw_points:
                continue

            # ---- Cas 1 : points est une chaîne CSV ----
            if isinstance(raw_points, str):
                lines = raw_points.strip().splitlines()
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    # séparateur ; ou ,
                    for sep in (";", ","):
                        if sep in line:
                            parts = line.split(sep)
                            break
                    else:
                        continue
                    if len(parts) < 2:
                        continue
                    date_str, val_str = parts[0].strip(), parts[1].strip()
                    try:
                        dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                        dt = dt.replace(tzinfo=timezone.utc)
                        val = float(val_str)
                    except (ValueError, TypeError):
                        continue

                    # Conversion selon unité
                    if unite.upper() == "KW":
                        val = val * 1000
                    elif unite.upper() == "WH":
                        # Wh sur 30 min → W moyen = Wh / 0.5h
                        val = val / 0.5
                    # sinon on suppose W

                    points_out.append(PointCourbeCharge(horodatage=dt, puissance_w=val))

            # ---- Cas 2 : points est une liste d'objets {d, n, p, v} ----
            elif isinstance(raw_points, list):
                for item in raw_points:
                    if not isinstance(item, dict):
                        continue
                    direction = item.get("n", "R")
                    # On ignore l'injection, on accepte R et B
                    if direction.upper() == "I":
                        continue
                    date_str = item.get("d")
                    val_str = item.get("v")
                    periode_str = item.get("p", "PT30M")
                    if not date_str or val_str is None:
                        continue
                    try:
                        dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                        dt = dt.replace(tzinfo=timezone.utc)
                        val = float(val_str)
                    except (ValueError, TypeError):
                        continue
                    # Mise à jour du pas de temps (si cohérent)
                    pas_secondes = _parse_iso8601_duration_seconds(periode_str)
                    points_out.append(PointCourbeCharge(horodatage=dt, puissance_w=val))

    return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=pas_secondes, points=points_out,
                                  horodatage_fin_de_pas=True)
 
 
def _map_r63_enedis_raw(prm: str, points_list: list) -> 'CourbeChargeNormalisee':
    """
    Parseur pour le format Enedis R63 brut (format réel en production).
 
    Structure d'un point :
      {
        "d": "2026-07-06 20:30:00",  ← horodatage de fin du pas
        "n": "R",                     ← sens : R=soutirage, I=injection
        "p": "PT30M",                 ← période (PT30M = 30 minutes)
        "v": "4927"                   ← valeur en W (puissance moyenne)
      }
 
    On filtre uniquement les points de soutirage (n == "R").
    Les points d'injection (n == "I") sont ignorés dans cette version.
    """
    from datetime import datetime, timezone
 
    points = []
    pas_secondes = 1800  # PT30M par défaut
 
    for item in points_list:
        if not isinstance(item, dict):
            continue
 
        direction = item.get("n", "R")
        if direction != "R":
            # Ignorer les points d'injection pour le calcul d'autoconsommation
            continue
 
        date_str = item.get("d", "")
        valeur_str = item.get("v", "0")
        periode_str = item.get("p", "PT30M")
 
        try:
            # Parsing datetime (format Enedis : "YYYY-MM-DD HH:MM:SS")
            horodatage = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
            horodatage = horodatage.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
 
        try:
            puissance_w = float(valeur_str)
        except (ValueError, TypeError):
            puissance_w = 0.0
 
        pas_secondes = _parse_iso8601_duration_seconds(periode_str)
        points.append(PointCourbeCharge(horodatage=horodatage, puissance_w=puissance_w))
 
    return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=pas_secondes, points=points,
                                  horodatage_fin_de_pas=True)
 
 
def _map_r63_switchgrid_normalized(prm: str, r63_json: dict) -> 'CourbeChargeNormalisee':
    """
    Parseur pour le format Switchgrid normalisé (mode test / LOADCURVE).
    Format : {"period": "PT1800S", "startsAt": "...", "values": [...]}
    """
    period_iso = r63_json.get("period", "PT1800S")
    pas_secondes = _parse_iso8601_duration_seconds(period_iso)
 
    starts_at_str = r63_json.get("startsAt")
    if not starts_at_str:
        return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=pas_secondes, points=[])
 
    starts_at = _parse_iso_datetime(starts_at_str)
    values = r63_json.get("values", [])
 
    points = []
    current = starts_at
    for value in values:
        points.append(PointCourbeCharge(horodatage=current, puissance_w=float(value or 0)))
        from datetime import timedelta
        current = current + timedelta(seconds=pas_secondes)
 
    return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=pas_secondes, points=points)
 
 
 
def map_r63_csv_to_courbe(prm: str, csv_text: str) -> CourbeChargeNormalisee:
    lines = [l for l in csv_text.strip().splitlines() if l.strip()]
    if not lines:
        return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=0, points=[])
    rows = lines[1:] if lines[0].lower().startswith("startdate") else lines
    points = []
    for row in rows:
        date_str, power_str = row.split(",")
        points.append(PointCourbeCharge(
            horodatage=_parse_iso_datetime(date_str.strip()),
            puissance_w=float(power_str.strip()),
        ))
    pas_secondes = 0
    if len(points) >= 2:
        pas_secondes = int((points[1].horodatage - points[0].horodatage).total_seconds())
    return CourbeChargeNormalisee(prm=prm, pas_de_temps_secondes=pas_secondes, points=points)
 
 
# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
 
def _selectionner_point_c68(prm: str, c68_raw: Any) -> Dict[str, Any]:
    """
    Retourne le `point` C68 correspondant à `prm`, quelle que soit l'enveloppe reçue :
    {"point": {...}} (mono-PRM, format observé), {"point": [...]}, {"points": [...]}, ou une
    liste de ces documents (fragments dataUrls, cf. orders.merge_json_chunks). Un point sans
    identifiant est accepté (compatibilité mono-PRM) ; un point portant l'identifiant d'un AUTRE
    PRM ne l'est jamais — mieux vaut un contrat vide qu'un contrat attribué au mauvais participant.
    """
    candidats: List[Dict[str, Any]] = []

    def collecter(noeud: Any) -> None:
        if isinstance(noeud, list):
            for element in noeud:
                collecter(element)
        elif isinstance(noeud, dict):
            if "point" in noeud or "points" in noeud:
                collecter(noeud.get("point"))
                collecter(noeud.get("points"))
            elif "donneesGenerales" in noeud or "situationContractuelle" in noeud:
                candidats.append(noeud)

    collecter(c68_raw)

    sans_id = None
    for point in candidats:
        point_id = (point.get("attributes") or {}).get("id")
        if point_id == prm:
            return point
        if point_id is None and sans_id is None:
            sans_id = point
    return sans_id or {}


def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
 
 
def _parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
 
 
def _parse_iso8601_duration_seconds(duration: str) -> int:
    if not duration.startswith("PT"):
        return 1800
    duration = duration[2:]
    seconds = 0
    number = ""
    for char in duration:
        if char.isdigit():
            number += char
        elif char == "H":
            seconds += int(number) * 3600
            number = ""
        elif char == "M":
            seconds += int(number) * 60
            number = ""
        elif char == "S":
            seconds += int(number)
            number = ""
    return seconds or 1800