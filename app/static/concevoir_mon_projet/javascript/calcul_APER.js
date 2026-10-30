/**
 * Calculateur de surface Loi APER
 * Intercepte les polygones simples dessinés pour calculer les surfaces assujetties et solarisables.
 */

class CalculateurAPER {
    constructor() {
        this.modal = null;
        this.backdrop = null;
        this.polygonManager = null;
        this.capturedImageData = null;
        this.capturedImageWidth = 0;
        this.capturedImageHeight = 0;
        this.selectionRectangle = null;
        this.lastCalc = {
            baseArea: 0,
            subArea: 0,
            surfaceAssujettie: 0,
            surfaceSolarisableAPER: 0,
            surfaceSolarisableHuwart: 0,
            surfaceProjeteeTotale: 0,
            surfaceProjeteeConnue: true,
            isConforme: false
        };

        // Saisies du projet lues EN BASE (cf. polygone_aper_persistence.js) : projet auquel elles
        // appartiennent (null tant qu'elles ne sont pas lues : aucun enregistrement possible, pour ne
        // jamais écrire les polygones d'un projet dans un autre ni écraser la base avec un état vide).
        this.projetCharge = null;
        this.variables = CalculateurAPER.variablesParDefaut();
        // « Surface projetée champ PV » : calculée par le serveur depuis le calepinage enregistré.
        this.surfaceProjetee = { valeurM2: null, connue: true };
        // Polygones lus en base, posés sur la carte dès qu'elle est prête.
        this.polygonesEnAttente = null;
        this._chargement = null;
        this._modificationEnAttente = false;
        this._minuterieEnregistrement = null;
        this._enregistrementEnCours = null;
        this.init();
    }

    static variablesParDefaut() {
        return {
            solarisableAper: { valeur: 50, libelle: '% Solarisable APER' },
            solarisableHuwart: { valeur: 35, libelle: '% Solarisable Huwart' },
        };
    }

    init() {
        // Initialisation directe de la modale
        this.createModal();
        this.makeDraggable();
        this.bindMenuButton();
        this.setupKeyboardShortcuts();
        this.demarrerPersistance();
    }

    // Projet ouvert : paramètre d'URL 'activated_project' (posé par l'ouverture d'un projet, avant
    // que ParametresProjet.js ne le recopie en localStorage puis le retire de l'URL), sinon
    // current_projet_id.
    _projetIdActif() {
        try {
            const active = new URLSearchParams(window.location.search).get('activated_project');
            if (active) return String(active);
            return localStorage.getItem('current_projet_id') || null;
        } catch (e) { return null; }
    }

    // Ouverture de la page : anciennes clés locales purgées, saisies du projet lues en base. Changement
    // de projet sans rechargement (selectAndLoadProject) : relues pour le nouveau projet.
    demarrerPersistance() {
        if (!window.AperPersistence) return;
        window.AperPersistence.viderCacheLocal();
        this.chargerDepuisServeur();
        window.addEventListener('projetActifCharge', () => { this.chargerDepuisServeur(); });
    }

    /** Lit en base les saisies APER du projet actif et les affiche (remplace celles affichées). */
    chargerDepuisServeur() {
        const projetId = this._projetIdActif();
        if (!projetId || !window.AperPersistence) {
            this.viderProjet();
            return Promise.resolve(null);
        }
        const promesse = (async () => {
            const res = await window.AperPersistence.charger(projetId);
            if (this._projetIdActif() !== projetId) return null; // projet changé pendant la lecture
            this.viderProjet();
            if (!res || res.success === false) {
                console.warn('[Loi APER] Saisies du projet non lues :', res && res.message);
                return null;
            }
            this._appliquerDonneesServeur(res);
            this.projetCharge = projetId;
            if (this._modaleVisible()) this._rendre();
            return res;
        })();
        this._chargement = promesse;
        promesse.finally(() => { if (this._chargement === promesse) this._chargement = null; });
        return promesse;
    }

    _appliquerDonneesServeur(res) {
        const defauts = CalculateurAPER.variablesParDefaut();
        const config = res.config || {};
        ['solarisableAper', 'solarisableHuwart'].forEach((cle) => {
            const v = config[cle] || {};
            this.variables[cle] = {
                valeur: (typeof v.valeur === 'number' && Number.isFinite(v.valeur)) ? v.valeur : defauts[cle].valeur,
                libelle: v.libelle || defauts[cle].libelle,
            };
        });
        this._appliquerSurfaceProjetee(res.surfaceProjetee);
        const polygones = res.polygones || {};
        if ((polygones.surface || []).length || (polygones.exclusion || []).length) {
            this.polygonesEnAttente = polygones;
            this._afficherPolygonesDesQuePossible();
        }
    }

    _appliquerSurfaceProjetee(surface) {
        this.surfaceProjetee = {
            valeurM2: (surface && typeof surface.valeurM2 === 'number') ? surface.valeurM2 : null,
            connue: !surface || surface.connue !== false,
        };
    }

    // La carte principale n'est pas forcément prête quand la lecture se termine : nouvel essai toutes
    // les 500 ms (30 s au plus), abandonné si d'autres données ont remplacé celles-ci entre-temps.
    _afficherPolygonesDesQuePossible(essai = 0) {
        const attendus = this.polygonesEnAttente;
        if (!attendus) return;
        if (this.ensurePolygonManager()) return; // ensurePolygonManager pose les polygones en attente
        if (essai >= 60) return;
        setTimeout(() => {
            if (this.polygonesEnAttente === attendus) this._afficherPolygonesDesQuePossible(essai + 1);
        }, 500);
    }

    _poserPolygonesEnAttente() {
        const mgr = this.polygonManager;
        if (!mgr || !this.polygonesEnAttente || !window.AperPersistence) return;
        // Pas d'enregistrement pendant la restauration elle-même (chaque polygone posé notifie).
        const onChange = mgr.onChange;
        mgr.onChange = null;
        try {
            window.AperPersistence.poserPolygones(mgr, this.polygonesEnAttente);
        } finally {
            mgr.onChange = onChange;
            this.polygonesEnAttente = null;
        }
    }

    /** Retire de la carte et de la mémoire les saisies APER du projet affiché (changement de projet). */
    viderProjet() {
        clearTimeout(this._minuterieEnregistrement);
        this._modificationEnAttente = false;
        this.projetCharge = null;
        this.polygonesEnAttente = null;
        this.variables = CalculateurAPER.variablesParDefaut();
        this.surfaceProjetee = { valeurM2: null, connue: true };
        const mgr = this.polygonManager;
        if (mgr) {
            mgr.clearSelection();
            [...mgr.surfacePolygons, ...mgr.exclusionPolygons, ...mgr.helperPolygons].forEach((p) => p.setMap(null));
            mgr.surfacePolygons = [];
            mgr.exclusionPolygons = [];
            mgr.helperPolygons = [];
            mgr.isCopying = false;
            mgr.copyBuffer = null;
            if (typeof mgr.onOverlapChange === 'function') mgr.onOverlapChange(false);
        }
        // Résultats et champs « % Solarisable » de l'ancien projet retirés : reconstruits avec les
        // valeurs du nouveau projet au prochain affichage.
        if (this.modalBody) this.modalBody.innerHTML = '';
        this.clearCapture();
        this._majCouleurBoutonsMenu(false);
        if (window.AperPersistence) window.AperPersistence.viderCacheLocal();
    }

    _planifierEnregistrement() {
        if (!this.projetCharge) return;
        this._modificationEnAttente = true;
        clearTimeout(this._minuterieEnregistrement);
        this._minuterieEnregistrement = setTimeout(() => { this.enregistrer(); }, 800);
    }

    /** Enregistre en base les saisies APER (enchaîné, jamais deux envois en parallèle). */
    enregistrer() {
        clearTimeout(this._minuterieEnregistrement);
        if (!this._modificationEnAttente) {
            return this._enregistrementEnCours || Promise.resolve({ success: true, skipped: true });
        }
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) {
            return Promise.resolve({ success: false, bloque: true, message: 'Projet changé dans un autre onglet : rechargez la page' });
        }
        const projetId = this.projetCharge;
        if (!projetId || projetId !== this._projetIdActif() || !window.AperPersistence) {
            this._modificationEnAttente = false;
            return Promise.resolve({ success: false, message: "Saisies APER d'un autre projet : non enregistrées" });
        }
        const payload = {
            // Polygones lus en base mais pas encore posés (carte pas prête) : renvoyés tels quels,
            // sinon une saisie de % les effacerait en base.
            polygones: this.polygonesEnAttente
                || window.AperPersistence.extrairePolygones(this.polygonManager),
            variables: JSON.parse(JSON.stringify(this.variables)),
        };
        this._modificationEnAttente = false;
        const precedent = this._enregistrementEnCours;
        const promesse = (precedent ? precedent.catch(() => null) : Promise.resolve())
            .then(() => window.AperPersistence.enregistrer(projetId, payload))
            .then((res) => {
                if (!res || res.success === false) {
                    console.warn('[Loi APER] Enregistrement refusé :', res && res.message);
                    if (res && res.status === 400) this._afficherErreur(res.message);
                    // Saisies toujours à enregistrer (renvoyées au prochain enregistrement complet),
                    // sauf si le projet affiché a changé entre-temps.
                    if (this.projetCharge === projetId) this._modificationEnAttente = true;
                }
                return res;
            });
        this._enregistrementEnCours = promesse;
        promesse.finally(() => { if (this._enregistrementEnCours === promesse) this._enregistrementEnCours = null; });
        return promesse;
    }

    /** Saisies en attente envoyées tout de suite (changement de projet, capture d'une variante). */
    flush() {
        return this.enregistrer();
    }

    /** Saisie pas encore enregistrée (différée ou en cours d'envoi) — cf. services/sauvegarde_projet.js. */
    modificationsEnAttente() {
        return !!this.projetCharge && (!!this._modificationEnAttente || !!this._enregistrementEnCours);
    }

    _afficherErreur(message) {
        const errorModal = window.drawingControl && window.drawingControl.errorModal;
        if (errorModal && typeof errorModal.show === 'function') errorModal.show(message);
        else console.error(message);
    }

    // Créé au premier besoin réel (la carte principale n'est pas forcément prête au chargement du script)
    ensurePolygonManager() {
        if (this.polygonManager) {
            this._poserPolygonesEnAttente(); // projet rouvert sans rechargement de page
            return this.polygonManager;
        }
        if (!window.drawingControl || !window.drawingControl.map || typeof google === 'undefined' || !google.maps || !google.maps.drawing) {
            return null;
        }
        this.polygonManager = new AperPolygonManager(window.drawingControl.map, window.drawingControl.errorModal);
        this.polygonManager.onOverlapChange = (hasOverlap) => {
            if (this.btnMerge) this.btnMerge.style.display = hasOverlap ? 'block' : 'none';
        };

        // Toute modification des polygones est enregistrée en base (différé de 800 ms) ; ceux déjà lus
        // en base sont posés sans déclencher d'enregistrement (cf. _poserPolygonesEnAttente).
        this.polygonManager.onChange = () => this._planifierEnregistrement();
        this._poserPolygonesEnAttente();

        return this.polygonManager;
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (!this.modal || this.modal.style.display === 'none') return;
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            if (!this.polygonManager) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                this.polygonManager.deleteSelected();
            } else if (e.key === 'Escape') {
                this.polygonManager.clearSelection();
                this.polygonManager.isCopying = false;
                this.polygonManager.copyBuffer = null;
                // CORRECTIF (migration Terra Draw) : le tracé "+ Surface"/"- Exclusion" passe désormais
                // par le moteur Terra Draw partagé (cf. polygone_aper.js), qui n'expose plus de
                // drawingManager natif à arrêter directement.
                if (window.drawingControl && window.drawingControl.terraDrawEngine) {
                    window.drawingControl.terraDrawEngine.stop();
                }
                if (window.drawingControl && window.drawingControl.map) window.drawingControl.map.getDiv().style.cursor = '';
            }
        });
    }

    bindMenuButton() {
        // Surcharge de la fonction globale appelée par le HTML
        window.openLoiAperModal = (e) => {
            console.log("➡️ Fonction openLoiAperModal appelée via HTML !");
            if (e && e.preventDefault) e.preventDefault();
            this.calculateAndShow();
        };
        window.openCalculateurAPER = (e) => {
            console.log("➡️ Fonction openCalculateurAPER appelée via HTML !");
            if (e && e.preventDefault) e.preventDefault();
            this.calculateAndShow();
        };

        // Mode "capture" (true) pour intercepter le clic AVANT tous les autres scripts (comme parametreProjetFormManager)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('a, button, .menu-item, li');
            if (btn && ((btn.innerHTML && btn.innerHTML.includes('bi-calculator')) ||
                (btn.innerText && (btn.innerText.includes('Calculateur APER') || btn.innerText.includes('Loi APER'))) ||
                (btn.getAttribute('onclick') && (btn.getAttribute('onclick').includes('openLoiAperModal') || btn.getAttribute('onclick').includes('openCalculateurAPER'))))) {
                console.log("➡️ Clic intercepté par l'Event Listener global !");
                e.preventDefault();
                e.stopImmediatePropagation(); // Bloque fermement les autres scripts pour éviter les conflits
                this.calculateAndShow();
            }
        }, true);
    }

    createModal() {
        // Création du fond assombri (Backdrop)
        this.backdrop = document.createElement('div');
        // Le backdrop devient invisible et ne bloque plus les clics pour permettre de manipuler la carte
        this.backdrop.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; pointer-events: none; z-index: 999998;';

        // Création de la modale
        this.modal = document.createElement('div');
        // max-height + flex-direction:column (posé ici, avant même le premier affichage) garantit que
        // seul modalBody défile en interne quand le contenu est long : header/toolbar/footer restent
        // toujours visibles (notamment les boutons Calculer/Exporter PDF du footer).
        this.modal.style.cssText = 'display: none; flex-direction: column; position: fixed; top: 80px; left: 20px; width: 450px; max-width: 90vw; max-height: 85vh; background-color: #ffffff; border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2); z-index: 1000000; overflow: hidden; border: 2px solid #dc2626; font-family: sans-serif;';

        // En-tête de la modale
        const header = document.createElement('div');
        header.className = 'modal-header-aper';
        header.style.cssText = 'background-color: #dc2626; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #991b1b; cursor: move; flex-shrink: 0;';

        header.innerHTML = `
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                <i class="bi bi-calculator"></i> Résultats Loi APER
            </h2>
            <div style="display: flex; align-items: center; gap: 6px;">
                <button id="aper-minimize-btn" title="Réduire la fenêtre pour accéder au reste de la page" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; line-height: 1; padding: 4px;"><i class="bi bi-dash-square"></i></button>
                <button id="close-aper-btn" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; line-height: 1; padding: 0;">&times;</button>
            </div>
        `;

        // Section "Fusionner" (persistante, contrairement à modalBody qui est reconstruit à chaque calcul).
        // Les outils de tracé (+ Surface / - Exclusion / Copier / Supprimer / Masquer...) ont été déplacés
        // dans la palette principale (icône crayon, cf. ButtonControl.js::togglePolygoneAperMenu).
        this.toolbarSection = document.createElement('div');
        this.toolbarSection.style.cssText = 'padding: 15px 20px 5px 20px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0;';
        this.toolbarSection.innerHTML = `
            <button id="aper-merge" class="aper-tool-btn" style="display:none; width:100%; background:#fff176;color:#000;border:2px dashed #fbc02d;">Fusionner les polygones qui se chevauchent</button>
        `;

        // Corps de la modale
        this.modalBody = document.createElement('div');
        this.modalBody.style.cssText = 'padding: 20px; font-size: 15px; color: #333; flex-grow: 1; min-height: 0; overflow-y: auto;';

        // Section "Capture" : placée APRÈS modalBody (donc sous le badge de conformité affiché en
        // fin de résultats), conformément à la demande — persistante elle aussi.
        this.captureSection = document.createElement('div');
        this.captureSection.style.cssText = 'padding: 15px 20px; border-top: 1px solid #e5e7eb; flex-shrink: 0;';
        this.captureSection.innerHTML = `
            <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280; text-transform: uppercase;">Capture</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                <button id="aper-manual-capture" class="aper-tool-btn" style="background:#2563eb;color:#fff;">Capture manuelle</button>
                <button id="aper-auto-capture" class="aper-tool-btn" style="background:#2563eb;color:#fff;">Capture auto</button>
            </div>
            <img id="aper-preview-capture" alt="Aperçu de la capture" style="width:100%; border-radius: 6px; margin-bottom: 8px; display: none; border: 1px solid #ccc;">
            <button id="aper-delete-capture" class="aper-tool-btn" style="display:none; width:100%; background:#f5f5f5;color:#991b1b;border:1px solid #f5c2c2;">Supprimer la capture</button>
        `;

        // Zone d'actions (Footer)
        this.modalFooter = document.createElement('div');
        this.modalFooter.style.cssText = 'padding: 15px 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; flex-shrink: 0;';

        // Checkbox d'intégration
        const checkContainer = document.createElement('div');
        checkContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 13px; color: #4b5563;';
        this.integrationCheckbox = document.createElement('input');
        this.integrationCheckbox.type = 'checkbox';
        this.integrationCheckbox.id = 'aper-integration-check';
        this.integrationCheckbox.checked = true; // Cochée par défaut
        const checkLabel = document.createElement('label');
        checkLabel.htmlFor = 'aper-integration-check';
        checkLabel.textContent = 'Intégration du PDF dans le rapport';
        checkLabel.style.cursor = 'pointer';
        checkContainer.appendChild(this.integrationCheckbox);
        checkContainer.appendChild(checkLabel);

        // Boutons
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; gap: 10px;';

        this.btnCalculate = document.createElement('button');
        this.btnCalculate.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Calculer';
        this.btnCalculate.style.cssText = 'background-color: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 6px; transition: background-color 0.2s;';
        this.btnCalculate.onmouseover = () => this.btnCalculate.style.backgroundColor = '#1d4ed8';
        this.btnCalculate.onmouseout = () => this.btnCalculate.style.backgroundColor = '#2563eb';
        this.btnCalculate.onclick = () => this.calculateAndShow();

        this.btnExport = document.createElement('button');
        this.btnExport.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Exporter PDF';
        this.btnExport.style.cssText = 'background-color: #16a34a; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 6px; transition: background-color 0.2s;';
        this.btnExport.onmouseover = () => this.btnExport.style.backgroundColor = '#15803d';
        this.btnExport.onmouseout = () => this.btnExport.style.backgroundColor = '#16a34a';
        this.btnExport.onclick = () => this.exportPDF();

        btnContainer.appendChild(this.btnCalculate);
        btnContainer.appendChild(this.btnExport);
        this.modalFooter.appendChild(checkContainer);
        this.modalFooter.appendChild(btnContainer);

        this.modal.appendChild(header);
        this.modal.appendChild(this.toolbarSection);
        this.modal.appendChild(this.modalBody);
        this.modal.appendChild(this.captureSection);
        this.modal.appendChild(this.modalFooter);

        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.modal);

        // Événements de fermeture
        const closeBtn = header.querySelector('#close-aper-btn');
        closeBtn.addEventListener('click', () => this.closeModal());
        this.backdrop.addEventListener('click', () => this.closeModal());

        // Bouton de navigation verticale : réduit la modale à son seul en-tête pour libérer l'accès
        // au reste de la page (carte, palette d'outils) sans avoir à fermer/perdre le calcul en cours.
        const minimizeBtn = header.querySelector('#aper-minimize-btn');
        minimizeBtn.addEventListener('click', () => {
            const isCollapsed = this.modal.classList.toggle('aper-collapsed');
            this.toolbarSection.style.display = isCollapsed ? 'none' : '';
            this.modalBody.style.display = isCollapsed ? 'none' : '';
            this.captureSection.style.display = isCollapsed ? 'none' : '';
            this.modalFooter.style.display = isCollapsed ? 'none' : '';
            const icon = minimizeBtn.querySelector('i');
            if (icon) icon.className = isCollapsed ? 'bi bi-plus-square' : 'bi bi-dash-square';
            minimizeBtn.title = isCollapsed ? 'Agrandir la fenêtre' : 'Réduire la fenêtre pour accéder au reste de la page';
        });

        this.bindToolbarButtons();
    }

    bindToolbarButtons() {
        const style = document.createElement('style');
        style.textContent = `
            .aper-tool-btn { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: filter 0.2s; }
            .aper-tool-btn:hover { filter: brightness(0.92); }
        `;
        document.head.appendChild(style);

        const withManager = (fn) => () => {
            const mgr = this.ensurePolygonManager();
            if (!mgr) {
                if (window.drawingControl && window.drawingControl.errorModal) {
                    window.drawingControl.errorModal.show("La carte n'est pas encore prête. Veuillez réessayer.");
                } else {
                    alert("La carte n'est pas encore prête. Veuillez réessayer.");
                }
                return;
            }
            fn(mgr);
        };

        this.btnMerge = this.toolbarSection.querySelector('#aper-merge');
        this.btnMerge.onclick = withManager((mgr) => {
            mgr.mergePolygons('surface');
            mgr.mergePolygons('exclusion');
        });

        this.btnDeleteCapture = this.captureSection.querySelector('#aper-delete-capture');
        this.captureSection.querySelector('#aper-manual-capture').onclick = withManager(() => this.startManualCapture());
        this.captureSection.querySelector('#aper-auto-capture').onclick = withManager(() => this.executeCapture(false));
        this.btnDeleteCapture.onclick = () => this.clearCapture();
    }

    startManualCapture() {
        // Si une zone de sélection était déjà en cours (clic répété sur "Capture manuelle" sans avoir
        // validé), on la retire avant d'en recréer une : une seule zone de sélection à la fois.
        if (this.selectionRectangle) {
            this.selectionRectangle.setMap(null);
            this.selectionRectangle = null;
        }

        const map = window.drawingControl.map;
        this.selectionRectangle = new google.maps.Rectangle({
            map, editable: true, draggable: true, bounds: map.getBounds(),
            fillColor: '#2196F3', fillOpacity: 0.2
        });
        const validateBtn = document.createElement('button');
        validateBtn.innerText = 'Valider la zone de capture';
        validateBtn.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:1000001; padding:10px 16px; background:#16a34a; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;';
        validateBtn.onclick = () => { this.executeCapture(true); validateBtn.remove(); };
        document.body.appendChild(validateBtn);
    }

    clearCapture() {
        this.capturedImageData = null;
        this.capturedImageWidth = 0;
        this.capturedImageHeight = 0;
        const preview = document.getElementById('aper-preview-capture');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }
        if (this.btnDeleteCapture) this.btnDeleteCapture.style.display = 'none';
    }

    // Convertit les bornes lat/lng du rectangle de sélection manuelle en pixels relatifs au conteneur
    // de la carte, pour pouvoir ensuite recadrer précisément la capture sur cette zone exacte.
    _getPixelBoundsForLatLngBounds(bounds) {
        return new Promise((resolve) => {
            const overlay = new google.maps.OverlayView();
            overlay.onAdd = () => {};
            overlay.onRemove = () => {};
            overlay.draw = function () {
                const projection = this.getProjection();
                if (!projection) { resolve(null); overlay.setMap(null); return; }
                const ne = projection.fromLatLngToContainerPixel(bounds.getNorthEast());
                const sw = projection.fromLatLngToContainerPixel(bounds.getSouthWest());
                resolve({
                    left: Math.min(ne.x, sw.x),
                    right: Math.max(ne.x, sw.x),
                    top: Math.min(ne.y, sw.y),
                    bottom: Math.max(ne.y, sw.y)
                });
                overlay.setMap(null);
            };
            overlay.setMap(window.drawingControl.map);
        });
    }

    // Recadre un canvas complet (rendu html2canvas de toute la carte) sur la zone en pixels fournie.
    // Le facteur d'échelle gère le cas où html2canvas rend à une résolution supérieure (devicePixelRatio).
    _cropCanvas(fullCanvas, pxBounds, mapElement) {
        const scaleX = fullCanvas.width / mapElement.clientWidth;
        const scaleY = fullCanvas.height / mapElement.clientHeight;
        const sx = Math.max(0, pxBounds.left * scaleX);
        const sy = Math.max(0, pxBounds.top * scaleY);
        const sw = Math.max(1, Math.min(fullCanvas.width - sx, (pxBounds.right - pxBounds.left) * scaleX));
        const sh = Math.max(1, Math.min(fullCanvas.height - sy, (pxBounds.bottom - pxBounds.top) * scaleY));

        const cropped = document.createElement('canvas');
        cropped.width = sw;
        cropped.height = sh;
        cropped.getContext('2d').drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return cropped;
    }

    // Exclut de la capture : (1) les contrôles natifs Google Maps (zoom/plan/pegman/copyright), et
    // (2) les palettes/menus de l'application, injectés par l'API Maps comme "custom controls" et
    // donc physiquement présents dans le DOM de la carte (ButtonControl::createControlContainer /
    // ToolBar.js) alors qu'ils ne font pas partie du contenu réellement dessiné sur la carte.
    _isMapUiChrome(node) {
        if (!node || !node.classList) return false;
        return node.classList.contains('gm-control-active') ||
            node.classList.contains('gmnoprint') ||
            node.classList.contains('gm-style-cc') ||
            node.classList.contains('gm-fullscreen-control') ||
            node.classList.contains('gm-svpc') ||
            node.classList.contains('gm-style-mtc') ||
            node.classList.contains('drawing-control') ||
            node.classList.contains('custom-map-control');
    }

    // Récupère un texte d'adresse propre : certains enregistrements stockent l'adresse sous forme de
    // JSON (ex: {"adresse": "...", "lat":..., "lng":...}) — sans ce parsing, l'accolade et les autres
    // champs bruts se retrouvaient affichés tels quels dans le champ "Adresse du projet".
    _parseAdresse(raw) {
        if (!raw || raw === 'N/A') return raw || '';
        if (typeof raw !== 'string') return raw;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.adresse === 'string') return parsed.adresse;
        } catch (e) { /* pas du JSON : valeur déjà en texte simple */ }
        return raw;
    }

    async executeCapture(isManual) {
        let cropBoundsPx = null;
        if (isManual && this.selectionRectangle) {
            cropBoundsPx = await this._getPixelBoundsForLatLngBounds(this.selectionRectangle.getBounds());
        }
        if (this.selectionRectangle) { this.selectionRectangle.setMap(null); this.selectionRectangle = null; }

        setTimeout(async () => {
            const mapElement = document.getElementById('map');
            if (!mapElement || typeof html2canvas === 'undefined') return;
            const fullCanvas = await html2canvas(mapElement, {
                useCORS: true,
                allowTaint: true,
                ignoreElements: (node) => this._isMapUiChrome(node)
            });

            const finalCanvas = cropBoundsPx ? this._cropCanvas(fullCanvas, cropBoundsPx, mapElement) : fullCanvas;

            this.capturedImageData = finalCanvas.toDataURL('image/jpeg', 0.9);
            this.capturedImageWidth = finalCanvas.width;
            this.capturedImageHeight = finalCanvas.height;
            const preview = document.getElementById('aper-preview-capture');
            if (preview) { preview.src = this.capturedImageData; preview.style.display = 'block'; }
            if (this.btnDeleteCapture) this.btnDeleteCapture.style.display = 'block';
        }, isManual ? 300 : 0);
    }

    makeDraggable() {
        if (!this.modal) return;
        const header = this.modal.querySelector('.modal-header-aper');
        if (!header) return;

        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = this.modal.offsetLeft;
            initialY = this.modal.offsetTop;
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault(); // Prévient la sélection de texte
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            this.modal.style.left = `${initialX + dx}px`;
            this.modal.style.top = `${initialY + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'move';
            }
        });
    }

    /**
     * Calcul APER sans toucher à l'affichage (extrait de calculateAndShow, inchangé) : remplit
     * this.lastCalc et renvoie true si au moins un polygone APER est tracé. Les pourcentages sont lus
     * dans la fenêtre si elle a déjà été affichée, sinon 50 % / 35 % par défaut.
     */
    _calculer() {
        // Réinitialiser les calculs
        this.lastCalc.baseArea = 0;
        this.lastCalc.subArea = 0;
        this.lastCalc.individualSubs = [];

        // Récupération des surfaces via les polygones APER dédiés (somme par type, indépendant de l'ordre de dessin)
        const mgr = this.ensurePolygonManager();
        let hasShapes = false;

        if (mgr) {
            this.lastCalc.baseArea = mgr.getTotalSurfaceArea();
            this.lastCalc.subArea = mgr.getTotalExclusionArea();
            hasShapes = (mgr.surfacePolygons.length + mgr.exclusionPolygons.length) > 0;
            this.lastCalc.individualSubs = mgr.exclusionPolygons.map((poly, idx) => ({
                id: idx + 1,
                val: google.maps.geometry.spherical.computeArea(poly.getPath())
            }));
        }

        // Pourcentages solarisables : champs de la fenêtre s'ils sont affichés, sinon valeurs enregistrées
        // en base (50 % / 35 % par défaut). Bornés 0-100 comme côté serveur ; une valeur modifiée est
        // enregistrée en base avec son libellé.
        const lirePourcent = (id, defaut) => {
            const el = document.getElementById(id);
            if (!el || el.value === '' || isNaN(parseFloat(el.value))) return defaut;
            const v = Math.min(100, Math.max(0, parseFloat(el.value)));
            if (String(v) !== el.value) el.value = v;
            return v;
        };
        const percentAPER = lirePourcent('aper-percent-1', this.variables.solarisableAper.valeur);
        const percentHuwart = lirePourcent('aper-percent-2', this.variables.solarisableHuwart.valeur);
        if (percentAPER !== this.variables.solarisableAper.valeur || percentHuwart !== this.variables.solarisableHuwart.valeur) {
            this.variables.solarisableAper.valeur = percentAPER;
            this.variables.solarisableHuwart.valeur = percentHuwart;
            this._planifierEnregistrement();
        }
        this.lastCalc.percentAPER = percentAPER;
        this.lastCalc.percentHuwart = percentHuwart;

        // Formule : Surface Assujettie = Surfaces (+) - Surfaces (-)
        this.lastCalc.surfaceAssujettie = Math.max(0, this.lastCalc.baseArea - this.lastCalc.subArea);
        this.lastCalc.surfaceSolarisableAPER = this.lastCalc.surfaceAssujettie * (percentAPER / 100);
        this.lastCalc.surfaceSolarisableHuwart = this.lastCalc.surfaceAssujettie * (percentHuwart / 100);

        // Surface projetée champ PV : fournie par le serveur, calculée depuis le calepinage ENREGISTRÉ
        // (ancien calepinage PRO + calepinage résidentiel, cf. app/services/loi_aper.py) — plus lue
        // dans le localStorage (solarProjectData / caches du calepinage), souvent périmé ou issu d'un
        // autre projet. Relue à chaque ouverture et à chaque « Calculer » (_actualiserDepuisServeur).
        this.lastCalc.surfaceProjeteeTotale = Number(this.surfaceProjetee.valeurM2) || 0;
        this.lastCalc.surfaceProjeteeConnue = this.surfaceProjetee.connue;

        this.lastCalc.isConforme = this.lastCalc.surfaceSolarisableHuwart > 0 && (this.lastCalc.surfaceProjeteeTotale / this.lastCalc.surfaceSolarisableHuwart) >= 1;
        return hasShapes;
    }

    /**
     * Résultats pour un rapport (dossier de plans des ombrières) : même calcul que la fenêtre, sans
     * l'ouvrir, plus les contours lat/lng des surfaces et exclusions pour les redessiner sur un plan.
     * @returns {Object|null} null si la carte (Google Maps geometry) n'est pas prête.
     */
    resultatsPourRapport() {
        if (typeof google === 'undefined' || !google.maps || !google.maps.geometry) return null;
        const aDesSurfaces = this._calculer();
        const mgr = this.polygonManager;
        const contours = (liste) => (liste || []).map((poly) => poly.getPath().getArray().map((pt) => ({ lat: pt.lat(), lng: pt.lng() })));
        return {
            ...this.lastCalc,
            aDesSurfaces,
            surfaces: mgr ? contours(mgr.surfacePolygons) : [],
            exclusions: mgr ? contours(mgr.exclusionPolygons) : [],
        };
    }

    _modaleVisible() {
        return !!(this.modal && this.modal.style.display !== 'none');
    }

    /**
     * Données serveur à jour avant un affichage : saisies du projet si elles ne sont pas encore lues
     * (projet changé), sinon seulement la surface projetée. Le même clic « Calculer » enregistre le
     * calepinage résidentiel (écouteur de calepinage_maison_persistence_db.js, qui s'exécute après
     * ce gestionnaire) : on laisse partir cette sauvegarde et on l'attend, pour relire une surface
     * qui tient compte des dernières modifications du calepinage.
     */
    async _actualiserDepuisServeur() {
        const projetId = this._projetIdActif();
        if (!projetId || !window.AperPersistence) return;
        if (this._chargement) await this._chargement;
        if (this.projetCharge !== projetId) {
            await this.chargerDepuisServeur();
            return;
        }
        await new Promise((r) => setTimeout(r, 0));
        const persistance = window.CalepinageMaisonPersistenceDB;
        const sauvegarde = persistance && typeof persistance.sauvegardeEnCours === 'function' && persistance.sauvegardeEnCours();
        if (sauvegarde) { try { await sauvegarde; } catch (e) { /* surface du dernier enregistrement */ } }
        const res = await window.AperPersistence.charger(projetId);
        if (res && res.success !== false && this.projetCharge === projetId && this._projetIdActif() === projetId) {
            this._appliquerSurfaceProjetee(res.surfaceProjetee);
        }
    }

    async calculateAndShow() {
        console.log("Calculateur APER: Début de l'exécution");

        // 1. Forcer l'affichage AVANT le calcul pour tester la visibilité et prévenir tout blocage
        if (this.modal && this.backdrop) {
            this.modal.style.cssText += ' display: flex !important; flex-direction: column !important; visibility: visible !important; opacity: 1 !important;';
            this.backdrop.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
        } else {
            console.error("Erreur: Les éléments de la modale n'existent pas dans le DOM");
            return;
        }

        // Nettoyage du cache : forcer le recalcul en supprimant d'éventuelles anciennes valeurs persistées pour APER
        try {
            const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
            if (savedData.aperSurfaces) {
                delete savedData.aperSurfaces;
                localStorage.setItem('solarProjectData', JSON.stringify(savedData));
            }
        } catch (e) { console.warn("Erreur de purge du cache APER"); }

        if (!this.modalBody.innerHTML.trim()) {
            this.modalBody.innerHTML = `<div style="text-align: center; color: #6b7280; padding: 15px;">Chargement des données du projet…</div>`;
        }
        try {
            await this._actualiserDepuisServeur();
        } catch (e) {
            console.warn('[Loi APER] Lecture des données du projet impossible :', e);
        }
        this._rendre();
    }

    /** Recalcul et affichage sans relecture serveur (saisie d'un « % Solarisable »). */
    recalculer() {
        this._rendre();
    }

    _majCouleurBoutonsMenu(conforme) {
        try {
            document.querySelectorAll('button, a, .menu-item, li').forEach(btn => {
                if ((btn.innerHTML && btn.innerHTML.includes('bi-calculator')) || (btn.innerText && (btn.innerText.includes('Calculateur APER') || btn.innerText.includes('Loi APER'))) || (btn.getAttribute('onclick') && (btn.getAttribute('onclick').includes('openLoiAperModal') || btn.getAttribute('onclick').includes('openCalculateurAPER')))) {
                    btn.style.backgroundColor = conforme ? '#16a34a' : '';
                    btn.style.color = conforme ? '#ffffff' : '';
                    btn.style.borderColor = conforme ? '#15803d' : '';
                }
            });
        } catch (e) { console.warn("Erreur mise à jour couleur bouton APER", e); }
    }

    // Surface projetée = calepinage ENREGISTRÉ : signale qu'elle est inconnue (calepinage enregistré
    // avant son ajout) ou en retard sur des modifications du calepinage pas encore enregistrées.
    _avertissementSurfaceProjetee() {
        let texte = '';
        if (this.lastCalc.surfaceProjeteeConnue === false) {
            texte = "Surface projetée du calepinage pas encore enregistrée : cliquez sur « Calculer » pour l'enregistrer.";
        } else {
            const persistance = window.CalepinageMaisonPersistenceDB;
            try {
                if (persistance && typeof persistance.modificationsNonEnregistreesConnues === 'function'
                    && persistance.modificationsNonEnregistreesConnues()) {
                    texte = 'Calepinage modifié depuis son dernier enregistrement : cliquez sur « Calculer » pour mettre à jour la surface projetée.';
                }
            } catch (e) { /* module de calepinage absent de cette page */ }
        }
        return texte ? `<div style="font-size: 12px; color: #92400e; background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 6px 8px; margin-bottom: 10px;">${texte}</div>` : '';
    }

    _echapper(texte) {
        return String(texte == null ? '' : texte)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _rendre() {
        try {
            // Vérification de sécurité pour Google Maps API
            if (typeof google === 'undefined' || !google.maps || !google.maps.geometry) {
                this.modalBody.innerHTML = `<div style="color: #dc2626; text-align: center; padding: 15px; font-weight: 500;">Erreur : L'API Google Maps ou la librairie "geometry" n'est pas chargée.</div>`;
                return;
            }

            const hasShapes = this._calculer();
            const { percentAPER, percentHuwart } = this.lastCalc; // repris dans les champs de saisie ci-dessous

            let badgeConformite = this.lastCalc.isConforme
                ? `<div style="margin-top: 15px; padding: 10px; background-color: #dcfce7; color: #166534; border: 1px solid #22c55e; border-radius: 4px; text-align: center; font-weight: bold;">✅ Conformité Loi APER validée</div>`
                : `<div style="margin-top: 15px; padding: 10px; background-color: #fee2e2; color: #991b1b; border: 1px solid #ef4444; border-radius: 4px; text-align: center; font-weight: bold;">❌ Non conforme aux objectifs APER</div>`;

            this._majCouleurBoutonsMenu(this.lastCalc.isConforme);

            let warningMessage = !hasShapes ? `<div style="background-color: #fee2e2; color: #991b1b; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 13px; text-align: center; border: 1px solid #ef4444;"><strong>⚠️ Aucune surface APER détectée.</strong><br>Utilisez les boutons "+ Surface" / "- Exclusion" ci-dessus pour dessiner vos polygones sur la carte.</div>` : '';

            let deductionsHTML = "";
            if (this.lastCalc.individualSubs && this.lastCalc.individualSubs.length > 0) {
                this.lastCalc.individualSubs.forEach(sub => {
                    deductionsHTML += `<div style="display: flex; justify-content: space-between; font-size: 13px; color: #6b7280; padding-left: 10px; margin-bottom: 4px;"><span>Exclusion ${sub.id} :</span><span>- ${sub.val.toFixed(2)} m²</span></div>`;
                });
                if (this.lastCalc.individualSubs.length > 1) {
                    deductionsHTML += `<div style="display: flex; justify-content: space-between; margin-top: 8px; font-weight: bold; color: #dc2626; border-top: 1px dashed #fca5a5; padding-top: 8px;"><span>Total à déduire :</span><span>- ${this.lastCalc.subArea.toFixed(2)} m²</span></div>`;
                }
            }

            // --- NOUVEAU : Récupération ou initialisation des champs Nom et Adresse ---
            let defaultNom = "";
            let defaultAdresse = "";
            const inputNomEl = document.getElementById('aper-nom-projet');
            const inputAdrEl = document.getElementById('aper-adresse-projet');
            
            if (inputNomEl) {
                defaultNom = inputNomEl.value;
            } else {
                try {
                    const sd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    if (sd.projectInfo && sd.projectInfo.nom_projet) defaultNom = sd.projectInfo.nom_projet;
                } catch(e) {}
            }
            
            if (inputAdrEl) {
                defaultAdresse = inputAdrEl.value;
            } else {
                try {
                    const sd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    if (sd.projectInfo) {
                        if (sd.projectInfo.adresseProjet) defaultAdresse = this._parseAdresse(sd.projectInfo.adresseProjet);
                        else if (sd.projectInfo.parametreProjectSearch) defaultAdresse = this._parseAdresse(sd.projectInfo.parametreProjectSearch);
                    }
                } catch(e) {}
            }

            let inputsHTML = `
                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <label for="aper-nom-projet" style="display: block; font-size: 13px; color: #4b5563; margin-bottom: 2px; font-weight: bold;">Nom du projet :</label>
                        <input type="text" id="aper-nom-projet" value="${defaultNom}" oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÿ0-9\\s\\-.,'°]/g, '')" style="width: 100%; padding: 2px 6px; height: 22px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                    <div style="flex: 1;">
                        <label for="aper-adresse-projet" style="display: block; font-size: 13px; color: #4b5563; margin-bottom: 2px; font-weight: bold;">Adresse du projet :</label>
                        <input type="text" id="aper-adresse-projet" value="${defaultAdresse}" oninput="this.value = this.value.replace(/[^a-zA-ZÀ-ÿ0-9\\s\\-.,'°]/g, '')" style="width: 100%; padding: 2px 6px; height: 22px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <label for="aper-percent-1" style="display: block; font-size: 13px; color: #4b5563; margin-bottom: 2px; font-weight: bold;">${this._echapper(this.variables.solarisableAper.libelle)} :</label>
                        <input type="number" id="aper-percent-1" value="${percentAPER}" min="0" max="100" step="0.1" onchange="window.calculateurAPERInstance.recalculer()" style="width: 100%; padding: 2px 6px; height: 22px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                    <div style="flex: 1;">
                        <label for="aper-percent-2" style="display: block; font-size: 13px; color: #4b5563; margin-bottom: 2px; font-weight: bold;">${this._echapper(this.variables.solarisableHuwart.libelle)} :</label>
                        <input type="number" id="aper-percent-2" value="${percentHuwart}" min="0" max="100" step="0.1" onchange="window.calculateurAPERInstance.recalculer()" style="width: 100%; padding: 2px 6px; height: 22px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    </div>
                </div>
            `;

            this.modalBody.innerHTML = `
                ${inputsHTML}
                ${warningMessage}
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;"><span>Surface totale (+) :</span> <strong>${this.lastCalc.baseArea.toFixed(2)} m²</strong></div>
                <div style="margin-bottom: 15px;">${deductionsHTML}</div>
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 15px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 16px;"><span><strong>Surface Assujettie :</strong></span> <strong style="color: #2563eb;">${this.lastCalc.surfaceAssujettie.toFixed(2)} m²</strong></div>
                <div style="background-color: #f0fdf4; padding: 12px; margin-bottom: 10px; border-radius: 4px;"><div style="display: flex; justify-content: space-between;"><span><strong>Solarisable APER (${percentAPER}%) :</strong></span> <strong style="color: #16a34a;">${this.lastCalc.surfaceSolarisableAPER.toFixed(2)} m²</strong></div></div>
                <div style="background-color: #fffbeb; padding: 12px; border-radius: 4px;"><div style="display: flex; justify-content: space-between;"><span><strong>Solarisable Huwart (${percentHuwart}%) :</strong></span> <strong style="color: #d97706;">${this.lastCalc.surfaceSolarisableHuwart.toFixed(2)} m²</strong></div></div>
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 15px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px;"><span>Surface projetée champ PV :</span> <strong>${this.lastCalc.surfaceProjeteeConnue === false && !this.lastCalc.surfaceProjeteeTotale ? '—' : this.lastCalc.surfaceProjeteeTotale.toFixed(2) + ' m²'}</strong></div>
                ${this._avertissementSurfaceProjetee()}
                ${badgeConformite}
            `;
        } catch (err) {
            console.error("Calculateur APER: Erreur durant le calcul:", err);
            this.modalBody.innerHTML = `<div style="color:red; padding: 15px; text-align: center;">Erreur critique lors du calcul : ${err.message}</div>`;
        }
    }

    async exportPDF() {
        try {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) throw new Error("Le module d'export PDF n'est pas chargé : rechargez la page.");

            // Mise en attente du bouton
            this.btnExport.innerHTML = '<i class="bi bi-hourglass-split"></i> Export en cours...';
            this.btnExport.disabled = true;

            const doc = new jsPDF('portrait', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();

            // 1. En-tête et informations du projet
            let projectNom = "Projet Photovoltaïque (Non nommé)";
            let projectAdresse = "Adresse non spécifiée";
            
            const inputNomEl = document.getElementById('aper-nom-projet');
            const inputAdrEl = document.getElementById('aper-adresse-projet');
            
            if (inputNomEl && inputNomEl.value.trim() !== '') {
                projectNom = inputNomEl.value.trim();
            } else {
                try {
                    const sd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    if (sd.projectInfo && sd.projectInfo.nom_projet) projectNom = sd.projectInfo.nom_projet;
                } catch (e) { console.warn("Impossible de récupérer les infos du projet"); }
            }
            
            if (inputAdrEl && inputAdrEl.value.trim() !== '') {
                projectAdresse = inputAdrEl.value.trim();
            } else {
                try {
                    const sd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    if (sd.projectInfo) {
                        if (sd.projectInfo.adresseProjet) projectAdresse = this._parseAdresse(sd.projectInfo.adresseProjet);
                        else if (sd.projectInfo.parametreProjectSearch) projectAdresse = this._parseAdresse(sd.projectInfo.parametreProjectSearch);
                    }
                } catch (e) { console.warn("Impossible de récupérer les infos du projet"); }
            }

            doc.setFillColor(220, 38, 38); // Header Rouge
            doc.rect(0, 0, pageWidth, 22, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(18);
            doc.text("Rapport d'assujettissement - Loi APER", 15, 14);

            doc.setTextColor(0, 0, 0);
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text(`Projet : ${projectNom}`, 15, 35);
            doc.setFontSize(11);
            doc.setFont(undefined, 'normal');
            doc.text(`Localisation : ${projectAdresse}`, 15, 43);

            // 2. Tableau des résultats (gauche)
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text("Détail des surfaces calculées :", 15, 55);
            doc.setFont(undefined, 'normal');

            doc.text(`Surface totale (+) : ${this.lastCalc.baseArea.toFixed(2)} m²`, 20, 65);
            doc.text(`Surfaces Exclues (À déduire) : - ${this.lastCalc.subArea.toFixed(2)} m²`, 20, 73);

            doc.setFont(undefined, 'bold');
            doc.setTextColor(37, 99, 235);
            doc.text(`Surface Nette Assujettie : ${this.lastCalc.surfaceAssujettie.toFixed(2)} m²`, 20, 85);

            doc.setTextColor(22, 163, 74);
            doc.text(`Objectif Solarisable APER (${this.lastCalc.percentAPER}%) : ${this.lastCalc.surfaceSolarisableAPER.toFixed(2)} m²`, 20, 95);
            doc.setTextColor(217, 119, 6);
            doc.text(`Objectif Solarisable Huwart (${this.lastCalc.percentHuwart}%) : ${this.lastCalc.surfaceSolarisableHuwart.toFixed(2)} m²`, 20, 103);

            // 2. Ajout des champs Surface projetée et Conformité dans l'export PDF
            doc.setTextColor(0, 0, 0);
            doc.text(`Surface projetée champ PV : ${this.lastCalc.surfaceProjeteeTotale.toFixed(2)} m²`, 20, 113);

            if (this.lastCalc.isConforme) {
                doc.setTextColor(22, 163, 74);
                doc.text(`Conformité Loi APER : Validée`, 20, 121);
            } else {
                doc.setTextColor(220, 38, 38);
                doc.text(`Conformité Loi APER : Non conforme`, 20, 121);
            }

            // 3. Capture de la carte Google Maps (en dessous)
            const mapYStart = 130;
            doc.setTextColor(0, 0, 0);
            doc.text("Aperçu du zonage cartographique :", 15, mapYStart);

            // Utilise en priorité une capture manuelle/auto pré-enregistrée (boutons "Capture" du panneau) ;
            // sinon, capture la carte en direct au moment de l'export (comportement historique inchangé).
            let imgData = null, imgW = 0, imgH = 0;
            if (this.capturedImageData && this.capturedImageWidth && this.capturedImageHeight) {
                imgData = this.capturedImageData;
                imgW = this.capturedImageWidth;
                imgH = this.capturedImageHeight;
            } else {
                const mapElement = document.getElementById('map');
                if (mapElement && typeof html2canvas !== 'undefined') {
                    const canvas = await html2canvas(mapElement, {
                        useCORS: true,
                        allowTaint: true,
                        ignoreElements: (node) => this._isMapUiChrome(node)
                    });
                    imgData = canvas.toDataURL('image/jpeg', 0.8);
                    imgW = canvas.width;
                    imgH = canvas.height;
                }
            }

            if (imgData) {
                // Dimensions responsives pour ne pas déborder
                const maxW = pageWidth - 30; // Marge 15 de chaque côté
                const maxH = pageHeight - mapYStart - 20; // Garde une marge en bas
                const ratio = Math.min(maxW / imgW, maxH / imgH);
                imgW *= ratio;
                imgH *= ratio;

                doc.addImage(imgData, 'JPEG', 15, mapYStart + 7, imgW, imgH);
            } else {
                doc.setFont(undefined, 'normal');
                doc.text("(Le rendu de la carte est momentanément indisponible)", 15, mapYStart + 15);
            }

            // Enregistrement de l'état de la checkbox globalement
            localStorage.setItem('aper_pdf_integration', this.integrationCheckbox.checked);
            console.log("PDF Loi APER intégré au rapport global :", this.integrationCheckbox.checked);

            // Téléchargement
            doc.save(`Calcul_Loi_APER_${new Date().toISOString().split('T')[0]}.pdf`);

        } catch (err) {
            console.error("Erreur Export PDF APER:", err);
            alert("Impossible de générer le document PDF : " + err.message);
        } finally {
            // Restauration du bouton
            this.btnExport.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Exporter PDF';
            this.btnExport.disabled = false;
        }
    }

    closeModal() {
        this.modal.style.setProperty('display', 'none', 'important');
        this.backdrop.style.setProperty('display', 'none', 'important');
    }
}

// Initialisation robuste, même si le script est chargé de manière asynchrone
function initCalculateurAPER() {
    if (!window.calculateurAPERInstance) {
        window.calculateurAPERInstance = new CalculateurAPER();
        console.log("✅ Calculateur APER instancié et prêt à l'emploi.");
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalculateurAPER);
} else {
    initCalculateurAPER(); // Exécution immédiate si la page est déjà chargée
}