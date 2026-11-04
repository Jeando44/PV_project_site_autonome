import { DrawingControl } from './components/index.js';
import ToolBar from './components/ToolBar/ToolBar.js'; // Ajout de l'importation pour ToolBar
import ScaleControl from './components/ScaleControl/ScaleControl.js'; // Ajout de l'importation pour ScaleControl
import { GET_CODE_INSEE_BY_COORDINATES } from '../API/API.js'; // GET_CADASTRE_DATA supprimé
import { storageManager } from './services/StorageManager.js';
import { adresseCourteDepuisGoogle, raccourcirTexteAdresse } from './parametreProjetMap/adresseCourte.js';
import ExportService from './services/ExportService.js?v=13'; // Import pour injecter la toolbar — ?v= : cf. ButtonControl.js (même valeur, singleton getInstance())
let map;
let marker;

// NOUVEAU: Synchronise l'apparence du bouton "Afficher/Masquer le rayon de 3km" (toolbar
// DrawingControl) avec l'état réel de visibilité de window._projectAddressCircle, y compris
// lorsque ce dernier change en dehors d'un clic sur le bouton (affichage par défaut, clic sur
// la carte pour masquer, etc.).
function syncRadiusToggleButton(visible) {
  const button = document.getElementById('toggle-radius-button');
  if (!button) return;
  if (visible) {
    button.classList.add('selected');
    button.style.backgroundColor = '#e3f2fd';
    button.title = 'Masquer le rayon de 3km';
  } else {
    button.classList.remove('selected');
    button.style.backgroundColor = 'white';
    button.title = 'Afficher le rayon de 3km';
  }
}


async function initMap() {
  // Import des bibliothèques nécessaires pour le géocodage seulement
  const { Geocoder } = await google.maps.importLibrary("geocoding");

  // IMPORTANT : Charger les données du projet depuis la DB si un projet est sélectionné
  const currentProjetId = localStorage.getItem('current_projet_id');
  if (currentProjetId && window.calepinageService) {
    console.log(`🔄 Chargement des données du projet ${currentProjetId} depuis la base de données...`);
    try {
      await window.calepinageService.loadFromDatabase(parseInt(currentProjetId));
      console.log(`✅ Données du projet ${currentProjetId} chargées depuis la DB`);
    } catch (error) {
      console.error('❌ Erreur lors du chargement des données du projet:', error);
    }
  }

  // Récupérer les données de la carte
  let center = { lat: 48.8566, lng: 2.3522 }; // Valeur par défaut (Paris)
  let zoom = 12; // Zoom par défaut

  // CORRIGÉ (2026-08-07) : juste après avoir coché "Actif" sur un projet, l'utilisateur doit voir la
  // carte se centrer sur l'ADRESSE de ce projet (cf. bloc de restauration d'adresse plus bas, qui fait
  // un fitBounds sur le cercle de 3km) — pas sur le dernier centre/zoom sauvegardé (potentiellement un
  // zoom très rapproché laissé par une session d'édition précédente). On ignore donc le centre/zoom
  // sauvegardé pour cette seule navigation, identifiée par le paramètre d'URL 'activated_project' posé
  // par selectAndLoadProject() (parametreProjetFormManager.js).
  const justActivatedProject = new URLSearchParams(window.location.search).has('activated_project');

  // Charger les données sauvegardées de manière asynchrone pour le centre et zoom
  storageManager.loadPageData().then(data => {
    if (justActivatedProject) {
      console.log('ℹ️ Projet tout juste activé : centre/zoom sauvegardés ignorés au profit de l\'adresse du projet');
      return;
    }
    if (data) {
      console.log('📍 Centre/Zoom chargés depuis localStorage:', { center: data.mapCenter, zoom: data.mapZoom });
      center = data.mapCenter || center;
      zoom = data.mapZoom || zoom;

      // Mettre à jour la carte si elle est déjà initialisée
      if (map) {
        map.setCenter(center);
        map.setZoom(zoom);
      }
    } else {
      console.log('ℹ️ Aucune donnée de centre/zoom dans localStorage');
    }
  });

  // SECTION INITIALISATION DE LA CARTE
  map = new google.maps.Map(document.getElementById("map"), {
    center: center,
    zoom: zoom,
    mapId: "1cae0887db1f1441cb97ec53",
    mapTypeId: "hybrid",
    mapTypeControl: false,
    disableDefaultUI: true,
    // CORRECTIF (étiquettes/icônes POI Google Maps — bugs + gêne visuelle) : clickableIcons:false
    // empêche les clics sur les icônes de POI (commerces, restaurants...) d'ouvrir leur fiche
    // d'information flottante et d'intercepter le clic à la place des outils de dessin/sélection
    // en dessous — corrige la partie "bug" du problème. Ceci NE masque PAS visuellement les
    // étiquettes/icônes elles-mêmes : avec un mapId défini (carte vectorielle, nécessaire ici pour
    // tiltInteractionEnabled/rotateControl), le tableau `styles` classique est ignoré par l'API — la
    // visibilité des POI ne se configure plus en JS mais UNIQUEMENT via le Style de carte associé à
    // ce Map ID dans Google Cloud Console (cf. réponse détaillée, aucun changement de code possible
    // pour cette partie-là).
    clickableIcons: false,
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
    streetViewControl: false,
    fullscreenControl: true,
    fullscreenControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
    scaleControl: true,
    scaleControlOptions: {
      position: google.maps.ControlPosition.RIGHT_TOP
    },
    maxZoom: 25, // Permettre un zoom maximum jusqu'au niveau 25   
  });

  // Rendre la carte accessible globalement
  window.map = map;

  //!SECTION BOUTON DE GEOLOCALISATION
  const locationButton = document.createElement("button");
  locationButton.innerHTML = `<img src="https://fonts.gstatic.com/s/i/materialicons/my_location/v1/24px.svg" alt="Localisation">`;
  locationButton.classList.add("custom-map-control-button");
  locationButton.style.cssText = `
    background-color: #fff;
    border: 0;
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    margin: 0px 10px;
    padding: 8px;
    cursor: pointer;
  `;
  locationButton.title = 'Localiser votre position';
  map.controls[google.maps.ControlPosition.RIGHT_TOP].push(locationButton);

  // Gestionnaire d'événements pour la géolocalisation
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
          if (ToolBar) {
            ToolBar.updateSelectedLocation(codeInsee);
          }
        },
        (error) => {
          console.error("Erreur de géolocalisation:", error);
          alert("La géolocalisation n'est pas disponible sur votre navigateur.");
        }
      );
    } else {
      alert("La géolocalisation n'est pas supportée par votre navigateur.");
    }
  });

  // SECTION SwitcherControl (Satellite, Plan, Cadastre, Tilt 3D, Input Autocomplete Places)
  // let cadastreData = null; // Plus utilisé ici
  const toolBarInstance = new ToolBar({
    // La fonction onSelect qui chargeait GET_CADASTRE_DATA n'est plus nécessaire ici
    // car MapViewsControl gère directement la couche WMTS sans pré-chargement de données GeoJSON.
    // Si ToolBar attend toujours une prop onSelect, elle peut être une fonction vide ou omise
    // en fonction de la définition du constructeur de ToolBar.
    // Pour l'instant, on la supprime.
  });
  await toolBarInstance.onAdd(map);

  // Exposition globale pour les modules devant piloter les fonds de carte
  // (ex: export_plans_pdf_dxf/utils/MapLayerSwitcher.js) sans dupliquer la logique
  // de bascule OSM/Géoportail/Cadastre déjà implémentée dans MapViewsControl.
  window.mapViewsControl = toolBarInstance.mapViewsControl;
  // Exposition globale pour ButtonControl.js (bouton "Calculer et Visualiser") : déclenche le
  // rafraîchissement groupé des n° de parcelle, cf. resuméParcelles.js::refreshAllParcelles().
  window.resumeParcellesControl = toolBarInstance.resumeParcellesControl;

  // Injecter la toolbar dans ExportService pour l'affichage du spinner
  ExportService.getInstance().setToolbar(toolBarInstance);

  // SECTION DRAWING
  const drawingControl = new DrawingControl();
  map.controls[google.maps.ControlPosition.BOTTOM_CENTER].push(drawingControl.onAdd(map));

  // BOUTON DE CHANGEMENT D'ORIENTATION DES PANNEAUX
  const orientationButton = document.createElement("button");
  orientationButton.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/orientation_panel.svg" alt="Orientation panneaux" style="width:24px;height:24px;">`;
  orientationButton.classList.add("custom-map-control-button");
  orientationButton.style.cssText = `
    background-color: #fff;
    border: 0;
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    margin: 10px;
    padding: 8px;
    cursor: pointer;
  `;
  orientationButton.title = "Changer l'orientation des panneaux (Paysage/Portrait)";
  map.controls[google.maps.ControlPosition.RIGHT_TOP].push(orientationButton);

  // Gestionnaire d'événements du bouton d'orientation des panneaux
  orientationButton.addEventListener("click", () => {
    try {
      if (window.drawingControl && typeof window.drawingControl.togglePanelOrientation === 'function') {
        window.drawingControl.togglePanelOrientation();
      } else {
        console.warn("DrawingControl ou togglePanelOrientation indisponible");
      }
    } catch (error) {
      console.error("Erreur lors du changement d'orientation des panneaux :", error);
    }
  });

  // BOUTON "TOURNER L'AZIMUT DE 90°"
  //
  // REMPLACE (demande explicite : "remplacer ce bouton par le bouton Tourner l'azimut de 90° qui
  // est dans le menu horizontal de la modale Calepinage multi-typologie") l'ancien bouton
  // "Changer l'azimut (+180°)" (icône swap.svg). Celui-ci pilotait le calepinage rectangulaire
  // historique : il écrivait dans `#azimuth-<pvId>` et basculait `shape.isAzimuthFlipped` sur une
  // forme de `drawingControl.drawnShapes` — c'est-à-dire des données qui ne servent plus, tout le
  // calepinage passant désormais par le module résidentiel.
  //
  // Le nouveau bouton exécute EXACTEMENT l'action de #cmFlipAzimuthBtn de la modale
  // (CM.tournerAzimut90, extraite pour être partagée) sur le champ PV sélectionné sur la carte,
  // que la modale soit ouverte ou non.
  const azimuthButton = document.createElement("button");
  azimuthButton.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/rotate-right.svg" alt="Tourner l'azimut" style="width:24px;height:24px;">`;
  azimuthButton.classList.add("custom-map-control-button");
  azimuthButton.style.cssText = `
    background-color: #fff;
    border: 0;
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    margin: 10px;
    padding: 8px;
    cursor: pointer;
  `;
  azimuthButton.title = "Tourner l'azimut de 90° (Sud\u2192Ouest\u2192Nord\u2192Est\u2192Sud) — toiture Monopente uniquement";
  map.controls[google.maps.ControlPosition.RIGHT_TOP].push(azimuthButton);

  azimuthButton.addEventListener("click", () => {
    const CM = window.CalepinageMaisonIndiv;
    const mgr = window.MaisonPolygonManagerInstance;
    if (!CM || typeof CM.tournerAzimut90 !== 'function') {
      console.warn("Module de calepinage indisponible : rotation de l'azimut impossible.");
      return;
    }

    // Champ PV visé : celui sélectionné sur la carte, sinon celui affiché dans la modale, sinon
    // l'unique champ tracé. Même ordre de préférence que le bouton "Ouvrir le calepinage
    // résidentiel" de la palette (ButtonControl.js).
    const polySelectionne = (mgr && mgr.selected)
      || (mgr && mgr.polygons && mgr.polygons.length === 1 ? mgr.polygons[0] : null);
    const sourceId = (polySelectionne && polySelectionne.maisonId)
      || (CM.state && CM.state.sourceId);
    if (!sourceId) {
      if (window.showValidationAlert) {
        window.showValidationAlert("Sélectionnez d'abord un champ PV sur la carte.");
      } else {
        alert("Sélectionnez d'abord un champ PV sur la carte.");
      }
      return;
    }

    // Bascule temporaire de CM.state sur ce champ (patron déjà utilisé par getAllPvFieldSummaries
    // et le formulaire PRO), puis restauration — tournerAzimut90() agit sur CM.state.
    const etatCible = (CM.state && CM.state.sourceId === sourceId)
      ? CM.state
      : (typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(sourceId) : null);
    if (!etatCible) {
      console.warn("Aucun calepinage pour le champ PV", sourceId);
      return;
    }

    const precedent = CM.state;
    CM.state = etatCible;
    let applique = false;
    try {
      applique = CM.tournerAzimut90();
    } catch (error) {
      console.error("Erreur lors de la rotation de l'azimut :", error);
    } finally {
      CM.state = precedent;
    }

    if (!applique) {
      const message = "La rotation de l'azimut n'est disponible qu'en toiture Monopente.";
      if (window.showValidationAlert) window.showValidationAlert(message);
      else alert(message);
      return;
    }

    // Sauvegarde + rafraîchissement des vues (flèche/label sur la carte, canevas si ouvert,
    // formulaire PRO) — tous branchés sur 'calepinageMaisonFieldChanged'.
    if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(sourceId, 'azimut');
  });

  // IMPORTANT: Charger les données APRÈS que DrawingControl soit prêt
  // Cela garantit que les écouteurs d'événements sont configurés
  setTimeout(() => {
    console.log('🔄 Chargement des données de calepinage...');
    storageManager.loadPageData().then(data => {
      if (data) {
        console.log('✅ Données de calepinage chargées:', data);
      } else {
        console.log('ℹ️ Aucune donnée de calepinage à charger');
      }
    });

    // Restaurer le marker d'adresse du projet sur la carte principale
    const projetId = localStorage.getItem('current_projet_id');
    if (projetId) {
      console.log(`📍 Tentative de restauration adresse pour projet ${projetId}...`);
      fetch(`/concevoir_mon_projet/parametre-projet/${projetId}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          console.log('📍 Réponse API projet:', data?.success, 'adresse_projet:', data?.projet?.adresse_projet);
          if (!data.success || !data.projet?.adresse_projet) {
            console.warn('📍 Pas d\'adresse projet disponible');
            return;
          }
          // Parser robuste : gère les doubles sérialisations
          let d = data.projet.adresse_projet;
          for (let i = 0; i < 3 && typeof d === 'string'; i++) {
            try { d = JSON.parse(d); } catch (e) { break; }
          }
          // Cas particulier : {"adresse": "<json string avec lat/lng>"} — l'objet externe n'a pas lat/lng
          if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
            try { d = JSON.parse(d.adresse); } catch (e) { }
          }
          console.log('📍 Données adresse parsées:', d);
          if (!d || typeof d !== 'object' || !d.latitude || !d.longitude) {
            console.warn('📍 Coordonnées manquantes dans adresse_projet');
            return;
          }
          const position = new google.maps.LatLng(d.latitude, d.longitude);
          // CORRIGÉ (2026-08-07) : le cercle de 3km est masqué par défaut à l'arrivée sur la carte
          // (map: null) — l'utilisateur l'affiche explicitement via le bouton "Afficher le rayon de
          // 3km" s'il en a besoin, plutôt que de le trouver déjà sélectionné sans l'avoir demandé.
          window._projectAddressCircle = new google.maps.Circle({
            strokeColor: '#00AAFF', strokeOpacity: 0.8, strokeWeight: 2,
            fillColor: '#00AAFF', fillOpacity: 0.2,
            map: null, center: position, radius: d.radius || 3000, clickable: true, zIndex: 50
          });
          console.log('✅ Cercle de 3km créé (masqué par défaut)', { center: position.toJSON(), radius: d.radius || 3000, onMap: window._projectAddressCircle.getMap() === map });
          window._projectAddressMarker = new google.maps.Marker({
            position, map: null,
            title: `Centre du rayon de 3km: ${d.adresse || ''}`,
            // NOUVEAU: croix (plutôt qu'un simple point plein) pour identifier le centre du cercle
            icon: {
              path: 'M -9,0 L 9,0 M 0,-9 L 0,9',
              strokeColor: '#00AAFF', strokeWeight: 3, strokeOpacity: 1,
              fillOpacity: 0, scale: 1
            },
            draggable: true
          });
          // Le bouton "Afficher/Masquer le rayon de 3km" doit refléter l'état initial (masqué par
          // défaut), sinon il afficherait "Masquer..." alors que le cercle est déjà invisible.
          syncRadiusToggleButton(false);
          // NOUVEAU: clic à l'intérieur du cercle => zoom maximum centré sur l'adresse du site.
          // event.stop() : sur les cartes vectorielles (mapId défini), un clic sur le cercle peut
          // aussi remonter jusqu'au clic de la carte ci-dessous ; sans cet arrêt, le cercle se
          // masquait immédiatement après tout clic dessus (le sien ET celui de la carte se déclenchaient).
          window._projectAddressCircle.addListener('click', (event) => {
            if (event && typeof event.stop === 'function') event.stop();
            map.setCenter(position);
            map.setZoom(22);
          });
          // NOUVEAU: clic droit sur le cercle => masquer directement le cercle et la croix.
          window._projectAddressCircle.addListener('rightclick', (event) => {
            if (event && typeof event.stop === 'function') event.stop();
            if (window._projectAddressCircle && window._projectAddressCircle.getMap()) {
              window._projectAddressCircle.setMap(null);
              if (window._projectAddressMarker) {
                window._projectAddressMarker.setMap(null);
              }
              syncRadiusToggleButton(false);
            }
          });
          // NOUVEAU: clic en dehors du cercle (donc sur la carte, puisque le clic sur le cercle
          // lui-même est intercepté par son propre listener ci-dessus) => masquer le cercle ET
          // la croix de son centre.
          map.addListener('click', () => {
            if (window._projectAddressCircle && window._projectAddressCircle.getMap()) {
              window._projectAddressCircle.setMap(null);
              if (window._projectAddressMarker) {
                window._projectAddressMarker.setMap(null);
              }
              syncRadiusToggleButton(false);
            }
          });
          // Listener dragend : met à jour cercle, champs modale, et DB
          window._projectAddressMarker.addListener('dragend', (event) => {
            const newLat = event.latLng.lat();
            const newLng = event.latLng.lng();
            if (window._projectAddressCircle) {
              window._projectAddressCircle.setCenter(event.latLng);
            }
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: newLat, lng: newLng } }, (results, status) => {
              const adresseGeocodeur = (status === 'OK' && results[0]) ? results[0].formatted_address : null;
              // Adresse COURTE enregistrée/affichée partout (cf. parametreProjetMap/adresseCourte.js) ;
              // le texte du géocodeur est conservé dans `adresse_complete`.
              const address = adresseGeocodeur
                ? (adresseCourteDepuisGoogle(results[0].address_components) || raccourcirTexteAdresse(adresseGeocodeur))
                : `${newLat.toFixed(6)}, ${newLng.toFixed(6)}`;
              const adresseJson = JSON.stringify(Object.assign(
                { adresse: address, latitude: newLat, longitude: newLng, radius: 3000, type: 'Cercle (Paramètre projet)' },
                adresseGeocodeur && adresseGeocodeur !== address ? { adresse_complete: adresseGeocodeur } : {}
              ));
              // Mettre à jour les champs de la modale si disponibles
              const hiddenField = document.getElementById('parametre_project_hidden');
              if (hiddenField) hiddenField.value = adresseJson;
              const searchField = document.getElementById('parametreProjectSearch');
              if (searchField) searchField.value = address;
              // Synchroniser avec mapSyncManager si disponible (met à jour coordManager)
              if (window.mapSyncManager) window.mapSyncManager.updateAddressField(address, newLat, newLng);
              // Sauvegarder en DB
              const projetId = localStorage.getItem('current_projet_id');
              if (!projetId) return;
              const formData = new FormData();
              const csrf = document.querySelector('input[name="csrf_token"]');
              if (csrf) formData.append('csrf_token', csrf.value);
              formData.append('adresse_projet', adresseJson);
              fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/update`, { method: 'POST', body: formData })
                .then(r => r.json())
                .then(res => { if (res.success) console.log('✅ Adresse mise à jour:', address); })
                .catch(e => console.error('❌ Erreur sauvegarde adresse:', e));
            });
          });
          // fitBounds ajuste automatiquement le zoom pour montrer le cercle complet — mais peut
          // parfois pousser le zoom bien au-delà d'un niveau lisible (proche du zoom maximal) pour un
          // petit cercle de 3km. On plafonne donc le résultat à un niveau raisonnable (17) une fois
          // que fitBounds a fini de recalculer les bounds (listener 'bounds_changed' déclenché une
          // seule fois, pattern standard pour ce cas Google Maps).
          // NOUVEAU (demande explicite : "en fermant le modal du calepinage, tomber sur le contour
          // du projet plutôt que d'avoir à le chercher sur la carte") : ce recadrage est différé de
          // 500 ms au chargement de la page. Si, entre-temps, le calepinage résidentiel a déjà cadré
          // la carte sur le contour d'une maison (fermeture de son modal, rouvert automatiquement
          // après un rechargement), l'écraser ramènerait l'utilisateur à 3 km de son bâtiment. On
          // laisse alors le cadrage en place ; le cercle et son marqueur restent affichés comme avant.
          if (window._calepinageMaisonASurchargeLeCadrage) {
            console.log('ℹ️ Cadrage sur le contour du calepinage conservé : recentrage sur le cercle de l adresse ignoré');
          } else {
            google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
              if (map.getZoom() > 17) map.setZoom(17);
            });
            map.fitBounds(window._projectAddressCircle.getBounds());
          }
          console.log('✅ Marker d\'adresse restauré sur la carte principale:', d.adresse);
        })
        .catch(e => console.error('❌ Erreur restauration adresse:', e));
    }
  }, 500); // Délai pour s'assurer que DrawingControl est complètement initialisé

  // SECTION SCALE CONTROL
  const scaleControl = new ScaleControl({
    editable: true,
    autoZoom: true, // La carte zoome automatiquement lors du changement d'échelle
    // onChange: (scale) => {
    //   console.log('Échelle changée:', scale);
    // }
  });
  map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(scaleControl.onAdd(map));

  // Rendre le contrôle d'échelle accessible globalement
  window.scaleControl = scaleControl;
}



initMap();


// Modifier l'écouteur d'événements pour attendre que la carte soit complètement chargée
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