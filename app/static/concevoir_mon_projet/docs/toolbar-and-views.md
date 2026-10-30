## ToolBar & Vues

Fichiers principaux:
- `components/ToolBar/ToolBar.js`
- `components/ToolBar/components/mapViews.js`
- `components/ToolBar/components/resuméCalepinage.js`
- `components/ToolBar/components/resuméParcelles.js`
- `components/ToolBar/components/searchAdress.js`

### Responsabilités
- Exposer des contrôles de carte personnalisés
- Orchestrer navigation/états des panneaux
- Publier des `CustomEvents` pour la communication entre composants

### Principes
- Séparer DOM (interface) et logique métier
- Gérer les états de chargement/erreur
- Fournir des retours visuels sur les actions

### Extraits de code

WMTS Cadastre (IGN) avec `ImageMapType` et URL WMTS:
```21:29:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
 // Initialisation de la couche Cadastre WMTS IGN
 this.cadastreTileLayer = new google.maps.ImageMapType({
  getTileUrl: (coord, zoom) => {
    return `https://data.geopf.fr/wmts?LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&FORMAT=image/png&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${zoom}&TILEROW=${coord.y}&TILECOL=${coord.x}`;
  },
  tileSize: new google.maps.Size(256, 256),
  name: "Cadastre IGN",
  maxZoom: 19,
});
```

Création d’un fond blanc dédié et enregistrement de type de carte:
```44:50:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
const blankMapStyle = [
  { featureType: "all", elementType: "all", stylers: [{ visibility: "off" }] }
];
const blankMapType = new google.maps.StyledMapType(blankMapStyle, { name: "Fond Blanc" });
this.map.mapTypes.set('blank', blankMapType);
```

Basculer couche WMTS et restaurer `mapTypeId` + `maxZoom`:
```276:306:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
toggleCadastreLayer(show) {
  const toolbar = this.toolbarContext;
  const shouldShow = show !== undefined ? show : !toolbar.isLayerVisible;

  if (shouldShow) {
    this.clearCadastreGeoJson();
    this.previousMapTypeId = this.map.getMapTypeId();
    this.map.setMapTypeId('blank');
    this.map.overlayMapTypes.push(this.cadastreTileLayer);
    toolbar.isLayerVisible = true;
    this.map.setOptions({ maxZoom: 19 });
    if (this.map.getZoom() > 19) this.map.setZoom(19);
  } else {
    if (toolbar.isLayerVisible) {
      let foundAndRemoved = false;
      for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
        if (this.map.overlayMapTypes.getAt(i) === this.cadastreTileLayer) {
          this.map.overlayMapTypes.removeAt(i);
          foundAndRemoved = true;
          break;
        }
      }
      if (foundAndRemoved) {
        this.map.setMapTypeId(this.previousMapTypeId || 'roadmap');
        this.map.setOptions({ maxZoom: 22 });
      }
      toolbar.isLayerVisible = false;
    }
  }
  this._updateCadastreButtonState();
}
```

Labels de parcelles via `AdvancedMarkerElement` et filtrage par `LatLngBounds`:
```365:413:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
updateCadastreLabels() {
  if (!this.map || !this.isGeoJsonVisible) return;
  const zoom = this.map.getZoom();
  this.parcelLabels.forEach(label => label.map = null);
  this.parcelLabels = [];
  if (zoom < 18) return;
  const bounds = this.map.getBounds();
  if (!bounds || !this.cadastreParcelles) return;
  this.cadastreParcelles.features.forEach(feature => {
    if (feature.geometry && feature.geometry.type === 'Polygon' && feature.properties.section && feature.properties.numero) {
      const center = this._getPolygonCenter(feature.geometry);
      if (bounds.contains(center)) {
        const labelText = `${feature.properties.section}${feature.properties.numero}`;
        const labelDiv = document.createElement('div');
        labelDiv.textContent = labelText;
        labelDiv.style.cssText = `color: black; font-weight: bold; font-size: 16px; text-shadow: -1px -1px 0 #FFF, 1px -1px 0 #FFF, -1px 1px 0 #FFF, 1px 1px 0 #FFF;`;
        const parcelLabel = new google.maps.marker.AdvancedMarkerElement({ position: center, content: labelDiv, map: this.map });
        this.parcelLabels.push(parcelLabel);
      }
    }
  });
}
```

### Gestion intelligente du cadastre WMS

**Détection automatique des changements de localisation** :

Le cadastre WMS de cadastre.gouv.fr est maintenant **intelligent** et se met à jour automatiquement quand l'utilisateur change de ville.

```694:765:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
_setupCadastreWMSLocationListener() {
  // Éviter les doublons
  this._removeCadastreWMSLocationListener();
  
  // Debounce pour éviter trop de requêtes pendant le déplacement
  let debounceTimeout = null;
  
  this.cadastreWMSMoveListener = this.map.addListener('idle', async () => {
    // Ne rien faire si le cadastre WMS n'est plus visible
    if (!this.isCadastreWMSVisible) {
      return;
    }
    
    // Debounce de 500ms
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    debounceTimeout = setTimeout(async () => {
      try {
        const newCenter = this.map.getCenter();
        const newCodeInsee = await GET_CODE_INSEE_BY_COORDINATES(newCenter.lat(), newCenter.lng());
        
        // Si le code INSEE a changé, recharger la couche
        if (newCodeInsee && newCodeInsee !== this.currentCadastreCodeInsee) {
          console.log(`📍 Changement de localisation détecté : ${this.currentCadastreCodeInsee} → ${newCodeInsee}`);
          await this._updateCadastreWMSForNewLocation(newCodeInsee);
        }
      } catch (error) {
        console.error("Erreur lors de la vérification du code INSEE:", error);
        // Ne pas afficher d'erreur à l'utilisateur pour ne pas perturber la navigation
      }
    }, 500);
  });
}
```

**Fonctionnement** :
1. **Écouteur 'idle'** : Déclenché quand l'utilisateur arrête de bouger/zoomer la carte
2. **Debouncing 500ms** : Évite les appels API excessifs pendant les déplacements
3. **Vérification du code INSEE** : Compare le nouveau centre avec l'ancien
4. **Rechargement automatique** : Si le code INSEE change, la couche est rechargée

**Cas d'usage** :
- ✅ Utilisateur dézoome depuis Paris
- ✅ Se déplace vers Lyon
- ✅ Rezoome → Le cadastre de Lyon s'affiche automatiquement
- ✅ Aucune action manuelle requise !

**Limitations du zoom** :
- **Cadastre Géoportail WMTS** : Zoom maximum verrouillé à **19**
- **Cadastre WMS cadastre.gouv.fr** : Zoom maximum à **20**

---

### Configuration complète des couches cadastrales WMS

Le cadastre WMS utilise **toutes les 10 couches INSPIRE disponibles** pour un affichage cadastral complet :

```636:653:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
// Couches cadastrales INSPIRE selon la documentation officielle (Guide WMS)
// Toutes les couches disponibles pour un affichage cadastral complet
const layers = [
  'AMORCES_CAD',           // Amorces cadastrales (numéros de rues)
  'LIEUDIT',               // Lieux-dits (toponymes)
  'CP.CadastralParcel',    // Parcelles cadastrales (contours)
  'SUBFISCAL',             // Subdivisions fiscales
  'CLOTURE',               // Clôtures (murs, fossés, haies)
  'DETAIL_TOPO',           // Détails topographiques (parkings, terrains, etc.)
  'HYDRO',                 // Éléments hydrographiques (cours d'eau, plans d'eau)
  'VOIE_COMMUNICATION',    // Voies de communication (chemins, routes, ponts)
  'BU.Building',           // Bâtiments (constructions)
  'BORNE_REPERE'           // Bornes et repères géodésiques
].join(',');

// Styles par défaut du serveur ('' = style INSPIRE standard)
// Le serveur WMS définit les couleurs selon les spécifications INSPIRE
const styles = '';
```

**Détail des couches** :

| Couche | Contenu visible | Couleur (définie par serveur) | Utilité |
|--------|----------------|-------------------------------|---------|
| **AMORCES_CAD** | Numéros de rues, limites administratives | Noir | Orientation, adresses |
| **LIEUDIT** | Noms de lieux-dits | Noir | Localisation géographique |
| **CP.CadastralParcel** | Contours de parcelles, numéros | Noir/Gris foncé | Base cadastrale |
| **SUBFISCAL** | Subdivisions fiscales | Gris clair | Découpage fiscal |
| **CLOTURE** | Murs, fossés, haies, clôtures | Gris | Limites physiques |
| **DETAIL_TOPO** | Parkings, terrains de sport, trottoirs, pylônes, cimetières | Variable | Détails du territoire |
| **HYDRO** | Cours d'eau, lacs, étangs, piscines, puits | Bleu | Hydrographie |
| **VOIE_COMMUNICATION** | Chemins, routes, ponts, tunnels, axes de voie | Variable | Réseau routier |
| **BU.Building** | Emprise des bâtiments (maisons, hangars, églises) | Gris | Constructions |
| **BORNE_REPERE** | Points géodésiques, NGF, bornes communales | Symboles spécifiques | Repères géodésiques |

**Gestion des couleurs** :

```651:653:static/ombridesign/javascript/components/ToolBar/components/mapViews.js
// Styles par défaut du serveur ('' = style INSPIRE standard)
// Le serveur WMS définit les couleurs selon les spécifications INSPIRE
const styles = '';
```

- 🎨 **Styles serveur INSPIRE** : Les couleurs sont **fixes** et standardisées
- 🇪🇺 **Norme européenne** : Conforme à la directive 2007/2/CE
- 🔒 **Non modifiable** : `STYLES=''` active les styles par défaut
- ✅ **Cohérence visuelle** : Affichage uniforme sur tout le territoire

**Avantages de l'affichage complet** :
- ✅ **10 couches** au lieu de 4 (amélioration de 150%)
- ✅ Numéros de rues visibles (AMORCES_CAD)
- ✅ Clôtures et limites physiques
- ✅ Hydrographie en bleu (cours d'eau, plans d'eau)
- ✅ Réseau routier complet
- ✅ Repères géodésiques pour les professionnels

**Note** : Si certaines couches ne sont pas disponibles pour une commune spécifique, le serveur WMS les ignore automatiquement sans générer d'erreur.

**Référence complète** : Voir `docs/Guide_WMS_fr.md` lignes 192-603 pour la documentation officielle de chaque couche.

---

### Résumé des Parcelles (ResumeParcellesControl)

Affiche un tableau récapitulatif des zones dessinées avec leurs informations cadastrales.

**Fonctionnalités** :
- Affichage automatique de l'adresse du projet
- Liste des zones avec numéro et données cadastrales
- Récupération asynchrone des informations de parcelle via `/api/cadastre-geoportail`
- Mise à jour en temps réel via événements personnalisés
- Debouncing pour optimiser les performances

**Récupération des données cadastrales** :
```254:273:static/ombridesign/javascript/components/ToolBar/components/resuméParcelles.js
async _getParcelleInfo(lat, lng, shapeId) {
  try {
    const response = await fetch(`/api/cadastre-geoportail?lat=${lat}&lng=${lng}`);
    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status}`);
    }
    const parcelleData = await response.json();
    
    // Déclencher un événement personnalisé avec les données
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CADASTRAL_DATA_LOADED, {
      detail: { shapeId, parcelleData: parcelleData && parcelleData.numero ? parcelleData : null }
    }));

  } catch (error) {
    // En cas d'erreur, déclencher l'événement avec des données null
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CADASTRAL_DATA_LOADED, {
      detail: { shapeId, parcelleData: null }
    }));
  }
}
```

**Événements écoutés** :
- `CUSTOM_EVENTS.SHAPE_ADDED` : Mise à jour lors de l'ajout d'une zone
- `CUSTOM_EVENTS.SHAPE_REMOVED` : Mise à jour lors de la suppression d'une zone
- `CUSTOM_EVENTS.CADASTRAL_DATA_LOADED` : Mise à jour de l'affichage avec les données cadastrales
- `CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED` : Rafraîchissement du tableau

**Structure des données** :
- Récupère `numero`, `section`, `feuille` et `surface` depuis l'API Géoportail
- Affiche format : `{section} {numero} - {surface} m²`
- Affiche `(Parcelle non identifiée)` si aucune donnée disponible


