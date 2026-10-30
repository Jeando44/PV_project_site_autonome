/**
 * Calepinage résidentiel — configuration structurée de la barre d'outils du modal (#cmToolbar) et
 * des 3 toggles persistants de l'entête (demande explicite : "modulariser la configuration des
 * actions dans un fichier dédié").
 *
 * RENDU UNIQUEMENT : chaque bouton généré depuis ce fichier par createModal()
 * (calepinage_maison_formulaires.js) garde son `id` EXACTEMENT tel qu'avant cette refonte — tout le
 * câblage d'événements existant ailleurs (calepinage_maison_dessin.js, calepinage_maison_
 * orchestrateur.js), qui retrouve ces boutons par querySelector(`#id`), continue de fonctionner sans
 * aucune modification. Seules les actions ENTIÈREMENT NOUVELLES de ce lot (3 toggles d'entête + le
 * déclencheur du sous-menu Obstacles) n'ont pas encore de câblage ailleurs : leur comportement est
 * câblé directement par createModal() au moment de la génération (pas de champ onClick ici — un
 * simple id/target suffit, cf. wireHeaderToggles() dans calepinage_maison_formulaires.js).
 *
 * icon/iconType : 'fa' = classe Font Awesome existante (bouton dont la demande explicite est de
 * garder "l'icône actuelle") ; 'svg' = fichier dans medias/icons/<icon>.svg.
 */
(function () {
    window.CalepinageMaisonToolbarConfig = {
        // Toggles persistants de l'entête (jamais masqués, contrairement à #cmToolbar/#cmLeftPanel).
        headerToggles: [
            { id: 'cmToggleLeftPanelBtn', icon: 'fa-columns', iconType: 'fa', tooltip: 'Afficher/masquer le formulaire', target: '#cmLeftPanel' },
            { id: 'cmToggleToolbarBtn', icon: 'fa-tools', iconType: 'fa', tooltip: "Afficher/masquer la barre d'outils", target: '#cmToolbar' },
            { id: 'cmToggleResultsBtn', icon: 'fa-chart-bar', iconType: 'fa', tooltip: 'Afficher/masquer la carte de résultats', target: '#cmResultsWrapper' },
        ],

        // Sous-menu Obstacles : un déclencheur + un panneau popup qui reste ouvert jusqu'au re-clic
        // sur le déclencheur (même principe que ButtonControl.js::toggleMatElecMenu/
        // togglePolygoneAperMenu). Les items gardent `data-obstacle-type` et le glissé-déposé déjà
        // câblé par calepinage_maison_dessin.js::setupPaletteDrag() — génériques sur
        // CM.modalBody.querySelectorAll('[data-obstacle-type]'), donc inchangés.
        obstacles: {
            triggerId: 'cmObstaclesMenuBtn',
            triggerIcon: 'obstacle',
            triggerTooltip: 'Obstacles (glisser-déposer sur la toiture)',
            items: [
                { type: 'velux', icon: 'window-svgrepo-com', label: 'Velux' },
                { type: 'lanterneau', icon: 'window-plus-1463-svgrepo-com', label: 'Lanterneau' },
                { type: 'cheminee', icon: 'chimney-svgrepo-com', label: 'Cheminée' },
                { type: 'vmc', icon: 'circle-dashed-svgrepo-com', label: 'Sortie VMC' },
                { type: 'circulaire', icon: 'circle', label: 'Obstacle circulaire' },
                { type: 'ligne', icon: 'line', label: 'Obstacle ligne' },
                { type: 'forme', icon: 'line-to-polygon', label: 'Forme libre' },
            ],
        },

        // Groupes de #cmToolbar, séparés visuellement par un séparateur vertical (comportement
        // déjà en place) entre chaque groupe.
        groups: [
            {
                key: 'vues',
                buttons: [
                    { id: 'calepinageMaisonViewToggleBtn', icon: 'north-arrow-n-svgrepo-com', iconType: 'svg', tooltip: 'Vue Nord-Sud' },
                    { id: 'cmView2D3DBtn', icon: '3D', iconType: 'svg', tooltip: 'Basculer 2D/3D — la vue 3D sera implémentée ultérieurement' },
                    { id: 'cmZoomInBtn', icon: 'fa-search-plus', iconType: 'fa', tooltip: 'Zoom avant' },
                    { id: 'cmZoomOutBtn', icon: 'fa-search-minus', iconType: 'fa', tooltip: 'Zoom arrière' },
                    { id: 'cmFitViewBtn', icon: 'fa-expand', iconType: 'fa', tooltip: 'Ajuster la vue (contour + image de fond)' },
                    { id: 'cmMultiHouseViewBtn', icon: 'fa-layer-group', iconType: 'fa', tooltip: 'Affiche toutes les maisons connues (lecture seule) sur la même vue' },
                    { id: 'cmPanToolBtn', icon: 'fa-arrows-alt', iconType: 'fa', tooltip: 'Déplacer la vue' },
                    // NOUVEAU (demande explicite : "placer 2 icônes pour Afficher les panneaux /
                    // Afficher le fond de carte dans le menu horizontal") : pilotent CM.state.
                    // showPanels/showBackgroundImage — wiring dédié (pas générique comme
                    // headerToggles), cf. wireVisibilityToggleButtons() dans calepinage_maison_
                    // formulaires.js. Les checkboxes d'origine (#cmLeftPanel) restent dans le DOM,
                    // cachées, pour ne rien casser du câblage existant ailleurs (orchestrateur.js,
                    // calepinage_maison_dessin.js::captureMapView).
                    { id: 'cmToggleShowPanelsBtn', icon: 'panneau-solaire', iconType: 'svg', tooltip: 'Afficher/masquer les panneaux' },
                    { id: 'cmToggleShowBackgroundBtn', icon: 'satellite', iconType: 'svg', tooltip: 'Afficher/masquer le fond de carte (capture)' },
                    // NOUVEAU (demande explicite) : masque UNIQUEMENT les cotations (longueurs du contour,
                    // cote du rampant sur le plan de coupe) — même icône que le bouton cotations du
                    // calepinage grand projet (show-hidden-cotation-button, ButtonControl.js). Pilote
                    // CM.state.showCotations, cf. wireVisibilityToggleButtons() (formulaires.js).
                    { id: 'cmToggleShowCotationsBtn', icon: 'cotations', iconType: 'svg', tooltip: 'Afficher/masquer les cotations' },
                ],
            },
            {
                key: 'edition',
                buttons: [
                    { id: 'cmMovePanelsBtn', icon: 'fa-arrows-alt-h', iconType: 'fa', tooltip: 'Cliquer-glisser sur un pan déplace tous ses panneaux' },
                    // 2026-10-09 (demande explicite) : déplacer le champ PV entier (contour + panneaux).
                    { id: 'cmMoveFieldBtn', icon: 'fa-expand-arrows-alt', iconType: 'fa', tooltip: 'Déplacer le champ PV : cliquer-glisser à l\'intérieur du contour (Échap pour annuler)' },
                    { id: 'cmDeletePanelsBtn', icon: 'fa-eraser', iconType: 'fa', tooltip: 'Clic = supprimer un panneau — Clic droit = restaurer le plus proche supprimé' },
                    // 2026-10-09 (demande explicite) : suppression multiple, placée juste après la gomme.
                    { id: 'cmDeletePanelsRectBtn', icon: 'fa-vector-square', iconType: 'fa', tooltip: 'Glisser = supprimer les panneaux d\'une zone (tout panneau touché) — Glisser au clic droit = restaurer les panneaux supprimés de la zone — Échap pour annuler' },
                    { id: 'cmToggleOrientationCardBtn', icon: 'fa-eye', iconType: 'fa', tooltip: 'Afficher/masquer la carte Inclinaison/Azimut sur les panneaux' },
                    { id: 'cmFlipAzimuthBtn', icon: 'rotate-right', iconType: 'svg', tooltip: "Tourner l'azimut de 90° (Sud→Ouest→Nord→Est→Sud) — toiture Monopente uniquement (rectangle ou polygone libre)" },
                ],
            },
            {
                key: 'contour',
                buttons: [
                    { id: 'calepinageMaisonDrawRectBtn', icon: 'rectangle', iconType: 'svg', tooltip: 'Dessiner un rectangle (contour)' },
                    { id: 'calepinageMaisonDrawPolygonBtn', icon: 'polygon', iconType: 'svg', tooltip: 'Dessiner un polygone libre (contour)' },
                    // RETIRÉ (demande explicite) : bouton "Terminer le contour". Les deux outils se
                    // referment désormais d'eux-mêmes, exactement comme leurs équivalents sur la carte :
                    // le rectangle au 3e clic (profondeur), le polygone libre au clic sur son premier
                    // sommet. Aucun bouton de validation à chercher.
                    // NOUVEAU (demande explicite : "le bouton ligne doit être dans le modal du
                    // calepinage résidentiel", retiré de la palette principale de la carte — cf.
                    // ButtonControl.js) : simple trait de mesure/annotation sur le canevas, sans lien
                    // avec les panneaux/obstacles, même icône (line.svg) que l'ancien bouton. 2 clics
                    // = 1 segment (cf. wireFreeLineButton(), calepinage_maison_dessin.js) ; clic droit
                    // sur une ligne existante la supprime.
                    { id: 'calepinageMaisonDrawLineBtn', icon: 'line', iconType: 'svg', tooltip: 'Dessiner une ligne (trait libre) — clic droit sur une ligne pour la supprimer' },
                    { id: 'calepinageMaisonCoupeBtn', icon: 'cut4-821-svgrepo-com', iconType: 'svg', tooltip: 'Plan de coupe' },
                    { id: 'calepinageMaisonStructureDetailsBtn', icon: 'section-icon-svgrepo-com', iconType: 'svg', tooltip: 'Détails structure' },
                    // NOUVEAU (demande explicite : "supprimer le label Afficher la structure du
                    // formulaire, le remplacer par une icône dans le menu horizontal, après Détails
                    // structure") : pilote CM.state.showStructure — même motif que
                    // cmToggleShowPanelsBtn/cmToggleShowBackgroundBtn (wiring dédié dans
                    // wireVisibilityToggleButtons(), calepinage_maison_formulaires.js).
                    { id: 'cmToggleShowStructureBtn', icon: 'fa-ruler-combined', iconType: 'fa', tooltip: 'Afficher/masquer la structure (pannes/chevrons/liteaux/rails)' },
                    // NOUVEAU (demande explicite : "mettre un bouton de secours dans le menu pour
                    // forcer la réorganisation du calepinage si cela se produit") : filet de sécurité
                    // pour le cas où un calepinage rouvert se retrouverait désorienté (panneaux ayant
                    // perdu l'azimut du contour). Contrairement à "Réinitialiser", il ne supprime rien
                    // et ne retouche pas la division du toit : il ne fait que re-déduire le mode de
                    // tracé du contour puis réaligner l'orientation des pans dessus. Câblage :
                    // wireForceRealignButton(), calepinage_maison_formulaires.js.
                    { id: 'cmForceRealignBtn', icon: 'fa-life-ring', iconType: 'fa', tooltip: "Secours : réaligner le calepinage sur le contour (à utiliser si les panneaux ont perdu l'orientation du tracé)", style: 'background:#fffbeb; color:#92400e; border-color:#fde68a;' },
                    { id: 'calepinageMaisonResetDivisionBtn', icon: 'reset-svgrepo-com', iconType: 'svg', tooltip: 'Réinitialiser', style: 'background:#fef2f2; color:#991b1b; border-color:#fecaca;' },
                    { id: 'calepinageMaisonDeletePolygonBtn', icon: 'clear', iconType: 'svg', tooltip: 'Supprimer le polygone', style: 'background:#dc2626; color:#fff; border-color:#dc2626;' },
                ],
            },
            {
                key: 'export',
                buttons: [
                    { id: 'calepinageMaisonCaptureBtn', icon: 'camera', iconType: 'svg', tooltip: 'Capturer', style: 'background:#dc2626; color:#fff; border-color:#dc2626;' },
                    { id: 'calepinageMaisonExportBtn', icon: 'pdf-export', iconType: 'svg', tooltip: 'Exporter en PDF', style: 'background:#1E8449; color:#fff; border-color:#1E8449;' },
                    // NOUVEAU (demande explicite : "mettre l'icône du schéma unifilaire dans le menu
                    // horizontal du calepinage résidentiel") : même icône/action que le bouton
                    // "schema-unifilaire-button" de la barre d'outils principale de la carte (cf.
                    // ButtonControl.js) — ButtonControl.openSchemaUnifilaireModal() reste la SEULE
                    // implémentation (ouverture de /concevoir_mon_projet/modal/schema_unifilaire dans
                    // l'iframe plein écran), ce bouton n'en est qu'un 2e point d'entrée. Câblage dédié
                    // dans calepinage_maison_formulaires.js (pas générique comme les autres boutons de
                    // ce fichier).
                    { id: 'cmOpenSchemaUnifilaireBtn', icon: 'pencil-slash-svgrepo-com', iconType: 'svg', tooltip: "Ouvrir l'éditeur de schéma unifilaire" },
                    // Dossier de Déclaration préalable (declaration_prealable/DpModal.js), parcours
                    // résidentiel uniquement (cf. appliquerVisibiliteSelonProjet). Câblage dédié dans
                    // calepinage_maison_formulaires.js : ce modal est masqué le temps de la DP (qui a
                    // besoin de la carte) puis réaffiché à sa fermeture.
                    { id: 'cmOpenDeclarationPrealableBtn', icon: 'fa-file-signature', iconType: 'fa', tooltip: 'Déclaration préalable : générer le dossier DP (plans, notice, photos)', style: 'background:#fef2f2; color:#b91c1c; border-color:#fecaca;' },
                ],
            },
        ],
    };
})();
