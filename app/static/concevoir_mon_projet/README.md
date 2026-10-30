## @ombridesign — Documentation développeur

Cette documentation couvre les modules JavaScript/Google Maps du dossier `static/ombridesign`. Elle suit les règles définies dans `.cursorrules` et structure les informations par modules (Google Maps, DrawingControl, ToolBar & vues, persistance, composants UI, conventions).

Consultez l’index dans `docs/SUMMARY.md` pour naviguer.

### Modules couverts
- Google Maps (`javascript/GoogleMaps.js`)
- DrawingControl (dessin, formes, utilitaires)
- ToolBar & vues (panneaux latéraux et vues)
- Persistance (`services/StorageManager.js`)
- Composants UI (modales, tabs)
- Conventions & architecture

### Principes clés
- camelCase pour variables, PascalCase pour classes, kebab-case pour fichiers
- `google.maps.AdvancedMarkerElement` et `LatLngBounds`
- Modules à responsabilité unique, séparation core/utils/handlers
- Persistance locale via `localStorage` (JSON structuré)
- Nettoyage systématique des listeners et overlays

Voir les pages détaillées dans `docs/`.


