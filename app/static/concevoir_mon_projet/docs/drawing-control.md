## DrawingControl — Dessin & formes

Structure du module `components/DrawingControl/` :

```
components/DrawingControl/
  constants.js
  DrawingControl.js
  controls/
    ButtonControl.js
    MeasurementControl.js
  handlers/
    AddressSuggestionsHandler.js
    EventHandler.js
    FormHandler.js
    ShapeHandler.js
  shapes/
    Circle.js
    Line.js
    LineToPolygon.js
    SimplePolygon.js
    SimpleRectangle.js
    Text.js
  utils/
    CalculationUtils.js
    GeometryUtils.js
```

### Rôles
- `constants.js`: valeurs partagées (rayons, couleurs, marges, etc.)
- `utils/*`: fonctions pures (géométrie, calculs, caches)
- `handlers/*`: gestion d’événements et orchestration UI
- `shapes/*`: primitives de dessin (préférer `Polygon` à `Rectangle`)
- `DrawingControl.js`: façade publique du module

### Règles
- Utiliser `LatLngBounds` pour limites
- Implémenter `debounce` pour événements fréquents
- Nettoyer listeners/overlays lors de la suppression
- Valider/arrondir les calculs (EARTH_CONSTANTS, SAFETY_MARGIN)

### Extraits de code

Initialisation de la librairie de marqueurs avancés:
```136:139:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
async initializeMarkerLibrary() {
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  this.AdvancedMarkerElement = AdvancedMarkerElement;
}
```

Publication d’un événement de zoom de carte:
```152:159:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
google.maps.event.addListener(map, 'zoom_changed', () => {
  const zoom = map.getZoom();
  document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.MAP_ZOOM_CHANGED, {
    detail: { zoom }
  }));
});
```

Collage d’une forme copiée avec recentrage et création d’`AdvancedMarkerElement` côté mesures (via `MeasurementControl`):
```685:706:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
pasteShape(position) {
  if (!this.clipboard) { this.errorModal.show("Aucune forme copiée..."); return; }
  const bounds = new google.maps.LatLngBounds();
  this.clipboard.points.forEach(point => { bounds.extend(new google.maps.LatLng(point.lat, point.lng)); });
  const oldCenter = bounds.getCenter();
  const deltaLat = position.lat() - oldCenter.lat();
  const deltaLng = position.lng() - oldCenter.lng();
  const newPoints = this.clipboard.points.map(point => new google.maps.LatLng(point.lat + deltaLat, point.lng + deltaLng));
  const shape = new google.maps.Polygon({ paths: newPoints, ...STYLES.DEFAULT_SHAPE, map: this.map });
  // ... attribution d'un nouveau pvId, setup listeners, restore form
}
```



