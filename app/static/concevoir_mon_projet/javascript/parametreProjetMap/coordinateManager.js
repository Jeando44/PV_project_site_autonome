export class CoordinateManager {
    constructor() {
        this.projectCoordinates = [];
        this.pdlCoordinates = [];
        this.parametreCoordinates = [];
        this.allOverlays = [];
        this.isEditMode = false;
        console.log('CoordinateManager initialized');
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            const deleteButton = e.target.closest('.btn-delete');
            if (deleteButton) {
                const mode = deleteButton.dataset.mode;
                const id = parseFloat(deleteButton.dataset.id);
                this.deleteCoordinate(mode, id);
            }
        });
    }

    setEditMode(mode) {
        this.isEditMode = mode;
    }

    _normalizeCoordinates(rawCoordData) {
        if (!rawCoordData) return { lat: 0, lng: 0 };
        
        if (rawCoordData.lat !== undefined && rawCoordData.lng !== undefined) {
            return { lat: Number(rawCoordData.lat), lng: Number(rawCoordData.lng) };
        }
        
        if (rawCoordData.coordinates) {
            if (typeof rawCoordData.coordinates.lat === 'number' && 
                typeof rawCoordData.coordinates.lng === 'number') {
                return { 
                    lat: rawCoordData.coordinates.lat, 
                    lng: rawCoordData.coordinates.lng 
                };
            }
        }
        
        console.error("[CoordinateManager] Impossible de normaliser:", rawCoordData);
        return { lat: 0, lng: 0 };
    }

    addCoordinate(coordData, mode) {
        const newId = coordData.id || Date.now() + Math.random();
        const normalized = this._normalizeCoordinates(coordData);
        
        const newCoordItem = {
            id: newId,
            type: coordData.type || 'Point',
            coordinates: normalized,
            address: coordData.address || 'Adresse inconnue',
            overlay: coordData.overlay || null,
            circle: coordData.circle || null,
            radius: coordData.radius || 3000
        };

        // Marquer l'overlay avec son ID
        if (newCoordItem.overlay) {
            newCoordItem.overlay._id = newCoordItem.id;
            this.allOverlays.push(newCoordItem.overlay);
        }

        // Marquer le cercle avec son ID
        if (newCoordItem.circle) {
            newCoordItem.circle._id = newCoordItem.id;
            this.allOverlays.push(newCoordItem.circle);
        }

        if (mode === 'parametreProject') {
            // Pour parametreProject, on ne garde qu'un seul élément
            if (!this.isEditMode) {
                this.clearCoordinates('parametreProject');
            }
            this.parametreCoordinates = [newCoordItem];
        } else if (mode === 'project') {
            this.projectCoordinates = [newCoordItem];
        } else {
            this.pdlCoordinates.push(newCoordItem);
        }

        this.updateCoordinatesTable(mode);
        this.updateHiddenFields();
    }

    updateExistingCoordinate(updatedCoordData, mode) {
        let list = mode === 'parametreProject' ? this.parametreCoordinates :
                   mode === 'project' ? this.projectCoordinates : this.pdlCoordinates;
        
        const index = list.findIndex(item => item.id === updatedCoordData.id);
        
        if (index !== -1) {
            const normalized = this._normalizeCoordinates(updatedCoordData);
            list[index] = {
                ...list[index],
                coordinates: normalized,
                address: updatedCoordData.address || list[index].address,
                type: updatedCoordData.type || list[index].type,
                overlay: updatedCoordData.overlay || list[index].overlay,
                circle: updatedCoordData.circle || list[index].circle,
                radius: updatedCoordData.radius || list[index].radius
            };
            
            this.updateCoordinatesTable(mode);
            this.updateHiddenFields();
        }
    }

    deleteCoordinate(mode, id) {
        let list = mode === 'parametreProject' ? this.parametreCoordinates :
                   mode === 'project' ? this.projectCoordinates : this.pdlCoordinates;
        
        const updatedList = list.filter(item => {
            if (item.id === id) {
                // Supprimer l'overlay
                if (item.overlay && item.overlay.setMap) {
                    item.overlay.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.overlay);
                }
                // Supprimer le cercle
                if (item.circle && item.circle.setMap) {
                    item.circle.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.circle);
                }
                return false;
            }
            return true;
        });

        if (mode === 'parametreProject') this.parametreCoordinates = updatedList;
        else if (mode === 'project') this.projectCoordinates = updatedList;
        else this.pdlCoordinates = updatedList;

        this.updateCoordinatesTable(mode);
        this.updateHiddenFields();
        return true;
    }

    updateCoordinatesTable(mode) {
        // Pour parametreProject, on n'affiche pas de tableau
        if (mode === 'parametreProject') {
            return;
        }

        // Pour les autres modes, vous pouvez garder votre logique existante
        const tableBody = document.getElementById(`${mode}CoordinatesBody`);
        if (!tableBody) return;

        const list = mode === 'project' ? this.projectCoordinates : this.pdlCoordinates;
        
        if (!list.length) {
            tableBody.innerHTML = '<tr class="no-data"><td colspan="5">Aucune coordonnée définie</td></tr>';
            return;
        }

        const rows = list.map(item => {
            const coords = this._normalizeCoordinates(item);
            const latDisplay = coords.lat.toFixed(6);
            const lngDisplay = coords.lng.toFixed(6);
            const address = item.address || 'Adresse non spécifiée';
            
            return `
                <tr>
                    <td>${item.type}</td>
                    <td>${latDisplay}</td>
                    <td>${lngDisplay}</td>
                    <td class="address-cell" title="${address}">${address}</td>
                    <td>
                        <button type="button" class="btn-delete" data-mode="${mode}" data-id="${item.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = rows.join('');
    }

    updateHiddenFields() {
        // Mise à jour du champ caché pour parametreProject
        const parametreField = document.getElementById('parametre_project_hidden') || 
                              document.getElementById('adresse_parametre_projet_cacher');
        
        if (parametreField) {
            if (this.parametreCoordinates.length) {
                const c = this.parametreCoordinates[0];
                parametreField.value = JSON.stringify({
                    id: c.id,
                    type: c.type,
                    latitude: c.coordinates.lat,
                    longitude: c.coordinates.lng,
                    adresse: c.address,
                    ...(c.addressComplete ? { adresse_complete: c.addressComplete } : {}),
                    radius: c.radius || 3000
                });
            } else {
                parametreField.value = '';
            }
        }

        // Mise à jour des autres champs cachés si nécessaire
        // ...
    }

    getCoordinates(mode) {
        if (mode === 'parametreProject') return this.parametreCoordinates;
        if (mode === 'project') return this.projectCoordinates;
        return this.pdlCoordinates;
    }

    clearCoordinates(mode) {
        if (mode === 'parametreProject') {
            this.parametreCoordinates.forEach(item => {
                if (item.overlay && item.overlay.setMap) {
                    item.overlay.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.overlay);
                }
                if (item.circle && item.circle.setMap) {
                    item.circle.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.circle);
                }
            });
            this.parametreCoordinates = [];
        } else if (mode === 'project') {
            this.projectCoordinates.forEach(item => {
                if (item.overlay && item.overlay.setMap) {
                    item.overlay.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.overlay);
                }
            });
            this.projectCoordinates = [];
        } else {
            this.pdlCoordinates.forEach(item => {
                if (item.overlay && item.overlay.setMap) {
                    item.overlay.setMap(null);
                    this.allOverlays = this.allOverlays.filter(o => o !== item.overlay);
                }
            });
            this.pdlCoordinates = [];
        }

        this.updateCoordinatesTable(mode);
        this.updateHiddenFields();
    }

    clearAllCoordinates() {
        this.allOverlays.forEach(o => { 
            if (o && typeof o.setMap === 'function') o.setMap(null); 
        });
        
        this.projectCoordinates = [];
        this.pdlCoordinates = [];
        this.parametreCoordinates = [];
        this.allOverlays = [];
        
        this.updateCoordinatesTable('parametreProject');
        this.updateCoordinatesTable('project');
        this.updateCoordinatesTable('pdl');
        this.updateHiddenFields();
    }

    initFromHiddenFields() {
        const parametreField = document.getElementById('parametre_project_hidden') || 
                              document.getElementById('adresse_parametre_projet_cacher');
        
        if (parametreField && parametreField.value) {
            try {
                const d = JSON.parse(parametreField.value);
                this.parametreCoordinates = [{
                    id: d.id || Date.now(),
                    type: d.type || 'Cercle (Paramètre projet)',
                    coordinates: { lat: d.latitude, lng: d.longitude },
                    address: d.adresse || d.address || '',
                    addressComplete: d.adresse_complete || null,
                    radius: d.radius || 3000,
                    overlay: null,
                    circle: null
                }];
            } catch (e) {
                console.warn('initFromHiddenFields: parametre invalide', e);
            }
        }

        this.updateCoordinatesTable('parametreProject');
    }
}