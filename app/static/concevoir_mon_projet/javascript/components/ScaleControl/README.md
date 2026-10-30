# ScaleControl

Composant de contrôle d'échelle personnalisable pour Google Maps.

## Fonctionnalités

✅ Affichage dynamique de l'échelle au format "1/XXX"  
✅ Ajustement automatique selon le zoom et la latitude  
✅ Modification manuelle par l'utilisateur  
✅ **Échelles précises grâce aux zooms fractionnaires** (pas de paliers fixes)  
✅ Validation silencieuse des entrées (nombres uniquement)  
✅ Support du zoom automatique (optionnel)  
✅ Callback onChange pour synchronisation  
✅ Styles personnalisables  
✅ Debouncing optimisé pour les performances  

## Installation rapide

```javascript
import ScaleControl from './components/ScaleControl/ScaleControl.js';

const scaleControl = new ScaleControl({
  editable: true,
  autoZoom: true,
  onChange: (scale) => console.log('Échelle:', scale)
});

map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));
```

## Structure

```
ScaleControl/
├── constants.js           # Constantes et styles
├── ScaleControl.js        # Composant principal
├── index.js               # Point d'entrée
├── README.md             # Ce fichier
└── utils/
    └── ScaleCalculator.js # Calculs d'échelle
```

## Documentation complète

Voir [scale-control.md](../../../docs/scale-control.md) pour la documentation détaillée.

## Options

| Option | Type | Défaut | Description |
|--------|------|--------|-------------|
| `editable` | Boolean | `true` | Permet la modification par l'utilisateur |
| `autoZoom` | Boolean | `true` | Ajuste le zoom automatiquement |
| `onChange` | Function | `null` | Callback lors des changements |

## API

### Méthodes principales

- `onAdd(map)` - Ajoute le contrôle à la carte
- `onRemove()` - Retire le contrôle
- `getScale()` - Obtient l'échelle actuelle
- `setScale(scale, updateZoom)` - Définit une nouvelle échelle

## Exemples

### Lecture seule
```javascript
const scaleControl = new ScaleControl({ editable: false });
```

### Avec zoom automatique
```javascript
const scaleControl = new ScaleControl({ 
  autoZoom: true,
  onChange: (scale) => console.log(`1/${scale}`)
});
```

### Définir une échelle
```javascript
scaleControl.setScale(1000, true); // Zoom automatique
```

## Limites

- Échelle minimum : 1/266
- Échelle maximum : 1/1 580 964 233 004
- Zoom Google Maps : 0-22 (avec support des valeurs fractionnaires pour précision maximale)

## Dépendances

- Google Maps JavaScript API v3
- ES6+ (modules, arrow functions, etc.)

## Licence

Fait partie du projet OmbriDesign.

