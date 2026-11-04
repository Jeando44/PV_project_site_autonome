import { UIManager } from '../ParametresProjet.js?v=20'; // ?v= : fusion des onglets (cache navigateur)
import { DataManager } from './parametreProjetFormManager.js?v=41';
import ShareManager2 from './shareManager.js';
import { adresseCourteDepuisNominatim } from './adresseCourte.js';

export class ParametreProjetManager {
    constructor() {
        // Carte et modules liés à la carte
        this.map = null;
        this.marker = null;

        // État de la carte
        this.isInitialized = false;

        // Compatibilité pour que DataManager puisse mettre à jour le marqueur
        this.addressSearch = {
            addOrUpdateParametreMarker: (lat, lng, address) => {
                this.addOrUpdateParametreMarker(lat, lng, address);
            }
        };

        // Modal
        this.modal = null;
        this.openModalBtn = null;
        this.closeModalBtn = null;

        // Gestionnaires de formulaire et UI (NOUVEAU)
        this.uiManager = null;
        this.dataManager = null;
        this.shareManager = null;
        window.shareManager2 = new ShareManager2();

        this.init();
        console.log("ParametreProjetManager initialisé");
    }

    init() {
        this.setupModal();
        this.initializeManagers();
        this._triggerInitialization(); // Charger la carte Leaflet immédiatement en arrière-plan
    }

    /**
     * Initialise les gestionnaires UI et Data de manière séparée
     */
    initializeManagers() {
        // Attendre que jQuery soit disponible si nécessaire
        if (typeof jQuery !== 'undefined') {
            this.uiManager = new UIManager();
            // ✅ FIX: Créer UNE SEULE instance de DataManager et l'assigner aux deux endroits
            this.dataManager = new DataManager();
            window.dataManager = this.dataManager; // Utiliser la même instance
            console.log("✅ UIManager et DataManager initialisés");
        } else {
            console.warn("jQuery non disponible, les gestionnaires seront initialisés plus tard");
            document.addEventListener('DOMContentLoaded', () => {
                this.uiManager = new UIManager();
                // ✅ FIX: Créer UNE SEULE instance de DataManager et l'assigner aux deux endroits
                this.dataManager = new DataManager();
                window.dataManager = this.dataManager; // Utiliser la même instance
                console.log("✅ UIManager et DataManager initialisés (après DOMContentLoaded)");
            });
        }
    }

    setupModal() {
        this.modal = document.getElementById('parametres-modal');
        this.openModalBtn = document.getElementById('open-modal');
        this.closeModalBtn = document.getElementById('close-modal');

        if (!this.modal) {
            console.error("Le modal avec l'ID 'parametres-modal' n'a pas été trouvé.");
            return;
        }

        console.log("Modal trouvé, configuration des événements...");

        // Écouter l'ouverture du modal pour initialiser la carte
        this.modal.addEventListener('shown.bs.modal', () => {
            console.log("Modal ouvert, initialisation de la carte...");
            this._triggerInitialization();
        });

        // Écouter la fermeture du modal
        this.modal.addEventListener('hidden.bs.modal', () => {
            console.log("Modal fermé");
            document.body.style.overflow = "";
        });

        // Configurer le bouton d'ouverture manuelle
        if (this.openModalBtn) {
            this.openModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openModal();
            });
        }

        // Configurer le bouton de fermeture
        if (this.closeModalBtn) {
            this.closeModalBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }

        // Fermer en cliquant en dehors du modal
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        // Fermer avec la touche Échap
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('show')) {
                this.closeModal();
            }
        });

        // Ouvrir automatiquement le modal SEULEMENT si aucun projet n'est sélectionné
        setTimeout(() => {
            // CORRECTIF (bug rapporté : "après création/ouverture d'un projet, en fermant le modal
            // Cons. Énergie on retombe sur le modal Paramètres") : ce garde-fou ne lisait QUE
            // localStorage.current_projet_id, écrit par ParametresProjet.js dans SON PROPRE
            // écouteur DOMContentLoaded à partir du paramètre d'URL 'activated_project'. Si CE
            // script (ParametreProjetManager, ici) s'exécute avant que l'écouteur DOMContentLoaded
            // de ParametresProjet.js n'ait eu la main (ordre de chargement des scripts non garanti),
            // ce setTimeout(1000ms) pouvait se déclencher alors que localStorage n'était pas encore
            // à jour, et rouvrait donc ce modal par erreur — masqué SOUS le modal Cons. Énergie
            // auto-ouvert par le nouveau workflow, jusqu'à sa fermeture. On lit désormais aussi
            // directement le paramètre d'URL ici, en autonomie complète vis-à-vis du timing de
            // l'autre script.
            const activatedProjectId = new URLSearchParams(window.location.search).get('activated_project');
            const currentProjetId = activatedProjectId || localStorage.getItem('current_projet_id');
            if (!currentProjetId) {
                console.log('ℹ️ Aucun projet sélectionné - Ouverture automatique du modal');
                this.openModal();
            } else {
                console.log(`✅ Projet ${currentProjetId} déjà sélectionné - Modal non ouvert`);
            }
        }, 1000);
    }

    // `navStep` : étape du menu horizontal mise en évidence tant que ce modal est ouvert — « Mes
    // projets » (liste, par défaut) ou « Paramètres projet » (formulaire, cf. openParametresProjet).
    openModal(navStep = 'mes-projets') {
        if (!this.modal) return;
        this.modal.style.display = 'flex';
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        this._triggerInitialization();
        this.resizeMap(); // Forcer Leaflet à se redimensionner

        // NOUVEAU WORKFLOW (demande explicite) : met en évidence l'étape dans le menu horizontal
        // tant que ce modal est ouvert (cf. window.setActiveMainNavStep, menu_list.html).
        if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep(navStep);
    }

    /**
     * « Paramètres projet » du menu horizontal (demande explicite) : ouvre ce modal directement sur le
     * formulaire du projet (ex-onglet « Informations projet & Données d'irradiation »), pré-rempli
     * avec le projet actif — sans passer par la liste « Mes projets ». Sans projet actif, formulaire
     * vierge de création (même chemin que le bouton « Créer un projet »).
     */
    async openParametresProjet() {
        if (!this.modal) return;
        const projetId = localStorage.getItem('current_projet_id');
        // Formulaire déjà affiché sur ce projet (clic répété) : ne pas recharger, ce qui effacerait
        // les saisies en cours.
        const projetEdite = document.getElementById('projet_id_edit');
        const formulaire = document.getElementById('parametre_projet');
        const dejaAffiche = this.modal.style.display !== 'none' && this.modal.classList.contains('show')
            && formulaire && formulaire.style.display !== 'none'
            && projetEdite && projetId && String(projetEdite.value) === String(projetId);
        this.openModal('parametres');
        if (dejaAffiche) return;
        if (projetId && window.dataManager && typeof window.dataManager.editProject === 'function') {
            await window.dataManager.editProject(projetId);
        } else {
            const createBtn = document.getElementById('create-project-btn');
            if (createBtn) createBtn.click();
        }
    }

    async closeModal() {
        if (!this.modal) return;

        // Vérifier si un projet est sélectionné
        const currentProjetId = localStorage.getItem('current_projet_id');

        if (!currentProjetId) {
            // Si aucun projet n'est sélectionné, afficher un message
            if (window.dataManager && typeof window.dataManager.showMessage === 'function') {
                window.dataManager.showMessage('Il faut créer un projet pour accéder au reste de l\'application', 'warning');
            } else {
                alert('Il faut créer un projet pour accéder au reste de l\'application');
            }
            return; // Ne pas fermer le modal
        }

        // NOUVEAU WORKFLOW (demande explicite) : après la création d'un nouveau projet, l'utilisateur
        // reste sur ce modal (onglet "Mes projets", cf. submitParametreProjet() dans
        // parametreProjetFormManager.js) pour confirmer visuellement que la création a réussi, plutôt
        // que d'être redirigé immédiatement. Fermer le modal à CE moment précis doit alors avoir le
        // même effet que cliquer sur "Ouvrir mon projet" — on délègue donc entièrement à
        // selectAndLoadProject(), point d'entrée unique "ouverture de projet" (sauvegarde, activation
        // serveur, fermeture du modal, auto-ouverture de "Consommation d'énergie"), plutôt que de
        // dupliquer cette logique ici.
        if (window.dataManager && window.dataManager.pendingProjectOpen) {
            const { id, name } = window.dataManager.pendingProjectOpen;
            window.dataManager.pendingProjectOpen = null;
            await window.dataManager.selectAndLoadProject(id, name);
            return;
        }

        // Sauvegarder les données du projet actuel avant de fermer
        if (window.calepinageService) {
            const storageKey = 'solarProjectData';
            const localData = localStorage.getItem(storageKey);

            if (localData) {
                try {
                    console.log(`💾 Sauvegarde des données du projet ${currentProjetId} avant fermeture...`);
                    const result = await window.calepinageService.saveToDatabase();

                    if (result.success) {
                        console.log(`✅ Données sauvegardées avec succès`);
                    }
                } catch (error) {
                    console.error('❌ Erreur lors de la sauvegarde:', error);
                }
            }
        }

        // Si un projet est sélectionné, fermer normalement
        this.modal.classList.remove('show');
        setTimeout(() => {
            this.modal.style.display = 'none';
        }, 300);
        document.body.style.overflow = '';

        // NOUVEAU WORKFLOW (demande explicite) : ce modal fermé révèle la page/modale précédemment
        // active en dessous — on y revient dans le menu horizontal. CORRECTIF (bug rapporté : la mise
        // en évidence restait bloquée sur "Paramètres" après fermeture) : window.setActiveMainNavStep
        // ('calepinage') fixe ne convenait que si "Paramètres" avait été ouvert DEPUIS Calepinage —
        // restorePreviousMainNavStep() rétablit l'étape réellement quittée (ex. Dimensionnement) dans
        // le cas général où l'utilisateur navigue entre plusieurs étapes sans repasser par Calepinage.
        if (typeof window.restorePreviousMainNavStep === 'function') window.restorePreviousMainNavStep();
        else if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('calepinage');
    }

    _triggerInitialization() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.loadLeafletAndInit();
    }

    loadLeafletAndInit() {
        if (typeof L !== 'undefined') {
            this.initMap();
            return;
        }
        
        if (document.getElementById('leaflet-script-main')) return; // Éviter la double injection
        if (!document.querySelector('link[href*="leaflet.css"]')) {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(css);
        }
        const script = document.createElement('script');
        script.id = 'leaflet-script-main';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => this.initMap();
        document.head.appendChild(script);
    }

    initMap() {
        const mapElement = document.getElementById('map2');
        if (!mapElement || typeof L === 'undefined') return;
        
        if (this.map) return; // Sécurité anti-double initialisation
        if (L.DomUtil.hasClass(mapElement, 'leaflet-container')) return;

        this.map = L.map('map2').setView([46.603354, 1.888334], 5);

        // Réparer les icônes de marqueurs par défaut de Leaflet (problème d'image manquante)
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        });

        const osmPlan = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        });

        const osmSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri'
        });

        osmSatellite.addTo(this.map);
        L.control.layers({ "Plan (OSM)": osmPlan, "Vue aérienne": osmSatellite }).addTo(this.map);

        this.setupAddressSearch();

        const hiddenInput = document.getElementById('parametre_project_hidden');
        if (hiddenInput && hiddenInput.value) {
            try {
                const data = JSON.parse(hiddenInput.value);
                if (data.latitude && data.longitude) {
                    this.addOrUpdateParametreMarker(data.latitude, data.longitude, data.adresse || '', data.adresse_complete);
                }
            } catch (e) { console.warn("Erreur parsing marker") }
        }
        
        const mapToolbar = document.getElementById('mapToolbar');
        if (mapToolbar) mapToolbar.style.display = 'none';
        
        setTimeout(() => this.resizeMap(), 300);
    }

    setupAddressSearch() {
        const searchInput = document.getElementById('parametreProjectSearch');
        const suggestionsDropdown = document.getElementById('parametreProjectSuggestions');
        let debounceTimeout;

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimeout);
                const query = e.target.value;
                // NOUVEAU (demande explicite : "je ne parviens pas à entrer l'adresse que je veux, c'est
                // la suggestion qui passe uniquement") : une fois un lieu choisi (coordonnées présentes),
                // le texte du champ devient l'adresse AFFICHÉE du projet — cartouches, rapport, Mes
                // projets... — sans toucher à la position. Le champ caché suit donc la saisie : la
                // validation du formulaire (texte visible = adresse enregistrée) l'accepte. Pour CHANGER
                // de lieu, il faut toujours choisir une suggestion (ou déplacer le marqueur).
                this.syncAdresseSaisieSurLieuChoisi(query);
                if (query.length < 3) {
                    if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
                    return;
                }
                debounceTimeout = setTimeout(() => {
                    fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=5`)
                        .then(res => res.json())
                        .then(data => {
                            if (!suggestionsDropdown) return;
                            suggestionsDropdown.innerHTML = '';
                            if (data.length > 0) {
                                data.forEach(place => {
                                    const div = document.createElement('div');
                                    div.className = 'address-suggestion';
                                    // Adresse courte en gras (celle qui sera enregistrée), adresse complète
                                    // du géocodeur en petit dessous pour reconnaître le bon lieu.
                                    const courte = adresseCourteDepuisNominatim(place.address);
                                    const ligne1 = document.createElement('div');
                                    ligne1.textContent = courte || place.display_name;
                                    div.appendChild(ligne1);
                                    if (courte && courte !== place.display_name) {
                                        const ligne2 = document.createElement('div');
                                        ligne2.textContent = place.display_name;
                                        ligne2.style.cssText = 'font-size:0.78em; font-weight:normal; color:#6b7280;';
                                        div.appendChild(ligne2);
                                    }
                                    div.addEventListener('click', () => {
                                        // Suggestion affichée : texte long du géocodeur (utile pour trouver le
                                        // site). Adresse enregistrée : forme courte (cf. adresseCourte.js).
                                        this.addOrUpdateParametreMarker(parseFloat(place.lat), parseFloat(place.lon),
                                            adresseCourteDepuisNominatim(place.address) || place.display_name, place.display_name);
                                        suggestionsDropdown.style.display = 'none';
                                    });
                                    suggestionsDropdown.appendChild(div);
                                });
                                suggestionsDropdown.style.display = 'block';
                            } else {
                                suggestionsDropdown.style.display = 'none';
                            }
                        }).catch(err => console.error("Erreur OSM:", err));
                }, 500);
            });
            
            document.addEventListener('click', (e) => {
                if (e.target !== searchInput && suggestionsDropdown) {
                    suggestionsDropdown.style.display = 'none';
                }
            });
        }

        if (this.map) {
            this.map.on('click', (e) => {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`)
                    .then(res => res.json())
                    .then(data => {
                        const address = adresseCourteDepuisNominatim(data.address) || data.display_name || `Position: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                        this.addOrUpdateParametreMarker(lat, lng, address, data.display_name);
                    }).catch(() => {
                        this.addOrUpdateParametreMarker(lat, lng, `Position: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    });
            });
        }
    }

    /**
     * Saisie libre de l'adresse affichée, APRÈS le choix d'un lieu : met à jour le texte `adresse` du
     * champ caché en conservant latitude/longitude (et `adresse_complete`). Sans lieu choisi
     * (coordonnées absentes), ne fait rien : la validation continue d'exiger une suggestion. Ignore
     * les valeurs JSON injectées par le remplissage automatique du formulaire.
     */
    syncAdresseSaisieSurLieuChoisi(texte) {
        const hiddenInput = document.getElementById('parametre_project_hidden');
        if (!hiddenInput || !hiddenInput.value) return;
        const saisie = (texte || '').trim();
        if (!saisie || saisie.startsWith('{')) return;
        let data;
        try { data = JSON.parse(hiddenInput.value); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        const lat = parseFloat(data.latitude), lng = parseFloat(data.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        data.adresse = saisie;
        hiddenInput.value = JSON.stringify(data);
    }

    // `address` : adresse COURTE enregistrée et affichée ; `addressComplete` (optionnel) : texte
    // d'origine du géocodeur, conservé dans `adresse_complete` (cf. adresseCourte.js).
    addOrUpdateParametreMarker(lat, lng, address, addressComplete) {
        if (!this.map) return;
        if (this.marker) {
            this.marker.setLatLng([lat, lng]);
        } else {
            // NOUVEAU: marqueur déplaçable (auparavant il fallait recliquer sur la carte pour
            // repositionner l'adresse). Le déplacement met à jour l'adresse via reverse-géocodage,
            // en réutilisant addOrUpdateParametreMarker() pour rester cohérent avec la recherche/clic.
            this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
            this.marker.on('dragend', () => {
                const pos = this.marker.getLatLng();
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${pos.lat}&lon=${pos.lng}`)
                    .then(res => res.json())
                    .then(data => {
                        const newAddress = adresseCourteDepuisNominatim(data.address) || data.display_name || `Position: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
                        this.addOrUpdateParametreMarker(pos.lat, pos.lng, newAddress, data.display_name);
                    }).catch(() => {
                        this.addOrUpdateParametreMarker(pos.lat, pos.lng, `Position: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`);
                    });
            });
        }
        this.map.setView([lat, lng], 16);

        const hiddenInput = document.getElementById('parametre_project_hidden');
        if (hiddenInput) {
            hiddenInput.value = JSON.stringify(Object.assign(
                { adresse: address, latitude: lat, longitude: lng },
                addressComplete && addressComplete !== address ? { adresse_complete: addressComplete } : {}
            ));
        }

        const searchInput = document.getElementById('parametreProjectSearch');
        if (searchInput && address) {
            searchInput.value = address;
        }

        // Synchronisation en direct des champs Latitude/Longitude PVGIS (onglet "Mode de calcul
        // et Normes"), sans attendre une sauvegarde. Écouté par main_prodsolaire.js.
        document.dispatchEvent(new CustomEvent('projectLocationUpdated', { detail: { lat, lng, address } }));
    }

    /**
     * Retire le marqueur d'adresse de la mini-carte "Paramètre Projet" et vide les champs associés.
     * CORRECTIF (bug "l'adresse de l'ancien projet actif réapparaît en créant un nouveau projet") :
     * ce marqueur et les champs #parametreProjectSearch / #parametre_project_hidden ne sont jamais
     * réinitialisés par un simple form.reset() — le marqueur est un objet Leaflet indépendant du DOM
     * du formulaire, et #parametre_project_hidden a une valeur par défaut pré-remplie côté serveur
     * (l'adresse du DERNIER projet actif au moment du rendu de la page), donc form.reset() le
     * restaurait vers cette même adresse au lieu de le vider. Appelée explicitement lors du clic sur
     * "Créer un nouveau projet" (cf. ParametresProjet.js: switchToSection).
     */
    clearParametreMarker() {
        if (this.marker && this.map) {
            this.map.removeLayer(this.marker);
            this.marker = null;
        }
        if (this.map) {
            this.map.setView([46.603354, 1.888334], 5);
        }

        const hiddenInput = document.getElementById('parametre_project_hidden');
        if (hiddenInput) hiddenInput.value = '';

        const searchInput = document.getElementById('parametreProjectSearch');
        if (searchInput) searchInput.value = '';
    }

    /**
     * Méthodes publiques pour contrôler le modal depuis l'extérieur
     */
    showModal() {
        this.openModal();
    }

    hideModal() {
        this.closeModal();
    }

    resizeMap() {
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 200);
        }
    }

    /**
     * Méthodes d'accès aux gestionnaires (pour déboguer ou interactions externes)
     */
    getUIManager() {
        return this.uiManager;
    }

    getDataManager() {
        return this.dataManager;
    }

    getCoordinateManager() {
        return this.coordinateManager;
    }
}


window.openParametresModal = function () {
    if (window.parametreProjetManager) {
        window.parametreProjetManager.openModal();
    }
};

window.openParametresProjet = function () {
    if (window.parametreProjetManager) {
        return window.parametreProjetManager.openParametresProjet();
    }
    // Page sans ce modal : retour sur le Calepinage, qui ouvre « Paramètres projet » à son chargement.
    sessionStorage.setItem('autoOpenParametresProjet', 'true');
    window.location.href = window.SKV_URL_ACCUEIL;
};

window.closeParametresModal = function () {
    if (window.parametreProjetManager) {
        window.parametreProjetManager.closeModal();
    }
};

// Initialisation différée
function initializeParametreProjetManager() {
    window.parametreProjetManager = new ParametreProjetManager();
    console.log("✅ ParametreProjetManager global initialisé");
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initializeParametreProjetManager, 1);
} else {
    document.addEventListener('DOMContentLoaded', initializeParametreProjetManager);
}