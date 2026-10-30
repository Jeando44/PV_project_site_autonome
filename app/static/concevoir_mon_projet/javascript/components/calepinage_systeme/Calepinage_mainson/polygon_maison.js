/**
 * Calepinage résidentiel — Étape 1 : tracé du contour de la maison sur la carte.
 *
 * Décorrélé à 100% du système de calepinage "grands projets" (DrawingControl.js,
 * PolygonPanelsManager, ShedPolygon, etc.) : propre liste de polygones, aucune dépendance croisée —
 * même principe d'isolation que la Loi APER (cf. polygone_aper.js). Dessine directement sur la carte
 * principale (window.drawingControl.map), pas de carte séparée.
 *
 * CORRECTIF (migration Terra Draw, google.maps.drawing.DrawingManager déprécié par Google) : le
 * tracé passe désormais par le moteur Terra Draw PARTAGÉ de DrawingControl.js (mode nommé
 * 'maison-polygon', cf. TerraDrawEngine.js), au lieu d'un DrawingManager natif dédié à ce
 * gestionnaire — même migration, à l'identique, que la Loi APER (cf. polygone_aper.js). La forme
 * obtenue en sortie reste un google.maps.Polygon 100% standard (TerraDrawEngine convertit
 * systématiquement la feature GeoJSON avant de la transmettre) : _initPolygon() ci-dessous,
 * l'édition des sommets, les étiquettes de cotation et le reste du calepinage résidentiel n'ont donc
 * besoin d'AUCUNE modification, comme avant la migration.
 */

// Style du contour des maisons sur la carte — UNIQUE point à modifier pour personnaliser la couleur
// (demande explicite : contour gris plutôt que bleu). Utilisé à la fois au tracé initial
// (_startDraw) et à la restauration au chargement de page (restorePolygons()).
const MAISON_POLYGON_STYLE = {
    fillColor: '#3b82f6', fillOpacity: 0.35,
    strokeColor: '#ec510a', strokeWeight: 2,
};
// Champ PV sélectionné (clic sur la carte ou liste déroulante du calepinage) : contour épaissi.
const MAISON_POLYGON_STYLE_SELECTION = {
    fillOpacity: 0.5,
    strokeWeight: 4,
};

class MaisonPolygonManager {
    constructor(map, errorModal) {
        this.map = map;
        this.errorModal = errorModal;

        this.polygons = [];
        this.selected = null;
        // `selected` reste renseigné en permanence (dernier champ tracé, restauré ou mis en
        // évidence) : seul ce drapeau dit que l'utilisateur vient de choisir ce champ (clic, tracé,
        // onglet du formulaire). La touche Suppr / le bouton « Effacer la sélection » ne suppriment
        // le champ que s'il est levé ; toute sélection d'une autre forme le baisse
        // (DrawingControl.clearSelection) — sinon Suppr sur une forme simple effaçait un champ PV.
        this.selectionActive = false;
        // Copier-coller d'un champ (cf. demarrerCopieChamp) : collage armé + contenu copié.
        this.collageActif = false;
        this._pressePapierChamp = null;

        // Correctif 2 : étiquettes de cotation (longueur de chaque arête) affichées directement sur la
        // carte, un AdvancedMarkerElement par arête, indexées par maisonId — pattern inspiré de
        // MeasurementControl.js mais réimplémenté ici pour rester découplé de DrawingControl.
        this._dimensionLabelMarkersByPolygon = new Map();
        this._markerLibraryPromise = null;

        // Correctif 4 : anti-rafraîchissements intermédiaires pendant setPolygonPath (clear()+push()
        // déclencherait sinon un set_at/insert_at par sommet reconstruit).
        this._suppressPathEvents = false;

        // NOUVEAU (demande explicite) : poignée de rotation sur la carte, un google.maps.Marker par
        // maisonId — même principe que PostAxesManager.handles (calepinage rectangulaire, cf.
        // poteaux.js), réimplémenté ici pour rester découplé de DrawingControl.
        this._rotationHandlesByPolygon = new Map();

        // NOUVEAU (demande explicite : "faire apparaître les labels et flèches sur les champs PV
        // dessinés sur la carte Google", et "placer sur la LARGEUR du rectangle le bouton qui ouvre
        // le modal géométrie, pour Ombrière métal / bois / Solumbra") : un AdvancedMarkerElement par
        // maisonId pour le couple label+flèche (au centre du contour), un autre pour le bouton de
        // configuration (milieu d'une arête de largeur). Même rendu que le calepinage "grands
        // projets" (cf. DrawingControl/shapes/Polygon.js::updateRoofVisuals et
        // controls/MeasurementControl.js::createOrUpdateSettingsLabel), réimplémenté ici pour rester
        // découplé de DrawingControl — comme les cotations ci-dessus.
        this._roofVisualsByPolygon = new Map();
        this._settingsButtonsByPolygon = new Map();
        this._roofVisualsVisible = true;

        // NOUVEAU (demande explicite : "tracé de rectangle à 3 points comme le calepinage
        // rectangulaire du grand projet, panneaux toujours parallèles") : état du tracé en cours pour
        // startRect3PointDraw() ci-dessous (écouteurs posés directement sur this.map, pas de Terra
        // Draw pour ce mode).
        this.isRectDrawActive = false;
        this._rectDrawPoints = [];
        this._rectDrawTempLine = null;
        this._rectDrawTempPolygon = null;
        this._rectDrawClickListener = null;
        this._rectDrawMouseMoveListener = null;

        // Callback(polygon, azimuths[]) — appelé à la fin du tracé (et sur reclic) pour ouvrir le
        // modal de calepinage résidentiel (cf. calepinage_maison_indiv.js).
        this.onPolygonReady = null;
    }

    /**
     * Contrôle préalable strict de la licence : false (message affiché) si la puissance du projet
     * dépasse déjà le plafond autorisé. Partagé par startDraw et le décalage de parcelles
     * (components/decalage_parcelles/), qui crée des contours sans passer par un tracé.
     * @returns {boolean}
     */
    licenceAutoriseNouveauTrace() {
        if (typeof window.checkPowerLicenceCompliance === 'function') {
            let currentPower = 0;
            const CM = window.CalepinageMaisonIndiv;
            if (CM && typeof CM.computeAllHousesResultsSummary === 'function') {
                const s = CM.computeAllHousesResultsSummary();
                currentPower = s ? (s.totalPowerKwc || 0) : 0;
            }
            const check = window.checkPowerLicenceCompliance(currentPower);
            if (check && (check.allowed === false || check.compliant === false)) {
                const maxAllowedKwc = check.maxAllowedKwc ?? check.max_allowed_kwc;
                const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                const tol = check.tolerancePercent ?? check.tolerance_percent ?? 10;
                const msg = `[Licence PV] La puissance totale de votre projet (${currentPower.toFixed(2)} kWc) dépasse déjà le plafond maximal autorisé par votre licence (${maxAllowedStr} kWc avec tolérance de ${tol}%). Impossible de tracer un nouveau contour.`;
                if (this.errorModal && typeof this.errorModal.show === 'function') {
                    this.errorModal.show(msg);
                } else {
                    alert(msg);
                }
                return false;
            }
        }
        return true;
    }

    /**
     * Démarre le tracé du contour de la maison via le moteur Terra Draw partagé
     * (window.drawingControl.terraDrawEngine — même instance que le calepinage PV/les obstacles/Loi
     * APER/les formes simples). Un seul tracé à la fois : le mode repasse automatiquement en
     * 'select' après chaque contour terminé (TerraDrawEngine::stop(), appelé par
     * ButtonControl.js::clearAllActiveModes au prochain clic d'outil — comportement "un tracé par
     * clic sur le bouton" identique à l'ancien polygoncomplete).
     */
    /**
     * @param {string} [mode='rect'] - CORRECTIF (demande explicite : "supprimer le bouton Angles
     *   90°, affecter la forme rectangulaire à un bouton et le polygone à un autre bouton") : le
     *   choix rectangle/polygone se fait désormais EN AMONT du tracé (deux boutons distincts de la
     *   palette principale, cf. ButtonControl.js) plutôt qu'après coup via un toggle dans le modal.
     *   'rect' (comportement historique, inchangé) : le contour tracé à main levée est
     *   automatiquement redressé à angles droits. 'polygon' : le tracé réel (à main levée) est
     *   conservé tel quel, jamais redressé.
     */
    startDraw(mode = 'rect') {
        if (!this.licenceAutoriseNouveauTrace()) return;

        // CORRECTIF (demande explicite : "dès le départ sur la carte on a un rectangle généré à
        // 3 points, comme dans le cas du calepinage rectangulaire du grand projet, panneaux toujours
        // parallèles au rectangle") : le mode 'rect' ne passe plus par un tracé à main levée (Terra
        // Draw) redressé a posteriori (orthogonalizePath, cf. plus bas) — imprécis dès que le tout
        // premier segment cliqué n'est pas parfaitement droit — mais par un tracé dédié à 3 clics
        // (startRect3PointDraw ci-dessous), qui fixe l'arête 1→2 comme rotation EXACTE du rectangle,
        // puis le 3e clic sa profondeur perpendiculaire — même principe que le calepinage
        // rectangulaire du grand projet (cf. LineToPolygon.js::handleFirstClick/handleSecondClick/
        // handleThirdClick + solar_calculations.js::calculateRectPoints, porté ci-dessous). Le mode
        // 'polygon' (tracé libre, bouton dédié) reste entièrement inchangé (Terra Draw).
        if (mode === 'rect') {
            this.startRect3PointDraw();
            return;
        }
        const engine = window.drawingControl && window.drawingControl.terraDrawEngine;
        if (!engine) {
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show("Le moteur de dessin n'est pas encore prêt. Veuillez réessayer.");
            }
            return;
        }
        engine.start('maison-polygon', (poly) => {
            // Tracé terminé : fin de la session de dessin (Terra Draw repasse en 'select', bouton
            // désélectionné). Sans ça, le moteur restait en mode 'maison-polygon' et captait les
            // clics de la carte : le contour ne se déplaçait plus jusqu'au rechargement de la page.
            this._terminerSessionDessin();
            // Style + éditabilité identiques à l'ancien polygonOptions du DrawingManager — la forme
            // sort de TerraDrawEngine avec editable:false (édition Terra Draw désactivée par design,
            // cf. TerraDrawEngine.js::noEditFlags) : réactivée ici pour permettre le glissé de
            // sommets après tracé (cf. listeners set_at/insert_at posés par _initPolygon ci-dessous).
            poly.setOptions({
                editable: true, draggable: true,
                ...MAISON_POLYGON_STYLE, zIndex: 5,
            });
            // Demande explicite : un contour tracé avec le bouton « Calepinage polygonal » naît en
            // « Petit champ solaire » (type modifiable ensuite dans le modal). Pas en Résidentielle,
            // où ce type n'est pas proposé (cf. calepinage_maison_formulaires.js).
            if (mode === 'polygon' && !MaisonPolygonManager.typologieResidentielle()) {
                poly.typeMontageInitial = 'champ_solaire';
            }
            this._initPolygon(poly, mode);
        }).catch((error) => {
            console.error('[MaisonPolygonManager] Échec de démarrage de Terra Draw:', error);
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show("Impossible de démarrer l'outil de dessin (Terra Draw). Détail dans la console (F12).");
            }
        });
    }

    /**
     * NOUVEAU : démarre le tracé à 3 clics du rectangle, directement sur this.map (aucune dépendance
     * à Terra Draw pour ce mode). Voir _handleRectDrawClick pour la logique des 3 étapes.
     */
    startRect3PointDraw() {
        this.cancelRectDraw(); // sécurité : repart d'un état propre si un tracé précédent traînait
        this.isRectDrawActive = true;
        this._rectDrawPoints = [];
        this._rectDrawClickListener = google.maps.event.addListener(this.map, 'click', (e) => {
            this._handleRectDrawClick(e.latLng);
        });
    }

    _handleRectDrawClick(latLng) {
        const n = this._rectDrawPoints.length;
        if (n === 0) this._handleRectDrawFirstClick(latLng);
        else if (n === 1) this._handleRectDrawSecondClick(latLng);
        else if (n === 2) this._handleRectDrawThirdClick(latLng);
    }

    /** Clic 1 : premier coin — démarre une ligne temporaire qui suit la souris. */
    _handleRectDrawFirstClick(latLng) {
        this._rectDrawPoints.push(latLng);
        this._rectDrawTempLine = new google.maps.Polyline({
            path: [latLng, latLng],
            strokeColor: MAISON_POLYGON_STYLE.strokeColor,
            strokeWeight: 2,
            strokeOpacity: 1,
            map: this.map,
            zIndex: 1000,
            clickable: false,
        });
        this._rectDrawMouseMoveListener = google.maps.event.addListener(this.map, 'mousemove', (e) => {
            if (this._rectDrawTempLine && this._rectDrawPoints.length === 1) {
                this._rectDrawTempLine.getPath().setAt(1, e.latLng);
            }
        });
    }

    /**
     * Clic 2 : fixe l'arête 1→2 — c'est cette arête, et elle seule, qui détermine la rotation exacte
     * du rectangle final (aucune dépendance à la précision d'un tracé à main levée). Démarre
     * l'aperçu en direct du rectangle (profondeur pilotée par la souris jusqu'au 3e clic).
     */
    _handleRectDrawSecondClick(latLng) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(this._rectDrawPoints[0], latLng);
        if (distance < 0.5) {
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show('Le premier côté du rectangle doit mesurer au moins 0,5 m.');
            }
            return;
        }
        this._rectDrawPoints.push(latLng);
        this._rectDrawTempLine.setPath([this._rectDrawPoints[0], this._rectDrawPoints[1]]);

        this._rectDrawTempPolygon = new google.maps.Polygon({
            paths: [this._rectDrawPoints[0], this._rectDrawPoints[1], this._rectDrawPoints[1], this._rectDrawPoints[0]],
            ...MAISON_POLYGON_STYLE,
            map: this.map,
            zIndex: 1000,
            clickable: false,
        });

        if (this._rectDrawMouseMoveListener) google.maps.event.removeListener(this._rectDrawMouseMoveListener);
        this._rectDrawMouseMoveListener = google.maps.event.addListener(this.map, 'mousemove', (e) => {
            this._updateRectDrawTempPolygon(e.latLng);
        });
    }

    _updateRectDrawTempPolygon(mousePos) {
        if (!this._rectDrawTempPolygon || this._rectDrawPoints.length !== 2) return;
        const rectPoints = MaisonPolygonManager.calculateRectPoints(this._rectDrawPoints[0], this._rectDrawPoints[1], mousePos);
        this._rectDrawTempPolygon.setPath(rectPoints);
        // Aperçu en rouge tant que la surface dépasse le maximum autorisé (le 3e clic serait refusé).
        const tropGrand = !!MaisonPolygonManager.depassementSurface(MaisonPolygonManager.surfaceCheminM2(rectPoints), 'rect');
        this._rectDrawTempPolygon.setOptions({
            strokeColor: tropGrand ? '#dc2626' : MAISON_POLYGON_STYLE.strokeColor,
            fillColor: tropGrand ? '#dc2626' : MAISON_POLYGON_STYLE.fillColor,
        });
    }

    /** Clic 3 : fixe la profondeur perpendiculaire et finalise le rectangle. */
    _handleRectDrawThirdClick(latLng) {
        const point1 = this._rectDrawPoints[0];
        const point2 = this._rectDrawPoints[1];
        const tempPath = this._rectDrawTempPolygon.getPath();
        const corner3 = tempPath.getAt(2);
        const corner4 = tempPath.getAt(3);

        const depth = google.maps.geometry.spherical.computeDistanceBetween(point2, corner3);
        if (depth < 0.5) {
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show('La profondeur du rectangle doit mesurer au moins 0,5 m.');
            }
            return;
        }

        // points[0]→points[1] = arête de longueur, cohérent avec computeLengthEdgeAngle()
        // (calepinage_maison_calculs.js) qui en dérive l'orientation des panneaux — garantit des
        // panneaux parallèles au rectangle dès la construction, sans changement côté calcul.
        const finalPath = [point1, point2, corner3, corner4];
        this.cancelRectDraw();
        this._terminerSessionDessin();

        const poly = new google.maps.Polygon({
            paths: finalPath,
            editable: true, draggable: true,
            ...MAISON_POLYGON_STYLE, zIndex: 5,
            map: this.map,
        });
        // skipOrthogonalize:true — ce rectangle est déjà géométriquement exact (calculateRectPoints),
        // le redresser "en escalier" (pensé pour un tracé à main levée) n'est ni nécessaire ni
        // souhaitable ici.
        this._initPolygon(poly, 'rect', { skipOrthogonalize: true });
    }

    /**
     * Fin d'un tracé sur la carte : même remise à zéro que les autres outils de dessin
     * (DrawingControl.finishDrawingSession : moteur Terra Draw arrêté, curseur et bouton actif
     * réinitialisés), pour que le contour créé soit aussitôt déplaçable.
     */
    _terminerSessionDessin() {
        const dc = window.drawingControl;
        if (dc && typeof dc.finishDrawingSession === 'function') {
            try { dc.finishDrawingSession(); } catch (e) { console.warn('[MaisonPolygonManager] Fin de session de dessin', e); }
        } else if (dc && dc.terraDrawEngine) {
            dc.terraDrawEngine.stop();
        }
    }

    /**
     * Annule un tracé de rectangle en cours (changement d'outil, Échap...) — retire les écouteurs et
     * les overlays temporaires. Sans effet si aucun tracé n'est en cours. Appelée par
     * ButtonControl.js::clearAllActiveModes(), même principe que lineToPolygon.clearTemp() côté
     * grand-projet.
     */
    cancelRectDraw() {
        if (this._rectDrawClickListener) { google.maps.event.removeListener(this._rectDrawClickListener); this._rectDrawClickListener = null; }
        if (this._rectDrawMouseMoveListener) { google.maps.event.removeListener(this._rectDrawMouseMoveListener); this._rectDrawMouseMoveListener = null; }
        if (this._rectDrawTempLine) { this._rectDrawTempLine.setMap(null); this._rectDrawTempLine = null; }
        if (this._rectDrawTempPolygon) { this._rectDrawTempPolygon.setMap(null); this._rectDrawTempPolygon = null; }
        this._rectDrawPoints = [];
        this.isRectDrawActive = false;
    }

    /**
     * Copier-coller d'un champ PV (bouton « Copier/Coller le champ PV » de la palette, demande
     * explicite) : copie le champ sélectionné sur la carte — contour ET calepinage (pans, obstacles,
     * réglages) — puis arme le collage : le clic suivant sur la carte y pose la copie, centrée sur
     * le point cliqué, sous le numéro PV N+1 (N = plus grand numéro en usage). Annulé par Échap ou
     * le choix d'un autre outil (ButtonControl.js::clearAllActiveModes -> annulerCollage).
     * @returns {boolean} true si le collage est armé
     */
    demarrerCopieChamp() {
        const source = this.selectionActive ? this.selected : null;
        const CM = window.CalepinageMaisonIndiv;
        if (!source || !source.maisonId || !this.polygons.includes(source)) {
            this._afficherMessage("Sélectionnez d'abord un champ PV sur la carte (clic sur le champ), puis cliquez sur Copier/Coller.");
            return false;
        }
        const etat = CM && typeof CM.copierEtatChamp === 'function' ? CM.copierEtatChamp(source.maisonId) : null;
        if (!etat) {
            this._afficherMessage(`Le calepinage du champ ${source.maisonId} n'a pas pu être copié.`);
            return false;
        }
        this.annulerCollage();
        this._pressePapierChamp = {
            sourceId: source.maisonId,
            chemin: source.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
            mode: source.maisonMode || MaisonPolygonManager.inferModeFromPath(source.getPath().getArray()),
            etat,
            puissanceKwc: this._puissanceChampKwc(source.maisonId),
        };
        this.collageActif = true;
        this.map.setOptions({ draggableCursor: 'copy' });
        this._collageClickListener = google.maps.event.addListener(this.map, 'click', (e) => this._collerChampA(e.latLng));
        return true;
    }

    /** Désarme le collage (sans effet s'il ne l'est pas) et remet le bouton de la palette au repos. */
    annulerCollage() {
        if (this._collageClickListener) { google.maps.event.removeListener(this._collageClickListener); this._collageClickListener = null; }
        const etaitActif = this.collageActif;
        this.collageActif = false;
        this._pressePapierChamp = null;
        if (!etaitActif) return;
        if (this.map) this.map.setOptions({ draggableCursor: null });
        const bouton = document.getElementById('copy-paste-button');
        if (bouton) {
            bouton.classList.remove('selected');
            bouton.style.backgroundColor = 'white';
        }
        const dc = window.drawingControl;
        if (dc && bouton && dc.activeButton === bouton) dc.activeButton = null;
    }

    /** Puissance (kWc) du champ `maisonId` d'après le résumé du calepinage. */
    _puissanceChampKwc(maisonId) {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.computeAllHousesResultsSummary !== 'function') return 0;
        const resume = CM.computeAllHousesResultsSummary();
        return (resume && resume.perPan ? resume.perPan : [])
            .filter((p) => p.sourceId === maisonId)
            .reduce((somme, p) => somme + (p.powerKwc || 0), 0);
    }

    /**
     * Numéro du champ collé : PV N+1, N étant le plus grand numéro en usage (champs PV et pool
     * partagé du calepinage grand projet) — la copie se range toujours après les champs existants.
     */
    _prochainNumeroChampColle() {
        const numero = (id) => { const m = /^PV(\d+)$/.exec(id || ''); return m ? Number(m[1]) : 0; };
        let max = 0;
        this.polygons.forEach((p) => { max = Math.max(max, numero(p.maisonId)); });
        const pool = window.drawingControl && window.drawingControl.usedIds;
        if (pool) pool.forEach((id) => { max = Math.max(max, numero(id)); });
        return `PV${max + 1}`;
    }

    _afficherMessage(msg) {
        if (this.errorModal && typeof this.errorModal.show === 'function') this.errorModal.show(msg);
        else alert(msg);
    }

    /**
     * Pose la copie du champ du presse-papier, centrée sur `latLng` : chaque sommet garde sa distance
     * et son cap depuis le centre du contour d'origine (translation au sol, forme et orientation
     * inchangées). Le champ collé est enregistré comme un champ tracé — localStorage (contour +
     * calepinage) puis base de données.
     */
    _collerChampA(latLng) {
        const pp = this._pressePapierChamp;
        const CM = window.CalepinageMaisonIndiv;
        if (!pp || !latLng || !CM || typeof CM.collerEtatChamp !== 'function') return;

        // Licence : la copie ajoute la puissance du champ copié à celle du projet.
        if (typeof window.checkPowerLicenceCompliance === 'function' && typeof CM.computeAllHousesResultsSummary === 'function') {
            const resume = CM.computeAllHousesResultsSummary();
            const total = (resume ? resume.totalPowerKwc || 0 : 0) + (pp.puissanceKwc || 0);
            const check = window.checkPowerLicenceCompliance(total);
            if (check && (check.allowed === false || check.compliant === false)) {
                const maxAllowedKwc = check.maxAllowedKwc ?? check.max_allowed_kwc;
                const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                const tol = check.tolerancePercent ?? check.tolerance_percent ?? 10;
                this.annulerCollage();
                this._afficherMessage(`[Licence PV] Avec la copie du champ ${pp.sourceId}, la puissance totale du projet (${total.toFixed(2)} kWc) dépasserait le plafond maximal autorisé par votre licence (${maxAllowedStr} kWc avec tolérance de ${tol}%). Copie annulée.`);
                return;
            }
        }

        const sph = google.maps.geometry.spherical;
        const cheminSource = pp.chemin.map((p) => new google.maps.LatLng(p.lat, p.lng));
        const bounds = new google.maps.LatLngBounds();
        cheminSource.forEach((ll) => bounds.extend(ll));
        const centre = bounds.getCenter();
        const deplacer = (ll) => sph.computeOffset(latLng, sph.computeDistanceBetween(centre, ll), sph.computeHeading(centre, ll));
        const chemin = cheminSource.map(deplacer);

        const poly = new google.maps.Polygon({
            paths: chemin,
            editable: true, draggable: true,
            ...MAISON_POLYGON_STYLE, zIndex: 5,
            map: this.map,
        });
        poly._rawPath = chemin.slice();
        poly.maisonMode = pp.mode;
        poly.maisonId = this._prochainNumeroChampColle();

        // Origine du repère local de l'état copié, déplacée comme le contour.
        const o = pp.etat.roofLocalOriginLatLng;
        const origineDeplacee = (o && Number.isFinite(o.lat) && Number.isFinite(o.lng))
            ? deplacer(new google.maps.LatLng(o.lat, o.lng)) : null;
        this.annulerCollage();
        try {
            CM.collerEtatChamp(poly.maisonId, pp.sourceId, pp.etat, poly,
                origineDeplacee ? { lat: origineDeplacee.lat(), lng: origineDeplacee.lng() } : null);
        } catch (e) {
            console.error(`[MaisonPolygonManager] Collage du champ ${pp.sourceId} impossible`, e);
            poly.setMap(null);
            this._afficherMessage(`Le champ ${pp.sourceId} n'a pas pu être collé (détail dans la console, F12).`);
            return;
        }

        this._registerPolygon(poly);
        const dc = window.drawingControl;
        if (dc && typeof dc.clearSelection === 'function') dc.clearSelection();
        this.mettreEnEvidence(poly.maisonId);
        this.selectionActive = true;
        this._updateDimensionLabels(poly);
        this._updateRoofVisuals(poly);
        this._persistPolygons();
        // Mêmes suites qu'un tracé : parcelles, onglet du formulaire PRO, panneaux sur la carte.
        this._notifyParcelleCollection(poly);
        try {
            const geoCheck = this.checkGeographicCoherence(poly);
            if (geoCheck && geoCheck.isWithinLimit === false) {
                const distKm = (geoCheck.distance / 1000).toFixed(2);
                const maxKm = ((geoCheck.maxAllowed || 2000) / 1000).toFixed(1);
                this._afficherMessage(`[Alerte de cohérence géographique] Le champ collé (${poly.maisonId}) se situe à ${distKm} km de l'adresse du projet (seuil maximal : ${maxKm} km). Les calculs de productible seront bloqués tant que le calepinage ne sera pas déplacé à proximité immédiate de l'adresse du projet.`);
            }
        } catch (e) {
            console.warn('[MaisonPolygonManager] Erreur lors de la vérification de cohérence géographique:', e);
        }
        if (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.saveToDatabase === 'function') {
            window.CalepinageMaisonPersistenceDB.saveToDatabase().catch((err) => {
                console.warn(`[MaisonPolygonManager] Champ collé ${poly.maisonId} non enregistré en base`, err);
            });
        }
    }

    /**
     * Crée un NOUVEAU contour (donc un nouveau champ PV) à partir d'un tracé déjà calculé, sans
     * passer par un traçé interactif sur la carte.
     *
     * Demande explicite : les outils « Rectangle (contour) » et « Polygone libre (contour) » du
     * modal doivent permettre d'ajouter d'AUTRES champs PV sans retourner sur la carte. Ils
     * remplaçaient jusqu'ici le contour du champ PV ouvert (cf. finalizeContour,
     * calepinage_maison_dessin.js), ce qui faisait disparaître le calepinage existant.
     *
     * Tout le reste du cycle de vie est celui d'un contour tracé à la souris : _initPolygon()
     * attribue le prochain identifiant PV{n} libre, enregistre le polygone, pose les cotations et la
     * poignée de rotation, persiste, puis ouvre le modal sur ce nouveau champ (_notifyReady).
     *
     * skipOrthogonalize : le tracé vient d'un calcul géométrique exact (rectangle à 3 points) ou d'un
     * polygone libre assumé tel quel — le redressement "en escalier", pensé pour un tracé à main
     * levée sur la carte, n'a pas lieu d'être ici (même raisonnement que _handleRectDrawThirdClick).
     *
     * @param {google.maps.LatLng[]} latLngArray - au moins 3 sommets
     * @param {'rect'|'polygon'} [mode='rect']
     * @param {{typeMontageInitial?: string, origineParcelles?: Object}} [options] - typeMontageInitial : type de structure du
     *   champ à sa création (ex. 'champ_solaire' pour un contour issu d'un décalage de parcelles),
     *   appliqué à la 1re ouverture du calepinage (cf. orchestrateur::openCalepinageMaisonModal) ;
     *   origineParcelles : limite, trait et valeur du décalage, persisté avec le contour ;
     *   reglagesInitiaux : réglages du calepinage à la création (ex. { edgeClearanceM: 0 }), cf.
     *   orchestrateur::appliquerReglagesInitiaux.
     * @returns {google.maps.Polygon|null} le polygone créé, ou null si le tracé est inexploitable
     */
    createPolygonFromLatLngs(latLngArray, mode = 'rect', options = {}) {
        if (!Array.isArray(latLngArray) || latLngArray.length < 3) return null;

        const poly = new google.maps.Polygon({
            paths: latLngArray,
            editable: true, draggable: true,
            ...MAISON_POLYGON_STYLE, zIndex: 5,
            map: this.map,
        });
        if (options.typeMontageInitial) poly.typeMontageInitial = options.typeMontageInitial;
        if (options.origineParcelles) poly.origineParcelles = options.origineParcelles;
        if (options.reglagesInitiaux) poly.reglagesInitiaux = options.reglagesInitiaux;
        if (!this._initPolygon(poly, mode, { skipOrthogonalize: true })) return null;
        return poly;
    }

    /**
     * Surface maximale (m²) d'un contour selon l'outil de tracé : 'polygon' = polygone libre, tout
     * autre mode = rectangle. Valeurs de config.py (CALEPINAGE_SURFACE_MAX_RECT_M2 /
     * _POLYGONE_M2) injectées par menu.html dans window.CALEPINAGE_SURFACE_MAX_M2 ; le backend
     * revérifie à la sauvegarde (filet de sécurité).
     * @param {'rect'|'polygon'} mode
     * @returns {number}
     */
    static surfaceMaxContourM2(mode) {
        const cfg = window.CALEPINAGE_SURFACE_MAX_M2 || {};
        const max = mode === 'polygon' ? Number(cfg.polygon) : Number(cfg.rect);
        if (Number.isFinite(max) && max > 0) return max;
        return mode === 'polygon' ? 50000 : 25000;
    }

    /** Projet actif de typologie Résidentielle (même règle que calepinage_maison_formulaires.js). */
    static typologieResidentielle() {
        const typologie = typeof window.normaliserTypologie === 'function'
            ? window.normaliserTypologie(window.ACTIVE_PROJECT_TYPOLOGIE) : window.ACTIVE_PROJECT_TYPOLOGIE;
        return typologie === (window.TYPOLOGIE_RESIDENTIELLE || 'Résidentielle');
    }

    /** Surface (m²) d'un contour en mètres locaux [{x, y}] (formule du lacet). */
    static surfaceLocaleM2(points) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        let somme = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            somme += a.x * b.y - b.x * a.y;
        }
        return Math.abs(somme) / 2;
    }

    /** Surface géodésique (m²) d'un contour en google.maps.LatLng. */
    static surfaceCheminM2(path) {
        if (!Array.isArray(path) || path.length < 3) return 0;
        return google.maps.geometry.spherical.computeArea(path);
    }

    /**
     * Dépassement de la surface maximale autorisée pour ce mode de tracé. `marge` (fraction, ex.
     * 0.005) : tolérance des contrôles en aval du tracé (recalcul, backend), pour qu'un contour admis
     * au tracé ne soit jamais rejeté ensuite par un simple écart de projection (géodésique / mètres locaux).
     * @returns {{surfaceM2: number, maxM2: number, mode: string}|null} null si la surface est admise
     */
    static depassementSurface(surfaceM2, mode, marge = 0) {
        const maxM2 = MaisonPolygonManager.surfaceMaxContourM2(mode);
        if (!(surfaceM2 > maxM2 * (1 + marge))) return null;
        return { surfaceM2, maxM2, mode };
    }

    /** Message affiché à l'utilisateur quand un tracé dépasse la surface autorisée. */
    static messageSurfaceDepassee(dep) {
        const fmt = (v) => Math.round(v).toLocaleString('fr-FR');
        const outil = dep.mode === 'polygon' ? 'polygonal' : 'rectangulaire';
        return `[Surface trop grande] Le contour ${outil} tracé mesure ${fmt(dep.surfaceM2)} m², `
            + `au-delà de la surface maximale autorisée pour un calepinage ${outil} (${fmt(dep.maxM2)} m²). `
            + 'Le tracé et le calcul sont bloqués : veuillez reprendre le dessin avec une surface plus petite.';
    }

    _afficherErreurSurface(dep) {
        const msg = MaisonPolygonManager.messageSurfaceDepassee(dep);
        if (this.errorModal && typeof this.errorModal.show === 'function') this.errorModal.show(msg);
        else alert(msg);
    }

    /**
     * Contrôle de surface d'un contour sur la carte. Un contour issu du bouton de décalage de
     * parcelles cadastrales (poly.origineParcelles) suit la limite du polygone.
     * @returns {Object|null} le dépassement, ou null si le contour est admis
     */
    _depassementSurfacePoly(poly, path, mode) {
        const modeLimite = (poly && poly.origineParcelles) ? 'polygon' : mode;
        return MaisonPolygonManager.depassementSurface(MaisonPolygonManager.surfaceCheminM2(path), modeLimite);
    }

    /**
     * @returns {boolean} false si le tracé a été refusé (surface trop grande) : le polygone est
     *   alors retiré de la carte et aucun champ PV n'est créé.
     */
    _initPolygon(poly, mode = 'rect', opts = {}) {
        // Conserve le tracé réel (avant redressement éventuel) — jamais modifié ensuite.
        poly._rawPath = poly.getPath().getArray().slice();

        // CORRECTIF (demande explicite : "le contour rectangle doit TOUJOURS rester un rectangle,
        // y compris après modification de ses arêtes") : `mode` n'était jusqu'ici qu'un paramètre
        // transitoire de cette fonction, perdu aussitôt après — impossible pour onPathChanged
        // (édition de sommet, plus bas) de savoir si CE polygone doit rester contraint à angles
        // droits. Conservé sur l'instance elle-même, et persisté (cf. _persistPolygons()/
        // restorePolygons()) pour survivre à un rechargement de page.
        poly.maisonMode = mode;

        // Contrainte "angles droits" : uniquement en mode 'rect' (bouton rectangle de la palette
        // principale) — le contour tracé à main levée est automatiquement redressé en un polygone
        // rectiligne (cf. orthogonalizePath ci-dessous). En mode 'polygon' (bouton polyligne), le
        // tracé réel est conservé sans y toucher.
        // opts.skipOrthogonalize : NOUVEAU (tracé rectangle à 3 points, cf. startRect3PointDraw) —
        // un rectangle produit par calculateRectPoints est déjà géométriquement exact, le redresser
        // "en escalier" (orthogonalizePath, pensé pour un tracé à main levée) n'est ni nécessaire ni
        // souhaitable.
        if (mode !== 'polygon' && !opts.skipOrthogonalize) {
            const orthogonalPath = MaisonPolygonManager.orthogonalizePath(poly._rawPath);
            poly.setPath(orthogonalPath);
        }

        // Surface maximale (rectangle 25 000 m², polygone 50 000 m² par défaut, cf. config.py) :
        // au-delà, le tracé est refusé avant toute création de champ PV, donc avant tout calcul.
        const depassement = this._depassementSurfacePoly(poly, poly.getPath().getArray(), mode);
        if (depassement) {
            poly.setMap(null);
            this._afficherErreurSurface(depassement);
            return false;
        }

        // NOUVEAU (demande explicite : "modifier le label Maison 1, Maison 2 en PV1, PV2") : maisonId
        // sert à la fois de sourceId technique ET de label affiché (sélecteur de maison, cf.
        // orchestrateur.js::refreshSourceSelectOptions) — renommé pour rester cohérent avec la
        // convention PV1/PV2/... utilisée par le reste de l'application.
        //
        // CORRECTIF (confirmé lors de l'analyse de faisabilité BD : "peut-on utiliser calepinage
        // maison ET rectangulaire/shed dans le même projet ?") : le système rectangulaire/
        // polygonale/shed pioche ses propres pvId "PV{n}" dans un pool partagé
        // (drawingControl.usedIds, cf. ShapeHandler.js/Polygon.js/ShedPolygon.js), totalement
        // ignoré ici jusqu'à présent — un rectangle et une maison pouvaient donc porter EXACTEMENT
        // le même identifiant "PV1" en cas d'usage combiné (pas de corruption de données constatée,
        // les deux systèmes utilisant des espaces de stockage séparés, mais une ambiguïté visuelle
        // gênante, ex. dans le résumé). On consulte désormais ce même pool avant d'attribuer un
        // numéro, pour rester unique sur tout le projet quel que soit l'usage (combiné ou non).
        let id = 1;
        const sharedUsedIds = window.drawingControl && window.drawingControl.usedIds;
        while (this.polygons.some((p) => p.maisonId === `PV${id}`) || (sharedUsedIds && sharedUsedIds.has(`PV${id}`))) id++;
        poly.maisonId = `PV${id}`;

        this._registerPolygon(poly);
        this.selectionActive = true;

        // Ouverture automatique dès la fin du tracé (simule le clic demandé dans la consigne).
        // CORRECTIF (demande explicite : "conserver le comportement actuel pour le résidentiel ;
        // pour les projets PRO et Grands Projets, supprimer l'ouverture automatique — le modal ne
        // doit s'ouvrir que lorsque l'utilisateur clique explicitement sur les dimensions ou sur le
        // bouton dédié") : seule CETTE ouverture-ci est conditionnée. Les deux autres points
        // d'entrée restent ouverts à toutes les typologies et ne passent pas par ici :
        //   - clic sur une cotation (_updateDimensionLabels -> _notifyReady, plus bas) ;
        //   - bouton "Ouvrir le calepinage résidentiel" de la palette (ButtonControl.js, jamais
        //     ajouté à RESIDENTIAL_HIDDEN_BUTTON_IDS).
        // isResidentialPath() (parametre.html) couvre aussi les projets Site autonome, quelle que
        // soit leur typologie — c'est la raison d'être de cette indirection.
        this._updateDimensionLabels(poly);
        this._updateRoofVisuals(poly);

        // CONTRÔLE DE COHÉRENCE GÉOGRAPHIQUE (Calepinage vs Adresse du projet, seuil 2 km)
        try {
            const geoCheck = this.checkGeographicCoherence(poly);
            if (geoCheck && geoCheck.isWithinLimit === false) {
                const distKm = (geoCheck.distance / 1000).toFixed(2);
                const maxKm = ((geoCheck.maxAllowed || 2000) / 1000).toFixed(1);
                const msg = `[Alerte de cohérence géographique] Le contour tracé (${poly.maisonId}) se situe à ${distKm} km de l'adresse du projet (seuil maximal : ${maxKm} km). Les calculs de productible seront bloqués tant que le calepinage ne sera pas redessiné à proximité immédiate de l'adresse du projet.`;
                if (this.errorModal && typeof this.errorModal.show === 'function') {
                    this.errorModal.show(msg);
                } else {
                    alert(msg);
                }
            }
        } catch (e) {
            console.warn('[MaisonPolygonManager] Erreur lors de la vérification de cohérence géographique:', e);
        }

        const parcoursResidentiel = (typeof window.isResidentialPath !== 'function')
            || window.isResidentialPath();
        if (parcoursResidentiel) this._notifyReady(poly);
        this._persistPolygons();

        // NOUVEAU (demande explicite : "étendre la collecte des numéros de parcelles au calepinage
        // maison résidentielle") : même boucle de données que le calepinage rectangulaire/polygonal
        // (centre géométrique -> appel API cadastre -> liaison au pvId -> modale "Résumé parcelles"
        // + tableau du rapport), déclenchée UNE SEULE FOIS ici, à la fin du tracé (même moment que
        // ShapeHandler.js::handlePanelShapeComplete pour les formes "grands projets").
        this._notifyParcelleCollection(poly);
        return true;
    }

    /**
     * NOUVEAU : calcule le centre géométrique du contour (moyenne des bornes, identique à
     * ShapeHandler.js::handlePanelShapeComplete pour un google.maps.Polygon) puis dispatche un
     * événement DÉDIÉ 'maisonShapeAdded' — volontairement PAS le SHAPE_ADDED partagé par le
     * calepinage "grands projets" : ce dernier est aussi écouté par TabsManager.js (créerait un
     * onglet "Données système" + interrogerait PVGIS pour ce pvId, non pertinent pour une maison
     * résidentielle) et ToolBar.js. Seul resuméParcelles.js écoute 'maisonShapeAdded', pour réutiliser
     * telle quelle sa logique _getParcelleInfo/_createParcelleRow (appel API cadastre + liaison au
     * pvId + rendu dans la modale "Résumé parcelles"), sans dupliquer ce code ici.
     * @param {google.maps.Polygon} poly
     */
    _notifyParcelleCollection(poly) {
        const bounds = new google.maps.LatLngBounds();
        poly.getPath().forEach((point) => bounds.extend(point));
        const center = bounds.getCenter();
        document.dispatchEvent(new CustomEvent('maisonShapeAdded', {
            detail: {
                pvId: poly.maisonId,
                center: { lat: center.lat(), lng: center.lng() },
            },
        }));
    }

    /**
     * NOUVEAU (bug rapporté : "les données de calepinage sont perdues si on actualise la page") :
     * câble les écouteurs communs à un polygone maison (clic pour ouvrir le modal, édition des
     * sommets) et l'ajoute à la liste — factorisé hors de _initPolygon (tracé à main levée) pour être
     * réutilisé tel quel par restorePolygons() (recréation silencieuse au chargement de page), qui a
     * besoin des mêmes écouteurs mais SANS redressement/ouverture automatique du modal.
     * @param {google.maps.Polygon} poly - déjà positionné (path + maisonId déjà posés par l'appelant)
     */
    _registerPolygon(poly) {
        // NOUVEAU (correctif de numérotation, cf. _initPolygon ci-dessus) : réserve ce maisonId dans
        // le pool partagé du calepinage rectangulaire/polygonale/shed — sans ça, un rectangle dessiné
        // APRÈS une maison restaurée au chargement de page (donc jamais passée par _initPolygon
        // cette session) pourrait quand même réutiliser son numéro, puisque son propre compteur
        // (drawingControl.usedIds) ignorerait totalement cette maison tant qu'elle n'y est pas
        // explicitement ajoutée. Appelé pour les deux cas (tracé neuf ET restauration), _registerPolygon
        // étant le point d'entrée commun aux deux (cf. restorePolygons()).
        if (window.drawingControl && window.drawingControl.usedIds) {
            window.drawingControl.usedIds.add(poly.maisonId);
        }

        this.polygons.push(poly);
        this.selected = poly;
        // Dernier contour admis (surface maximale) : rétabli si une édition de sommet le dépasse.
        poly._cheminSurfaceValide = poly.getPath().getArray().slice();

        // CORRECTIF (demande explicite : "le modal doit s'ouvrir uniquement en cliquant sur les
        // labels") : openModal() (ex-alias de this._notifyReady(poly)) a été retiré — plus aucun
        // appelant dans ce fichier (ni le clic sur le polygone, ni l'édition du tracé, cf. plus bas).
        // Seule la cotation cliquée (_updateDimensionLabels) appelle encore this._notifyReady(poly)
        // directement.

        // NOUVEAU (bug rapporté : "cliquer sur la surface pour la déplacer ouvre aussi le modal") :
        // un glissé (mousedown + déplacement + relâchement sur l'intérieur du polygone, pour le
        // déplacer — poly.draggable déjà activé plus haut) peut, selon les cas, se terminer par un
        // évènement 'click' dont le point de relâchement reste proche du contour (ex. si la prise a
        // eu lieu près d'un bord) : la garde bordure/sommet/cotation ci-dessous laissait alors
        // passer ce clic et rouvrait le modal en même temps que le déplacement. On suit maintenant
        // explicitement l'état de glissé (dragstart/dragend) et on ignore tout clic déclenché
        // pendant ou juste après un glissé, quel que soit le point où il se termine.
        let isDragging = false;
        // NOUVEAU (demande explicite : « avec plusieurs champs PV, on doit pouvoir sélectionner un champ PV
        // en cliquant dessus sur la carte ») : le clic SÉLECTIONNE le champ. Calepinage résidentiel ouvert :
        // il bascule sur ce champ (comme la liste déroulante). Calepinage fermé : simple mise en évidence —
        // le modal ne s'ouvre toujours qu'au clic sur une cotation (décision explicite antérieure). Ignoré
        // pendant un glissé du polygone et pendant un tracé en cours sur la carte.
        google.maps.event.addListener(poly, 'click', (e) => {
            // Collage armé : un clic sur un champ existant pose aussi la copie (le clic sur un
            // polygone n'atteint pas la carte).
            if (this.collageActif) { if (e && e.latLng) this._collerChampA(e.latLng); return; }
            if (isDragging || this._traceEnCoursSurCarte()) return;
            this.selectionnerParClic(poly);
        });
        google.maps.event.addListener(poly, 'dragstart', () => { isDragging = true; });
        google.maps.event.addListener(poly, 'dragend', () => {
            // Léger délai avant de réautoriser un clic normal : un 'click' consécutif à un glissé,
            // quand il est émis, l'est juste après 'dragend' — on veut encore le voir comme "issu
            // d'un glissé" et l'ignorer, pas comme une nouvelle intention de clic.
            setTimeout(() => { isDragging = false; }, 50);
            // Pendant le glissé, les 'set_at' sont ignorés (isDragging) : le contour déplacé est
            // sauvegardé et son calepinage (panneaux) le suit ici, une fois le geste terminé.
            this._persistPolygons();
            this._signalerContourModifie(poly);
        });

        // CORRECTIF (demande explicite : "le modal doit s'ouvrir uniquement en cliquant sur les
        // labels") — remplace le comportement précédent (ci-dessous, conservé en commentaire pour
        // mémoire) qui ouvrait le modal au clic sur la bordure/un sommet du contour : ce n'est plus
        // souhaité, seule une cotation cliquée (_updateDimensionLabels, cf. plus bas) doit ouvrir le
        // modal désormais. Écouteur 'click' du polygone retiré entièrement.
        //
        // ANCIEN COMPORTEMENT (NOUVEAU, demande explicite, corrigé une 2e fois) : seul un clic sur la
        // bordure/un sommet du contour (ou une cotation) ouvrait le modal — un clic à l'intérieur du
        // tracé permettait de le déplacer (poly.draggable). Testait la proximité du point cliqué avec
        // le contour via google.maps.geometry.poly.isLocationOnEdge, tolérance ~1.5 m.

        // Recalcule les azimuts si l'utilisateur ajuste manuellement un sommet après coup (édition des
        // poignées). Correctif 2 : rafraîchit aussi les étiquettes de cotation à chaque édition de
        // sommet. Correctif 4 : ignore les rafraîchissements intermédiaires provenant de
        // setPolygonPath (pendant path.clear()/push()), cf. garde _suppressPathEvents ci-dessous.
        //
        // CORRECTIF (demande explicite : "modifier les arêtes d'un polygone ouvre le modal, cela ne
        // doit pas se produire — le modal doit s'ouvrir uniquement en cliquant sur les labels") :
        // openModal() n'est plus appelé ici — seule une cotation cliquée (_updateDimensionLabels,
        // écouteur 'click' posé sur chaque étiquette de longueur) ouvre encore le modal. L'édition
        // reste néanmoins sauvegardée (_persistPolygons() conservé).
        const finishPathChanged = () => {
            if (!isDragging && !this._suppressPathEvents) {
                const chemin = poly.getPath().getArray();
                const depassement = this._depassementSurfacePoly(poly, chemin, poly.maisonMode);
                if (depassement && poly._cheminSurfaceValide) {
                    // Sommet déplacé/ajouté au-delà de la surface autorisée : retour au dernier contour admis.
                    this.setPolygonPath(poly, poly._cheminSurfaceValide, { silent: true, sansControleSurface: true });
                    this._afficherErreurSurface(depassement);
                    return;
                }
                poly._cheminSurfaceValide = chemin.slice();
            }
            this._updateDimensionLabels(poly);
            this._updateRoofVisuals(poly);
            // Correctif 6 (bug rapporté : "le bouton de rotation reste en dehors du polygone après
            // l'avoir déplacé") : repositionné à CHAQUE changement de tracé, y compris pendant un
            // glissé du corps entier (pas seulement à la fin, cf. listener 'drag' ci-dessous et
            // dragend de la poignée elle-même).
            const handle = this._rotationHandlesByPolygon.get(poly.maisonId);
            if (handle) handle.setPosition(this._computeRotationHandleAnchor(poly));
            if (!isDragging && !this._suppressPathEvents) {
                this._persistPolygons();
                this._signalerContourModifie(poly);
            }
        };

        // CORRECTIF (bug rapporté : "modifier le sommet d'un rectangle continue à le transformer en
        // polygone" — régression du 1er correctif, qui réappliquait orthogonalizePath() ici : cet
        // algorithme est un redressement "en escalier" conçu pour un tracé à main levée INITIAL
        // (chaque sommet est projeté relativement au PRÉCÉDENT déjà redressé) — appliqué à un
        // rectangle à 4 sommets dont UN SEUL vient de bouger loin de sa position attendue, il peut
        // légitimement produire un sommet supplémentaire au lieu de refermer proprement en
        // rectangle. squareRectangleFromCorner() ci-dessous est l'algorithme adapté à CE cas précis :
        // le sommet opposé à celui déplacé (set_at fournit son index directement) reste une ancre
        // FIXE, les 2 axes du rectangle sont dérivés des arêtes ancre→voisins (inchangées par le
        // déplacement), les 2 sommets adjacents glissent chacun sur leur propre axe — toujours
        // exactement 4 sommets en sortie, jamais de coin en trop.
        const onSetAt = (index) => {
            if (poly.maisonMode !== 'polygon' && !isDragging && !this._suppressPathEvents) {
                const currentPath = poly.getPath().getArray();
                const squared = currentPath.length === 4
                    ? MaisonPolygonManager.squareRectangleFromCorner(currentPath, index)
                    : null;
                const straightened = squared || MaisonPolygonManager.orthogonalizePath(currentPath);
                this.setPolygonPath(poly, straightened, { silent: true });
                return; // setPolygonPath() a déjà fait cotations + persistance + poignée de rotation.
            }
            finishPathChanged();
        };

        // CORRECTIF (même demande) : un rectangle doit rester à EXACTEMENT 4 sommets — un sommet
        // ajouté (ex. double-clic sur une arête, fonctionnalité native de l'édition Google Maps) est
        // immédiatement retiré en mode rectangle, plutôt que de laisser le contour devenir un
        // pentagone. Mode 'polygon' : comportement inchangé (ajout de sommet autorisé).
        const onInsertAt = (index) => {
            if (poly.maisonMode !== 'polygon' && !isDragging && !this._suppressPathEvents) {
                this._suppressPathEvents = true;
                poly.getPath().removeAt(index);
                this._suppressPathEvents = false;
                finishPathChanged();
                return;
            }
            finishPathChanged();
        };
        google.maps.event.addListener(poly.getPath(), 'set_at', onSetAt);
        google.maps.event.addListener(poly.getPath(), 'insert_at', onInsertAt);

        // Correctif 6 (suite) : filet de sécurité complémentaire à onPathChanged ci-dessus — au cas
        // où un glissé du corps entier du polygone ne déclencherait pas systématiquement 'set_at'
        // (comportement non garanti par l'API selon les versions/optimisations internes) : l'évènement
        // 'drag', lui, est garanti pendant tout déplacement du corps (draggable:true), donc suffit à
        // lui seul à garder la poignée de rotation alignée sur le polygone en toutes circonstances.
        google.maps.event.addListener(poly, 'drag', () => {
            const handle = this._rotationHandlesByPolygon.get(poly.maisonId);
            if (handle) handle.setPosition(this._computeRotationHandleAnchor(poly));
        });

        // NOUVEAU (demande explicite : "ajouter un bouton de rotation sur le polygone, utiliser le
        // même bouton que celui utilisé pour la rotation du calepinage rectangulaire") : même icône/
        // taille/comportement que PostAxesManager (cf. poteaux.js), réimplémenté ici pour rester
        // découplé de DrawingControl (aucune dépendance croisée, cf. en-tête du fichier).
        this._ensureRotationHandle(poly);
    }

    /**
     * NOUVEAU : crée (ou repositionne) la poignée de rotation d'une maison — un google.maps.Marker
     * unique par maisonId, avec la même icône ("sync.svg") et la même taille (26x26) que la
     * poignée de rotation du calepinage rectangulaire (cf. poteaux.js::PostAxesManager.updateHandle),
     * positionnée au milieu du 1er côté du contour (même principe : milieu d'une arête, pas le
     * centroïde).
     * @param {google.maps.Polygon} poly
     */
    _ensureRotationHandle(poly) {
        const anchor = this._computeRotationHandleAnchor(poly);
        if (!anchor) return;

        let handle = this._rotationHandlesByPolygon.get(poly.maisonId);
        if (!handle) {
            handle = new google.maps.Marker({
                map: this.map,
                position: anchor,
                icon: {
                    url: '/static/concevoir_mon_projet/medias/icons/sync.svg',
                    scaledSize: new google.maps.Size(26, 26),
                    anchor: new google.maps.Point(13, 13)
                },
                title: 'Faire pivoter',
                draggable: true,
                cursor: 'grab',
                zIndex: 1050
            });
            this._rotationHandlesByPolygon.set(poly.maisonId, handle);
            this._attachRotationHandleDrag(poly, handle);
        } else {
            handle.setPosition(anchor);
        }
    }

    /**
     * NOUVEAU : milieu du 1er côté du contour (path[0]-path[1]) — même principe que
     * PostAxesManager.updateHandle (milieu d'une arête plutôt que le centroïde).
     * @param {google.maps.Polygon} poly
     * @returns {google.maps.LatLng|null}
     */
    _computeRotationHandleAnchor(poly) {
        const path = poly.getPath();
        if (path.getLength() < 2) return null;
        return google.maps.geometry.spherical.interpolate(path.getAt(0), path.getAt(1), 0.5);
    }

    /**
     * NOUVEAU : glisser-pivoter — même mécanique que LineToPolygon.js::_attachRotationHandleDrag
     * (calepinage rectangulaire), réimplémentée ici avec les fonctions de la librairie "geometry"
     * (computeHeading/computeDistanceBetween/computeOffset) plutôt que GeometryUtils.rotatePoint
     * (repère local en mètres propre au calepinage rectangulaire), pour rester autonome. Rotation
     * "live" bon marché pendant le glissé (mutation directe du path, sans recalcul de calepinage),
     * synchronisation complète (via setPolygonPath, qui déclenche déjà _updateDimensionLabels/
     * _notifyReady/_persistPolygons) une seule fois à la fin du glissé.
     * @param {google.maps.Polygon} poly
     * @param {google.maps.Marker} handle
     */
    _attachRotationHandleDrag(poly, handle) {
        let center = null;
        let lastHeading = 0;

        const rotatePathAround = (delta) => {
            const path = poly.getPath();
            for (let i = 0; i < path.getLength(); i++) {
                const pt = path.getAt(i);
                const dist = google.maps.geometry.spherical.computeDistanceBetween(center, pt);
                const heading = google.maps.geometry.spherical.computeHeading(center, pt);
                const newPt = google.maps.geometry.spherical.computeOffset(center, dist, heading + delta);
                path.setAt(i, newPt);
            }
        };

        handle.addListener('dragstart', () => {
            const bounds = new google.maps.LatLngBounds();
            poly.getPath().forEach((p) => bounds.extend(p));
            center = bounds.getCenter();
            lastHeading = google.maps.geometry.spherical.computeHeading(center, handle.getPosition());
        });

        handle.addListener('drag', (e) => {
            if (!center) return;
            const newHeading = google.maps.geometry.spherical.computeHeading(center, e.latLng);
            let delta = newHeading - lastHeading;
            if (delta > 180) delta -= 360;
            else if (delta < -180) delta += 360;
            lastHeading = newHeading;
            poly._rotationVisuelleEnCours = (poly._rotationVisuelleEnCours || 0) + delta;

            // Rotation "live" directe (pas setPolygonPath, trop coûteux à chaque évènement 'drag') :
            // suppression temporaire des écouteurs set_at/insert_at (comme setPolygonPath) pour ne
            // pas rouvrir le modal / persister à chaque micro-déplacement.
            this._suppressPathEvents = true;
            rotatePathAround(delta);
            this._suppressPathEvents = false;

            handle.setPosition(this._computeRotationHandleAnchor(poly));
            // Label + flèche tournent avec le contour pendant le geste.
            this._updateRoofVisuals(poly).catch(() => { /* visuels inchangés */ });
        });

        handle.addListener('dragend', () => {
            center = null;
            // Finalise proprement : recotation des étiquettes, persistance — même geste que toute
            // autre modification du tracé (cf. setPolygonPath). CORRECTIF (bug rapporté : "utiliser
            // la poignée de rotation ouvre le modal") : silent:true — la rotation se fait à même la
            // carte, modal fermé ; il ne doit pas s'ouvrir tout seul à la fin du geste.
            this.setPolygonPath(poly, poly.getPath().getArray(), { silent: true });
            handle.setPosition(this._computeRotationHandleAnchor(poly));
        });
    }

    /**
     * Fixe le mode de tracé d'un contour et le persiste immédiatement. Appelé par l'orchestrateur du
     * modal quand l'état sauvegardé de la maison (source de vérité côté utilisateur) contredit le
     * mode porté par le contour vivant — typiquement un contour revenu de la base sans son mode, ou
     * dont le mode a dû être déduit. Sans cette redescente, le contour restait un 'polygon' aux yeux
     * de l'éditeur : ses arêtes n'étaient plus contraintes à angle droit, et chaque réouverture du
     * modal dans la même session réimposait l'orientation plein sud au calepinage.
     * @param {google.maps.Polygon} poly
     * @param {'rect'|'polygon'} mode
     */
    setPolygonMode(poly, mode) {
        if (!poly || (mode !== 'rect' && mode !== 'polygon')) return;
        if (poly.maisonMode === mode) return;
        poly.maisonMode = mode;
        this._persistPolygons();
    }

    /**
     * NOUVEAU (bug rapporté : données perdues au rechargement) : sauvegarde la liste des contours
     * (maisonId + tracé géographique) — PAS le contenu du calepinage (pans/obstacles/équipements,
     * déjà géré séparément par calepinage_persistence.js sous la clé calepinage_maison_v1, indexée
     * par ce même maisonId). Les deux couches de persistance sont complémentaires : sans celle-ci,
     * il n'y avait tout simplement plus aucun contour sur la carte après un rechargement pour
     * rattacher les données déjà sauvegardées par l'autre couche.
     */
    _persistPolygons() {
        // Projet changé dans un autre onglet (cf. garde_projet_actif.js) : le cache partagé appartient
        // désormais à l'autre projet, ne pas l'écraser avec les contours affichés ici.
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) return;
        try {
            // NOUVEAU (collecte des parcelles cadastrales) : centre géométrique persisté ici avec le
            // tracé, pour que resuméParcelles.js puisse relire les contours de maisons au chargement
            // de page sans dépendre de google.maps.geometry (juste une LatLngBounds, déjà calculée
            // ici où le polygone existe réellement).
            const snapshot = this.polygons.map((p) => {
                const bounds = new google.maps.LatLngBounds();
                p.getPath().forEach((point) => bounds.extend(point));
                const center = bounds.getCenter();
                return {
                    maisonId: p.maisonId,
                    path: p.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
                    center: { lat: center.lat(), lng: center.lng() },
                    // NOUVEAU (demande explicite : "le contour rectangle doit toujours rester un
                    // rectangle") : persiste le mode de tracé pour qu'onPathChanged (édition future,
                    // y compris après un rechargement de page) sache s'il doit contraindre la forme.
                    mode: p.maisonMode || 'polygon',
                    // Type de structure imposé à la création (décalage de parcelles), tant que le
                    // calepinage du champ n'a pas encore été ouvert (cf. createPolygonFromLatLngs).
                    ...(p.typeMontageInitial ? { typeMontageInitial: p.typeMontageInitial } : {}),
                    // Parcelles cadastrales et recul d'origine d'un contour issu d'un décalage de
                    // parcelles (traçabilité : DP, dossier de plans).
                    ...(p.origineParcelles ? { origineParcelles: p.origineParcelles } : {}),
                    ...(p.reglagesInitiaux ? { reglagesInitiaux: p.reglagesInitiaux } : {}),
                };
            });
            localStorage.setItem(MaisonPolygonManager.STORAGE_KEY, JSON.stringify(snapshot));
            // CORRECTIF (bug rapporté : "fuite de données — les maisons d'un projet apparaissent
            // dans un autre projet") : calepinage_maison_polygons_v1 n'est pas scopé par projet:
            // on marque ici À QUEL projet appartient RÉELLEMENT ce contenu, pour que le script de
            // réconciliation de index.html puisse détecter un désaccord même quand current_projet_id
            // a déjà été basculé vers le nouveau projet AVANT le rechargement de page (ce qui rend le
            // test current_projet_id === active_projet_id systématiquement vrai et inefficace ici).
            const ownerProjetId = localStorage.getItem('current_projet_id');
            if (ownerProjetId) localStorage.setItem('calepinage_maison_owner_id', ownerProjetId);
        } catch (err) {
            console.warn('[MaisonPolygonManager] Persistance des contours impossible (quota ?).', err);
        }
    }

    /**
     * NOUVEAU : recrée silencieusement, au chargement de la page, les contours sauvegardés par
     * _persistPolygons() — sans redressement (déjà fait lors du 1er tracé) ni ouverture automatique
     * du modal (contrairement à un tracé qui vient de se terminer, cf. _initPolygon) : l'utilisateur
     * clique la bordure/une cotation pour rouvrir, comme pour tout contour existant. Appelée une
     * seule fois à la création de l'instance partagée (cf. bas de ce fichier).
     */
    restorePolygons() {
        let snapshot;
        try {
            const raw = localStorage.getItem(MaisonPolygonManager.STORAGE_KEY);
            snapshot = raw ? JSON.parse(raw) : [];
        } catch (err) {
            console.warn('[MaisonPolygonManager] Lecture des contours sauvegardés impossible.', err);
            return;
        }
        if (!Array.isArray(snapshot) || !snapshot.length) return;

        snapshot.forEach((entry) => {
            if (!entry || !entry.maisonId || !Array.isArray(entry.path) || entry.path.length < 3) return;
            const path = entry.path.map((pt) => new google.maps.LatLng(pt.lat, pt.lng));
            const poly = new google.maps.Polygon({
                paths: path,
                editable: true, draggable: true,
                ...MAISON_POLYGON_STYLE, zIndex: 5,
                map: this.map,
            });
            poly._rawPath = path.slice();
            poly.maisonId = entry.maisonId;
            // CORRECTIF (bug rapporté : calepinage désorganisé au retour sur un projet) : le repli
            // en cas de `mode` absent n'est plus 'polygon' en dur mais une DÉDUCTION GÉOMÉTRIQUE
            // (cf. inferModeFromPath). Le repli 'polygon' avait été choisi comme "le moins
            // destructeur", ce qu'il n'est pas : il fait perdre son orientation à un rectangle, dont
            // les panneaux sont alors reposés plein sud, en biais par rapport au contour. Le champ
            // `mode` est absent de TOUS les contours revenus de la base (elle ne le transportait
            // pas — cf. calepinage_maison_persistence_db.js, corrigé également), donc ce repli était
            // le cas NORMAL après un changement de projet, pas un cas de bord historique.
            poly.maisonMode = entry.mode || MaisonPolygonManager.inferModeFromPath(entry.path);
            if (entry.typeMontageInitial) poly.typeMontageInitial = entry.typeMontageInitial;
            if (entry.origineParcelles) poly.origineParcelles = entry.origineParcelles;
            if (entry.reglagesInitiaux) poly.reglagesInitiaux = entry.reglagesInitiaux;
            this._registerPolygon(poly);
            this._updateDimensionLabels(poly);
            this._updateRoofVisuals(poly);
        });
        // Traits rattachés aux contours (décalage de parcelles, cf. DecalageParcelles.js) à redessiner.
        document.dispatchEvent(new CustomEvent('maisonContoursRecharges'));
    }

    /**
     * Correctif 3 : retire un contour de la carte et de la liste, immédiatement (pas de confirmation —
     * la décision revient au modal appelant). Suppression asynchrone (setTimeout) : même précaution que
     * DrawingControl.js::deleteSelectedShape, un setMap(null) synchrone pendant le traitement de
     * l'événement qui l'a déclenché peut laisser un polygone "fantôme" affiché.
     * @param {google.maps.Polygon} poly
     */
    removePolygon(poly) {
        if (!poly) return;
        this.polygons = this.polygons.filter((p) => p !== poly);
        if (this.selected === poly) this.selected = null;
        // CORRECTIF (demande explicite : "l'actualisation [du sélecteur de maison / filtre PV1, PV2…]
        // doit être automatique en cas de suppression") : cette suppression peut venir directement de
        // la carte (ex. DrawingControl.js::deleteSelectedShape), sans jamais passer par le modal de
        // calepinage résidentiel — jusqu'ici, rien ne prévenait calepinage_maison_orchestrateur.js
        // (knownSources / #calepinageMaisonSourceSelect restaient donc figés sur l'ancien contenu,
        // affichant encore le PVn supprimé). removeSourceOption() est idempotente et sans effet si ce
        // sourceId n'était de toute façon pas connu (ex. maison jamais ouverte cette session).
        if (window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.removeSourceOption === 'function') {
            window.CalepinageMaisonIndiv.removeSourceOption(poly.maisonId);
        }
        // CORRECTIF (bug rapporté : "je supprime PV1, la prochaine maison créée prend PV2 au lieu de
        // réutiliser PV1") : _initPolygon()/_registerPolygon() réservent le numéro dans le pool
        // partagé (drawingControl.usedIds) à la création, mais rien ne le libérait jamais à la
        // suppression — même correctif déjà en place côté calepinage grands-projets, cf.
        // DrawingControl.js::deleteSelectedShape ("5. Nettoyage des données (IDs...)").
        if (window.drawingControl && window.drawingControl.usedIds) {
            window.drawingControl.usedIds.delete(poly.maisonId);
        }
        this._removeDimensionLabels(poly);
        this._removeRoofVisuals(poly);
        // NOUVEAU (unification du calepinage) : un champ PV de la carte = un onglet du formulaire
        // PRO / Grand projet (cf. TabsManager.synchroniserOngletsAvecChampsMaison). Pendant du
        // 'maisonShapeAdded' emis a la creation, sans quoi l'onglet survivrait au contour supprime.
        document.dispatchEvent(new CustomEvent('maisonShapeRemoved', { detail: { pvId: poly.maisonId } }));
        // NOUVEAU : retire aussi la poignée de rotation (cf. _ensureRotationHandle), sinon elle
        // restait affichée sur la carte, orpheline, après suppression du contour.
        const handle = this._rotationHandlesByPolygon.get(poly.maisonId);
        if (handle) {
            handle.setMap(null);
            this._rotationHandlesByPolygon.delete(poly.maisonId);
        }
        poly.setEditable(false);
        poly.setDraggable(false);
        this._persistPolygons();
        // Demande explicite : pas de trou dans la numérotation (PV1, PV2, PV3… après suppression de PV2).
        // Différé : l'appelant (ex. bouton « Supprimer le polygone » du modal) finit d'abord son propre
        // nettoyage sous l'ANCIEN numéro ; il peut aussi lancer la renumérotation lui-même, sans effet
        // double (une 2e passe ne trouve plus rien à renommer).
        setTimeout(() => {
            const CM = window.CalepinageMaisonIndiv;
            if (CM && typeof CM.renumeroterChampsPV === 'function') {
                try { CM.renumeroterChampsPV(); } catch (e) { console.warn('[MaisonPolygonManager] Renumérotation des champs PV impossible', e); }
            }
        }, 0);
        setTimeout(() => {
            google.maps.event.clearInstanceListeners(poly.getPath());
            google.maps.event.clearInstanceListeners(poly);
            poly.setMap(null);
        }, 50);
    }

    /**
     * CORRECTIF (bug rapporté : "fuite de données — les maisons d'un projet apparaissent dans un
     * autre projet") : retire de la carte TOUS les contours actuellement chargés, sans toucher au
     * localStorage (contrairement à removePolygon(), appelée en boucle ici sans persistance
     * intermédiaire — l'appelant vide/recharge lui-même calepinage_maison_polygons_v1/
     * calepinage_maison_v1 juste après, cf. selectAndLoadProject()). Nécessaire avant de recharger
     * les données du nouveau projet actif SANS rechargement de page complet : sans cet appel, les
     * contours de l'ANCIEN projet restaient affichés sur la carte (this.polygons n'étant vidé qu'en
     * mémoire par restorePolygons(), qui ne fait qu'AJOUTER, jamais remplacer).
     */
    clearAllPolygons() {
        [...this.polygons].forEach((poly) => {
            this.polygons = this.polygons.filter((p) => p !== poly);
            if (this.selected === poly) this.selected = null;
            if (window.drawingControl && window.drawingControl.usedIds) {
                window.drawingControl.usedIds.delete(poly.maisonId);
            }
            this._removeDimensionLabels(poly);
            // Étiquette PVn, flèche et bouton de configuration : sans ce retrait, ceux d'un champ
            // absent du projet suivant (ex. PV2) restaient affichés sur la carte, et ceux d'un champ
            // homonyme étaient réutilisés avec l'orientation de l'ancien projet.
            this._removeRoofVisuals(poly);
            const handle = this._rotationHandlesByPolygon.get(poly.maisonId);
            if (handle) {
                handle.setMap(null);
                this._rotationHandlesByPolygon.delete(poly.maisonId);
            }
            google.maps.event.clearInstanceListeners(poly.getPath());
            google.maps.event.clearInstanceListeners(poly);
            poly.setMap(null);
        });
        // Traits rattachés aux contours (décalage de parcelles, cf. DecalageParcelles.js) à retirer aussi.
        document.dispatchEvent(new CustomEvent('maisonContoursRecharges'));
    }

    /**
     * Correctif 4 : remplace le contour d'un polygone existant EN PLACE (mutation du MVCArray via
     * clear()+push(), jamais poly.setPath(nouveauTableau) — setPath remplacerait l'instance du MVCArray
     * et détruirait silencieusement les listeners set_at/insert_at déjà attachés dessus, cassant
     * l'édition à la souris sur la carte pour ce polygone après le 1er passage par cette méthode).
     * @param {google.maps.Polygon} poly
     * @param {google.maps.LatLng[]} newLatLngArray
     * @param {{silent?: boolean}} [options] - silent:true n'appelle PAS _notifyReady() (n'ouvre/ne
     *   rafraîchit pas le modal) — cf. dragend de la poignée de rotation ci-dessus : rotation faite
     *   à même la carte, modal fermé, il ne doit pas s'ouvrir tout seul à la fin du geste (bug
     *   rapporté : "utiliser la poignée de rotation ouvre le modal"). Les autres appelants
     *   (édition de cotes, bascule Monopente) s'exécutent déjà DEPUIS le modal ouvert sur cette
     *   maison — le rafraîchir n'y change donc rien d'observable, comportement par défaut inchangé.
     */
    setPolygonPath(poly, newLatLngArray, options) {
        const path = poly.getPath();
        // Copie défensive : MVCArray.getArray() renvoie une référence LIVE sur le tableau interne
        // (pas une copie) — si l'appelant passe poly.getPath().getArray() (cf. dragend de rotation
        // ci-dessus), path.clear() viderait ce même tableau avant qu'on ait pu le relire, laissant
        // le polygone sans aucun point.
        let snapshot = newLatLngArray.slice();
        // Filet de surface maximale (redressement du rectangle après édition d'un sommet, appelants
        // externes) : un contour trop grand est remplacé par le dernier contour admis.
        if (!(options && options.sansControleSurface)) {
            const depassement = this._depassementSurfacePoly(poly, snapshot, poly.maisonMode);
            if (depassement && poly._cheminSurfaceValide) {
                snapshot = poly._cheminSurfaceValide.slice();
                this._afficherErreurSurface(depassement);
            }
        }
        poly._cheminSurfaceValide = snapshot.slice();
        this._suppressPathEvents = true;
        path.clear();
        snapshot.forEach((ll) => path.push(ll));
        this._suppressPathEvents = false;
        this._updateDimensionLabels(poly);
        this._updateRoofVisuals(poly);
        if (!options || !options.silent) {
            this._notifyReady(poly);
        }
        this._persistPolygons();
        this._signalerContourModifie(poly);
    }

    /**
     * Contour modifié sur la carte (déplacé, pivoté, sommet/arête retouché) : le calepinage du champ PV
     * suit sans rouvrir le modal — panneaux recalculés et redessinés, totaux mis à jour (cf.
     * calepinage_maison_orchestrateur.js::resynchroniserChampSurContour). Regroupé par champ sur un
     * court délai : un geste émet plusieurs évènements (set_at + redressement du rectangle, etc.).
     * @param {google.maps.Polygon} poly
     */
    _signalerContourModifie(poly) {
        if (!poly || !poly.maisonId) return;
        if (!this._resyncTimers) this._resyncTimers = new Map();
        clearTimeout(this._resyncTimers.get(poly.maisonId));
        this._resyncTimers.set(poly.maisonId, setTimeout(() => {
            this._resyncTimers.delete(poly.maisonId);
            if (!this.polygons.includes(poly)) return; // contour supprimé entre-temps
            // Fin de la rotation "live" du label/flèche (cf. _attachRotationHandleDrag) : à partir
            // d'ici, l'azimut du pan recalculé par la resynchronisation fait foi.
            poly._rotationVisuelleEnCours = 0;
            const CM = window.CalepinageMaisonIndiv;
            if (CM && typeof CM.resynchroniserChampSurContour === 'function') {
                try {
                    CM.resynchroniserChampSurContour(poly.maisonId);
                } catch (e) {
                    console.warn('[MaisonPolygonManager] Mise à jour du calepinage après modification du contour impossible', e);
                }
            }
            // Bug rapporté : "le label et la flèche ne suivent pas la rotation" — la resynchronisation
            // met à jour pan.azimuth sans émettre d'évènement quand le modal est fermé : redessin explicite.
            this._updateRoofVisuals(poly).catch(() => { /* visuels inchangés */ });
        }, 200));
    }

    /**
     * Correctif 2 : importe (et met en cache) la bibliothèque "marker" (AdvancedMarkerElement),
     * nécessaire pour les étiquettes de cotation posées sur la carte.
     */
    _ensureMarkerLibrary() {
        if (!this._markerLibraryPromise) {
            this._markerLibraryPromise = google.maps.importLibrary('marker');
        }
        return this._markerLibraryPromise;
    }

    /**
     * Correctif 2 : crée/actualise une étiquette "X.XX m" au milieu de chaque arête du contour, en
     * réutilisant les marqueurs déjà posés pour ce polygone (indexés par position d'arête) — évite de
     * détruire/recréer des AdvancedMarkerElement à chaque glissé de sommet. Retire les étiquettes
     * devenues surnuméraires si le contour a perdu des sommets.
     * @param {google.maps.Polygon} poly
     */
    async _updateDimensionLabels(poly) {
        const { AdvancedMarkerElement } = await this._ensureMarkerLibrary();
        const points = poly.getPath().getArray();
        const n = points.length;

        let markers = this._dimensionLabelMarkersByPolygon.get(poly.maisonId);
        if (!markers) {
            markers = [];
            this._dimensionLabelMarkersByPolygon.set(poly.maisonId, markers);
        }

        // Demande explicite : toutes les cotations (longueur ET largeur) parallèles à leur arête et
        // posées à l'extérieur du contour. Côté extérieur déduit du sens de parcours (aire signée en
        // repère Est/Nord) plutôt que du centroïde, pour rester juste sur un polygone concave : sens
        // trigonométrique -> l'extérieur est à droite de l'arête (cap + 90°), sinon à gauche.
        let aireSignee = 0;
        for (let i = 0; i < n; i++) {
            const p = points[i], q = points[(i + 1) % n];
            aireSignee += p.lng() * q.lat() - q.lng() * p.lat();
        }
        const capVersExterieur = aireSignee > 0 ? 90 : -90;
        // Écart (px) entre l'arête et l'axe de l'étiquette : demi-hauteur de l'étiquette + marge.
        // Le bouton vert de configuration est posé au coin supérieur droit (cf. _updateSettingsButton) :
        // toutes les cotations restent donc au milieu de leur arête.
        const ECART_EXTERIEUR_PX = 14;

        for (let i = 0; i < n; i++) {
            const a = points[i];
            const b = points[(i + 1) % n];
            const distance = google.maps.geometry.spherical.computeDistanceBetween(a, b);
            const heading = google.maps.geometry.spherical.computeHeading(a, b);
            const mid = google.maps.geometry.spherical.interpolate(a, b, 0.5);
            const rotation = MaisonPolygonManager._normalizeHeadingForLabel(heading);

            // Décalage écran (x vers la droite, y vers le bas) d'un cap compas c : (sin c, -cos c).
            const rad = (deg) => deg * Math.PI / 180;
            const capExt = rad(heading + capVersExterieur);
            const dx = Math.sin(capExt) * ECART_EXTERIEUR_PX;
            const dy = -Math.cos(capExt) * ECART_EXTERIEUR_PX;

            const content = document.createElement('div');
            // NOUVEAU (demande explicite) : une cotation cliquée ouvre aussi le modal — pointer-events
            // réactivé (était 'none') et un curseur pointer pour l'affordance ; cf. addEventListener
            // 'click' ci-dessous.
            // Transformation lue de droite à gauche : rotation autour du centre de l'étiquette,
            // translateY(50%) pour centrer l'étiquette sur le milieu de l'arête (un
            // AdvancedMarkerElement est ancré en bas au centre), puis décalage vers l'extérieur.
            content.style.cssText = `background: rgba(29, 78, 216, 0.9); color: #fff; font-size: 11px;
                font-weight: 600; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
                pointer-events: auto; cursor: pointer;
                transform: translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) translateY(50%) rotate(${rotation}deg);`;
            content.textContent = `${distance.toFixed(2)} m`;
            content.addEventListener('click', () => this._notifyReady(poly));

            const existing = markers[i];
            if (existing) {
                existing.position = mid;
                existing.content = content;
            } else {
                markers[i] = new AdvancedMarkerElement({ map: this.map, position: mid, content, zIndex: 6 });
            }
        }

        while (markers.length > n) {
            const extra = markers.pop();
            if (extra) extra.map = null;
        }
    }

    /**
     * État du champ PV dans le module résidentiel (pans, azimut, type de structure...), ou null.
     * Lu à la demande : les visuels sont redessinés à chaque changement de contour ou de calepinage,
     * et CM.state porte les modifications en cours du champ affiché.
     */
    static _etatDuChamp(maisonId) {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM) return null;
        if (CM.state && CM.state.sourceId === maisonId) return CM.state;
        if (typeof CM.getHouseStateById === 'function') {
            try { return CM.getHouseStateById(maisonId); } catch (e) { return null; }
        }
        return null;
    }

    /**
     * Types de structure dotés d'un configurateur de géométrie, donc du bouton vert sur le contour :
     * ombrières métal, bois et Solumbra, et petit champ solaire (demande explicite : même bouton,
     * même style que pour les ombrières ; il ouvre le configurateur « Petit champ solaire » via
     * STRUCTURE_MODAL_MAPPING, cf. geometrieModal.js).
     */
    static _aUnConfigurateur(state) {
        const CM = window.CalepinageMaisonIndiv;
        if (!state || !CM) return false;
        const tm = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage;
        return tm === 'ombriere_metal' || tm === 'ombriere_bois' || tm === 'ombriere_solumbra'
            || tm === 'champ_solaire';
    }

    /**
     * NOUVEAU (demande explicite : "faire apparaître les labels et flèches sur les champs PV qui
     * sont dessinés sur la carte Google") : étiquette "PVn" + flèche d'azimut au centre du contour,
     * exactement comme le calepinage "grands projets" (cf. Polygon.js::updateRoofVisuals) — même
     * markup, même rotation, même icône arrow.svg. L'azimut vient du 1er pan du champ (référentiel
     * PVGIS, Sud = 0°), c'est-à-dire l'orientation RÉELLE des panneaux posés.
     *
     * Pose aussi, pour une ombrière ou un petit champ solaire, le bouton de configuration de la géométrie (cf.
     * _updateSettingsButton).
     * @param {google.maps.Polygon} poly
     */
    async _updateRoofVisuals(poly) {
        const { AdvancedMarkerElement } = await this._ensureMarkerLibrary();
        if (!this.polygons.includes(poly)) return; // contour supprimé pendant le chargement

        const path = poly.getPath().getArray();
        if (path.length < 3) return;
        const bounds = new google.maps.LatLngBounds();
        path.forEach((p) => bounds.extend(p));
        const centre = bounds.getCenter();

        const state = MaisonPolygonManager._etatDuChamp(poly.maisonId);
        const pan = state && Array.isArray(state.pans) ? state.pans[0] : null;
        // Pendant un glissé de la poignée de rotation, l'état n'est pas encore resynchronisé : la
        // rotation cumulée du geste (cap compas, sens horaire = azimut croissant) est ajoutée.
        const azimutEtat = (pan && typeof pan.azimuth === 'number' ? pan.azimuth : 0)
            + (poly._rotationVisuelleEnCours || 0);
        // Bug rapporté : "la flèche n'est pas parallèle aux panneaux, y compris le label" — en mode
        // rectangle, label et flèche sont calés sur la géométrie du contour (perpendiculaires au côté
        // le plus proche de l'azimut de l'état), donc toujours parallèles à la largeur du toit.
        const azimut = poly.maisonMode !== 'polygon'
            ? MaisonPolygonManager._azimutCaleSurLesCotes(path, azimutEtat)
            : azimutEtat;

        const conteneur = document.createElement('div');
        conteneur.style.cssText = 'position:absolute; display:flex; align-items:center;'
            + ' justify-content:center; pointer-events:none; overflow:visible;';

        const etiquette = document.createElement('div');
        etiquette.style.cssText = 'background-color:white; border:1px solid #1A73E8; color:#333;'
            + ' position:absolute; padding:2px 6px; border-radius:4px; font-weight:bold;'
            + ' font-size:12px; box-shadow:0 1px 3px rgba(0,0,0,0.3); z-index:1010;'
            + ` white-space:nowrap; transform:translate(-50%, -50%) rotate(${azimut}deg) translateY(-18px);`;
        etiquette.textContent = poly.maisonId;

        const fleche = document.createElement('div');
        fleche.style.cssText = 'position:absolute; transform-origin:center center;'
            + ` transform:translate(-50%, -50%) rotate(${azimut}deg) translateY(18px);`
            + ' width:30px; height:30px; display:flex; align-items:center; justify-content:center;';
        fleche.innerHTML = '<img src="/static/concevoir_mon_projet/medias/icons/arrow.svg"'
            + ' style="width:100%; height:100%; opacity:0.8;" alt="Azimut des panneaux">';

        conteneur.appendChild(etiquette);
        conteneur.appendChild(fleche);
        const carteOrientation = MaisonPolygonManager._carteOrientation(state, azimut);
        if (carteOrientation) conteneur.appendChild(carteOrientation);

        const existant = this._roofVisualsByPolygon.get(poly.maisonId);
        if (existant) {
            existant.position = centre;
            existant.content = conteneur;
        } else {
            this._roofVisualsByPolygon.set(poly.maisonId, new AdvancedMarkerElement({
                map: this._roofVisualsVisible ? this.map : null,
                position: centre, content: conteneur, zIndex: 10000,
            }));
        }

        await this._updateSettingsButton(poly, state);
    }

    /**
     * 2026-10-09 (demande explicite : "afficher sur chaque champ PV de la carte Google la petite
     * carte pente / azimut, comme dans le calepinage du canevas, à droite du label n° PV et de la
     * flèche") : même contenu et même style que drawOrientationCard (calepinage_maison_dessin.js) —
     * bulle blanche, bordure #1A73E8, "Incl : x°" / "Azim : y°" — mais en HTML, le canevas n'étant
     * pas réutilisable sur la carte. Un champ à plusieurs pans a une ligne par pan.
     * Positionnée dans le repère tourné de l'étiquette et de la flèche (elle les longe quelle que soit
     * l'orientation), texte retourné au-delà de ±90° pour ne jamais être lu à l'envers.
     * Redessinée avec le label (calepinageMaisonEtatRecalcule / calepinageMaisonFieldChanged), donc
     * à jour à chaque changement de pente ou d'azimut.
     * @param {Object|null} state état du champ (cf. _etatDuChamp)
     * @param {number} azimut rotation appliquée à l'étiquette et à la flèche (degrés)
     * @returns {HTMLElement|null}
     */
    static _carteOrientation(state, azimut) {
        const CM = window.CalepinageMaisonIndiv;
        const pans = state && Array.isArray(state.pans) ? state.pans.filter(Boolean) : [];
        if (!pans.length) return null;
        const arrondi = (v) => Math.round((Number(v) || 0) * 10) / 10;
        const incl = (pan) => arrondi(CM && typeof CM.getEffectiveInclinaisonDeg === 'function'
            ? CM.getEffectiveInclinaisonDeg(pan, state) : state.penteDeg);
        const lignes = pans.length === 1
            ? [`Incl : ${incl(pans[0])}°`, `Azim : ${arrondi(pans[0].azimuth)}°`]
            : pans.map((pan) => `${pan.id || ''} : ${incl(pan)}° / ${arrondi(pan.azimuth)}°`);

        const rad = (azimut * Math.PI) / 180;
        const retourner = Math.cos(rad) < 0 ? ' translate(50%, 50%) rotate(180deg) translate(-50%, -50%)' : '';
        const carte = document.createElement('div');
        carte.className = 'map-pv-orientation-card';
        // Origine du repère = point d'ancrage du marqueur (centre de l'étiquette et de la flèche) :
        // le bord gauche de la carte est posé 30 px à droite de cet axe, centré verticalement.
        carte.style.cssText = 'background-color:white; border:1px solid #1A73E8; color:#333;'
            + ' position:absolute; left:0; top:0; padding:4px 6px; border-radius:4px; font-weight:bold;'
            + ' font-size:11px; line-height:14px; box-shadow:0 1px 3px rgba(0,0,0,0.3); z-index:1010;'
            + ' white-space:nowrap; transform-origin:0 0;'
            + ` transform:rotate(${azimut}deg) translate(30px, -50%)${retourner};`;
        lignes.forEach((texte) => {
            const ligne = document.createElement('div');
            ligne.textContent = texte;
            carte.appendChild(ligne);
        });
        return carte;
    }

    /**
     * NOUVEAU (demande explicite : "dans l'ancien calepinage rectangulaire, il y a un bouton placé
     * sur la longueur du rectangle qui ouvre le modal géométrie ; le placer sur la LARGEUR du
     * rectangle dessiné sur la carte, pour Type de structure = Ombrière métal, bois et Solumbra").
     *
     * Même bouton et même action que le calepinage "grands projets"
     * (MeasurementControl.createOrUpdateSettingsLabel) : il délègue au bouton "Configurer la
     * Géométrie" de l'onglet du champ PV, seul endroit qui sait quel configurateur ouvrir
     * (cf. geometrieModal.js). Cet onglet existe pour tout champ PV de la carte depuis l'unification
     * (cf. TabsManager.synchroniserOngletsAvecChampsMaison).
     *
     * Position : coin supérieur droit du contour (demande explicite, pour libérer le milieu des
     * arêtes aux cotations), cf. _coinSuperieurDroit.
     * @param {google.maps.Polygon} poly
     * @param {Object|null} state
     */
    async _updateSettingsButton(poly, state) {
        const { AdvancedMarkerElement } = await this._ensureMarkerLibrary();
        const existant = this._settingsButtonsByPolygon.get(poly.maisonId);

        if (!MaisonPolygonManager._aUnConfigurateur(state)) {
            if (existant) { existant.map = null; this._settingsButtonsByPolygon.delete(poly.maisonId); }
            return;
        }

        const points = poly.getPath().getArray();
        const n = points.length;
        if (n < 3) return;
        const position = MaisonPolygonManager._coinSuperieurDroit(points);

        if (existant) { existant.position = position; return; }

        const div = document.createElement('div');
        // Demande explicite : bouton centré SUR le coin (à cheval sur le contour), pas en dehors.
        // Un AdvancedMarkerElement est ancré en bas au centre : translateY(50%) ramène son centre
        // sur le sommet.
        div.style.cssText = 'display:inline-flex; align-items:center; justify-content:center;'
            + ' transform-origin:center; z-index:1020; transform:translateY(50%);';
        div.innerHTML = '<button type="button" class="map-pv-settings-btn"'
            + ' title="Configuration de la géométrie" style="background:#28a745; border:2px solid #1e7e34;'
            + ' padding:4px; border-radius:6px; cursor:pointer; display:flex; align-items:center;'
            + ' justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.4); pointer-events:auto;'
            + ' outline:none; transition:transform 0.2s;">'
            + '<img src="/static/concevoir_mon_projet/medias/icons/solar-panel.svg"'
            + ' style="width:24px; height:24px; pointer-events:none; filter:brightness(0) invert(1);"'
            + ' alt="Configurer la geometrie"></button>';

        const btn = div.querySelector('button');
        // Isole le bouton de l'édition du contour sous-jacent (mêmes événements que
        // MeasurementControl.createOrUpdateSettingsLabel).
        ['mousedown', 'mouseup', 'dblclick', 'touchstart', 'touchend', 'pointerdown', 'pointerup']
            .forEach((evt) => btn.addEventListener(evt, (e) => e.stopPropagation()));
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cible = document.getElementById(`btn-open-geometrie-modal-${poly.maisonId}`)
                || document.getElementById('btn-open-geometrie-modal');
            if (cible) {
                cible.click();
            } else {
                console.warn(`[MaisonPolygonManager] Onglet du champ ${poly.maisonId} introuvable : `
                    + 'configuration de la geometrie impossible a ouvrir.');
            }
        });

        this._settingsButtonsByPolygon.set(poly.maisonId, new AdvancedMarkerElement({
            map: this._roofVisualsVisible ? this.map : null,
            position, content: div, collisionBehavior: 'REQUIRED', zIndex: 1020,
        }));
    }

    /**
     * Azimut (référentiel PVGIS, Sud = 0°) de la normale à un côté du contour la plus proche de
     * azimutRef. Le résultat reste dans la continuité de azimutRef (azimutRef + écart), pour que la
     * rotation CSS ne fasse jamais un tour complet.
     * @param {google.maps.LatLng[]} points
     * @param {number} azimutRef
     * @returns {number}
     */
    static _azimutCaleSurLesCotes(points, azimutRef) {
        const n = points.length;
        const normaliser = (d) => ((d + 180) % 360 + 360) % 360 - 180;
        let meilleurEcart = null;
        for (let i = 0; i < n; i++) {
            const a = points[i], b = points[(i + 1) % n];
            if (google.maps.geometry.spherical.computeDistanceBetween(a, b) < 0.05) continue;
            const cap = google.maps.geometry.spherical.computeHeading(a, b);
            [cap + 90, cap - 90].forEach((normale) => {
                const ecart = normaliser((normale - 180) - azimutRef); // cap compas -> azimut
                if (meilleurEcart === null || Math.abs(ecart) < Math.abs(meilleurEcart)) meilleurEcart = ecart;
            });
        }
        return meilleurEcart === null ? azimutRef : azimutRef + meilleurEcart;
    }

    /**
     * Sommet du contour le plus en haut à droite à l'écran (carte orientée Nord en haut) : celui qui
     * maximise Nord + Est, en mètres (longitude pondérée par cos(latitude)).
     * @param {google.maps.LatLng[]} points
     * @returns {google.maps.LatLng}
     */
    static _coinSuperieurDroit(points) {
        const cosLat = Math.cos(points[0].lat() * Math.PI / 180);
        let meilleur = points[0];
        let meilleurScore = -Infinity;
        points.forEach((p) => {
            const score = p.lat() + p.lng() * cosLat;
            if (score > meilleurScore) { meilleurScore = score; meilleur = p; }
        });
        return meilleur;
    }

    /** Retire label, flèche et bouton de configuration d'un contour (appelé par removePolygon). */
    _removeRoofVisuals(poly) {
        [this._roofVisualsByPolygon, this._settingsButtonsByPolygon].forEach((registre) => {
            const marqueur = registre.get(poly.maisonId);
            if (marqueur) { marqueur.map = null; registre.delete(poly.maisonId); }
        });
    }

    /**
     * Bascule l'affichage des labels/flèches/boutons de TOUS les champs PV — pendant de
     * setAllDimensionLabelsVisible (captures d'écran), et pendant de Polygon.setLabelsVisibility
     * côté "grands projets".
     * @param {boolean} visible
     */
    setAllRoofVisualsVisible(visible) {
        this._roofVisualsVisible = !!visible;
        [this._roofVisualsByPolygon, this._settingsButtonsByPolygon].forEach((registre) => {
            registre.forEach((m) => { if (m) m.map = visible ? this.map : null; });
        });
    }

    /**
     * Masque (ou réaffiche) les contours de TOUS les champs PV — remplissage, trait, sommets éditables
     * — et leurs poignées de rotation, sans les détacher de la carte. Utilisé autour de la capture de
     * fond du calepinage (demande explicite : « masquer le rectangle ou polygone lors de la capture,
     * il apparaît sur le toit en 3D ») : le contour est déjà redessiné par le canevas, et la capture
     * sert aussi de texture photo des toits.
     * @param {boolean} visible
     * @returns {function} rétablit l'état d'avant (seuls les éléments qui étaient visibles)
     */
    setAllPolygonsVisible(visible) {
        const touches = [];
        const basculer = (o) => {
            if (!o || typeof o.setVisible !== 'function') return;
            const avant = typeof o.getVisible === 'function' ? o.getVisible() !== false : true;
            if (avant === !!visible) return;
            o.setVisible(!!visible);
            touches.push(o);
        };
        this.polygons.forEach(basculer);
        this._rotationHandlesByPolygon.forEach(basculer);
        return () => touches.forEach((o) => o.setVisible(!visible));
    }

    /**
     * Correctif 2/3 : retire toutes les étiquettes de cotation d'un polygone (appelé par removePolygon).
     * @param {google.maps.Polygon} poly
     */
    _removeDimensionLabels(poly) {
        const markers = this._dimensionLabelMarkersByPolygon.get(poly.maisonId);
        if (!markers) return;
        markers.forEach((m) => { if (m) m.map = null; });
        this._dimensionLabelMarkersByPolygon.delete(poly.maisonId);
    }

    /**
     * NOUVEAU (bug rapporté : "les cotations du polygone s'affichent de manière trouble sur la
     * capture d'écran") : détache (ou rattache) temporairement TOUTES les étiquettes de cotation de
     * TOUTES les maisons de la carte, sans les supprimer (contrairement à _removeDimensionLabels
     * ci-dessus, purement destructif) — les entrées restent dans _dimensionLabelMarkersByPolygon,
     * seul leur `.map` change. Appelée par calepinage_maison_dessin.js autour de chaque capture
     * html2canvas(mapElement, ...) (captureMapView/exportCanvasEtCartePdf), pour que ces étiquettes
     * (rendues avec une rotation CSS que html2canvas restitue mal) ne polluent jamais une capture.
     * @param {boolean} visible
     */
    setAllDimensionLabelsVisible(visible) {
        this._dimensionLabelMarkersByPolygon.forEach((markers) => {
            markers.forEach((m) => { if (m) m.map = visible ? this.map : null; });
        });
    }

    /**
     * Correctif 2 : ramène l'angle d'une étiquette dans [-90, 90] (aligné le long de l'arête, jamais
     * affiché "à l'envers"). heading = cap compas standard (Nord=0°) du segment a->b.
     * @param {number} heading
     * @returns {number}
     */
    static _normalizeHeadingForLabel(heading) {
        let angle = heading - 90;
        while (angle > 90) angle -= 180;
        while (angle < -90) angle += 180;
        return angle;
    }

    /** Vrai si un tracé est en cours sur la carte (rectangle 3 points ou moteur Terra Draw actif). */
    _traceEnCoursSurCarte() {
        if (this._rectDrawClickListener) return true;
        const engine = window.drawingControl && window.drawingControl.terraDrawEngine;
        return !!(engine && engine.isActive);
    }

    /** Met en évidence le champ PV `maisonId` sur la carte (et uniquement lui). */
    mettreEnEvidence(maisonId) {
        this.polygons.forEach((p) => {
            const estSelection = p.maisonId === maisonId;
            p.setOptions(estSelection ? { ...MAISON_POLYGON_STYLE, ...MAISON_POLYGON_STYLE_SELECTION, zIndex: 6 }
                : { ...MAISON_POLYGON_STYLE, zIndex: 5 });
            if (estSelection) this.selected = p;
        });
    }

    /**
     * Clic sur un champ PV de la carte : sélection, activation de son onglet dans le formulaire
     * PRO / Grand projet, zoom dessus — et bascule du calepinage s'il est ouvert.
     *
     * NOUVEAU (demande explicite : "lorsqu'on clique sur un champ PV sur la carte, cela doit
     * automatiquement sélectionner le champ PV dans le formulaire Grand projet / PRO et appliquer un
     * zoom dessus"). L'événement SHAPE_SELECTED est celui que TabsManager écoute déjà pour activer
     * un onglet ; il est volontairement préféré à un appel direct à `activateTab(pvId, true)`, qui
     * réémettrait CENTER_ON_SHAPE et relancerait un second cadrage par-dessus celui-ci.
     */
    selectionnerParClic(poly) {
        if (window.drawingControl && typeof window.drawingControl.clearSelection === 'function') {
            window.drawingControl.clearSelection(); // une seule sélection sur la carte
        }
        this.mettreEnEvidence(poly.maisonId);
        this.selectionActive = true;
        document.dispatchEvent(new CustomEvent('shapeSelected', { detail: { pvId: poly.maisonId } }));
        this.zoomerSurChamp(poly.maisonId);
        const cm = window.CalepinageMaisonIndiv;
        const calepinageOuvert = !!(cm && cm.modal && cm.modal.style.display !== 'none');
        if (calepinageOuvert && cm.state && cm.state.sourceId !== poly.maisonId) {
            this._notifyReady(poly);
        }
    }

    /**
     * Cadre la carte sur un champ PV (contour entier visible, petit padding). Mêmes réglages que
     * `ShapeHandler.centerOnShape` du calepinage "grands projets" — padding de 50 px et plafond de
     * zoom à 20 — pour que les deux familles de formes se comportent identiquement.
     * @param {string} maisonId
     * @returns {boolean} false si ce champ PV n'est pas (ou plus) sur la carte.
     */
    zoomerSurChamp(maisonId) {
        const poly = this.polygons.find((p) => p.maisonId === maisonId);
        if (!poly || !this.map) return false;
        const bounds = new google.maps.LatLngBounds();
        poly.getPath().forEach((point) => bounds.extend(point));
        this.map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
        // fitBounds sur un petit contour pousse le zoom au maximum : on le plafonne, une fois le
        // recadrage appliqué (fitBounds est asynchrone côté rendu).
        setTimeout(() => {
            if (this.map.getZoom() > 20) this.map.setZoom(20);
        }, 100);
        return true;
    }

    _notifyReady(poly) {
        const azimuths = MaisonPolygonManager.computeSegmentAzimuths(poly.getPath().getArray());
        if (typeof this.onPolygonReady === 'function') {
            this.onPolygonReady(poly, azimuths);
        }
    }

    /**
     * Calcule l'azimut de chaque segment du contour, dans le référentiel Sud=0°/Ouest=+90°/Est=-90°/
     * Nord=±180° — même convention que le calepinage en shed (cf. Polygon.js::updateRoofVisuals) :
     * cap compas standard (computeHeading, Nord=0°, sens horaire) converti via un décalage de -180°.
     * @param {google.maps.LatLng[]} points
     * @returns {number[]} un azimut par segment, dans l'ordre du tracé (segment i = points[i] -> points[i+1])
     */
    /**
     * NOUVEAU (tracé rectangle à 3 points, cf. startRect3PointDraw ci-dessus) : porté à l'identique
     * de DrawingControl/shapes/solar_calculations.js::calculateRectPoints (calepinage rectangulaire
     * du grand projet) — p1→p2 fixe l'arête/rotation exacte du rectangle, p3 (position de la souris,
     * ou clic 3) sa profondeur perpendiculaire. Copie locale plutôt qu'import : ce dossier reste
     * volontairement décorrélé du système "grands projets" (cf. en-tête du fichier), et
     * solar_calculations.js est un module ES (`export function`) alors que ce fichier est un script
     * classique.
     * @param {google.maps.LatLng} p1
     * @param {google.maps.LatLng} p2
     * @param {google.maps.LatLng} p3
     * @returns {google.maps.LatLng[]} les 4 coins du rectangle, dans l'ordre [p1, p2, corner3, corner4]
     */
    static calculateRectPoints(p1, p2, p3) {
        const heading = google.maps.geometry.spherical.computeHeading(p1, p2);
        const distWidth = google.maps.geometry.spherical.computeDistanceBetween(p2, p3);
        const headingWidth = google.maps.geometry.spherical.computeHeading(p2, p3);
        const angleDiff = headingWidth - heading;
        const turn = (angleDiff > 0 && angleDiff < 180) || angleDiff < -180 ? 90 : -90;

        const w = Math.abs(distWidth * Math.sin(angleDiff * Math.PI / 180));
        const p3_new = google.maps.geometry.spherical.computeOffset(p2, w, heading + turn);
        const p4_new = google.maps.geometry.spherical.computeOffset(p1, w, heading + turn);
        return [p1, p2, p3_new, p4_new];
    }

    static computeSegmentAzimuths(points) {
        const azimuths = [];
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const a = points[i];
            const b = points[(i + 1) % n];
            const compassHeading = google.maps.geometry.spherical.computeHeading(a, b);
            let azimuth = compassHeading - 180;
            if (azimuth <= -180) azimuth += 360;
            if (azimuth > 180) azimuth -= 360;
            azimuths.push(Math.round(azimuth));
        }
        return azimuths;
    }

    /**
     * Redresse un contour tracé à main levée en un polygone strictement rectiligne (tous les angles à
     * 90°) : projette les sommets dans un repère local (mètres) aligné sur le 1er segment tracé, puis
     * ne conserve, pour chaque segment, que la composante dominante (axe du 1er segment, ou son
     * perpendiculaire) — un "escalier" orthogonal, qui redevient un simple rectangle pour un contour à
     * 4 sommets déjà à peu près rectangulaire (cas très majoritaire pour une maison).
     * @param {google.maps.LatLng[]} points
     * @returns {google.maps.LatLng[]}
     */
    static orthogonalizePath(points) {
        if (!points || points.length < 3) return points;

        const origin = points[0];
        const metersPerLat = 111320;
        const metersPerLng = metersPerLat * Math.cos((origin.lat() * Math.PI) / 180);

        const toLocal = (p) => ({
            x: (p.lng() - origin.lng()) * metersPerLng,
            y: (p.lat() - origin.lat()) * metersPerLat
        });
        const toLatLng = (p) => new google.maps.LatLng(
            origin.lat() + p.y / metersPerLat,
            origin.lng() + p.x / metersPerLng
        );

        const local = points.map(toLocal);

        // Angle de référence = direction du 1er segment tracé (P0 -> P1) : tous les autres segments
        // seront alignés parallèlement ou perpendiculairement à celui-ci.
        const refAngle = Math.atan2(local[1].y - local[0].y, local[1].x - local[0].x);
        const cosA = Math.cos(-refAngle);
        const sinA = Math.sin(-refAngle);

        const toUV = (p) => ({ u: p.x * cosA - p.y * sinA, v: p.x * sinA + p.y * cosA });
        const fromUV = (uv) => ({
            x: uv.u * Math.cos(refAngle) - uv.v * Math.sin(refAngle),
            y: uv.u * Math.sin(refAngle) + uv.v * Math.cos(refAngle)
        });

        const uvPoints = local.map(toUV);

        const snapped = [uvPoints[0]];
        for (let i = 1; i < uvPoints.length; i++) {
            const prev = snapped[i - 1];
            const cur = uvPoints[i];
            const du = cur.u - prev.u;
            const dv = cur.v - prev.v;
            // Ne garde que la composante dominante du déplacement : force ce segment à être purement
            // parallèle (axe u) ou perpendiculaire (axe v) au 1er segment tracé.
            snapped.push(Math.abs(du) >= Math.abs(dv) ? { u: cur.u, v: prev.v } : { u: prev.u, v: cur.v });
        }

        // Referme le contour à angle droit si le dernier sommet ne rejoint pas déjà le premier sur un
        // seul axe (ajoute un sommet intermédiaire, comme un coin de bâtiment classique).
        const first = snapped[0];
        const last = snapped[snapped.length - 1];
        const duClose = first.u - last.u;
        const dvClose = first.v - last.v;
        if (Math.abs(duClose) > 1e-6 && Math.abs(dvClose) > 1e-6) {
            snapped.push(Math.abs(duClose) >= Math.abs(dvClose) ? { u: first.u, v: last.v } : { u: last.u, v: first.v });
        }

        return MaisonPolygonManager._simplifyCollinear(snapped).map((uv) => toLatLng(fromUV(uv)));
    }

    /**
     * CORRECTIF (bug rapporté : "modifier le sommet d'un rectangle continue à le transformer en
     * polygone") : redimensionne un rectangle EXISTANT (4 sommets) en tirant sur UN de ses coins —
     * contrairement à orthogonalizePath() (redressement "en escalier" pensé pour un tracé à main
     * levée initial), cet algorithme part du principe que la forme était DÉJÀ un rectangle correct
     * avant l'édition : le coin OPPOSÉ à celui déplacé (draggedIndex+2 mod 4) reste une ancre FIXE,
     * les 2 axes du rectangle sont dérivés des arêtes ancre→voisins (ni l'ancre ni ces 2 voisins
     * n'ont bougé, référence fiable), et les 2 coins adjacents glissent chacun sur leur propre axe
     * pour rejoindre la projection du point déplacé. Le coin déplacé conserve exactement sa
     * position sous la souris (décomposition sur une base orthonormée = identité mathématique,
     * aucun "combat" visuel avec le curseur pendant le glissé). Toujours exactement 4 sommets en
     * sortie : plus jamais de coin supplémentaire.
     * @param {google.maps.LatLng[]} points - le contour actuel, doit avoir exactement 4 sommets
     * @param {number} draggedIndex - index du sommet qui vient de bouger (fourni par l'événement
     *   Google Maps set_at(index, previous))
     * @returns {google.maps.LatLng[]|null} null si dégénéré (ancre/voisin coïncidents) — l'appelant
     *   doit alors se rabattre sur orthogonalizePath()
     */
    /**
     * CORRECTIF (bug rapporté, gravissime : "on enregistre un calepinage rectangulaire, on change de
     * projet, on revient : le calepinage s'est désorganisé, les panneaux ont perdu leur azimut").
     *
     * Déduit le mode de tracé ('rect' ou 'polygon') de la seule GÉOMÉTRIE du contour. Sert de repli
     * partout où le mode enregistré est absent — cas de tous les contours revenus de la base de
     * données, qui ne le transportait pas (cf. calepinage_maison_persistence_db.js), et des contours
     * tracés avant l'introduction du champ `mode`.
     *
     * Pourquoi c'est critique : le repli historique ('polygon', supposé "le moins destructeur") a
     * l'effet inverse sur un rectangle. En mode 'polygon', l'orientation des panneaux n'est PAS
     * dérivée du contour mais fixée à un azimut constant (plein sud par défaut, cf.
     * calepinage_maison_calculs.js::resetDivision et les resynchronisations de l'orchestrateur) :
     * un rectangle légèrement orienté retrouvait donc, à la réouverture, une grille plein sud en
     * biais par rapport à son propre contour — exactement le symptôme rapporté ("Azim : 0°").
     *
     * Critère : 4 sommets et 4 angles droits à `toleranceDeg` près, mesurés en mètres locaux (la
     * conversion lat/lng brute déforme les angles avec la latitude).
     *
     * @param {Array<{lat:number,lng:number}|google.maps.LatLng>} path
     * @param {number} [toleranceDeg=8] écart angulaire toléré par rapport à 90°
     * @returns {'rect'|'polygon'}
     */
    static inferModeFromPath(path, toleranceDeg = 8) {
        try {
            if (!Array.isArray(path) || path.length !== 4) return 'polygon';
            const num = (v) => (typeof v === 'function' ? v() : v);
            const pts = path.map((p) => ({ lat: num(p.lat), lng: num(p.lng) }));
            if (pts.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return 'polygon';

            const metersPerLat = 111320;
            const metersPerLng = metersPerLat * Math.cos((pts[0].lat * Math.PI) / 180);
            const local = pts.map((p) => ({
                x: (p.lng - pts[0].lng) * metersPerLng,
                y: (p.lat - pts[0].lat) * metersPerLat,
            }));

            for (let i = 0; i < 4; i++) {
                const prev = local[(i + 3) % 4], cur = local[i], next = local[(i + 1) % 4];
                const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
                const v2 = { x: next.x - cur.x, y: next.y - cur.y };
                const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
                if (n1 < 0.01 || n2 < 0.01) return 'polygon'; // sommets confondus : rien à déduire
                const cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2);
                const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
                if (Math.abs(angleDeg - 90) > toleranceDeg) return 'polygon';
            }
            return 'rect';
        } catch (err) {
            return 'polygon';
        }
    }

    static squareRectangleFromCorner(points, draggedIndex) {
        if (!points || points.length !== 4 || typeof draggedIndex !== 'number') return null;

        const origin = points[0];
        const metersPerLat = 111320;
        const metersPerLng = metersPerLat * Math.cos((origin.lat() * Math.PI) / 180);
        const toLocal = (p) => ({ x: (p.lng() - origin.lng()) * metersPerLng, y: (p.lat() - origin.lat()) * metersPerLat });
        const toLatLng = (p) => new google.maps.LatLng(origin.lat() + p.y / metersPerLat, origin.lng() + p.x / metersPerLng);

        const local = points.map(toLocal);
        const k = ((draggedIndex % 4) + 4) % 4;
        const anchorIdx = (k + 2) % 4;
        const adj1Idx = (k + 1) % 4;
        const adj2Idx = (k + 3) % 4;

        const anchor = local[anchorIdx];
        const adj1 = local[adj1Idx];
        const adj2 = local[adj2Idx];
        const dragged = local[k];

        const toUnit = (p) => {
            const dx = p.x - anchor.x, dy = p.y - anchor.y;
            const len = Math.hypot(dx, dy);
            return len < 1e-6 ? null : { x: dx / len, y: dy / len };
        };
        const axis1 = toUnit(adj1);
        const axis2 = toUnit(adj2);
        if (!axis1 || !axis2) return null; // ancre/voisin coïncidents — cas dégénéré

        const dragRel = { x: dragged.x - anchor.x, y: dragged.y - anchor.y };
        const len1 = dragRel.x * axis1.x + dragRel.y * axis1.y; // projection sur axis1
        const len2 = dragRel.x * axis2.x + dragRel.y * axis2.y; // projection sur axis2

        const newAdj1 = { x: anchor.x + axis1.x * len1, y: anchor.y + axis1.y * len1 };
        const newAdj2 = { x: anchor.x + axis2.x * len2, y: anchor.y + axis2.y * len2 };
        const newDragged = { x: newAdj1.x + newAdj2.x - anchor.x, y: newAdj1.y + newAdj2.y - anchor.y };

        const result = new Array(4);
        result[anchorIdx] = anchor;
        result[adj1Idx] = newAdj1;
        result[adj2Idx] = newAdj2;
        result[k] = newDragged;
        return result.map(toLatLng);
    }

    /**
     * CORRECTIF (contour à 5 sommets pour un rectangle) : un clic de tracé légèrement imprécis peut
     * faire ajouter ci-dessus un sommet de fermeture qui n'apporte pas un vrai coin (quasi-colinéaire
     * avec ses 2 voisins) — un rectangle voulu à 4 sommets devient alors un contour à 5 sommets, ce qui
     * masque à tort l'édition numérique des dimensions dans le calepinage (exige exactement 4 sommets,
     * cf. calepinage_maison_indiv.js::updateContourDimsUI). Fusionne (retire) tout sommet consécutif
     * quasi-aligné avec ses voisins, en repère u/v (mètres).
     * @param {{u:number,v:number}[]} points
     * @returns {{u:number,v:number}[]}
     */
    static _simplifyCollinear(points) {
        if (points.length <= 3) return points;
        const EPS = 1e-4;
        let pts = points.slice();
        let changed = true;
        while (changed && pts.length > 3) {
            changed = false;
            for (let i = 0; i < pts.length; i++) {
                const prev = pts[(i - 1 + pts.length) % pts.length];
                const cur = pts[i];
                const next = pts[(i + 1) % pts.length];
                const seg1 = Math.hypot(cur.u - prev.u, cur.v - prev.v);
                const seg2 = Math.hypot(next.u - cur.u, next.v - cur.v);
                const cross = (cur.u - prev.u) * (next.v - prev.v) - (cur.v - prev.v) * (next.u - prev.u);
                if (seg1 < EPS || seg2 < EPS || Math.abs(cross) / (seg1 * seg2) < EPS) {
                    pts.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        return pts;
    }

    /**
     * Contrôle de cohérence géographique (Exigence 4) :
     * Calcule la distance entre l'adresse du projet et la géométrie dessinée (rectangle/polygone).
     * Si la distance dépasse DISTANCE_MAX_CALEPINAGE (2000m / 2 km), renvoie isWithinLimit: false.
     */
    checkGeographicCoherence(targetPoly = null) {
        const maxDist = (typeof window.DISTANCE_MAX_CALEPINAGE === 'number')
            ? window.DISTANCE_MAX_CALEPINAGE
            : 2000;

        const getProjectCoords = () => {
            const parse = (raw) => {
                if (!raw) return null;
                try {
                    let d = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                    if (typeof d === 'string') d = JSON.parse(d);
                    const lat = parseFloat(d && (d.latitude || (d.coords && d.coords.lat) || d.lat));
                    const lng = parseFloat(d && (d.longitude || (d.coords && d.coords.lng) || d.lng));
                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                        return { lat, lng };
                    }
                } catch (e) {}
                return null;
            };

            const hidden = document.getElementById('parametre_project_hidden');
            if (hidden && hidden.value) {
                const c = parse(hidden.value);
                if (c) return c;
            }
            try {
                const spd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                const c = parse(spd?.projectInfo?.adresseProjet || spd?.projet?.adresse_projet);
                if (c) return c;
            } catch (e) {}
            if (window.ACTIVE_PROJECT_ADRESSE) {
                const c = parse(window.ACTIVE_PROJECT_ADRESSE);
                if (c) return c;
            }
            return null;
        };

        const projCoords = getProjectCoords();
        if (!projCoords) {
            return { distance: 0, isWithinLimit: true, hasAddress: false, maxAllowed: maxDist };
        }

        const computeDist = (lat1, lon1, lat2, lon2) => {
            if (window.google && window.google.maps && window.google.maps.geometry && window.google.maps.geometry.spherical) {
                return window.google.maps.geometry.spherical.computeDistanceBetween(
                    new window.google.maps.LatLng(lat1, lon1),
                    new window.google.maps.LatLng(lat2, lon2)
                );
            }
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        const getPolyCenter = (p) => {
            if (!p) return null;
            let path = [];
            if (typeof p.getPath === 'function') {
                path = p.getPath().getArray();
            } else if (Array.isArray(p)) {
                path = p;
            }
            if (!path || !path.length) return null;
            let sumLat = 0, sumLng = 0;
            path.forEach(pt => {
                const lat = typeof pt.lat === 'function' ? pt.lat() : parseFloat(pt.lat);
                const lng = typeof pt.lng === 'function' ? pt.lng() : parseFloat(pt.lng);
                sumLat += lat;
                sumLng += lng;
            });
            return { lat: sumLat / path.length, lng: sumLng / path.length };
        };

        const polysToCheck = targetPoly ? [targetPoly] : (this.polygons || []);
        if (!polysToCheck.length) {
            return { distance: 0, isWithinLimit: true, hasAddress: true, maxAllowed: maxDist };
        }

        let maxExceededDist = 0;
        let worstCenter = null;
        let hasExceeded = false;

        for (const p of polysToCheck) {
            const center = getPolyCenter(p);
            if (!center) continue;
            const dist = computeDist(projCoords.lat, projCoords.lng, center.lat, center.lng);
            if (dist > maxDist) {
                hasExceeded = true;
                if (dist > maxExceededDist) {
                    maxExceededDist = dist;
                    worstCenter = center;
                }
            }
        }

        if (hasExceeded) {
            return {
                distance: maxExceededDist,
                isWithinLimit: false,
                hasAddress: true,
                maxAllowed: maxDist,
                center: worstCenter,
                projCoords: projCoords
            };
        }

        return {
            distance: 0,
            isWithinLimit: true,
            hasAddress: true,
            maxAllowed: maxDist
        };
    }
}

// NOUVEAU (bug rapporté : contours perdus au rechargement) : clé localStorage des contours
// dessinés — cf. _persistPolygons()/restorePolygons(). Distincte de calepinage_maison_v1
// (calepinage_persistence.js), qui persiste le CONTENU du calepinage (pans/obstacles/équipements)
// par maisonId, jamais le tracé géographique lui-même.
MaisonPolygonManager.STORAGE_KEY = 'calepinage_maison_polygons_v1';

window.MaisonPolygonManager = MaisonPolygonManager;

window.checkCalepinageGeographicCoherence = function(poly) {
    if (window.MaisonPolygonManagerInstance && typeof window.MaisonPolygonManagerInstance.checkGeographicCoherence === 'function') {
        return window.MaisonPolygonManagerInstance.checkGeographicCoherence(poly);
    }
    return { isWithinLimit: true, distance: 0 };
};

// Instance unique, créée paresseusement dès que la carte principale est disponible (même pattern que
// window.calculateurAPERInstance) — cf. ButtonControl.js, qui appelle startDraw() dessus.
(function ensureMaisonPolygonManagerInstance() {
    if (window.MaisonPolygonManagerInstance) return;
    // CORRECTIF (migration Terra Draw) : plus de dépendance à google.maps.drawing (bibliothèque
    // "drawing" dépréciée, cf. constructeur ci-dessus) — il suffit que la carte principale et son
    // moteur Terra Draw partagé (toujours créé de façon synchrone dans le constructeur de
    // DrawingControl, cf. TerraDrawEngine.js) soient disponibles.
    if (!window.drawingControl || !window.drawingControl.map || !window.drawingControl.terraDrawEngine) {
        setTimeout(ensureMaisonPolygonManagerInstance, 300);
        return;
    }
    window.MaisonPolygonManagerInstance = new MaisonPolygonManager(window.drawingControl.map, window.drawingControl.errorModal);
    window.MaisonPolygonManagerInstance.onPolygonReady = (poly, azimuths) => {
        if (typeof window.openCalepinageMaisonModal === 'function') {
            window.openCalepinageMaisonModal(poly, azimuths);
        }
    };

    // NOUVEAU (demande explicite : labels + flèches sur les champs PV de la carte) : l'étiquette
    // "PVn" porte le numéro, la flèche l'AZIMUT des panneaux posés, et le bouton vert de
    // configuration n'apparaît que pour une ombrière ou un petit champ solaire — trois informations qui vivent dans l'état du
    // calepinage, pas dans le contour. Elles sont donc redessinées à chaque recalcul de cet état
    // (changement d'azimut, de type de structure, de division...), et pas seulement quand le contour
    // bouge (cf. les appels à _updateRoofVisuals au fil du tracé et de l'édition).
    // NOUVEAU (demande explicite, sens inverse du clic sur la carte) : activer l'onglet d'un champ PV
    // dans le formulaire PRO / Grand projet doit aussi le mettre en évidence et le cadrer sur la
    // carte. TabsManager émet déjà CENTER_ON_SHAPE à chaque activation d'onglet par l'utilisateur ;
    // il n'était traité que pour les formes "grands projets" (EventHandler.js ne cherche que dans
    // drawingControl.drawnShapes), donc sans effet pour un champ du module résidentiel.
    document.addEventListener('centerOnShape', (evt) => {
        const mgr = window.MaisonPolygonManagerInstance;
        const pvId = evt && evt.detail ? evt.detail.pvId : null;
        if (!mgr || !pvId) return;
        if (!mgr.polygons.some((poly) => poly.maisonId === pvId)) return; // forme "grands projets"
        mgr.mettreEnEvidence(pvId);
        mgr.selectionActive = true;
        mgr.zoomerSurChamp(pvId);
    });

    ['calepinageMaisonEtatRecalcule', 'calepinageMaisonFieldChanged'].forEach((nom) => {
        document.addEventListener(nom, (evt) => {
            const mgr = window.MaisonPolygonManagerInstance;
            if (!mgr) return;
            const sourceId = evt && evt.detail ? evt.detail.sourceId : null;
            mgr.polygons
                .filter((poly) => !sourceId || poly.maisonId === sourceId)
                .forEach((poly) => {
                    mgr._updateRoofVisuals(poly).catch(() => { /* visuels inchangés */ });
                });
        });
    });
    // NOUVEAU (persistance BD) : sur un poste/navigateur n'ayant jamais eu ce projet en localStorage,
    // réhydrate d'abord depuis la base (calepinage_maison_persistence_db.js) — sans jamais écraser
    // un état local déjà présent (cf. hydrateFromDatabaseIfEmpty) — AVANT de recréer les contours
    // sur la carte, pour que les maisons sauvegardées en base réapparaissent bien.
    const hydrate = (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.hydrateFromDatabaseIfEmpty === 'function')
        ? window.CalepinageMaisonPersistenceDB.hydrateFromDatabaseIfEmpty()
        : Promise.resolve();

    // NOUVEAU (bug rapporté : contours perdus au rechargement) : recrée silencieusement les maisons
    // dessinées lors d'une session précédente, dès que l'instance est prête.
    hydrate.finally(() => {
        window.MaisonPolygonManagerInstance.restorePolygons();

        // Panneaux des calepinages déjà réalisés reportés sur la carte dès le chargement (et donc sur
        // les plans), sans attendre la réouverture du canevas — cf. calepinage_maison_carte_plans.js.
        // Planifié (réessayé tant que les modules du calepinage ne sont pas tous prêts) plutôt
        // qu'un appel unique qui échouait en silence ; module pas encore chargé : il se rattrape
        // lui-même à son chargement (drapeau window.__maisonShapesRestored posé ci-dessous).
        try {
            const plans = window.CalepinageMaisonPlans;
            if (plans && typeof plans.planifierSynchronisation === 'function') plans.planifierSynchronisation();
            else if (plans) plans.synchroniser();
        } catch (e) { console.warn('[MaisonPolygonManager] Report des panneaux sur la carte impossible', e); }

        // Fin de restauration, signalée explicitement (demande explicite : "le comportement doit être
        // stable dès le départ, sans premier tracé ni rafraîchissement"). La restauration attend la
        // carte ET l'hydratation depuis la base : son instant est imprévisible. Les onglets du
        // formulaire PRO (TabsManager), l'onglet vide d'un projet neuf (index.js) et la synchronisation
        // du formulaire (calepinage_maison_form_pro.js) s'y accrochent au lieu de réessayer pendant
        // quelques secondes — ce qui, passé ce délai, laissait le formulaire sans onglet jusqu'au
        // prochain tracé. Émis même quand aucun contour n'a été restauré (projet neuf). Le drapeau
        // sert aux scripts chargés APRÈS l'événement.
        window.__maisonShapesRestored = true;
        document.dispatchEvent(new CustomEvent('maisonShapesRestored', {
            detail: { pvIds: window.MaisonPolygonManagerInstance.polygons.map((p) => p.maisonId).filter(Boolean) },
        }));

        // NOUVEAU (demande explicite : "si on est sur le modal calepinage résidentielle et on
        // actualise la page, on doit revenir sur le modal") : drapeau posé par
        // orchestrateur.js::openCalepinageMaisonModal, consommé ici une fois les contours restaurés
        // ci-dessus (donc leurs google.maps.Polygon vivants disponibles). Même appel que le bouton
        // toolbar "Ouvrir le calepinage résidentiel" (ButtonControl.js) : _notifyReady(poly) recalcule
        // les azimuts et ouvre le modal via onPolygonReady (câblé juste au-dessus).
        try {
            const lastOpenSourceId = sessionStorage.getItem('calepinage_maison_lastOpenSourceId');
            if (lastOpenSourceId) {
                const poly = window.MaisonPolygonManagerInstance.polygons.find((p) => p.maisonId === lastOpenSourceId);
                if (poly) {
                    window.MaisonPolygonManagerInstance._notifyReady(poly);
                } else {
                    // Maison introuvable (contour supprimé, ou c'était une source 'image' — jamais
                    // reconstructible après rechargement, cf. calepinage_image_source.js) : drapeau
                    // périmé, effacé silencieusement plutôt que laissé indéfiniment.
                    sessionStorage.removeItem('calepinage_maison_lastOpenSourceId');
                }
            }
        } catch (e) { /* sessionStorage indisponible (mode privé strict, etc.) : dégrade silencieusement */ }
    });
})();
