"""
Validation de `origineParcelles`, rattaché à un contour de calepinage issu d'un décalage de
parcelles cadastrales (bouton « Créer une forme de décalage », cf.
static/.../components/decalage_parcelles/DecalageParcelles.js) et sauvegardé par la route
POST .../calepinage-maison/save dans la colonne JSON `donnees_completes`.

Forme attendue (absente pour un contour tracé à la main) :
    {
        "operationId": "dec-...",                    # regroupe les champs d'un même décalage
        "references": ["AB 12", "AB 13"],            # parcelles sélectionnées
        "reculM": 5,                                 # recul depuis la limite de propriété (m)
        "limites": [[{"lat": .., "lng": ..}, ...]],  # limite de propriété (anneaux)
        "decalage": [{"lat": .., "lng": ..}, ...]    # trait de décalage de CE champ
    }

Même règle que le reste de la sauvegarde (demande explicite : valider front ET back) : rejet net,
jamais de correction silencieuse. Bornes du recul identiques au frontend
(geometrie_decalage.js::RECUL_MIN_M / RECUL_MAX_M, test de parité dans tests/decalage_parcelles/).
"""
import math

from app.schemas.calepinage_dimensionnement_schemas import DimensionnementValidationError

RECUL_MIN_M = 1
RECUL_MAX_M = 50

MAX_REFERENCES = 200
MAX_LONGUEUR_TEXTE = 64
MAX_ANNEAUX = 100
MAX_POINTS_ANNEAU = 5000
CLES_AUTORISEES = {'operationId', 'references', 'reculM', 'limites', 'decalage'}


def _erreur(identifiant, message):
    raise DimensionnementValidationError(f"{identifiant} - décalage de parcelles : {message}")


def _nombre_fini(valeur):
    return (isinstance(valeur, (int, float)) and not isinstance(valeur, bool)
            and math.isfinite(valeur))


def _valider_anneau(anneau, nom, identifiant):
    if not isinstance(anneau, list) or not (3 <= len(anneau) <= MAX_POINTS_ANNEAU):
        _erreur(identifiant, f"{nom} doit contenir entre 3 et {MAX_POINTS_ANNEAU} points.")
    for point in anneau:
        if not isinstance(point, dict):
            _erreur(identifiant, f"{nom} : point invalide.")
        lat, lng = point.get('lat'), point.get('lng')
        if not (_nombre_fini(lat) and _nombre_fini(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            _erreur(identifiant, f"{nom} : coordonnées invalides.")


def valider_recul(valeur, identifiant='champ'):
    """Recul en mètres, compris dans [RECUL_MIN_M, RECUL_MAX_M] ; toute autre valeur est rejetée."""
    if not _nombre_fini(valeur) or not (RECUL_MIN_M <= valeur <= RECUL_MAX_M):
        _erreur(identifiant, f"recul invalide ({valeur!r}), valeur attendue entre {RECUL_MIN_M} et {RECUL_MAX_M} m.")
    return valeur


def valider_origine_parcelles(origine, identifiant='champ'):
    """Valide `origineParcelles` d'un contour ; None (contour tracé à la main) est accepté."""
    if origine is None:
        return
    if not isinstance(origine, dict):
        _erreur(identifiant, "format invalide.")
    inconnues = set(origine) - CLES_AUTORISEES
    if inconnues:
        _erreur(identifiant, f"champ(s) non autorisé(s) : {', '.join(sorted(inconnues))}.")

    valider_recul(origine.get('reculM'), identifiant)

    operation = origine.get('operationId')
    if not isinstance(operation, str) or not operation or len(operation) > MAX_LONGUEUR_TEXTE:
        _erreur(identifiant, "identifiant d'opération invalide.")

    references = origine.get('references')
    if not isinstance(references, list) or not (1 <= len(references) <= MAX_REFERENCES):
        _erreur(identifiant, f"entre 1 et {MAX_REFERENCES} parcelles attendues.")
    for ref in references:
        if not isinstance(ref, str) or not ref.strip() or len(ref) > MAX_LONGUEUR_TEXTE:
            _erreur(identifiant, "référence de parcelle invalide.")

    limites = origine.get('limites')
    if not isinstance(limites, list) or not (1 <= len(limites) <= MAX_ANNEAUX):
        _erreur(identifiant, f"limite de propriété : entre 1 et {MAX_ANNEAUX} contours attendus.")
    for anneau in limites:
        _valider_anneau(anneau, 'limite de propriété', identifiant)

    _valider_anneau(origine.get('decalage'), 'trait de décalage', identifiant)
