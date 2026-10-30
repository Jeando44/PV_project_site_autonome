"""Projection géographique <-> plan local (mètres) pour le moteur de calepinage.

Deux vérifications indépendantes de la géométrie brute :
  - une distance géodésique WGS84 (pyproj.Geod), plus rigoureuse que
    l'approximation sphérique utilisée côté frontend
    (google.maps.geometry.spherical.computeDistanceBetween) ;
  - une projection azimutale équidistante locale + Shapely, pour obtenir une
    aire de polygone indépendante du simple produit longueur x largeur.

ShapeFrame gère aussi le sens inverse (along/perp -> lat/lng), nécessaire pour
renvoyer au frontend la position réelle des panneaux calculés par le backend
(correction du calepinage au clic sur "Système"/"Calculer et Visualiser").
"""
import math
from dataclasses import dataclass

from pyproj import Geod, Transformer
from shapely.geometry import Polygon

_GEOD = Geod(ellps="WGS84")


def geodesic_distance_m(point_a: dict, point_b: dict) -> float:
    """Distance géodésique réelle (WGS84) entre deux points {lat, lng}, en mètres."""
    _, _, distance_m = _GEOD.inv(point_a["lng"], point_a["lat"], point_b["lng"], point_b["lat"])
    return distance_m


def _local_crs(points: list[dict]) -> str:
    lat0 = sum(p["lat"] for p in points) / len(points)
    lng0 = sum(p["lng"] for p in points) / len(points)
    return f"+proj=aeqd +lat_0={lat0} +lon_0={lng0} +datum=WGS84 +units=m +no_defs"


def build_local_transformer(points: list[dict]) -> Transformer:
    """Transformer EPSG:4326 -> plan local en mètres, centré sur le centroïde des points."""
    return Transformer.from_crs("EPSG:4326", _local_crs(points), always_xy=True)


def build_local_transformer_pair(points: list[dict]) -> tuple[Transformer, Transformer]:
    """(forward, reverse) : EPSG:4326 <-> plan local en mètres, centré sur le centroïde des
    points — pour un appelant ayant besoin de reconvertir des positions calculées dans ce plan
    local (ex. panneaux) vers lat/lng, en plus de la projection lat/lng -> local déjà couverte par
    build_local_transformer (cf. calepinage_maison_verification/geodesic_engine.py)."""
    crs = _local_crs(points)
    forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    reverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    return forward, reverse


def project_points(points: list[dict], transformer: Transformer) -> list[tuple[float, float]]:
    return [transformer.transform(p["lng"], p["lat"]) for p in points]


def polygon_from_latlng(points: list[dict]) -> tuple[Polygon, list[tuple[float, float]]]:
    """Construit un shapely.Polygon en mètres locaux à partir de points {lat, lng}."""
    transformer = build_local_transformer(points)
    local_points = project_points(points, transformer)
    return Polygon(local_points), local_points


@dataclass
class ShapeFrame:
    """Repère along/perp partagé par la toiture et ses obstacles (même transformer,
    même origine/heading), pour que tout soit projeté de façon cohérente avant de tester
    les intersections panneau/obstacle. L'axe along est aligné sur l'arête sommet0->sommet1
    de la toiture, comme le `heading` de PolygonPanelsManager.js (ou sur un cap imposé pour
    les sheds, cf. build_shape_frame_with_heading).

    `reverse_transformer` permet de reconvertir une position along/perp en lat/lng, pour
    renvoyer au frontend la position réelle des panneaux calculés côté backend.
    """
    transformer: Transformer
    reverse_transformer: Transformer
    heading_rad: float
    ref_xy: tuple[float, float]

    def to_along_perp(self, points: list[dict]) -> list[tuple[float, float]]:
        local = project_points(points, self.transformer)
        cos_h, sin_h = math.cos(self.heading_rad), math.sin(self.heading_rad)
        result = []
        for x, y in local:
            rel_x, rel_y = x - self.ref_xy[0], y - self.ref_xy[1]
            along = rel_y * cos_h + rel_x * sin_h
            perp = rel_x * cos_h - rel_y * sin_h
            result.append((along, perp))
        return result

    def from_along_perp(self, along: float, perp: float) -> dict:
        """Inverse de to_along_perp pour un seul point : along/perp -> {lat, lng}.

        La rotation appliquée dans to_along_perp est une matrice symétrique de
        déterminant -1 (involutive : R x R = I), donc son inverse est elle-même.
        """
        cos_h, sin_h = math.cos(self.heading_rad), math.sin(self.heading_rad)
        rel_x = sin_h * along + cos_h * perp
        rel_y = cos_h * along - sin_h * perp
        x = rel_x + self.ref_xy[0]
        y = rel_y + self.ref_xy[1]
        lng, lat = self.reverse_transformer.transform(x, y)
        return {"lat": lat, "lng": lng}

    def panel_box_to_latlng(self, min_along: float, min_perp: float,
                             max_along: float, max_perp: float) -> list[dict]:
        """4 coins d'un panneau (rectangle axis-aligned en along/perp) -> lat/lng, dans
        l'ordre attendu par un google.maps.Polygon (paths)."""
        return [
            self.from_along_perp(min_along, min_perp),
            self.from_along_perp(max_along, min_perp),
            self.from_along_perp(max_along, max_perp),
            self.from_along_perp(min_along, max_perp),
        ]


def _build_frame(roof_points: list[dict], heading_rad: float) -> ShapeFrame:
    crs = _local_crs(roof_points)
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    reverse_transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    local_roof = project_points(roof_points, transformer)
    ref = local_roof[0]
    return ShapeFrame(transformer=transformer, reverse_transformer=reverse_transformer,
                       heading_rad=heading_rad, ref_xy=ref)


def build_shape_frame(roof_points: list[dict]) -> ShapeFrame:
    """Construit le repère along/perp à partir des sommets de la toiture (roof_points[0] ->
    roof_points[1] définit l'axe along), pour projeter ensuite obstacles et panneaux dans ce
    même repère (cf. ShapeFrame.to_along_perp)."""
    crs = _local_crs(roof_points)
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    local_roof = project_points(roof_points, transformer)
    ref, nxt = local_roof[0], local_roof[1]
    heading = math.atan2(nxt[0] - ref[0], nxt[1] - ref[1])
    return _build_frame(roof_points, heading)


def build_shape_frame_with_heading(roof_points: list[dict], heading_deg: float) -> ShapeFrame:
    """Variante de build_shape_frame avec un cap (heading) imposé plutôt que déduit de l'arête
    sommet0->sommet1 — nécessaire pour les sheds, dont l'orientation des panneaux est fixe
    (Sud + rotation shed) et indépendante de l'orientation du polygone dessiné (cf.
    PolygonPanelsManager.js lignes 190-221, gridBaseHeading = 180 en mode shed). L'origine du
    repère (roof_points[0]) reste la même que pour build_shape_frame (`ref = path.getAt(0)`,
    cf. PolygonPanelsManager.js projectPoint/createPanels)."""
    return _build_frame(roof_points, math.radians(heading_deg))
