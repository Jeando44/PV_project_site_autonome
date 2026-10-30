# ScaleControl — Contrôle d'échelle personnalisable

Le composant `ScaleControl` fournit un contrôle d'échelle interactif pour Google Maps, permettant d'afficher et de modifier l'échelle de la carte en temps réel.

## Structure du module

```
components/ScaleControl/
  constants.js          # Constantes et styles
  ScaleControl.js       # Composant principal
  index.js              # Point d'entrée du module
  utils/
    ScaleCalculator.js  # Utilitaires de calcul d'échelle
```

## Architecture

### Fichiers principaux

#### `constants.js`
Contient les constantes et styles du composant :
- **SCALE_CONSTANTS** : Configuration de l'échelle (min, max, position, etc.)
- **SCALE_STYLES** : Styles inline pour le conteneur et l'input

#### `ScaleControl.js`
Composant principal qui :
- Affiche l'échelle actuelle au format "1/XXX"
- S'ajuste automatiquement au zoom et à la latitude
- Permet la modification manuelle de l'échelle
- Supporte le zoom automatique (optionnel)

#### `utils/ScaleCalculator.js`
Classe utilitaire statique pour :
- Calculer l'échelle en fonction du zoom et de la latitude
- Calculer le zoom nécessaire pour une échelle donnée
- Valider et formater les valeurs d'échelle
- Parser les entrées utilisateur

## Utilisation

### Installation de base

```javascript
import ScaleControl from './components/ScaleControl/ScaleControl.js';

// Initialisation simple
const scaleControl = new ScaleControl();
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));
```

### Configuration avancée

```javascript
const scaleControl = new ScaleControl({
  editable: true,        // Permet la modification par l'utilisateur (défaut: true)
  autoZoom: true,        // Ajuste automatiquement le zoom (défaut: true)
  onChange: (scale) => { // Callback appelé lors des changements d'échelle
    console.log('Nouvelle échelle:', scale);
  }
});

map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));
```

## Options de configuration

| Option | Type | Défaut | Description |
|--------|------|--------|-------------|
| `editable` | Boolean | `true` | Si `true`, l'utilisateur peut modifier l'échelle |
| `autoZoom` | Boolean | `true` | Si `true`, la carte zoome automatiquement quand l'utilisateur change l'échelle |
| `onChange` | Function | `null` | Callback appelé avec la nouvelle valeur d'échelle lors des changements |

## API publique

### Méthodes

#### `onAdd(map)`
Ajoute le contrôle à la carte.
```javascript
const element = scaleControl.onAdd(map);
```

#### `onRemove()`
Retire le contrôle de la carte et nettoie les listeners.
```javascript
scaleControl.onRemove();
```

#### `getScale()`
Retourne l'échelle actuelle.
```javascript
const currentScale = scaleControl.getScale(); // ex: 366
```

#### `setScale(scale, updateZoom)`
Définit une nouvelle échelle.
```javascript
scaleControl.setScale(500);           // Change l'affichage uniquement
scaleControl.setScale(500, true);     // Change l'affichage et ajuste le zoom
```

### Événements

Le composant écoute automatiquement :
- `zoom_changed` : Met à jour l'échelle quand le zoom change
- `center_changed` : Met à jour l'échelle quand la latitude change

## Fonctionnalités

### Calcul automatique de l'échelle

L'échelle est calculée en fonction de :
- **Niveau de zoom** : Plus le zoom est élevé, plus l'échelle est petite (1/50 vs 1/10000)
- **Latitude** : L'échelle varie selon la latitude car la projection Mercator déforme les distances
- **Zooms fractionnaires** : Le composant utilise des niveaux de zoom avec décimales pour permettre des échelles précises (pas de paliers fixes)

### Validation des entrées

Le composant filtre automatiquement les entrées invalides :
- Seuls les chiffres sont acceptés
- Les caractères non numériques sont silencieusement supprimés
- Les valeurs hors limites (min/max) sont rejetées
- Pas de message d'erreur affiché à l'utilisateur

### Debouncing

Pour optimiser les performances :
- Les mises à jour sont débounce de 50ms pour les changements de zoom/centre
- Les modifications de l'input sont débounce de 300ms
- La touche Entrée applique immédiatement le changement

## Constantes

### SCALE_CONSTANTS

```javascript
{
  POSITION: google.maps.ControlPosition.BOTTOM_LEFT,
  DEFAULT_SCALE: 500,
  MIN_SCALE: 266,         // Échelle minimum (1/266)
  MAX_SCALE: 1580964233004, // Échelle maximum (1/1 580 964 233 004)
  METERS_PER_PIXEL_AT_ZOOM_0: 156543.03392,
  EARTH_CIRCUMFERENCE: 40075017,
  CONTAINER_MARGIN: '10px',
  INPUT_WIDTH: '120px',
  DEBOUNCE_DELAY: 300
}
```

## Formules mathématiques

### Calcul de l'échelle

```
metersPerPixel = (EARTH_CIRCUMFERENCE × cos(latitude)) / 2^(zoom + 8)
scale = metersPerPixel × 96 / 39.3701
```

### Calcul du zoom pour une échelle cible

```
targetMetersPerPixel = targetScale / (96 / 39.3701)
zoom = log2((EARTH_CIRCUMFERENCE × cos(latitude)) / (targetMetersPerPixel × 256))
```

**Note** : Le zoom est retourné avec des décimales (ex: 19.37) plutôt qu'arrondi à un entier, permettant ainsi des échelles très précises. Google Maps supporte les zooms fractionnaires.

## Exemples d'utilisation

### Exemple 1 : Contrôle en lecture seule

```javascript
const scaleControl = new ScaleControl({
  editable: false
});
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));
```

### Exemple 2 : Avec zoom automatique

```javascript
const scaleControl = new ScaleControl({
  editable: true,
  autoZoom: true, // Zoom automatique activé par défaut
  onChange: (scale) => {
    console.log(`Échelle changée : 1/${scale}`);
  }
});
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));
```

### Exemple 3 : Synchronisation avec d'autres composants

```javascript
const scaleControl = new ScaleControl({
  onChange: (scale) => {
    // Mettre à jour d'autres éléments de l'interface
    document.getElementById('scale-display').textContent = `1/${scale}`;
    
    // Sauvegarder dans localStorage
    localStorage.setItem('preferredScale', scale);
  }
});
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));

// Accès global
window.scaleControl = scaleControl;
```

### Exemple 4 : Définir une échelle au démarrage

```javascript
const scaleControl = new ScaleControl();
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));

// Attendre que la carte soit chargée
google.maps.event.addListenerOnce(map, 'idle', () => {
  // Définir une échelle de 1/1000
  scaleControl.setScale(1000, true);
});
```

## Style et personnalisation

Le composant utilise des styles inline définis dans `constants.js`. Pour personnaliser l'apparence, vous pouvez :

1. **Modifier les constantes** dans `SCALE_STYLES`
2. **Surcharger les styles CSS** via la classe `.scale-control`

Exemple de surcharge CSS :
```css
.scale-control {
  background-color: #f0f0f0 !important;
  border: 3px solid #333 !important;
}

.scale-control input {
  font-weight: bold !important;
  color: #1a73e8 !important;
}
```

## Règles et bonnes pratiques

### Performance
- Les calculs sont optimisés avec du debouncing
- Les mises à jour n'affectent pas l'input pendant la saisie
- Les listeners sont correctement nettoyés lors de la suppression

### Validation
- Filtrage silencieux des caractères non numériques
- Validation des limites min/max
- Restauration automatique de la valeur précédente en cas d'erreur

### Accessibilité
- L'input a un titre explicatif au survol
- Le focus est géré correctement
- Sélection automatique du texte au focus pour faciliter la modification

### Intégration
- Compatible avec tous les autres contrôles Google Maps
- Peut être rendu accessible globalement via `window.scaleControl`
- Support des événements personnalisés via le callback `onChange`

## Dépendances

- **Google Maps JavaScript API** : Bibliothèque principale
- **constants.js** : Constantes du module
- **ScaleCalculator.js** : Utilitaires de calcul

## Compatibilité

- Navigateurs modernes (ES6+)
- Google Maps API v3
- Compatible avec les autres composants du projet (DrawingControl, ToolBar, etc.)

## Points d'attention

1. **Projection Mercator** : L'échelle varie selon la latitude. Le composant en tient compte automatiquement.
2. **Résolution d'écran** : Le calcul utilise le standard OGC de 0.28 mm/pixel (comme utilisé par Géoportail, IGN, etc.).
3. **Limites de zoom** : Google Maps limite le zoom entre 0 et 22. Le composant respecte ces limites et utilise des valeurs fractionnaires pour plus de précision.
4. **Échelles précises** : Grâce aux zooms fractionnaires (ex: 19.37), l'échelle demandée est respectée exactement, sans être arrondie à un palier fixe.
5. **Limites d'échelle** : Échelle minimum de 1/266 et maximum de 1/1 580 964 233 004 (environ 1.58 billions).
6. **Zoom automatique** : Par défaut, la carte zoome automatiquement quand l'utilisateur modifie l'échelle.

## Maintenance

Pour modifier le comportement :
- **Plage d'échelles** : Modifier `MIN_SCALE` et `MAX_SCALE` dans `constants.js`
- **Position** : Modifier `POSITION` dans `constants.js` ou lors de l'ajout à la carte
- **Styles** : Modifier `SCALE_STYLES` dans `constants.js`
- **Calculs** : Modifier les méthodes statiques dans `ScaleCalculator.js`

## Débogage

Pour activer les logs de debug :
```javascript
const scaleControl = new ScaleControl({
  onChange: (scale) => {
    console.log('Échelle:', scale);
    console.log('Zoom:', map.getZoom());
    console.log('Centre:', map.getCenter().toString());
  }
});
```

## Intégration dans GoogleMaps.js

Le composant est intégré dans `GoogleMaps.js` :

```javascript
import ScaleControl from './components/ScaleControl/ScaleControl.js';

// ... après l'initialisation de la carte

const scaleControl = new ScaleControl({
  editable: true,
  autoZoom: true, // La carte zoome automatiquement lors du changement d'échelle
  onChange: (scale) => {
    console.log('Échelle changée:', scale);
  }
});
map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));

// Rendre accessible globalement
window.scaleControl = scaleControl;
```

