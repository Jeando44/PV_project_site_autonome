# Module Profil Altimétrique

## 📋 Vue d'ensemble

Module permettant de créer et gérer des profils altimétriques sur Google Maps, utilisant l'API IGN Géoportail pour obtenir les données d'altitude.

**Architecture** : Suit exactement le pattern de `resuméParcelles.js` pour une cohérence maximale avec le projet.

## 📁 Structure du module

```
ProfilAltimetrique/
├── README.md
├── constants.js              # Toutes les constantes du module
├── index.js                  # Point d'entrée (exports)
├── core/
│   ├── ProfilAltimetriqueControl.js    # Contrôle UI principal (≈ ResumeParcellesControl)
│   └── ProfilAltimetriqueManager.js    # Logique métier et gestion des profils
├── handlers/
│   ├── DrawingHandler.js     # Gestion du dessin de lignes sur la carte
│   └── ChartHandler.js        # Gestion du graphique Google Charts
├── utils/
│   ├── CalculationUtils.js   # Calculs géométriques (Haversine, pentes, dénivelés)
│   ├── GeometryUtils.js       # Utilitaires Google Maps (polylines, markers)
│   └── DOMUtils.js            # Création d'éléments DOM
└── services/
    └── AltimetrieAPIService.js # Interface avec l'API IGN
```

## 🎯 Fonctionnalités

### ✅ Implémentées

1. **Dessin de ligne sur la carte**
   - Mode dessin activé par bouton "+"
   - Clic pour ajouter des points
   - Clic droit pour finaliser
   - Touche Échap pour annuler
   - Curseur en croix pendant le dessin
   - Ligne temporaire au survol

2. **Récupération des données altimétriques**
   - Appel API IGN Géoportail
   - Parsing et validation des données
   - Gestion d'erreurs (timeout, réseau, API)

3. **Calculs automatiques**
   - Distance totale (formule de Haversine)
   - Dénivelé positif et négatif
   - Pente moyenne et maximale
   - Altitude min/max

4. **Visualisation graphique**
   - Graphique Google Charts (AreaChart)
   - Courbe lissée de l'altitude
   - Axes : Distance (X) vs Altitude (Y)
   - Tooltips personnalisés avec distance, altitude, pente

5. **Gestion multi-profils**
   - Système d'onglets pour naviguer entre profils
   - Nommage automatique : "Alti-PV1", "Alti-PV2", etc.
   - Renommage personnalisé (max 50 caractères)
   - Suppression avec confirmation
   - Max 20 profils sauvegardés

6. **Persistance**
   - Sauvegarde dans localStorage
   - Rechargement automatique au démarrage
   - Profil actif conservé entre sessions

7. **Export CSV**
   - Export détaillé : distance, altitude, latitude, longitude, pente
   - Section résumé avec statistiques
   - Format : `profil_altimetrique_[nom]_[date].csv`

## 🎨 Design & UI

- **Style identique** à `resuméParcelles.js`
- **Position** : 4ème panneau de la ToolBar (après Résumé Parcelles)
- **Bouton "+"** : Vert → Rouge quand actif
- **Onglets** : Bleu actif, gris inactif
- **Container** : Semi-transparent, responsive, max-width: 25vw

## 🔧 Utilisation

### Intégration

Le module est automatiquement intégré dans la ToolBar :

```javascript
// Dans ToolBar.js
import { ProfilAltimetriqueControl } from '../ProfilAltimetrique/index.js';

this.profilAltimetriqueControl = new ProfilAltimetriqueControl({
  errorModal: this.errorModal,
  showSpinner: this.showSpinner.bind(this),
  hideSpinner: this.hideSpinner.bind(this),
  map: this.map
});

// Initialiser avec la carte
this.profilAltimetriqueControl.initializeWithMap(map);
```

### Workflow utilisateur

1. Clic sur bouton "+" (vert) → Mode dessin activé
2. Clic sur la carte pour ajouter des points (min. 2)
3. Clic droit pour finaliser → Récupération automatique des données
4. Affichage du graphique et des statistiques
5. Possibilité de renommer le profil
6. Export CSV ou création d'un nouveau profil

## 📡 API IGN Géoportail

### Endpoint
```
https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json
```

### Paramètres
- `lon` : Longitudes séparées par `|`
- `lat` : Latitudes séparées par `|`
- `sampling` : Nombre de points (défaut: 100, max: 5000)
- `resource` : Source de données (`ign_rge_alti_wld`)
- `profile_mode` : Mode simple ou accurate

### Exemple de réponse
```json
{
  "elevations": [
    { "lon": 2.3522, "lat": 48.8566, "z": 35.2, "acc": "2.5m" },
    { "lon": 2.3545, "lat": 48.8578, "z": 42.8, "acc": "2.5m" }
  ]
}
```

## 🎛️ Événements personnalisés

Le module dispatche les événements suivants :

```javascript
PROFIL_EVENTS = {
  DRAWING_STARTED: 'profil:drawing:started',
  POINT_ADDED: 'profil:point:added',
  DRAWING_COMPLETED: 'profil:drawing:completed',
  DRAWING_CANCELLED: 'profil:drawing:cancelled',
  DATA_LOADED: 'profil:data:loaded',
  SAVED: 'profil:saved',
  SELECTED: 'profil:selected',
  DELETED: 'profil:deleted',
  EXPORTED: 'profil:exported',
  RENAMED: 'profil:renamed',
  MODE_ACTIVATED: 'profil:mode:activated',
  MODE_DEACTIVATED: 'profil:mode:deactivated'
}
```

## 💾 Structure localStorage

```javascript
{
  "altimetric_profiles": {
    "profiles": [
      {
        "id": "profile_1697456789_abc123",
        "name": "Alti-PV1",
        "created": "2025-10-14T10:30:00Z",
        "coordinates": [
          { "lat": 48.8566, "lng": 2.3522 },
          { "lat": 48.8578, "lng": 2.3545 }
        ],
        "points": [
          { "lat": 48.8566, "lon": 2.3522, "altitude": 35.2, "distance": 0, "slope": 0 },
          { "lat": 48.8578, "lon": 2.3545, "altitude": 42.8, "distance": 147.3, "slope": 5.2 }
        ],
        "stats": {
          "totalDistance": 295.8,
          "positiveElevation": 7.6,
          "negativeElevation": 4.3,
          "averageSlope": 1.1,
          "maxSlope": 5.2,
          "minAltitude": 35.2,
          "maxAltitude": 42.8
        }
      }
    ],
    "activeProfileId": "profile_1697456789_abc123"
  }
}
```

## 🔍 Tests recommandés

### Tests unitaires à implémenter
- CalculationUtils : distance Haversine, calculs de pentes
- AltimetrieAPIService : construction URL, gestion erreurs
- DrawingHandler : ajout de points, finalisation
- ChartHandler : création DataTable, options graphique

### Tests E2E recommandés
1. Créer un profil simple (3 points)
2. Créer plusieurs profils et naviguer entre eux
3. Renommer un profil
4. Supprimer un profil
5. Exporter en CSV
6. Persistance après rechargement

## 📝 Conventions du projet respectées

✅ camelCase pour les variables  
✅ PascalCase pour les classes  
✅ kebab-case pour les fichiers  
✅ snake_case pour localStorage  
✅ const/let (jamais var)  
✅ Imports/exports nommés  
✅ Gestion d'erreurs avec try/catch  
✅ CustomEvents pour la communication  
✅ Pattern façade (index.js)  
✅ Séparation core/utils/handlers/services  

## 🚀 Améliorations futures

- [ ] Mode "accurate" pour plus de précision
- [ ] Comparaison de plusieurs profils (superposition)
- [ ] Import/export GPX ou KML
- [ ] Export du graphique en PNG
- [ ] Annotations sur le graphique
- [ ] Calculs avancés (vitesse, temps de parcours)
- [ ] Intégration avec les zones PV (calcul de pente des zones)

## 🐛 Gestion d'erreurs

Le module gère :
- Minimum 2 points requis
- Maximum 5000 points
- Timeout API (30s)
- Erreurs réseau
- Réponses invalides de l'API
- localStorage saturé
- Noms de profil invalides

## 📚 Documentation

Voir aussi :
- `profil-altimetrique-feature.md` : Plan détaillé complet
- Code source inline : Commentaires JSDoc sur les méthodes publiques

## 👥 Contribution

Le module suit strictement les conventions du projet. Toute modification doit :
1. Respecter les règles du `.cursorrules`
2. Maintenir la cohérence avec `resuméParcelles.js`
3. Utiliser les événements personnalisés
4. Documenter les méthodes publiques

---

**Auteur** : Module créé selon les spécifications du plan `profil-altimetrique-feature.md`  
**Date** : Octobre 2025  
**Version** : 1.0.0

