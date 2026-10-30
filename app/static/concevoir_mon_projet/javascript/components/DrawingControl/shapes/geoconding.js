export default class GeocodingMarker {
    constructor(drawingControl) {
        this.drawingControl = drawingControl;
        this.markers = [];
        this.isActive = false;
        this.mapClickListener = null;
    }

    get map() {
        return this.drawingControl.map;
    }

    startMode() {
        this.stopMode();
        this.isActive = true;
        this.map.setOptions({ draggableCursor: 'crosshair' });
        
        this.mapClickListener = google.maps.event.addListener(this.map, 'click', (e) => {
            this.placeMarker(e.latLng);
        });
    }

    stopMode() {
        this.isActive = false;
        if (this.mapClickListener) {
            google.maps.event.removeListener(this.mapClickListener);
            this.mapClickListener = null;
        }
        if (this.map) {
            this.map.setOptions({ draggableCursor: null });
        }
    }

    formatDMS(dd, isLng) {
        const dir = dd < 0 ? (isLng ? 'W' : 'S') : (isLng ? 'E' : 'N');
        const absDd = Math.abs(dd);
        const deg = Math.floor(absDd);
        const min = Math.floor((absDd - deg) * 60);
        const sec = ((absDd - deg - min / 60) * 3600).toFixed(2);
        return `${deg}°${min}'${sec}"${dir}`;
    }

    placeMarker(latLng) {
      const lat = latLng.lat();
      const lng = latLng.lng();
  
      const latDMS = this.formatDMS(lat, false);
      const lngDMS = this.formatDMS(lng, true);
  
      // 1. Création du conteneur principal pour le marqueur personnalisé
      const markerContainer = document.createElement('div');
      markerContainer.style.cssText = 'position: relative; display: flex; justify-content: center; align-items: center;';
  
      // 2. Création de l'icône de la croix en SVG
      const crossSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      crossSvg.setAttribute('width', '18');
      crossSvg.setAttribute('height', '18');
      crossSvg.setAttribute('viewBox', '-9 -9 18 18');
      crossSvg.innerHTML = `<path d="M -6,-6 L 6,6 M 6,-6 L -6,6" stroke="#FF0000" stroke-width="3" fill="none" />`;
  
      // 3. Création du label rectangulaire avec fond blanc
      const labelDiv = document.createElement('div');
      labelDiv.style.cssText = `
          position: absolute;
          bottom: 22px; /* Positionne le bas du label à 22px au-dessus du centre de la croix */
          left: 50%;
          transform: translateX(-50%);
          background-color: white;
          color: black;
          padding: 6px 10px;
          border-radius: 5px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          font-size: 13px;
          font-weight: bold;
          text-align: left;
          white-space: nowrap;
          border: 2px solid #FF0000; /* Bordure rouge */
      `;
      
      // 4. Contenu du label sur deux lignes
      labelDiv.innerHTML = `Long: ${lng.toFixed(6)} (${lngDMS})<br>Lat: ${lat.toFixed(6)} (${latDMS})`;
  
      // 5. Assemblage du marqueur
      markerContainer.appendChild(labelDiv);
      markerContainer.appendChild(crossSvg);

        const marker = new this.drawingControl.AdvancedMarkerElement({
            position: latLng,
            map: this.map,
            content: markerContainer,
            title: 'Coordonnées',
            gmpDraggable: true // Rend le marqueur déplaçable
        });

        // 6. Mise à jour des coordonnées en temps réel lors du déplacement
        marker.addListener('drag', () => {
            const pos = marker.position;
            const latVal = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
            const lngVal = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
            
            const newLatDMS = this.formatDMS(latVal, false);
            const newLngDMS = this.formatDMS(lngVal, true);
            
            labelDiv.innerHTML = `Long: ${lngVal.toFixed(6)} (${newLngDMS})<br>Lat: ${latVal.toFixed(6)} (${newLatDMS})`;
        });

        // 7. Suppression au clic droit (gérée sur l'élément HTML)
        marker.content.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            marker.map = null; // La suppression se fait en mettant .map à null
            this.markers = this.markers.filter(m => m !== marker);
        });

        this.markers.push(marker);
    }

    /**
     * CORRECTIF (bug rapporté : "TypeError: this.geocodingMarkerManager.clearAll is not a
     * function", déclenché à chaque changement de projet via DrawingControl.clearAllShapes()
     * -> l'évènement 'clearData') : cette méthode n'avait jamais été implémentée alors qu'elle
     * était déjà appelée à 2 endroits (clearAllShapes(), destroy()) — l'exception levée à chaque
     * fois interrompait ces deux méthodes avant leur toute dernière instruction.
     */
    clearAll() {
        this.markers.forEach((m) => { m.map = null; });
        this.markers = [];
    }
}
