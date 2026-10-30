## Persistance — StorageManager

Fichier: `javascript/services/StorageManager.js`

### Objectif
- Centraliser la persistance via `localStorage`
- Sauvegarder/charger des structures JSON atomiquement
- Gérer les erreurs de parsing et versions de schéma

### Bonnes pratiques
- Utiliser `try/catch` uniquement autour des accès `localStorage`
- Valider les entrées/sorties des méthodes publiques
- Versionner les clés et effectuer des migrations si nécessaire

### Extraits de code

Sauvegarde périodique (autosave) et capture des données carte et formes:
```283:335:static/ombridesign/javascript/services/StorageManager.js
async savePageData() {
  try {
    const existingData = localStorage.getItem(this.storageKey);
    const data = existingData ? JSON.parse(existingData) : this.defaultData;
    this.lastSaveTime = Date.now();
    const newData = { shapes: {}, formData: {}, lines: {}, circles: {}, texts: {}, simpleRectangles: {}, simplePolygons: {} };
    this.dispatchEvent("collectData", newData);
    data.shapes = newData.shapes; data.formData = newData.formData; // ...
    if (window.map) {
      const center = window.map.getCenter();
      data.mapCenter = { lat: center.lat(), lng: center.lng() };
      data.mapZoom = window.map.getZoom();
    }
    localStorage.setItem(this.storageKey, JSON.stringify(data));
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SAVE_PAGE_DATA));
    return true;
  } catch (error) { console.error("Erreur lors de la sauvegarde des données:", error); return false; }
}
```

IndexedDB pour cache cadastre (par `codeInsee`):
```421:447:static/ombridesign/javascript/services/StorageManager.js
const db = await this.openDatabase();
const transaction = db.transaction(["cadastre"], "readwrite");
const store = transaction.objectStore("cadastre");
store.put({ codeInsee, data, timestamp: Date.now() });
```


