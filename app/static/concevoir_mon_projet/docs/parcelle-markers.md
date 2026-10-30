# Marqueurs de Parcelles Manuels

## 📋 Vue d'ensemble

La fonctionnalité de **marqueurs de parcelles manuels** permet aux utilisateurs d'ajouter des parcelles cadastrales supplémentaires indépendamment des zones dessinées sur la carte. Cette fonctionnalité est utile pour identifier des parcelles adjacentes ou complémentaires au projet principal.

## 🎯 Utilisation

### Activation du mode

1. **Cliquez sur le bouton "+"** dans l'en-tête du résumé des parcelles
2. Le bouton devient **rouge** avec une **croix (×)**
3. Le curseur de la carte devient une **croix (+)**

### Ajout d'une parcelle

1. **Avec le mode actif**, cliquez n'importe où sur la carte
2. L'application récupère automatiquement les données cadastrales du point
3. Un **marqueur bleu** avec un **label** apparaît sur la carte
4. Une **nouvelle ligne** est ajoutée au tableau des parcelles

### Désactivation du mode

- **Cliquez à nouveau sur le bouton** rouge avec la croix, OU
- **Appuyez sur la touche Échap**

Le bouton redevient **vert** avec un **plus (+)** et le curseur reprend son apparence normale.

### Suppression d'une parcelle

- **Cliquez directement sur un marqueur bleu** pour le supprimer
- La ligne correspondante dans le tableau disparaît automatiquement

---

## 🏗️ Architecture Technique

### Composants

#### **1. ParcelleMarkerManager** (`parcelleMarkerManager.js`)

Gestionnaire principal des marqueurs de parcelles manuels.

**Responsabilités :**
- Gestion du mode d'ajout (activation/désactivation)
- Création et suppression des marqueurs
- Récupération des données cadastrales via l'API
- Persistance dans localStorage
- Émission d'événements personnalisés

**Propriétés principales :**
```javascript
{
  map: google.maps.Map,              // Instance de la carte
  errorModal: ErrorModal,            // Gestion des erreurs
  isActive: boolean,                 // État du mode
  markers: Map<string, Object>,      // Collection des marqueurs
  nextMarkerNumber: number,          // Compteur pour numérotation
  mapClickListener: Object,          // Écouteur de clic carte
  keydownListener: Function          // Écouteur touche Échap
}
```

#### **2. ResumeParcellesControl** (modification dans `resuméParcelles.js`)

Contrôle d'interface du résumé des parcelles.

**Nouvelles fonctionnalités :**
- Bouton "+" pour activer/désactiver le mode
- Écouteurs d'événements pour synchroniser l'UI
- Affichage des lignes de parcelles manuelles dans le tableau
- Mise à jour visuelle du bouton selon l'état

---

## 🎨 Interface Utilisateur

### Bouton d'ajout

**État inactif :**
- Symbole : **"+"**
- Couleur : **Vert** (#4CAF50)
- Tooltip : "Ajouter une parcelle manuellement"

**État actif :**
- Symbole : **"×"** (croix)
- Couleur : **Rouge** (#f44336)
- Tooltip : "Annuler (Échap)"

### Marqueurs sur la carte

**Apparence :**
- 📍 Pin bleu standard Google Maps (SVG)
- 🏷️ Label bleu avec le nom de la parcelle (ex: "AS 188")
- 🎯 Cliquable pour suppression
- ☁️ Ombre portée pour effet 3D

**Composants du marqueur :**
```
┌─────────────┐
│   📍 Pin    │  ← SVG bleu avec cercle blanc
│             │
│ ┌─────────┐ │
│ │ AS 188  │ │  ← Label bleu
│ └─────────┘ │
└─────────────┘
```

### Tableau des parcelles

**Lignes de parcelles manuelles :**
- Background : Bleu très léger (rgba(33, 150, 243, 0.05))
- Bordure gauche : **Aucune** (pour cohérence visuelle)
- Texte : **Noir** (#000)
- Format : "Autre parcelle n° X" | "Section Numéro - Surface m²"

---

## 🔌 API et Événements

### Événements personnalisés

Tous les événements sont définis dans `constants.js` :

```javascript
CUSTOM_EVENTS = {
  PARCELLE_MARKER_ADDED: 'parcelleMarkerAdded',
  PARCELLE_MARKER_REMOVED: 'parcelleMarkerRemoved',
  PARCELLE_MARKER_MODE_ACTIVATED: 'parcelleMarkerModeActivated',
  PARCELLE_MARKER_MODE_DEACTIVATED: 'parcelleMarkerModeDeactivated'
}
```

#### **PARCELLE_MARKER_ADDED**

Émis lors de la création d'un marqueur.

**Détails de l'événement :**
```javascript
{
  markerId: string,           // ID du marqueur (ex: "parcelle-1")
  markerNumber: number,       // Numéro séquentiel (1, 2, 3...)
  position: {
    lat: number,
    lng: number
  },
  cadastreData: {
    numero: string,           // Numéro de parcelle
    section: string,          // Section cadastrale
    surface: number           // Surface en m²
  },
  isReload?: boolean         // true si rechargement depuis localStorage
}
```

**Écoute de l'événement :**
```javascript
document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_ADDED, (event) => {
  const { markerId, cadastreData } = event.detail;
  console.log(`Nouvelle parcelle : ${cadastreData.section} ${cadastreData.numero}`);
});
```

#### **PARCELLE_MARKER_REMOVED**

Émis lors de la suppression d'un marqueur.

**Détails de l'événement :**
```javascript
{
  markerId: string           // ID du marqueur supprimé
}
```

#### **PARCELLE_MARKER_MODE_ACTIVATED**

Émis lors de l'activation du mode d'ajout.

**Usage :**
```javascript
document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_MODE_ACTIVATED, () => {
  console.log("Mode ajout de parcelles activé");
  // Mise à jour de l'UI
});
```

#### **PARCELLE_MARKER_MODE_DEACTIVATED**

Émis lors de la désactivation du mode d'ajout.

---

## 💾 Structure des Données

### localStorage

Les marqueurs de parcelles sont sauvegardés dans `solarProjectData` :

```javascript
{
  "solarProjectData": {
    "shapes": { /* zones dessinées */ },
    "manualParcelles": {
      "parcelle-1": {
        "id": "parcelle-1",
        "number": 1,
        "position": {
          "lat": 48.8566,
          "lng": 2.3522
        },
        "cadastreData": {
          "numero": "188",
          "section": "AS",
          "surface": 2456
        },
        "createdAt": "2024-10-07T14:30:00.000Z"
      },
      "parcelle-2": { /* ... */ }
    },
    "nextParcelleMarkerNumber": 3
  }
}
```

### Méthodes de persistence

**Sauvegarde automatique :**
```javascript
_saveToStorage() {
  const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
  savedData.manualParcelles = /* données des marqueurs */;
  savedData.nextParcelleMarkerNumber = this.nextMarkerNumber;
  localStorage.setItem("solarProjectData", JSON.stringify(savedData));
}
```

**Chargement automatique :**
```javascript
async _loadMarkersFromStorage() {
  const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
  // Recréation des marqueurs depuis les données sauvegardées
}
```

---

## 🔍 API Cadastrale

### Endpoint

```
GET /api/cadastre-geoportail?lat={latitude}&lng={longitude}
```

### Réponse

**Succès :**
```javascript
{
  "numero": "188",
  "section": "AS",
  "surface": 2456
}
```

**Échec :**
```javascript
{
  "error": "Aucune donnée cadastrale disponible"
}
```

### Gestion des erreurs

Si l'API ne retourne pas de données cadastrales :
- ❌ Le marqueur **n'est pas créé**
- 🚨 Un message d'erreur est affiché à l'utilisateur
- 📝 Message : "Impossible de récupérer les données cadastrales pour ce point"

---

## ⚠️ Avertissements

### Point dans une zone existante

Si l'utilisateur clique sur un point situé dans une zone déjà dessinée :
- ⚠️ Un **avertissement** est affiché
- ✅ Le marqueur est **créé quand même** (choix de l'utilisateur)
- 📝 Message : "Ce point se trouve dans une zone déjà dessinée. Le marqueur sera créé mais pourrait être redondant."

**Algorithme de détection :**
- Utilise l'algorithme **ray-casting** pour déterminer si un point est dans un polygone
- Vérifie toutes les zones (`shapes`) sauvegardées dans localStorage

---

## 🎨 Styles et Constantes

### Style du label (dans `constants.js`)

```javascript
PARCELLE_MARKER_LABEL: `
  background-color: rgba(33, 150, 243, 0.95);
  border: 2px solid #1976D2;
  border-radius: 6px;
  color: white;
  font-family: Arial, sans-serif;
  font-size: 11px;
  font-weight: bold;
  padding: 6px 10px;
  text-align: center;
  box-shadow: 0 3px 6px rgba(0,0,0,0.3);
  min-width: 80px;
  white-space: nowrap;
`
```

### SVG du pin Google Maps

```html
<svg width="30" height="40" viewBox="0 0 30 40">
  <path d="M15 0C8.925 0 4 4.925 4 11c0 8.25 11 24 11 24s11-15.75 11-24c0-6.075-4.925-11-11-11z" 
        fill="#2196F3" stroke="#1565C0" stroke-width="1"/>
  <circle cx="15" cy="11" r="4" fill="white"/>
</svg>
```

---

## 🔧 Méthodes Publiques

### ParcelleMarkerManager

#### `toggleMode()`

Active ou désactive le mode d'ajout de marqueur.

```javascript
const isActive = parcelleMarkerManager.toggleMode();
console.log(`Mode actif : ${isActive}`);
```

**Retour :** `boolean` - Nouvel état du mode

#### `isActiveMode()`

Vérifie si le mode est actuellement actif.

```javascript
if (parcelleMarkerManager.isActiveMode()) {
  console.log("Mode d'ajout actif");
}
```

**Retour :** `boolean`

#### `getMarkers()`

Obtient tous les marqueurs.

```javascript
const markers = parcelleMarkerManager.getMarkers();
markers.forEach((markerData, markerId) => {
  console.log(`${markerId}: ${markerData.cadastreData.section} ${markerData.cadastreData.numero}`);
});
```

**Retour :** `Map<string, Object>`

#### `cleanup()`

Nettoie toutes les ressources (marqueurs, écouteurs, etc.).

```javascript
parcelleMarkerManager.cleanup();
```

---

## 📊 Exemples d'Utilisation

### Exemple 1 : Écouter l'ajout de parcelles

```javascript
document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_ADDED, (event) => {
  const { markerId, cadastreData, position } = event.detail;
  
  console.log('Nouvelle parcelle ajoutée :');
  console.log(`  - ID: ${markerId}`);
  console.log(`  - Parcelle: ${cadastreData.section} ${cadastreData.numero}`);
  console.log(`  - Surface: ${cadastreData.surface} m²`);
  console.log(`  - Position: ${position.lat}, ${position.lng}`);
  
  // Exemple : Envoyer les données au serveur
  fetch('/api/parcelles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markerId, cadastreData, position })
  });
});
```

### Exemple 2 : Activer le mode programmatiquement

```javascript
// Accéder au ParcelleMarkerManager via ResumeParcellesControl
const resumeParcelles = document.querySelector('.parcelles-container');
const parcelleManager = resumeParcelles.parcelleMarkerManager;

// Activer le mode
if (parcelleManager && !parcelleManager.isActiveMode()) {
  parcelleManager.toggleMode();
  console.log("Mode d'ajout activé programmatiquement");
}
```

### Exemple 3 : Exporter les parcelles manuelles

```javascript
function exportManualParcelles() {
  const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
  const manualParcelles = savedData.manualParcelles || {};
  
  const parcelles = Object.values(manualParcelles).map(p => ({
    numero: p.cadastreData.numero,
    section: p.cadastreData.section,
    surface: p.cadastreData.surface,
    lat: p.position.lat,
    lng: p.position.lng
  }));
  
  console.table(parcelles);
  return parcelles;
}
```

---

## 🐛 Débogage

### Logs de débogage

Les logs sont activés dans le code pour faciliter le débogage :

**Console du ParcelleMarkerManager :**
```
🟢 ParcelleMarkerManager: Activation du mode
🟢 Émission de l'événement PARCELLE_MARKER_MODE_ACTIVATED
🔴 ParcelleMarkerManager: Désactivation du mode
🔴 Émission de l'événement PARCELLE_MARKER_MODE_DEACTIVATED
```

**Console du ResumeParcellesControl :**
```
_updateAddButtonState appelé avec isActive = true
this.addParcelleButton existe ? true
Activation du mode : bouton rouge avec croix
État final du bouton : {text: "×", backgroundColor: "#f44336", color: "white"}
```

### Problèmes courants

#### Le bouton ne change pas d'état

**Symptôme :** Le bouton reste vert avec un "+" même après un clic.

**Solution :**
1. Vérifier que `this.addParcelleButton` n'est pas null
2. Vérifier l'ordre d'initialisation dans le constructeur
3. Consulter les logs de la console

#### Les marqueurs ne se rechargent pas

**Symptôme :** Après un refresh, les marqueurs ne réapparaissent pas.

**Solution :**
1. Vérifier que `AdvancedMarkerElement` est chargé
2. Vérifier les données dans localStorage
3. Augmenter le délai d'attente dans `_loadMarkersFromStorage()`

#### L'API cadastre ne retourne pas de données

**Symptôme :** Le marqueur ne se crée pas malgré un clic.

**Solution :**
1. Vérifier que le point est en France
2. Vérifier que l'API `/api/cadastre-geoportail` est fonctionnelle
3. Consulter les logs du navigateur et du serveur

---

## 🚀 Améliorations Futures

### Fonctionnalités potentielles

- [ ] **Édition du label** : Permettre de modifier le nom affiché
- [ ] **Marqueurs personnalisés** : Choisir la couleur du marqueur
- [ ] **Import/Export** : Exporter les parcelles en CSV/JSON
- [ ] **Filtres** : Filtrer les parcelles par section ou surface
- [ ] **Statistiques** : Calcul automatique de la surface totale
- [ ] **Groupement** : Regrouper plusieurs parcelles en une zone
- [ ] **Historique** : Annuler/Refaire les ajouts/suppressions

---

## 📚 Références

### Fichiers du projet

- `parcelleMarkerManager.js` - Gestionnaire principal
- `resuméParcelles.js` - Interface utilisateur
- `constants.js` - Constantes et événements
- `ToolBar.js` - Intégration dans la toolbar

### Documentation externe

- [Google Maps JavaScript API - AdvancedMarkerElement](https://developers.google.com/maps/documentation/javascript/advanced-markers)
- [API Géoportail - Cadastre](https://geoservices.ign.fr/documentation/services/api-et-services-ogc/wms-ogc)
- [MDN - CustomEvent](https://developer.mozilla.org/fr/docs/Web/API/CustomEvent)

---

## 📝 Changelog

### Version 1.0.0 (Octobre 2024)

**Fonctionnalités initiales :**
- ✅ Mode d'ajout de marqueurs avec bouton toggle
- ✅ Récupération automatique des données cadastrales
- ✅ Marqueurs bleus avec pin Google Maps
- ✅ Labels avec nom de parcelle (section + numéro)
- ✅ Suppression au clic sur le marqueur
- ✅ Persistance dans localStorage
- ✅ Rechargement automatique au démarrage
- ✅ Gestion de la touche Échap
- ✅ Avertissement si point dans zone existante
- ✅ Gestion des erreurs API
- ✅ Interface sobre sans animations

---

## 👥 Contributeurs

- Développement initial : Assistant IA + Seb
- Architecture : Pattern event-driven avec CustomEvents
- Design : Interface minimaliste et intuitive

---

## 📄 Licence

Ce code fait partie du projet OmbriDesign. Tous droits réservés.

