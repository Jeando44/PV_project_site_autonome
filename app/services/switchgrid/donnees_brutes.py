"""
Lecture compacte et stockage compressé des données brutes Switchgrid (C68 / R63).

Pourquoi : une R63 au pas de 5 min sur plusieurs années pèse ~56 Mo de JSON (≈ 600 000 points
{"v", "d", "p", "n", "iv", "ec"}). Décodée naïvement (json.loads -> 600 000 dict), elle occupait
~340 Mio en mémoire : le conteneur Cloud Run (512 Mio) était tué (503) avant de répondre, et
l'INSERT de 56 Mo dans switchgrid_raw_datasets dépassait la taille de paquet MySQL (« server has
gone away »), si bien que rien n'était jamais mis en cache.

  - charger_json_compact : décode en remplaçant à la volée chaque point R63 par une ligne
    "d;v;p;n" puis la liste de points d'une grandeur par un seul texte (clé `points_compacts`,
    lue par mapping._map_r63_mesures_format). Le pic mémoire reste proche de la taille du JSON.
  - preparer_pour_stockage / lire_stockage : au-delà de SEUIL_COMPRESSION, le document est rangé
    gzip + base64 dans la colonne JSON existante ({"_compression": "gzip+base64", "data": ...}),
    sans migration. Les lignes déjà en base (JSON en clair) restent lisibles telles quelles.
"""
from __future__ import annotations

import base64
import gzip
import json
from typing import Any

CLE_POINTS_COMPACTS = "points_compacts"  # lignes "d;v;p;n" séparées par "\n"
COMPRESSION_GZIP_B64 = "gzip+base64"
SEUIL_COMPRESSION = 512 * 1024  # octets de JSON en clair

_CLES_POINT_R63 = frozenset(("v", "d", "p", "n", "iv", "ec"))


def _compacter_objet(obj: dict) -> Any:
    # json appelle ce crochet du plus profond au moins profond : les points d'une grandeur sont
    # donc déjà des lignes texte quand le crochet reçoit la grandeur elle-même.
    if "d" in obj and "v" in obj and obj.keys() <= _CLES_POINT_R63:
        v = obj.get("v")
        return f"{obj.get('d') or ''};{'' if v is None else v};{obj.get('p') or ''};{obj.get('n') or ''}"
    points = obj.get("points")
    if isinstance(points, list) and points and all(isinstance(p, str) and ";" in p for p in points):
        obj[CLE_POINTS_COMPACTS] = "\n".join(points)
        del obj["points"]
    return obj


def charger_json_compact(raw: bytes | str) -> Any:
    """json.loads, avec les points R63 compactés (cf. module). Lève ValueError si non JSON."""
    return json.loads(raw, object_hook=_compacter_objet)


def preparer_pour_stockage(doc: Any) -> Any:
    """Valeur à ranger dans SwitchgridRawDataset.content_json (compressée si volumineuse)."""
    texte = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    if len(texte) <= SEUIL_COMPRESSION:
        return doc
    return {
        "_compression": COMPRESSION_GZIP_B64,
        "data": base64.b64encode(gzip.compress(texte, compresslevel=6)).decode("ascii"),
    }


def lire_stockage(contenu: Any) -> Any:
    """Inverse de preparer_pour_stockage ; un contenu non compressé est rendu tel quel."""
    if isinstance(contenu, dict) and contenu.get("_compression") == COMPRESSION_GZIP_B64:
        return charger_json_compact(gzip.decompress(base64.b64decode(contenu["data"])))
    return contenu
