## Google Maps — Architecture et API

Cette page documente `javascript/GoogleMaps.js` et les conventions associées.

### Objectifs
- Initialiser la carte, couches et contrôles personnalisés
- Encapsuler l’API dans des classes dédiées
- Gérer markers via `google.maps.AdvancedMarkerElement`
- Utiliser `LatLngBounds` pour les calculs d’emprise

### Concepts
- Initialisation: création de l’instance de carte, options, listeners
- Overlays: markers avancés, polygones, polylignes
- Événements: ajout avec gestion d’erreurs et nettoyage
- Performances: debounce pour mises à jour fréquentes

### Fichiers
- `javascript/GoogleMaps.js`
- `javascript/components/ToolBar/ToolBar.js`

### Bonnes pratiques
- Toujours nettoyer listeners et overlays lors des destructions
- Regrouper les écoutes intensives avec `debounce`
- Utiliser des constantes plutôt que des valeurs en dur

### Extraits de code

Initialisation de la carte et options d’UI:
```31:63:static/ombridesign/javascript/GoogleMaps.js
  // SECTION INITIALISATION DE LA CARTE
  map = new google.maps.Map(document.getElementById("map"), {
    center: center,
    zoom: zoom,
    mapId: "1692cc120a8531d3",
    mapTypeId: "hybrid",
    mapTypeControl: false,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
    tiltInteractionEnabled: true,
    zoomInteractionEnabled: true,
    rotateControl: true,
    rotateControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
    tilt: 0,
    heading: 0,
    streetViewControl: true,
    streetViewControlOptions: {
        position: google.maps.ControlPosition.RIGHT_TOP
    },
    fullscreenControl: true,
    fullscreenControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
    scaleControl: true,
    scaleControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
  });
```

Bouton de géolocalisation et `AdvancedMarkerElement`:
```84:107:static/ombridesign/javascript/GoogleMaps.js
  locationButton.addEventListener("click", async () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const pos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(pos.lat, pos.lng);
          // Centrer la carte sur la position de l'utilisateur
          map.setCenter(pos);
          map.setZoom(17);

          // Ajouter un marqueur à la position
          if (marker) {
            marker.setMap(null);
          }
          marker = new google.maps.marker.AdvancedMarkerElement({
            position: pos,
            map: map,
            title: "Votre position"
          });
```

Événement de récupération des données de carte avec timeout de sécurité:
```142:185:static/ombridesign/javascript/GoogleMaps.js
window.addEventListener('getMapData', () => {
  // Vérifier si la carte est initialisée et attendre qu'elle soit prête
  const waitForMap = setInterval(() => {
    if (map && typeof map.getCenter === 'function') {
      clearInterval(waitForMap);
      try {
        const center = map.getCenter();
        const mapData = {
          center: {
            lat: center.lat(),
            lng: center.lng()
          },
          zoom: map.getZoom()
        };

        window.dispatchEvent(new CustomEvent('mapDataResponse', {
          detail: mapData
        }));
      } catch (error) {
        console.warn('Erreur lors de la récupération des données de la carte:', error);
        window.dispatchEvent(new CustomEvent('mapDataResponse', {
          detail: {
            center: { lat: 48.8143, lng: 3.0834 },
            zoom: 22
          }
        }));
      }
    }
  }, 100);

  // Timeout de sécurité après 5 secondes
  setTimeout(() => {
    clearInterval(waitForMap);
    if (!map || typeof map.getCenter !== 'function') {
      window.dispatchEvent(new CustomEvent('mapDataResponse', {
        detail: {
          center: { lat: 48.8143, lng: 3.0834 },
          zoom: 22
        }
      }));
    }
  }, 5000);
});
```


