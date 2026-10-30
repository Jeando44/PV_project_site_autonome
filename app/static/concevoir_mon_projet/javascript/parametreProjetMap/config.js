// config.js - Configuration globale de l'application
export const CONFIG = {
    debounceDelay: 250,
    maxSuggestions: 10,

    apiKey: null, // Chargé de manière sécurisée via fetchApiKey()
    mapConfig: {
        zoom: 4,
        center: {lat: 54.5260, lng: 15.2551  },
        mapTypeId: 'hybrid',
        mapId: "1cae0887db1f1441cb97ec53",
    },
    drawingOptions: {
        markerOptions: { draggable: true },
        circleOptions: {
            fillColor: '#ff0000',
            fillOpacity: 0.3,
            strokeWeight: 2,
            clickable: false,
            editable: true,
            zIndex: 1
        },
        rectangleOptions: {
            fillColor: '#00ff00',
            fillOpacity: 0.3,
            strokeWeight: 2,
            clickable: false,
            editable: true,
            zIndex: 1
        },
        polylineOptions: {
            strokeColor: '#0000ff',
            strokeWeight: 3,
            editable: true
        }
    },
    libraries: ["drawing", "places", "marker"]
};

/**
 * Récupère la clé API Google Maps depuis l'endpoint Flask authentifié.
 * La clé est mise en cache dans CONFIG.apiKey après le premier appel.
 */
export async function fetchApiKey() {
    if (CONFIG.apiKey) return CONFIG.apiKey;
    const response = await fetch('/concevoir_mon_projet/api/config/maps-key');
    if (!response.ok) throw new Error(`Impossible de récupérer la clé Maps (${response.status})`);
    const { key } = await response.json();
    CONFIG.apiKey = key;
    return key;
}