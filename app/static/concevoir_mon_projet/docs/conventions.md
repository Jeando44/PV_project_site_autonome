## Conventions & Architecture

Extraits applicables de `.cursorrules`:

- camelCase variables, PascalCase classes, kebab-case fichiers
- Modules à responsabilité unique, séparation `core/utils/handlers`
- Google Maps: `AdvancedMarkerElement`, `Polygon`, `LatLngBounds`
- Écouteurs d’événements avec gestion d’erreurs + nettoyage
- Debounce pour mises à jour fréquentes
- Persistance via `localStorage` (JSON, méthodes atomiques, parsing sûr)
- Performances: caches, batching, lazy loading, constantes partagées
- Interface: `CustomEvents`, contrôles personnalisés, états de chargement/erreurs



