/**
 * Calepinage résidentiel — sections "Type de calepinage" et "Géométrie de la toiture" reprises
 * dans le formulaire PRO / Grand projet (calepinage.html, un onglet par champ PV).
 *
 * Demande explicite : « Récupérer tous les champs et labels de la section "Géométrie de la toiture"
 * du formulaire Calepinage multi-typologie, les intégrer dans la section "Toiture" du formulaire
 * Grand projet / PRO, et assurer la liaison bidirectionnelle entre ces champs pour piloter à la fois
 * le canvas et la carte. »
 *
 * ── Principe : un MIROIR, pas une copie ──────────────────────────────────────────────────────
 * Rien n'est redéclaré ici — ni les champs, ni leurs libellés, ni leurs bornes, ni leurs règles
 * d'affichage. Les deux sections du formulaire résidentiel (#calepinageMaisonPoseSection et
 * #calepinageMaisonGeometrieSection, calepinage_maison_formulaires.js) sont CLONÉES à l'exécution
 * dans les deux conteneurs vides du gabarit PRO (#cmProPoseHost / #cmProGeometrieHost), un clone
 * par onglet de champ PV. Ajouter ou renommer un champ côté résidentiel le fait donc apparaître
 * côté PRO sans toucher à ce fichier, et les deux formulaires ne peuvent pas diverger.
 *
 * Les ids du clone sont déplacés dans `data-cm-id` (et name/for retirés) : un id ne peut exister
 * qu'une fois dans le document, et TabsManager n'a suffixé que les ids présents dans le gabarit au
 * moment du clonage de l'onglet — pas ceux insérés ensuite. `data-cm-id` sert aussi d'annuaire :
 * il désigne, pour chaque élément du clone, son élément d'origine dans le modal résidentiel.
 *
 * ── Liaison bidirectionnelle ─────────────────────────────────────────────────────────────────
 * PRO -> résidentiel : l'événement (input / change / click) est REJOUÉ sur l'élément d'origine,
 *   CM.state basculé au préalable sur le champ PV de l'onglet. Ce sont donc les gestionnaires
 *   existants du formulaire résidentiel qui s'exécutent — validation, bornes, conversions
 *   d'unités, divisions de toiture, CM.render() et CM.recomputeResults() compris. Aucune règle
 *   métier n'est réécrite ici, donc aucune ne peut diverger.
 * résidentiel -> PRO : sur `calepinageMaisonEtatRecalcule` (émis par recomputeResults, c.-à-d.
 *   après CHAQUE action du modal), `calepinageMaisonFieldChanged`, `maisonShapeAdded`,
 *   `maisonShapesRenumbered` et `tabSelected`. Pour chaque onglet, CM.state est basculé sur son
 *   champ, les fonctions d'affichage du formulaire résidentiel sont rejouées
 *   (updatePoseModeUI / remplirChampsGeometrieDepuisEtat / updateContourDimsUI), puis l'état
 *   affiché est recopié dans le clone : valeurs, visibilité, libellés dynamiques et messages
 *   d'erreur viennent tous de l'original.
 *
 * Canvas ET carte suivent sans traitement particulier : CM.render() redessine le canevas et
 * CM.recomputeResults() reporte les panneaux sur la carte principale (cf.
 * calepinage_maison_carte_plans.js) ; CM.persisterEtatChamp sauvegarde (localStorage + base).
 *
 * Un champ PV du formulaire PRO n'a d'état résidentiel que s'il a été tracé avec l'outil
 * « Calepinage toiture multi-typologie » (disponible dans TOUTES les typologies, cf. ButtonControl).
 * Sinon les champs restent visibles mais désactivés, avec un message qui le dit.
 *
 * Point d'entrée : window.CalepinageMaisonFormPro { synchroniser(pvId), synchroniserTous() }
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};

    // Valeurs du <select> "Type de structure supportant les panneaux" du formulaire PRO
    // (calepinage.html) -> valeurs de CM.state.typeMontage (formulaire résidentiel). Les libellés
    // des deux listes sont alignés, les valeurs non (historique du calepinage PRO).
    const TYPE_STRUCTURE_VERS_MONTAGE = {
        'Toiture résidentielle': 'toiture_residentielle',
        'Bâtiment incliné métal': 'toiture_inclinee',
        'bâtiment incliné bois': 'toiture_inclinee',
        'Toiture terasse': 'toiture_terrasse',
        'Ombrière métal': 'ombriere_metal',
        'Ombrière bois': 'ombriere_bois',
        'Ombrière solumbra': 'ombriere_solumbra',
        'Ombrière béton': 'ombriere',
        'Petit champ solaire': 'champ_solaire',
        'Autres': 'mixte',
    };

    /**
     * Réciproque de TYPE_STRUCTURE_VERS_MONTAGE : premier libellé PRO proposant un typeMontage
     * donné. Sert à reporter dans le <select> PRO un type choisi depuis le formulaire résidentiel
     * (liaison bidirectionnelle). 'toiture_inclinee' et 'ombriere' ont plusieurs libellés PRO —
     * c'est le premier déclaré qui fait foi, le formulaire résidentiel ne distinguant pas le
     * matériau pour ces deux-là.
     */
    const MONTAGE_VERS_TYPE_STRUCTURE = {};
    Object.keys(TYPE_STRUCTURE_VERS_MONTAGE).forEach((libelle) => {
        const tm = TYPE_STRUCTURE_VERS_MONTAGE[libelle];
        if (!(tm in MONTAGE_VERS_TYPE_STRUCTURE)) MONTAGE_VERS_TYPE_STRUCTURE[tm] = libelle;
    });

    /**
     * Sections du formulaire résidentiel reprises, et leur conteneur d'accueil côté PRO.
     * Les deux premières alimentent la section "Toiture" ; les trois suivantes remplacent le contenu
     * historique des sections "Système d'intégration", "Panneaux" et "Système" (demande explicite :
     * "mêmes champs, mêmes labels, mêmes données que le formulaire de calepinage multi-typologie").
     */
    const SECTIONS = [
        // Modèle de poteaux + variante Double Poteaux du petit champ solaire, sous "Type de
        // structure" (demande explicite) : les <select> du modal y deviennent des BOUTONS.
        { hote: 'cmProPetitChampModelHost', source: 'cmPetitChampModelSection' },
        { hote: 'cmProPoseHost', source: 'calepinageMaisonPoseSection' },
        { hote: 'cmProGeometrieHost', source: 'calepinageMaisonGeometrieSection' },
        { hote: 'cmProIntegrationHost', source: 'cmMaterielIntegrationSection' },
        { hote: 'cmProPanneauHost', source: 'cmMaterielPanneauSection' },
        { hote: 'cmProSystemeHost', source: 'cmMaterielSystemeSection' },
    ];

    /**
     * Éléments retirés du clone : ils n'ont de sens qu'AVEC le canevas sous les yeux.
     *  - "Tracer le faîtage" arme un tracé à la souris SUR le canevas ; cliqué depuis le formulaire
     *    PRO (modal fermé), il armerait un outil invisible.
     *  - "Obstacle sélectionné" est piloté par la sélection dans le canevas (updateObstaclePropertiesPanel) :
     *    il n'y a rien à sélectionner depuis le formulaire PRO.
     */
    const EXCLUS_DU_CLONE = ['calepinageMaisonRidgeBtn', 'cmObstaclePropsSection'];

    /**
     * Libellés et messages dont le TEXTE est calculé par le formulaire résidentiel (et non figé
     * dans son HTML) : recopiés à chaque synchronisation. Tout le reste du texte est cloné une fois
     * pour toutes et ne bouge plus.
     */
    const TEXTES_DYNAMIQUES = (id) => id === 'calepinageMaisonRidgeClearanceLabel'
        // "Hauteur bâtiment" <-> "Hauteur structure égout" <-> "Hauteur bas PV" selon le type.
        || id === 'calepinageMaisonBatimentHeightLabel'
        // "Géométrie de la toiture" <-> "... de l'ombrière" <-> "... de la table solaire"
        // (cf. appliquerTitreGeometrie, calepinage_maison_formulaires.js).
        || id === 'calepinageMaisonGeometrieTitre'
        // Aide et résumé de l'« Architecture élec. système PV » (projets Site autonome, cf.
        // onduleurs_hors_reseau.js) : suivent l'architecture et l'appareil retenus.
        || id === 'cmHorsReseauAideArchi' || id === 'cmHorsReseauResume'
        || /(Error|Hint)$/.test(id);

    /**
     * <select> du modal affichés en BOUTONS côté PRO (demande explicite : "boutons de sélection des
     * modèles de poteaux, y compris les variantes du modèle Double Poteaux") -> clé de l'état.
     * Le <select> d'origine reste la seule porte d'entrée : un clic y rejoue le choix.
     */
    const SELECTS_EN_BOUTONS = {
        calepinageMaisonPetitChampModel: { cle: 'petitChampModel', defaut: 'centre' },
        calepinageMaisonPetitChampVariant: { cle: 'petitChampBracingVariant', defaut: 'v1' },
        calepinageMaisonOmbriereMetalVariant: { cle: 'ombriereMetalBracingVariant', defaut: 'v1' },
        // Type d'ancrage des poteaux d'ombrière sur la carte (calepinage_maison_poteaux_ombriere.js).
        cmPoteauxFormeAncrageSelect: { cle: 'ombriereFormeAncrage', defaut: 'circle' },
        // Position des pannes de l'ombrière bois : « Côté » / « Sur traverse ».
        cmOmbriereBoisPannesSelect: { cle: 'ombriereBoisPannesPosition', defaut: 'side' },
    };

    /**
     * Champs HISTORIQUES du formulaire PRO (calepinage.html, hors clone) qui font DOUBLON avec un
     * champ du formulaire résidentiel : même grandeur, même unité, mêmes bornes. Ils restent la
     * source lue par le calepinage PRO (payload_builder.js, PolygonPanelsManager) ; on les tient
     * donc à la même valeur que l'état résidentiel, dans les deux sens — sans quoi l'utilisateur
     * voit deux réglages identiques qui se contredisent.
     *
     * #shedsRowSpacing (« Esp. groupe de shed », mm) <-> #calepinageMaisonShedRowGroupSpacingInput
     * (même libellé, mm) c.-à-d. CM.state.shedRowGroupSpacingM, qui alimente aussi « Espacement
     * entre groupe de shed (m) » (#shedGroupSpacing) de la modale géométrie « Petit champ solaire »
     * (cf. calepinage_maison_dimensions_petit_champ.js) : les trois champs restent donc accordés.
     */
    const CHAMPS_PRO_HISTORIQUES = {
        shedsRowSpacing: 'calepinageMaisonShedRowGroupSpacingInput',
    };

    /** Garde de réentrance : recomputeResults() réémet l'événement qui nous rappelle. */
    let enSynchronisation = false;

    function cm() { return window.CalepinageMaisonIndiv; }

    /** Typologie du projet actif = Résidentielle (valeur serveur normalisée, cf. parametre.html). */
    function typologieResidentielle() {
        const typologie = typeof window.normaliserTypologie === 'function'
            ? window.normaliserTypologie(window.ACTIVE_PROJECT_TYPOLOGIE) : window.ACTIVE_PROJECT_TYPOLOGIE;
        return typologie === (window.TYPOLOGIE_RESIDENTIELLE || 'Résidentielle');
    }

    /** Onglet (tab-content) d'un champ PV du formulaire PRO. */
    function ongletDuChamp(pvId) {
        if (!pvId) return document.querySelector('.tab-content.active') || document.querySelector('.tab-content[id^="form-"]');
        return document.getElementById(`form-${pvId}`) || document.getElementById(pvId)
            || document.querySelector('.tab-content.active') || document.querySelector('.tab-content[id^="form-"]');
    }

    /** pvId de l'onglet contenant un élément (les ids y sont suffixés `-<pvId>`). */
    function pvIdDepuisElement(el) {
        const onglet = el && el.closest ? el.closest('.tab-content') : null;
        if (!onglet || !onglet.id || onglet.id.indexOf('form-') !== 0) {
            const pane = el && el.closest ? el.closest('.tab-pane, [id^="form-"]') : null;
            if (pane && pane.id && pane.id.indexOf('form-') === 0) return pane.id.slice('form-'.length);
            if (el && el.id && el.id.includes('-PV')) return el.id.substring(el.id.indexOf('-PV') + 1);
            const activeTab = document.querySelector('.tab-content.active') || document.querySelector('.tab-content[id^="form-"]');
            if (activeTab && activeTab.id && activeTab.id.indexOf('form-') === 0) {
                return activeTab.id.slice('form-'.length);
            }
            return null;
        }
        return onglet.id.slice('form-'.length);
    }

    /** <select> "Type de structure supportant les panneaux PV" de l'onglet d'un champ PV. */
    function selectStructure(pvId) {
        const onglet = ongletDuChamp(pvId);
        return onglet
            ? onglet.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]')
            : null;
    }

    /** Type de structure choisi pour ce champ PV, traduit en typeMontage du module résidentiel. */
    function typeMontageDuChamp(pvId) {
        const select = selectStructure(pvId);
        if (!select) return null;
        return TYPE_STRUCTURE_VERS_MONTAGE[select.value] || null;
    }

    /**
     * Accorde le <select> PRO "Type de structure" et CM.state.typeMontage du champ PV.
     *
     * Qui fait autorité : au PREMIER accord d'un onglet, le <select> PRO (c'est la valeur
     * enregistrée du projet côté PRO, l'utilisateur vient de la voir) ; ensuite, l'état, pour que
     * le type choisi dans le formulaire résidentiel (#cmTypeMontageSelect) redescende bien dans le
     * formulaire PRO. Sans cette asymétrie, chaque `calepinageMaisonEtatRecalcule` réécrirait
     * l'état avec la valeur du <select> et le sens résidentiel -> PRO serait perdu.
     */
    function accorderTypeStructure(pvId, state) {
        const CM = cm();
        const select = selectStructure(pvId);
        if (!select || !state) return;
        const onglet = ongletDuChamp(pvId);
        const premierAccord = !onglet.dataset.cmProTypeAccorde;
        onglet.dataset.cmProTypeAccorde = '1';
        const normalise = (typeof CM.normalizeTypeMontage === 'function')
            ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage;

        // CORRECTIF (demande explicite : "rendre persistant le Type de structure ; à la recharge de
        // la page on doit revenir sur l'option choisie") : au rechargement, le <select> PRO n'est
        // restauré par personne (StorageManager ne restaure que les onglets de drawnShapes, or depuis
        // la bascule les onglets sont ceux des champs résidentiels) : il affiche son défaut « Ombrière
        // métal ». Le laisser faire autorité écrasait donc le type ENREGISTRÉ dans l'état. Le <select>
        // ne fait désormais autorité au 1er accord que pour un champ jamais réglé côté PRO (état
        // encore sur 'toiture_residentielle', défaut du module et option masquée dans le formulaire
        // PRO) ; sinon c'est l'état persisté qui redescend dans le <select>.
        // CORRECTIF (demande explicite : "Typologie Résidentielle -> Type de structure par défaut =
        // Toiture résidentielle") : en typologie Résidentielle, le défaut du <select> PRO (« Ombrière
        // métal ») ne doit PAS écraser 'toiture_residentielle' : c'est l'état qui redescend dans le
        // <select> (option masquée mais sélectionnable programmatiquement, cf. calepinage.html).
        if (premierAccord && normalise === 'toiture_residentielle' && !typologieResidentielle()) {
            const tm = TYPE_STRUCTURE_VERS_MONTAGE[select.value];
            if (tm && tm !== state.typeMontage) appliquerTypeMontage(pvId, tm);
            return;
        }
        const attendu = MONTAGE_VERS_TYPE_STRUCTURE[normalise];
        if (!attendu || select.value === attendu || document.activeElement === select) return;
        select.value = attendu;
        // Les cascades du formulaire PRO (toggleStructureFields, modèles, couverture...) sont
        // câblées sur 'change' : sans cet événement, le <select> changerait seul dans son coin.
        // `origine` marque ce 'change' comme une SYNCHRONISATION et non un choix de l'utilisateur :
        // geometrieModal.js s'en sert pour ne PAS ouvrir le configurateur de géométrie par-dessus
        // (il le faisait, recouvrant le modal de calepinage en cours d'ouverture).
        select.dispatchEvent(new CustomEvent('change', {
            bubbles: true, detail: { origine: 'synchronisation-calepinage' },
        }));
    }

    /**
     * Écrit un type de structure (typeMontage) dans l'état d'un champ PV en rejouant le choix sur
     * #cmTypeMontageSelect du formulaire résidentiel : c'est SON gestionnaire qui s'exécute
     * (surcharges 3D effacées, division d'ombrière, modes de pose autorisés, orientation plein sud du
     * petit champ solaire...), exactement comme si le type avait été choisi dans le modal. Une
     * affectation directe de state.typeMontage sautait toute cette cascade.
     */
    function appliquerTypeMontage(pvId, tm) {
        const CM = cm();
        const corps = gabarit();
        const origine = corps ? corps.querySelector('#cmTypeMontageSelect') : null;
        if (!origine) {
            const state = etatDuChamp(pvId);
            if (!state) return;
            // Même règle que le gestionnaire du modal : 8° par défaut à la bascule vers l'ombrière métal.
            if (CM.normalizeTypeMontage(state.typeMontage) !== 'ombriere_metal'
                && CM.normalizeTypeMontage(tm) === 'ombriere_metal' && !CM.penteImposeeParPompage()) state.penteDeg = 8;
            // Même règle que le modal pour « Esp. bordure » : défaut du nouveau type si la valeur
            // courante est encore un défaut.
            if (CM.normalizeTypeMontage(state.typeMontage) !== CM.normalizeTypeMontage(tm)
                && CM.EDGE_CLEARANCE_DEFAUTS_M.some((d) => Math.abs((state.edgeClearanceM || 0) - d) < 1e-6)) {
                state.edgeClearanceM = CM.edgeClearanceDefautM(tm);
            }
            state.typeMontage = tm;
            if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'typeMontage');
            synchroniser(pvId); // comme rejouerSurOrigine
            return;
        }
        rejouerSurOrigine(pvId, origine, (o) => {
            o.value = tm;
            o.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    /**
     * État résidentiel du champ PV de même identifiant, ou null s'il n'a pas été tracé avec l'outil
     * « toiture multi-typologie ». Le champ actuellement ouvert dans le modal est lu depuis CM.state
     * (jamais depuis le cache : c'est lui qui porte les modifications en cours).
     */
    function etatDuChamp(pvId) {
        const CM = cm();
        if (!CM) return null;
        if (CM.state && CM.state.sourceId === pvId) return CM.state;
        if (typeof CM.listerChampsCarte !== 'function') return null;
        const champ = CM.listerChampsCarte().find((c) => c.sourceId === pvId);
        return champ ? champ.state : null;
    }

    function modalVisible() {
        const CM = cm();
        return !!(CM && CM.modal && CM.modal.style.display !== 'none');
    }

    /**
     * Corps du modal résidentiel, construit à la demande s'il ne l'est pas encore — CM.createModal()
     * crée le modal en `display:none` (cf. calepinage_maison_formulaires.js) : il n'est donc JAMAIS
     * ouvert par cet appel, seulement disponible comme gabarit à cloner et comme jeu d'éléments
     * d'origine pour la synchronisation. Même préparation que openCalepinageMaisonModal
     * (initPanelParamsIfNeeded) pour ne pas construire un formulaire aux listes vides.
     */
    function gabarit() {
        const CM = cm();
        if (!CM) return null;
        if (CM.modalBody) return CM.modalBody;
        if (typeof CM.createModal !== 'function') return null;
        try {
            if (typeof CM.initPanelParamsIfNeeded === 'function') CM.initPanelParamsIfNeeded();
            CM.createModal();
            if (CM.modal) CM.modal.style.display = 'none';
        } catch (e) {
            console.warn('[CalepinageFormPro] Gabarit du calepinage résidentiel indisponible', e);
            return null;
        }
        return CM.modalBody || null;
    }

    /**
     * Exécute `fn` avec CM.state basculé sur `state` (patron déjà utilisé par
     * getAllPvFieldSummaries() et mesurerGrillePan() pour agir sur un champ non affiché), puis
     * restaure l'état précédent. Si le modal est réellement OUVERT, son affichage est remis en
     * accord avec l'état restauré — les fonctions rejouées pendant la bascule ont écrit dans le même
     * DOM.
     */
    function avecEtat(state, fn) {
        const CM = cm();
        const precedent = CM.state;
        CM.state = state;
        try {
            fn();
        } finally {
            CM.state = precedent;
            if (modalVisible()) {
                try {
                    if (typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
                    if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
                    if (typeof CM.updateContourDimsUI === 'function') CM.updateContourDimsUI();
                    if (typeof CM.render === 'function') CM.render();
                } catch (e) { /* modal construit mais pas prêt : rien à redessiner */ }
            }
        }
    }

    // ------------------------------------------------------------------------------------------
    // Construction du clone
    // ------------------------------------------------------------------------------------------

    /**
     * Clone les deux sections du formulaire résidentiel dans l'onglet `pvId`, une seule fois par
     * onglet. Retourne true si l'onglet dispose (désormais) de ses clones.
     */
    function construireClones(pvId) {
        const onglet = ongletDuChamp(pvId);
        if (!onglet) return false;
        const modalBody = gabarit();
        if (!modalBody) return false;

        // Une section absente (conteneur d'accueil pas dans ce gabarit, ou section du formulaire
        // résidentiel pas encore construite) n'empêche PAS les autres : le conteneur reste vide et
        // sera rempli à la prochaine synchronisation. `aumoinsUne` sert seulement à dire à l'appelant
        // qu'il y a quelque chose à synchroniser.
        let auMoinsUne = false;
        SECTIONS.forEach(({ hote, source }) => {
            // TabsManager suffixe par `-<pvId>` tous les ids du gabarit au clonage de l'onglet.
            const accueil = onglet.querySelector(`#${hote}-${pvId}`) || onglet.querySelector(`#${hote}`);
            if (!accueil) return;
            if (accueil.firstElementChild) { auMoinsUne = true; return; } // déjà construit
            const origine = modalBody.querySelector(`#${source}`);
            if (!origine) return;
            auMoinsUne = true;

            const clone = origine.cloneNode(true); // cloneNode ne copie AUCUN écouteur : voulu.
            EXCLUS_DU_CLONE.forEach((id) => {
                clone.querySelectorAll(`#${id}`).forEach((el) => el.remove());
                if (clone.id === id) clone.remove();
            });
            // id -> data-cm-id (unicité des ids dans le document + annuaire vers l'original).
            [clone].concat(Array.from(clone.querySelectorAll('[id]'))).forEach((el) => {
                if (!el.id) return;
                el.setAttribute('data-cm-id', el.id);
                el.removeAttribute('id');
            });
            clone.querySelectorAll('[name]').forEach((el) => el.removeAttribute('name'));
            clone.querySelectorAll('label[for]').forEach((el) => el.removeAttribute('for'));
            remplacerSelectsParBoutons(clone);
            // NOUVEAU (demande explicite : « lorsqu'on clique sur la section Toiture du formulaire
            // PRO, le contenu de Géométrie de la toiture doit s'ouvrir automatiquement, pour éviter
            // un clic supplémentaire »). La section résidentielle, elle, reste repliée par défaut :
            // c'est le clone PRO qui s'ouvre, pas l'original.
            if (clone.tagName === 'DETAILS') clone.open = true;
            accueil.appendChild(clone);
            ouvrirSectionsAuDeploiement(accueil);
        });
        return auMoinsUne;
    }

    /**
     * Rouvre les sections clonées chaque fois que la section PRO qui les contient (« Toiture ») est
     * dépliée : sans cela l'ouverture automatique ci-dessus ne vaudrait que la première fois, un
     * repli de « Toiture » laissant le <details> intérieur fermé pour de bon.
     *
     * L'événement `toggle` NE REMONTE PAS (il ne bouillonne pas) : l'écouteur doit être posé sur la
     * section parente elle-même, une seule fois (d'où le marqueur data-*).
     */
    function ouvrirSectionsAuDeploiement(accueil) {
        const parente = accueil.closest('details');
        if (!parente || parente.dataset.cmOuvertureAuto === '1') return;
        parente.dataset.cmOuvertureAuto = '1';
        parente.addEventListener('toggle', () => {
            if (!parente.open) return;
            parente.querySelectorAll('.cmPro-host details').forEach((d) => { d.open = true; });
        });
    }

    /**
     * Remplace dans le clone chaque <select> de SELECTS_EN_BOUTONS par un groupe de boutons, un par
     * <option> (valeur dans data-cm-valeur). Le groupe ne porte pas de data-cm-id : l'état actif est
     * posé par surlignerSelectsEnBoutons, le clic traité par l'écouteur dédié plus bas.
     */
    function remplacerSelectsParBoutons(clone) {
        Object.keys(SELECTS_EN_BOUTONS).forEach((id) => {
            const select = clone.querySelector(`[data-cm-id="${id}"]`);
            if (!select || !select.parentNode) return;
            const groupe = document.createElement('div');
            groupe.setAttribute('data-cm-boutons', id);
            // Largeur explicite : sans elle, une feuille de style de la page réduisait le groupe à
            // 0 px — chaque bouton passait alors seul sur sa ligne, rejeté hors du panneau à droite.
            groupe.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; width:100%; box-sizing:border-box;';
            Array.from(select.options || []).forEach((opt) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'cm-btn';
                b.setAttribute('data-cm-valeur', opt.value);
                // Variantes « V1 - Barre de liaison + bracon » : libellé court, détail en infobulle.
                const texte = String(opt.textContent || '').trim();
                b.textContent = texte.split(' - ')[0];
                b.title = texte;
                // 2 boutons par ligne au plus (4 modèles = 2 lignes), libellé jamais tronqué.
                b.style.cssText = 'flex:1 1 calc(50% - 6px); min-width:0; white-space:normal;';
                groupe.appendChild(b);
            });
            select.parentNode.insertBefore(groupe, select);
            select.parentNode.removeChild(select);
        });
    }

    /** Bouton actif = valeur de l'état ; boutons inactifs sans état (champ non tracé). */
    function surlignerSelectsEnBoutons(onglet, state) {
        Object.keys(SELECTS_EN_BOUTONS).forEach((id) => {
            const { cle, defaut } = SELECTS_EN_BOUTONS[id];
            const valeur = (state && state[cle]) || defaut;
            onglet.querySelectorAll(`[data-cm-boutons="${id}"]`).forEach((groupe) => {
                groupe.querySelectorAll('[data-cm-valeur]').forEach((b) => {
                    b.classList.toggle('on', !!state && b.getAttribute('data-cm-valeur') === valeur);
                    b.disabled = !state;
                });
            });
        });
    }

    /** Élément d'origine, dans le modal résidentiel, d'un élément du clone. */
    function origineDe(el) {
        const CM = cm();
        const id = el.getAttribute('data-cm-id');
        return (id && CM.modalBody) ? CM.modalBody.querySelector('#' + id) : null;
    }

    // ------------------------------------------------------------------------------------------
    // Résidentiel -> PRO
    // ------------------------------------------------------------------------------------------

    function estChampSaisissable(el) {
        return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    }

    /** Vrai si les <option> du clone ne correspondent plus à celles de l'original. */
    function optionsDifferentes(clone, origine) {
        if (!clone.options || !origine.options) return false;
        if (clone.options.length !== origine.options.length) return true;
        for (let i = 0; i < origine.options.length; i += 1) {
            if (clone.options[i].value !== origine.options[i].value) return true;
            if (clone.options[i].textContent !== origine.options[i].textContent) return true;
        }
        return false;
    }

    /** Recopie dans le clone ce que le formulaire résidentiel affiche pour l'état courant. */
    function recopierDepuisOrigine(onglet, actif) {
        onglet.querySelectorAll('[data-cm-id]').forEach((el) => {
            const origine = origineDe(el);
            if (!origine) return;

            el.style.display = origine.style.display;
            // Les boutons de pose sont colorés en style INLINE par updatePoseModeUI ; les autres
            // boutons (divisions) n'ont pas d'état actif côté résidentiel, d'où la classe `on`
            // posée ci-dessous à partir de l'état, pour le même rendu.
            if (el.tagName === 'BUTTON') {
                el.style.background = origine.style.background;
                el.style.color = origine.style.color;
                el.disabled = !actif;
            }
            if (estChampSaisissable(el)) {
                // Désactivé aussi quand l'original l'est (ex. case "Sheds réguliers" sans ses
                // préconditions, cf. updateShedRegularAvailability).
                el.disabled = !actif || !!origine.disabled;
                // Bornes dynamiques (ex. Hauteur bâtiment 0,2-25 m / Hauteur structure égout 2,5-15 m
                // / Hauteur bas PV 0,3-5 m).
                if (el.type === 'number') ['min', 'max', 'step'].forEach((a) => { if (origine[a] !== undefined) el[a] = origine[a]; });
                // Place-holder calculé (ex. « Entraxes poteaux » : rappelle l entraxe automatique qui
                // s appliquera si le champ reste vide) : figé au clonage sinon. Aussi pour les champs
                // numériques (« Entraxes poteaux transversaux » : défaut propre au modèle).
                if ((el.type === 'text' || el.type === 'number') && origine.placeholder !== undefined) el.placeholder = origine.placeholder;
                // Catalogues (panneaux, onduleurs, batteries, optimiseurs, systèmes d'intégration) :
                // leurs <option> sont remplies en différé, souvent APRÈS le clonage (chargement des
                // bases de matériels). Le clone n'en verrait qu'un instantané — et ne pourrait donc
                // pas afficher la référence choisie. On réaligne la liste sur l'original dès qu'elle
                // diffère, avant de reporter la valeur juste en dessous.
                if (el.tagName === 'SELECT' && optionsDifferentes(el, origine)) {
                    el.innerHTML = origine.innerHTML;
                }
                // Jamais sous le curseur : écrire `value` replacerait le caret en fin de champ.
                if (document.activeElement !== el) {
                    if (el.type === 'checkbox' || el.type === 'radio') el.checked = origine.checked;
                    else el.value = origine.value;
                }
                el.style.borderColor = origine.style.borderColor;
            } else if (TEXTES_DYNAMIQUES(el.getAttribute('data-cm-id'))) {
                el.textContent = origine.textContent;
            }
        });
    }

    /**
     * Surligne le bouton de division correspondant à la géométrie active. Le formulaire résidentiel
     * ne marque pas ces boutons (l'utilisateur voit le résultat sur le canevas) ; côté PRO, sans
     * canevas sous les yeux, le rappel est nécessaire. Les conditions sont celles de l'état, pas des
     * règles nouvelles.
     */
    function surlignerDivisionActive(onglet, state) {
        const actif = {
            calepinageMaisonMonopenteBtn: !state || state.divisionMode === 'none',
            calepinageMaison2PansSymBtn: !!state && state.divisionMode === '2pans' && state.lastTwoPanKind === 'sym',
            calepinageMaison2PansAsymBtn: !!state && state.divisionMode === '2pans' && state.lastTwoPanKind === 'asym',
            // divideInto4Pans (croupe) pose divisionMode '4pans' ; divideInto4PansSymmetric pose
            // '4panssym' (cf. calepinage_maison_calculs.js) — deux géométries distinctes.
            calepinageMaison4PansBtn: !!state && state.divisionMode === '4pans',
            calepinageMaison4PansSymBtn: !!state && state.divisionMode === '4panssym',
        };
        Object.keys(actif).forEach((id) => {
            const btn = onglet.querySelector(`[data-cm-id="${id}"]`);
            if (btn) btn.classList.toggle('on', !!state && actif[id]);
        });
    }

    /**
     * Applique les masquages et dispositions spécifiques demandées pour "Petit champ solaire" :
     *  - Masquer Monopente et Diviser en 2 pans (Symétrique)
     *  - Masquer Incliné, À plat, et afficher Shed puis Dôme dans cet ordre
     *  - Afficher les 3 boutons d'action (Calculer, Résultats, Optimisation) sous Portrait/Paysage
     */
    function appliquerReglesVisibiliteSpecifiques(onglet, pvId) {
        const tmChamp = typeMontageDuChamp(pvId);
        const isPc = (tmChamp === 'champ_solaire');

        // Section "Pompage solaire" : règle propre au PROJET (et non au champ), cf.
        // CM.pompageSolaireVisible() — appliquée ici aussi pour un champ encore sans calepinage.
        const CM = cm();
        const pompage = onglet.querySelector('[data-cm-id="cmPompageSolaireSection"]');
        if (pompage && CM && typeof CM.pompageSolaireVisible === 'function') {
            pompage.style.display = CM.pompageSolaireVisible() ? '' : 'none';
        }
        // Site autonome en Pompage solaire : sections masquées (cf. SECTIONS_MASQUEES_POMPAGE_AUTONOME).
        if (CM && typeof CM.appliquerMasquagePompageAutonome === 'function') {
            CM.appliquerMasquagePompageAutonome(onglet, true);
        }
        // Batterie virtuelle : règle du projet, case toujours modifiable (cf. afficherBatterieVirtuelle).
        if (CM && typeof CM.afficherBatterieVirtuelle === 'function') CM.afficherBatterieVirtuelle();

        const btnMonopente = onglet.querySelector('[data-cm-id="calepinageMaisonMonopenteBtn"]');
        if (btnMonopente && isPc) btnMonopente.style.display = 'none';

        const btn2PansSym = onglet.querySelector('[data-cm-id="calepinageMaison2PansSymBtn"]');
        if (btn2PansSym && isPc) btn2PansSym.style.display = 'none';

        const btn4PansSym = onglet.querySelector('[data-cm-id="calepinageMaison4PansSymBtn"]');
        if (btn4PansSym && isPc) btn4PansSym.style.display = 'none';

        const btn2PansAsym = onglet.querySelector('[data-cm-id="calepinageMaison2PansAsymBtn"]');
        if (btn2PansAsym && isPc) btn2PansAsym.style.display = 'none';

        const btn4Pans = onglet.querySelector('[data-cm-id="calepinageMaison4PansBtn"]');
        if (btn4Pans && isPc) btn4Pans.style.display = 'none';

        const btnIncline = onglet.querySelector('[data-cm-id="calepinageMaisonPose_incline"]');
        if (btnIncline && isPc) btnIncline.style.display = 'none';

        const btnPlat = onglet.querySelector('[data-cm-id="calepinageMaisonPose_plat"]');
        if (btnPlat && isPc) btnPlat.style.display = 'none';

        const btnShed = onglet.querySelector('[data-cm-id="calepinageMaisonPose_shed"]');
        if (btnShed && isPc) {
            btnShed.style.display = '';
            btnShed.style.order = '1';
        }

        const btnDome = onglet.querySelector('[data-cm-id="calepinageMaisonPose_dome"]');
        if (btnDome && isPc) {
            btnDome.style.display = '';
            btnDome.style.order = '2';
        }

        const pcActions = onglet.querySelector('[data-cm-id="cmPetitChampActionsWrapper"]');
        if (pcActions) {
            pcActions.style.display = isPc ? 'flex' : 'none';
            if (isPc) {
                pcActions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
            }
        }
    }

    /**
     * Tableau « Nombre de PV et dimensions champs PV » de l'onglet (nbColonne / nbLigne,
     * dimensionsChampPVlongueur / largeur, surfaceProjeteePanneaux).
     *
     * CORRECTIF (demande explicite : "dessiner sur la carte et obtenir directement les résultats de
     * calculs des panneaux dans le formulaire PRO, sans ouvrir la modale") : ces champs n'étaient
     * remplis que par l'ancien moteur rectangulaire (FormHandler, formes de drawingControl.drawnShapes)
     * — vides pour tout champ du moteur unifié. Ils reflètent désormais la grille RÉELLEMENT posée
     * (CM.mesurerGrillePan, même mesure que le Summary modal et les modales de structure). Même
     * convention que l'ancien moteur : "Ligne (L) / Long_PV" = panneaux le long de l'égout.
     * Toiture divisée : la grille affichée est celle du pan le plus garni ; la surface est la somme.
     */
    function remplirResultatsPanneaux(onglet, pvId, state) {
        const CM = cm();
        if (typeof CM.mesurerGrillePan !== 'function') return;
        let principale = null;
        let surface = 0;
        (state.pans || []).forEach((pan) => {
            let g = null;
            try { g = CM.mesurerGrillePan(pan, state); } catch (e) { g = null; }
            if (!g) return;
            surface += g.surfaceProjeteeM2 || 0;
            if (!principale || g.nbPanneaux > principale.nbPanneaux) principale = g;
        });
        const ecrire = (id, valeur) => {
            const el = onglet.querySelector(`#${id}-${pvId}`) || onglet.querySelector(`#${id}`);
            if (el) el.value = valeur;
        };
        ecrire('nbColonne', principale ? principale.nbColonnes : 0);
        ecrire('nbLigne', principale ? principale.nbRangees : 0);
        ecrire('dimensionsChampPVlongueur', principale ? principale.longueurM : 0);
        ecrire('dimensionsChampPVlargeur', principale ? principale.largeurM : 0);
        ecrire('surfaceProjeteePanneaux', Math.round(surface * 100) / 100);
    }

    /** Champ historique du formulaire PRO dans l'onglet d'un champ PV (ids suffixés `-<pvId>`). */
    function champProHistorique(onglet, pvId, id) {
        if (!onglet) return null;
        return onglet.querySelector(`#${id}-${pvId}`) || onglet.querySelector(`#${id}`);
    }

    /**
     * Valeurs des champs d'origine du modal résidentiel correspondant aux champs historiques PRO.
     * À lire IMPÉRATIVEMENT pendant la bascule `avecEtat` : une fois l'état précédent restauré, le
     * modal résidentiel — s'il est ouvert — réaffiche les valeurs de SON champ, pas celles de
     * l'onglet en cours de synchronisation.
     */
    function lireChampsHistoriques() {
        const modalBody = gabarit();
        const valeurs = {};
        if (!modalBody) return valeurs;
        Object.keys(CHAMPS_PRO_HISTORIQUES).forEach((idPro) => {
            const origine = modalBody.querySelector('#' + CHAMPS_PRO_HISTORIQUES[idPro]);
            if (origine) valeurs[idPro] = origine.value;
        });
        return valeurs;
    }

    /** Résidentiel -> champs historiques du formulaire PRO (cf. CHAMPS_PRO_HISTORIQUES). */
    function ecrireChampsHistoriques(onglet, pvId, valeurs) {
        Object.keys(valeurs).forEach((idPro) => {
            const cible = champProHistorique(onglet, pvId, idPro);
            if (!cible || cible.value === valeurs[idPro]) return;
            cible.value = valeurs[idPro];
            // 'change' : c'est l'événement que le calepinage PRO écoute pour ces champs (même
            // pratique que restoreShedFormFields, calepinage_correction_controller.js). Émis pendant
            // que `enSynchronisation` est vrai : l'écouteur inverse ci-dessous ne rebouclera pas.
            cible.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    /**
     * Met le formulaire PRO d'un champ PV en accord avec son état résidentiel.
     */
    function synchroniser(pvId) {
        const CM = cm();
        const onglet = ongletDuChamp(pvId);
        if (!CM || !onglet || enSynchronisation) return;
        if (!construireClones(pvId)) return;

        const message = onglet.querySelector(`#cmProMessage-${pvId}`) || onglet.querySelector('#cmProMessage');
        const state = etatDuChamp(pvId);
        const actif = !!state;

        if (message) {
            message.style.display = actif ? 'none' : 'block';
            if (!actif) {
                message.textContent = "Ce champ PV n'a pas encore de calepinage : tracez-le avec l'outil "
                    + '« Calepinage toiture multi-typologie » pour régler ces options.';
            }
        }
        if (!actif) {
            onglet.querySelectorAll('[data-cm-id]').forEach((el) => {
                if (el.tagName === 'BUTTON' || estChampSaisissable(el)) el.disabled = true;
            });
            appliquerReglesVisibiliteSpecifiques(onglet, pvId);
            surlignerSelectsEnBoutons(onglet, null);
            return;
        }

        // Type de structure : un seul réglage, deux affichages (cf. accorderTypeStructure). Il
        // pilote les modes de pose autorisés et la visibilité des champs, exactement comme
        // #cmTypeMontageSelect côté résidentiel (cf. updatePoseModeUI).
        accorderTypeStructure(pvId, state);

        let valeursHistoriques = {};
        enSynchronisation = true;
        try {
            avecEtat(state, () => {
                if (typeof CM.updatePoseModeUI === 'function') CM.updatePoseModeUI();
                if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
                if (typeof CM.updateContourDimsUI === 'function') CM.updateContourDimsUI();
                // CORRECTIF (bug rapporté : panneau choisi dans le formulaire PRO remplacé par les
                // valeurs par défaut après actualisation) : sections « Panneau » / « Système »
                // remises sur l'état de CET onglet avant la recopie — sans cela le clone recopiait
                // les matériels du champ affiché dans le modal (état par défaut au rechargement).
                if (typeof CM.afficherMaterielsDepuisEtat === 'function') CM.afficherMaterielsDepuisEtat();
                recopierDepuisOrigine(onglet, true);
                valeursHistoriques = lireChampsHistoriques();
            });
            surlignerDivisionActive(onglet, state);
            surlignerSelectsEnBoutons(onglet, state);
            appliquerReglesVisibiliteSpecifiques(onglet, pvId);
            remplirResultatsPanneaux(onglet, pvId, state);
            ecrireChampsHistoriques(onglet, pvId, valeursHistoriques);
        } finally {
            enSynchronisation = false;
        }
    }

    function synchroniserTous() {
        document.querySelectorAll('.tab-content[id^="form-"]').forEach((onglet) => {
            synchroniser(onglet.id.slice('form-'.length));
        });
    }

    // ------------------------------------------------------------------------------------------
    // PRO -> résidentiel
    // ------------------------------------------------------------------------------------------

    /**
     * Rejoue `action` sur l'élément d'origine, CM.state basculé sur le champ PV de l'onglet : ce
     * sont les gestionnaires du formulaire résidentiel qui s'exécutent (validation, unités,
     * divisions, render, recomputeResults). Ce sont EUX qui écrivent dans l'état ; il ne reste qu'à
     * le sauvegarder.
     *
     * CORRECTIF (bug rapporté : "lorsque je modifie la pente dans le formulaire, la synchronisation
     * des dimensions de l'ombrière ne se fait plus, l'ombrière prend des dimensions par défaut") :
     * cette fonction appelait `CM.setMaisonFieldResult(pvId, 'pans', null)` pour déclencher la
     * sauvegarde. Mais ce setter AFFECTE la valeur reçue — il écrasait donc `state.pans` par `null`
     * à chaque saisie, détruisant le calepinage du champ. On utilise désormais
     * `CM.persisterEtatChamp`, qui sauvegarde sans rien muter.
     */
    function rejouerSurOrigine(pvId, origine, action) {
        const CM = cm();
        const state = etatDuChamp(pvId);
        if (!state || !origine) return;
        enSynchronisation = true;
        try {
            avecEtat(state, () => { action(origine); });
        } finally {
            enSynchronisation = false;
        }
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(pvId, 'formulairePro');
        synchroniser(pvId);
    }

    /** Élément du clone visé par un événement, avec son pvId — ou null. */
    function cibleClone(e) {
        const el = e.target && e.target.closest ? e.target.closest('[data-cm-id]') : null;
        if (!el || !el.closest('.cmPro-host')) return null;
        const pvId = pvIdDepuisElement(el);
        return pvId ? { el, pvId } : null;
    }

    // Boutons "Modèle de poteaux" / "Variante Double Poteaux" : le choix est rejoué sur le <select>
    // d'origine du modal — son gestionnaire met l'état à jour (surcharges 3D effacées, variante
    // affichée/masquée, recomputeResults), exactement comme un choix fait dans le modal.
    document.addEventListener('click', (e) => {
        const bouton = e.target && e.target.closest ? e.target.closest('[data-cm-valeur]') : null;
        if (!bouton || !bouton.closest('.cmPro-host')) return;
        e.preventDefault();
        const groupe = bouton.closest('[data-cm-boutons]');
        const CM = cm();
        const pvId = pvIdDepuisElement(bouton);
        const origine = (groupe && CM && CM.modalBody)
            ? CM.modalBody.querySelector('#' + groupe.getAttribute('data-cm-boutons')) : null;
        if (bouton.disabled || !pvId || !origine) return;
        const valeur = bouton.getAttribute('data-cm-valeur');
        rejouerSurOrigine(pvId, origine, (o) => {
            o.value = valeur;
            o.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    document.addEventListener('click', (e) => {
        const cible = cibleClone(e);
        if (!cible || cible.el.tagName !== 'BUTTON') return;
        const actionId = cible.el.getAttribute('data-cm-id');
        if (actionId === 'cmPetitChampCalculerBtn' || actionId === 'cmPetitChampResultatsBtn' || actionId === 'cmPetitChampOptimisationBtn') {
            e.preventDefault();
            // Événement émis directement avec le pvId de l'onglet (traité par
            // calepinage_maison_sheds_actions.js) : rejouer le clic sur le bouton d'origine
            // viserait le champ affiché dans le modal résidentiel, pas celui de cet onglet.
            const evName = actionId === 'cmPetitChampCalculerBtn' ? 'petitChampCalculerClicked'
                : (actionId === 'cmPetitChampResultatsBtn' ? 'petitChampResultatsClicked' : 'petitChampOptimisationClicked');
            window.dispatchEvent(new CustomEvent(evName, { detail: { pvId: cible.pvId } }));
            return;
        }
        if (cible.el.disabled) return;
        e.preventDefault();
        const origine = origineDe(cible.el);
        // Ces boutons redécoupent la toiture (divisions) ou changent le mode de pose : c'est le
        // gestionnaire d'origine qui met l'état à jour, on ne fait que rejouer le clic.
        rejouerSurOrigine(cible.pvId, origine, (o) => o.click());
    });

    // 'input' pour les saisies au fil de l'eau (mêmes écouteurs que le formulaire résidentiel),
    // 'change' pour les <select> et les cases à cocher.
    ['input', 'change'].forEach((type) => {
        document.addEventListener(type, (e) => {
            const cible = cibleClone(e);
            if (!cible || !estChampSaisissable(cible.el) || cible.el.disabled) return;
            // Batterie virtuelle : réglage du PROJET (étude économique), pas du champ PV — appliqué
            // directement, même pour un onglet sans calepinage.
            if (cible.el.getAttribute('data-cm-id') === 'cmBatterieVirtuelleOptin') {
                const CM = cm();
                if (CM && typeof CM.definirBatterieVirtuelle === 'function') CM.definirBatterieVirtuelle(cible.el.checked);
                if (CM && typeof CM.afficherBatterieVirtuelle === 'function') CM.afficherBatterieVirtuelle();
                return;
            }
            const origine = origineDe(cible.el);
            if (!origine) return;
            rejouerSurOrigine(cible.pvId, origine, (o) => {
                if (cible.el.type === 'checkbox' || cible.el.type === 'radio') o.checked = cible.el.checked;
                else o.value = cible.el.value;
                o.dispatchEvent(new Event(type, { bubbles: true }));
            });
        });
    });

    // Champs historiques du formulaire PRO -> résidentiel (sens inverse d'ecrireChampsHistoriques).
    // Ces champs-là ne sont PAS des clones : ils appartiennent au gabarit PRO (calepinage.html), donc
    // `cibleClone` les ignore et il leur faut leur propre écouteur. Le geste est rejoué sur le champ
    // d'origine du modal résidentiel, dont le gestionnaire fait tout le reste (bornes, mm -> m,
    // CM.state, render, recomputeResults) — aucune règle n'est réécrite ici.
    ['input', 'change'].forEach((type) => {
        document.addEventListener(type, (e) => {
            const el = e.target;
            if (enSynchronisation || !el || !el.id || el.disabled) return;
            const idPro = Object.keys(CHAMPS_PRO_HISTORIQUES)
                .find((id) => el.id === id || el.id.indexOf(id + '-') === 0);
            if (!idPro) return;
            const pvId = pvIdDepuisElement(el);
            const modalBody = gabarit();
            const origine = modalBody ? modalBody.querySelector('#' + CHAMPS_PRO_HISTORIQUES[idPro]) : null;
            // Déjà à la bonne valeur : un champ nombre émet 'input' PUIS 'change' pour un même geste.
            if (!pvId || !origine || origine.value === el.value) return;
            // Toujours 'input' : c'est le seul événement écouté par wireCmValidatedInput
            // (calepinage_maison_formulaires.js), y compris quand le geste PRO était un 'change'.
            rejouerSurOrigine(pvId, origine, (o) => {
                o.value = el.value;
                o.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    });

    // Changement de "Type de structure supportant les panneaux" : les modes de pose autorisés et la
    // visibilité des champs changent (synchroniser() reporte le type dans l'état avant de rejouer
    // les règles d'affichage du formulaire résidentiel).
    //
    // CORRECTIF (demande explicite : "un clic sur le Type de calepinage ne doit provoquer aucun
    // changement du Type de structure") : écouteur posé sur WINDOW en phase de CAPTURE. DrawingControl.js
    // écoute ce même 'change' en capture sur document et appelle stopImmediatePropagation() (pour
    // empêcher geometrieModal.js d'ouvrir le configurateur) : un écouteur document en bouillonnement ne
    // le recevait donc JAMAIS. Le choix de l'utilisateur n'atteignait pas l'état ; à la resynchronisation
    // suivante (clic sur un bouton "Type de calepinage" -> rejouerSurOrigine -> synchroniser), le
    // <select> était remis sur l'ancien type de l'état. La capture sur window passe avant document.
    window.addEventListener('change', (e) => {
        const el = e.target;
        if (!el || !el.id || el.id.indexOf('type_de_structure') !== 0) return;
        if (e.detail && e.detail.origine === 'synchronisation-calepinage') return;
        const pvId = pvIdDepuisElement(el);
        if (!pvId) return;
        // Geste de l'utilisateur sur le <select> PRO : c'est LUI qui fait autorité cette fois-ci
        // (cf. accorderTypeStructure), d'où l'écriture directe dans l'état avant resynchronisation.
        const state = etatDuChamp(pvId);
        const tm = typeMontageDuChamp(pvId);
        if (state && tm && state.typeMontage !== tm) {
            appliquerTypeMontage(pvId, tm); // persiste et resynchronise (rejouerSurOrigine)
            return;
        }
        synchroniser(pvId);
    }, true); // CAPTURE : indispensable (sans ce `true`, l'écouteur ne recevait toujours rien).

    // Modal résidentiel -> formulaire PRO.
    ['calepinageMaisonEtatRecalcule', 'calepinageMaisonFieldChanged',
        // 'maisonShapesRestored' : fin de la restauration des contours au chargement (cf.
        // polygon_maison.js) — les champs restaurés sont synchronisés sans attendre un geste.
        'maisonShapeAdded', 'maisonShapesRenumbered', 'maisonShapesRestored', 'tabSelected'].forEach((nom) => {
            document.addEventListener(nom, () => { if (!enSynchronisation) synchroniserTous(); });
        });

    window.CalepinageMaisonFormPro = { synchroniser, synchroniserTous, TYPE_STRUCTURE_VERS_MONTAGE };
})();
