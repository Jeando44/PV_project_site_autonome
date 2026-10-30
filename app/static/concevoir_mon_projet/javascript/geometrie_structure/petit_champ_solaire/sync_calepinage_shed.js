/**
 * Synchronisation "Calepinage shed" (calepinage.html, par pvId) -> "Petit champ solaire" (ce
 * modal, ouvert en iframe via geometrieModal.js avec ?pvId=PVx ajouté à son URL — même mécanisme
 * de récupération du pvId que updateDimensionsFromStorage() dans ombriere_metal.html : lu ici
 * depuis window.location.search, à l'intérieur de l'iframe).
 *
 * Différence assumée avec ombriere_metal.html (qui lit uniquement localStorage.solarProjectData) :
 * la plupart des champs shed ci-dessous SONT déjà persistés dans solarProjectData.formData[pvId]
 * (cf. FORM_FIELDS_MAPPING, DrawingControl/constants.js), mais "Nb. groupes dans la rangée"
 * (#shedGroupsInRow) ne l'est pas (résultat dépendant du choix actif dans "Analyse par rangée",
 * jamais sauvegardé) — et le formulaire "petit champ solaire" lui-même n'est pas encore sauvegardé
 * en localStorage. On lit donc directement le DOM de la page parente (calepinage.html) : toujours
 * à jour, sans délai, et sans risque cross-origin puisque cette iframe est servie par la même
 * application Flask (même origine).
 *
 * Déclenchement : au chargement de cette page, à chaque 'input'/'change' des champs source
 * modifiables par l'utilisateur, et à chaque 'calepinage:shedResultsUpdated' (événement custom
 * dispatché par calepinage_correction_controller.js/FormHandler.js lorsqu'un champ résultat
 * backend — readonly, jamais de 'change' natif puisque posé via `.value =` seul — est mis à jour).
 *
 * ÉTAPE 3 de l'unification du calepinage : ce chemin est en voie de remplacement. Les mêmes champs
 * sont désormais alimentés depuis le POLYGONE LIBRE du module résidentiel, par
 * Calepinage_mainson/calepinage_maison_dimensions_petit_champ.js, injecté par geometrieModal.js au
 * chargement de cette iframe. Les deux coexistent sans conflit tant que calepinage.html existe :
 * quand la page parente ne porte pas les champs shed (projet résidentiel), chaque readParentValue()
 * renvoie null et ce fichier ne touche à rien ; inversement, en projet PRO sans calepinage
 * résidentiel, la mesure côté module renvoie null et l'injection ne fait rien. Ce fichier disparaît
 * avec calepinage.html (Étape 5).
 */
(function () {
    function getPvId() {
        return new URLSearchParams(window.location.search).get('pvId');
    }

    function getParentDoc() {
        try {
            if (window.parent && window.parent !== window && window.parent.document) {
                return window.parent.document;
            }
        } catch (e) {
            // Cross-origin (ne devrait jamais arriver ici : même origine Flask) : abandon silencieux.
        }
        return null;
    }

    function getParentField(pvId, id) {
        const doc = getParentDoc();
        if (!doc) return null;
        return doc.querySelector(`#${id}-${pvId}`) || doc.getElementById(id);
    }

    function readParentValue(pvId, id) {
        const el = getParentField(pvId, id);
        if (!el) return null;
        return el.type === 'checkbox' ? el.checked : el.value;
    }

    function setLocalField(id, value) {
        if (value === null || value === undefined || value === '') return;
        const el = document.getElementById(id);
        if (!el) return;
        if (el.value === String(value)) return; // évite de redéclencher inutilement les calculs
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // mm -> m, arrondi à 2 décimales (cohérent avec le pas habituel des champs "(m)" du formulaire).
    function mmToM(mm) {
        const n = parseFloat(mm);
        return isNaN(n) ? null : Math.round((n / 1000) * 100) / 100;
    }

    /**
     * Vrai si le champ est mesuré par le moteur de calepinage unifié (module résidentiel) : c'est
     * alors CalepinageMaisonDimensionsPetitChamp.injecterDansModal (geometrieModal.js) qui alimente
     * ce formulaire, "Analyse par rangée" compris.
     *
     * CORRECTIF (bug rapporté : "sélectionner une rangée pour la vue de façade ne fonctionne pas") :
     * ce fichier continuait de recopier l'ANCIEN #shedRowSelector de calepinage.html — toujours
     * présent dans l'onglet PRO, mais vide depuis l'unification — et effaçait donc les rangées
     * injectées ; il pouvait aussi réécrire pvLayout / nbShedGroups avec d'anciennes valeurs.
     */
    function champDuMoteurUnifie(pvId) {
        try {
            const service = window.parent && window.parent.CalepinageMaisonDimensionsPetitChamp;
            return !!(service && typeof service.mesurerSheds === 'function' && service.mesurerSheds(pvId));
        } catch (e) {
            return false;
        }
    }

    function syncFromShedCalepinage() {
        const pvId = getPvId();
        if (!pvId || !getParentDoc()) return; // pas de pvId ou ouvert hors iframe : rien à synchroniser.
        if (champDuMoteurUnifie(pvId)) return;

        // --- Section "Plan de coupe" ---
        setLocalField('roofSlope', readParentValue(pvId, 'pente_panneaux_shed'));
        setLocalField('nbPanelsRampant', readParentValue(pvId, 'shedsCols'));
        const shedSpacingM = mmToM(readParentValue(pvId, 'shedsColSpacing'));
        if (shedSpacingM !== null) setLocalField('shedSpacing', shedSpacingM);
        setLocalField('nbShed', readParentValue(pvId, 'shedsNbLargeur'));
        setLocalField('petitPanelLengthMm', readParentValue(pvId, 'longueurPanneau'));
        setLocalField('petitPanelWidthMm', readParentValue(pvId, 'largeurPanneau'));
        setLocalField('petitPanelThicknessMm', readParentValue(pvId, 'epaisseurPanneau'));
        setLocalField('panelSpacingY', readParentValue(pvId, 'espacementPanneauxY'));

        // --- Section "Plan de façade" ---
        const shedGroupSpacingM = mmToM(readParentValue(pvId, 'shedsRowSpacing'));
        if (shedGroupSpacingM !== null) setLocalField('shedGroupSpacing', shedGroupSpacingM);
        setLocalField('panelSpacingX', readParentValue(pvId, 'espacementPanneauxX'));
        setLocalField('pvLayout', readParentValue(pvId, 'shedNbPvCalepinage'));

        // Règle spécifique (Analyse par rangée) : "Nb. groupes dans la rangée" suit le choix actif du
        // sélecteur de rangée côté calepinage shed — jamais persisté en localStorage, lu en direct.
        setLocalField('nbShedGroups', readParentValue(pvId, 'shedGroupsInRow'));

        // NOUVEAU (demande explicite) : miroir des OPTIONS + de la valeur sélectionnée du sélecteur
        // "Analyse par rangée" côté calepinage shed (#shedRowSelector), pour piloter #facadeRowSelector
        // ci-dessous — #nbShedGroups (juste au-dessus) suit déjà #shedGroupsInRow, qui lui-même suit déjà
        // #shedRowSelector (cf. FormHandler.js) : cette étape ne fait qu'afficher/refléter ce choix
        // localement, aucun nouveau calcul de nombre de panneaux introduit ici.
        populateFacadeRowSelector(pvId);
    }

    // Recopie les <option> de #shedRowSelector (calepinage.html) vers #facadeRowSelector (ce
    // formulaire) et aligne sa valeur sélectionnée sur celle du parent. Ne reconstruit la liste
    // d'options que si elle a réellement changé (nouveau calcul backend), pour ne pas perturber une
    // interaction en cours sur le select local à chaque frappe sur un champ surveillé.
    function populateFacadeRowSelector(pvId) {
        const localSelect = document.getElementById('facadeRowSelector');
        if (!localSelect) return;
        const parentSelect = getParentField(pvId, 'shedRowSelector');
        if (!parentSelect) {
            if (localSelect.options.length > 0) localSelect.innerHTML = '';
            return;
        }

        const parentValues = Array.from(parentSelect.options).map((o) => o.value);
        const localValues = Array.from(localSelect.options).map((o) => o.value);
        const optionsChanged = parentValues.length !== localValues.length
            || parentValues.some((v, i) => v !== localValues[i]);
        if (optionsChanged) {
            localSelect.innerHTML = '';
            Array.from(parentSelect.options).forEach((opt) => {
                const clone = document.createElement('option');
                clone.value = opt.value;
                clone.textContent = opt.textContent;
                localSelect.appendChild(clone);
            });
        }
        if (localSelect.value !== parentSelect.value) localSelect.value = parentSelect.value;
    }

    // Champs SOURCE modifiables directement par l'utilisateur (hors résultats calculés côté backend,
    // cf. ci-dessous) : resynchronise à chaque saisie, comme pour n'importe quel champ du formulaire.
    const WATCHED_USER_FIELD_IDS = [
        'pente_panneaux_shed', 'shedsCols', 'shedsColSpacing', 'shedsRowSpacing',
        'longueurPanneau', 'largeurPanneau', 'epaisseurPanneau',
        'espacementPanneauxY', 'espacementPanneauxX',
    ];

    function attachParentListeners() {
        const pvId = getPvId();
        const doc = getParentDoc();
        if (!pvId || !doc) return;

        WATCHED_USER_FIELD_IDS.forEach((id) => {
            const el = doc.querySelector(`#${id}-${pvId}`) || doc.getElementById(id);
            if (el && !el.dataset.petitChampSyncAttached) {
                el.addEventListener('input', syncFromShedCalepinage);
                el.addEventListener('change', syncFromShedCalepinage);
                el.dataset.petitChampSyncAttached = 'true';
            }
        });

        const rowSelectorEl = doc.querySelector(`#shedRowSelector-${pvId}`) || doc.getElementById('shedRowSelector');
        if (rowSelectorEl && !rowSelectorEl.dataset.petitChampSyncAttached) {
            rowSelectorEl.addEventListener('change', syncFromShedCalepinage);
            rowSelectorEl.dataset.petitChampSyncAttached = 'true';
        }

        // Champs résultat backend (readonly, posés via `.value =` sans événement natif) : suivis via
        // l'événement custom dispatché par calepinage_correction_controller.js/FormHandler.js.
        if (!doc.body || !doc.body.dataset.petitChampShedResultsListenerAttached) {
            doc.addEventListener('calepinage:shedResultsUpdated', (evt) => {
                if (evt.detail && String(evt.detail.pvId) === String(pvId)) {
                    syncFromShedCalepinage();
                }
            });
            if (doc.body) doc.body.dataset.petitChampShedResultsListenerAttached = 'true';
        }
    }

    // NOUVEAU (demande explicite) : un changement sur #facadeRowSelector (local) est répercuté vers le
    // VRAI #shedRowSelector (calepinage.html) via un événement 'change' natif — le calcul du nombre de
    // groupes de la rangée sélectionnée (#shedGroupsInRow) reste ENTIÈREMENT géré par le handler déjà
    // existant côté calepinage.html (cf. FormHandler.js), qui dispatch ensuite
    // 'calepinage:shedResultsUpdated' -> capté par le listener déjà attaché dans
    // attachParentListeners() ci-dessus -> syncFromShedCalepinage() re-synchronise #nbShedGroups. Aucune
    // boucle infinie : ce listener ne touche jamais #facadeRowSelector lui-même, seul le VRAI sélecteur
    // parent est modifié, et populateFacadeRowSelector() ci-dessus est un no-op dès que les 2 valeurs
    // sont déjà alignées.
    function attachLocalListeners() {
        const facadeRowSelectorEl = document.getElementById('facadeRowSelector');
        if (facadeRowSelectorEl && !facadeRowSelectorEl.dataset.petitChampSyncAttached) {
            facadeRowSelectorEl.addEventListener('change', () => {
                const pvId = getPvId();
                if (champDuMoteurUnifie(pvId)) return;
                const parentSelect = getParentField(pvId, 'shedRowSelector');
                if (!parentSelect || parentSelect.value === facadeRowSelectorEl.value) return;
                parentSelect.value = facadeRowSelectorEl.value;
                parentSelect.dispatchEvent(new Event('change', { bubbles: true }));
            });
            facadeRowSelectorEl.dataset.petitChampSyncAttached = 'true';
        }
    }

    function init() {
        syncFromShedCalepinage();
        attachParentListeners();
        attachLocalListeners();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
