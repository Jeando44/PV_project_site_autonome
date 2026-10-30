import { STYLES, CUSTOM_EVENTS, SHAPE_TYPES, MARGIN_COLOR, DRAWING_CONSTANTS } from "../constants.js";
import DeletedPanelsStorage from "../utils/DeletedPanelsStorage.js";
import GeometryUtils from "../utils/GeometryUtils.js";

class PolygonPanelsManager {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;

    // pvId -> panels[]
    this.createdPanelsByShape = new Map();
    // pvId -> Set("i-j") des panneaux supprimés
    this.deletedPanelIndexes = new Map();
    this.boolShowHide = false;
    this.isExplicitRotation = false;
    // pvId masqués via toggle global (évite de réafficher via obstacles)
    this.hiddenByToggle = new Set();
    // pvId -> Map<rowIndex, {count, leftPoint}> (cf. createPanels(), UI "Calepinage en shed")
    this.shedGroupsByRowForShape = new Map();
    // pvId -> {cols, rowsPerGroup} (dimensions "2X10" d'un groupe de sheds, pour l'étiquetage des rangées)
    this.shedGroupDimsForShape = new Map();
    // pvId -> AdvancedMarkerElement[] des repères "N° de rangée / nb de groupes" affichés sur le plan
    this.shedRowOverlaysByShape = new Map();

    // Recalculer les panneaux quand la forme est modifiée/déplacée
    document.addEventListener(CUSTOM_EVENTS.SHAPE_MODIFIED, (event) => {
      const { pvId } = event.detail || {};
      if (pvId) {
        const polygon = this.drawingControl.drawnShapes.find(s => s.pvId === pvId && s.type === SHAPE_TYPES.POLYGON);
        if (polygon && !polygon._isBeingPasted) { // Éviter la création lors du collage
          if (this.createdPanelsByShape.has(pvId)) {
            this.updatePanelsPosition(polygon);
          } else {
            // Si c'est un polygone sans panneaux, créer les panneaux
            this.createPanels(polygon);
          }
        }
      }
    });

    document.addEventListener(CUSTOM_EVENTS.SHAPE_MOVED, (event) => {
      const { pvId } = event.detail || {};
      if (pvId) {
        const polygon = this.drawingControl.drawnShapes.find(s => s.pvId === pvId && s.type === SHAPE_TYPES.POLYGON);
        if (polygon && !polygon._isBeingPasted) { // Éviter la création lors du collage
          if (this.createdPanelsByShape.has(pvId)) {
            this.updatePanelsPosition(polygon);
          } else {
            // Si c'est un polygone sans panneaux, créer les panneaux
            this.createPanels(polygon);
          }
        }
      }
    });

document.addEventListener(CUSTOM_EVENTS.SHAPE_ROTATED, (event) => {
  const { pvId } = event.detail || {};
  if (pvId) {
    const polygon = this.drawingControl.drawnShapes.find(s => s.pvId === pvId && s.type === SHAPE_TYPES.POLYGON);
    if (polygon && !polygon._isBeingPasted) {
      this.isExplicitRotation = true;
      this.updateGridBaseHeading(polygon);
      this.isExplicitRotation = false;
      // IMPORTANT : Recréer les panneaux pour appliquer la nouvelle orientation
      if (this.createdPanelsByShape.has(pvId)) {
        this.updatePanelsPosition(polygon);
      } else {
        this.createPanels(polygon);
      }
    }
  }
});
  }

updateGridBaseHeading(polygon) {
  if (!polygon || typeof polygon.getPath !== 'function') return;
  const path = polygon.getPath();
  if (!path || typeof path.getLength !== 'function' || path.getLength() < 2) return;
  const ref = path.getAt(0);
  const next = path.getAt(1);
  if (!ref || !next || (typeof ref.equals === 'function' && ref.equals(next))) return;
  
  const polygonRealHeading = google.maps.geometry.spherical.computeHeading(ref, next);
  
  if (polygon.shedsCapable) {
    // Rotation des panneaux dissociée de celle du polygone : gridBaseHeading reste fixé à 180° (Sud,
    // correction de 90° dans le sens horaire par rapport à l'ancien axe pour orienter correctement le
    // rampant en Nord-Sud) quoi qu'il arrive au polygone (rotation, édition d'arêtes...). Seul le champ
    // "Rotation shed" (cf. createPanels) réoriente les panneaux.
    if (typeof polygon.initialOrientation === 'undefined') {
      polygon.initialOrientation = 180;
      polygon.polygonInitialHeading = polygonRealHeading;
      polygon.gridBaseHeading = 180;
    }
    polygon.panelsRotation = 0;
  } else {
    polygon.gridBaseHeading = polygonRealHeading;
    polygon.panelsRotation = 0;
  }
}

  togglePanelsVisibility(polygon) {
    if (!polygon || !polygon.pvId) return;
    const pvId = polygon.pvId;
    const panels = this.createdPanelsByShape.get(pvId) || [];
    const hasVisiblePanels = panels.some(panel => panel.getMap());

    if (hasVisiblePanels) {
      panels.forEach(panel => panel.setMap(null));
      this.hiddenByToggle.add(pvId);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
      return;
    }

    if (panels.length === 0) {
      this.createPanels(polygon);
    } else {
      // Récupérer les indices des panneaux supprimés pour ce polygone
      const deletedIndexes = this.getDeletedIndexSet(pvId);
      // Réafficher uniquement les panneaux qui n'ont pas été supprimés
      panels.forEach(panel => {
        // Vérifier si le panneau n'est pas dans la liste des panneaux supprimés
        if (panel.panelIndex && !deletedIndexes.has(panel.panelIndex)) {
          panel.setMap(this.drawingControl.map);
        }
      });
    }
    this.hiddenByToggle.delete(pvId);
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
  }

  updatePanelsPosition(polygon, options = {}) {
    const pvId = polygon.pvId;
    const existing = this.createdPanelsByShape.get(pvId) || [];
    const wereVisible = existing.length > 0 && existing.some(p => p.getMap());
    const hadPanels = existing.length > 0;
    existing.forEach(p => p.setMap(null));
    this.createdPanelsByShape.set(pvId, []);
    if (hadPanels) {
      this.createPanels(polygon, options);
      if (!wereVisible) {
        const panels = this.createdPanelsByShape.get(pvId) || [];
        panels.forEach(panel => panel.setMap(null));
      }
    }

    // Mettre à jour les inputs pour rester cohérent avec l'UI
    setTimeout(() => {
      this.drawingControl.calculateAndUpdatePanelInputs(polygon);
    }, 150);
  }

  cleanupPanelsForShape(pvId) {
    // Nettoie aussi les repères "N° de rangée / nb de groupes" (cf. toggleRowDetailsOverlay) : appelé
    // à la suppression de la forme (DrawingControl.deleteSelectedShape) mais aussi quand le mode de
    // pose/panneau n'est plus sélectionné (FormHandler RULE 1) — dans les deux cas, ces repères n'ont
    // plus lieu d'être affichés. Sans cela, ils restaient visibles sur la carte jusqu'au rechargement
    // de la page.
    if (this.shedRowOverlaysByShape) {
      const existingOverlays = this.shedRowOverlaysByShape.get(pvId) || [];
      existingOverlays.forEach((marker) => { marker.map = null; });
      this.shedRowOverlaysByShape.delete(pvId);
    }
    if (this.shedGroupsByRowForShape) this.shedGroupsByRowForShape.delete(pvId);
    if (this.shedGroupDimsForShape) this.shedGroupDimsForShape.delete(pvId);

    if (!this.createdPanelsByShape.has(pvId)) return;
    const panels = this.createdPanelsByShape.get(pvId);
    panels.forEach(p => p.setMap(null));
    this.createdPanelsByShape.set(pvId, []);
  }

  // Réinitialise les indices supprimés pour un PV (utilisé à la création d'un nouveau polygone)
  initializeDeletedIndexFor(pvId) {
    this.deletedPanelIndexes.set(pvId, new Set());
    // Nettoyer aussi la persistance pour éviter héritage si pvId réutilisé
    DeletedPanelsStorage.remove(p => p.pvId === pvId && p.shapeType === SHAPE_TYPES.POLYGON);
  }

  // Nettoie totalement les indices supprimés pour un PV (utilisé à la suppression du polygone)
  clearDeletedIndicesForShape(pvId) {
    if (this.deletedPanelIndexes.has(pvId)) this.deletedPanelIndexes.delete(pvId);
    DeletedPanelsStorage.remove(p => p.pvId === pvId && p.shapeType === SHAPE_TYPES.POLYGON);
  }

  getDeletedIndexSet(pvId) {
    if (!pvId) return new Set();
    if (this.deletedPanelIndexes.has(pvId)) {
      return this.deletedPanelIndexes.get(pvId);
    }
    const persisted = DeletedPanelsStorage
      .load()
      .filter(panel => panel.pvId === pvId && panel.shapeType === SHAPE_TYPES.POLYGON);
    const storedSet = new Set(persisted.map(panel => panel.panelIndex));
    this.deletedPanelIndexes.set(pvId, storedSet);
    return storedSet;
  }

createPanels(polygon, options = {}) {
  const pvId = polygon.pvId;

  // CORRECTIF (bug "les sheds sont dessinés les uns par-dessus les autres" — panneaux backend
  // laissés visibles sous les panneaux JS recréés) : createPanels() est parfois appelée directement
  // (pas via updatePanelsPosition(), qui elle nettoie déjà l'existant en tête), notamment par
  // FormHandler.js quand createdPanelsByShape.get(pvId) est vide/absent au moment de la vérification
  // — ce qui NE GARANTIT PAS qu'aucun panneau ne soit déjà affiché sur la carte (ex: juste après une
  // correction backend appliquée par calepinage_correction_controller.js::applyPanelsFromBackend,
  // ou juste après un calcul dont centersAlong/centersPerp étaient temporairement vides et n'a laissé
  // que la marge dans le tableau). On nettoie donc systématiquement ici, à CHAQUE appel, les objets
  // déjà posés pour cette forme AVANT de reconstruire — pas cleanupPanelsForShape() (qui viderait
  // aussi les repères de rangée avant qu'ils ne soient recalculés plus bas dans cette même fonction).
  const previousPanels = this.createdPanelsByShape.get(pvId) || [];
  previousPanels.forEach((p) => {
    if (p && typeof p.setMap === 'function') p.setMap(null);
  });

  // Repart d'un état propre à chaque recalcul : seule la branche "groupes de sheds valides" plus bas
  // repeuple cette map — sans ce nettoyage préalable, un ancien découpage par rangée resterait affiché
  // après un changement de configuration qui désactive ou invalide les sheds.
  if (this.shedGroupsByRowForShape) this.shedGroupsByRowForShape.delete(pvId);
  if (this.shedGroupDimsForShape) this.shedGroupDimsForShape.delete(pvId);

  // Préserve le contour (stroke) du polygone shed lui-même : ce recalcul ne crée/nettoie que des
  // objets ENFANTS (panneaux, marge, repères de rangée), jamais le polygone principal — mais on
  // réaffirme systématiquement son contour ici, en repli défensif, puisqu'il a été observé disparaître
  // visuellement après un recalcul (ex: retour de /calculate_shed_shading) sans qu'aucune autre partie
  // du code ne le modifie explicitement.
  if (typeof polygon.setOptions === 'function') {
    polygon.setOptions({
      strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
      strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
    });
  }

  const deletedIndexes = this.getDeletedIndexSet(pvId);
  const path = polygon.getPath();
  const n = path.getLength();
  if (n < 3) return;

  // CORRECTIF (crash navigateur sur grande surface) : au-delà de MAX_SHAPE_AREA_M2, les boucles
  // imbriquées ci-dessous peuvent générer des milliers de google.maps.Polygon (un par panneau,
  // chacun avec son propre listener) et geler le navigateur. Vérification AVANT toute génération.
  const areaM2 = GeometryUtils.calculateArea(path.getArray());
  if (areaM2 > DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2) {
    const msg = `Surface trop vaste (${Math.round(areaM2)} m², limite : ${DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2} m²). Réduisez la taille de la forme avant de continuer.`;
    if (this.drawingControl.errorModal) { this.drawingControl.errorModal.show(msg); } else { alert(msg); }
    this.createdPanelsByShape.set(pvId, []);
    return;
  }

  // Orientation fixe pour les panneaux shed (180° = Sud, rampant Nord-Sud)
  const ref = path.getAt(0);
  const next = path.getAt(1);
  
  // Calculer l'orientation réelle du polygone
  const polygonRealHeading = google.maps.geometry.spherical.computeHeading(ref, next);
  
  // Définir l'orientation de la grille selon le type de polygone
  if (polygon.shedsCapable) {
    // POLYGONES AVEC SHEDS : orientation fixe (corrigée de 90° dans le sens horaire pour un rampant
    // Nord-Sud), ne jamais recalculer
    if (typeof polygon.initialOrientation === 'undefined') {
      // Première création
      polygon.initialOrientation = 180;
      polygon.polygonInitialHeading = polygonRealHeading;
      polygon.gridBaseHeading = 180;
    }
    // NE PAS recalculer lors des modifications - garder l'orientation fixe
    // Supprimer le bloc else qui recalculait gridBaseHeading
    polygon.panelsRotation = 0;
}else {
    // POLYGONES SANS SHEDS : suivre l'orientation du polygone
    if (typeof polygon.gridBaseHeading !== 'number') {
      polygon.gridBaseHeading = polygonRealHeading;
    }
    polygon.panelsRotation = 0;
  }
  // "Rotation shed" : réoriente les panneaux indépendamment du polygone (0° = plein Sud, cf.
  // gridBaseHeading fixé à 180° ci-dessus pour les polygones shed).
  const shedRotationInput = polygon.shedsCapable ? document.querySelector(`#shedRotation-${pvId}`) : null;
  const shedRotation = shedRotationInput ? (parseFloat(shedRotationInput.value) || 0) : 0;
  const heading = polygon.gridBaseHeading + shedRotation;
  const perpHeading = heading + 90;

  // Mémorise la rotation shed effectivement utilisée pour CE calcul complet — sert de référence à
  // rotatePanelsInPlace() pour appliquer uniquement le delta lors des saisies suivantes dans "Rotation
  // shed", sans recalcul complet (cf. cette méthode plus bas).
  if (!this._shedLastRotationByShape) this._shedLastRotationByShape = new Map();
  this._shedLastRotationByShape.set(pvId, shedRotation);

  const config = this.getPanelConfigFromForm(polygon.pvId);
  if (!polygon.shedsCapable) {
    config.shedsEnabled = false;
  }

  // Les panneaux d'un shed ne doivent s'afficher qu'après que l'utilisateur a choisi ses panneaux dans
  // la modale "Liste de favoris" (longueurPanneau/largeurPanneau renseignés) — sans cette garde, un shed
  // fraîchement dessiné affichait immédiatement des panneaux avec des dimensions de repli (2.0m x 1.0m).
  if (polygon.shedsCapable && !config.hasPanelSelected) {
    this.createdPanelsByShape.set(pvId, []);
    this.clearShedResultFields(pvId);
    return;
  }

  // Pas de rotation des panneaux individuels
  const panelsRotation = 0;
  const polygonMetersPath = this.getPolygonMetersPath(path, ref);
  const isClockwise = this.isPolygonClockwise(polygonMetersPath);

  // Calculer dimensions (sans rotation, car panelsRotation = 0)
  const effectiveLength = config.length;
  const effectiveWidth = config.width;

  // Projection au sol du panneau selon la pente du shed, sur l'axe along/longueur (Nord-Sud pour un
  // shed orienté Sud, cf. gridBaseHeading=180° ci-dessus) : c'est l'axe du rampant, celui le long
  // duquel les RANGÉES de sheds sont empilées (une rangée = une ligne de panneaux Est-Ouest, cf. axe
  // perp ci-dessous). Un panneau incliné occupe, une fois projeté au sol, une empreinte plus courte
  // sur cet axe — d'où plus de rangées possibles à pente plus forte pour un espacement identique.
  // L'axe perp (Est-Ouest, panneaux côte à côte au sein d'une même rangée) n'est PAS affecté par la
  // pente. Dégénère vers 1 (aucun effet) hors mode shed, pour ne rien changer au comportement des
  // polygones classiques.
  const shedsCosSlope = config.shedsEnabled ? Math.cos((config.shedTilt || 0) * Math.PI / 180) : 1;
  const alongEffectiveLength = effectiveLength * shedsCosSlope;

  // Calcul des bornes avec dimensions effectives
  let minAlong = Infinity, maxAlong = -Infinity, minPerp = Infinity, maxPerp = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = path.getAt(i);
    const { along, perp } = this.projectPoint(ref, v, heading, perpHeading);
    if (along < minAlong) minAlong = along;
    if (along > maxAlong) maxAlong = along;
    if (perp < minPerp) minPerp = perp;
    if (perp > maxPerp) maxPerp = perp;
  }

  const rangeAlong = Math.max(0, maxAlong - minAlong);
  const rangePerp = Math.max(0, maxPerp - minPerp);

  const availableRangeAlong = Math.max(0, rangeAlong - (2 * config.margin));
  const availableRangePerp = Math.max(0, rangePerp - (2 * config.margin));

  const buildCenters = (available, effSize, spacing, groupSize, groupSpacing) => {
    const centers = [];
    let cursor = 0;
    let idx = 0;
    while (true) {
      const nextCenter = cursor + effSize / 2;
      if (nextCenter + effSize / 2 > available) break;
      centers.push(nextCenter);
      idx += 1;
      const boundary = groupSize > 0 && idx % groupSize === 0;
      cursor += effSize + spacing + (boundary ? groupSpacing : 0);
    }
    return centers;
  };

let centersAlong, centersPerp;
if (config.shedsEnabled) {
  // Vérifier si on est en mode régulier pour recalculer optimalement
  if (config.shedsRegular && config.shedsRows > 0 && config.shedsCols > 0) {
    const optimalLayout = this.calculateOptimalShedsLayout(
      availableRangeAlong,
      availableRangePerp,
      alongEffectiveLength,
      effectiveWidth,
      config
    );
    centersAlong = optimalLayout.centersAlong;
    centersPerp = optimalLayout.centersPerp;
  } else {
    // Mode non-régulier : utiliser buildCenters comme avant
    // Axe along/longueur (Nord-Sud, rampant, projeté par la pente) groupé par "Nb. PV en largeur"
    // (config.shedsCols, cf. son aria-label "dans le rampant d'un shed") / "Esp. entre sheds"
    // (config.shedsColSpacing) — c'est là que s'empilent les rangées de shed. Axe perp/largeur
    // (Est-Ouest, panneaux côte à côte au sein d'une même rangée, non affecté par la pente) groupé
    // par "Nb. PV en longueur" (config.shedsRows) / "Esp. groupe de shed" (config.shedsRowSpacing).
    centersAlong = buildCenters(availableRangeAlong, alongEffectiveLength, config.spacingX, config.shedsCols, config.shedsColSpacing);
    centersPerp = buildCenters(availableRangePerp, effectiveWidth, config.spacingY, config.shedsRows, config.shedsRowSpacing);
  }
} else {
    const stepAlong = effectiveLength + config.spacingX;
    const stepPerp = effectiveWidth + config.spacingY;
    const countAlong = Math.floor(availableRangeAlong / stepAlong);
    const countPerp = Math.floor(availableRangePerp / stepPerp);
    centersAlong = Array.from({ length: countAlong }, (_, i) => i * stepAlong + effectiveLength / 2);
    centersPerp = Array.from({ length: countPerp }, (_, j) => j * stepPerp + effectiveWidth / 2);
  }

  const created = [];

  // Créer un polygone pour visualiser la marge intérieure ("Esp. bordure" / zone tampon orange).
  // IMPORTANT : ce bloc est délibérément placé AVANT le "if (centersAlong.length <= 0 ...) return;"
  // ci-dessous — la marge ne dépend que du tracé du polygone et de config.margin, jamais du nombre
  // de panneaux qui tiennent. Quand ce bloc vivait APRÈS ce retour anticipé, toute configuration
  // (même transitoire, ex: espacement momentanément trop grand pendant la frappe) qui faisait tomber
  // à zéro le nombre de panneaux/groupes de sheds empêchait la marge d'être (re)créée — elle
  // disparaissait alors visuellement jusqu'à ce qu'une configuration valide la recrée. C'est la
  // cause racine du bug "la zone tampon (et les repères de rangée, qui dépendent du même retour
  // anticipé plus bas) disparaît".
  if (config.margin > 0) {
    // Calculer le polygone intérieur en réduisant chaque bord de la marge
    const innerPath = [];

    for (let i = 0; i < n; i++) {
      const current = path.getAt(i);
      const prev = path.getAt((i - 1 + n) % n);
      const next = path.getAt((i + 1) % n);

      // Vecteurs normalisés vers les points adjacents
      const toPrev = google.maps.geometry.spherical.computeHeading(current, prev);
      const toNext = google.maps.geometry.spherical.computeHeading(current, next);

      // Normales perpendiculaires orientées vers l'intérieur selon le sens du polygone
      const normalOffset = isClockwise ? -90 : 90;
      const normalToPrev = toPrev + normalOffset;
      const normalToNext = toNext - normalOffset;

      // Angle entre les deux normales
      let angleDiff = normalToNext - normalToPrev;
      if (angleDiff > 180) angleDiff -= 360;
      if (angleDiff < -180) angleDiff += 360;

      // Direction de la bissectrice intérieure
      let bisector = normalToPrev + angleDiff / 2;

      // Normaliser l'angle
      while (bisector > 180) bisector -= 360;
      while (bisector < -180) bisector += 360;

      // Calculer l'angle entre les deux segments
      let segmentAngle = toNext - toPrev;
      if (segmentAngle > 180) segmentAngle -= 360;
      if (segmentAngle < -180) segmentAngle += 360;

      // Distance de décalage ajustée selon l'angle
      const halfAngleRad = Math.abs(segmentAngle) / 2 * Math.PI / 180;
      const sinHalfAngle = Math.sin(halfAngleRad);

      // Éviter la division par zéro et limiter les valeurs extrêmes
      const offsetDistance = sinHalfAngle > 0.1
        ? Math.min(config.margin / sinHalfAngle, config.margin * 5)
        : config.margin * 5;

      // Créer le point intérieur décalé
      const innerPoint = google.maps.geometry.spherical.computeOffset(
        current,
        offsetDistance,
        bisector
      );

      innerPath.push(innerPoint);
    }

    // Créer le polygone de la marge (zone orange entre le polygone principal et la zone des panneaux)
    const marginPolygon = new google.maps.Polygon({
      paths: [
        // Contour extérieur (polygone principal)
        Array.from({ length: n }, (_, i) => path.getAt(i)),
        // Contour intérieur (zone des panneaux) - dans le sens inverse pour créer un "trou"
        innerPath.reverse()
      ],
      fillColor: MARGIN_COLOR,
      fillOpacity: 0.3,
      strokeWeight: 0,
      zIndex: 1000,
      map: this.drawingControl.map,
      clickable: false
    });

    // Marquer comme élément de marge et l'associer au polygon parent
    marginPolygon.isMarginVisual = true;
    marginPolygon.parentPolygon = polygon;
    marginPolygon.parentPvId = pvId;

    // L'ajouter à la liste created pour qu'il soit supprimé lors du nettoyage
    created.push(marginPolygon);
  }

  if (centersAlong.length <= 0 || centersPerp.length <= 0) {
    // Aucun panneau ne tient (ex: polygone trop petit, espacement momentanément trop grand) : on
    // conserve tout de même la marge déjà créée ci-dessus dans "created" (au lieu de l'écraser par un
    // tableau vide) et on nettoie proprement les champs/repères de rangée (aucun groupe de sheds
    // n'existe dans ce cas), plutôt que de les laisser afficher une valeur obsolète.
    this.createdPanelsByShape.set(polygon.pvId, created);
    this.clearShedResultFields(pvId);
    return;
  }

let startAlong, startPerp;

if (config.shedsEnabled && config.shedsRegular) {
  // En mode régulier optimisé, les centres sont déjà calculés avec leurs offsets
  startAlong = minAlong + config.margin;
  startPerp = minPerp + config.margin;
} else {
  // Mode normal : calculer comme avant
  const usedAlong = (() => {
    if (!config.shedsEnabled) return centersAlong.length * alongEffectiveLength + (centersAlong.length - 1) * config.spacingX;
    const groups = Math.max(0, Math.floor(centersAlong.length / Math.max(1, config.shedsCols)) - (centersAlong.length % Math.max(1, config.shedsCols) === 0 ? 1 : 0));
    return centersAlong.length * alongEffectiveLength + (centersAlong.length - 1) * config.spacingX + groups * config.shedsColSpacing;
  })();
  const usedPerp = (() => {
    if (!config.shedsEnabled) return centersPerp.length * effectiveWidth + (centersPerp.length - 1) * config.spacingY;
    // "Nb. PV en longueur" (shedsRows) et/ou "Esp. groupe de shed" (shedsRowSpacing) à 0 = aucun
    // regroupement sur l'axe perp/largeur (cf. buildCenters/shedsRowsForGroup plus bas) : aucun
    // espace de groupe supplémentaire n'a été inséré entre les panneaux, donc aucun n'est à ajouter
    // ici non plus.
    if (config.shedsRows === 0 || config.shedsRowSpacing === 0) {
      return centersPerp.length * effectiveWidth + (centersPerp.length - 1) * config.spacingY;
    }
    const groups = Math.max(0, Math.floor(centersPerp.length / Math.max(1, config.shedsRows)) - (centersPerp.length % Math.max(1, config.shedsRows) === 0 ? 1 : 0));
    return centersPerp.length * effectiveWidth + (centersPerp.length - 1) * config.spacingY + groups * config.shedsRowSpacing;
  })();

  startAlong = minAlong + config.margin + (availableRangeAlong - usedAlong) / 2;
  startPerp = minPerp + config.margin + (availableRangePerp - usedPerp) / 2;
}

// Nombre de groupes shed valides réellement rendus (cf. "Nombre de Sheds" affiché en fin de fonction) ;
// reste à 0 hors mode groupé (pas de notion de "shed" sans regroupement configuré).
let shedGroupsCount = 0;

// "Nb. PV en longueur" (config.shedsRows) et/ou "Esp. groupe de shed" (shedsRowSpacing) à 0 = aucun
// regroupement sur l'axe perp/largeur ("j", Est-Ouest, non affecté par la pente) : le polygone doit
// se remplir au maximum, en continu, sur cet axe. On normalise alors shedsRowsForGroup à 1 (chaque
// position "j" devient son propre groupe) plutôt que de désactiver entièrement la logique de groupes
// ci-dessous : cela permet à la contrainte de complétude de l'axe along/longueur (ÉTAPE 2.5,
// shedsCols, seul affecté par la pente) de continuer à s'appliquer indépendamment à chaque rangée.
// Les positions/espacements réels (centersAlong/centersPerp) restent inchangés par cette
// normalisation : ils sont déjà calculés en continu quand shedsRows/shedsRowSpacing valent 0 (cf.
// buildCenters, groupSize/groupSpacing à 0 ci-dessus).
const noRowGrouping = config.shedsRows === 0 || config.shedsRowSpacing === 0;
const shedsRowsForGroup = noRowGrouping ? 1 : config.shedsRows;

// ============= PHASE 1: IDENTIFICATION DES GROUPES VALIDES =============
// Le gate ci-dessous reste sur config.shedsCols (id HTML "shedsCols", borné à [1,15], jamais 0) —
// il ne dépend pas de l'axe (along/perp) et reste donc valide tel quel.
if (config.shedsEnabled && config.shedsCols > 0) {


  // Calculer le nombre de groupes (along/rampant groupé par shedsCols, perp/largeur par shedsRowsForGroup)
  const numGroupsCols = Math.ceil(centersAlong.length / config.shedsCols);
  const numGroupsRows = Math.ceil(centersPerp.length / shedsRowsForGroup);

  // Map pour stocker les panneaux potentiels par groupe
  const groupPanels = new Map();
  
  // ÉTAPE 1: Créer tous les panneaux potentiels et les assigner à leurs groupes
  for (let i = 0; i < centersAlong.length; i++) {
    for (let j = 0; j < centersPerp.length; j++) {
      const alongOffset = startAlong + centersAlong[i];
      const perpOffset = startPerp + centersPerp[j];

      // Centre du panneau
      const panelCenter = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(ref, alongOffset, heading),
        perpOffset,
        perpHeading
      );

      // Créer les coins du panneau (halfLength projeté selon la pente shed, cf. alongEffectiveLength)
      const halfLength = alongEffectiveLength / 2;
      const halfWidth = effectiveWidth / 2;

      const panelCorners = [
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading + 180),
          halfWidth,
          perpHeading + 180
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading),
          halfWidth,
          perpHeading + 180
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading),
          halfWidth,
          perpHeading
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading + 180),
          halfWidth,
          perpHeading
        )
      ];

      // Vérifier que tous les coins sont dans le polygone et respectent l'espacement des bords
      const cornersInside =
        google.maps.geometry.poly.containsLocation(panelCorners[0], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[1], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[2], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[3], polygon);

      const respectsMargin = cornersInside &&
        this.isPanelRespectingMargin({
          panelCorners,
          polygonMetersPath,
          refPoint: ref,
          margin: config.margin
        });

      const idxKey = `${i}-${j}`;
      
      // Vérifier si le panneau n'a pas été supprimé par l'utilisateur
      if (deletedIndexes.has(idxKey)) {
        continue;
      }

      // Déterminer à quel groupe appartient ce panneau (i=along/rampant groupé par shedsCols,
      // j=perp/largeur groupé par shedsRowsForGroup)
      const groupCol = Math.floor(i / config.shedsCols);
      const groupRow = Math.floor(j / shedsRowsForGroup);
      const groupKey = `${groupCol}-${groupRow}`;

      if (!groupPanels.has(groupKey)) {
        groupPanels.set(groupKey, []);
      }

      // Stocker les informations du panneau si valide
      if (cornersInside && respectsMargin) {
        groupPanels.get(groupKey).push({
          i, j, idxKey, panelCorners, valid: true
        });
      } else {
        groupPanels.get(groupKey).push({
          i, j, idxKey, panelCorners, valid: false
        });
      }
    }
  }

// ÉTAPE 2: Analyser chaque groupe et déterminer s'il est valide
  const validGroups = new Set();
  const requiredPanelsPerGroup = shedsRowsForGroup * config.shedsCols; // produit symétrique, inchangé par le swap
  for (const [groupKey, panels] of groupPanels.entries()) {
    const [groupCol, groupRow] = groupKey.split('-').map(Number);

    // Compter les panneaux valides dans ce groupe
    const validPanels = panels.filter(p => p.valid);
    const validCount = validPanels.length;

    // Calculer les indices de début et fin pour ce groupe (along/rampant groupé par shedsCols,
    // perp/largeur par shedsRowsForGroup)
    const startI = groupCol * config.shedsCols;
    const endI = Math.min(startI + config.shedsCols, centersAlong.length);
    const startJ = groupRow * shedsRowsForGroup;
    const endJ = Math.min(startJ + shedsRowsForGroup, centersPerp.length);

    // Créer la matrice de disposition pour ce groupe
    const groupMatrix = [];
    for (let j = startJ; j < endJ; j++) {
      const row = [];
      for (let i = startI; i < endI; i++) {
        const panel = panels.find(p => p.i === i && p.j === j);
        row.push(panel && panel.valid ? 1 : 0);
      }
      groupMatrix.push(row);
    }
    
    // MODIFICATION ICI : Validation conditionnelle selon shedsRegular
    if (config.shedsRegular) {
      // Mode strict : valider seulement si le groupe a exactement le nombre requis de panneaux
      if (validCount === requiredPanelsPerGroup) {
        validGroups.add(groupKey);
      }
    } else {
      // Mode permissif : valider le groupe s'il a au moins un panneau valide
      if (validCount > 0) {
        validGroups.add(groupKey);
      }
    }
  }

  // ÉTAPE 2.5: Filtrer les colonnes incomplètes dans chaque groupe valide
  // Cette étape s'applique TOUJOURS, peu importe shedsRegular
  const filteredGroupPanels = new Map();
  
  for (const groupKey of validGroups) {
    const panels = groupPanels.get(groupKey);
    const [groupCol, groupRow] = groupKey.split('-').map(Number);
    
    const startI = groupCol * config.shedsCols;
    const endI = Math.min(startI + config.shedsCols, centersAlong.length);
    const startJ = groupRow * shedsRowsForGroup;
    const endJ = Math.min(startJ + shedsRowsForGroup, centersPerp.length);

    // Identifier les colonnes complètes (qui ont exactement "shedsRowsForGroup" panneaux valides
    // sur l'axe perp/largeur)
    const completeColumns = new Set();

    for (let i = startI; i < endI; i++) {
      let columnPanelCount = 0;

      for (let j = startJ; j < endJ; j++) {
        const panel = panels.find(p => p.i === i && p.j === j);
        if (panel && panel.valid) {
          columnPanelCount++;
        }
      }

      // Colonne complète = exactement shedsRowsForGroup panneaux
      if (columnPanelCount === shedsRowsForGroup) {
        completeColumns.add(i);
      }
    }

    // Une "rangée" de shed doit toujours contenir exactement "Nb. PV en largeur" (shedsCols)
    // panneaux sur l'axe along/rampant : si certaines colonnes de ce groupe sont incomplètes
    // (cf. ci-dessus) au point qu'il n'en reste plus assez pour former une rangée pleine, on
    // rejette le groupe entier plutôt que d'afficher une rangée partielle (ex: 1 panneau au lieu de 2).
    if (completeColumns.size < config.shedsCols) {
      continue;
    }

    // Filtrer pour ne garder que les panneaux des colonnes complètes
    const filteredPanels = panels.filter(p =>
      p.valid && completeColumns.has(p.i)
    );

    filteredGroupPanels.set(groupKey, filteredPanels);
  }

  // ÉTAPE 3: Créer uniquement les panneaux des groupes valides (avec colonnes complètes)

  

for (const [groupKey, filteredPanels] of filteredGroupPanels.entries()) {
    for (const panelInfo of filteredPanels) {
      // Les panneaux sont déjà filtrés (valides + colonnes complètes)

      const panel = new google.maps.Polygon({
        paths: panelInfo.panelCorners,
        fillColor: STYLES.SOLAR_PANEL.fillColor,
        fillOpacity: STYLES.SOLAR_PANEL.fillOpacity,
        strokeColor: STYLES.SOLAR_PANEL.strokeColor,
        strokeOpacity: STYLES.SOLAR_PANEL.strokeOpacity,
        strokeWeight: STYLES.SOLAR_PANEL.strokeWeight,
        zIndex: STYLES.SOLAR_PANEL.zIndex,
        map: this.drawingControl.map,
        // CORRECTIF (bug rapporté : "impossible de sélectionner/déplacer la géométrie une fois les
        // panneaux ajoutés") : un panneau clickable:true intercepte TOUS les évènements souris
        // (click ET mousedown, donc aussi l'amorce d'un glissé natif) de la zone qu'il recouvre —
        // seul le mode suppression/restauration (boolShowHide, cf. son listener 'click' juste en
        // dessous) a réellement besoin que les panneaux soient cliquables ; sinon, clickable:false
        // les rend transparents aux évènements souris (même principe déjà utilisé par
        // ShedPolygon.js) et laisse le clic/glissé atteindre le polygone parent en dessous.
        // Réajusté en direct sur tous les panneaux existants par toggleBoolShowHide() ci-dessous.
        clickable: this.boolShowHide,
      });
      panel.parentPvId = pvId;
      panel.panelIndex = panelInfo.idxKey;
      panel.isPanelSolaire = true;

      google.maps.event.addListener(panel, 'click', (event) => {
        if (!this.boolShowHide) return;
        if (panel.isMarginVisual) return;
        
        event.stop();
        panel.setMap(null);
        deletedIndexes.add(panelInfo.idxKey);
        DeletedPanelsStorage.add({ pvId: pvId, panelIndex: panelInfo.idxKey, shapeType: SHAPE_TYPES.POLYGON });
        
        // Recréer tous les panneaux (et la marge) après suppression
        this.updatePanelsPosition(polygon);

      });
      created.push(panel);
    }
  }

  // Nombre de sheds = nombre de groupes réellement rendus après filtrage de complétude (colonnes
  // complètes en profondeur ET rangée complète en largeur, cf. ÉTAPE 2.5 ci-dessus), tous groupes
  // confondus (axe longueur x axe largeur) — et non "validGroups.size", qui peut compter des groupes
  // finissant sans aucun panneau après filtrage.
  shedGroupsCount = Array.from(filteredGroupPanels.values()).filter(arr => arr.length > 0).length;

  // Agrégation "groupes de sheds par rangée" (rowIndex -> nombre de groupes + point le plus à
  // l'Ouest de la rangée). Une "rangée" (au sens anti-ombrage, "Esp. entre sheds") est un pas le
  // long de l'axe along/rampant ("i") : c'est CET axe qui est espacé par shedsColSpacing entre
  // groupes consécutifs (cf. computeShedShadingFallback/calcul_shed_shading.py, qui raisonnent tous
  // deux sur la profondeur cumulée de shedsCols panneaux le long de cet axe). groupCol (premier
  // token de groupKey) indexe donc la rangée ; groupRow (second token) indexe la position du
  // groupe DANS la rangée, le long de l'axe perp/largeur ("j", Est-Ouest). Réutilisé pour le champ
  // "Nb. de rangée de shed" (nombre total de rangées), le menu déroulant "Analyse par rangée" et les
  // repères sur le plan ("Afficher les détails des rangées").
  const groupsByRow = new Map();
  for (const [groupKey, filteredPanels] of filteredGroupPanels.entries()) {
    if (filteredPanels.length === 0) continue;
    const rowIndex = Number(groupKey.split('-')[0]);
    let entry = groupsByRow.get(rowIndex);
    if (!entry) {
      // latSum/latCount : latitude moyenne de la rangée, utilisée pour l'AFFICHAGE (numérotation
      // nord -> sud, cf. toggleRowDetailsOverlay) — indépendante de rowIndex (=groupCol), qui suit
      // l'axe interne along/rampant et ne correspond pas forcément à une direction géographique fixe.
      entry = { count: 0, leftPoint: null, leftLng: Infinity, latSum: 0, latCount: 0 };
      groupsByRow.set(rowIndex, entry);
    }
    entry.count += 1;
    filteredPanels.forEach((p) => {
      p.panelCorners.forEach((corner) => {
        const lng = corner.lng();
        if (lng < entry.leftLng) {
          entry.leftLng = lng;
          entry.leftPoint = corner;
        }
        entry.latSum += corner.lat();
        entry.latCount += 1;
      });
    });
  }
  this.shedGroupsByRowForShape = this.shedGroupsByRowForShape || new Map();
  this.shedGroupsByRowForShape.set(pvId, groupsByRow);
  this.shedGroupDimsForShape = this.shedGroupDimsForShape || new Map();
  this.shedGroupDimsForShape.set(pvId, { cols: config.shedsCols, rowsPerGroup: shedsRowsForGroup, noRowGrouping });

} else {
  // ============= MODE SANS SHEDS (CODE ORIGINAL) =============
  for (let i = 0; i < centersAlong.length; i++) {
    for (let j = 0; j < centersPerp.length; j++) {
      const alongOffset = startAlong + centersAlong[i];
      const perpOffset = startPerp + centersPerp[j];

      const panelCenter = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(ref, alongOffset, heading),
        perpOffset,
        perpHeading
      );

      // halfLength projeté selon la pente shed (identique hors mode shed, cf. alongEffectiveLength)
      const halfLength = alongEffectiveLength / 2;
      const halfWidth = effectiveWidth / 2;

      const panelCorners = [
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading + 180),
          halfWidth,
          perpHeading + 180
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading),
          halfWidth,
          perpHeading + 180
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading),
          halfWidth,
          perpHeading
        ),
        google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(panelCenter, halfLength, heading + 180),
          halfWidth,
          perpHeading
        )
      ];

      const cornersInside =
        google.maps.geometry.poly.containsLocation(panelCorners[0], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[1], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[2], polygon) &&
        google.maps.geometry.poly.containsLocation(panelCorners[3], polygon);

      const respectsMargin = cornersInside &&
        this.isPanelRespectingMargin({
          panelCorners,
          polygonMetersPath,
          refPoint: ref,
          margin: config.margin
        });

      if (cornersInside && respectsMargin) {
        const idxKey = `${i}-${j}`;
        if (deletedIndexes.has(idxKey)) {
          continue;
        }

        const panel = new google.maps.Polygon({
          paths: panelCorners,
          fillColor: STYLES.SOLAR_PANEL.fillColor,
          fillOpacity: STYLES.SOLAR_PANEL.fillOpacity,
          strokeColor: STYLES.SOLAR_PANEL.strokeColor,
          strokeOpacity: STYLES.SOLAR_PANEL.strokeOpacity,
          strokeWeight: STYLES.SOLAR_PANEL.strokeWeight,
          zIndex: STYLES.SOLAR_PANEL.zIndex,
          map: this.drawingControl.map,
          // CORRECTIF (bug rapporté : perte d'interactivité de la géométrie une fois les panneaux
          // ajoutés) : cf. commentaire équivalent plus haut (mode shed) — clickable uniquement en
          // mode suppression/restauration, sinon transparent aux évènements souris.
          clickable: this.boolShowHide,
        });
        panel.parentPvId = pvId;
        panel.panelIndex = idxKey;
        panel.isPanelSolaire = true;

        google.maps.event.addListener(panel, 'click', (event) => {
          if (!this.boolShowHide) return;
          if (panel.isMarginVisual) return;
          
          event.stop();
          panel.setMap(null);
          deletedIndexes.add(idxKey);
          DeletedPanelsStorage.add({ pvId: pvId, panelIndex: idxKey, shapeType: SHAPE_TYPES.POLYGON });

          // Recréer tous les panneaux (et la marge) après suppression
          this.updatePanelsPosition(polygon);

        });
        created.push(panel);
      }
    }
  }
}

  // Contrôle strict de la puissance maximale de licence (+ tolérance configurable)
  let pPanneauW = 400;
  try {
    const pInput = document.querySelector(`#puissancePanneau-${polygon.pvId}`) || document.getElementById('puissancePanneau');
    if (pInput && parseFloat(pInput.value) > 0) {
      pPanneauW = parseFloat(pInput.value);
    }
  } catch (_) {}

  const shapeKwc = (created.length * pPanneauW) / 1000.0;
  let otherShapesKwc = 0;
  try {
    const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
    if (savedData.shapes) {
      Object.keys(savedData.shapes).forEach(id => {
        if (id !== polygon.pvId && savedData.shapes[id]?.gridInfo) {
          const count = Number(savedData.shapes[id].gridInfo.totalPanels || 0);
          const p = Number(savedData.formData?.[id]?.puissancePanneau || 400);
          otherShapesKwc += (count * p) / 1000.0;
        }
      });
    }
  } catch (_) {}

  const totalProjectedKwc = otherShapesKwc + shapeKwc;
  if (typeof window.checkPowerLicenceCompliance === 'function') {
    const compliance = window.checkPowerLicenceCompliance(totalProjectedKwc);
    if (!compliance.allowed) {
      // Bloquer immédiatement le calcul du calepinage
      // Ne rien afficher du tout (pas de résultats / indicateurs)
      // Supprimer / annuler la géométrie et les panneaux sur la carte
      created.forEach(p => { if (p && typeof p.setMap === 'function') p.setMap(null); });
      this.createdPanelsByShape.delete(polygon.pvId);
      if (typeof polygon.setMap === 'function') polygon.setMap(null);
      if (this.drawingControl.drawnShapes) {
        const idx = this.drawingControl.drawnShapes.indexOf(polygon);
        if (idx > -1) this.drawingControl.drawnShapes.splice(idx, 1);
      }
      if (this.drawingControl.usedIds) this.drawingControl.usedIds.delete(polygon.pvId);

      // Figer / désactiver le bouton « Calculer et visualiser »
      if (typeof window.setCalculerVisualiserDisabled === 'function') {
        window.setCalculerVisualiserDisabled(true, compliance.message);
      }

      const msg = `${compliance.message}\nLe calepinage et le tracé ont été annulés.`;
      if (this.drawingControl.errorModal) {
        this.drawingControl.errorModal.show(msg);
      } else {
        alert(msg);
      }
      return;
    }
  }

  this.createdPanelsByShape.set(polygon.pvId, created);

  // CORRECTIF (résultats affichés = estimation JS locale, jamais le vrai résultat backend vérifié) :
  // "Nombre de Sheds"/"Ratio de couverture" et les indicateurs backend du panneau "Résultats" ne
  // doivent provenir QUE du bouton "Calculer" (cf. calepinage_correction_controller.js::correctShape
  // ::updateShedFormFields) — on ne les calcule/affiche plus ici. Toute création de panneaux JS
  // locale (déplacement de sommet, changement de champ shed, etc.) invalide donc ces résultats,
  // SAUF pendant une restauration depuis le stockage (_isRestoringShapes, posé par
  // StorageManager.loadShapesFromStorage()) : dans ce cas on laisse les résultats persistés
  // (potentiellement encore valides) tels quels plutôt que de les effacer au simple rechargement.
  // Pendant une restauration depuis le stockage (_isRestoringShapes), on laisse les résultats
  // persistés (cf. constants.js::FORM_FIELDS_MAPPING) tels quels dans les champs — le modal
  // "Résultats" (cf. shed_results_modal.js) n'est PAS rouvert automatiquement (comportement
  // intrusif à chaque chargement de page) ; l'utilisateur peut le rouvrir via "Voir les résultats".
  if (!this.drawingControl._isRestoringShapes) {
    this.invalidateShedBackendResults(pvId);
  }

  // "NB shed en largeur" / menu "Analyse par rangée" / repères sur le plan : cf. groupsByRow ci-dessus.
  // Outil d'inspection du dessin JS courant (pas un résultat backend), donc toujours à jour.
  this.updateShedRowSelectorUI(pvId);

  // "% Perte d'ombrage entre shed" : la formule géométrique ponctuelle (computeShedShadingFallback)
  // sert d'estimation INSTANTANÉE affichée immédiatement, calculée uniquement à partir de
  // "Esp. entre sheds" (config.shedsColSpacing) et de la géométrie/latitude du projet — puis
  // remplacée (si une adresse projet est géocodée) par la valeur backend pvlib, physiquement fiable
  // et cohérente avec PVsyst — cf. requestShedShadingFromBackend() / calcul_shed_shading.py. Aucune
  // des deux méthodes n'expose ni ne dépend d'une "distance optimale" (champ supprimé).
  if (config.shedsEnabled) {
    const shading = this.computeShedShadingFallback(config);
    const perteOmbrageInput = document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed');
    if (perteOmbrageInput) perteOmbrageInput.value = shading.lossPercent !== null ? shading.lossPercent.toFixed(1) : '';
    // options.skipShadingRequest : évite une boucle infinie quand requestShedShadingFromBackend()
    // lui-même ré-invoque updatePanelsPosition()/createPanels() (cf. plus bas) pour réafficher
    // proprement la marge/les repères de rangée après réception de la réponse serveur.
    if (!options.skipShadingRequest) {
      this.requestShedShadingFromBackend(pvId, config);
    }
  } else {
    this.clearShedShadingFields(pvId);
  }

  setTimeout(() => {
    this.drawingControl.calculateAndUpdatePanelInputs(polygon);
  }, 150);

  // Réappliquer le masquage obstacle après création
  if (this.drawingControl.obstaclePanels) {
    this.drawingControl.obstaclePanels.requestRefresh();
  }
}

  // Vide UNIQUEMENT les indicateurs backend du panneau "Résultats" (nombreSheds/ratioCouverture +
  // les 5 champs ajoutés + Nb. de rangée de shed/Analyse par rangée/Nb. groupes dans la rangée) et
  // masque le panneau — ces résultats ne doivent provenir QUE du bouton "Calculer" (cf.
  // calepinage_correction_controller.js::correctShape). Ne touche PAS à
  // shedGroupsByRowForShape/shedGroupDimsForShape (données JS locales pour les repères de rangée sur
  // le plan, cf. toggleRowDetailsOverlay — non concernées par cette invalidation).
  invalidateShedBackendResults(pvId) {
    const getField = (id) => document.querySelector(`#${id}-${pvId}`) || document.getElementById(id);
    ['nombreSheds', 'ratioCouverture', 'surfacePolygoneShed', 'surfacePanneauxInclineShed',
      'surfacePanneauxProjeteeShed', 'nombrePanneauxShed', 'puissanceShedKwc', 'shedDimensions',
      'shedGroupSurface', 'shedNbPvCalepinage', 'shedsNbLargeur', 'shedGroupsInRow'].forEach((id) => {
      const el = getField(id);
      if (el) el.value = '';
    });
    const rowSelector = getField('shedRowSelector');
    if (rowSelector) rowSelector.innerHTML = '';
    if (this.shedBackendGroupsByRowForShape) this.shedBackendGroupsByRowForShape.delete(pvId);
    if (this.shedBackendPositionsByRowForShape) this.shedBackendPositionsByRowForShape.delete(pvId);

    // Panneau "Résultats" déplacé dans un modal (cf. shed_results_modal.js) : le fermer s'il était
    // ouvert, puisque son contenu vient d'être vidé (résultats invalidés, plus rien de pertinent à
    // montrer tant que "Calculer" n'a pas été recliqué).
    const resultsModal = getField('shedResultsModal');
    if (resultsModal) resultsModal.style.setProperty('display', 'none', 'important');
  }

  /**
   * Fait pivoter visuellement, EN PLACE, les panneaux déjà dessinés d'un shed lorsque "Rotation shed"
   * change — sans recalculer/régénérer le calepinage (cf. règle "les panneaux restent affichés jusqu'au
   * clic sur Calculer"). Applique uniquement le DELTA entre la nouvelle valeur et celle utilisée lors du
   * dernier calcul complet (cf. _shedLastRotationByShape, posé par createPanels()), autour du centroïde
   * des panneaux actuellement affichés — cohérent avec le fait que la flèche/le label (updateRoofVisuals)
   * suivent déjà "Rotation shed" en direct : les panneaux doivent désormais faire de même visuellement.
   * La zone tampon (isMarginVisual) n'est volontairement PAS incluse : elle représente le contour du
   * polygone tracé, indépendant de l'orientation des panneaux.
   * @param {string} pvId
   * @param {number} newShedRotation - Nouvelle valeur du champ "Rotation shed"
   */
  rotatePanelsInPlace(pvId, newShedRotation) {
    const existing = this.createdPanelsByShape.get(pvId) || [];
    const panels = existing.filter(p => p && p.isPanelSolaire && typeof p.getPath === 'function');
    if (panels.length === 0) return;

    if (!this._shedLastRotationByShape) this._shedLastRotationByShape = new Map();
    const lastRotation = this._shedLastRotationByShape.has(pvId) ? this._shedLastRotationByShape.get(pvId) : 0;
    const delta = newShedRotation - lastRotation;
    if (!delta) return;

    const bounds = new google.maps.LatLngBounds();
    panels.forEach((p) => p.getPath().forEach((pt) => bounds.extend(pt)));
    const pivot = bounds.getCenter();

    // CORRECTIF (sens de rotation inversé — 30° tournait vers l'Est au lieu du Sud-Ouest) :
    // GeometryUtils.rotatePoint() applique une rotation mathématique standard (sens antihoraire pour un
    // angle positif, repère x=Est/y=Nord), alors que "Rotation shed" suit le référentiel Sud=0°/
    // Ouest=+90°/Est=-90°/Nord=180° — équivalent à un cap compas (Nord=0, sens horaire) décalé de 180°,
    // donc une valeur croissante tourne dans le sens HORAIRE (Sud -> Ouest), l'inverse du sens antihoraire
    // de rotatePoint(). D'où le signe opposé ici, pour rester cohérent avec le calcul backend Python
    // (heading = gridBaseHeading + shedRotation, injecté tel quel dans computeOffset, qui utilise déjà
    // le cap compas standard) et avec la flèche/le label (CSS rotate(), horaire par convention).
    panels.forEach((p) => {
      const rotatedPath = p.getPath().getArray().map((pt) => GeometryUtils.rotatePoint(pt, pivot, -delta));
      p.setPath(rotatedPath);
    });

    this._shedLastRotationByShape.set(pvId, newShedRotation);
  }

  /**
   * Stocke/retourne la répartition backend "nombre de groupes valides par rangée" (cf.
   * verification.py::_verify_shed -> details_backend.groupes_par_rangee, une simple liste ordonnée
   * rangée 1, 2, ... ) — utilisée pour peupler "Analyse par rangée"/"Nb. groupes dans la rangée" avec
   * la vraie répartition vérifiée par le backend, plutôt que l'agrégation JS locale (getShedGroupsByRow).
   * @param {string} pvId
   * @param {number[]} groupesParRangee
   */
  setShedBackendRowGroups(pvId, groupesParRangee) {
    if (!this.shedBackendGroupsByRowForShape) this.shedBackendGroupsByRowForShape = new Map();
    this.shedBackendGroupsByRowForShape.set(pvId, groupesParRangee || []);
  }

  getShedBackendRowGroups(pvId) {
    if (!this.shedBackendGroupsByRowForShape) return [];
    return this.shedBackendGroupsByRowForShape.get(pvId) || [];
  }

  /**
   * Stocke/retourne les positions backend (même ordre/longueur que setShedBackendRowGroups) du point
   * le plus à l'Ouest de chaque rangée — cf. verification.py::_verify_shed ->
   * details_backend.groupes_par_rangee_positions. Permet de positionner les repères de rangée sur des
   * coordonnées backend-vérifiées, cohérentes avec les panneaux réellement appliqués après "Calculer"
   * (cf. toggleRowDetailsOverlay), plutôt que sur l'agrégation JS locale (getShedGroupsByRow), qui peut
   * être désynchronisée (grille légèrement différente) une fois les panneaux backend appliqués.
   * @param {string} pvId
   * @param {{lat: number, lng: number}[]} positions
   */
  setShedBackendRowPositions(pvId, positions) {
    if (!this.shedBackendPositionsByRowForShape) this.shedBackendPositionsByRowForShape = new Map();
    this.shedBackendPositionsByRowForShape.set(pvId, positions || []);
  }

  getShedBackendRowPositions(pvId) {
    if (!this.shedBackendPositionsByRowForShape) return [];
    return this.shedBackendPositionsByRowForShape.get(pvId) || [];
  }

  // Vide les champs de résultat du calepinage shed (y compris shedsNbLargeur/"Analyse par
  // rangée"/repères de rangée) — utilisé uniquement quand il n'y a réellement AUCUN panneau à
  // afficher (aucun panneau favori choisi, ou aucun centre valide dans createPanels()) : dans ces
  // cas, contrairement au chemin normal, il n'existe aucune donnée de groupage fraîche à préserver.
  clearShedResultFields(pvId) {
    const getField = (id) => document.querySelector(`#${id}-${pvId}`) || document.getElementById(id);
    this.invalidateShedBackendResults(pvId);

    const shedsNbLargeurInput = getField('shedsNbLargeur');
    if (shedsNbLargeurInput) shedsNbLargeurInput.value = '';
    if (this.shedGroupsByRowForShape) this.shedGroupsByRowForShape.delete(pvId);
    if (this.shedGroupDimsForShape) this.shedGroupDimsForShape.delete(pvId);
    this.updateShedRowSelectorUI(pvId);
    this.clearShedShadingFields(pvId);
  }

  /**
   * Retourne l'agrégation "groupes de sheds par rangée" pour une forme (cf. createPanels(),
   * this.shedGroupsByRowForShape), sous forme Map<rowIndex, {count, leftPoint}> — rowIndex = groupCol,
   * l'axe along/rampant espacé par "Esp. entre sheds" (anti-ombrage). Map vide si la forme n'a pas
   * (encore) de sheds valides.
   * @param {string} pvId
   * @returns {Map<number, {count: number, leftPoint: google.maps.LatLng|null}>}
   */
  getShedGroupsByRow(pvId) {
    if (!this.shedGroupsByRowForShape) return new Map();
    return this.shedGroupsByRowForShape.get(pvId) || new Map();
  }

  /**
   * Retourne les dimensions d'un groupe de sheds pour une forme (cf. createPanels(),
   * this.shedGroupDimsForShape) : {cols, rowsPerGroup} — cols = config.shedsCols (panneaux en
   * profondeur, along/rampant), rowsPerGroup = shedsRowsForGroup (panneaux en largeur, perp). Utilisé
   * pour l'étiquetage "(2X10)" des repères de rangée.
   * @param {string} pvId
   * @returns {{cols: number, rowsPerGroup: number}|null}
   */
  getShedGroupDims(pvId) {
    if (!this.shedGroupDimsForShape) return null;
    return this.shedGroupDimsForShape.get(pvId) || null;
  }

  /**
   * Synchronise, après chaque createPanels(), les repères de rangée sur le plan (si la case
   * "Afficher les détails des rangées" est cochée) à partir de l'agrégation JS locale
   * (getShedGroupsByRow) — ces repères visuels correspondent au dessin JS courant, indépendamment du
   * bouton "Calculer".
   * CORRECTIF (bug "Nb. de rangée de shed / Analyse par rangée / Nb. groupes dans la rangée
   * affichent des données JS au lieu des données backend") : cette méthode remplissait auparavant
   * aussi ces 3 champs de formulaire à partir de la même agrégation JS locale, écrasant
   * systématiquement (à chaque createPanels(), donc à chaque frappe) les valeurs posées par le
   * backend après un clic "Calculer" — ces 3 champs sont désormais exclusivement renseignés par
   * calepinage_correction_controller.js::updateShedFormFields (résultat backend), et réinitialisés
   * par invalidateShedBackendResults() comme le reste du panneau "Résultats".
   * @param {string} pvId
   */
  updateShedRowSelectorUI(pvId) {
    const rowDetailsCheckbox = document.querySelector(`#shedsShowRowDetails-${pvId}`) || document.getElementById('shedsShowRowDetails');
    this.toggleRowDetailsOverlay(pvId, !!(rowDetailsCheckbox && rowDetailsCheckbox.checked));
  }

  /**
   * Affiche ou masque, sur le plan, un repère textuel ("R{n}-{c} groupe(s) (colsXrows= totalPV)", ou
   * "R{n}- (totalPV)" en mode "remplissage maximal") positionné à l'extrémité Ouest de chaque rangée
   * de sheds — cf. case à cocher "Afficher les détails des rangées". Réutilise le pattern
   * d'AdvancedMarkerElement déjà établi pour la flèche d'azimut (MeasurementControl.createOrUpdateAzimuthArrow).
   *
   * CORRECTIF (numérotation + comptages R1/dernière rangée incohérents) :
   * - Numérotation : auparavant triée par rowIndex (=groupCol, l'index interne de l'axe along/
   *   rampant), qui ne correspond pas forcément à une direction géographique fixe selon l'orientation
   *   du polygone. On trie maintenant par latitude moyenne DÉCROISSANTE (nord -> sud, du haut vers le
   *   bas), conformément à la convention demandée, indépendamment de cet axe interne.
   * - Comptages : auparavant issus de l'agrégation JS locale (grille Google Maps), qui peut légèrement
   *   diverger de la grille Shapely faisant autorité (cf. verification.py), surtout sur les rangées de
   *   bord (première/dernière). On utilise maintenant le nombre de groupes VÉRIFIÉ PAR LE BACKEND
   *   (details_backend.groupes_par_rangee, cf. setShedBackendRowGroups) quand disponible, l'agrégation
   *   JS locale ne servant plus que de position géographique (leftPoint) et de repli si "Calculer"
   *   n'a pas encore été cliqué. Le backend ordonne sa liste par rowIndex croissant (même convention
   *   que rowIndex ici) : on relie donc chaque rowIndex à sa valeur backend par position dans cet ordre
   *   ascendant, AVANT de réordonner pour l'affichage nord -> sud.
   * @param {string} pvId
   * @param {boolean} visible
   */
  async toggleRowDetailsOverlay(pvId, visible) {
    if (!this.shedRowOverlaysByShape) this.shedRowOverlaysByShape = new Map();

    // Toujours nettoyer les repères existants avant de les recréer (évite doublons/décalages après un
    // recalcul de calepinage).
    const existing = this.shedRowOverlaysByShape.get(pvId) || [];
    existing.forEach((marker) => { marker.map = null; });
    this.shedRowOverlaysByShape.delete(pvId);

    if (!visible) return;

    const groupsByRow = this.getShedGroupsByRow(pvId);
    if (groupsByRow.size === 0) return;

    // Association rowIndex -> nombre de groupes vérifié par le backend, par position dans l'ordre
    // ascendant de rowIndex (convention partagée avec details_backend.groupes_par_rangee).
    const backendCounts = this.getShedBackendRowGroups(pvId);
    const ascendingRowIndexes = Array.from(groupsByRow.keys()).sort((a, b) => a - b);
    const backendCountByRowIndex = new Map();
    if (Array.isArray(backendCounts) && backendCounts.length === ascendingRowIndexes.length) {
      ascendingRowIndexes.forEach((rowIndex, i) => backendCountByRowIndex.set(rowIndex, backendCounts[i]));
    }

    // Même association pour la POSITION du repère (cf. details_backend.groupes_par_rangee_positions,
    // même ordre/longueur que groupes_par_rangee) : place le repère sur les coordonnées des panneaux
    // réellement appliqués après "Calculer", plutôt que sur l'agrégation JS locale (potentiellement
    // désynchronisée). Repli sur entry.leftPoint (JS local) si absente/désynchronisée.
    const backendPositions = this.getShedBackendRowPositions(pvId);
    const backendPositionByRowIndex = new Map();
    if (Array.isArray(backendPositions) && backendPositions.length === ascendingRowIndexes.length) {
      ascendingRowIndexes.forEach((rowIndex, i) => {
        const pos = backendPositions[i];
        if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
          backendPositionByRowIndex.set(rowIndex, new google.maps.LatLng(pos.lat, pos.lng));
        }
      });
    }

    // Ordre d'affichage : nord -> sud (latitude décroissante). Priorité à la latitude de la position
    // backend (celle réellement utilisée pour placer le repère, cf. markerPosition plus bas) quand
    // disponible, pour que le tri et le placement s'appuient sur la même source de coordonnées.
    const rowLatitude = (rowIndex) => {
      const backendPos = backendPositionByRowIndex.get(rowIndex);
      if (backendPos) return backendPos.lat();
      const entry = groupsByRow.get(rowIndex);
      return (entry && entry.latCount > 0) ? entry.latSum / entry.latCount : 0;
    };
    const displayRowIndexes = ascendingRowIndexes.slice().sort((a, b) => rowLatitude(b) - rowLatitude(a));

    const dims = this.getShedGroupDims(pvId);
    const dimsLabel = dims ? `${dims.cols}X${dims.rowsPerGroup}` : '';

    if (!this.drawingControl.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      this.drawingControl.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    const markers = [];
    displayRowIndexes.forEach((rowIndex, displayIndex) => {
      const entry = groupsByRow.get(rowIndex);
      const markerPosition = backendPositionByRowIndex.get(rowIndex) || (entry && entry.leftPoint);
      if (!markerPosition) return;

      const groupCount = backendCountByRowIndex.has(rowIndex) ? backendCountByRowIndex.get(rowIndex) : (entry ? entry.count : 0);

      const el = document.createElement('div');
      el.className = `shed-row-label-${pvId}`;
      el.style.cssText = `
        transform: translate(-100%, -50%);
        background: rgba(255,255,255,0.92);
        border: 1px solid #333;
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
      `;

      if (dims && dims.noRowGrouping) {
        // "Nb. PV en longueur" = 0 : pas de notion de groupe pertinente pour l'utilisateur, on
        // affiche directement le nombre total de panneaux de la rangée. Ex. "R1- (50PV)".
        const totalPv = groupCount * (dims.cols || 1) * (dims.rowsPerGroup || 1);
        el.textContent = `R${displayIndex + 1}- (${totalPv}PV)`;
      } else {
        // Nomenclature imposée : "R{n}-{c} groupe(s) (colsXrows= totalPV)", ex. "R7-3 groupes (2X10= 60pv)".
        // Le total est celui de TOUTE LA RANGÉE (groupCount groupes), pas d'un seul groupe.
        const groupWord = groupCount > 1 ? 'groupes' : 'groupe';
        const totalLabel = dims ? `= ${groupCount * dims.cols * dims.rowsPerGroup}pv` : '';
        el.textContent = `R${displayIndex + 1}-${groupCount} ${groupWord}${dimsLabel ? ` (${dimsLabel}${totalLabel})` : ''}`;
      }

      const marker = new this.drawingControl.AdvancedMarkerElement({
        map: this.drawingControl.map,
        position: markerPosition,
        content: el,
        collisionBehavior: "REQUIRED",
      });
      markers.push(marker);
    });

    this.shedRowOverlaysByShape.set(pvId, markers);
  }

  clearShedShadingFields(pvId) {
    const perteOmbrageInput = document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed');
    if (perteOmbrageInput) perteOmbrageInput.value = '';
  }

  /**
   * Débounce (500ms par pvId) puis appelle /calculate_shed_shading côté serveur
   * (pvlib.bifacial.infinite_sheds, perte annuelle d'irradiance POA pondérée — cf.
   * calcul_shed_shading.py) pour rafraîchir "% Perte d'ombrage entre shed" avec une valeur
   * physiquement fiable et cohérente avec PVsyst, en remplacement de computeShedShadingFallback()
   * (formule géométrique ponctuelle "pas d'ombre à midi solaire au solstice d'hiver" — gardée
   * seulement comme repli instantané tant que la réponse serveur n'est pas arrivée, ou en cas
   * d'échec réseau/absence d'adresse projet géocodée).
   * @param {string} pvId
   * @param {Object} config - Configuration retournée par getPanelConfigFromForm.
   */
  requestShedShadingFromBackend(pvId, config) {
    if (!this._shedShadingBackendTimers) this._shedShadingBackendTimers = new Map();
    const existingTimer = this._shedShadingBackendTimers.get(pvId);
    if (existingTimer) clearTimeout(existingTimer);

    // Sans adresse projet géocodée, impossible d'interroger PVGIS de façon pertinente : on garde
    // l'estimation JS de repli déjà affichée par l'appelant.
    const addressLatLng = GeometryUtils.getProjectAddressLatLng();
    if (!addressLatLng) return;

    const perteOmbrageInput = document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed');
    if (perteOmbrageInput) perteOmbrageInput.value = '…';

    const shedRotationInput = document.querySelector(`#shedRotation-${pvId}`) || document.getElementById('shedRotation');
    const shedRotation = shedRotationInput ? (parseFloat(shedRotationInput.value) || 0) : 0;
    // Azimut pvlib (180° = Sud) : shedRotation = 0 signifie "Sud" dans cette UI (cf. createPanels(),
    // "0=Sud/90=Ouest/-90=Est").
    const azimuth = (180 + shedRotation + 360) % 360;
    const collectorWidth = config.shedsCols * config.length + (config.shedsCols - 1) * config.spacingX;

    const fallbackToLocalEstimate = () => {
      if (!perteOmbrageInput) return;
      const shading = this.computeShedShadingFallback(config);
      perteOmbrageInput.value = shading.lossPercent !== null ? shading.lossPercent.toFixed(1) : '';
    };

    const timer = setTimeout(() => {
      fetch('/concevoir_mon_projet/calculate_shed_shading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: addressLatLng.lat,
          lon: addressLatLng.lng,
          tilt: config.shedTilt || 0,
          // "gap" = espace LIBRE entre rangées ("Esp. entre sheds" tel que saisi), PAS le pas
          // centre-à-centre pvlib — calcul_shed_shading.py ajoute l'empreinte au sol de la rangée
          // (collector_width * cos(tilt)) pour obtenir le vrai "pitch" avant de calculer le GCR.
          gap: config.shedsColSpacing,
          collector_width: collectorWidth,
          azimuth,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          // Reconstruit panneaux + marge ("Esp. bordure") + repères de rangée via le MÊME chemin de
          // code que toute autre modification de champ (updatePanelsPosition -> createPanels), plutôt
          // que de se contenter de modifier le champ affiché : cela a été signalé comme faisant
          // disparaître la zone tampon et les étiquettes de rangée, qu'aucune autre partie de ce
          // handler ne recrée. { skipShadingRequest: true } empêche createPanels() de redéclencher
          // cet appel réseau lui-même (boucle infinie) — la valeur de perte n'est réécrite qu'APRÈS,
          // avec le résultat backend précis, pour ne pas se faire écraser par l'estimation JS que
          // createPanels() affiche normalement en premier.
          const polygon = this.drawingControl.drawnShapes.find((s) => String(s.pvId) === String(pvId));
          if (polygon) {
            this.updatePanelsPosition(polygon, { skipShadingRequest: true });
          }
          const freshPerteOmbrageInput = document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed');
          if (typeof data.lossPercent === 'number' && freshPerteOmbrageInput) {
            freshPerteOmbrageInput.value = data.lossPercent.toFixed(1);
          } else if (!polygon) {
            // Pas de forme retrouvée (supprimée entre-temps) : repli simple sur le champ déjà capturé.
            fallbackToLocalEstimate();
          }
        })
        .catch(() => fallbackToLocalEstimate());
    }, 500);

    this._shedShadingBackendTimers.set(pvId, timer);
  }

  /**
   * ESTIMATION DE REPLI (instantanée, côté client) : calcule le % de perte d'ombrage à partir
   * UNIQUEMENT de la valeur saisie dans "Esp. entre sheds" (config.shedsColSpacing) et des données
   * géométriques/solaires associées (profondeur de shed, pente, latitude du projet) — aucune notion
   * de "distance optimale" n'est exposée ni retournée (champ supprimé de l'UI et de la logique).
   * Remplacée dès que possible par la valeur backend pvlib (cf. requestShedShadingFromBackend), plus
   * fiable — cette formule géométrique ponctuelle ne reflète pas une perte d'énergie annuelle réelle
   * et ne sert plus que de repli hors-ligne / en attente de réponse serveur.
   *
   * Hauteur du shed (rise vertical) : les "Nb. PV en largeur" (config.shedsCols) panneaux d'une même
   * rangée de shed sont posés bord à bord (espacement technique config.spacingX) le long de l'axe
   * incliné ; leur profondeur cumulée, une fois inclinée à la pente du shed, donne la hauteur H dont
   * l'ombre doit être absorbée par l'espacement avant la rangée suivante.
   *
   * Angle du soleil : élévation solaire à midi solaire le jour le plus défavorable de l'année (soleil au
   * plus bas), c'est-à-dire le solstice d'hiver de l'hémisphère du site — solstice de déclinaison -23.45°
   * pour l'hémisphère nord, ou solstice austral (déclinaison +23.45°) pour l'hémisphère sud. Par symétrie,
   * les deux cas se résument à la même formule via Math.abs(latitude).
   *
   * @param {Object} config - Configuration retournée par getPanelConfigFromForm (doit contenir shedsCols,
   *   length, spacingX, shedTilt, shedsColSpacing).
   * @returns {{lossPercent: number|null}}
   */
  computeShedShadingFallback(config) {
    const tiltRad = (config.shedTilt || 0) * Math.PI / 180;
    const shedDepth = config.shedsCols * config.length + (config.shedsCols - 1) * config.spacingX;
    const shedHeight = shedDepth * Math.sin(tiltRad);

    const latitude = this.getProjectLatitude();
    if (latitude === null || isNaN(latitude)) {
      return { lossPercent: null };
    }

    const sunElevationDeg = 90 - Math.abs(latitude) - 23.45;
    if (sunElevationDeg <= 0) {
      // Latitude extrême : le soleil ne se lève pas (ou à peine) au solstice d'hiver — non
      // calculable de façon utile.
      return { lossPercent: null };
    }

    // Espacement minimal requis pour éviter tout ombrage mutuel à midi solaire (valeur interne,
    // non exposée) : comparé à l'espacement RÉELLEMENT saisi (config.shedsColSpacing) pour dériver
    // le % de perte.
    const requiredSpacing = shedHeight / Math.tan(sunElevationDeg * Math.PI / 180);
    const actualSpacing = config.shedsColSpacing;
    const lossPercent = requiredSpacing > 0
      ? Math.max(0, (1 - (actualSpacing / requiredSpacing)) * 100)
      : 0;

    return { lossPercent };
  }

  /**
   * Récupère la latitude du projet à partir de l'adresse déjà géocodée (saisie dans l'onglet
   * "Paramètres" du projet, sur la même page — cf. #parametre_project_hidden / localStorage
   * "solarProjectData"), avec repli sur le centre de la carte si l'adresse n'est pas encore renseignée.
   * @returns {number|null}
   */
  getProjectLatitude() {
    const parseLatFromJson = (raw) => {
      if (!raw) return null;
      try {
        let data = JSON.parse(raw);
        // La valeur peut être sérialisée deux fois (chaîne JSON contenant une chaîne JSON) selon le
        // point d'entrée qui l'a écrite — cf. le même repli déjà utilisé dans GoogleMaps.js.
        if (typeof data === 'string') data = JSON.parse(data);
        const lat = parseFloat(data?.latitude);
        return isNaN(lat) ? null : lat;
      } catch (e) {
        return null;
      }
    };

    const hiddenInput = document.getElementById('parametre_project_hidden');
    const fromHiddenInput = hiddenInput ? parseLatFromJson(hiddenInput.value) : null;
    if (fromHiddenInput !== null) return fromHiddenInput;

    try {
      const stored = JSON.parse(localStorage.getItem('solarProjectData') || 'null');
      const fromStorage = parseLatFromJson(stored?.projectInfo?.adresseProjet);
      if (fromStorage !== null) return fromStorage;
    } catch (e) {
      // Ignoré : repli sur le centre de la carte ci-dessous.
    }

    if (this.drawingControl.map && typeof this.drawingControl.map.getCenter === 'function') {
      const center = this.drawingControl.map.getCenter();
      if (center) return center.lat();
    }

    return null;
  }

  projectPoint(ref, point, axisHeading, perpHeading) {
    const dist = google.maps.geometry.spherical.computeDistanceBetween(ref, point);
    const headToPoint = google.maps.geometry.spherical.computeHeading(ref, point);
    const along = dist * Math.cos((headToPoint - axisHeading) * Math.PI / 180);
    const perp = dist * Math.cos((headToPoint - perpHeading) * Math.PI / 180);
    return { along, perp };
  }

  getPolygonMetersPath(path, refPoint) {
    const vertices = [];
    const firstPoint = path.getAt(0);
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i);
      if (i === path.getLength() - 1 && point.equals(firstPoint)) {
        continue;
      }
      vertices.push(this.latLngToLocalMeters(refPoint, point));
    }
    return vertices;
  }

  latLngToLocalMeters(refPoint, targetPoint) {
    if (!refPoint || !targetPoint) return { x: 0, y: 0 };
    const latPoint = new google.maps.LatLng(targetPoint.lat(), refPoint.lng());
    const lngPoint = new google.maps.LatLng(refPoint.lat(), targetPoint.lng());
    const deltaY = google.maps.geometry.spherical.computeDistanceBetween(refPoint, latPoint);
    const deltaX = google.maps.geometry.spherical.computeDistanceBetween(refPoint, lngPoint);
    return {
      x: targetPoint.lng() >= refPoint.lng() ? deltaX : -deltaX,
      y: targetPoint.lat() >= refPoint.lat() ? deltaY : -deltaY
    };
  }

  isPolygonClockwise(polygonMetersPath) {
    if (!Array.isArray(polygonMetersPath) || polygonMetersPath.length < 3) return false;
    let twiceArea = 0;
    for (let i = 0; i < polygonMetersPath.length; i++) {
      const current = polygonMetersPath[i];
      const next = polygonMetersPath[(i + 1) % polygonMetersPath.length];
      twiceArea += current.x * next.y - next.x * current.y;
    }
    return twiceArea < 0;
  }

  isPanelRespectingMargin({ panelCorners, polygonMetersPath, refPoint, margin }) {
    if (!Array.isArray(panelCorners) || panelCorners.length !== 4) return false;
    if (!margin || margin <= 0) return true;
    if (!polygonMetersPath || polygonMetersPath.length < 3) return true;
    const cornerMeters = panelCorners.map(corner => this.latLngToLocalMeters(refPoint, corner));
    const midpoints = [
      this.getMidpoint(cornerMeters[0], cornerMeters[1]),
      this.getMidpoint(cornerMeters[1], cornerMeters[2]),
      this.getMidpoint(cornerMeters[2], cornerMeters[3]),
      this.getMidpoint(cornerMeters[3], cornerMeters[0])
    ];
    const pointsToCheck = [...cornerMeters, ...midpoints];
    return pointsToCheck.every(point => {
      const distance = this.distancePointToPolygon(point, polygonMetersPath);
      return distance >= margin;
    });
  }

  getMidpoint(pointA, pointB) {
    if (!pointA || !pointB) return { x: 0, y: 0 };
    return {
      x: (pointA.x + pointB.x) / 2,
      y: (pointA.y + pointB.y) / 2
    };
  }

  distancePointToPolygon(point, polygonMetersPath) {
    let minDistance = Infinity;
    for (let i = 0; i < polygonMetersPath.length; i++) {
      const start = polygonMetersPath[i];
      const end = polygonMetersPath[(i + 1) % polygonMetersPath.length];
      const dist = this.distancePointToSegment(point, start, end);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    return minDistance;
  }

  distancePointToSegment(point, start, end) {
    const segX = end.x - start.x;
    const segY = end.y - start.y;
    const lenSquared = segX * segX + segY * segY;
    if (lenSquared === 0) {
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * segX + (point.y - start.y) * segY) / lenSquared));
    const projX = start.x + t * segX;
    const projY = start.y + t * segY;
    const dx = point.x - projX;
    const dy = point.y - projY;
    return Math.sqrt(dx * dx + dy * dy);
  }

/**
 * Calcule la disposition optimale des sheds réguliers pour occuper l'espace disponible
 */
calculateOptimalShedsLayout(availableAlong, availablePerp, panelLength, panelWidth, config) {
  // L'axe along (panelLength, Nord-Sud pour un shed orienté Sud, projeté par la pente — l'appelant
  // passe alongEffectiveLength) est groupé par config.shedsCols/shedsColSpacing ("Nb. PV en largeur"
  // / "Esp. entre sheds") : c'est l'axe du rampant, où s'empilent les rangées de shed. L'axe perp
  // (panelWidth, Est-Ouest, non affecté par la pente — l'appelant passe effectiveWidth) est groupé
  // par config.shedsRows/shedsRowSpacing ("Nb. PV en longueur" / "Esp. groupe de shed").
  const groupLength = config.shedsCols * panelLength + (config.shedsCols - 1) * config.spacingX;
  const groupWidth = config.shedsRows * panelWidth + (config.shedsRows - 1) * config.spacingY;

  // Calculer le nombre maximum de groupes complets qui peuvent tenir
  const maxGroupsAlong = Math.floor(availableAlong / (groupLength + config.shedsColSpacing));
  const maxGroupsPerp = Math.floor(availablePerp / (groupWidth + config.shedsRowSpacing));

  // Calculer le nombre total de panneaux
  const totalPanelsAlong = maxGroupsAlong * config.shedsCols;
  const totalPanelsPerp = maxGroupsPerp * config.shedsRows;

  // Recalculer les centres pour une disposition centrée
  const centersAlong = [];
  const centersPerp = [];

  // Calculer l'espace total occupé
  const totalUsedAlong = maxGroupsAlong * groupLength + (maxGroupsAlong - 1) * config.shedsColSpacing;
  const totalUsedPerp = maxGroupsPerp * groupWidth + (maxGroupsPerp - 1) * config.shedsRowSpacing;

  // Calculer les offsets pour centrer
  const offsetAlong = (availableAlong - totalUsedAlong) / 2;
  const offsetPerp = (availablePerp - totalUsedPerp) / 2;

  // Générer les centres optimisés
  for (let g = 0; g < maxGroupsAlong; g++) {
    for (let i = 0; i < config.shedsCols; i++) {
      const center = offsetAlong +
                     g * (groupLength + config.shedsColSpacing) +
                     i * (panelLength + config.spacingX) +
                     panelLength / 2;
      centersAlong.push(center);
    }
  }

  for (let g = 0; g < maxGroupsPerp; g++) {
    for (let j = 0; j < config.shedsRows; j++) {
      const center = offsetPerp +
                     g * (groupWidth + config.shedsRowSpacing) +
                     j * (panelWidth + config.spacingY) +
                     panelWidth / 2;
      centersPerp.push(center);
    }
  }

  return { centersAlong, centersPerp };
}

getPanelConfigFromForm(pvId) {
    const longueurPanneauInput = document.querySelector(`#longueurPanneau-${pvId}`);
    const largeurPanneauInput = document.querySelector(`#largeurPanneau-${pvId}`);
    const espacementXInput = document.querySelector(`#espacementPanneauxX-${pvId}`);
    const espacementYInput = document.querySelector(`#espacementPanneauxY-${pvId}`);
    const espacementBordsInput = document.querySelector(`#espacementBords-${pvId}`);
    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`);
    const shedsRowsInput = document.querySelector(`#shedsRows-${pvId}`);
    const shedsRowSpacingInput = document.querySelector(`#shedsRowSpacing-${pvId}`);
    const shedsColsInput = document.querySelector(`#shedsCols-${pvId}`);
    const shedsColSpacingInput = document.querySelector(`#shedsColSpacing-${pvId}`);
    const shedsRegularInput = document.querySelector(`#shedsRegular-${pvId}`); // AJOUTER CETTE LIGNE
    const penteShedInput = document.querySelector(`#pente_panneaux_shed-${pvId}`);

    const defaults = { length: 2.0, width: 1.0, spacingX: 0.5, spacingY: 0.5, margin: 0.0, hasPanelSelected: false };
    if (!longueurPanneauInput || !largeurPanneauInput || !espacementXInput || !espacementYInput) return defaults;

    // Un champ VIDE retombe sur "fallback", mais une valeur explicitement saisie à 0 est conservée telle
    // quelle — nécessaire pour "Nb. PV en longueur" (shedsRows) et "Esp. groupe de shed" (shedsRowSpacing),
    // où 0 a désormais un sens métier propre (pas de regroupement = remplissage maximal), à ne pas
    // confondre avec "champ non renseigné". Avant ce correctif, `parseInt(value) || fallback` traitait un
    // 0 saisi comme une valeur absente (0 est falsy en JS) et retombait à tort sur l'ancien défaut (12).
    const parseIntKeepZero = (input, fallback) => {
      if (!input || input.value === '') return fallback;
      const value = parseInt(input.value, 10);
      return (isNaN(value) || value < 0) ? fallback : value;
    };
    const parseFloatKeepZero = (input, fallback) => {
      if (!input || input.value === '') return fallback;
      const value = parseFloat(input.value);
      return (isNaN(value) || value < 0) ? fallback : value;
    };

    const longueurRaw = parseFloat(longueurPanneauInput.value);
    const largeurRaw = parseFloat(largeurPanneauInput.value);
    // Un panneau favori n'a été choisi que si ses deux dimensions réelles sont renseignées (> 0) — sans
    // cela, longueurPanneau/largeurPanneau restent à "0" (valeur par défaut des champs cachés), et créer
    // des panneaux avec les dimensions de repli (2.0m x 1.0m) reviendrait à les afficher avant que
    // l'utilisateur ait choisi ses panneaux dans la modale "Liste de favoris".
    const hasPanelSelected = !isNaN(longueurRaw) && longueurRaw > 0 && !isNaN(largeurRaw) && largeurRaw > 0;

    const baseLongueur = (longueurRaw || 0) / 1000 || defaults.length;
    const baseLargeur = (largeurRaw || 0) / 1000 || defaults.width;
    const isPortrait = portraitInput ? portraitInput.checked : true;

    // Portrait : le grand côté du panneau ("longueur") est parallèle à l'axe Nord-Sud (along, "Nb. PV
    // en longueur", sans pente) ; le côté court ("largeur") est parallèle au rampant (axe Est-Ouest,
    // perp, "Esp. Shed Y" — projeté par shedsCosSlope, cf. createPanels). Paysage : inverse.
    const length = isPortrait ? baseLongueur : baseLargeur;
    const width = isPortrait ? baseLargeur : baseLongueur;

    return {
      length,
      width,
      hasPanelSelected,
      spacingX: parseFloat(espacementXInput.value) / 1000 || defaults.spacingX,
      spacingY: parseFloat(espacementYInput.value) / 1000 || defaults.spacingY,
      margin: parseFloat(espacementBordsInput?.value || 0) / 1000 || defaults.margin,
      shedsEnabled: !!(shedsRowsInput || shedsColsInput || shedsRowSpacingInput || shedsColSpacingInput),
      // NOTE (orientation confirmée avec l'utilisateur) : pour un shed orienté Sud (gridBaseHeading
      // fixé à 180°), l'axe "along" (heading=180°) est le Nord-Sud — l'axe du rampant, projeté par la
      // pente (shedsCosSlope), le long duquel s'empilent les RANGÉES de sheds. L'axe "perp"
      // (heading+90°) est l'Est-Ouest — l'axe au sein d'une même rangée (panneaux côte à côte),
      // non affecté par la pente. shedsCols/shedsColSpacing pilotent nativement l'axe along/Nord-Sud
      // (cf. leurs aria-label HTML : "Nb. PV en largeur" = nombre de panneaux DANS LE RAMPANT), et
      // shedsRows/shedsRowSpacing pilotent nativement l'axe perp/Est-Ouest ("Nb. PV en longueur" =
      // nombre de panneaux SUR L'AXE LONGUEUR). Chaque propriété est lue DIRECTEMENT depuis l'id HTML
      // de même nom, quel que soit le libellé affiché dessus.
      // Champ HTML #shedsCols ("Nb. PV en largeur") : entre 1 et 15.
      shedsCols: Math.max(1, Math.min(15, parseIntKeepZero(shedsColsInput, 2))),
      // Champ HTML #shedsColSpacing ("Esp. entre sheds") : saisi en mm (divisor 1000), borné à ]0, 10] m.
      shedsColSpacing: Math.max(0.001, Math.min(10, parseFloatKeepZero(shedsColSpacingInput, 2500) / 1000)),
      // Champ HTML #shedsRows ("Nb. PV en longueur") : entre 0 et 40. 0 = pas de regroupement (remplissage
      // maximal, cf. createPanels/shedsRowsForGroup) ; nouveau défaut (au lieu de 12 auparavant).
      shedsRows: Math.max(0, Math.min(40, parseIntKeepZero(shedsRowsInput, 0))),
      // Champ HTML #shedsRowSpacing ("Esp. groupe de shed") : saisi en mm (divisor 1000), borné à [0, 5] m.
      // 0 = aucun espace entre groupes = pas de regroupement (même règle que shedsRows ci-dessus) ;
      // nouveau défaut (au lieu de 100 auparavant).
      shedsRowSpacing: Math.max(0, Math.min(5, parseFloatKeepZero(shedsRowSpacingInput, 0) / 1000)),
      shedsRegular: shedsRegularInput ? shedsRegularInput.checked : false, // AJOUTER CETTE LIGNE
      // Pente des panneaux en shed (°) : réduit l'empreinte au sol du panneau sur l'axe along/Nord-Sud
      // (cf. shedsCosSlope -> alongEffectiveLength dans createPanels()) — plus la pente est forte,
      // plus le nombre de rangées de sheds qui tiennent sur cet axe augmente.
      shedTilt: Math.max(0, Math.min(90, parseFloat(penteShedInput?.value || '0') || 0))
    };
  }

  // Active/désactive le mode suppression/restauration (partage le même bouton)
  toggleBoolShowHide(button) {
    this.boolShowHide = !this.boolShowHide;
    if (button) {
      if (this.boolShowHide) button.classList.add('selected');
      else button.classList.remove('selected');
    }
  }

  // Active/désactive le mode suppression/restauration (partage le même bouton)
  toggleBoolShowHide(button) {
    this.boolShowHide = !this.boolShowHide;
    if (button) {
      if (this.boolShowHide) button.classList.add('selected');
      else button.classList.remove('selected');
    }
    // CORRECTIF (suite) : réaligne le clickable de TOUS les panneaux déjà sur la carte sur le
    // nouvel état — sans ça, les panneaux créés avant ce basculement restaient clickable:true
    // (ou false) indéfiniment, indépendamment du mode courant.
    this.createdPanelsByShape.forEach((panels) => {
      panels.forEach((panel) => {
        if (panel && panel.isPanelSolaire && typeof panel.setOptions === 'function') {
          panel.setOptions({ clickable: this.boolShowHide });
        }
      });
    });
  }

  // Essayer de restaurer un panneau supprimé au clic droit à une position
  tryRestoreDeletedPanelAt(polygon, latLng) {
    if (!this.boolShowHide) return;
    const pvId = polygon.pvId;
    const deleted = DeletedPanelsStorage.load().filter(p => p.pvId === pvId && p.shapeType === SHAPE_TYPES.POLYGON);
    if (!deleted.length) return;

    // Trouver le panneau supprimé le plus proche (approximation par centre)
    let closest = null;
    let closestDist = Infinity;

    // Utiliser l'orientation fixe (180° = Sud), + "Rotation shed" si applicable
    const path = polygon.getPath();
    const ref = path.getAt(0);
    const shedRotationInput = polygon.shedsCapable ? document.querySelector(`#shedRotation-${pvId}`) : null;
    const shedRotation = shedRotationInput ? (parseFloat(shedRotationInput.value) || 0) : 0;
    const heading = (polygon.gridBaseHeading !== undefined ? polygon.gridBaseHeading : 180) + shedRotation;
    const perpHeading = heading + 90;
    const config = this.getPanelConfigFromForm(pvId);

    // Bornes orientées
    let minAlong = Infinity, maxAlong = -Infinity, minPerp = Infinity, maxPerp = -Infinity;
    for (let i = 0; i < path.getLength(); i++) {
      const v = path.getAt(i);
      const { along, perp } = this.projectPoint(ref, v, heading, perpHeading);
      if (along < minAlong) minAlong = along;
      if (along > maxAlong) maxAlong = along;
      if (perp < minPerp) minPerp = perp;
      if (perp > maxPerp) maxPerp = perp;
    }
    const rangeAlong = Math.max(0, maxAlong - minAlong);
    const rangePerp = Math.max(0, maxPerp - minPerp);
    const stepAlong = config.length + config.spacingX;
    const stepPerp = config.width + config.spacingY;
    const countAlong = Math.floor(rangeAlong / stepAlong);
    const countPerp = Math.floor(rangePerp / stepPerp);
    const usedAlong = countAlong * config.length + (countAlong - 1) * config.spacingX;
    const usedPerp = countPerp * config.width + (countPerp - 1) * config.spacingY;
    const startAlong = minAlong + (rangeAlong - usedAlong) / 2;
    const startPerp = minPerp + (rangePerp - usedPerp) / 2;

    for (const item of deleted) {
      const [iStr, jStr] = item.panelIndex.split('-');
      const i = parseInt(iStr, 10); const j = parseInt(jStr, 10);
      const centerAlong = startAlong + i * stepAlong + config.length / 2;
      const centerPerp = startPerp + j * stepPerp + config.width / 2;
      const center = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(ref, centerAlong, heading),
        centerPerp,
        perpHeading
      );
      const d = google.maps.geometry.spherical.computeDistanceBetween(center, latLng);
      if (d < closestDist) { closestDist = d; closest = item; }
    }

    if (closest) {
      // Retirer des index supprimés
    this.getDeletedIndexSet(pvId).delete(closest.panelIndex);
      DeletedPanelsStorage.remove(p => p.pvId === pvId && p.panelIndex === closest.panelIndex && p.shapeType === SHAPE_TYPES.POLYGON);
      // Rafraîchir l'affichage des panneaux visibles
      this.updatePanelsPosition(polygon);
    }
  }
}

export default PolygonPanelsManager;



