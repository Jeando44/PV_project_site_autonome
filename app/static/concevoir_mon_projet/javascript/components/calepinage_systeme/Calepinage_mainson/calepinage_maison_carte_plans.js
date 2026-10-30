/**
 * Calepinage sur canevas (résidentiel / professionnel) -> carte principale et plans exportés.
 *
 * Constat (analyse demandée) : les panneaux calculés dans le canevas n'existaient QUE dans le canevas.
 * La carte principale ne montrait que le contour bleu du champ PV, et les plans (situation, masse),
 * qui capturent la carte et lisent les formes du calepinage grand projet (drawingControl.drawnShapes),
 * ignoraient ces champs : plan de masse refusé (« Aucune implantation »), plan de situation centré sur
 * l'adresse au lieu des panneaux, DXF sans implantation.
 *
 * Ce module :
 *  - dessine les panneaux de chaque champ PV sur la carte (un google.maps.Polygon par champ, un
 *    anneau par panneau, non cliquable), resynchronisé à chaque recalcul du calepinage affiché
 *    (orchestrateur::recomputeResults) et au chargement de la page ;
 *  - expose window.CalepinageMaisonPlans (contours + panneaux en lat/lng, masquage temporaire) aux
 *    modules d'export (export_plans_pdf_dxf/utils/PanelsExtent.js, PanelVisibility.js).
 */
(function () {
    const CM = window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};

    const STYLE_PANNEAUX_CARTE = {
        strokeColor: '#0f172a', strokeOpacity: 0.9, strokeWeight: 0.6,
        fillColor: '#1e293b', fillOpacity: 0.65, clickable: false, zIndex: 8,
    };

    // Zone tampon « Espacement bordure » : même couleur que dans le canevas (rgba(249,115,22,0.28)).
    const STYLE_ZONE_BORDURE_CARTE = {
        strokeColor: '#f97316', strokeOpacity: 0.7, strokeWeight: 0.8,
        fillColor: '#f97316', fillOpacity: 0.28, clickable: false, zIndex: 7,
    };

    // sourceId -> google.maps.Polygon (tous les panneaux du champ PV)
    // Joints de dilatation (ombrières / bâtiment incliné) : bande rouge de la largeur du joint, trait
    // appuyé pour rester visible à faible zoom (un joint de 100 mm fait moins d'un pixel).
    const STYLE_JOINTS_CARTE = {
        strokeColor: '#dc2626', strokeOpacity: 0.95, strokeWeight: 2,
        fillColor: '#dc2626', fillOpacity: 0.5, clickable: false, zIndex: 9,
    };

    const overlaysParSource = new Map();
    const jointsParSource = new Map();
    // sourceId -> google.maps.Polygon (anneaux de zone tampon de bordure, un par pan)
    const zonesParSource = new Map();

    // Champs PV dont l'utilisateur a masqué les panneaux (bouton « Ajouter/Masquer les panneaux
    // solaires » de la palette, appliqué au champ sélectionné, cf. ButtonControl.js) : contrairement
    // à masquerPanneauxCarte (capture, temporaire), ce masquage survit aux resynchronisations — les
    // overlays recalculés du champ restent hors carte jusqu'au réaffichage.
    const sourcesMasqueesParUtilisateur = new Set();

    // Projet auquel appartiennent ces masquages : les numéros PVn repartent de PV1 dans chaque projet,
    // et le changement de projet se fait sans recharger la page. Sans cette purge, un PV1 masqué dans
    // un projet restait masqué dans le suivant (panneaux absents de la carte sans raison visible).
    let projetDesMasquages = null;
    function purgerMasquagesSiAutreProjet() {
        let projetId = null;
        try { projetId = localStorage.getItem('current_projet_id'); } catch (e) { /* navigation privée */ }
        if (projetDesMasquages !== null && String(projetDesMasquages) !== String(projetId)) {
            sourcesMasqueesParUtilisateur.clear();
        }
        projetDesMasquages = projetId;
    }

    /** Carte à laquelle rattacher un overlay du champ : null tant que l'utilisateur le masque. */
    function carteSiVisible(map, sourceId) {
        return sourcesMasqueesParUtilisateur.has(sourceId) ? null : map;
    }

    /** Nouvel overlay d'un champ, étiqueté de son sourceId (relu à la restauration après capture). */
    function nouvelOverlay(style, chemins, map, sourceId) {
        const overlay = new google.maps.Polygon({ ...style, paths: chemins, map: carteSiVisible(map, sourceId) });
        overlay.__sourceId = sourceId;
        return overlay;
    }

    function carte() {
        return window.map || (window.drawingControl && window.drawingControl.map) || null;
    }

    /**
     * Panneaux d'un champ (repère local de SON état), convertis en lat/lng.
     * @param {Object} [rapport] - reçoit `erreur: true` si le calcul a échoué (liste vide non fiable)
     */
    function panneauxLatLng(champ, rapport) {
        const { state, origin } = champ;
        const previousState = CM.state;
        let panneaux = [];
        try {
            // packPanelsForPan lit CM.state : bascule temporaire, synchrone (même idiome que
            // orchestrateur::getAllPvFieldSummaries).
            CM.state = state;
            (state.pans || []).forEach((pan) => {
                CM.packPanelsForPan(pan).forEach((pl) => {
                    panneaux.push(CM.panelCornersTrue(pl).map((c) => CM.localToLatLng(origin, c)));
                });
            });
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Panneaux non calculables pour', champ.sourceId, e);
            panneaux = [];
            if (rapport) rapport.erreur = true;
        } finally {
            CM.state = previousState;
        }
        return panneaux;
    }

    /**
     * Panneaux d'un champ dans la géométrie EXACTE du repère local du canevas :
     * {cx, cy, w, l, angle} en mètres, w = côté parallèle à l'égout, l = côté parallèle au
     * rampant (à la flèche de pente) DÉJÀ projeté à l'horizontale par getEffectivePanelDims()
     * (x cos(pente)) — une vue en plan.
     *
     * Pourquoi cette sortie en plus de panneauxLatLng() : les plans exportés relisaient les
     * 4 coins en lat/lng, et l'aller-retour local -> lat/lng -> local dégradait les cotations
     * (un 1762x1134 en portrait sur 15° sortait 1,6988 x 1,1319 au lieu de 1,702 x 1,134).
     * Ici les dimensions saisies par l'utilisateur sont transmises telles quelles ; seule la
     * POSITION du centre passe par la conversion géographique.
     */
    function panneauxLocaux(champ) {
        const { state } = champ;
        const previousState = CM.state;
        const panneaux = [];
        try {
            CM.state = state;
            (state.pans || []).forEach((pan) => {
                CM.packPanelsForPan(pan).forEach((pl) => {
                    panneaux.push({ cx: pl.cx, cy: pl.cy, w: pl.w, l: pl.l, angle: pl.angle });
                });
            });
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Géométrie locale des panneaux indisponible pour', champ.sourceId, e);
            return [];
        } finally {
            CM.state = previousState;
        }
        return panneaux;
    }

    /**
     * Zone tampon « Espacement bordure » d'un champ, en lat/lng : un anneau (contour extérieur +
     * trou) par pan, EXACTEMENT celui du canevas (CM.clearanceZoneRings) — demande explicite :
     * l'afficher sur la carte pour toutes les structures (petit champ solaire compris) dès lors
     * qu'elle est matérialisée sur le canevas. Ombrières : aucune (espacement forcé à 0 côté
     * canevas, cf. effectiveEdgeClearanceM). Même condition d'affichage que le canevas (showPanels).
     */
    function zoneBordureLatLng(champ) {
        const { state, origin } = champ;
        if (typeof CM.clearanceZoneRings !== 'function' || !state.showPanels) return [];
        const previousState = CM.state;
        const chemins = [];
        try {
            CM.state = state;
            (state.pans || []).forEach((pan) => {
                const zone = CM.clearanceZoneRings(pan).bordure;
                if (!zone || zone.outer.length < 3 || zone.inner.length < 3) return;
                chemins.push(zone.outer.map((p) => CM.localToLatLng(origin, p)));
                // Trou : sens de parcours inverse du contour extérieur (règle de Google Maps).
                chemins.push(zone.inner.map((p) => CM.localToLatLng(origin, p)).reverse());
            });
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Zone tampon non calculable pour', champ.sourceId, e);
            return [];
        } finally {
            CM.state = previousState;
        }
        return chemins;
    }

    /** Joints de dilatation d'un champ en lat/lng : un rectangle (4 coins) par joint. */
    function jointsLatLng(champ) {
        const { state, origin } = champ;
        if (typeof CM.jointsDilatationDuPan !== 'function' || state.showPanels === false) return [];
        const previousState = CM.state;
        const chemins = [];
        try {
            CM.state = state;
            (state.pans || []).forEach((pan) => {
                CM.jointsDilatationDuPan(pan).forEach((j) => {
                    const dx = j.b.x - j.a.x, dy = j.b.y - j.a.y;
                    const lg = Math.hypot(dx, dy) || 1;
                    const nx = (-dy / lg) * (j.largeurM / 2), ny = (dx / lg) * (j.largeurM / 2);
                    chemins.push([
                        { x: j.a.x + nx, y: j.a.y + ny }, { x: j.b.x + nx, y: j.b.y + ny },
                        { x: j.b.x - nx, y: j.b.y - ny }, { x: j.a.x - nx, y: j.a.y - ny },
                    ].map((c) => CM.localToLatLng(origin, c)));
                });
            });
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Joints de dilatation non calculables pour', champ.sourceId, e);
            return [];
        } finally {
            CM.state = previousState;
        }
        return chemins;
    }

    function retirerJointsCarte(sourceId) {
        const joints = jointsParSource.get(sourceId);
        if (joints) joints.setMap(null);
        jointsParSource.delete(sourceId);
    }

    function synchroniserJoints(champ, map) {
        const chemins = jointsLatLng(champ);
        const existants = jointsParSource.get(champ.sourceId);
        if (!chemins.length) { retirerJointsCarte(champ.sourceId); return; }
        if (existants) {
            existants.setPaths(chemins);
            if (!existants.getMap() && !existants.__masqueTemporairement) existants.setMap(carteSiVisible(map, champ.sourceId));
        } else {
            jointsParSource.set(champ.sourceId, nouvelOverlay(STYLE_JOINTS_CARTE, chemins, map, champ.sourceId));
        }
    }

    function retirerZoneBordureCarte(sourceId) {
        const zone = zonesParSource.get(sourceId);
        if (zone) zone.setMap(null);
        zonesParSource.delete(sourceId);
    }

    function synchroniserZoneBordure(champ, map) {
        const chemins = zoneBordureLatLng(champ);
        const existante = zonesParSource.get(champ.sourceId);
        if (!chemins.length) { retirerZoneBordureCarte(champ.sourceId); return; }
        if (existante) {
            existante.setPaths(chemins);
            if (!existante.getMap() && !existante.__masqueTemporairement) existante.setMap(carteSiVisible(map, champ.sourceId));
        } else {
            zonesParSource.set(champ.sourceId, nouvelOverlay(STYLE_ZONE_BORDURE_CARTE, chemins, map, champ.sourceId));
        }
    }

    function retirerPanneauxCarte(sourceId) {
        const overlay = overlaysParSource.get(sourceId);
        if (overlay) overlay.setMap(null);
        overlaysParSource.delete(sourceId);
        retirerZoneBordureCarte(sourceId);
        retirerJointsCarte(sourceId);
        if (CM.terrainCarte) CM.terrainCarte.retirer(sourceId);
        if (CM.poteauxCarte) CM.poteauxCarte.retirer(sourceId);
    }

    /** Tout ce dont le calcul et le dessin des panneaux ont besoin est-il chargé ? */
    function dependancesPretes() {
        return !!(carte() && window.google && window.google.maps
            && typeof CM.listerChampsCarte === 'function' && typeof CM.packPanelsForPan === 'function'
            && typeof CM.panelCornersTrue === 'function' && typeof CM.localToLatLng === 'function');
    }

    /**
     * Redessine sur la carte les panneaux d'un champ PV (sourceId) ou de tous (sans argument ; retire
     * alors aussi ceux des champs disparus).
     * @returns {boolean} true si tous les champs visés ont pu être dessinés (sinon, à réessayer)
     */
    function synchroniserPanneauxCarte(sourceId) {
        if (!dependancesPretes()) return false;
        const map = carte();
        purgerMasquagesSiAutreProjet();
        let champs;
        try {
            champs = CM.listerChampsCarte();
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Lecture des champs PV impossible', e);
            return false;
        }
        // Un contour présent sur la carte sans champ PV correspondant : son état n'est pas encore
        // lisible (modules ou sauvegarde locale pas encore prêts) — le dessin est incomplet.
        const mgr = window.MaisonPolygonManagerInstance;
        const idsChamps = new Set(champs.map((c) => c.sourceId));
        let complet = !mgr || (mgr.polygons || [])
            .filter((p) => p && p.maisonId && (!sourceId || p.maisonId === sourceId))
            .every((p) => idsChamps.has(p.maisonId));
        const cibles = sourceId ? champs.filter((c) => c.sourceId === sourceId) : champs;
        if (!sourceId) {
            const presents = new Set(champs.map((c) => c.sourceId));
            Array.from(new Set([...overlaysParSource.keys(), ...zonesParSource.keys(), ...jointsParSource.keys(),
                ...(CM.poteauxCarte ? CM.poteauxCarte.ids() : [])]))
                .forEach((id) => { if (!presents.has(id)) retirerPanneauxCarte(id); });
        } else if (!cibles.length) {
            retirerPanneauxCarte(sourceId);
        }
        cibles.forEach((champ) => {
            synchroniserZoneBordure(champ, map);
            synchroniserJoints(champ, map);
            // Axes et ancrages des poteaux d'ombrière (calepinage_maison_poteaux_ombriere.js) : pilotés
            // par leurs seules cases, jamais masqués avec les panneaux (demande explicite).
            if (CM.poteauxCarte) CM.poteauxCarte.synchroniserChamp(champ, map);
            const rapport = {};
            const panneaux = panneauxLatLng(champ, rapport);
            if (rapport.erreur) complet = false;
            const existant = overlaysParSource.get(champ.sourceId);
            if (!panneaux.length) {
                const overlay = overlaysParSource.get(champ.sourceId);
                if (overlay) overlay.setMap(null);
                overlaysParSource.delete(champ.sourceId);
                return;
            }
            if (existant) {
                existant.setPaths(panneaux);
                if (!existant.getMap() && !existant.__masqueTemporairement) existant.setMap(carteSiVisible(map, champ.sourceId));
            } else {
                overlaysParSource.set(champ.sourceId, nouvelOverlay(STYLE_PANNEAUX_CARTE, panneaux, map, champ.sourceId));
            }
            // Tables de petit champ face au terrain (pente, enfoncement) : analyse relancée, groupée,
            // et sans effet si les tables n'ont pas changé (cf. calepinage_maison_terrain_tables.js).
            if (CM.terrainCarte) CM.terrainCarte.planifier(champ.sourceId);
        });
        return complet;
    }

    /**
     * Resynchronisation COMPLÈTE différée, regroupée et réessayée jusqu'à réussite.
     *
     * CORRECTIF (bug rapporté : "les panneaux ne s'affichent pas sur la carte ; je dois ouvrir le
     * modal du canevas puis le refermer pour qu'ils apparaissent"). Le report des panneaux n'était
     * fait qu'une fois au chargement de la page, et abandonné en silence si un module n'était pas
     * encore prêt ; au changement de projet sans rechargement (parametreProjetFormManager.js::
     * selectAndLoadProject), personne ne le relançait : seul le recalcul déclenché par le modal
     * redessinait les panneaux. Les contours rechargés ('maisonContoursRecharges', émis par
     * restorePolygons ET clearAllPolygons) passent désormais tous par ici.
     */
    const ESSAIS_SYNCHRO_MAX = 20;
    const DELAI_ESSAI_SYNCHRO_MS = 500;
    let minuterieSynchro = null;
    let essaisSynchroRestants = 0;
    function planifierSynchronisationComplete() {
        essaisSynchroRestants = ESSAIS_SYNCHRO_MAX;
        if (minuterieSynchro) return; // déjà prévue : un seul calcul pour une rafale de demandes
        minuterieSynchro = setTimeout(executerSynchronisationPlanifiee, 0);
    }
    function executerSynchronisationPlanifiee() {
        minuterieSynchro = null;
        let complet = false;
        try {
            complet = synchroniserPanneauxCarte();
        } catch (e) {
            console.warn('[CalepinageMaisonPlans] Report des panneaux sur la carte impossible', e);
        }
        if (complet) { essaisSynchroRestants = 0; return; }
        essaisSynchroRestants -= 1;
        if (essaisSynchroRestants > 0) {
            minuterieSynchro = setTimeout(executerSynchronisationPlanifiee, DELAI_ESSAI_SYNCHRO_MS);
        } else {
            console.warn('[CalepinageMaisonPlans] Panneaux de la carte : report incomplet après plusieurs essais.');
        }
    }

    /**
     * Retire temporairement de la carte les panneaux reportés ; renvoie la fonction de restauration.
     */
    function masquerPanneauxCarte() {
        const masques = [];
        // Zones tampons comprises : le canevas les redessine lui-même sur sa capture de fond.
        [...overlaysParSource.values(), ...zonesParSource.values(), ...jointsParSource.values()].forEach((overlay) => {
            if (overlay.getMap()) {
                overlay.__masqueTemporairement = true;
                masques.push({ overlay, map: overlay.getMap() });
                overlay.setMap(null);
            }
        });
        const restaurerTerrain = CM.terrainCarte ? CM.terrainCarte.masquerTemporairement() : null;
        const restaurerPoteaux = CM.poteauxCarte ? CM.poteauxCarte.masquerTemporairement() : null;
        return () => {
            masques.forEach(({ overlay, map }) => {
                overlay.__masqueTemporairement = false;
                overlay.setMap(carteSiVisible(map, overlay.__sourceId));
            });
            if (restaurerTerrain) restaurerTerrain();
            if (restaurerPoteaux) restaurerPoteaux();
        };
    }

    /**
     * Masque ou réaffiche, à la demande de l'utilisateur, les panneaux reportés sur la carte (zone
     * tampon et joints de dilatation compris) d'UN champ PV. Sans `visible` : bascule.
     * @param {string} sourceId
     * @param {boolean} [visible]
     * @returns {boolean} true si les panneaux du champ sont désormais visibles
     */
    function basculerPanneauxCarte(sourceId, visible) {
        if (!sourceId) return true;
        purgerMasquagesSiAutreProjet();
        const masquer = typeof visible === 'boolean' ? !visible : !sourcesMasqueesParUtilisateur.has(sourceId);
        if (masquer) sourcesMasqueesParUtilisateur.add(sourceId);
        else sourcesMasqueesParUtilisateur.delete(sourceId);
        const map = carte();
        [overlaysParSource, zonesParSource, jointsParSource].forEach((registre) => {
            const overlay = registre.get(sourceId);
            if (!overlay || overlay.__masqueTemporairement) return; // une capture en cours le rattachera
            overlay.setMap(masquer ? null : map);
        });
        if (CM.terrainCarte) CM.terrainCarte.synchroniser(sourceId);
        return !masquer;
    }

    const panneauxCarteVisibles = (sourceId) => {
        purgerMasquagesSiAutreProjet();
        return !sourcesMasqueesParUtilisateur.has(sourceId);
    };

    /**
     * Masque, le temps de la capture de fond du canevas, tout ce que le calepinage reporte sur la carte
     * (panneaux, matériels électriques, câbles, marqueurs de coordonnées), déjà redessiné dans le canevas.
     */
    function masquerElementsCarteCalepinage() {
        const restaurations = [masquerPanneauxCarte()];
        if (typeof CM.masquerAnnotationsCarte === 'function') restaurations.push(CM.masquerAnnotationsCarte());
        return () => restaurations.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
    }

    /**
     * Champs PV du calepinage sur canevas, pour les plans : contour et panneaux en {lat, lng}.
     * @returns {Array<{sourceId:string, contour:Array<{lat,lng}>, panneaux:Array<Array<{lat,lng}>>}>}
     */
    function getChamps() {
        if (typeof CM.listerChampsCarte !== 'function' || !window.google || !window.google.maps) return [];
        const plat = (ll) => ({ lat: ll.lat(), lng: ll.lng() });
        let champs = [];
        try {
            champs = CM.listerChampsCarte();
        } catch (e) {
            return [];
        }
        return champs.map((champ) => {
            const poly = window.MaisonPolygonManagerInstance
                && window.MaisonPolygonManagerInstance.polygons.find((p) => p.maisonId === champ.sourceId);
            // Contour : le polygone vivant de la carte fait foi (il a pu être retouché) ; repli sur l'état.
            const contour = poly && typeof poly.getPath === 'function'
                ? poly.getPath().getArray().map(plat)
                : champ.state.roofLocal.map((pt) => plat(CM.localToLatLng(champ.origin, pt)));
            // Contour dans le repère local du canevas (mètres) : CM.latLngToLocal est l'inverse
            // EXACT de CM.localToLatLng (même constante), la retouche éventuelle du polygone sur
            // la carte est donc conservée sans perte.
            const contourLocal = contour.map((ll) =>
                CM.latLngToLocal(champ.origin, new google.maps.LatLng(ll.lat, ll.lng)));
            return {
                sourceId: champ.sourceId,
                contour,
                panneaux: panneauxLatLng(champ).map((coins) => coins.map(plat)),
                // Géométrie exacte (mètres) + son origine, pour les cotations des plans exportés.
                origin: { lat: champ.origin.lat(), lng: champ.origin.lng() },
                contourLocal,
                panneauxLocaux: panneauxLocaux(champ),
            };
        });
    }

    // Champ tout juste tracé : ses panneaux (et sa zone tampon) apparaissent sur la carte sans
    // attendre l'ouverture du modal — listerChampsCarte() construit son état au besoin (cf.
    // orchestrateur::ensureAllSourcesLoaded). Nécessaire en PRO / Grand projet, où le modal ne s'ouvre
    // pas en fin de tracé.
    document.addEventListener('maisonShapeAdded', (e) => {
        const pvId = e && e.detail ? e.detail.pvId : null;
        if (pvId && !synchroniserPanneauxCarte(pvId)) planifierSynchronisationComplete();
    });

    // Contours restaurés au chargement de la page, ou retirés puis rechargés au changement de projet
    // (polygon_maison.js::restorePolygons / clearAllPolygons) : les panneaux suivent, sans détour par
    // le modal. 'maisonShapesRestored' : fin de restauration, même sans contour à restaurer.
    ['maisonContoursRecharges', 'maisonShapesRestored'].forEach((nom) => {
        document.addEventListener(nom, planifierSynchronisationComplete);
    });
    // Restauration déjà faite avant le chargement de ce script : rattrapage.
    if (window.__maisonShapesRestored || (window.MaisonPolygonManagerInstance
        && (window.MaisonPolygonManagerInstance.polygons || []).length)) {
        planifierSynchronisationComplete();
    }

    Object.assign(CM, {
        synchroniserPanneauxCarte, retirerPanneauxCarte, masquerPanneauxCarte, masquerElementsCarteCalepinage,
        basculerPanneauxCarte, panneauxCarteVisibles, planifierSynchronisationComplete,
    });

    window.CalepinageMaisonPlans = {
        getChamps,
        masquerPanneaux: masquerPanneauxCarte,
        synchroniser: () => synchroniserPanneauxCarte(),
        planifierSynchronisation: planifierSynchronisationComplete,
        basculerPanneaux: basculerPanneauxCarte,
        panneauxVisibles: panneauxCarteVisibles,
    };
})();
