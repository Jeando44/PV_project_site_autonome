## API publique — @ombridesign

Liste des méthodes exposées et événements inter-modules. Les extraits renvoient aux lignes sources pour contexte.

---

## Routes API Backend (Flask)

### GET `/api/pvgis`

Récupère les données de production photovoltaïque depuis l'API PVGIS (JRC).

**Paramètres** :
- `lat` (requis) : Latitude du projet
- `lon` (requis) : Longitude du projet
- `peakpower` : Puissance crête en kWp (défaut: 1)
- `mountingplace` : Type de montage ('free', 'building', défaut: 'free')
- `loss` : Pertes système en % (défaut: 14)
- `angle` : Angle d'inclinaison en degrés (défaut: 35)
- `aspect` : Orientation azimut en degrés (défaut: 0 = sud)

**Réponse** :
```json
{
  "outputs": {
    "monthly": { ... },
    "totals": { ... }
  }
}
```

**Utilisation** :
```javascript
const response = await fetch(`/api/pvgis?lat=${lat}&lon=${lng}&peakpower=1&angle=35&aspect=0`);
const data = await response.json();
```

---

### GET `/api/cadastre-geoportail`

Récupère les informations cadastrales d'une parcelle via l'API WMTS Géoportail (GetFeatureInfo).

**Paramètres** :
- `lat` (requis) : Latitude du point de requête
- `lng` (requis) : Longitude du point de requête

**Réponse** :
```json
{
  "numero": "123",
  "feuille": "A01",
  "section": "AB",
  "surface": 1500
}
```

**Notes** :
- Zoom fixe à 19 pour interrogation des parcelles
- Utilise le service WMTS `CADASTRALPARCELS.PARCELLAIRE_EXPRESS`
- Parse la réponse HTML du service GetFeatureInfo
- Retourne un objet vide `{}` si aucune parcelle trouvée

**Utilisation** :
```javascript
const response = await fetch(`/api/cadastre-geoportail?lat=${lat}&lng=${lng}`);
const parcelleData = await response.json();
if (parcelleData.numero) {
  console.log(`Parcelle ${parcelleData.section} ${parcelleData.numero} - ${parcelleData.surface} m²`);
}
```

**Fichier source** : `app.py` lignes 321-386

---

### GET `/api/cadastre-proxy/<code_insee>`

Proxy CORS pour le service WMS INSPIRE du cadastre (inspire.cadastre.gouv.fr).

**Paramètres URL** :
- `code_insee` (requis dans path) : Code INSEE de la commune (5 chiffres)

**Paramètres query** :
- `SERVICE` : Type de service (défaut: 'WMS')
- `VERSION` : Version WMS (défaut: '1.3.0')
- `REQUEST` : Type de requête (défaut: 'GetMap')
- `FORMAT` : Format d'image (défaut: 'image/png')
- `TRANSPARENT` : Transparence (défaut: 'true')
- `LAYERS` : Couches WMS (10 couches actives - voir liste ci-dessous)
- `STYLES` : Styles des couches (vide = styles INSPIRE par défaut)
- `CRS` : Système de coordonnées (défaut: 'EPSG:3857')
- `BBOX` (requis) : Bounding box de la tuile
- `WIDTH` : Largeur en pixels (défaut: '256')
- `HEIGHT` : Hauteur en pixels (défaut: '256')

**Couches INSPIRE utilisées (complètes)** :

| N° | Couche | Description | Couleur serveur |
|----|--------|-------------|-----------------|
| 1 | `AMORCES_CAD` | Numéros de rues et amorces cadastrales | Noir |
| 2 | `LIEUDIT` | Lieux-dits (toponymes) | Noir |
| 3 | `CP.CadastralParcel` | Parcelles cadastrales (contours) | Noir/Gris foncé |
| 4 | `SUBFISCAL` | Subdivisions fiscales | Gris clair |
| 5 | `CLOTURE` | Clôtures (murs, fossés, haies) | Gris |
| 6 | `DETAIL_TOPO` | Détails topographiques (parkings, terrains de sport, etc.) | Variable |
| 7 | `HYDRO` | Éléments hydrographiques (cours d'eau, plans d'eau, piscines) | Bleu |
| 8 | `VOIE_COMMUNICATION` | Voies de communication (chemins, routes, ponts, tunnels) | Variable |
| 9 | `BU.Building` | Bâtiments (constructions) | Gris |
| 10 | `BORNE_REPERE` | Bornes et repères géodésiques (NGF, limites communes) | Symboles |

**Note sur les couleurs** :
- 🎨 Les couleurs sont définies par le serveur WMS INSPIRE
- 🔒 Non personnalisables côté client (norme européenne INSPIRE)
- ✅ `STYLES=''` utilise automatiquement les styles standard
- 📐 Respect des spécifications de la directive européenne 2007/2/CE

**Référence** : Guide WMS officiel (`docs/Guide_WMS_fr.md` pages 192-603)

**Réponse** : Image PNG avec headers CORS

**Utilisation** :
Utilisé par `ImageMapType` de Google Maps pour afficher les tuiles cadastrales :
```javascript
const cadastreTileLayer = new google.maps.ImageMapType({
  getTileUrl: function(coord, zoom) {
    const bbox = computeBBOX(coord, zoom); // Calcul EPSG:3857
    return `/api/cadastre-proxy/${codeInsee}?` +
           `LAYERS=${layers}&BBOX=${bbox}&...`;
  }
});
```

**Notes** :
- Contourne les restrictions CORS du service INSPIRE
- Encode manuellement l'URL pour éviter la corruption des paramètres WMS
- Timeout de 10 secondes
- Validation stricte du code INSEE (5 chiffres numériques)

**Fichier source** : `app.py` lignes 387-453

---

### DrawingControl

- onAdd(map): ajoute le contrôle à la carte, initialise UI et listeners
```146:159:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
onAdd(map) {
  this.map = map;
  this.initializeContainer();
  this.initializeDrawingManager();
  ButtonControl.createControls(this);
  google.maps.event.addListener(map, 'zoom_changed', () => {
    const zoom = map.getZoom();
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.MAP_ZOOM_CHANGED, { detail: { zoom } }));
  });
  // ...
  return this.container;
}
```

- toggleSimpleRectangleMode(button): active/désactive le mode rectangle simple
```831:859:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
toggleSimpleRectangleMode(button) {
  // ... active/désactive, setDrawingMode(google.maps.drawing.OverlayType.RECTANGLE)
}
```

- toggleSimplePolygonMode(button): active/désactive le mode polygone simple
```866:894:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
toggleSimplePolygonMode(button) {
  // ... setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
}
```

- pasteShape(position): colle la forme copiée au clic carte
```685:717:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
pasteShape(position) {
  // ... calcule delta, crée Polygon avec styles par défaut, génère pvId, listeners, form restore
}
```

- updateDrawButtonState(zoomLevel): met à jour l’état du bouton dessin
```470:472:static/ombridesign/javascript/components/DrawingControl/DrawingControl.js
updateDrawButtonState(zoomLevel) {
  ButtonControl.updateDrawButtonState(this, zoomLevel);
}
```

Événements émis (exemples):
- `CUSTOM_EVENTS.SHAPE_ADDED`, `SHAPE_REMOVED`, `MAP_ZOOM_CHANGED`, `SHAPE_PASTED`.

### StorageManager

- savePageData(): collecte et persiste l’état (formes, formulaire, carte)
```283:335:static/ombridesign/javascript/services/StorageManager.js
async savePageData() { /* ... localStorage + CUSTOM_EVENTS.SAVE_PAGE_DATA ... */ }
```

- loadPageData(): charge l’état et déclenche "loadData"
```346:360:static/ombridesign/javascript/services/StorageManager.js
async loadPageData() { /* ... dispatchEvent("loadData", data) ... */ }
```

- clearPageData(): supprime l’état et déclenche "clearData"
```367:379:static/ombridesign/javascript/services/StorageManager.js
async clearPageData() { /* ... localStorage.removeItem + dispatchEvent("clearData") ... */ }
```

- addEventListener(event, cb), removeEventListener(event, cb), dispatchEvent(event, data)
```873:911:static/ombridesign/javascript/services/StorageManager.js
addEventListener(event, callback) { /* ... */ }
removeEventListener(event, callback) { /* ... */ }
dispatchEvent(event, data) { /* ... */ }
```

Événements écoutés/émis:
- écoute `CUSTOM_EVENTS.*` pour sauvegardes/suppressions, émet `SAVE_PAGE_DATA`.

### MapViewsControl (ToolBar → Vues)

- toggleCadastreLayer(show?): bascule la couche WMTS cadastre (fond blanc + overlayMapTypes)
```524:554:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
toggleCadastreLayer(show) { 
  /* ... mapTypes 'blank', overlayMapTypes push/remove, maxZoom 19 ... */ 
}
```

- toggleCadastreWMS(show?): bascule la couche WMS cadastre avec détection automatique de localisation
```561:604:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
async toggleCadastreWMS(show) { 
  /* ... GET_CODE_INSEE_BY_COORDINATES + _setupCadastreWMSLocationListener ... */ 
}
```

- _setupCadastreWMSLocationListener(): configure l'écouteur intelligent de changement de localisation
```694:732:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
_setupCadastreWMSLocationListener() { 
  /* ... map.addListener('idle') + debounce 500ms + auto reload si code INSEE change ... */ 
}
```

- _updateCadastreWMSForNewLocation(newCodeInsee): recharge le cadastre pour une nouvelle commune
```744:765:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
async _updateCadastreWMSForNewLocation(newCodeInsee) { 
  /* ... _removeCadastreWMSLayer + _createCadastreWMSLayer + _addCadastreWMSLayer ... */ 
}
```

- toggleCadastreGeoJson(): charge GeoJSON cadastre et ajoute `data` layer + labels
```767:744:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
async toggleCadastreGeoJson() { /* ... GET_CODE_INSEE_BY_COORDINATES + GET_CADASTRE_DATA + map.data ... */ }
```

- updateCadastreLabels(): rend labels de parcelles visibles (bounds + AdvancedMarkerElement)
```746:795:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
updateCadastreLabels() { /* ... bounds.contains(center) + AdvancedMarkerElement ... */ }
```

**Fonctionnalités intelligentes** :
- 🎯 **Détection automatique** : Le cadastre WMS se recharge automatiquement quand l'utilisateur change de ville
- ⏱️ **Debouncing** : 500ms pour éviter les requêtes excessives
- 🗺️ **Transitions fluides** : Rechargement transparent sans interruption visuelle
- 🔒 **Limitations zoom** : Cadastre Géoportail max 19, Cadastre WMS max 20

### Hooks/événements globaux — GoogleMaps

- `window.addEventListener('getMapData', ...)` → répond via `mapDataResponse`
```142:185:static/ombridesign/javascript/GoogleMaps.js
window.addEventListener('getMapData', () => { /* ... dispatch mapDataResponse ... */ });
```








