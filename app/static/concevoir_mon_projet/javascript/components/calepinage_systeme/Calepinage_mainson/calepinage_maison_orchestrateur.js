/**
 * Calepinage résidentiel — Orchestrateur : état/cycle de vie, persistance localStorage,
 * multi-sources (plusieurs maisons + images importées), point d'entrée public.
 *
 * 4e et dernier fichier de la scission de calepinage_maison_indiv.js — cf.
 * calepinage_maison_calculs.js pour le contexte général du namespace partagé
 * window.CalepinageMaisonIndiv (CM). Chargé en dernier (menu.html) : c'est le seul fichier qui
 * réassigne CM.state dans son ensemble (switchToSource, et — via CM.createDefaultState — le
 * handler "Supprimer le polygone" dans formulaires.js).
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue") : mode d'affichage
    // combiné (lecture seule) — volontairement PAS dans CM.state : c'est un mode transverse au
    // formulaire (comme cmToggleLeftPanelBtn), qui ne doit ni être réinitialisé par switchToSource
    // (changer de maison active ne doit pas le désactiver) ni persisté par maison individuelle.
    CM.multiHouseViewActive = false;

    // --------------------------------------------------------------------------------------
    // État — factory plutôt qu'un littéral unique : plusieurs "sources" (maisons tracées sur la
    // carte + images importées, cf. switchToSource plus bas) doivent pouvoir repartir d'un état
    // vierge chacune, indépendamment des autres.
    // --------------------------------------------------------------------------------------
    function createDefaultState() {
        const state = {
        currentPolygonRef: null,
        roofLocalOrigin: null,
        azimuths: [],
        roofLocal: [],

        mapScreenshotImgObj: null,
        mapScreenshotRef: null,
        mapScreenshotToken: 0,
        showBackgroundImage: false,
        showPanels: true,
        scale: 1, offsetX: 0, offsetY: 0,

        zoomFactor: 1, panOffsetX: 0, panOffsetY: 0, panToolActive: false,

        viewMode: 'real',
        refAngle: 0,

        ridge: null,
        ridgeTemp: null,
        // NOUVEAU (demande explicite : "Diviser en 4 pans symétrique", faîtage ET noue au milieu) :
        // plusieurs lignes typées ({a,b,type:'ridge'|'valley'}), produites par
        // divideInto4PansSymmetric() (calepinage_maison_calculs.js) — `ridge` ci-dessus reste réservé
        // à une seule ligne (Bipente/croupe).
        ridgeLines: [],
        tracingRidge: false,

        // NOUVEAU (demande explicite : "le bouton ligne (trait libre) doit être dans le modal du
        // calepinage résidentiel", retiré de la palette principale de la carte, cf. ButtonControl.js)
        // — même principe que ridge/ridgeTemp/tracingRidge ci-dessus (2 clics = 1 segment), mais
        // plusieurs lignes accumulées (tableau) plutôt qu'une seule : simple annotation/mesure sur le
        // canevas, sans lien avec les panneaux/obstacles. Coordonnées en mètres (repère local du toit,
        // identique aux autres géométries de CM.state).
        freeLines: [],
        freeLineTemp: null,
        tracingFreeLine: false,

        tracingContourRect: false,
        // Points déjà cliqués du rectangle de contour en cours (0, 1 ou 2) — le traçé se fait en
        // 3 clics comme sur la carte réelle (cf. rectFromThreePointsLocal). Transitoire, jamais
        // persisté (absent de PERSISTED_STATE_FIELDS).
        contourRectPoints: [],
        drawingContourPolygon: false,
        contourPolygonPoints: [],
        // NOUVEAU (demande explicite : "polygone libre : panneaux plein sud par défaut, toujours
        // alignés" + "champ azimut") : mode de tracé du contour ('rect'/'polygon', cf.
        // polygon_maison.js::startDraw()/poly.maisonMode) — pour une source 'maps', resynchronisé à
        // chaque ouverture depuis le polygone vivant (cf. openCalepinageMaisonModal()) ; pour une
        // source 'image' (canvas seul), fixé une fois par finalizeContour(points, mode). Décide, avec
        // polygonAzimuthDeg ci-dessous, si l'orientation par défaut/de resync des pans est dérivée de
        // la géométrie du contour (mode 'rect') ou d'une référence constante réglable (mode
        // 'polygon') — cf. resetDivision()/angleForAzimuth() (calepinage_maison_calculs.js).
        contourMode: 'rect',
        // Azimut fixe (0 = plein sud, convention déjà documentée dans le formulaire) utilisé comme
        // référence d'orientation des panneaux UNIQUEMENT en mode 'polygon' — réglable via le champ
        // du formulaire (Monopente uniquement, même restriction que le bouton "Changer l'azimut").
        polygonAzimuthDeg: 0,
        // NOUVEAU (demande explicite : "pour la toiture Monopente, ajoute la possibilité de faire
        // pivoter la flèche par paliers de 90°") : additif à computeLengthEdgeAngle() en mode
        // 'rect' (0/90/180/270) — contrairement à un simple override d'angle, cette valeur ADDITIVE
        // survit aux resynchronisations (openCalepinageMaisonModal(), applyContourDims()), qui
        // recalculent toujours pan.angle depuis la géométrie du contour + cet offset.
        rectAzimuthOffsetDeg: 0,
        divisionMode: 'none',
        lastTwoPanKind: null,
        // NOUVEAU (demande explicite : bouton « Inverser le faîtage », icône de rotation à droite de
        // la section « Géométrie de la toiture ») : false = axe du faîtage sur l'arête la plus longue
        // du contour (comportement historique) ; true = sur la perpendiculaire. Lu par
        // ridgeAxisDir() (calepinage_maison_calculs.js), donc valable pour les 4 divisions
        // (2 pans sym/asym, 4 pans croupe, 4 pans sym) et répercuté sur le calepinage via pan.angle.
        ridgeAxisSwapped: false,
        asymmetryPercent: 40,
        pans: [],
        poseMode: 'incline',

        overhangRampant: 0,
        overhangLongpan: 0,
        // CORRECTIF (demande explicite : "Définir par défaut Nb. PV par shed = 2, Espacement entre
        // shed (m) = 2.5m") : nouveaux défauts pour le cas polygone libre + shed — un shed complet
        // est désormais toujours un empilement de 2 panneaux (cf. le filtre obligatoire dans
        // computeCandidatePanelSlots()), donc 2 est la valeur la plus cohérente par défaut.
        shedSpacingM: 2.5,
        shedPanelsPerGroup: 2,
        // NOUVEAU (demande explicite : "Nb. panneaux en longueur"/"Esp. groupe de shed (mm)", même
        // logique que le calepinage polygonale en shed, cf. LineToShed.js::calculateShedLayout/
        // buildOffsets) : regroupement le long de la RANGÉE (axe X, direction de l'égout) — 0 = pas
        // de regroupement (comportement inchangé, panneaux enchaînés en continu), cohérent avec la
        // convention déjà utilisée par shedPanelsPerGroup/shedSpacingM pour l'axe du rampant (Y).
        shedPanelsPerRow: 0,
        // CORRECTIF (demande explicite : "Définir Esp. groupe de shed (mm) = 0 par défaut") : la
        // case "Sheds réguliers" ne s'active désormais QUE si cette valeur est > 0 (cf.
        // computeCandidatePanelSlots()/formulaires.js) — défaut à 0 = fonctionnalité inactive tant
        // que l'utilisateur ne l'a pas explicitement configurée.
        shedRowGroupSpacingM: 0,
        // NOUVEAU (demande explicite : "ajouter un bouton pour afficher des shed réguliers") : défaut
        // false = comportement actuel (remplissage maximal, colonnes partielles en bord de contour
        // conservées) — cochée, ne garde que les colonnes présentes dans toutes les rangées non
        // vides (cf. computeCandidatePanelSlots(), calepinage_maison_calculs.js).
        shedRegularAlignment: false,
        domeSpacingM: 0.02,
        // CORRECTIF (demande explicite) : valeur par défaut 30 -> 20mm (0.03 -> 0.02 m).
        domePanelSpacingM: 0.02,
        domeTiltDeg: 10,
        // Nombre de panneaux d'une rangée de dôme, moitié de chaque côté du faîtage : 2 (historique,
        // 1 par côté), 4, 6 ... 14 — cf. CM.domePanelsPerRow() (calepinage_maison_calculs.js).
        domePanelsPerRow: 2,
        // 250 mm : défaut du type initial « Toiture résidentielle » (cf. CM.edgeClearanceDefautM,
        // 900 mm en toiture terrasse) — demande explicite.
        edgeClearanceM: 0.25,
        // CORRECTIF (demande explicite : "Largeur faîtage", défaut 500mm total = 250mm par côté) :
        // plage validée 20-2000mm (cf. calepinage_maison_formulaires.js).
        ridgeClearanceEachSideM: 0.25,

        // RETIRÉ (demande explicite) : planningJ* — déplacés vers ParametreProjet.planning_j_*
        // (par projet, cf. parametre.html/personnalisationRapport.js), plus dans l'état calepinage.

        // NOUVEAU (rapport PDF résidentiel — page "Vos Garanties") : durée de garantie (années)
        // par équipement, saisie dans ce même formulaire pour panneau/onduleur/batterie (le champ
        // équivalent pour la borne de recharge vit dans le modal IRVE, cf. calcul_irve.js).
        // CORRECTIF (demande explicite) : garantie onduleur bornée 0-20 ans (au lieu de 0-50),
        // valeur par défaut ramenée à 0 (cf. calepinage_maison_formulaires.js).
        garantiePanneauAns: 20,
        garantieOnduleurAns: 0,
        garantieBatterieAns: 10,
        // NOUVEAU (demande explicite : borne de recharge ajoutée comme équipement du calepinage
        // maison) : champ désactivé côté formulaire tant qu'aucune borne n'est configurée dans le
        // modal "Consommation d'énergie" (cf. updateBorneEquipmentAvailability()). CORRECTIF
        // (demande explicite) : borné 1-10 ans (au lieu de 0-50) une fois activé.
        garantieBorneAns: 1,
        // NOUVEAU (demande explicite) : garantie pompage solaire, bornée 1-5 ans — même activation
        // conditionnelle que pompageSolaireRef (case "Présent" cochée).
        garantiePompageAns: 1,

        obstacles: [],
        selectedObstacleId: null,

        panelToolMode: 'none',
        gridOffsetByPan: new Map(),
        deletedPanelIndicesByPan: new Map(),

        panelParamsInitialized: false,
        panelLengthMm: 1762, panelWidthMm: 1134, panelThicknessMm: 30,
        panelSpacingXMm: 20, panelSpacingYMm: 20,
        panelPowerWc: 470,
        panelOrientation: 'portrait',

        // NOUVEAU (branchement au calcul global de production, cf. getAllPvFieldSummaries plus bas) :
        // équivalent minimal des champs "Panneaux et système" du calepinage rectangulaire/polygonale,
        // strictement limité à ce qu'exige le contrat PvFieldSummary consommé par
        // SummaryModal.js/main_prodsolaire.js (POST /calculate_pv) — pas de sélection
        // batterie/système d'intégration ici, ce contrat ne les utilise pas.
        panelRef: '',
        // CORRECTIF (demande explicite : "Type de structure supportant les panneaux" — nouvelle
        // liste déroulante/nouvelles options, ex-"Type de montage") : collapsé à 'building'/'free'
        // pour PVGIS dans getAllPvFieldSummaries via normalizeTypeMontage() (cf. plus bas) — reconnaît
        // aussi les anciennes valeurs (free/terrasse/sur_imposition/building/ombriere_champ) pour les
        // projets déjà enregistrés n'ayant pas encore rouvert ce champ.
        // CORRECTIF (demande explicite : "Toiture résidentielle" ajoutée en tête de liste) : nouveau
        // défaut pour un calepinage résidentiel tout juste créé — cohérent avec ce module
        // (Calepinage_mainson = calepinage résidentiel). N'affecte aucun projet déjà enregistré
        // (typeMontage persisté, cf. PERSISTED_STATE_FIELDS — ce défaut ne s'applique qu'à un état
        // JAMAIS sauvegardé).
        typeMontage: 'toiture_residentielle',
        // CORRECTIF (demande explicite) : valeur par défaut 14 -> 10%, plage validée 6-30% (cf.
        // calepinage_maison_formulaires.js).
        perteSysteme: 10,
        // Paramètres de production saisis (ou synchronisés avec le pompage solaire) : { penteDeg,
        // perteSysteme } à la date de saisie (ms ; true dans les anciens projets). Une valeur jamais saisie peut recevoir celle du pompage, cf.
        // calepinage_maison_parametres_pompage.js.
        parametresProductionSaisis: {},
        onduleurPuissanceKva: 0,
        onduleurRendement: 97,
        onduleurConso: 0,
        // NOUVEAU (bug rapporté : "l'onduleur choisi n'est plus retrouvé après rechargement") :
        // contrairement à panelRef/batteryRef, aucune référence n'était stockée pour l'onduleur —
        // seules ses caractéristiques numériques l'étaient, insuffisant pour resélectionner la
        // bonne entrée du <select> catalogue (calepinage_maison_formulaires.js::
        // restoreOnduleurSelection()).
        onduleurRef: '',
        // NOUVEAU (demande explicite : champ "Type d'onduleur") : 'Onduleur de chaîne' | 'Hybride' |
        // 'Micro-onduleur', dérivé de la colonne "Technologie" du catalogue au moment du choix (cf.
        // normaliserTypeOnduleur, calepinage_maison_formulaires.js). Mémorisé avec la maison plutôt
        // que recalculé à la volée : le champ reste rempli même si le catalogue tarde à répondre, et
        // c'est lui qui commande le filtre des batteries proposées.
        onduleurTechnologie: '',
        // NOUVEAU (demande explicite : "envoyer les résultats du dimensionnement des chaînes dans le
        // backend, sauvegarde robuste") : reçoit l'écriture de chaines_pertes_modal.js pour cette
        // maison (cf. setMaisonFieldResult()) — une maison résidentielle a presque toujours un seul
        // onduleur, pas de suivi plus fin (fractionRepartitionOnduleur) contrairement au Pro/Grand.
        nbOnduleurs: 1,
        // NOUVEAU (fonctionnalité "Câblage DC") : { [panId]: { mode, strings: [{panelKeys:[...]}],
        // lengths: [{plus, minus, descente, cheminement, custom:{colId:val}}], customColumns:
        // [{id,label}] } } — objet simple (pas de Map/Set) pour rester compatible tel quel avec
        // serializeState()/applyPersistedState() (copie directe champ par champ), cf. cablage_dc.js.
        cablageDc: {},
        affectationCentrale: '1',
        // Batterie : capturée pour la complétude de la fiche équipements de la maison, mais PAS
        // envoyée par getAllPvFieldSummaries (le contrat PvFieldSummary ne la consomme pas).
        batteryRef: '',
        batteryCapaciteKwh: 0,

        // NOUVEAU (demande explicite, ajout matériels BD) : référence catalogue de l'optimiseur choisi
        // (carte "Optimiseur", visible seulement si l'onduleur est compatible optimiseur/hybride —
        // cf. calepinage_maison_formulaires.js::updateOptimiseurCardVisibility) + sa garantie, même
        // statut que batteryRef ci-dessus (capturée pour la fiche équipements, pas envoyée par
        // getAllPvFieldSummaries).
        optimiseurRef: null,
        garantieOptimiseurAns: 0,

        // NOUVEAU (demande explicite : équipement "Pompage solaire" ajouté au calepinage
        // multi-typologie, synchronisé ensuite vers le chiffrage résidentiel — cf.
        // ResidentielCapexTable.js::syncFromCalepinage()).
        pompageSolaireActif: false,
        pompageSolaireRef: '',

        // Système d'intégration (cf. calepinage_maison_systemes_integration.js) : pré-remplit
        // panelSpacingXMm/panelSpacingYMm au choix ; deltaX/deltaY conservés pour cohérence avec ce
        // catalogue mais sans champ dédié dans le formulaire pour l'instant.
        systemeIntegrationRef: '',
        systemeIntegrationDeltaXMm: 0,
        systemeIntegrationDeltaYMm: 0,
        // NOUVEAU (demande explicite) : "Largeur rail" du système d'intégration, en mm — le delta X
        // ajouté à la LONGUEUR de l'ombrière transmise aux plans de coupe/façade (cf.
        // calepinage_maison_dimensions_ombriere.js). Défaut 180 mm, bornes 100-250 mm. Champ visible
        // uniquement pour un type de structure "Ombrière" (cf. updatePoseModeUI, formulaires.js).
        // Distinct de railHeightMm (hauteur de rehausse des panneaux en 3D) et de
        // systemeIntegrationDeltaXMm (valeur catalogue, non saisie).
        railWidthMm: 180,
        // Joints de dilatation (ombrières / bâtiment incliné, cf. paramsJointDilatation dans
        // calepinage_maison_calculs.js) : largeur du joint en mm (10-300) et longueur limite du champ
        // PV au-delà de laquelle un joint est posé, en m (50-100).
        jointDilatationMm: 100,
        jointDilatationLimiteM: 65,
        // 'egale' (défaut) : tronçons égaux ; 'limite' : tronçons coupés à la longueur limite.
        jointDilatationRepartition: 'egale',
        // Toiture terrasse : largeur (mm) de la séparation physique posée tous les 300 m² de
        // panneaux (cf. SEPARATION_TERRASSE, calepinage_maison_calculs.js).
        terrasseSeparationMm: 900,

        showStructure: false,
        // NOUVEAU (demande explicite : "carte Incl./Azim. sur les panneaux, bouton pour les
        // masquer dans le menu horizontal") : visible par défaut (l'utilisateur ne demande qu'un
        // bouton pour la MASQUER) — cf. drawOrientationCard()/getEffectiveInclinaisonDeg()
        // (calepinage_maison_dessin.js) et le bouton du menu horizontal (formulaires.js).
        showOrientationCard: true,
        // NOUVEAU (demande explicite : "icône pour masquer uniquement les cotations dans le menu
        // horizontal") : cotations du contour (vue en plan) et cote du rampant (plan de coupe) —
        // visibles par défaut. Toggle purement visuel, NON persisté (absent de la liste de
        // sérialisation), réinitialisé à true à chaque ouverture — même règle que showOrientationCard.
        showCotations: true,
        // "Pente toiture 1" (demande explicite : défaut 15°) — s'applique à toute la toiture.
        penteDeg: 15,
        // "Pente toiture 2" (demande explicite : défaut 25°) — pente du 2e pan d'une toiture 2 pans
        // ASYMÉTRIQUE (0-90°). Ignoré pour tous les autres types de toiture.
        penteDeg2: 25,
        // NOUVEAU (demande explicite) : objets de contexte 3D posés dans la scène de CETTE maison
        // (arbre, bâtiment voisin, mât d'éclairage...). Éléments { id, typeKey, x, z, rotationDeg,
        // params } — cf. calepinage_maison_3d_objects.js / window.OBJECT_LIBRARY (geometrie_3D).
        sceneObjects3D: [],
        // NOUVEAU (demande explicite) : ombrière choisie depuis le formulaire 2D (typeMontage
        // 'ombriere_metal' / 'ombriere_bois'). `ombriere*Model` = modèle de poteaux (mêmes valeurs
        // que test_3d.html) ; `ombriereParams` = surcharges de l'utilisateur faites depuis la
        // fenêtre 3D (clic droit) — fusionnées par-dessus les défauts + dimensions du plan.
        ombriereMetalModel: 'single',
        // Variante de contreventement V1-V6 du modèle métal « Double Poteaux » (mêmes valeurs que
        // ombriere_metal.html / la fenêtre 3D). Sans effet pour les autres modèles.
        ombriereMetalBracingVariant: 'v1',
        ombriereBoisModel: 'inclinedPost',
        ombriereParams: null,
        // NOUVEAU (demande explicite) : expression des entraxes de poteaux de l'ombriere
        // ("4*10 + 1*7.5 + 1*5"), saisie dans la section "Geometrie de la toiture" du formulaire
        // residentiel (donc aussi dans son miroir PRO). Cle de PREMIER NIVEAU, deliberement HORS de
        // `ombriereParams` : celui-ci est remis a null a chaque filtrage de modeles / changement de
        // type (cf. filtrerModelesOmbriere, calepinage_maison_formulaires.js), ce qui effacait
        // silencieusement la saisie de l'utilisateur (bug rapporte "impossible de passer 4*5+7").
        // null = pas de saisie -> entraxe deduit de la longueur de facade (~6 m par travee).
        ombriereEntraxeExpr: null,
        // NOUVEAU (demande explicite) : position des poteaux dans la largeur et leur affichage sur la
        // carte — cf. calepinage_maison_poteaux_ombriere.js. Clés de PREMIER NIVEAU pour la même
        // raison que ombriereEntraxeExpr. Entraxes transversaux PAR MODÈLE ({ double|linked|
        // doubleYShape: m }, null = défauts du modèle) ; excentrement null = 2 m ; côté null = égout.
        ombriereEntraxeTransversalParModele: null,
        ombriereExcentrementM: null,
        ombriereExcentrementCote: null,
        ombrierePoteauxAxesLong: false,
        ombrierePoteauxAxesTrans: false,
        ombrierePoteauxAncrages: false,
        ombriereFormeAncrage: 'circle',
        // NOUVEAU (demande explicite) : implantation longitudinale — porte-à-faux gauche / droit
        // SAISIS (null = automatique ; un seul des deux fait foi), largeur de place de parking
        // (null = 2,50 m) et place PMR pour les entraxes automatiques, dimensions de référence pour
        // le recalcul quand le rectangle change (cf. CM.poteauxOmbriere.reconcilierDimensions),
        // position des pannes de l'ombrière bois (null = côté, 'top' = sur la traverse).
        ombrierePorteAFauxGaucheM: null,
        ombrierePorteAFauxDroitM: null,
        ombriereLargeurPlaceM: null,
        ombrierePlacePmr: false,
        // Places PMR : nombre (null = ancienne case ombrierePlacePmr, sinon 0) et largeur (null = 3,30 m).
        ombrierePmrNombre: null,
        ombrierePmrLargeurM: null,
        // Largeur du faîtage de la croupe (mm) : ne vivait que dans le champ du formulaire, donc
        // perdue au rechargement (null = 2000 mm, valeur par défaut du champ).
        croupeRidgeWidthMm: null,
        ombrierePoteauxDimsRef: null,
        ombriereBoisPannesPosition: null,
        // Réglages propres aux modales de géométrie d'ombrière, par type de modale
        // ({ metal|bois|solumbra: { communs:{champs,boutons}, parModele?:{[modele]:{champs,boutons}} } }).
        // Demande explicite : persistés en base avec le champ PV (ils ne vivaient que dans le
        // localStorage de la modale, effacé au changement de projet). Clé de PREMIER NIVEAU, hors de
        // `ombriereParams` (remis à null à chaque filtrage de modèles). null = rien de mémorisé : la
        // modale fait foi et ses réglages sont adoptés à sa première ouverture.
        ombriereReglagesModale: null,
        // NOUVEAU (demande explicite) : petit champ solaire (typeMontage 'champ_solaire', calepinage
        // shed). `petitChampModel` = modèle de poteaux (centre/excentre/double/bipente, mêmes valeurs
        // que test_3d.html) ; `petitChampParams` = surcharges faites depuis la fenêtre 3D (clic droit).
        petitChampModel: 'centre',
        // Variante de contreventement du modèle "Double Poteaux" (v1/v2/v3/v4, mêmes valeurs que le
        // configurateur 2D petit_champ_solaire.html). Sans effet pour les autres modèles.
        petitChampBracingVariant: 'v1',
        petitChampParams: null,
        // Couleur des panneaux choisie dans la palette du menu 3D (hex '#rrggbb'), null = couleur par
        // défaut. Appliquée au rendu 3D (bâtiment + ombrière / petit champ solaire) et aux captures.
        panelColor3D: null,
        // Texture des toits en 3D (menu « Toit » de la vue 3D) : null = auto (photo de la vue en plan
        // si une capture de carte est affichée, sinon texture selon le type de toiture), 'ardoise',
        // 'tuile', 'bac_acier', 'membrane', 'gravillons' ou 'uni' (cf. calepinage_maison_3d_textures_toit.js).
        roofTexture3D: null,
        // "Hauteur bas structure (m)" du petit champ solaire — hauteur du point bas de la structure
        // au-dessus du sol (« Hauteur bas PV »). Défaut 0,5 m, bornes 0,3–5 m (demande explicite). Alimente
        // computePetitChampCommon.lowPointHeight (cf. getFormPetitChampObject).
        petitChampLowPointHeightM: 0.8,
        coupePanIndex: 0,
        chevronSpacingM: 0.6,
        panneSpacingM: 1.2,
        liteauSpacingM: 0.35,
        // NOUVEAU (demande explicite, génération 3D) : hauteur sol -> gouttière du bâtiment (m) et
        // hauteur du système d'intégration / des rails au-dessus de la couverture (mm). Consommés par
        // calepinage_maison_3d_geometry.js / calepinage_maison_3d_viewer.js.
        batimentHeightM: 3,
        railHeightMm: 30,
        // NOUVEAU (demande explicite) : hauteur d'acrotère (garde-corps périphérique d'une toiture
        // terrasse). Utilisé uniquement quand typeMontage = 'toiture_terrasse' (champ masqué sinon,
        // cf. updatePoseModeUI). Pris en compte dans le modèle 3D.
        acrotereHeightM: 1,
        // NOUVEAU (demande explicite) : type de faîtage pour une toiture 2 pans ASYMÉTRIQUE.
        //  'sans' (défaut) = V inversé, les 2 pans se rejoignent sur une seule ligne de faîtage.
        //  'avec' = partie verticale au faîtage (pente identique des 2 côtés -> clerestory, bois).
        // Effet 3D uniquement (calepinage_maison_3d_geometry.js) — le calepinage 2D (vue de dessus)
        // n'est pas concerné.
        faitageAsymType: 'sans',

        orthoMode: true,
        // NOUVEAU (demande explicite) : sélecteur "Vue 2D/3D" — purement bascule pour l'instant, le
        // rendu 3D sera ajouté ultérieurement (cf. cmView2D3DBtn, formulaires.js).
        view3DMode: false,

        sourceType: 'maps',
        sourceId: null,
        sourceLabel: null,
        };
        // Projet avec pompage solaire : un champ PV qui naît reprend l'inclinaison et les pertes
        // déjà saisies (cf. calepinage_maison_parametres_pompage.js). Un état restauré les remplace
        // ensuite par ses propres valeurs (applyPersistedState).
        if (typeof CM.valeursPompageInitiales === 'function') Object.assign(state, CM.valeursPompageInitiales());
        return state;
    }
    CM.state = createDefaultState();
    // sourceId -> état complet sauvegardé (cf. switchToSource) — local à ce fichier (seul lecteur).
    const savedStatesBySourceId = new Map();

    /**
     * CORRECTIF (bug rapporté, gravissime : "on enregistre un calepinage, on change de projet, on
     * revient sur le projet initial : le calepinage s'est désorganisé").
     *
     * Ces caches mémoire (savedStatesBySourceId, knownSources, deletedSourceIds, CM.state) vivent
     * aussi longtemps que la PAGE, alors qu'on peut changer de projet SANS rechargement (cf.
     * parametreProjetFormManager.js::selectAndLoadProject, qui se contente de vider le localStorage,
     * de réhydrater depuis la base et de redessiner les contours). Ils n'étaient jamais purgés.
     *
     * Or les identifiants de maison repartent de PV1 dans chaque projet : au retour, la maison PV1
     * du projet rouvert retrouvait en mémoire l'état de la PV1 de l'AUTRE projet, et comme
     * `isFirstOpenThisSession` se déduit précisément de la présence de cette entrée, la persistance
     * du bon projet n'était alors JAMAIS relue. Le modal affichait donc des pans, des orientations
     * et des obstacles étrangers, appliqués au contour du projet courant — un calepinage
     * "désorganisé", et une fuite de données entre projets.
     *
     * On mémorise donc à quel projet appartient le contenu de ces caches, et on les vide dès que le
     * projet actif change. Appelée en tête des 2 points d'entrée qui les lisent
     * (openCalepinageMaisonModal et ensureAllSourcesLoaded).
     */
    let sessionCacheProjetId = null;
    function ensureSessionCacheMatchesProject() {
        let projetId = null;
        try { projetId = localStorage.getItem('current_projet_id'); } catch (e) { /* ignore */ }
        if (sessionCacheProjetId !== null && String(sessionCacheProjetId) !== String(projetId)) {
            savedStatesBySourceId.clear();
            knownSources.length = 0;
            deletedSourceIds.clear();
            // L'état courant appartient lui aussi à l'ancien projet (le modal est fermé à ce
            // stade : un changement de projet passe par le modal "Mes projets").
            CM.state = createDefaultState();
        }
        sessionCacheProjetId = projetId;
    }

    /**
     * Purge INCONDITIONNELLE des caches mémoire, au changement de projet (cf.
     * parametreProjetFormManager.js::selectAndLoadProject).
     *
     * CORRECTIF (bug rapporté : "à l'ouverture d'un projet, les panneaux de certains champs ne
     * s'affichent pas et la flèche du label est mal orientée") : ensureSessionCacheMatchesProject()
     * ne purge qu'à la PREMIÈRE lecture après la bascule de current_projet_id. Or cette bascule
     * précède de plusieurs requêtes le rechargement des contours : une lecture faite entre-temps
     * (totaux, report des panneaux, sauvegarde automatique...) purgeait bien, puis reconstruisait
     * aussitôt un état PAR DÉFAUT (cf. fallbackState) pour chaque contour de l'ANCIEN projet encore
     * sur la carte, rangé sous l'id du nouveau projet. Les champs homonymes (PV1...) du projet rouvert
     * étaient ensuite lus dans ce cache au lieu de leur sauvegarde. Appelée avant ET après
     * l'hydratation depuis la base.
     */
    function purgerCachesProjet() {
        savedStatesBySourceId.clear();
        knownSources.length = 0;
        deletedSourceIds.clear();
        CM.state = createDefaultState();
        try { sessionCacheProjetId = localStorage.getItem('current_projet_id'); } catch (e) { sessionCacheProjetId = null; }
    }

    // CORRECTIF (bug rapporté : "un champ PV supprimé réapparaît en vue 3D / dans les totaux, ses
    // obstacles restent") : un champ PV (maison) supprimé cette session ne doit JAMAIS être rechargé
    // depuis le cache (localStorage calepinage_maison_v1) ni depuis un contour encore présent une
    // frame sur la carte. On mémorise ses ids ici ; ensureAllSourcesLoaded() / getOtherHousesReprojected()
    // les ignorent. registerSource() lève le marquage si un vrai nouveau contour reprend cet id.
    const deletedSourceIds = new Set();

    // Initialise les caractéristiques panneau une seule fois (1re ouverture du modal), depuis le
    // formulaire de calepinage existant s'il contient déjà des valeurs, sinon les valeurs par
    // défaut (1762x1134x30mm, espacement 20x20mm).
    function initPanelParamsIfNeeded() {
        if (CM.state.panelParamsInitialized) return;
        CM.state.panelParamsInitialized = true;
        const lEl = document.getElementById('longueurPanneau');
        const wEl = document.getElementById('largeurPanneau');
        const pEl = document.getElementById('puissancePanneau');
        const paysageEl = document.getElementById('modePosePaysage');
        const l = lEl ? parseFloat(lEl.value) : 0;
        const w = wEl ? parseFloat(wEl.value) : 0;
        const p = pEl ? parseFloat(pEl.value) : 0;
        CM.state.panelLengthMm = l > 0 ? l : 1762;
        CM.state.panelWidthMm = w > 0 ? w : 1134;
        CM.state.panelThicknessMm = 30;
        CM.state.panelPowerWc = p > 0 ? p : 470;
        CM.state.panelSpacingXMm = 20;
        CM.state.panelSpacingYMm = 20;
        CM.state.panelOrientation = paysageEl && paysageEl.checked ? 'paysage' : 'portrait';
    }

    // NOUVEAU (demande explicite : "quand il y a plus de 1 champ PV, afficher dans le total la
    // somme des panneaux PV1, PV2... et les résultats par pan de toiture toujours visibles") :
    // agrège TOUTES les maisons connues (pas seulement celle actuellement affichée) — même source de
    // données que getAllPvFieldSummaries (cf. ensureAllSourcesLoaded), calculée à chaque
    // recomputeResults() pour rester à jour à chaque changement, quelle que soit la maison active.
    function computeAllHousesResultsSummary() {
        ensureAllSourcesLoaded();
        let totalCount = 0;
        const perPan = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (deletedSourceIds.has(sourceId)) return; // champ PV supprimé cette session
            // CORRECTIF (même bascule que getAllPvFieldSummaries) : packPanelsForPan lit CM.state en
            // global (obstacles/espacements/pente/dimensions...), jamais `state` — sans cette bascule,
            // les maisons AUTRES que l'active étaient comptées avec les réglages de l'active.
            const previousState = CM.state;
            CM.state = state;
            const panelsByPan = (state.pans || []).map((pan) => CM.packPanelsForPan(pan));
            CM.state = previousState;

            // Dôme : une puce par côté (azimut propre), comme les champs envoyés au calcul.
            (state.pans || []).forEach((pan, i) => {
                champsDuPan(pan, panelsByPan[i], state).forEach((champ) => {
                    const count = champ.panelCount;
                    if (champ.domeCote != null && !count) return;
                    totalCount += count;
                    const id = champ.domeCote != null ? `${pan.id} · Dôme ${champ.domeCote + 1}` : pan.id;
                    perPan.push({ sourceId, id, azimuth: champ.azimuth, count, powerKwc: (count * (state.panelPowerWc || 0)) / 1000 });
                });
            });
        });
        const totalPowerKwc = perPan.reduce((sum, p) => sum + p.powerKwc, 0);
        return { totalCount, totalPowerKwc, perPan, houseCount: savedStatesBySourceId.size };
    }

    /**
     * Largeur des puces de la carte de résultats.
     *
     * Elles sont ÉLASTIQUES (demande explicite : « il y a de la place pour mettre les cartes sur une
     * même ligne horizontale et augmenter la longueur de chacune ») : `flex: 1 1 BASE` les fait
     * grandir pour occuper toute la largeur disponible, au lieu d'une largeur figée qui laissait les
     * deux tiers de la ligne vides et tronquait « P. max simultanée » en « P. max simultan… ».
     *
     * BASE est la largeur minimale qui affiche ce libellé en entier ; MAX évite des puces absurdement
     * larges quand il n'y en a que deux ou trois.
     */
    const PUCE_BASE_PX = 134;
    const PUCE_MAX_PX = 240;

    /**
     * Puce « libellé / valeur » de la carte de résultats : deux fonds distincts (demande explicite)
     * — gris pour le titre, clair pour la valeur mise en évidence.
     * @param {string} titre - libellé court (doit tenir dans PUCE_BASE_PX)
     * @param {string} valeur - valeur affichée
     * @param {string} aide - texte d'infobulle, qui porte l'intitulé complet
     * @param {string} [couleurValeur] - couleur du texte de la valeur
     */
    function puceResultat(titre, valeur, aide, couleurValeur) {
        return `
            <div style="flex:1 1 ${PUCE_BASE_PX}px; min-width:${PUCE_BASE_PX}px; max-width:${PUCE_MAX_PX}px;
                        border:1px solid #d1d5db; border-radius:4px; overflow:hidden;" title="${aide}">
                <div style="background:#e5e7eb; color:#374151; font-size:0.7rem; font-weight:600;
                            padding:3px 5px; text-align:center; white-space:nowrap; overflow:hidden;
                            text-overflow:ellipsis;">${titre}</div>
                <div style="background:#f8fafc; color:${couleurValeur || '#111827'}; font-size:0.8rem;
                            font-weight:700; padding:3px 5px; text-align:center; white-space:nowrap;
                            overflow:hidden; text-overflow:ellipsis;">${valeur}</div>
            </div>`;
    }

    /**
     * Bandeau « pré-dimensionnement du site isolé » affiché sous le total du calepinage.
     *
     * Les 6 grandeurs viennent toutes du calcul d'autonomie du back-end (modal « Consommation
     * d'énergie », section 2) : ce sont les contraintes que le calepinage doit satisfaire, utiles à
     * garder sous les yeux pendant qu'on dessine.
     *
     * Retourne les PUCES SEULES, sans conteneur : elles rejoignent la même ligne flex que le détail
     * par pan (cf. recomputeResults) — demande explicite, il restait sinon les deux tiers de la
     * ligne inoccupés pendant que le pan passait tout seul à la ligne suivante. Elles sont placées
     * APRÈS les puces de pan (demande explicite : « placer la carte Pan 1 avant Besoin
     * journalier ») : le résultat du calepinage vient d'abord, les contraintes de
     * pré-dimensionnement ensuite.
     *
     * N'apparaît que pour un projet « Site autonome ou Projet PV Hybride » ET si le
     * pré-dimensionnement a déjà été lancé. Lecture SYNCHRONE (cache localStorage scopé projet) :
     * appelée à chaque geste de dessin, un appel réseau y serait exclu.
     */
    function renderPucesSiteAutonome() {
        if (typeof window.isSiteAutonomeProject !== 'function' || !window.isSiteAutonomeProject()) return '';
        if (!window.SiteAutonomySummary) return '';

        const s = window.SiteAutonomySummary.read();
        if (!s) return '';

        // CORRECTIF (bug rapporté : « P. max simultanée n'affiche aucune valeur ») : cette grandeur
        // a été ajoutée à la réponse du back-end APRÈS la mise en cache de certains résumés. Un
        // résumé enregistré avant ne la contient pas, et la cellule restait vide sans dire
        // pourquoi. Elle est désormais affichée comme MANQUANTE (tiret grisé), avec la marche à
        // suivre en infobulle — un simple « Calculer l'autonomie » régénère le résumé complet.
        const RELANCE = " — valeur absente de ce résumé : relancez « Calculer l'autonomie » (modal Consommation d'énergie) pour l'obtenir.";
        const cellule = (titre, valeur, unite, decimales, aide) => {
            const connue = typeof valeur === 'number' && isFinite(valeur);
            return puceResultat(
                titre,
                connue ? `${valeur.toFixed(decimales)} ${unite}` : '–',
                connue ? aide : aide + RELANCE,
                connue ? null : '#9ca3af'
            );
        };
        const consoAnnuelleMwh = typeof s.consommationAnnuelleKwh === 'number'
            ? s.consommationAnnuelleKwh / 1000 : null;

        const puces = [
            cellule('Besoin journalier', s.besoinJournalierKwh, 'kWh/j', 1,
                'Besoin journalier moyen du site, hors bornes IRVE.'),
            cellule('Conso. annuelle', consoAnnuelleMwh, 'MWh/an', 1,
                "Besoin journalier ramené à l'année (× 365)."),
            cellule('P. max simultanée', s.puissanceMaxSimultaneeKw, 'kW', 2,
                'Puissance maximale appelée simultanément par le site (hors IRVE, avant foisonnement).'),
            cellule('Capacité batterie', s.capaciteBatterieKwh, 'kWh', 1,
                "Capacité de stockage nécessaire pour le nombre de jours d'autonomie demandé."),
            cellule('P. onduleur', s.puissanceOnduleurKva, 'kVA', 2,
                "Puissance d'onduleur nécessaire (puissance max simultanée × coefficient d'évolution)."),
            cellule('Autonomie cible', s.cibleAutonomiePct, '%', 0,
                "Part du besoin du site à couvrir par le solaire, saisie dans le pré-dimensionnement."),
        ].join('');

        return puces;
    }

    /**
     * Invite à lancer le pré-dimensionnement, affichée à la place des puces tant qu'aucun calcul
     * d'autonomie n'a été fait. Séparée des puces : c'est une phrase, elle n'a pas sa place dans la
     * ligne de cartes.
     */
    function renderMessageSiteAutonome() {
        if (typeof window.isSiteAutonomeProject !== 'function' || !window.isSiteAutonomeProject()) return '';
        if (!window.SiteAutonomySummary || window.SiteAutonomySummary.read()) return '';
        return `<div style="font-size:0.75rem; color:#9ca3af; margin:2px 0 4px;">Pré-dimensionnement site isolé : lancez « Calculer l'autonomie » (modal Consommation d'énergie).</div>`;
    }

    function recomputeResults() {
        if (!CM.resultsEl) return;

        // Surface maximale du contour (rectangle/polygone, cf. config.py) : un contour trop grand
        // (ex. enregistré avant l'ajout de cette limite) bloque le calcul jusqu'à ce qu'il soit redessiné.
        const depSurface = typeof CM.depassementSurfaceContour === 'function'
            ? CM.depassementSurfaceContour(CM.state.roofLocal, CM.state.contourMode, true, 0.005)
            : null;
        if (depSurface) {
            const msg = window.MaisonPolygonManager.messageSurfaceDepassee(depSurface);
            CM.resultsEl.innerHTML = `
                <div style="font-weight:700; color:#dc2626; padding:8px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; margin:4px 0;">
                    <i class="fas fa-ban" style="margin-right:6px;"></i>${msg}
                </div>
            `;
            if (typeof window.setCalculerVisualiserDisabled === 'function') {
                window.setCalculerVisualiserDisabled(true, msg);
            }
            const cmBtn = document.getElementById('cmCalculerVisualiserBtn');
            if (cmBtn) {
                cmBtn.disabled = true;
                cmBtn.classList.add('disabled');
                cmBtn.title = msg;
            }
            if (typeof CM.retirerPanneauxCarte === 'function') CM.retirerPanneauxCarte(CM.state.sourceId);
            return;
        }

        const summary = computeAllHousesResultsSummary();

        // CONTRÔLE STRICT DE LA LICENCE (Tolérance configurable, ex: +10%)
        if (typeof window.checkPowerLicenceCompliance === 'function') {
            const licenceCheck = window.checkPowerLicenceCompliance(summary.totalPowerKwc);
            if (licenceCheck && (licenceCheck.allowed === false || licenceCheck.compliant === false)) {
                const maxAllowedKwc = licenceCheck.maxAllowedKwc ?? licenceCheck.max_allowed_kwc;
                const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                const tol = licenceCheck.tolerancePercent ?? licenceCheck.tolerance_percent ?? 10;

                // 1. Bloquer l'affichage des résultats ("Ne rien afficher du tout" / notification claire de refus)
                CM.resultsEl.innerHTML = `
                    <div style="font-weight:700; color:#dc2626; padding:8px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; margin:4px 0;">
                        <i class="fas fa-ban" style="margin-right:6px;"></i>
                        [Licence PV Dépassée] La puissance totale calculée (${summary.totalPowerKwc.toFixed(2)} kWc) dépasse la puissance maximale autorisée par votre licence (${maxAllowedStr} kWc avec tolérance de ${tol}%). Calcul et affichage bloqués.
                    </div>
                `;

                // 2. Désactiver le bouton "Calculer et visualiser"
                if (typeof window.setCalculerVisualiserDisabled === 'function') {
                    window.setCalculerVisualiserDisabled(true, `Puissance totale (${summary.totalPowerKwc.toFixed(2)} kWc) supérieure au plafond de licence (${maxAllowedStr} kWc).`);
                }
                const cmBtn = document.getElementById('cmCalculerVisualiserBtn');
                if (cmBtn) {
                    cmBtn.disabled = true;
                    cmBtn.classList.add('disabled');
                    cmBtn.title = `Puissance (${summary.totalPowerKwc.toFixed(2)} kWc) supérieure au plafond de votre licence (${maxAllowedStr} kWc)`;
                }

                // 3. Annuler les panneaux reportés sur la carte pour ce champ
                if (typeof CM.retirerPanneauxCarte === 'function') {
                    CM.retirerPanneauxCarte(CM.state.sourceId);
                }
                return;
            } else {
                if (typeof window.setCalculerVisualiserDisabled === 'function') {
                    window.setCalculerVisualiserDisabled(false);
                }
                const cmBtn = document.getElementById('cmCalculerVisualiserBtn');
                if (cmBtn) {
                    cmBtn.disabled = false;
                    cmBtn.classList.remove('disabled');
                    cmBtn.removeAttribute('title');
                }
            }
        }

        // Une seule maison connue : affichage inchangé (pas de préfixe PVn, redondant).
        const showHousePrefix = summary.houseCount > 1;
        // NOUVEAU (demande explicite : "aligner les résultats sur une même ligne horizontale pour
        // gagner de la hauteur verticale") : les pans s'affichent en ligne (flex-wrap), plutôt qu'un
        // <div> par pan empilé verticalement — et, dès qu'il y a plus d'une maison, TOUS les pans de
        // TOUTES les maisons (pas seulement celle affichée), préfixés par leur maison d'origine.
        CM.resultsEl.innerHTML = `
            <div style="font-weight:700; margin-bottom:4px;">Total : ${summary.totalCount} panneau(x) — ${summary.totalPowerKwc.toFixed(2)} kWc</div>
            ${renderMessageSiteAutonome()}
            <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:stretch;">
                ${summary.perPan.map((p) => puceResultat(
                    `${showHousePrefix ? `${p.sourceId} - ` : ''}${p.id} (${p.azimuth}°)`,
                    `${p.count} · ${p.powerKwc.toFixed(2)} kWc`,
                    `${showHousePrefix ? `${p.sourceId} — ` : ''}${p.id}, azimut ${p.azimuth}° : ${p.count} panneau(x), ${p.powerKwc.toFixed(2)} kWc.`
                )).join('')}
                ${renderPucesSiteAutonome()}
            </div>
        `;
        // Demande explicite : longueur / largeur du champ modifiées -> entraxes et excentrements
        // recalculés pour que les poteaux restent dans le rectangle (avant la sauvegarde).
        if (CM.poteauxOmbriere && typeof CM.poteauxOmbriere.reconcilierDimensions === 'function') {
            try { CM.poteauxOmbriere.reconcilierDimensions(CM.state); } catch (e) { console.warn("[CalepinageMaison] Poteaux d'ombrière : recalcul impossible", e); }
        }
        persistCurrentState();
        // Panneaux du champ PV affiché reportés sur la carte principale (visibles sur la page et
        // capturés sur les plans), cf. calepinage_maison_carte_plans.js.
        if (typeof CM.synchroniserPanneauxCarte === 'function') CM.synchroniserPanneauxCarte(CM.state.sourceId);
        // Rebâtit la visionneuse 3D si elle est ouverte (no-op sinon) — point unique appelé après
        // CHAQUE action discrète (division du toit, édition de panneaux/obstacles, contour...), jamais
        // pendant un glisser (onDocumentMouseMove n'appelle que render(), pas recomputeResults()).
        if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
        // Messages de la section "Système d'intégration" (joints de dilatation, séparation du champ
        // en toiture terrasse) : ils dépendent des panneaux posés, recalculés à chaque action.
        if (typeof CM.majInfosSystemeIntegration === 'function') CM.majInfosSystemeIntegration();
        // NOUVEAU (demande explicite : "les 2 formulaires doivent être synchronisés") : signale que
        // l'état du champ affiché vient d'être recalculé. Émis ici parce que recomputeResults() est
        // le point de passage de TOUTE action discrète du modal (type de calepinage, division du
        // toit, panneaux, obstacles, contour...). Consommé par calepinage_maison_form_pro.js pour
        // remettre le formulaire PRO/Grand projet en accord. Événement dédié (et non
        // 'calepinageMaisonFieldChanged', réservé aux écritures persistées par
        // setMaisonFieldResult) : les abonnés de ce dernier déclenchent une sauvegarde, inutile ici.
        document.dispatchEvent(new CustomEvent('calepinageMaisonEtatRecalcule', {
            detail: { sourceId: CM.state.sourceId },
        }));
    }

    // --------------------------------------------------------------------------------------
    // Persistance localStorage (cf. calepinage_persistence.js, fichier dédié)
    // --------------------------------------------------------------------------------------
    const PERSISTED_STATE_FIELDS = [
        // CORRECTIF (bug rapporté : "le canevas toiture/panneaux ne s'affiche jamais dans le rapport
        // PDF" — root-causé par investigation directe) : roofLocal (le contour, un tableau de points
        // {x,y} en mètres locaux — déjà JSON-sérialisable, même nature que pans[].points ci-dessous)
        // manquait ici. Toute maison ayant un état persisté (le cas normal) mais n'étant PAS la
        // maison actuellement ouverte se voit reconstruite par ensureAllSourcesLoaded() via
        // applyPersistedState(), qui ne copie QUE les champs listés ici — roofLocal restait donc
        // vide, faisant échouer silencieusement computeFit()/render() (calepinage_maison_dessin.js,
        // qui commencent tous deux par `if (!CM.state.roofLocal.length) return;`) lors de la capture
        // hors-écran pour le rapport PDF (captureRoofDiagramImage(), appelée par ExportService.js
        // pour toute maison qui n'est pas ouverte dans la session en cours — le cas normal lors d'une
        // génération de rapport). roofLocalOrigin (une référence google.maps.LatLng, pas un objet
        // plat) et refAngle/azimuths (non lus par le chemin de rendu — l'azimut de chaque pan est
        // déjà porté par pan.azimuth, dans pans, déjà persisté) volontairement PAS ajoutés.
        'roofLocal',
        // freeLines : demande explicite (bouton ligne/trait libre déplacé dans ce modal, cf.
        // ButtonControl.js/calepinage_maison_dessin.js) — même round-trip que 'ridge' juste après
        // (tableau JSON-sérialisable de {p1:{x,y}, p2:{x,y}} en mètres), freeLineTemp/tracingFreeLine
        // volontairement absents (état transitoire de tracé, même principe que ridgeTemp/tracingRidge).
        'freeLines',
        'showBackgroundImage', 'showPanels', 'scale', 'offsetX', 'offsetY', 'zoomFactor', 'panOffsetX',
        'panOffsetY', 'panToolActive', 'viewMode', 'ridge', 'ridgeLines', 'divisionMode', 'lastTwoPanKind',
        'asymmetryPercent', 'ridgeAxisSwapped', 'pans', 'poseMode', 'overhangRampant', 'overhangLongpan', 'shedSpacingM',
        'shedPanelsPerGroup', 'shedPanelsPerRow', 'shedRowGroupSpacingM', 'domeSpacingM', 'domePanelSpacingM', 'domeTiltDeg', 'domePanelsPerRow', 'edgeClearanceM',
        'ridgeClearanceEachSideM', 'obstacles', 'panelParamsInitialized', 'panelLengthMm', 'panelWidthMm',
        'panelThicknessMm', 'panelSpacingXMm', 'panelSpacingYMm', 'panelPowerWc', 'panelOrientation',
        'showStructure', 'penteDeg', 'penteDeg2', 'chevronSpacingM', 'panneSpacingM', 'liteauSpacingM', 'orthoMode',
        // 'view3DMode' VOLONTAIREMENT retiré de la persistance : bascule de vue purement transitoire
        // (comme les 3 toggles d'en-tête) — persisté, il restait "true" après un passage en 3D, ce qui
        // désynchronisait l'UI et déclenchait à tort du code lié à la 3D (dont un nudge Google Maps
        // qui cassait la capture d'écran). Toujours réinitialisé à false à l'ouverture (createDefaultState).
        'batimentHeightM', 'railHeightMm', 'faitageAsymType', 'acrotereHeightM', 'sceneObjects3D',
        'ombriereMetalModel', 'ombriereMetalBracingVariant', 'ombriereBoisModel', 'ombriereParams', 'ombriereEntraxeExpr',
        // Réglages propres aux modales de géométrie d'ombrière (porte-à-faux, renfort, entraxe,
        // inclinaison, altimétrie) — cf. calepinage_maison_dimensions_ombriere.js::REGLAGES_MODALE.
        'ombriereReglagesModale',
        // Poteaux d'ombrière : entraxes transversaux, excentrement, affichage sur la carte.
        'ombriereEntraxeTransversalParModele', 'ombriereExcentrementM', 'ombriereExcentrementCote',
        'ombrierePoteauxAxesLong', 'ombrierePoteauxAxesTrans', 'ombrierePoteauxAncrages', 'ombriereFormeAncrage',
        // Implantation longitudinale (porte-à-faux, place de parking, PMR) et pannes de l'ombrière bois.
        'ombrierePorteAFauxGaucheM', 'ombrierePorteAFauxDroitM', 'ombriereLargeurPlaceM', 'ombrierePlacePmr',
        'ombrierePmrNombre', 'ombrierePmrLargeurM', 'croupeRidgeWidthMm',
        'ombrierePoteauxDimsRef', 'ombriereBoisPannesPosition',
        'petitChampModel', 'petitChampBracingVariant', 'petitChampParams', 'petitChampLowPointHeightM',
        'panelColor3D', 'roofTexture3D',
        'garantiePanneauAns', 'garantieOnduleurAns', 'garantieBatterieAns', 'garantieBorneAns', 'garantiePompageAns',
        // NOUVEAU (demande explicite, ajout matériels BD) : référence catalogue optimiseur + sa garantie.
        'optimiseurRef', 'garantieOptimiseurAns',
        'panelRef', 'typeMontage', 'perteSysteme', 'parametresProductionSaisis', 'onduleurPuissanceKva', 'onduleurRendement', 'onduleurConso', 'onduleurRef',
        'onduleurTechnologie',
        'nbOnduleurs', 'fractionRepartitionOnduleur', 'cablageDc', 'contourMode', 'polygonAzimuthDeg', 'rectAzimuthOffsetDeg',
        // CORRECTIF (demande explicite : "afficher par défaut la carte Incl/Azim") :
        // showOrientationCard retiré d'ici — une maison sauvegardée avec cette carte masquée gardait
        // cet état de façon permanente, l'emportant sur la valeur par défaut (true, cf.
        // createDefaultState()) à chaque rechargement. Devient un toggle purement visuel, non
        // persisté, toujours réinitialisé à true à l'ouverture — même principe déjà appliqué aux 3
        // toggles de l'en-tête (Formulaire/Barre d'outils/Résultats).
        'shedRegularAlignment',
        'affectationCentrale', 'batteryRef', 'batteryCapaciteKwh', 'systemeIntegrationRef',
        'systemeIntegrationDeltaXMm', 'systemeIntegrationDeltaYMm', 'railWidthMm',
        'jointDilatationMm', 'jointDilatationLimiteM', 'jointDilatationRepartition', 'terrasseSeparationMm',
        'pompageSolaireActif', 'pompageSolaireRef',
        // Lignes tracées sur la carte (outil Profil altimétrique) utilisées pour le terrain des plans
        // de coupe / façade de ce champ, cf. calepinage_maison_terrain.js::affecterLigne.
        'terrainLignesPlans',
        // Panneaux retirés depuis la fenêtre « Terrain des champs solaires » (tables hors seuils,
        // ajustement, tables / rangées supprimées à la main), pour pouvoir les restaurer sans toucher
        // aux suppressions faites dans le canevas, cf. calepinage_maison_terrain_tables.js.
        'terrainTablesRetirees',
        // Réglages du terrain : garde min en % (bas PV et traverse), pente max en %, ancrage enterré (m).
        'terrainSeuils',
        // Case « prendre en compte le terrain » (modal Résultats des sheds) et dernier résultat
        // d'ombrage entre sheds (perte plate, perte avec terrain, pente et azimut réels, signature),
        // lus par getAllPvFieldSummaries pour la production, cf.
        // calepinage_maison_sheds_actions.js::ombragePourProduction.
        'ombrageTerrainProduction', 'ombrageShedsResultat',
    ];

    function serializeState(s) {
        const out = {};
        PERSISTED_STATE_FIELDS.forEach((key) => { out[key] = s[key]; });
        out.gridOffsetByPan = Array.from(s.gridOffsetByPan.entries());
        out.deletedPanelIndicesByPan = Array.from(s.deletedPanelIndicesByPan.entries())
            .map(([panId, set]) => [panId, Array.from(set)]);
        // Origine du repère local (cf. recalerSurOrigine) : objet plat, la LatLng n'étant pas sérialisable.
        const o = s.roofLocalOrigin;
        out.roofLocalOriginLatLng = (o && typeof o.lat === 'function') ? { lat: o.lat(), lng: o.lng() } : null;
        return out;
    }

    /**
     * Bug rapporté : « au rechargement, le polygone du petit champ solaire se déplace parfois ».
     * roofLocal, pans, obstacles, lignes, objets 3D et calage du fond de carte sont enregistrés en
     * mètres dans le repère dont l'origine est le 1er sommet du contour AU MOMENT où ils ont été
     * établis. Au rechargement, l'origine reprise est le 1er sommet du contour actuel : s'il a changé
     * entre-temps (sommet 0 déplacé ou supprimé depuis le canevas, contour réécrit depuis le canevas),
     * toute la géométrie enregistrée glissait d'autant par rapport au contour et au fond de carte.
     * On la recale ici de l'origine enregistrée vers la nouvelle (translation au sol).
     * @param {Object} state - état restauré (géométrie dans le repère de `ancienne`)
     * @param {{lat:number, lng:number}|null} ancienne - origine enregistrée (roofLocalOriginLatLng)
     * @param {google.maps.LatLng} nouvelle - origine retenue (1er sommet du contour vivant)
     */
    function recalerSurOrigine(state, ancienne, nouvelle) {
        if (!state || !ancienne || !nouvelle || !Number.isFinite(ancienne.lat) || !Number.isFinite(ancienne.lng)) return;
        const d = CM.latLngToLocal(nouvelle, new google.maps.LatLng(ancienne.lat, ancienne.lng));
        if (Math.hypot(d.x, d.y) < 1e-4) return;
        const pt = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p, x: p.x + d.x, y: p.y + d.y } : p);
        const seg = (s, k1, k2) => (s ? { ...s, [k1]: pt(s[k1]), [k2]: pt(s[k2]) } : s);
        const ref = (r) => (r && r.m1 && r.m2 ? { ...r, m1: pt(r.m1), m2: pt(r.m2) } : r);
        if (Array.isArray(state.roofLocal)) state.roofLocal = state.roofLocal.map(pt);
        (state.pans || []).forEach((pan) => { if (Array.isArray(pan.points)) pan.points = pan.points.map(pt); });
        state.obstacles = (state.obstacles || []).map(pt);
        state.ridge = seg(state.ridge, 'a', 'b');
        state.ridgeLines = (state.ridgeLines || []).map((l) => seg(l, 'a', 'b'));
        state.freeLines = (state.freeLines || []).map((l) => seg(l, 'p1', 'p2'));
        state.mapScreenshotRef = ref(state.mapScreenshotRef);
        if (state.fondAvantVueMulti && state.fondAvantVueMulti.ref) {
            state.fondAvantVueMulti = { ...state.fondAvantVueMulti, ref: ref(state.fondAvantVueMulti.ref) };
        }
        // Objets 3D posés : x = abscisse locale, z = ordonnée locale (cf. calepinage_maison_3d_objects.js).
        if (Array.isArray(state.sceneObjects3D)) {
            state.sceneObjects3D = state.sceneObjects3D.map((o) => (o && Number.isFinite(o.x) && Number.isFinite(o.z)
                ? { ...o, x: o.x + d.x, z: o.z + d.y } : o));
        }
    }

    function applyPersistedState(s, saved) {
        if (!saved) return;
        PERSISTED_STATE_FIELDS.forEach((key) => {
            if (saved[key] !== undefined) s[key] = saved[key];
        });
        if (Array.isArray(saved.gridOffsetByPan)) s.gridOffsetByPan = new Map(saved.gridOffsetByPan);
        if (Array.isArray(saved.deletedPanelIndicesByPan)) {
            s.deletedPanelIndicesByPan = new Map(saved.deletedPanelIndicesByPan.map(([panId, arr]) => [panId, new Set(arr)]));
        }
    }

    function persistCurrentState() {
        // Projet changé depuis : l'état courant est purgé ici (il appartenait à l'ancien projet).
        ensureSessionCacheMatchesProject();
        if (!window.CalepinagePersistence || !CM.state.sourceId) return;
        window.CalepinagePersistence.save(
            CM.state.sourceId,
            { sourceType: CM.state.sourceType, sourceLabel: CM.state.sourceLabel, projetId: sessionCacheProjetId },
            serializeState(CM.state)
        );
        // CORRECTIF (demande explicite : "quelle que soit la typologie de projet, la sauvegarde en
        // base doit être réalisée UNIQUEMENT lorsqu'on clique sur Calculer et visualiser") : un
        // évènement 'calepinageMaisonStateChanged' déclenchant une sauvegarde BD automatique à
        // chaque mutation d'état avait été ajouté ici, puis retiré sur cette demande explicite —
        // cohérent avec l'autosave périodique du calepinage Pro/Grand, déjà désactivée
        // volontairement le 2026-07-26 suite à un bug de corruption cross-projet (cf.
        // CalepinageDataService.js). La sauvegarde localStorage ci-dessus reste inchangée (cache
        // local temps réel) ; seule la sauvegarde EN BASE reste déclenchée uniquement par le clic
        // "Calculer et visualiser" (cf. calepinage_maison_persistence_db.js).
    }

    // NOUVEAU (demande explicite : "sauvegarder en base les saisies du modal Dimensionnement pour
    // le résidentiel, éviter la collecte de données corrompues") : variante de persistCurrentState()
    // qui accepte un sourceId explicite — nécessaire car setMaisonFieldResult() (plus bas) peut
    // écrire dans l'état d'une maison qui n'est PAS celle actuellement ouverte (CM.state), auquel
    // cas persistCurrentState() (qui ne sait sérialiser que CM.state) serait un no-op silencieux.
    function persistStateForSource(sourceId) {
        ensureSessionCacheMatchesProject();
        if (!window.CalepinagePersistence || !sourceId) return;
        const state = (CM.state && CM.state.sourceId === sourceId) ? CM.state : savedStatesBySourceId.get(sourceId);
        if (!state) return;
        window.CalepinagePersistence.save(
            sourceId,
            { sourceType: state.sourceType, sourceLabel: state.sourceLabel, projetId: sessionCacheProjetId },
            serializeState(state)
        );
    }

    // --------------------------------------------------------------------------------------
    // Multi-sources : plusieurs maisons tracées sur la carte (MaisonPolygonManager) et/ou images
    // importées (cf. calepinage_image_source.js) peuvent chacune avoir leur propre calepinage.
    // --------------------------------------------------------------------------------------
    const knownSources = []; // [{sourceId, label, kind: 'maps'|'image'}], ordre d'enregistrement

    function registerSource(sourceId, label, kind) {
        // Un contour réellement (re)créé avec cet id annule un éventuel marquage "supprimé".
        deletedSourceIds.delete(sourceId);
        if (!knownSources.some((s) => s.sourceId === sourceId)) {
            knownSources.push({ sourceId, label, kind });
        }
        refreshSourceSelectOptions();
    }

    function removeSourceOption(sourceId) {
        const idx = knownSources.findIndex((s) => s.sourceId === sourceId);
        if (idx !== -1) knownSources.splice(idx, 1);
        savedStatesBySourceId.delete(sourceId);
        // Purge le cache de CONTENU du calepinage (pans/obstacles/équipements) de cette maison —
        // sans ça, ensureAllSourcesLoaded() le rechargeait et le champ PV "supprimé" (avec ses
        // obstacles) réapparaissait en vue 3D / dans les totaux agrégés.
        try {
            if (window.CalepinagePersistence && typeof window.CalepinagePersistence.remove === 'function') {
                window.CalepinagePersistence.remove(sourceId);
            }
        } catch (e) { /* noop */ }
        // Capture 3D utilisateur de ce champ PV : un nouveau contour qui reprendrait le même id (PVn)
        // ne doit pas hériter de l'image de l'ancien dans son rapport.
        try {
            if (typeof CM.supprimerCapture3DUtilisateur === 'function') CM.supprimerCapture3DUtilisateur(sourceId);
        } catch (e) { /* noop */ }
        deletedSourceIds.add(sourceId);
        if (typeof CM.retirerPanneauxCarte === 'function') CM.retirerPanneauxCarte(sourceId);
        refreshSourceSelectOptions();
    }

    /**
     * Renumérote les champs PV du calepinage résidentiel sans trou après une suppression (demande
     * explicite : PV1, PV2, PV3, PV4 — suppression de PV2 — PV1, PV2, PV3). L'ordre relatif est conservé ;
     * les numéros déjà pris par une forme du calepinage grand projet (pool partagé drawingControl.usedIds)
     * restent réservés, comme à la création d'un champ.
     *
     * Le n° est la clé de toutes les données du champ : elles sont renommées ensemble — contour de la
     * carte, état du calepinage (mémoire + localStorage), registre des sources et boutons de l'entête,
     * captures 3D, champ à rouvrir après rechargement, parcelles, chaînes/pertes, panneaux de la carte —
     * puis la base est resynchronisée.
     * @returns {Object<string,string>} correspondance ancien n° -> nouveau n° (vide si rien à faire)
     */
    /**
     * Données locales rangées par n° de champ hors du calepinage : réglages des configurateurs
     * (clé skv_geometrie_structure_data:<projet>, par type de structure puis n°) et géométrie des plans
     * (geometriePlansData). Les n° supprimés sont effacés ; les renumérotés suivent leur champ — une
     * entrée restée sur un n° repris par un autre champ est écartée (elle appartenait à un champ supprimé).
     */
    function remapperDonneesLocalesChamps(correspondance, supprimes) {
        const corr = correspondance || {};
        const cibles = new Set(Object.values(corr));
        const supp = new Set(supprimes || []);
        const remapper = (obj) => {
            const sortie = {};
            Object.keys(obj || {}).forEach((pv) => {
                if (Object.prototype.hasOwnProperty.call(corr, pv)) sortie[corr[pv]] = obj[pv];
            });
            Object.keys(obj || {}).forEach((pv) => {
                if (Object.prototype.hasOwnProperty.call(corr, pv) || cibles.has(pv) || supp.has(pv)) return;
                sortie[pv] = obj[pv];
            });
            return sortie;
        };
        try {
            const cle = `skv_geometrie_structure_data:${localStorage.getItem('current_projet_id') || 'sans_projet'}`;
            const tout = JSON.parse(localStorage.getItem(cle) || 'null');
            if (tout && typeof tout === 'object') {
                Object.keys(tout).forEach((type) => {
                    if (tout[type] && typeof tout[type] === 'object') tout[type] = remapper(tout[type]);
                });
                localStorage.setItem(cle, JSON.stringify(tout));
            }
        } catch (e) { console.warn('[Calepinage] Réglages des configurateurs non renumérotés', e); }
        try {
            const plans = JSON.parse(localStorage.getItem('geometriePlansData') || 'null');
            if (plans && typeof plans === 'object') {
                const { savedAt, ...parChamp } = plans;
                localStorage.setItem('geometriePlansData', JSON.stringify({
                    ...remapper(parChamp), ...(savedAt !== undefined ? { savedAt } : {}),
                }));
            }
        } catch (e) { console.warn('[Calepinage] Géométrie des plans non renumérotée', e); }
    }

    // Champ supprimé (bouton du modal, touche Suppr de la carte) : ses réglages locaux disparaissent
    // avec lui, sans quoi un futur champ du même n° en hériterait.
    document.addEventListener('maisonShapeRemoved', (e) => {
        const pvId = e && e.detail && e.detail.pvId;
        if (pvId) remapperDonneesLocalesChamps({}, [pvId]);
    });

    function renumeroterChampsPV() {
        const mgr = window.MaisonPolygonManagerInstance;
        if (!mgr || !Array.isArray(mgr.polygons) || !mgr.polygons.length) return {};
        const numero = (id) => { const m = /^PV(\d+)$/.exec(id || ''); return m ? Number(m[1]) : Infinity; };
        const polys = mgr.polygons.filter((p) => p && p.maisonId).slice().sort((a, b) => numero(a.maisonId) - numero(b.maisonId));
        const idsMaisons = new Set(polys.map((p) => p.maisonId));
        const pool = window.drawingControl && window.drawingControl.usedIds;
        const reserves = new Set(pool ? Array.from(pool).filter((id) => !idsMaisons.has(id)) : []);

        const correspondance = {};
        let n = 1;
        polys.forEach((p) => {
            while (reserves.has(`PV${n}`)) n++;
            const nouveau = `PV${n}`;
            if (nouveau !== p.maisonId) correspondance[p.maisonId] = nouveau;
            n++;
        });
        const anciens = Object.keys(correspondance);
        if (!anciens.length) return {};
        const renommer = (id) => (Object.prototype.hasOwnProperty.call(correspondance, id) ? correspondance[id] : id);
        // Clés composées « PV3_Pan1 » (chaînes/pertes) : préfixe renommé.
        const renommerCle = (cle) => {
            if (Object.prototype.hasOwnProperty.call(correspondance, cle)) return correspondance[cle];
            const prefixe = anciens.find((a) => String(cle).startsWith(a + '_'));
            return prefixe ? correspondance[prefixe] + String(cle).slice(prefixe.length) : cle;
        };
        const remapperObjet = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const sortie = {};
            Object.keys(obj).forEach((cle) => { sortie[renommerCle(cle)] = obj[cle]; });
            return sortie;
        };

        // 1. Contours de la carte (+ index internes du gestionnaire, pool partagé).
        const remapperMap = (map) => {
            if (!(map instanceof Map)) return;
            const entrees = Array.from(map.entries());
            map.clear();
            entrees.forEach(([cle, val]) => map.set(renommer(cle), val));
        };
        remapperMap(mgr._rotationHandlesByPolygon);
        remapperMap(mgr._dimensionLabelMarkersByPolygon);
        polys.forEach((p) => {
            if (!correspondance[p.maisonId]) return;
            if (pool) pool.delete(p.maisonId);
            p.maisonId = correspondance[p.maisonId];
            if (typeof mgr._updateDimensionLabels === 'function') mgr._updateDimensionLabels(p);
        });
        if (pool) polys.forEach((p) => pool.add(p.maisonId));
        if (typeof mgr._persistPolygons === 'function') mgr._persistPolygons();

        // 2. États du calepinage (mémoire) et registre des sources. L'état affiché est souvent le MÊME
        // objet qu'une entrée de la mémoire : chaque état n'est renommé qu'une fois (sinon PV4 -> PV3 -> PV2).
        const etatsRenommes = new Set();
        const renommerEtat = (etat, ancienId) => {
            if (!etat || etatsRenommes.has(etat)) return;
            etatsRenommes.add(etat);
            const nouveau = renommer(ancienId);
            if (nouveau === ancienId) return;
            etat.sourceId = nouveau;
            if (etat.sourceType === 'maps') etat.sourceLabel = nouveau;
        };
        if (CM.state && CM.state.sourceId) renommerEtat(CM.state, CM.state.sourceId);
        const etats = Array.from(savedStatesBySourceId.entries());
        savedStatesBySourceId.clear();
        etats.forEach(([id, etat]) => {
            renommerEtat(etat, id);
            savedStatesBySourceId.set(renommer(id), etat);
        });
        knownSources.forEach((s) => {
            if (s.kind !== 'maps' || !correspondance[s.sourceId]) return;
            s.sourceId = correspondance[s.sourceId];
            s.label = s.sourceId;
        });
        // Un n° libéré par la suppression puis réattribué ne doit plus être considéré comme supprimé.
        polys.forEach((p) => deletedSourceIds.delete(p.maisonId));

        // 3. État sauvegardé (localStorage calepinage_maison_v1).
        try {
            const cle = 'calepinage_maison_v1';
            const store = JSON.parse(localStorage.getItem(cle) || '{}') || {};
            const nouveauStore = {};
            Object.keys(store).forEach((id) => {
                const entree = store[id];
                const nouveau = renommer(id);
                if (nouveau !== id && entree && entree.sourceType === 'maps') entree.sourceLabel = nouveau;
                nouveauStore[nouveau] = entree;
            });
            localStorage.setItem(cle, JSON.stringify(nouveauStore));
        } catch (e) { console.warn('[Calepinage] Renumérotation : états sauvegardés non renommés', e); }

        // 4. Captures 3D, champ à rouvrir après rechargement.
        try { if (typeof CM.renommerCaptures3DUtilisateur === 'function') CM.renommerCaptures3DUtilisateur(correspondance); } catch (e) { /* noop */ }
        try {
            const dernier = sessionStorage.getItem('calepinage_maison_lastOpenSourceId');
            if (dernier && correspondance[dernier]) sessionStorage.setItem('calepinage_maison_lastOpenSourceId', correspondance[dernier]);
        } catch (e) { /* noop */ }

        // 5. Chaînes/pertes (mémoire + cache local du projet).
        ['__chainesPvTabState', '__chainesOnduleurByField', '__chainesFieldState'].forEach((nom) => {
            if (window[nom] && typeof window[nom] === 'object') window[nom] = remapperObjet(window[nom]);
        });
        try {
            const cleChaines = 'chaines_pertes_local_v1_' + (localStorage.getItem('current_projet_id') || 'sans_projet');
            const cache = JSON.parse(localStorage.getItem(cleChaines) || 'null');
            if (cache && typeof cache === 'object') {
                localStorage.setItem(cleChaines, JSON.stringify({ ...cache, tabState: remapperObjet(cache.tabState), fieldState: remapperObjet(cache.fieldState) }));
            }
        } catch (e) { /* noop */ }

        // 6. Parcelles (résumé), panneaux de la carte, interface.
        document.dispatchEvent(new CustomEvent('maisonShapesRenumbered', { detail: { correspondance: { ...correspondance } } }));
        if (typeof CM.retirerPanneauxCarte === 'function') anciens.forEach((id) => CM.retirerPanneauxCarte(id));
        if (typeof CM.synchroniserPanneauxCarte === 'function') CM.synchroniserPanneauxCarte();
        refreshSourceSelectOptions();
        if (CM.state && CM.state.sourceId && CM.modal && CM.modal.style.display !== 'none') {
            if (typeof CM.render === 'function') CM.render(); // libellé PVn dessiné sur le canevas
            if (CM.resultsEl) recomputeResults();
        }
        if (window.MaisonPolygonManagerInstance && CM.state && CM.state.sourceId
            && typeof window.MaisonPolygonManagerInstance.mettreEnEvidence === 'function') {
            window.MaisonPolygonManagerInstance.mettreEnEvidence(CM.state.sourceId);
        }

        // 6 bis. Réglages des configurateurs (petit champ, ombrières...) et géométrie des plans, rangés
        // par n° de champ dans ce navigateur : ils suivent le champ renuméroté.
        remapperDonneesLocalesChamps(correspondance, []);

        // 7. Base de données : les n° changent, la sauvegarde remplace la liste des champs ET fait
        // suivre côté serveur les données rattachées au n° (paramètres du petit champ, géométrie...).
        if (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.saveToDatabase === 'function') {
            if (typeof window.CalepinageMaisonPersistenceDB.noterRenumerotation === 'function') {
                window.CalepinageMaisonPersistenceDB.noterRenumerotation(correspondance);
            }
            window.CalepinageMaisonPersistenceDB.saveToDatabase({ explicitDeletion: true }).catch(() => {});
        }
        return correspondance;
    }

    /**
     * Garantit la présence des tableaux de tracé TRANSITOIRES sur un état (points du rectangle de
     * contour en cours, sommets du polygone en cours, lignes libres).
     *
     * CORRECTIF (bug rapporté : "dessiner un rectangle / polygone libre ne fonctionne plus, rien ne
     * s'affiche quand je clique dessus") : ces champs ne sont pas persistés, et un état qui en est
     * dépourvu — état construit par une version antérieure du module encore en cache, état adopté par
     * un chemin qui ne passe pas par createDefaultState() — faisait lever
     * updateContourDrawButtonsUI() sur un `.length` d'`undefined`. Cette fonction étant appelée
     * AVANT toute mise à jour visuelle du bouton, l'exception avortait le gestionnaire de clic
     * entier : les deux boutons de tracé paraissaient morts, sans aucun message.
     *
     * On normalise plutôt que de se contenter de ne pas planter : le tracé doit rester possible.
     */
    function normalizeDrawingState(state) {
        if (!state) return state;
        if (!Array.isArray(state.contourRectPoints)) state.contourRectPoints = [];
        if (!Array.isArray(state.contourPolygonPoints)) state.contourPolygonPoints = [];
        if (!Array.isArray(state.freeLines)) state.freeLines = [];
        return state;
    }

    /**
     * Premier champ PV encore connu (ordre d'enregistrement), ou null s'il n'en reste aucun.
     * Utilisé après la suppression du champ affiché pour basculer sur un autre sans fermer le modal.
     */
    function getFirstKnownSourceId() {
        return knownSources.length ? knownSources[0].sourceId : null;
    }

    const echapperHtml = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /**
     * Boutons de l'entête du modal, un par champ PV puis par image importée (demande explicite :
     * sélectionner un champ sans passer par la liste déroulante). Le champ affiché est mis en avant.
     */
    function refreshSourceButtons() {
        if (!CM.sourceButtonsEl) return;
        const actif = CM.state && CM.state.sourceId;
        const ordonnees = knownSources.filter((s) => s.kind === 'maps').concat(knownSources.filter((s) => s.kind === 'image'));
        CM.sourceButtonsEl.innerHTML = ordonnees.map((s) => {
            const estActif = s.sourceId === actif;
            const style = estActif
                ? 'background:#fff; color:#dc2626; border:1px solid #fff; font-weight:700;'
                : 'background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.75); font-weight:600;';
            const titre = s.kind === 'image' ? `Image importée : ${s.label}` : `Afficher le calepinage de ${s.label}`;
            return `<button type="button" role="tab" data-source-id="${echapperHtml(s.sourceId)}" aria-selected="${estActif}"`
                + ` title="${echapperHtml(titre)}" style="${style} font-size:0.8rem; line-height:1; padding:5px 10px; border-radius:14px;`
                + ` cursor:pointer; white-space:nowrap; flex-shrink:0; max-width:160px; overflow:hidden; text-overflow:ellipsis;">`
                + `${s.kind === 'image' ? '<i class="fas fa-image" style="margin-right:4px;"></i>' : ''}${echapperHtml(s.label)}</button>`;
        }).join('');
        const btnActif = CM.sourceButtonsEl.querySelector('[aria-selected="true"]');
        if (btnActif && typeof btnActif.scrollIntoView === 'function') btnActif.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function refreshSourceSelectOptions() {
        refreshSourceButtons();
        if (!CM.sourceSelectEl) return;
        const maisons = knownSources.filter((s) => s.kind === 'maps');
        const images = knownSources.filter((s) => s.kind === 'image');
        const optionsHtml = (list) => list.map((s) => `<option value="${echapperHtml(s.sourceId)}">${echapperHtml(s.label)}</option>`).join('');
        CM.sourceSelectEl.innerHTML =
            (maisons.length ? `<optgroup label="Maisons">${optionsHtml(maisons)}</optgroup>` : '') +
            (images.length ? `<optgroup label="Images importées">${optionsHtml(images)}</optgroup>` : '');
        CM.sourceSelectEl.value = CM.state.sourceId || '';
    }

    // Bascule l'état complet (pans, obstacles, mode de pose...) vers celui de `sourceId`, en
    // sauvegardant d'abord l'état courant.
    function switchToSource(sourceId) {
        if (!sourceId || CM.state.sourceId === sourceId) return;

        // Flags d'interaction en cours (propriétés CM., cf. dessin.js) : un drag/resize/pan en
        // cours pointerait vers un id d'obstacle/pan inexistant dans le nouvel état.
        CM.isDraggingObstacle = false;
        CM.isResizingObstacle = false;
        CM.resizeObstacleId = null;
        CM.isMovingPanels = false;
        CM.movingPanId = null;
        CM.moveStart = null;
        CM.isPanningCanvas = false;
        CM.panStart = null;
        CM.pendingObstacleType = null;
        CM.lastMeterPt = null;
        if (CM.ghostEl) { CM.ghostEl.remove(); CM.ghostEl = null; }

        if (CM.state.sourceId) savedStatesBySourceId.set(CM.state.sourceId, CM.state);
        CM.state = savedStatesBySourceId.get(sourceId) || createDefaultState();
        normalizeDrawingState(CM.state);
        // Changer de champ PV n'active JAMAIS un outil de tracé : tout tracé resté en suspens sur l'état
        // restauré (contour rectangle/polygone, ligne libre) est abandonné — sécurité en plus du correctif
        // de finalizeContour() (dessin.js), qui en était la cause.
        CM.state.tracingContourRect = false;
        CM.state.contourRectPoints = [];
        CM.state.drawingContourPolygon = false;
        CM.state.contourPolygonPoints = [];
        CM.state.tracingFreeLine = false;
        CM.state.freeLineTemp = null;

        CM.computeFit();
        CM.updateContourDimsUI();
        CM.updatePoseModeUI();
        if (CM.viewToggleBtn) CM.updateViewToggleUI();
        if (CM.panToolBtn) CM.updatePanToolUI();
        if (CM.ridgeBtn) CM.updateRidgeButtonUI();
        CM.updateContourDrawButtonsUI();
        if (CM.modalBody) { CM.updatePanelToolButtonsUI(); CM.updateObstaclePropertiesPanel(); }
        CM.updateSourceDependentUI();
        if (CM.sourceSelectEl) CM.sourceSelectEl.value = CM.state.sourceId || '';
        refreshSourceButtons();
        const showPanelsCheckbox = CM.modalBody ? CM.modalBody.querySelector('#calepinageMaisonShowPanelsCheckbox') : null;
        const showBackgroundCheckbox = CM.modalBody ? CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox') : null;
        if (showPanelsCheckbox) showPanelsCheckbox.checked = CM.state.showPanels;
        if (showBackgroundCheckbox) showBackgroundCheckbox.checked = CM.state.showBackgroundImage;
        if (CM.updateVisibilityToggleButtonsUI) CM.updateVisibilityToggleButtonsUI();
        CM.updateEquipmentFieldsUI();
        CM.updateBorneEquipmentAvailability();
        CM.updateView2D3DUI();
        CM.updateMultiHouseViewUI();
        CM.renderAzimuths(CM.state.azimuths);
        CM.render();
        recomputeResults(); // rebâtit aussi la 3D si ouverte (cf. fin de recomputeResults)

        // Drapeau "maison ouverte" (consommé au prochain chargement de page par polygon_maison.js,
        // cf. openCalepinageMaisonModal) : il n'était posé qu'à l'OUVERTURE du modal. Changer de
        // champ PV depuis le sélecteur — ou après la suppression de celui affiché — laissait donc
        // l'ancien id, et un F5 rouvrait le mauvais champ PV (voire un champ supprimé).
        try { sessionStorage.setItem('calepinage_maison_lastOpenSourceId', sourceId); } catch (e) { /* ignore */ }
        // Carte : le champ PV affiché est mis en évidence (sélection par la liste déroulante comme par clic).
        if (window.MaisonPolygonManagerInstance && typeof window.MaisonPolygonManagerInstance.mettreEnEvidence === 'function') {
            window.MaisonPolygonManagerInstance.mettreEnEvidence(sourceId);
        }
        // Vue « tous les champs PV » : la capture de fond du champ affiché doit aussi couvrir les autres.
        if (CM.multiHouseViewActive && typeof CM.assurerFondCarteVueMulti === 'function') {
            CM.assurerFondCarteVueMulti().catch(() => { /* fond inchangé */ });
        }
    }

    // --------------------------------------------------------------------------------------
    // Contrat PvFieldSummary (branchement au calcul global de production) — cf. analyse
    // "calepinage toiture multi-typologie" : ce module reste indépendant du calepinage
    // rectangulaire/polygonale (pas de shapes/gridInfo/formData dans solarProjectData), il expose
    // simplement, pour CHAQUE pan de CHAQUE maison connue, un objet au même format que
    // SummaryModal.js::calculatedPvs[] :
    //   { id, peakPower, loss, tilt, azimuth, mount, invLimit, invEff, invCons, panelRef,
    //     plantAffectation }
    // Consommé par SummaryModal.js (calculatedPvs.push(...CM.getAllPvFieldSummaries())) puis
    // main_prodsolaire.js (une carte PV par entrée, sans aucune modification de ce dernier).
    // --------------------------------------------------------------------------------------
    // Garantit que savedStatesBySourceId contient TOUTES les maisons connues (pas seulement celles
    // déjà ouvertes dans cette session) — extrait de getAllPvFieldSummaries pour être réutilisé par
    // le résumé global des résultats (cf. computeAllHousesResultsSummary ci-dessous, même besoin).
    /**
     * Contour généré avec des réglages imposés (décalage de parcelles, cf.
     * components/decalage_parcelles/) : type de structure (+ mode de pose autorisé par ce type,
     * comme updatePoseModeUI) et réglages listés, appliqués à l'état TOUT NEUF du champ.
     */
    const REGLAGES_INITIAUX_AUTORISES = ['edgeClearanceM'];
    function appliquerReglagesInitiaux(state, poly) {
        if (!state || !poly) return;
        if (poly.typeMontageInitial) {
            state.typeMontage = poly.typeMontageInitial;
            const modes = CM.getAllowedPoseModes(CM.normalizeTypeMontage(state.typeMontage));
            if (!modes.includes(state.poseMode)) state.poseMode = modes[0];
            state.edgeClearanceM = CM.edgeClearanceDefautM(state.typeMontage);
        }
        const reglages = poly.reglagesInitiaux || {};
        REGLAGES_INITIAUX_AUTORISES.forEach((cle) => {
            if (Number.isFinite(reglages[cle])) state[cle] = reglages[cle];
        });
    }

    function ensureAllSourcesLoaded() {
        // Purge d'abord les caches s'ils appartiennent à un autre projet (cf.
        // ensureSessionCacheMatchesProject) : cette fonction est le second point d'entrée qui les
        // lit, appelée par les totaux/la synthèse même quand le modal n'a jamais été ouvert.
        ensureSessionCacheMatchesProject();
        // Inclut la maison actuellement affichée (CM.state) dans le même passage que les autres,
        // déjà sauvegardées : même geste que switchToSource() pour ne pas perdre l'état courant.
        if (CM.state.sourceId) savedStatesBySourceId.set(CM.state.sourceId, CM.state);

        // CORRECTIF (bug rapporté : "les données sont perdues si on actualise la page") :
        // savedStatesBySourceId n'est peuplée QUE par un passage dans switchToSource() (donc une
        // ouverture du modal) — après un rechargement, une maison restaurée sur la carte (cf.
        // polygon_maison.js::restorePolygons) mais jamais rouverte dans cette session serait
        // absente d'ici alors que ses données existent bel et bien dans calepinage_maison_v1
        // (localStorage). On les charge directement, sans passer par switchToSource/CM.state.
        if (window.MaisonPolygonManagerInstance && window.CalepinagePersistence) {
            window.MaisonPolygonManagerInstance.polygons.forEach((poly) => {
                const sourceId = poly.maisonId;
                if (!sourceId || savedStatesBySourceId.has(sourceId)) return;
                if (deletedSourceIds.has(sourceId)) return; // supprimé cette session — ne pas recharger
                const saved = window.CalepinagePersistence.load(sourceId);
                if (saved && saved.state) {
                    const restoredState = createDefaultState();
                    applyPersistedState(restoredState, saved.state);
                    // CORRECTIF (bug rapporté : "à l'ouverture du projet les panneaux sont en biais,
                    // les obstacles ne sont pas sauvegardés") : currentPolygonRef (PAS un champ
                    // persisté, cf. PERSISTED_STATE_FIELDS) restait à null sur cet état reconstruit
                    // "à froid" — openCalepinageMaisonModal() compare CM.state.currentPolygonRef à
                    // cfg.polygon pour décider si la maison qu'on ouvre est "la même, déjà connue" ou
                    // "une nouvelle/différente" ; null ne correspondant jamais à un vrai objet
                    // Polygon, cette comparaison échouait TOUJOURS pour toute maison déjà passée par
                    // ce chemin de chargement "à froid" (ex. dès qu'un total de puissance/résumé
                    // agrégeant toutes les maisons — computeAllHousesResultsSummary/
                    // getAllPvFieldSummaries — tourne avant que l'utilisateur n'ouvre lui-même cette
                    // maison). openCalepinageMaisonModal() prenait alors à tort la branche "nouvelle
                    // maison" : CM.state.obstacles = [] (perdus) + CM.resetDivision() (pans réinitialisés
                    // au lieu d'être resynchronisés sur le contour réel) — au lieu de la branche de
                    // resynchronisation existante, qui préserve obstacles/pans et ne réajuste que leur
                    // orientation. Même correctif déjà appliqué à fallbackState ci-dessous (asymétrie
                    // qui confirme l'oubli) : on assigne poly ici aussi.
                    restoredState.currentPolygonRef = poly;
                    // Repère local = 1er sommet du contour (même règle qu'à l'ouverture du modal) : sans
                    // lui, un déplacement ultérieur du contour sur la carte ne pourrait pas faire suivre
                    // le calepinage (cf. resynchroniserChampSurContour).
                    const cheminRestaure = typeof poly.getPath === 'function' ? poly.getPath().getArray() : [];
                    if (cheminRestaure.length) {
                        restoredState.roofLocalOrigin = cheminRestaure[0];
                        recalerSurOrigine(restoredState, saved.state.roofLocalOriginLatLng, cheminRestaure[0]);
                    }
                    // Identité du champ (non persistée) : sans elle, les sauvegardes faites depuis
                    // le formulaire PRO sur cet état (persistCurrentState lit CM.state.sourceId)
                    // étaient silencieusement ignorées.
                    restoredState.sourceType = 'maps';
                    restoredState.sourceId = sourceId;
                    restoredState.sourceLabel = sourceId;
                    savedStatesBySourceId.set(sourceId, restoredState);
                    // CORRECTIF (bug rapporté : "2-3 formes sur la carte, le filtre [sélecteur de
                    // maison] n'affiche qu'un seul PV") : knownSources (donc la liste déroulante
                    // #calepinageMaisonSourceSelect) n'était alimentée QUE par registerSource(), appelée
                    // uniquement à l'OUVERTURE du modal d'une maison (openCalepinageMaisonModal, plus
                    // bas) — une maison chargée "à froid" ici (jamais rouverte cette session, ex. après
                    // un rechargement de page ou un calcul agrégé qui déclenche ce chemin en premier)
                    // restait donc invisible dans le sélecteur, alors même que savedStatesBySourceId/
                    // les totaux/la vue 3D la connaissaient déjà. Même label que registerSource() côté
                    // 'maps' (cfg.polygon.maisonId, == sourceId, ex. "PV1").
                    registerSource(sourceId, sourceId, 'maps');
                    return;
                }

                // CORRECTIF (bug rapporté : "un label PVn manque dans la liste/le total alors que la
                // maison existe bel et bien sur la carte") : jusqu'ici, une maison SANS état sauvegardé
                // (calepinage_maison_v1, cf. calepinage_persistence.js) était purement et simplement
                // ignorée ici — silencieusement absente de toute liste/total agrégé
                // (computeAllHousesResultsSummary/getAllPvFieldSummaries), alors que son contour existe
                // bien sur la carte (MaisonPolygonManagerInstance.polygons). Un état a pu ne jamais être
                // sauvegardé pour de multiples raisons (ex. quota localStorage dépassé avec plusieurs
                // maisons déjà chargées de données détaillées) — dans tous les cas, la maison doit
                // toujours apparaître : on reconstruit ici un état par défaut directement depuis SA
                // PROPRE géométrie déjà tracée (même logique que l'ouverture normale de son modal, cf.
                // openCalepinageMaisonModal ci-dessous), plutôt que de l'ignorer.
                const path = poly.getPath().getArray();
                if (!path.length) return;
                const origin = path[0];
                const fallbackState = createDefaultState();
                fallbackState.sourceType = 'maps';
                fallbackState.sourceId = sourceId;
                fallbackState.sourceLabel = sourceId;
                fallbackState.currentPolygonRef = poly;
                fallbackState.roofLocalOrigin = origin;
                fallbackState.roofLocal = CM.simplifyCollinearLocal(path.map((p) => CM.latLngToLocal(origin, p)));
                fallbackState.refAngle = CM.computeRefAngle(fallbackState.roofLocal);
                // CORRECTIF (demande explicite : "dessiner sur la carte et obtenir directement les
                // résultats dans le formulaire PRO, sans ouvrir la modale") : c'est ICI que naît
                // l'état d'un champ tout juste tracé en PRO / Grand projet (le modal ne s'y ouvre pas
                // automatiquement). Il lui manquait le mode de tracé du contour — qui décide de
                // l'orientation de la grille (même règle qu'openCalepinageMaisonModal) — et il n'était
                // jamais sauvegardé : un rechargement le reconstruisait de zéro.
                fallbackState.contourMode = poly.maisonMode
                    || (window.MaisonPolygonManager ? window.MaisonPolygonManager.inferModeFromPath(path) : 'rect');
                // Contour généré avec des réglages imposés (décalage de parcelles -> 'champ_solaire',
                // espacement bordure 0, cf. components/decalage_parcelles/) : posés AVANT resetDivision,
                // pour que la grille de panneaux en tienne compte d'emblée, sans ouvrir le modal.
                appliquerReglagesInitiaux(fallbackState, poly);
                const previousState = CM.state;
                CM.state = fallbackState;
                try {
                    initPanelParamsIfNeeded(); // agit sur CM.state : dimensions/puissance du panneau
                    CM.resetDivision();
                } finally {
                    CM.state = previousState;
                }
                savedStatesBySourceId.set(sourceId, fallbackState);
                persistStateForSource(sourceId);
                // CORRECTIF (cf. commentaire de la branche "état sauvegardé" ci-dessus, même bug) :
                // cette maison n'a JAMAIS été ouverte ni persistée — sans cet appel, elle resterait
                // absente du sélecteur de maison alors même qu'elle vient d'être ajoutée ici à
                // savedStatesBySourceId (et donc aux totaux/à la vue 3D combinée).
                registerSource(sourceId, sourceId, 'maps');
            });
        }
    }

    /**
     * Un contour vient d'être TRACÉ sur la carte ('maisonShapeAdded', émis uniquement pour un tracé
     * neuf — jamais à la restauration) : son état de calepinage doit exister immédiatement, modal
     * ouvert ou non.
     *
     * CORRECTIF (bug rapporté : "quand je dessine mon premier rectangle, le message « Ce champ PV n'a
     * pas encore de calepinage » s'affiche ; je dois ouvrir le modal et revenir sur la carte pour que
     * les panneaux s'affichent"). Les numéros PVn sont réutilisés : un rectangle tracé après la
     * suppression de PV1 (ou après un changement de projet) redevient PV1. Or :
     *  - PV1 restait marqué « supprimé » (deletedSourceIds) : ensureAllSourcesLoaded() l'ignorait,
     *    donc aucun état, aucun panneau, message dans le formulaire PRO. Seul registerSource(),
     *    appelé à l'OUVERTURE du modal, levait ce marquage — d'où le contournement ;
     *  - un état resté en mémoire sous ce numéro appartenait à l'ANCIEN contour.
     * Enregistré ici, avant les écouteurs du formulaire PRO et de la carte (scripts chargés après).
     */
    function initialiserChampTrace(pvId) {
        const mgr = window.MaisonPolygonManagerInstance;
        const poly = mgr && Array.isArray(mgr.polygons) ? mgr.polygons.find((p) => p.maisonId === pvId) : null;
        if (!poly) return;
        ensureSessionCacheMatchesProject();
        deletedSourceIds.delete(pvId);

        const existant = (CM.state && CM.state.sourceId === pvId) ? CM.state : savedStatesBySourceId.get(pvId);
        // Parcours résidentiel : le modal s'est déjà ouvert sur CE contour et a créé son état.
        if (existant && existant.currentPolygonRef === poly) return;
        if (existant) {
            savedStatesBySourceId.delete(pvId);
            if (CM.state === existant) CM.state = createDefaultState();
        }
        // Une sauvegarde locale sous ce numéro appartient forcément à un AUTRE contour (celui-ci
        // vient d'être tracé) : la relire poserait l'ancien calepinage sur le nouveau tracé.
        try {
            if (window.CalepinagePersistence && typeof window.CalepinagePersistence.remove === 'function') {
                window.CalepinagePersistence.remove(pvId);
            }
        } catch (e) { /* noop */ }
        ensureAllSourcesLoaded(); // construit et sauvegarde l'état du nouveau contour
        registerSource(pvId, pvId, 'maps');
    }
    /**
     * Copier-coller d'un champ PV (bouton de la palette, cf. polygon_maison.js::demarrerCopieChamp) :
     * instantané de l'état du calepinage du champ `pvId` (pans, obstacles, réglages, panneaux
     * supprimés...), sous sa forme persistée et détaché de l'original.
     * @returns {Object|null} état sérialisé (cf. serializeState), ou null si le champ est inconnu
     */
    function copierEtatChamp(pvId) {
        ensureAllSourcesLoaded();
        const etat = (CM.state && CM.state.sourceId === pvId) ? CM.state : savedStatesBySourceId.get(pvId);
        if (!etat) return null;
        return JSON.parse(JSON.stringify(serializeState(etat)));
    }

    /**
     * Donne au champ collé `pvId` (contour `poly`, copie translatée de celui du champ `sourceId`) l'état
     * copié par copierEtatChamp. Appelée AVANT 'maisonShapeAdded' : initialiserChampTrace trouve
     * alors l'état déjà rattaché à ce contour et ne le remplace pas par un état par défaut.
     * La géométrie de l'état est exprimée en mètres depuis son origine : `origineCopiee` est cette
     * origine translatée comme le contour, recalée ici sur le 1er sommet du contour collé.
     * Les réglages des configurateurs rangés par n° de champ (petit champ, ombrières...) suivent.
     */
    function collerEtatChamp(pvId, sourceId, etatSerialise, poly, origineCopiee) {
        ensureSessionCacheMatchesProject();
        const chemin = poly.getPath().getArray();
        const etat = createDefaultState();
        applyPersistedState(etat, JSON.parse(JSON.stringify(etatSerialise)));
        normalizeDrawingState(etat);
        etat.sourceType = 'maps';
        etat.sourceId = pvId;
        etat.sourceLabel = pvId;
        etat.currentPolygonRef = poly;
        etat.roofLocalOrigin = chemin[0];
        if (origineCopiee) recalerSurOrigine(etat, origineCopiee, chemin[0]);

        deletedSourceIds.delete(pvId);
        savedStatesBySourceId.set(pvId, etat);
        persistStateForSource(pvId);
        registerSource(pvId, pvId, 'maps');

        try {
            const cle = `skv_geometrie_structure_data:${localStorage.getItem('current_projet_id') || 'sans_projet'}`;
            const tout = JSON.parse(localStorage.getItem(cle) || 'null');
            if (tout && typeof tout === 'object' && sourceId) {
                Object.keys(tout).forEach((type) => {
                    const parChamp = tout[type];
                    if (parChamp && typeof parChamp === 'object' && parChamp[sourceId] !== undefined) {
                        parChamp[pvId] = JSON.parse(JSON.stringify(parChamp[sourceId]));
                    }
                });
                localStorage.setItem(cle, JSON.stringify(tout));
            }
        } catch (e) { console.warn('[Calepinage] Réglages des configurateurs non copiés', e); }
        return etat;
    }

    document.addEventListener('maisonShapeAdded', (e) => {
        const pvId = e && e.detail ? e.detail.pvId : null;
        if (!pvId) return;
        try {
            initialiserChampTrace(pvId);
        } catch (err) {
            console.error(`[Calepinage] Initialisation du champ ${pvId} impossible`, err);
        }
    });

    /**
     * Champs PV dessinés sur la carte, avec leur état de calepinage et l'origine de leur repère local
     * — base commune des panneaux affichés sur la carte principale et des plans exportés
     * (calepinage_maison_carte_plans.js) et du clic de sélection sur le canevas.
     *
     * Origine : un état chargé « à froid » (ensureAllSourcesLoaded) n'a pas de roofLocalOrigin (non
     * persisté) ; son repère est celui du premier sommet de son contour vivant, exactement comme à
     * l'ouverture du modal (openCalepinageMaisonModal : origin = path[0]).
     * @returns {Array<{sourceId:string, state:Object, origin:google.maps.LatLng}>}
     */
    function listerChampsCarte() {
        ensureAllSourcesLoaded();
        const mapPolygons = (window.MaisonPolygonManagerInstance && window.MaisonPolygonManagerInstance.polygons) || [];
        const polyParId = new Map(mapPolygons.filter((p) => p && p.maisonId).map((p) => [p.maisonId, p]));
        const filtrerParCarte = polyParId.size > 0;
        const champs = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (deletedSourceIds.has(sourceId)) return;
            if (!state || state.sourceType !== 'maps') return;
            if (filtrerParCarte && !polyParId.has(sourceId)) return;
            let origin = state.roofLocalOrigin || null;
            if (!origin) {
                const poly = polyParId.get(sourceId) || state.currentPolygonRef;
                const path = poly && typeof poly.getPath === 'function' ? poly.getPath().getArray() : [];
                origin = path.length ? path[0] : null;
            }
            if (!origin || !(state.roofLocal || []).length) return;
            champs.push({ sourceId, state, origin });
        });
        return champs;
    }

    /**
     * Transformation rigide (rotation + translation, sans échelle) qui amène le contour `a` sur `b`
     * (mêmes sommets, même ordre), ou null si le contour a été déformé (sommet/arête modifié).
     */
    function transformationRigide(a, b) {
        if (!a.length || a.length !== b.length) return null;
        const centre = (pts) => pts.reduce((c, p) => ({ x: c.x + p.x / pts.length, y: c.y + p.y / pts.length }), { x: 0, y: 0 });
        const cA = centre(a), cB = centre(b);
        let sinSum = 0, cosSum = 0;
        a.forEach((p, i) => {
            const ax = p.x - cA.x, ay = p.y - cA.y, bx = b[i].x - cB.x, by = b[i].y - cB.y;
            sinSum += ax * by - ay * bx;
            cosSum += ax * bx + ay * by;
        });
        const theta = Math.atan2(sinSum, cosSum);
        const ecartMax = a.reduce((m, p, i) => {
            const r = CM.rotateAroundOrigin({ x: p.x - cA.x, y: p.y - cA.y }, theta);
            return Math.max(m, Math.hypot(r.x + cB.x - b[i].x, r.y + cB.y - b[i].y));
        }, 0);
        return ecartMax <= 0.15 ? { theta, cA, cB } : null;
    }

    /**
     * Le contour d'un champ PV a changé sur la carte principale (déplacé, pivoté, sommet ou arête
     * modifié) : son calepinage suit, sans rouvrir le modal.
     *
     * - Déplacement / rotation du contour entier (transformation rigide) : pans, obstacles, faîtages et
     *   lignes suivent le contour ; les panneaux restent donc à l'intérieur.
     * - Contour déformé : le pan unique (toit non divisé) épouse le nouveau contour et son orientation
     *   est recalculée comme à la réouverture du modal ; le reste garde sa position au sol.
     * - La capture de fond de carte reste calée sur le sol (elle montre toujours le même terrain).
     * Puis : sauvegarde locale, panneaux de la carte et, si le modal affiche ce champ, canevas et totaux.
     * @returns {boolean} true si le calepinage a été modifié
     */
    function resynchroniserChampSurContour(sourceId) {
        const mgr = window.MaisonPolygonManagerInstance;
        const poly = mgr && mgr.polygons.find((p) => p.maisonId === sourceId);
        if (!poly || deletedSourceIds.has(sourceId)) return false;
        ensureAllSourcesLoaded();
        const estActif = !!(CM.state && CM.state.sourceId === sourceId);
        const state = estActif ? CM.state : savedStatesBySourceId.get(sourceId);
        if (!state || state.sourceType !== 'maps' || !(state.roofLocal || []).length) return false;
        const chemin = poly.getPath().getArray();
        if (chemin.length < 3) return false;

        const nouvelleOrigine = chemin[0];
        const ancienneOrigine = (state.roofLocalOrigin && typeof state.roofLocalOrigin.lat === 'function')
            ? state.roofLocalOrigin : nouvelleOrigine;
        const auSol = (p) => CM.latLngToLocal(nouvelleOrigine, CM.localToLatLng(ancienneOrigine, p));
        const nouveauContour = CM.simplifyCollinearLocal(chemin.map((p) => CM.latLngToLocal(nouvelleOrigine, p)));
        const ancienContourAuSol = state.roofLocal.map(auSol);
        // Contour identique au sol (ex. modification faite depuis le canevas, déjà appliquée à l'état) :
        // rien à faire — on garde même le repère actuel, pour ne pas décaler la vue du canevas.
        if (CM.roofLocalsMatch(ancienContourAuSol, nouveauContour, 0.02)) return false;

        const rigide = transformationRigide(ancienContourAuSol, nouveauContour);
        const theta = rigide ? rigide.theta : 0;
        const suivre = rigide
            ? (p) => {
                const g = auSol(p);
                const r = CM.rotateAroundOrigin({ x: g.x - rigide.cA.x, y: g.y - rigide.cA.y }, theta);
                return { x: r.x + rigide.cB.x, y: r.y + rigide.cB.y };
            }
            : auSol;
        const suivreSegment = (s, k1, k2) => (s ? { ...s, [k1]: suivre(s[k1]), [k2]: suivre(s[k2]) } : s);

        const ancienContourLocal = state.roofLocal;
        state.roofLocalOrigin = nouvelleOrigine;
        state.roofLocal = nouveauContour;
        state.refAngle = CM.computeRefAngle(nouveauContour);
        state.currentPolygonRef = poly;
        state.obstacles = (state.obstacles || []).map((o) => {
            const c = suivre({ x: o.x, y: o.y });
            return { ...o, x: c.x, y: c.y, angle: (o.angle || 0) + theta };
        });
        state.ridge = suivreSegment(state.ridge, 'a', 'b');
        state.ridgeLines = (state.ridgeLines || []).map((l) => suivreSegment(l, 'a', 'b'));
        state.freeLines = (state.freeLines || []).map((l) => suivreSegment(l, 'p1', 'p2'));
        if (state.mapScreenshotRef && state.mapScreenshotRef.m1 && state.mapScreenshotRef.m2) {
            state.mapScreenshotRef = { ...state.mapScreenshotRef, m1: auSol(state.mapScreenshotRef.m1), m2: auSol(state.mapScreenshotRef.m2) };
        }
        const fondMemorise = state.fondAvantVueMulti && state.fondAvantVueMulti.ref;
        if (fondMemorise && fondMemorise.m1 && fondMemorise.m2) {
            state.fondAvantVueMulti = { ...state.fondAvantVueMulti, ref: { ...fondMemorise, m1: auSol(fondMemorise.m1), m2: auSol(fondMemorise.m2) } };
        }

        const pans = state.pans || [];
        if (state.divisionMode === 'none' && pans.length) {
            pans[0].points = nouveauContour;
            if (!CM.roofLocalsMatch(ancienContourLocal, nouveauContour, 0.05)) {
                const previousState = CM.state;
                CM.state = state; // angleForAzimuth/computeLengthEdgeAngle : même règle que RESYNC 1/2
                try {
                    const refAngle = CM.angleReferenceStable(state, nouveauContour);
                    CM.applyReferenceAngleToPan(pans[0], refAngle);
                } finally {
                    CM.state = previousState;
                }
            }
        } else {
            pans.forEach((pan) => {
                pan.points = (pan.points || []).map(suivre);
                if (theta) CM.applyReferenceAngleToPan(pan, (pan.angle || 0) + theta);
            });
        }

        // Bug rapporté : contour modifié sur la carte, modale fermée -> la page calepinage gardait
        // l'ancienne longueur et les anciens entraxes / porte-à-faux « auto » jusqu'à l'ouverture
        // d'une autre modale. Les saisies qui ne tiennent plus repassent en auto ici aussi (comme
        // recomputeResults), AVANT la sauvegarde.
        if (CM.poteauxOmbriere && typeof CM.poteauxOmbriere.reconcilierDimensions === 'function') {
            try { CM.poteauxOmbriere.reconcilierDimensions(state); } catch (e) { console.warn("[CalepinageMaison] Poteaux d'ombrière : recalcul impossible", e); }
        }
        persistStateForSource(sourceId);
        if (typeof CM.synchroniserPanneauxCarte === 'function') CM.synchroniserPanneauxCarte(sourceId);
        const modalVisible = !!(CM.modal && CM.modal.style.display !== 'none');
        let signale = false;
        if (modalVisible) {
            if (estActif) {
                if (typeof CM.updateContourDimsUI === 'function') CM.updateContourDimsUI();
                recomputeResults(); // totaux (nombre de panneaux, kWc) + sauvegarde + 3D + évènement
                signale = true;
            }
            if (typeof CM.render === 'function') CM.render();
        }
        // Sinon, le formulaire PRO de la page (dimensions du contour, entraxes, porte-à-faux) est
        // remis en accord avec l'état par le même évènement que recomputeResults.
        if (!signale) {
            document.dispatchEvent(new CustomEvent('calepinageMaisonEtatRecalcule', { detail: { sourceId } }));
        }
        return true;
    }

    /**
     * Contours seuls des AUTRES champs PV, reprojetés dans le repère du champ actif — version légère de
     * getOtherHousesReprojected() (aucun calcul de panneaux), pour le clic/survol de sélection sur le
     * canevas, y compris hors vue « tous les champs PV » (où l'autre champ n'est visible que sur la
     * capture de fond de carte).
     */
    function getOtherHouseContoursReprojected() {
        if (CM.state.sourceType !== 'maps' || !CM.state.roofLocalOrigin) return [];
        const activeOrigin = CM.state.roofLocalOrigin;
        return listerChampsCarte()
            .filter((c) => c.sourceId !== CM.state.sourceId)
            .map((c) => ({
                sourceId: c.sourceId,
                roofLocal: c.state.roofLocal.map((pt) => CM.latLngToLocal(activeOrigin, CM.localToLatLng(c.origin, pt))),
            }));
    }

    // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue, notamment pour la
    // scène 3D à venir") : reprojette le contour/les pans/les obstacles de TOUTES les AUTRES
    // maisons connues (hors CM.state, déjà dessinée normalement par render()) dans le repère local
    // de la maison actuellement active, pour un affichage combiné en LECTURE SEULE (cf.
    // calepinage_maison_dessin.js::renderOtherHouses/computeFit). Uniquement les maisons de type
    // 'maps' : une source 'image' n'a pas de vraie coordonnée lat/lng comparable à celle des autres.
    function getOtherHousesReprojected() {
        ensureAllSourcesLoaded();
        const activeOrigin = CM.state.roofLocalOrigin;
        if (!activeOrigin) return [];

        // CORRECTIF (bug rapporté : "la 3D affiche un autre calepinage en mémoire qui n'est pas
        // dessiné sur la carte") : savedStatesBySourceId garde tout état ouvert/chargé pendant la
        // session, y compris celui d'un contour qui n'existe plus sur la carte. Quand les contours
        // de la carte sont disponibles (la maison active y figure), seuls ceux-là sont retenus. Sans
        // carte chargée (page hôte sans Google Maps), comportement inchangé.
        const mapPolygons = (window.MaisonPolygonManagerInstance && window.MaisonPolygonManagerInstance.polygons) || [];
        const idsOnMap = new Set(mapPolygons.map((p) => p && p.maisonId).filter(Boolean));
        const filterByMap = idsOnMap.has(CM.state.sourceId);

        const result = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (sourceId === CM.state.sourceId) return; // déjà dessinée normalement par render()
            if (deletedSourceIds.has(sourceId)) return; // champ PV supprimé cette session
            if (filterByMap && !idsOnMap.has(sourceId)) return; // contour absent de la carte
            if (state.sourceType !== 'maps' || !state.roofLocalOrigin) return;

            const reprojectPt = (pt) => CM.latLngToLocal(activeOrigin, CM.localToLatLng(state.roofLocalOrigin, pt));
            const roofLocal = (state.roofLocal || []).map(reprojectPt);
            const pans = (state.pans || []).map((pan) => ({ ...pan, points: (pan.points || []).map(reprojectPt) }));
            // Lignes typées faîtage/noue (4 pans symétrique) — reprojetées pour le modèle 3D combiné.
            const ridgeLines = (state.ridgeLines || []).map((L) => ({ type: L.type, a: reprojectPt(L.a), b: reprojectPt(L.b) }));
            const obstacles = (state.obstacles || []).map((o) => {
                const p = reprojectPt({ x: o.x, y: o.y });
                return { ...o, x: p.x, y: p.y };
            });
            // Objets 3D posés sur CE champ (arbres, blocs, toitures...) : x = Est, z = Nord dans son
            // repère local, ramenés par la même translation que ses obstacles. Sans eux, la vue 3D
            // combinée n'affichait que les objets du champ actif, alors que le calcul d'ombrage
            // (calepinage_maison_ombrage_scene.js) les prend en compte pour tous les champs.
            const sceneObjects3D = (state.sceneObjects3D || []).map((o) => {
                const p = reprojectPt({ x: Number(o.x) || 0, y: Number(o.z) || 0 });
                return { ...o, x: p.x, z: p.y };
            });

            // Calcule les panneaux réels de CETTE maison (dimensions/espacements/clearances qui lui
            // sont propres) — bascule temporaire de CM.state, purement synchrone : packPanelsForPan/
            // computeCandidatePanelSlots ne FONT QUE LIRE CM.state (aucune mutation), donc restaurer
            // l'état actif juste après est strictement sans effet de bord. IMPORTANT : passe les
            // obstacles déjà reprojetés (pas state.obstacles, encore dans le repère d'origine de
            // cette maison) — sinon le test de blocage panneau/obstacle comparerait des coordonnées
            // dans deux repères différents.
            // CORRECTIF (bug rapporté : "plusieurs rectangles sur la carte, chacun avec son propre
            // type de structure — le modèle 3D affiche un bâtiment monopente au lieu de l'ombrière
            // configurée pour ce champ") : jusqu'ici, seule la maison ACTIVE (CM.state) passait par
            // getFormOmbriereObject()/getFormPetitChampObject() (calepinage_maison_3d_geometry.js) —
            // ces 2 fonctions ne lisent QUE CM.state, jamais paramétrées par une maison arbitraire.
            // Résultat : une AUTRE maison configurée en ombrière/petit champ solaire retombait
            // TOUJOURS sur le volume "bâtiment" générique (buildOneBuilding), quel que soit son
            // typeMontage. Même bascule temporaire que panelsByPan ci-dessus (synchrone, sans effet
            // de bord) — `roofLocal` (déjà REPROJETÉ dans le repère de la maison active, cf. plus
            // haut) est ICI AUSSI substitué à celui, non reprojeté, de `state` : roofBBox()/
            // ombrierePlanDims() (calepinage_maison_3d_objects.js) lisent CM.state.roofLocal
            // directement — sans cette substitution, la structure resterait correctement dimensionnée
            // mais placée aux coordonnées d'ORIGINE de cette maison (son propre roofLocalOrigin), pas
            // dans le repère combiné de la scène 3D.
            const previousState = CM.state;
            CM.state = { ...state, pans, obstacles, roofLocal };
            const panelsByPan = pans.map((pan) => CM.packPanelsForPan(pan));
            let formOmbriere = null, formPetitChamp = null;
            try { if (typeof CM.getFormOmbriereObject === 'function') formOmbriere = CM.getFormOmbriereObject(); } catch (e) { formOmbriere = null; }
            try { if (typeof CM.getFormPetitChampObject === 'function') formPetitChamp = CM.getFormPetitChampObject(); } catch (e) { formPetitChamp = null; }
            CM.state = previousState;

            // NOUVEAU (génération 3D) : scalaires propres à CETTE maison, nécessaires au calcul
            // d'altitude de toiture / au relevé des panneaux dans calepinage_maison_3d_geometry.js
            // (getOtherHousesReprojected ne renvoyait jusqu'ici que la géométrie planaire).
            result.push({
                sourceId, roofLocal, pans, obstacles, panelsByPan,
                batimentHeightM: state.batimentHeightM,
                railHeightMm: state.railHeightMm,
                penteDeg: state.penteDeg,
                penteDeg2: state.penteDeg2,
                domeTiltDeg: state.domeTiltDeg,
                overhangRampant: state.overhangRampant,
                overhangLongpan: state.overhangLongpan,
                divisionMode: state.divisionMode,
                lastTwoPanKind: state.lastTwoPanKind,
                faitageAsymType: state.faitageAsymType,
                ridgeLines,
                typeMontage: state.typeMontage,
                roofTexture3D: state.roofTexture3D,
                acrotereHeightM: state.acrotereHeightM,
                // NOUVEAU (cf. correctif ci-dessus) : structure form-driven (ombrière/petit champ
                // solaire) de CETTE maison, déjà calée sur SON PROPRE plan (dims + position) —
                // consommée par buildResidential3DModel() pour supprimer son volume "bâtiment" et la
                // poser comme objet de scène, exactement comme pour la maison active.
                formOmbriere, formPetitChamp,
                sceneObjects3D,
            });
        });
        return result;
    }

    // NOUVEAU (demande explicite : "diviser par 2/4 ou le coefficient d'asymétrie la puissance de
    // l'onduleur envoyée dans le backend pour le calcul de production si l'utilisateur n'a pas choisi
    // de modèle d'onduleur") — jusqu'ici la puissance de LA MAISON ENTIÈRE (state.onduleurPuissanceKva)
    // était recopiée telle quelle sur CHAQUE pan (ligne invLimit ci-dessous), que l'onduleur soit
    // choisi au catalogue ou saisi à la main : chaque pan "voyait" donc 100% de la capacité onduleur
    // de la maison dans le calcul PVGIS/écrêtage (calcul_prodsolaire.py::calculate_pv_data, alimenté
    // par ce champ via SummaryModal.js -> main_prodsolaire.js -> POST /calculate_pv), au lieu de sa
    // propre part. Ne s'applique QUE si aucun modèle catalogue n'a été choisi (state.onduleurRef vide)
    // — avec un modèle catalogue, comportement inchangé (demande explicite).
    function allocateOnduleurKvaForPan(state, pan, nbPans) {
        const total = state.onduleurPuissanceKva || 0;
        if (state.onduleurRef) return total;
        if (nbPans <= 1) return total;
        // 2 pans asymétrique : réutilise CM.state.asymmetryPercent (déjà "% Pan 1" pour la géométrie du
        // toit, cf. divideInto2PansAsymmetric/computeAsymmetricRidge, calepinage_maison_calculs.js) —
        // même référentiel que la division du toit plutôt qu'un simple 1/nbPans.
        if (state.divisionMode === '2pans' && state.lastTwoPanKind === 'asym') {
            const pct = Math.max(0, Math.min(100, state.asymmetryPercent != null ? state.asymmetryPercent : 50));
            return total * ((pan.id === 'Pan 1' ? pct : (100 - pct)) / 100);
        }
        // 2 pans symétrique, 4 pans (croupe), 4 pans symétrique : répartition égale (÷2 ou ÷4).
        return total / nbPans;
    }

    /**
     * Champs PV de production d'un pan : un seul (le pan), sauf en dôme où chaque côté des rangées
     * a son azimut (toit à 2 pans symétriques) -> 2 champs, suffixes CM.SUFFIXES_CHAMP_DOME, à
     * l'inclinaison du dôme (domeTiltDeg, et non la pente de toiture). `part` = fraction des
     * panneaux du pan portée par le champ.
     */
    function champsDuPan(pan, panels, state) {
        const total = panels.length;
        const enDome = pan.poseMode === 'dome' || (!pan.poseMode && state.poseMode === 'dome');
        if (!enDome || !total) {
            return [{ suffixe: '', panelCount: total, part: 1, azimuth: pan.azimuth, tilt: CM.effectivePenteDegForPan(pan, state) }];
        }
        const azimuts = CM.azimutsCotesDome(pan, panels[0].angle);
        const parCote = [0, 0];
        panels.forEach((p) => { parCote[CM.coteDomePanneau(p.panelIndex, state) === 0 ? 0 : 1] += 1; });
        return [0, 1].map((cote) => ({
            suffixe: CM.SUFFIXES_CHAMP_DOME[cote], domeCote: cote,
            panelCount: parCote[cote], part: parCote[cote] / total,
            azimuth: azimuts[cote], tilt: Number(state.domeTiltDeg) || 0,
        }));
    }

    function getAllPvFieldSummaries() {
        ensureAllSourcesLoaded();

        // CORRECTIF (détecté en corrigeant le bug "ne collecte pas les données") :
        // packPanelsForPan/computeCandidatePanelSlots lisent CM.state en global (obstacles,
        // espacements, pente, dimensions panneau...), jamais le paramètre `state` de la boucle
        // ci-dessous — pour une maison AUTRE que celle actuellement active, ce calcul utilisait donc
        // silencieusement les réglages de la maison active au lieu des siens propres dès qu'il y a 2
        // maisons ou plus. Même bascule temporaire (synchrone, sans effet de bord) que
        // getOtherHousesReprojected(), pour que chaque maison soit calculée avec SES PROPRES réglages.
        const summaries = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (deletedSourceIds.has(sourceId)) return; // champ PV supprimé cette session
            const previousState = CM.state;
            CM.state = state;
            const panelsByPan = (state.pans || []).map((pan) => CM.packPanelsForPan(pan));
            CM.state = previousState;

            const nbPans = (state.pans || []).length;
            // Ombrage entre sheds (pans posés en sheds : petit champ au sol, toiture terrasse —
            // support considéré plat hors petit champ) : la perte entre sheds s'ajoute à la perte
            // système (combinaison multiplicative, comme SummaryModal pour les sheds PRO). Petit
            // champ au sol, case « prendre en compte le terrain » cochée : perte AVEC terrain à la
            // place de la perte plate, et pente / azimut RÉELS des tables envoyés à PVGIS. Résultat
            // absent ou périmé (calepinage modifié) : perte système seule, signalé par
            // ombrageShedsAbsent — SummaryModal l'actualise avant chaque calcul de production
            // (CalepinageMaisonShedsActions.actualiserOmbragesProduction).
            const sheds = window.CalepinageMaisonShedsActions;
            const ombrageSheds = sheds && typeof sheds.ombragePourProduction === 'function'
                ? sheds.ombragePourProduction(sourceId, state) : null;
            (state.pans || []).forEach((pan, i) => {
                champsDuPan(pan, panelsByPan[i], state).forEach((champ) => {
                const panelCount = champ.panelCount;
                const peakPower = (panelCount * (state.panelPowerWc || 0)) / 1000;
                if (peakPower <= 0) return; // pan (ou côté de dôme) sans panneau : rien à envoyer
                const tiltSaisi = champ.tilt;
                let loss = state.perteSysteme, tilt = tiltSaisi, azimuth = champ.azimuth;
                const ombrage = {};
                const panEnShed = pan.poseMode === 'shed' || (!pan.poseMode && state.poseMode === 'shed');
                if (panEnShed && ombrageSheds && ombrageSheds.valide) {
                    const perteSys = Number(state.perteSysteme) || 0;
                    loss = Math.round(100 * (1 - (1 - perteSys / 100) * (1 - ombrageSheds.perte / 100)) * 100) / 100;
                    Object.assign(ombrage, {
                        perteOmbrageSheds: ombrageSheds.perte, ombrageAvecTerrain: ombrageSheds.terrain,
                        perteSystemeSaisie: state.perteSysteme, tiltSaisi, azimuthSaisi: pan.azimuth,
                        ombrageTerrainIndisponible: !!ombrageSheds.terrainIndisponible,
                    });
                    if (ombrageSheds.terrain) {
                        const reel = (ombrageSheds.pans || []).find((p) => p.panId === pan.id) || ombrageSheds;
                        tilt = Math.round(reel.penteReelleDeg * 10) / 10;
                        azimuth = Math.round(reel.azimutReelDeg * 10) / 10;
                    }
                } else if (panEnShed && ombrageSheds) {
                    ombrage.ombrageShedsAbsent = true;
                    ombrage.erreurOmbrageSheds = ombrageSheds.erreur || null;
                }
                // NOUVEAU (demande explicite : "les dimensions des champs PV et les autres données
                // n'apparaissent pas dans le Summary modal") : géométrie du champ (dimensions,
                // disposition LxC, surfaces) ajoutée au résumé, seule information qui manquait aux
                // tableaux de synthèse et au résumé de la barre d'outils. Purement additif.
                const grille = (typeof CM.mesurerGrillePan === 'function')
                    ? CM.mesurerGrillePan(pan, state) : null;
                // Dôme : surfaces et part d'onduleur du pan réparties au prorata des panneaux du côté.
                const part = champ.part;
                summaries.push({
                    id: `${sourceId}_${pan.id}${champ.suffixe}`.replace(/\s+/g, ''),
                    // NOUVEAU (rapport PDF — tableau de synthèse calepinage pour les projets
                    // Résidentielle) : sourceId/panelCount ajoutés en plus des champs déjà utilisés
                    // pour la requête PVGIS, purement additifs (aucun appelant existant ne dépend
                    // d'une forme figée de cet objet).
                    sourceId,
                    panelCount,
                    peakPower,
                    loss,
                    // NOUVEAU (demande explicite) : pente propre au pan — Pan 2 d'une toiture 2 pans
                    // asymétrique utilise state.penteDeg2, envoyé tel quel à PVGIS pour ce pan.
                    // (Remplacées par l'orientation réelle si l'ombrage avec terrain est appliqué.)
                    tilt,
                    azimuth,
                    ...ombrage,
                    // CORRECTIF (demande explicite : nouvelles options "Type de structure supportant
                    // les panneaux") : mapping via CM.typeMontageToPvgisMount() (calepinage_maison_
                    // calculs.js) — reconnaît aussi les 4 anciennes valeurs pour les projets déjà
                    // enregistrés. PVGIS n'accepte que 'free' ou 'building' pour son modèle thermique.
                    mount: CM.typeMontageToPvgisMount(state.typeMontage),
                    invLimit: allocateOnduleurKvaForPan(state, pan, nbPans) * part,
                    invEff: state.onduleurRendement,
                    invCons: state.onduleurConso,
                    panelRef: state.panelRef,
                    // NOUVEAU (bug rapporté : "la référence du système d'intégration mentionnée dans
                    // le rapport correspond à la référence du panneau") — cause racine : ce champ
                    // n'existait tout simplement pas ici, ExportService.js retombait donc sur
                    // panelRef comme substitut erroné. state.systemeIntegrationRef (choisi via le
                    // sélecteur "Système d'intégration" du formulaire, cf.
                    // calepinage_maison_formulaires.js::setupEquipmentCatalogPickers) était déjà
                    // persisté, simplement jamais exposé dans ce résumé par pan.
                    systemeIntegrationRef: state.systemeIntegrationRef,
                    plantAffectation: state.affectationCentrale,
                    // --- Géométrie du champ PV (cf. CM.mesurerGrillePan, calepinage_maison_calculs.js) ---
                    poseMode: state.poseMode,
                    panelOrientation: state.panelOrientation,
                    typeMontage: CM.normalizeTypeMontage(state.typeMontage),
                    disposition: grille ? grille.disposition : '',
                    longueurM: grille ? grille.longueurM : 0,
                    largeurM: grille ? grille.largeurM : 0,
                    surfacePanneauxM2: grille ? grille.surfacePanneauxM2 * part : 0,
                    surfaceProjeteeM2: grille ? grille.surfaceProjeteeM2 * part : 0,
                    ...(champ.domeCote != null ? { domeCote: champ.domeCote } : {}),
                });
                });
            });
        });

        // CONTRÔLE STRICT DE LA LICENCE (Tolérance configurable, ex: +10%)
        const totalPeakPower = summaries.reduce((acc, s) => acc + (s.peakPower || 0), 0);
        if (typeof window.checkPowerLicenceCompliance === 'function') {
            const licenceCheck = window.checkPowerLicenceCompliance(totalPeakPower);
            if (licenceCheck && (licenceCheck.allowed === false || licenceCheck.compliant === false)) {
                const maxAllowedKwc = licenceCheck.maxAllowedKwc ?? licenceCheck.max_allowed_kwc;
                const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                console.warn(`[Licence PV] getAllPvFieldSummaries bloqué : puissance totale (${Number(totalPeakPower || 0).toFixed(2)} kWc) > plafond licence (${maxAllowedStr} kWc).`);
                return [];
            }
        }

        return summaries;
    }

    /**
     * NOUVEAU (demande explicite : "envoyer les données du calepinage résidentiel dans le modal de
     * dimensionnement des chaînes") : adapte getAllPvFieldSummaries() (ci-dessus) au format déjà
     * attendu par chaines_pertes_modal.js::openChainesPertesModal(fields) — {subPvId, pvId,
     * totalPanels, panelReference, nbOnduleurs, peakPowerKwc, puissanceOnduleurKva} — même
     * regroupement que le Pro/Grand projet (plusieurs pans/subPvId peuvent partager un même
     * pvId/maison, ex. toiture Bipente/Multipente). nbOnduleurs par défaut à 1 : non suivi
     * individuellement par maison aujourd'hui (une maison résidentielle a presque toujours un seul
     * onduleur) — modifiable ensuite dans le modal, écrit alors dans CM.state via
     * setMaisonFieldResult() ci-dessous.
     */
    function getPvFieldsForChainesPertes() {
        return getAllPvFieldSummaries().map((s) => ({
            subPvId: s.id,
            pvId: s.sourceId,
            totalPanels: s.panelCount,
            panelReference: s.panelRef || '',
            nbOnduleurs: 1,
            peakPowerKwc: s.peakPower,
            puissanceOnduleurKva: s.invLimit || 0,
        }));
    }

    /**
     * NOUVEAU (demande explicite : "sauvegarde robuste, sans multi routes") : équivalent
     * résidentiel du "champ hôte -<pvId>" du calepinage Pro/Grand projet (cf. writeHostField(),
     * chaines_pertes_modal.js/perte_systeme.js) — au lieu d'un <input> DOM caché par pvId, écrit
     * directement dans CM.state de la maison concernée (sourceId joue ici le rôle du pvId
     * Pro/Grand). Round-trip déjà garanti SANS aucun nouveau code de sauvegarde : CM.state est
     * l'objet sérialisé tel quel par CalepinageMaisonPersistenceDB.saveToDatabase() (route unique
     * déjà existante, /calepinage-maison/save). Fonctionne aussi bien pour la maison actuellement
     * ouverte (CM.state lui-même) qu'une AUTRE maison (récupérée dans savedStatesBySourceId, pas
     * affichée à l'écran au moment de l'écriture).
     */
    function setMaisonFieldResult(sourceId, champ, valeur) {
        if (!sourceId || !champ) return;
        const state = (CM.state && CM.state.sourceId === sourceId) ? CM.state : savedStatesBySourceId.get(sourceId);
        if (!state) return;
        const change = state[champ] !== valeur;
        state[champ] = valeur;
        // Pertes calculées par « Chaînes et pertes » : partagées avec le pompage solaire comme une saisie
        // (cf. calepinage_maison_parametres_pompage.js).
        if (change && champ === 'perteSysteme' && typeof CM.signalerSaisieParametre === 'function') {
            CM.signalerSaisieParametre(state, champ);
        }
        // CORRECTIF (bug confirmé par investigation : cette écriture ne déclenchait auparavant AUCUNE
        // sauvegarde — ni localStorage, ni BD — jusqu'à ce qu'une action complètement indépendante
        // (déplacer un panneau, changer de projet, ouvrir "Calculer") le fasse par hasard) : pousser
        // immédiatement vers le cache localStorage (persistStateForSource(), round-trip garanti côté
        // lecture) ET émettre un événement debouncé vers la BD — même pont que ResidentielChiffrageDB.js
        // (residentielCapexChanged/residentielOpexChanged), écouté par calepinage_maison_persistence_db.js.
        persistStateForSource(sourceId);
        document.dispatchEvent(new CustomEvent('calepinageMaisonFieldChanged', { detail: { sourceId, champ, valeur } }));
    }

    // NOUVEAU (fonctionnalité "Câblage DC", cablage_dc.js) : résout le pan (roof section) désigné
    // par un `subPvId` du modal Chaînes ("Config. PV utilisateur"/window.__chainesPertesGlobal.fields).
    // Rappel du format (getAllPvFieldSummaries() ci-dessus) : subPvId = `${sourceId}_${pan.id}` —
    // pvId (= sourceId) étant déjà connu par l'appelant (field.pvId), on récupère pan.id par un
    // simple retrait de préfixe plutôt qu'un split fragile sur "_" (sourceId peut lui-même contenir
    // des "_"). Retourne { pan, state } (état de la maison propriétaire, pour accéder à
    // state.cablageDc/state.pans) ou null si la maison/le pan n'existe plus.
    function getPanForSubPvId(subPvId, pvId) {
        if (!subPvId || !pvId || !subPvId.startsWith(pvId + '_')) return null;
        // CORRECTIF (bug rapporté : "Câblage DC" refuse tout champ PV résidentiel, quel que soit
        // l'outil de tracé) : getAllPvFieldSummaries() construit subPvId via
        // `${sourceId}_${pan.id}`.replace(/\s+/g, '') — retire TOUS les espaces, alors que pan.id
        // vaut toujours "Pan 1"/"Pan 2" (avec un espace). Comparer p.id tel quel à la sous-chaîne
        // reconstruite ("Pan1") échouait donc systématiquement — on applique ici la MÊME
        // transformation (suppression des espaces) des deux côtés avant de comparer.
        let panIdStripped = subPvId.slice(pvId.length + 1);
        // Côté d'un dôme (champ "<pan>_Dome1" / "<pan>_Dome2", cf. champsDuPan) : même pan, câblage
        // propre au côté (cleCablage) et panneaux de ce côté seulement (domeCote).
        let domeCote = null;
        CM.SUFFIXES_CHAMP_DOME.forEach((suffixe, cote) => {
            if (domeCote === null && panIdStripped.endsWith(suffixe)) {
                domeCote = cote;
                panIdStripped = panIdStripped.slice(0, -suffixe.length);
            }
        });
        const state = (CM.state && CM.state.sourceId === pvId) ? CM.state : savedStatesBySourceId.get(pvId);
        if (!state) return null;
        const pan = (state.pans || []).find((p) => p.id.replace(/\s+/g, '') === panIdStripped);
        if (!pan) return null;
        if (domeCote === null) return { pan, state };
        return { pan, state, domeCote, cleCablage: pan.id + CM.SUFFIXES_CHAMP_DOME[domeCote] };
    }

    // NOUVEAU (fonctionnalité "Câblage DC") : la vue Câblage DC mute state.cablageDc[pan.id]
    // directement (référence obtenue via getPanForSubPvId ci-dessus) — pas de setter passant par
    // setMaisonFieldResult (qui n'accepte qu'une réaffectation scalaire d'un seul champ). Ce point
    // d'entrée déclenche la même sauvegarde (localStorage immédiat + BD debouncée) une fois la
    // mutation faite, réutilisant telle quelle l'infrastructure déjà en place ci-dessus.
    function persistCablageDcChange(pvId) {
        if (!pvId) return;
        persistStateForSource(pvId);
        document.dispatchEvent(new CustomEvent('calepinageMaisonFieldChanged', { detail: { sourceId: pvId, champ: 'cablageDc' } }));
    }

    /**
     * Persiste l'état ENTIER d'un champ PV, sans rien y écrire.
     *
     * CORRECTIF (bug rapporté : "lorsque je modifie la pente dans le formulaire, la synchronisation
     * des dimensions de l'ombrière ne se fait plus, l'ombrière prend des dimensions par défaut").
     * Le formulaire PRO / Grand projet (calepinage_maison_form_pro.js) appelait
     * `setMaisonFieldResult(pvId, 'pans', null)` pour déclencher la sauvegarde après un geste de
     * l'utilisateur. Or ce setter AFFECTE la valeur reçue : il écrasait donc `state.pans` par `null`
     * à chaque saisie. Plus aucun panneau -> `mesurerChamp()` renvoyait null -> le configurateur
     * d'ombrière ne recevait plus rien et retombait sur ses valeurs par défaut.
     *
     * Ce point d'entrée fait ce que l'appelant voulait vraiment : sauvegarder (localStorage
     * immédiat + BD debouncée) et prévenir les autres composants, sans muter l'état. Même
     * infrastructure que persistCablageDcChange ci-dessus.
     */
    function persisterEtatChamp(pvId, origine) {
        if (!pvId) return;
        persistStateForSource(pvId);
        document.dispatchEvent(new CustomEvent('calepinageMaisonFieldChanged', {
            detail: { sourceId: pvId, champ: origine || 'etat' },
        }));
    }

    // NOUVEAU (demande explicite : "synchroniser la quantité de matériels du calepinage
    // multi-typologie au modal études économiques résidentiel") : une entrée PAR MAISON connue
    // (pas par pan, contrairement à getAllPvFieldSummaries ci-dessus) — les champs
    // onduleur/batterie/pompage solaire sont saisis une fois par maison, pas par pan de toiture.
    // Consommé par ResidentielCapexTable.js::syncFromCalepinage().
    function getAllHousesEquipmentSummary() {
        ensureAllSourcesLoaded();

        const houses = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (deletedSourceIds.has(sourceId)) return; // champ PV supprimé cette session
            const previousState = CM.state;
            CM.state = state;
            const panelCount = (state.pans || []).reduce((sum, pan) => sum + CM.packPanelsForPan(pan).length, 0);
            // Type d'onduleur (chaîne/hybride/micro) déduit du catalogue, pour le sélecteur "type de
            // conversion" du chiffrage — getOnduleurSelectionne() lit CM.state, d'où l'appel ici.
            const onduleur = (typeof CM.getOnduleurSelectionne === 'function') ? CM.getOnduleurSelectionne() : null;
            CM.state = previousState;

            houses.push({
                sourceId,
                panelCount,
                panelRef: state.panelRef || '',
                hasOnduleur: (Number(state.onduleurPuissanceKva) || 0) > 0,
                onduleurType: onduleur ? onduleur.type : '',
                optimiseurRef: state.optimiseurRef || '',
                batteryRef: state.batteryRef || '',
                batteryCapaciteKwh: Number(state.batteryCapaciteKwh) || 0,
                pompageSolaireActif: !!state.pompageSolaireActif,
                pompageSolaireRef: state.pompageSolaireRef || '',
            });
        });
        return houses;
    }

    // Type de structure (typeMontage, ex. 'ombriere_metal', 'champ_solaire') de chaque champ PV du
    // projet, sans calcul de panneaux : pilote les lignes Structure porteuse / Pannes du chiffrage
    // CAPEX PRO (ResidentielCapexTable.js::detecterTypesStructure()).
    function getTypesMontage() {
        ensureAllSourcesLoaded();
        const types = [];
        savedStatesBySourceId.forEach((state, sourceId) => {
            if (deletedSourceIds.has(sourceId)) return;
            if (state.typeMontage) types.push(state.typeMontage);
        });
        return types;
    }

    // NOUVEAU (rapport PDF résidentiel — 2 captures côte à côte dans "Plan de calepinage",
    // demande explicite) : expose l'état COMPLET (pans/obstacles/dimensions...) d'une maison
    // connue par son sourceId — nécessaire pour redessiner son diagramme toiture sur un canvas
    // hors-écran (cf. calepinage_maison_dessin.js::captureRoofDiagramImage()), contrairement aux
    // deux résumés ci-dessus qui n'exposent que des champs choisis.
    function getHouseStateById(sourceId) {
        ensureAllSourcesLoaded();
        return savedStatesBySourceId.get(sourceId) || null;
    }

    // Point d'entrée généralisé : accepte soit l'appel historique positionnel `(polygon, azimuths)`
    // (un vrai google.maps.Polygon, cf. polygon_maison.js), soit un objet
    // `{type:'maps', polygon, azimuths}` / `{type:'image', sourceId, label, roofLocal}` (cf.
    // calepinage_image_source.js).
    window.openCalepinageMaisonModal = function (source, azimuthsLegacy) {
        const cfg = (source && source.type) ? source : { type: 'maps', polygon: source, azimuths: azimuthsLegacy };

        ensureSessionCacheMatchesProject();
        initPanelParamsIfNeeded();
        if (!CM.modal) CM.createModal();

        const sourceId = cfg.type === 'maps' ? cfg.polygon.maisonId : cfg.sourceId;
        const isFirstOpenThisSession = !savedStatesBySourceId.has(sourceId);
        registerSource(sourceId, cfg.type === 'maps' ? cfg.polygon.maisonId : cfg.label, cfg.type);
        switchToSource(sourceId);

        // Portée function (pas block-scope du `if` ci-dessous) : réutilisé plus bas, après la
        // fermeture de ce bloc if/else, pour restaurer le contour frais après applyPersistedState()
        // (cf. commentaire détaillé sur son affectation).
        let freshRoofLocal;
        // CORRECTIF DÉFINITIF (bug rapporté : "à la réouverture d'un projet sauvegardé — ou dès qu'un
        // résumé agrégeant toutes les maisons a tourné AVANT l'ouverture manuelle du modal, cf.
        // ensureAllSourcesLoaded() plus haut, chemin emprunté par 'Mes projets'/le résumé
        // Dimensionnement/tout total de puissance — les panneaux d'un rectangle ne sont plus
        // parallèles à ses côtés / ne conservent pas leur azimut initial", confirmé absent du
        // calepinage rectangulaire Pro/Grand-projet).
        //
        // Root cause : LES DEUX sites de resynchronisation ci-dessous ("RESYNC 1"/"RESYNC 2")
        // recalculaient SYSTÉMATIQUEMENT pan.angle/pan.azimuth depuis la géométrie vivante du
        // polygone à CHAQUE appel de cette fonction — y compris quand rien n'a réellement changé
        // depuis la dernière fois que cet angle a été établi. C'est notamment TOUJOURS le cas quand
        // ensureAllSourcesLoaded() a déjà chargé "à froid" cette maison avant que l'utilisateur ne
        // clique dessus (très courant : tout écran agrégeant plusieurs maisons appelle
        // getAllPvFieldSummaries()/computeAllHousesResultsSummary() → ensureAllSourcesLoaded(), qui
        // pose explicitement currentPolygonRef = poly sur l'état "à froid" pour de bonnes raisons —
        // cf. son propre commentaire — mais fait du même coup passer RESYNC 1 (currentPolygonRef ===
        // cfg.polygon) au lieu de la branche "nouveau contour" à la toute première ouverture RÉELLE
        // du modal par l'utilisateur). Dans TOUS les cas (ce chemin comme une simple réouverture),
        // cette double dérivation de la même géométrie (une fois quand l'angle a été établi, une
        // autre à chaque réouverture) n'a aucune garantie de reproduire exactement la même valeur
        // (arrondis du round-trip lat/lng, edge cases de simplifyCollinearLocal...) : la moindre
        // divergence, même infime, réoriente TOUTE la grille de panneaux sans qu'aucune forme n'ait
        // réellement changé.
        //
        // Correction structurelle : pan.angle/pan.azimuth sont des données UTILISATEUR faisant
        // autorité. On ne les recalcule depuis la géométrie QUE si le contour a RÉELLEMENT changé de
        // FORME depuis la dernière fois qu'ils ont été établis pour lui — comparaison géométrique
        // TOLÉRANTE (CM.roofLocalsMatch), jamais sur la seule foi d'une réouverture de modal.
        // `pan.points`, eux, continuent TOUJOURS de suivre le contour vivant (un rectangle a pu être
        // légitimement redimensionné sur la carte entre-temps) — seule l'ORIENTATION est protégée.
        const oldRoofLocalAtEntry = (CM.state.roofLocal || []).slice(); // baseline pour RESYNC 1

        if (cfg.type === 'maps') {
            CM.getMapContainerProjection();

            CM.state.azimuths = cfg.azimuths || [];
            CM.renderAzimuths(cfg.azimuths);

            const path = cfg.polygon.getPath().getArray();
            const origin = path[0];
            CM.state.roofLocalOrigin = origin;
            CM.state.roofLocal = CM.simplifyCollinearLocal(path.map((p) => CM.latLngToLocal(origin, p)));
            CM.state.refAngle = CM.computeRefAngle(CM.state.roofLocal);
            // CORRECTIF (bug rapporté : "à la sauvegarde les panneaux étaient parallèles au
            // rectangle, à l'ouverture du projet ils sont en biais") : capturé ICI, avant
            // applyPersistedState() plus bas — qui, contrairement à ce que prétend le commentaire
            // "CORRECTIF" juste en dessous ("roofLocal... ne sont JAMAIS persistés"), écrase bel et
            // bien CM.state.roofLocal avec l'instantané SAUVEGARDÉ, puisque 'roofLocal' fait partie
            // de PERSISTED_STATE_FIELDS (ajouté séparément pour un autre correctif — cf. le
            // commentaire sur cette entrée du tableau). Cet écrasement contredisait silencieusement
            // l'hypothèse du bloc de resynchronisation plus bas (qui suppose lire ici le contour
            // FRAIS, recalculé depuis le polygone vivant) : le pan se retrouvait donc réorienté
            // d'après un roofLocal PÉRIMÉ (un repère local différent, recalculé à un instant
            // différent — origine/rotation potentiellement décalées) plutôt que le contour
            // réellement affiché, d'où le désalignement visible à la réouverture.
            freshRoofLocal = CM.state.roofLocal;
            // NOUVEAU (demande explicite : "polygone libre : panneaux plein sud par défaut, toujours
            // alignés") : resynchronisé à chaque ouverture depuis le polygone vivant (poly.maisonMode,
            // posé par polygon_maison.js::_initPolygon()/restorePolygons()), comme roofLocal
            // ci-dessus — repli sur 'polygon' (jamais 'rect') pour un polygone dessiné avant ce
            // correctif, cf. polygon_maison.js::restorePolygons().
            // CORRECTIF (bug rapporté, gravissime : calepinage rectangulaire désorganisé au retour
            // sur un projet) : le repli en cas de mode absent était 'polygon', ce qui fait perdre au
            // rectangle son orientation (en mode 'polygon', l'angle de référence est une constante
            // plein sud, cf. resetDivision et les 2 resynchronisations plus bas). Or un contour
            // revenu de la base arrivait TOUJOURS sans mode. Déduction géométrique à la place.
            CM.state.contourMode = cfg.polygon.maisonMode
                || (window.MaisonPolygonManager
                    ? window.MaisonPolygonManager.inferModeFromPath(cfg.polygon.getPath().getArray())
                    : 'polygon');

            if (CM.state.currentPolygonRef !== cfg.polygon) {
                CM.state.currentPolygonRef = cfg.polygon;
                CM.state.obstacles = [];
                CM.state.selectedObstacleId = null;
                CM.state.mapScreenshotImgObj = null;
                CM.state.mapScreenshotRef = null;
                CM.state.showBackgroundImage = false;
                CM.resetDivision();
            } else if (CM.state.pans.length) {
                // CORRECTIF (demande explicite : "les panneaux deviennent en biais quand on
                // modifie les arêtes d'un polygone... doivent toujours être parallèles à une face,
                // idéalement la largeur du polygone comme référence" + "la flèche de l'azimut doit
                // toujours être parallèle aux panneaux") : ce même polygone est réédité (sommet
                // déplacé) — pan.angle/pan.azimuth restaient dérivés de CM.state.refAngle
                // (computeRefAngle : arête la plus longue "du moment", instable) et pouvaient
                // diverger l'un de l'autre. Recalcule les deux, pour TOUS les pans (toit simple ou
                // divisé), depuis une référence stable (computeWidthEdgeAngle) — ne retouche pas
                // les points/le tracé des pans divisés (2/4 pans), seule leur orientation l'est.
                // CORRECTIF (demande explicite : "polygone libre : toujours alignés") : en mode
                // 'polygon', la référence est une CONSTANTE réglable (azimut plein sud par défaut)
                // plutôt que géométrique (instable pour un polygone libre non rectangulaire) —
                // jamais de dérive au fil des éditions du contour.
                // CORRECTIF (bug rapporté : "inversion paysage/portrait pour le Monopente") :
                // computeLengthEdgeAngle() (arête longueur, cohérente avec l'axe que
                // computeCandidatePanelSlots() suppose partout) remplace computeWidthEdgeAngle()
                // (arête largeur, perpendiculaire — faisait échanger les axes X/Y locaux). +
                // rectAzimuthOffsetDeg (demande explicite : rotation par paliers de 90°) — additif,
                // survit donc à cette resynchronisation au lieu d'être écrasé.
                // pan.points suit TOUJOURS le contour vivant (redimensionnement possible depuis la
                // dernière fois) — indépendant de la protection de l'orientation ci-dessous.
                if (CM.state.divisionMode === 'none') CM.state.pans[0].points = CM.state.roofLocal;
                // CORRECTIF DÉFINITIF (RESYNC 1, cf. commentaire détaillé plus haut sur
                // oldRoofLocalAtEntry) : ne recalcule angle/azimut QUE si le contour a RÉELLEMENT
                // changé de forme depuis la dernière fois (comparaison géométrique tolérante) — jamais
                // sur la seule foi d'un `currentPolygonRef` déjà posé (vrai aussi bien pour une vraie
                // réédition que pour une maison chargée "à froid" par ensureAllSourcesLoaded puis
                // simplement ouverte sans jamais avoir été éditée).
                if (!CM.roofLocalsMatch(oldRoofLocalAtEntry, CM.state.roofLocal, 0.05)) {
                    const stableRefAngle = CM.angleReferenceStable(CM.state, CM.state.roofLocal);
                    CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, stableRefAngle));
                }
            }
        } else {
            CM.state.azimuths = [];
            CM.renderAzimuths([]);
            CM.state.roofLocalOrigin = null;
            CM.state.currentPolygonRef = null;

            if (!CM.state.pans.length) {
                const DEFAULT_W_M = 10, DEFAULT_H_M = 8;
                const cx = cfg.imageEl.width / (2 * cfg.imageScalePxPerM);
                const cy = -(cfg.imageEl.height / (2 * cfg.imageScalePxPerM));
                CM.state.roofLocal = [
                    { x: cx - DEFAULT_W_M / 2, y: cy - DEFAULT_H_M / 2 }, { x: cx + DEFAULT_W_M / 2, y: cy - DEFAULT_H_M / 2 },
                    { x: cx + DEFAULT_W_M / 2, y: cy + DEFAULT_H_M / 2 }, { x: cx - DEFAULT_W_M / 2, y: cy + DEFAULT_H_M / 2 },
                ];
            }
            CM.state.refAngle = CM.computeRefAngle(CM.state.roofLocal);
            if (!CM.state.pans.length) CM.resetDivision();

            CM.state.mapScreenshotImgObj = cfg.imageEl;
            CM.state.mapScreenshotRef = {
                m1: { x: 0, y: 0 }, m2: { x: 1, y: 0 },
                p1: { x: 0, y: 0 }, p2: { x: cfg.imageScalePxPerM, y: 0 },
            };
            CM.state.showBackgroundImage = true;
        }

        CM.state.sourceType = cfg.type;
        CM.state.sourceId = sourceId;

        // Restauration localStorage — uniquement à la 1re ouverture de cette source dans la
        // session courante, APRÈS que la géométrie de référence ci-dessus a été réétablie depuis
        // la source vivante (jamais depuis l'instantané, potentiellement obsolète).
        let etatEnregistre = false;
        if (isFirstOpenThisSession && window.CalepinagePersistence) {
            const saved = window.CalepinagePersistence.load(sourceId);
            if (saved && saved.state) {
                applyPersistedState(CM.state, saved.state);
                // Géométrie enregistrée ramenée dans le repère du contour vivant (cf. recalerSurOrigine).
                if (cfg.type === 'maps') recalerSurOrigine(CM.state, saved.state.roofLocalOriginLatLng, CM.state.roofLocalOrigin);
            }
            etatEnregistre = !!(saved && saved.state);
        }
        // NOUVEAU (décalage de parcelles cadastrales, cf. components/decalage_parcelles/) : un contour
        // généré pour un type de structure donné (poly.typeMontageInitial = 'champ_solaire') naît
        // directement avec ce type, au lieu du défaut 'toiture_residentielle'. Uniquement pour un
        // état tout neuf : un état déjà enregistré garde le type choisi par l'utilisateur.
        if (cfg.type === 'maps' && cfg.polygon && cfg.polygon.typeMontageInitial
            && isFirstOpenThisSession && !etatEnregistre
            && CM.normalizeTypeMontage(CM.state.typeMontage) === 'toiture_residentielle') {
            appliquerReglagesInitiaux(CM.state, cfg.polygon);
            (CM.state.pans || []).forEach((pan) => { pan.poseMode = CM.state.poseMode; });
        }
        // CORRECTIF (même bug) : le mode de tracé restauré avec l'état de la maison fait autorité —
        // c'est une donnée utilisateur, alors que celui porté par le contour vivant a pu être déduit
        // ou perdu en base. On le redescend sur le polygone de la carte (et on le persiste), pour que
        // l'éditeur contraigne de nouveau les rectangles ET que les réouvertures suivantes de ce
        // modal dans la même session — qui ne repassent pas par la restauration ci-dessus — ne
        // rétrogradent plus l'orientation du calepinage.
        if (cfg.type === 'maps' && cfg.polygon && CM.state.contourMode
            && cfg.polygon.maisonMode !== CM.state.contourMode
            && window.MaisonPolygonManagerInstance
            && typeof window.MaisonPolygonManagerInstance.setPolygonMode === 'function') {
            window.MaisonPolygonManagerInstance.setPolygonMode(cfg.polygon, CM.state.contourMode);
        }
        // Contour associé à pan.angle/pan.azimuth TEL QUE RESTAURÉ ci-dessus (persistance si trouvée
        // — CM.state.roofLocal vient alors d'être écrasé par le contour SAUVEGARDÉ, cf. commentaire
        // ci-dessous — sinon la géométrie fraîche déjà en place depuis plus haut, inchangée). Comparé
        // plus bas à la géométrie vivante pour RESYNC 2 : même principe que oldRoofLocalAtEntry pour
        // RESYNC 1 (cf. commentaire détaillé tout en haut de cette fonction).
        const oldRoofLocalAfterPersistence = (CM.state.roofLocal || []).slice();

        // CORRECTIF (bug rapporté : "les panneaux ne sont pas à l'intérieur du tracé par défaut, il
        // faut cliquer sur Réinitialiser") : pour une source 'maps', roofLocal/roofLocalOrigin ne sont
        // JAMAIS persistés (toujours recalculés depuis le polygone vivant, ci-dessus) — mais
        // applyPersistedState() vient d'écraser CM.state.pans avec une géométrie SAUVEGARDÉE, qui peut
        // appartenir à un tracé DIFFÉRENT ayant occupé le même sourceId lors d'une session précédente
        // (l'identifiant "MAISONn" repart de 1 à chaque rechargement de page, cf.
        // MaisonPolygonManager::_initPolygon). Tant qu'aucune division en pans n'a été appliquée
        // (divisionMode 'none', le cas par défaut d'un tout nouveau tracé), on resynchronise le pan
        // unique sur le contour réellement affiché plutôt que de laisser une géométrie de pans obsolète
        // — même principe que la resynchronisation déjà faite plus haut pour une réédition de sommet.
        //
        // CORRECTIF (bug rapporté : "panneaux en biais à la réouverture du projet") : le commentaire
        // ci-dessus affirme que roofLocal n'est JAMAIS persisté — c'était vrai au moment où il a été
        // écrit, mais 'roofLocal' a depuis été ajouté à PERSISTED_STATE_FIELDS (correctif "le
        // canevas ne s'affiche jamais dans le rapport PDF") SANS mettre à jour ce commentaire ni ce
        // bloc : applyPersistedState() juste au-dessus écrase donc bel et bien CM.state.roofLocal
        // avec l'instantané sauvegardé (potentiellement périmé — repère local recalculé à un instant
        // différent), invalidant l'hypothèse du reste de ce bloc. On restaure ici le contour FRAIS
        // (freshRoofLocal, capturé plus haut avant cet écrasement) pour une source 'maps' — seule
        // pans/obstacles/etc. doivent venir de la persistance, jamais le contour lui-même, qui doit
        // toujours refléter le polygone réellement affiché sur la carte.
        if (cfg.type === 'maps') CM.state.roofLocal = freshRoofLocal;

        if (cfg.type === 'maps' && CM.state.divisionMode === 'none' && CM.state.pans.length) {
            // pan.points suit TOUJOURS le contour vivant (le rectangle a pu être redimensionné sur la
            // carte depuis la dernière sauvegarde) — ceci est indépendant du bug d'orientation corrigé
            // juste en dessous et reste nécessaire dans tous les cas.
            CM.state.pans[0].points = CM.state.roofLocal;
            // CORRECTIF DÉFINITIF (RESYNC 2, cf. commentaire détaillé tout en haut de cette fonction
            // sur oldRoofLocalAfterPersistence) : NE PAS recalculer angle/azimut depuis la géométrie
            // si le contour n'a pas réellement changé de forme depuis la dernière fois — la valeur
            // qui vient d'être restaurée par applyPersistedState() (ou laissée par RESYNC 1 ci-dessus)
            // fait déjà foi. On ne (re)dérive depuis computeLengthEdgeAngle()/angleForAzimuth() que
            // pour un contour dont la forme a effectivement changé (ou un pan tout juste créé, sans
            // aucune référence fiable au départ).
            if (!CM.roofLocalsMatch(oldRoofLocalAfterPersistence, CM.state.roofLocal, 0.05)) {
                // CORRECTIF (même demande que ci-dessus) : angle/azimut dérivés de la référence stable
                // plutôt que de CM.state.refAngle (arête la plus longue "du moment") — constante réglable
                // en mode 'polygon' (cf. plus haut), computeLengthEdgeAngle() + rectAzimuthOffsetDeg sinon
                // (cf. commentaire détaillé au 1er site de resynchronisation ci-dessus).
                const resyncRefAngle = CM.angleReferenceStable(CM.state, CM.state.roofLocal);
                CM.applyReferenceAngleToPan(CM.state.pans[0], resyncRefAngle);
            }
        }

        // CORRECTIF (bug rapporté : "il arrive qu'on clique sur les dimensions ou sur le bouton du
        // modal et cela n'ouvre pas le modal de calepinage multi-typologie").
        //
        // Root cause : cette longue séquence de rafraîchissement s'exécutait AVANT l'affichage du
        // modal, sans aucune protection. La moindre exception dans l'une de ces fonctions (un champ
        // dont l'état revient incomplet de la base, une référence DOM pas encore peuplée, un calcul
        // sur un contour dégénéré...) interrompait la fonction ENTIÈRE : les deux lignes qui
        // affichent le modal, tout en bas, n'étaient jamais atteintes. Vu de l'utilisateur : le clic
        // "ne fait rien", de façon intermittente (selon le champ PV et son état).
        //
        // L'affichage du modal ne dépend d'aucune de ces étapes : on les exécute une par une, une
        // étape en échec est signalée dans la console SANS empêcher les suivantes ni l'ouverture.
        // Mieux vaut un modal ouvert avec un panneau non rafraîchi (l'utilisateur le voit et peut
        // agir) qu'un clic sans effet.
        const etapesRafraichissement = [
            ['computeFit', () => CM.computeFit()],
            ['updateContourDimsUI', () => CM.updateContourDimsUI()],
            ['updatePoseModeUI', () => CM.updatePoseModeUI()],
            ['updateViewToggleUI', () => { if (CM.viewToggleBtn) CM.updateViewToggleUI(); }],
            ['updatePanToolUI', () => { if (CM.panToolBtn) { CM.state.panToolActive = false; CM.updatePanToolUI(); } }],
            ['panelTool', () => {
                CM.state.panelToolMode = 'none';
                if (CM.modalBody) { CM.updatePanelToolButtonsUI(); CM.updateObstaclePropertiesPanel(); }
            }],
            ['updateSourceDependentUI', () => CM.updateSourceDependentUI()],
            ['selecteurDeSource', () => {
                if (CM.sourceSelectEl) CM.sourceSelectEl.value = sourceId;
                refreshSourceButtons();
            }],
            ['render', () => CM.render()],
            ['recomputeResults', () => recomputeResults()],
            ['casesDAffichage', () => {
                if (CM.previewImg) CM.previewImg.style.display = 'none';
                const showPanelsCheckbox = CM.modalBody ? CM.modalBody.querySelector('#calepinageMaisonShowPanelsCheckbox') : null;
                const showBackgroundCheckbox = CM.modalBody ? CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox') : null;
                if (showPanelsCheckbox) showPanelsCheckbox.checked = CM.state.showPanels;
                if (showBackgroundCheckbox) showBackgroundCheckbox.checked = CM.state.showBackgroundImage;
                if (CM.updateVisibilityToggleButtonsUI) CM.updateVisibilityToggleButtonsUI();
            }],
            ['updateEquipmentFieldsUI', () => CM.updateEquipmentFieldsUI()],
            ['updateBorneEquipmentAvailability', () => CM.updateBorneEquipmentAvailability()],
            ['updateView2D3DUI', () => CM.updateView2D3DUI()],
            ['updateMultiHouseViewUI', () => CM.updateMultiHouseViewUI()],
        ];
        etapesRafraichissement.forEach(([nom, etape]) => {
            try {
                etape();
            } catch (erreur) {
                console.error(`[Calepinage] Rafraîchissement "${nom}" en échec pour ${sourceId} — le modal s'ouvre quand même.`, erreur);
            }
        });

        // CONTRÔLE STRICT LICENCE (Nouvelle forme tracée dépassant le plafond)
        if (typeof window.checkPowerLicenceCompliance === 'function') {
            const summary = computeAllHousesResultsSummary();
            const totalPower = summary ? (summary.totalPowerKwc || 0) : 0;
            const licenceCheck = window.checkPowerLicenceCompliance(totalPower);
            if (licenceCheck && (licenceCheck.allowed === false || licenceCheck.compliant === false)) {
                if (isFirstOpenThisSession && cfg.type === 'maps' && cfg.polygon && window.MaisonPolygonManagerInstance) {
                    const maxAllowedKwc = licenceCheck.maxAllowedKwc ?? licenceCheck.max_allowed_kwc;
                    const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                    const tol = licenceCheck.tolerancePercent ?? licenceCheck.tolerance_percent ?? 10;
                    alert(`[Licence PV] La puissance totale calculée (${Number(totalPower).toFixed(2)} kWc) dépasse la puissance maximale autorisée par votre licence (${maxAllowedStr} kWc avec marge de tolérance de ${tol}%).\n\nLe calepinage et le tracé de ce contour ont été automatiquement annulés.`);
                    window.MaisonPolygonManagerInstance.removePolygon(cfg.polygon);
                    if (typeof CM.closeModal === 'function') CM.closeModal();
                    return;
                }
            }
        }

        CM.modal.style.setProperty('display', 'flex', 'important');
        CM.backdrop.style.setProperty('display', 'block', 'important');

        // NOUVEAU (demande explicite : "dès que l'utilisateur trace un polygone ou un rectangle, il
        // faut prendre la capture d'écran et l'afficher automatiquement") : mapScreenshotImgObj/
        // mapScreenshotRef ne sont JAMAIS persistés (cf. leurs commentaires dans createDefaultState) —
        // la capture est donc de toute façon à refaire à CHAQUE ouverture du modal (rechargement de
        // page, projet rouvert...), pas seulement au tout premier tracé. On la déclenche ici
        // automatiquement dès qu'aucune capture n'est encore en mémoire pour cette maison ; le bouton
        // "Capture d'écran" reste utilisable pour l'ACTUALISER manuellement (ex. après avoir modifié
        // les dimensions du rectangle), sans jamais être remplacé/désactivé par cet appel automatique.
        if (cfg.type === 'maps' && !CM.state.mapScreenshotImgObj && typeof CM.captureMapView === 'function') {
            CM.captureMapView().catch(() => { /* échec silencieux : l'utilisateur garde le bouton manuel */ });
        }

        // NOUVEAU (demande explicite : "si on est sur le modal calepinage résidentielle et on
        // actualise la page, on doit revenir sur le modal") : drapeau one-shot en sessionStorage
        // (même idiome que autoOpenConsEnergie, cf. parametreProjetFormManager.js/
        // navigation-modales.js), consommé au prochain chargement de page par polygon_maison.js
        // juste après restorePolygons() — retiré par closeModal() (formulaires.js) dès que
        // l'utilisateur ferme volontairement ce modal, pour qu'un rechargement APRÈS fermeture ne le
        // rouvre pas de force. Ne fonctionne que pour une source 'maps' (polygone réel, reconstruit
        // automatiquement au chargement) — une source 'image' n'est volontairement jamais persistée
        // au-delà de la session (cf. calepinage_image_source.js) : le drapeau resterait simplement
        // sans correspondance au rechargement suivant et serait nettoyé silencieusement à ce moment.
        try { sessionStorage.setItem('calepinage_maison_lastOpenSourceId', sourceId); } catch (e) { /* ignore */ }
    };

    // Forme robuste (pas un déréférencement figé au moment du parsing) : CM.closeModal n'existe
    // que si formulaires.js s'est déjà exécuté, mais cet appel n'a de toute façon lieu qu'après
    // une interaction utilisateur, bien après que les 4 scripts aient fini de s'exécuter.
    window.closeCalepinageMaisonModal = function () { CM.closeModal(); };

    // --------------------------------------------------------------------------------------
    // Export vers le namespace partagé (fonctions appelées depuis dessin.js / formulaires.js)
    // --------------------------------------------------------------------------------------
    Object.assign(CM, {
        createDefaultState, recomputeResults, computeAllHousesResultsSummary, persistCurrentState, removeSourceOption, switchToSource, getFirstKnownSourceId,
        normalizeDrawingState,
        getAllPvFieldSummaries, getOtherHousesReprojected, getAllHousesEquipmentSummary, getTypesMontage,
        listerChampsCarte, getOtherHouseContoursReprojected, resynchroniserChampSurContour, renumeroterChampsPV,
        remapperDonneesLocalesChamps, purgerCachesProjet,
        // Exposé pour calepinage_maison_form_pro.js : construire le gabarit du modal (CM.createModal)
        // sans l'ouvrir exige la même préparation que openCalepinageMaisonModal juste au-dessus.
        initPanelParamsIfNeeded,
        getHouseStateById, getPvFieldsForChainesPertes, setMaisonFieldResult, persisterEtatChamp,
        getPanForSubPvId, persistCablageDcChange, champsDuPan,
        copierEtatChamp, collerEtatChamp,
    });
})();
