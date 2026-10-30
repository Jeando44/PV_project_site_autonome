import { STYLES, CUSTOM_EVENTS, SHAPE_TYPES, MARGIN_COLOR } from "../constants.js";
import { calculateShedLayout } from "./LineToShed.js";
import GeometryUtils from "../utils/GeometryUtils.js";
import { drawPanelsInPoly } from "./calepinage_polygonale.js";
import { calculateShedGridPoly } from "./calepinage_shed.js";
import { buildPanelEngineContext } from "../utils/PanelEngineAdapter.js";

/**
 * Gère de manière autonome le dessin de polygones et le calepinage en sheds.
*/
class ShedPolygon {
    constructor(drawingControl) {
        this.drawingControl = drawingControl;
        this.isActive = false;
        this.button = null;
        this.createdPanels = new Map(); // pvId -> [panelPolygons]
        // Alias volontaire (même Map, pas une copie) : calepinage_correction_controller.js/
        // payload_builder.js (bouton "Calculer") lisent/écrivent createdPanelsByShape de façon
        // générique pour tous les gestionnaires de panneaux (LineToPolygon, PolygonPanelsManager,
        // SolarRectangle) — cet alias évite de dupliquer leur logique rien que pour ce nom de
        // propriété différent, sans rien changer au code interne de cette classe (qui continue
        // d'utiliser createdPanels partout).
        this.createdPanelsByShape = this.createdPanels;
        this.hiddenByToggle = new Set();
        this.marginVisuals = new Map(); // pvId -> google.maps.Polygon (zone tampon "Esp. bordure")
        // pvId -> groupes_par_rangee / groupes_par_rangee_positions (résultat backend "Calculer",
        // cf. setShedBackendRowGroups/setShedBackendRowPositions ci-dessous) — CORRECTIF (demande
        // explicite : "le calcul Nb. Groupes dans la rangée ne fonctionne pas, aucun résultat ne
        // s'affiche") : calepinage_correction_controller.js appelle déjà ces setters de façon
        // générique sur le manager de la forme (getManagerForShape), mais ShedPolygon.js ne les
        // définissait pas — l'appel n'était donc jamais un no-op silencieux discret, il échouait la
        // vérification `typeof manager.setShedBackendRowGroups === 'function'` et les données
        // n'étaient simplement JAMAIS stockées pour un SHED_POLYGON.
        this.shedBackendGroupsByRowForShape = new Map();
        this.shedBackendPositionsByRowForShape = new Map();
    }

    /**
     * Stocke le nombre de groupes de sheds par rangée, vérifié par le backend après "Calculer"
     * (cf. verification.py::_verify_shed -> details_backend.groupes_par_rangee), consommé par le
     * sélecteur "Analyse par rangée" (#shedRowSelector-${pvId}, cf. FormHandler.js) pour afficher
     * "Nb. groupes dans la rangée" (#shedGroupsInRow-${pvId}) sans dépendre de l'agrégation JS
     * locale (que ce moteur ne calcule pas) — même contrat que PolygonPanelsManager.js.
     * @param {string} pvId
     * @param {number[]} groupesParRangee
     */
    setShedBackendRowGroups(pvId, groupesParRangee) {
        this.shedBackendGroupsByRowForShape.set(pvId, groupesParRangee || []);
    }

    /** @param {string} pvId @returns {number[]} */
    getShedBackendRowGroups(pvId) {
        return this.shedBackendGroupsByRowForShape.get(pvId) || [];
    }

    /**
     * Stocke les positions backend (même ordre/longueur que setShedBackendRowGroups) du point le
     * plus à l'Ouest de chaque rangée — cf. PolygonPanelsManager.js::setShedBackendRowPositions
     * (même contrat, non exploité ici pour les repères sur le plan tant que ce moteur ne calcule pas
     * sa propre agrégation JS locale par rangée, cf. getShedGroupsByRow côté PolygonPanelsManager).
     * @param {string} pvId
     * @param {Array} positions
     */
    setShedBackendRowPositions(pvId, positions) {
        this.shedBackendPositionsByRowForShape.set(pvId, positions || []);
    }

    /** @param {string} pvId @returns {Array} */
    getShedBackendRowPositions(pvId) {
        return this.shedBackendPositionsByRowForShape.get(pvId) || [];
    }

    /**
     * Active/désactive le mode de dessin de polygone pour sheds.
     * @param {HTMLElement} button - Le bouton qui active le mode.
     */
    toggleMode(button) {
        this.button = button;
        if (this.isActive) {
            this.deactivate();
        } else {
            this.activate();
        }
    }

    activate() {
        this.drawingControl.isShedsPolygonModeActive = true; // Flag pour EventHandler
        this.isActive = true;
        if (this.button) {
            this.button.classList.add('selected');
            this.button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
        }
        this.drawingControl.activeButton = this.button;

        // Le tracé passe par Terra Draw (remplace le mode natif google.maps.drawing.DrawingManager,
        // en fin de vie) — la complétion appelle directement handlePolygonComplete ci-dessous, comme
        // le ferait l'ancien 'overlaycomplete' natif.
        if (this.drawingControl.terraDrawEngine) {
            console.log('[ShedPolygon] Activation du mode de dessin Terra Draw (pv-poly)...');
            this.drawingControl.terraDrawEngine.start('pv-poly', (polygon) => this.handlePolygonComplete(polygon))
                .then(() => {
                    console.log('[ShedPolygon] Terra Draw prêt, mode pv-poly actif — cliquez sur la carte pour tracer le polygone.');
                })
                .catch((error) => {
                    console.error('[ShedPolygon] Échec de démarrage de Terra Draw:', error);
                    if (this.drawingControl.errorModal) {
                        this.drawingControl.errorModal.show(
                            "Impossible de démarrer l'outil de dessin (Terra Draw). Détail dans la console (F12)."
                        );
                    }
                });
        } else {
            console.error('[ShedPolygon] drawingControl.terraDrawEngine est introuvable — le module core/TerraDrawEngine.js est-il bien importé/instancié ?');
        }
        this.drawingControl.map.setOptions({ draggableCursor: 'crosshair' });
    }

    deactivate() {
        this.drawingControl.isShedsPolygonModeActive = false;
        this.isActive = false;
        if (this.drawingControl.terraDrawEngine) {
            this.drawingControl.terraDrawEngine.stop();
        }
        if (this.button) {
            this.button.classList.remove('selected');
            this.button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
        }
        if (this.drawingControl.activeButton === this.button) {
            this.drawingControl.activeButton = null;
        }
        this.drawingControl.map.setOptions({ draggableCursor: null });
    }

    /**
     * Gère la création d'un polygone et lance le calepinage en sheds.
     * @param {google.maps.Polygon} polygon - Le polygone créé.
     */
    handlePolygonComplete(polygon) {
        console.log("[ShedPolygon] Forme de shed finalisée, lancement du calepinage autonome.");
        try {
            polygon.setOptions({ ...STYLES.DEFAULT_SHAPE, editable: true, draggable: true });
            polygon.type = SHAPE_TYPES.SHED_POLYGON;
            // La propriété `shedsCapable` est maintenant implicite via le type
            polygon.shedsCapable = true;

            let id = 1;
            while (this.drawingControl.usedIds.has(`PV${id}`)) { id++; }
            polygon.pvId = `PV${id}`;
            this.drawingControl.usedIds.add(polygon.pvId);

            this.drawingControl.drawnShapes.push(polygon);

            // Dimensions d'origine (utilisées par le formulaire) : seulement pour le cas rectangle à
            // 4 sommets, comme pour les autres formes (cf. ShapeHandler.handlePanelShapeComplete).
            const bounds = new google.maps.LatLngBounds();
            polygon.getPath().forEach((point) => bounds.extend(point));
            if (polygon.getPath().getLength() === 4 && !polygon._originalDimensions) {
                polygon._originalDimensions = {
                    width: GeometryUtils.calculateWidth(bounds),
                    length: GeometryUtils.calculateLength(bounds)
                };
                polygon._lengthIndices = [0, 2];
                polygon._widthIndices = [1, 3];
            }
            if (typeof polygon.panelsRotation !== 'number') {
                polygon.panelsRotation = 0;
            }
            const center = bounds.getCenter();

            // CORRECTIF : ce point d'entrée n'a jamais déclenché SHAPE_ADDED (bug préexistant, resté
            // invisible tant que handlePolygonComplete n'était jamais atteint — cf. TerraDrawEngine).
            // FormHandler/TabsManager écoutent cet événement pour créer l'onglet de formulaire du PV :
            // sans lui, la forme se dessinait (panneaux inclus) mais n'ouvrait jamais son formulaire.
            document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_ADDED, {
                detail: {
                    shape: polygon,
                    pvId: polygon.pvId,
                    dimensions: polygon._originalDimensions,
                    center: { lat: center.lat(), lng: center.lng() }
                }
            }));

            this.drawingControl.FormHandler.setupFormListeners(this.drawingControl, polygon);
            this.drawingControl.ShapeHandler.setupShapeListeners(this.drawingControl, polygon);

            // CORRECTIF (demande explicite : "on ne peut pas déplacer un calepinage en shed") :
            // ShapeHandler.setupShapeListeners attache déjà un 'dragend' générique au polygone qui
            // dispatch SHAPE_MOVED (cf. ShapeHandler.js) pour TOUT type de forme — mais rien ne
            // l'écoutait ici pour repositionner les panneaux (positions absolues, pas relatives au
            // contour) à la nouvelle position. Sans cela, le polygone se déplaçait (une fois le blocage
            // clickable des panneaux levé ci-dessus) mais les panneaux restaient visuellement à leur
            // ancienne position.
            document.addEventListener(CUSTOM_EVENTS.SHAPE_MOVED, (event) => {
                if (event.detail && event.detail.pvId === polygon.pvId) {
                    this.refreshPanelsForShape(polygon.pvId);
                }
            });

            // CORRECTIF (demande explicite : "le calepinage polygonal doit correspondre au type de
            // calepinage en shed") : le gabarit HTML cloné pour chaque nouvel onglet (cf.
            // TabsManager.createTab, <template id="calepinageTemplate"> dans index.html) a le radio
            // "Incliné" coché en dur (attribut HTML statique de calepinage.html) — le correctif prévu
            // pour forcer "Shed" à l'activation de l'outil (ButtonControl.updateSupportPvUI
            // ('polygon-sheds')) agit sur des éléments SANS suffixe (#supportShed, #type_de_structure),
            // qui n'existent que DANS ce template inerte (jamais dans le DOM vivant, où seuls les
            // éléments suffixés -PV{n} existent une fois le template cloné) : il n'a donc jamais aucun
            // effet réel, et chaque nouveau shed affichait "Incliné"/"Ombrière métal" au lieu de "Shed"/
            // "Petit champ solaire", en contradiction avec shape.shedsCapable=true déjà fixé plus haut.
            // On force ici directement, sur le VRAI onglet qui vient d'être créé (SHAPE_ADDED
            // ci-dessus) : le radio "Shed", et l'option "Petit champ solaire" du select structure
            // (dé-masquée/activée elle aussi en dur, plutôt que de compter sur la cascade JS de
            // calepinage.html — un <script> inline reclonée avec le template à chaque nouvel onglet
            // n'est, par spécification HTML, jamais ré-exécuté après un premier clonage). Un événement
            // 'change' est quand même déclenché sur les deux pour tout autre écouteur externe (donc
            // fonctionnel) qui en dépendrait (ex: FormHandler.js).
            const supportShedInput = document.getElementById(`supportShed-${polygon.pvId}`);
            if (supportShedInput) {
                supportShedInput.checked = true;
                supportShedInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const structureSelect = document.getElementById(`type_de_structure-${polygon.pvId}`);
            if (structureSelect) {
                const petitChampOption = Array.from(structureSelect.options).find(o => o.value === 'Petit champ solaire');
                if (petitChampOption) {
                    petitChampOption.hidden = false;
                    petitChampOption.disabled = false;
                    petitChampOption.style.display = '';
                    structureSelect.value = 'Petit champ solaire';
                    structureSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // La flèche/le label d'orientation (cf. Polygon.js::updateRoofVisuals, plein Sud par
            // défaut) sont désormais posés depuis refreshPanelsForShape() ci-dessous, appelée à la
            // ligne suivante — un seul point d'appel, pour éviter deux créations concurrentes du même
            // overlay (cf. CORRECTIF "2 flèches/labels affichés" : appeler updateRoofVisuals() ici EN
            // PLUS de refreshPanelsForShape() faisait courir les deux appels en parallèle avant que le
            // premier n'ait fini d'attendre google.maps.importLibrary("marker") — le second écrasait la
            // référence de overlaysByShape sans jamais nettoyer le marker déjà posé par le premier).
            this.refreshPanelsForShape(polygon.pvId);

            setTimeout(() => this.drawingControl.setSelection(polygon), 100);

        } catch (error) {
            console.error('Erreur lors de la création des sheds :', error);
            this.drawingControl.errorModal.show("Une erreur est survenue lors de la création des sheds.");
        } finally {
            this.drawingControl.finishDrawingSession();
        }
    }

    /**
     * Crée ou met à jour les panneaux pour un polygone de shed donné.
     * @param {string} pvId - L'ID du PV à rafraîchir.
     * @param {{skipShadingRequest?: boolean}} [options] - skipShadingRequest évite une boucle infinie
     *   quand cette méthode est elle-même appelée depuis la réponse de _requestShedShadingFromBackend.
     */
    refreshPanelsForShape(pvId, options = {}) {
        const mainPolygon = this.drawingControl.drawnShapes.find(s => s.pvId === pvId && s.type === SHAPE_TYPES.SHED_POLYGON);
        if (!mainPolygon) {
            console.warn(`[ShedPolygon] Impossible de trouver la forme de shed pour ${pvId}.`);
            return;
        }

        console.log(`[ShedPolygon] Démarrage du calepinage autonome pour ${pvId}.`);

        // "Rotation shed" -> Azimut (même convention : 0°=Sud, 90°=Ouest, -90°=Est). Fait ici (unique
        // point d'entrée du rafraîchissement) plutôt que dans un écouteur séparé, pour éviter tout appel
        // concurrent avec le rafraîchissement des panneaux ci-dessous.
        const shedRotationInputSync = document.getElementById(`shedRotation-${pvId}`);
        const azimuthInputSync = document.getElementById(`azimuth-${pvId}`);
        if (shedRotationInputSync && azimuthInputSync) {
            const rotVal = parseFloat(shedRotationInputSync.value) || 0;
            if (parseFloat(azimuthInputSync.value) !== rotVal) {
                azimuthInputSync.value = rotVal;
                azimuthInputSync.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Nettoyer les anciens panneaux
        if (this.createdPanels.has(pvId)) {
            this.createdPanels.get(pvId).forEach(p => p.setMap(null));
        }
        this.createdPanels.set(pvId, []);
        const isGloballyHidden = this.hiddenByToggle.has(pvId);

        const path = mainPolygon.getPath();
        if (path.getLength() < 3) return;

        const panelConfig = this._getPanelConfigFromForm(pvId);

        // CORRECTIF (demande explicite : "afficher les panneaux dans le polygone uniquement après que
        // l'utilisateur aura choisi les panneaux") : tant qu'aucun panneau n'est sélectionné, ni
        // panneaux ni zone tampon ne sont dessinés (même comportement que l'ancien moteur shed, cf.
        // PolygonPanelsManager.js::createPanels).
        if (!panelConfig.hasPanelSelected) {
            this.createdPanels.set(pvId, []);
            this._removeMarginVisual(pvId);
            const perteOmbrageInputEmpty = (document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed'));
            if (perteOmbrageInputEmpty) perteOmbrageInputEmpty.value = '';
            return;
        }

        const shedTilt = Math.max(0, Math.min(90, parseFloat(document.getElementById(`pente_panneaux_shed-${pvId}`)?.value) || 0));
        panelConfig.shedTilt = shedTilt;

        // Moteur de calepinage : ./calepinage_polygonale.js::drawPanelsInPoly +
        // ./calepinage_shed.js::calculateShedGridPoly. CORRECTIF (demande explicite : "placer
        // les panneaux plein Sud par défaut") : drawPanelsInPoly dérive par défaut l'orientation de la
        // grille du 1er segment tracé par l'utilisateur (repère non fixe) — on force désormais un
        // azimut indépendant du tracé via ctx.fixedAzimuth, réutilisant "Rotation shed" (valeur HTML
        // par défaut 0 = plein Sud, cf. son aria-label), qui redevient donc un contrôle effectif sur
        // l'orientation des panneaux, en plus de sa synchro avec le champ Azimut ci-dessus.
        const L_proj_factor = Math.max(0.1, Math.cos(shedTilt * Math.PI / 180));
        const shedsColsInput = document.getElementById(`shedsCols-${pvId}`);
        const shedsRowsInput = document.getElementById(`shedsRows-${pvId}`);
        const shedsColSpacingInput = document.getElementById(`shedsColSpacing-${pvId}`);
        const shedsRowSpacingInput = document.getElementById(`shedsRowSpacing-${pvId}`);
        // CORRECTIF (demande explicite : "lorsqu'on dessine un polygone assurez-vous que le polygone
        // soit rempli de panneaux au maximum") : "Nb. PV en longueur"/"Esp. groupe de shed" valent "0"
        // par défaut dans le HTML, et leurs aria-label documentent explicitement "0 = remplissage
        // maximal (aucun regroupement)" — mais `valeur || repli` traite un "0" saisi comme une valeur
        // absente (0 est falsy en JS) et retombait donc silencieusement sur 12/100, limitant le
        // remplissage à des groupes de 12 espacés au lieu de remplir tout le polygone.
        // calculateShedGridPoly exige pvLong >= 1 (aucune notion de "continu" en interne) : "0" saisi
        // est donc traduit en une valeur très supérieure à ce qu'un polygone réel peut contenir (jamais
        // assez de panneaux pour former un 2e groupe), simulant l'absence de regroupement.
        const shedsRowsRaw = shedsRowsInput && shedsRowsInput.value !== '' ? parseInt(shedsRowsInput.value, 10) : NaN;
        const pvLong = (!isNaN(shedsRowsRaw) && shedsRowsRaw > 0) ? Math.min(40, shedsRowsRaw) : 9999;
        const shedsRowSpacingRaw = shedsRowSpacingInput && shedsRowSpacingInput.value !== '' ? parseFloat(shedsRowSpacingInput.value) : NaN;
        const spaceLong = (!isNaN(shedsRowSpacingRaw) && shedsRowSpacingRaw >= 0) ? Math.max(0, Math.min(5, shedsRowSpacingRaw / 1000)) : 0;
        const shedParams = {
            tilt: shedTilt,
            pvLarge: Math.max(1, Math.min(15, parseInt(shedsColsInput?.value, 10) || 2)),
            pvLong,
            spaceLarge: Math.max(0.001, Math.min(10, (parseFloat(shedsColSpacingInput?.value) || 2500) / 1000)),
            spaceLong,
            // CORRECTIF (demande explicite : "la case Sheds réguliers reste toujours cochée par
            // défaut, il faut la décocher par défaut") : ce champ était auparavant forcé à `true` en
            // permanence pour le polygone (rangées toujours complètes, cf. demande antérieure) — mais
            // ceci entre directement en tension avec "remplissage maximal" ci-dessus : n'accepter que
            // des tables COMPLÈTES laisse souvent beaucoup d'espace inutilisé sur les bords d'un
            // polygone qui ne se divise pas exactement en tables entières. Repasse en lecture de la
            // case à cocher (décochée par défaut dans le HTML), au même titre que pour le rectangle.
            isRegular: document.getElementById(`shedsRegular-${pvId}`)?.checked || false,
            L_proj_factor
        };

        const panelPolygonsOut = [];
        const engineCtx = buildPanelEngineContext(this.drawingControl, pvId, {
            // Les sheds ne supportent pas la suppression individuelle de panneau (comportement déjà
            // existant avant cette intégration) : aucun index jamais marqué "supprimé".
            getDeletedIndexSet: () => new Set(),
            panelPolygons: panelPolygonsOut
        });
        engineCtx.getShedParams = () => shedParams;
        engineCtx.calculateShedGridPoly = calculateShedGridPoly;
        engineCtx.marginX = panelConfig.margin * 1000;
        engineCtx.marginY = panelConfig.margin * 1000;
        engineCtx.isFieldHidden = isGloballyHidden;
        // Plein Sud par défaut (shedRotationInputSync vaut "0" par défaut dans le HTML) : cf. commentaire
        // ci-dessus. shedRotationInputSync est déjà lu plus haut pour la synchro avec #azimuth-${pvId}.
        //
        // CORRECTIF (demande explicite : "actuellement les sheds sont dessinés Est-Ouest, il faut les
        // dessiner Nord-Sud par défaut") : drawPanelsInPoly dérive headingX/headingY de fixedAzimuth
        // via headingX=(fixedAzimuth+180)%360 puis headingY=(headingX+90)%360, et la pente du panneau
        // (L_proj) suit headingY — un fixedAzimuth de 0 plaçait donc la pente (et la face du panneau)
        // sur un axe Est-Ouest au lieu de Nord-Sud/plein Sud. Décalage de +90° nécessaire pour aligner
        // la convention affichée par ce champ (0°=Sud, 90°=Ouest, -90°=Est, cf. son aria-label) sur le
        // rendu réel du moteur : vérifié pour les 3 valeurs repères (0->Sud, 90->Ouest, -90->Est).
        const shedRotationRaw = shedRotationInputSync ? (parseFloat(shedRotationInputSync.value) || 0) : 0;
        engineCtx.fixedAzimuth = 90 + shedRotationRaw;
        // Représente visuellement la zone tampon "Esp. bordure" entre le tracé et la limite réelle
        // de calepinage (cf. drawPanelsInPoly, qui rétrécit déjà silencieusement la zone via JSTS).
        engineCtx.onMarginZoneComputed = (outerPath, innerPath) => this._updateMarginVisual(pvId, outerPath, innerPath);

        drawPanelsInPoly(
            path.getArray(),
            { id: pvId },
            panelConfig.width,
            panelConfig.length,
            panelConfig.spacingX,
            panelConfig.spacingY,
            engineCtx
        );

        panelPolygonsOut.forEach((panel) => {
            panel.isPanelSolaire = true;
            panel.parentPolygon = mainPolygon;
            google.maps.event.clearInstanceListeners(panel);
            // CORRECTIF (demande explicite : "on ne peut pas déplacer un calepinage en shed") : les
            // sheds ne supportent pas la suppression/le clic individuel de panneau (cf. getDeletedIndexSet
            // toujours vide plus haut) — ces panneaux clickable:true (posés par calepinage_polygonale.js,
            // au-dessus du polygone principal en zIndex) interceptaient donc TOUT clic/glissement dans la
            // zone du shed avant qu'il n'atteigne le polygone en dessous, empêchant son déplacement natif
            // (draggable:true). clickable:false les rend transparents aux événements souris.
            panel.setOptions({ clickable: false });
        });
        this.createdPanels.set(pvId, panelPolygonsOut);

        // Resynchronise la flèche/le label d'orientation (cf. handlePolygonComplete) à chaque
        // rafraîchissement : "Rotation shed" pilote leur azimut visuel (Polygon.js::updateRoofVisuals
        // lit #shedRotation-${pvId} à chaque appel), donc un changement de rotation doit les faire
        // pivoter sans attendre un nouveau tracé de polygone.
        if (this.drawingControl.polygon && typeof this.drawingControl.polygon.updateRoofVisuals === 'function') {
            this.drawingControl.polygon.updateRoofVisuals(mainPolygon);
        }

        if (this.drawingControl.obstaclePanels) {
            this.drawingControl.obstaclePanels.requestRefresh();
        }

        // CORRECTIF (demande explicite : "le calcul de la perte d'ombrage entre shed n'est pas
        // calculé") : cette étape existe et fonctionne déjà pour l'ancien moteur shed
        // (PolygonPanelsManager.js::createPanels, en toute fin), mais n'avait jamais été portée vers ce
        // moteur — #perteOmbrageShed-${pvId} restait donc toujours vide pour un polygone shed dédié.
        this._updateShedShading(pvId, panelConfig, options);

        console.log(`[ShedPolygon] ${panelPolygonsOut.length} panneaux dessinés (moteur ./calepinage_polygonale.js).`);
    }

    /**
     * Calcule et affiche "% Perte d'ombrage entre shed" (#perteOmbrageShed-${pvId}) : une estimation
     * géométrique instantanée (cf. PolygonPanelsManager.js::computeShedShadingFallback, réutilisée
     * telle quelle — pure fonction de config + latitude projet, sans état propre à un gestionnaire),
     * puis remplacée par la valeur backend pvlib (cf. _requestShedShadingFromBackend) si une adresse
     * projet est géocodée.
     * @param {string} pvId
     * @param {Object} config - Objet retourné par _getPanelConfigFromForm, avec shedTilt ajouté.
     * @param {{skipShadingRequest?: boolean}} [options]
     */
    _updateShedShading(pvId, config, options = {}) {
        const polygonPanels = this.drawingControl.polygonPanels;
        if (!polygonPanels || typeof polygonPanels.computeShedShadingFallback !== 'function') return;

        const shadingConfig = this._toShadingConfig(config);
        const perteOmbrageInput = (document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed'));
        const shading = polygonPanels.computeShedShadingFallback(shadingConfig);
        if (perteOmbrageInput) {
            perteOmbrageInput.value = shading.lossPercent !== null ? shading.lossPercent.toFixed(1) : '';
        }
        if (!options.skipShadingRequest) {
            this._requestShedShadingFromBackend(pvId, shadingConfig);
        }
    }

    /**
     * CORRECTIF (demande explicite : "le calcul d'ombrage ne fonctionne pas pour les sheds, les
     * valeurs=0 dans le tableau des résultats") : computeShedShadingFallback()/le calcul de
     * collector_width ci-dessous sont PARTAGÉS avec PolygonPanelsManager.js et y attendent
     * shedsCols/spacingX/shedsColSpacing pour désigner l'axe "Nb. PV en largeur" (rampant, cf. son
     * propre getPanelConfigFromForm — AUCUN croisement de nommage là-bas). Mais dans CE fichier
     * (_getPanelConfigFromForm ci-dessus), l'axe "Nb. PV en largeur" est au contraire porté par
     * shedsRows/spacingY/shedsRowSpacing (nommage volontairement croisé par rapport aux id HTML,
     * cf. ses propres commentaires) : passer directement `config` tel quel à ces fonctions
     * partagées leur faisait donc utiliser le nombre de panneaux ET l'espacement du MAUVAIS axe
     * (longueur au lieu de largeur), d'où un ombrage systématiquement nul ou faux. Cette traduction
     * ponctuelle évite de dupliquer computeShedShadingFallback()/la formule de collector_width.
     * @param {Object} config - Objet retourné par _getPanelConfigFromForm.
     * @returns {Object} Config équivalente, dans la convention de nommage attendue par les
     *   fonctions partagées avec PolygonPanelsManager.js.
     */
    _toShadingConfig(config) {
        return {
            ...config,
            shedsCols: config.shedsRows,
            spacingX: config.spacingY,
            shedsColSpacing: config.shedsRowSpacing,
        };
    }

    /**
     * Débounce (500ms par pvId) puis appelle /calculate_shed_shading côté serveur — portage direct de
     * PolygonPanelsManager.js::requestShedShadingFromBackend, adapté pour régénérer via
     * this.refreshPanelsForShape() (moteur de ce fichier) au lieu de this.updatePanelsPosition()
     * (spécifique à PolygonPanelsManager, incompatible avec un SHED_POLYGON).
     * @param {string} pvId
     * @param {Object} config
     */
    _requestShedShadingFromBackend(pvId, config) {
        const polygonPanels = this.drawingControl.polygonPanels;
        if (!polygonPanels) return;

        if (!this._shedShadingBackendTimers) this._shedShadingBackendTimers = new Map();
        const existingTimer = this._shedShadingBackendTimers.get(pvId);
        if (existingTimer) clearTimeout(existingTimer);

        // Sans adresse projet géocodée, impossible d'interroger PVGIS de façon pertinente : on garde
        // l'estimation JS de repli déjà affichée par l'appelant.
        const addressLatLng = GeometryUtils.getProjectAddressLatLng();
        if (!addressLatLng) return;

        const perteOmbrageInput = (document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed'));
        if (perteOmbrageInput) perteOmbrageInput.value = '…';

        const shedRotationInput = document.getElementById(`shedRotation-${pvId}`);
        const shedRotation = shedRotationInput ? (parseFloat(shedRotationInput.value) || 0) : 0;
        // Azimut pvlib (180° = Sud) : shedRotation = 0 signifie "Sud" dans cette UI.
        const azimuth = (180 + shedRotation + 360) % 360;
        const collectorWidth = config.shedsCols * config.length + (config.shedsCols - 1) * config.spacingX;

        const fallbackToLocalEstimate = () => {
            if (!perteOmbrageInput) return;
            const shading = polygonPanels.computeShedShadingFallback(config);
            perteOmbrageInput.value = shading.lossPercent !== null ? shading.lossPercent.toFixed(1) : '';
        };

        const timer = setTimeout(() => {
            fetch('/concevoir_mon_projet/calculate_shed_shading', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: addressLatLng.lat,
                    lon: addressLatLng.lng,
                    tilt: config.shedTilt || 0,
                    gap: config.shedsColSpacing,
                    collector_width: collectorWidth,
                    azimuth,
                }),
            })
                .then((res) => res.json())
                .then((data) => {
                    const shapeStillExists = this.drawingControl.drawnShapes.some(s => String(s.pvId) === String(pvId));
                    if (shapeStillExists) {
                        this.refreshPanelsForShape(pvId, { skipShadingRequest: true });
                    }
                    const freshPerteOmbrageInput = (document.querySelector(`#perteOmbrageShed-${pvId}`) || document.getElementById('perteOmbrageShed'));
                    if (typeof data.lossPercent === 'number' && freshPerteOmbrageInput) {
                        freshPerteOmbrageInput.value = data.lossPercent.toFixed(1);
                    } else if (!shapeStillExists) {
                        fallbackToLocalEstimate();
                    }
                })
                .catch(() => fallbackToLocalEstimate());
        }, 500);

        this._shedShadingBackendTimers.set(pvId, timer);
    }

    /**
     * Retire de la carte tous les panneaux d'un shed donné, sans les recréer (utilisé à la suppression
     * de la forme — sans cela, les panneaux restaient affichés en "image fantôme" après suppression).
     * @param {string} pvId - L'ID du PV à nettoyer.
     */
    cleanupPanelsForShape(pvId) {
        this._removeMarginVisual(pvId);
        if (this._shedShadingBackendTimers && this._shedShadingBackendTimers.has(pvId)) {
            clearTimeout(this._shedShadingBackendTimers.get(pvId));
            this._shedShadingBackendTimers.delete(pvId);
        }
        if (!this.createdPanels.has(pvId)) return;
        this.createdPanels.get(pvId).forEach(p => p.setMap(null));
        this.createdPanels.delete(pvId);
        this.hiddenByToggle.delete(pvId);
    }

    /**
     * Supprime la zone tampon affichée pour un pvId donné, s'il y en a une.
     * @param {string} pvId
     */
    _removeMarginVisual(pvId) {
        if (this.marginVisuals.has(pvId)) {
            this.marginVisuals.get(pvId).setMap(null);
            this.marginVisuals.delete(pvId);
        }
    }

    /**
     * Dessine (ou retire, si aucune marge n'est active) la zone tampon "Esp. bordure" entre le
     * contour tracé et la limite réelle de calepinage — même rendu que PolygonPanelsManager.js/
     * SolarRectangle.js (bande orange MARGIN_COLOR, "trou" via un 2e anneau inversé).
     * @param {string} pvId
     * @param {Array<google.maps.LatLng>} outerPath - contour tracé par l'utilisateur
     * @param {Array<google.maps.LatLng>|null} innerPath - limite réelle après application de la
     *   marge (null si "Esp. bordure" vaut 0, ou si JSTS est indisponible).
     */
    _updateMarginVisual(pvId, outerPath, innerPath) {
        this._removeMarginVisual(pvId);
        if (!innerPath || innerPath.length < 3) return;

        const marginPolygon = new google.maps.Polygon({
            paths: [outerPath, [...innerPath].reverse()],
            fillColor: MARGIN_COLOR,
            fillOpacity: 0.3,
            strokeWeight: 0,
            zIndex: 20,
            map: this.drawingControl.map,
            clickable: false
        });
        marginPolygon.isMarginVisual = true;
        marginPolygon.parentPvId = pvId;
        this.marginVisuals.set(pvId, marginPolygon);
    }

    /**
     * Récupère la configuration des panneaux depuis le formulaire de l'onglet actif.
     * @param {string} pvId - L'ID du PV.
     * @returns {Object} Un objet de configuration de panneau.
     * @private
     */
    _getPanelConfigFromForm(pvId) {
        const getVal = (id, divisor = 1000) => {
            const input = document.getElementById(`${id}-${pvId}`);
            if (!input) return 0;
            const value = parseFloat(input.value);
            return (isNaN(value) ? 0 : value) / divisor;
        };
        
        const getInt = (id) => {
            const input = document.getElementById(`${id}-${pvId}`);
            if (!input) return 0;
            const value = parseInt(input.value, 10);
            return isNaN(value) || value < 0 ? 0 : value;
        };

        // Comme getInt/getVal, mais un champ VIDE/absent retombe sur "defaultVal" alors qu'un 0 saisi
        // explicitement par l'utilisateur est conservé tel quel — nécessaire pour "Nb. PV en longueur"
        // et "Esp. groupe de shed", où 0 a maintenant un sens métier propre (pas de regroupement / pas
        // d'espace entre sheds), à ne pas confondre avec "champ non renseigné".
        const getIntKeepZero = (id, defaultVal) => {
            const input = document.getElementById(`${id}-${pvId}`);
            if (!input || input.value === '') return defaultVal;
            const value = parseInt(input.value, 10);
            return (isNaN(value) || value < 0) ? defaultVal : value;
        };
        const getValKeepZero = (id, defaultVal, divisor = 1000) => {
            const input = document.getElementById(`${id}-${pvId}`);
            if (!input || input.value === '') return defaultVal;
            const value = parseFloat(input.value);
            return (isNaN(value) || value < 0) ? defaultVal : value / divisor;
        };

        // Le mode de pose (Portrait/Paysage) détermine quelle dimension physique du panneau s'incline
        // dans le rampant ("length" ci-dessous, axe Est-Ouest, "Esp. Shed Y") et laquelle est parallèle
        // à la rangée ("width" ci-dessous, axe Nord-Sud, "Nb. PV en longueur") : en Portrait, le grand
        // côté (longueur) est parallèle à la rangée, le petit côté (largeur) s'incline dans le rampant ;
        // en Paysage, l'inverse.
        const portraitInput = document.getElementById(`modePosePortrait-${pvId}`);
        const paysageInput = document.getElementById(`modePosePaysage-${pvId}`);
        const isPortrait = portraitInput ? portraitInput.checked : (paysageInput ? !paysageInput.checked : true);
        const baseLongueur = getVal('longueurPanneau');
        const baseLargeur = getVal('largeurPanneau');
        // CORRECTIF (demande explicite : "afficher les panneaux dans le polygone uniquement après que
        // l'utilisateur aura choisi les panneaux") : un panneau n'a été choisi (modale "Liste de
        // favoris") que si ses 2 dimensions réelles sont renseignées (>0) — sans cette garde (déjà
        // existante pour l'ancien moteur shed, cf. PolygonPanelsManager.js::getPanelConfigFromForm),
        // un shed fraîchement dessiné affichait immédiatement des panneaux aux dimensions de repli
        // (2.0m x 1.0m, cf. plus bas) avant tout choix de panneau par l'utilisateur.
        const hasPanelSelected = baseLongueur > 0 && baseLargeur > 0;

        const config = {
            length: isPortrait ? baseLargeur : baseLongueur,
            width: isPortrait ? baseLongueur : baseLargeur,
            hasPanelSelected,
            spacingX: getVal('espacementPanneauxX') || 0.02,
            spacingY: getVal('espacementPanneauxY') || 0.02,
            margin: getVal('espacementBords'),

            shedsEnabled: true,
            // NOTE : le nommage interne shedsRows/shedsCols de ce fichier (relayé à LineToShed.js) pilote
            // respectivement l'axe longueur ("along", sans pente) et l'axe largeur/rampant ("perp",
            // projeté par la pente) — croisement historique des ids HTML conservé tel quel (cf.
            // PolygonPanelsManager.js pour le mapping direct). Seules les bornes/unités sont mises à jour
            // ici pour correspondre aux libellés HTML actuels.
            // Champ HTML #shedsCols ("Nb. PV en largeur") : entre 1 et 15.
            shedsRows: Math.max(1, Math.min(15, getInt('shedsCols') || 2)),
            // Champ HTML #shedsColSpacing ("Esp. entre sheds") : saisi en mm (divisor 1000), borné à ]0, 10] m.
            shedsRowSpacing: Math.max(0.001, Math.min(10, getVal('shedsColSpacing') || 2.5)),
            // Champ HTML #shedsRows ("Nb. PV en longueur") : entre 0 et 40. 0 = pas de regroupement
            // (cf. calculateShedLayout), conservé tel quel si saisi explicitement (getIntKeepZero).
            shedsCols: Math.max(0, Math.min(40, getIntKeepZero('shedsRows', 12))),
            // Champ HTML #shedsRowSpacing ("Esp. groupe de shed") : saisi en mm (divisor 1000), borné à
            // [0, 5] m. 0 = aucun espace entre sheds, groupes propagés en continu (cf. calculateShedLayout).
            shedsColSpacing: Math.max(0, Math.min(5, getValKeepZero('shedsRowSpacing', 0.1))),
        };

        // Fallbacks si les valeurs sont nulles
        if (config.length <= 0) config.length = 2.0;
        if (config.width <= 0) config.width = 1.0;

        return config;
    }

    /**
     * Collecte les données des polygones de sheds pour la sauvegarde.
     * @returns {Object} Données à sauvegarder.
     */
    collectData() {
        const data = {};
        this.drawingControl.drawnShapes.forEach(shape => {
            if (shape.type === SHAPE_TYPES.SHED_POLYGON) {
                data[shape.pvId] = {
                    // La géométrie et les données de formulaire sont déjà gérées par StorageManager.
                    // Nous sauvegardons ici uniquement les états spécifiques à ce module.
                    hiddenByToggle: this.hiddenByToggle.has(shape.pvId)
                };
            }
        });
        return data;
    }

    /**
     * Charge les données des polygones de sheds depuis le stockage.
     * @param {Object} data - Données sauvegardées.
     */
    loadFromData(data) {
        if (!data) return;
        Object.keys(data).forEach(pvId => {
            const shapeData = data[pvId];
            const shape = this.drawingControl.drawnShapes.find(s => s.pvId === pvId && s.type === SHAPE_TYPES.SHED_POLYGON);
            if (shape) {
                if (shapeData.hiddenByToggle) {
                    this.hiddenByToggle.add(pvId);
                }
                this.refreshPanelsForShape(pvId);
            }
        });
    }
}

export default ShedPolygon;