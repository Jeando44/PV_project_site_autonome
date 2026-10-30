/**
 * ============================================================
 * MODULE : GESTIONNAIRE DE PERSISTANCE POUR LES MODALS DE GÉOMÉTRIE
 * (Ombrière métal, Ombrière bois, Ombrière Solumbra, Bâtiment métal)
 * Fichier : storage_manager_geometrie_structure.js
 * ============================================================
 *
 * Sauvegarde et restaure la saisie/les choix de l'utilisateur (champs numériques/texte,
 * cases à cocher, boutons de choix à état actif) pour ces 4 modals, par type de structure et
 * par champ PV (pvId, cf. paramètre d'URL ?pvId=PV1), afin de ne pas les perdre au rechargement
 * de la page.
 *
 * IMPORTANT : les champs synchronisés automatiquement depuis le calepinage/solarProjectData
 * (largeur champ PV, longueur totale, disposition des panneaux, inclinaison/pente...) sont
 * volontairement exclus (cf. EXCLUDED_FIELD_IDS) : les restaurer écraserait la valeur à jour
 * fournie par cette synchronisation (updateDimensionsFromStorage(), commune aux 4 fichiers).
 *
 * Utilisation (dans chaque template HTML, après avoir défini le type de structure) :
 *   <script>window.GEOMETRIE_STRUCTURE_TYPE = 'batiment_metal';</script>
 *   <script src=".../geometrie_structure/storage_manager_geometrie_structure.js"></script>
 */

class GeometrieStructureStorageManager {
    constructor(structureType) {
        this.structureType = structureType || 'default';
        // Clé PROPRE AU PROJET actif (bug rapporté : « calepinage mélangé ») : l'ancienne clé unique
        // 'skv_geometrie_structure_data' ne distinguait que type de structure et n° de champ (PV1...) ;
        // le PV1 d'un projet — ou d'un autre utilisateur du même navigateur — reprenait donc les
        // réglages du PV1 du projet précédent (et le petit champ les renvoyait ensuite en base).
        this.STORAGE_KEY = GeometrieStructureStorageManager.cleProjet(localStorage.getItem('current_projet_id'));
        GeometrieStructureStorageManager.reprendreAncienneCle(this.STORAGE_KEY);
        this.isRestoring = false;
        // Aucune sauvegarde avant la restauration initiale : les scripts du modal émettent des
        // 'input' dès leur initialisation (valeurs par défaut, synchronisation depuis le
        // calepinage...), qui écraseraient sinon la saisie mémorisée AVANT qu'elle soit relue.
        this.initialRestoreDone = false;
    }

    getPvId() {
        return new URLSearchParams(window.location.search).get('pvId') || 'PV1';
    }

    _loadAll() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    /**
     * Collecte les champs (.all-inputs) et les boutons à état actif (groupes de bascule) du
     * formulaire actuellement affiché.
     */
    collectData() {
        const data = { fields: {}, activeButtons: [] };

        const exclus = this._champsExclus();
        document.querySelectorAll('.all-inputs').forEach((el) => {
            if (!el.id || exclus.has(el.id)) return;
            if (el.type === 'checkbox') {
                data.fields[el.id] = { type: 'checkbox', value: el.checked };
            } else {
                data.fields[el.id] = { type: el.type || 'text', value: el.value };
            }
        });

        // Groupes de boutons à choix unique (modèle de structure, fabricant, type de renfort,
        // variante...) : on mémorise l'ID du bouton actif de chaque groupe pour restaurer le
        // bon choix visuel (et déclencher sa logique de sélection via .click()).
        document.querySelectorAll('#controls-container [id$="-group"], #controls-container [id*="Controls"] [class*="toggle-btn-group"]').forEach((group) => {
            const activeBtn = group.querySelector('button.active');
            if (activeBtn && activeBtn.id) {
                data.activeButtons.push(activeBtn.id);
            }
        });

        // Groupes supplémentaires propres à un type de structure (cf. GROUPES_CHOIX_PAR_TYPE) : leurs
        // boutons n'ont pas toujours d'id (data-orientation, data-config...), on mémorise alors
        // l'index du bouton actif dans son groupe.
        const selecteur = GeometrieStructureStorageManager.GROUPES_CHOIX_PAR_TYPE[this.structureType];
        if (selecteur) {
            data.activeChoices = [];
            document.querySelectorAll(selecteur).forEach((group) => {
                const boutons = Array.from(group.querySelectorAll('button'));
                const index = boutons.findIndex((b) => b.classList.contains('active'));
                if (group.id && index >= 0) data.activeChoices.push({ group: group.id, index });
            });
        }
        data.savedAt = Date.now();

        return data;
    }

    _champsExclus() {
        const propres = GeometrieStructureStorageManager.EXCLUDED_BY_TYPE[this.structureType] || [];
        return new Set([...GeometrieStructureStorageManager.EXCLUDED_FIELD_IDS, ...propres]);
    }

    saveData() {
        if (this.isRestoring || !this.initialRestoreDone) return;
        try {
            const all = this._loadAll();
            const pvId = this.getPvId();
            if (!all[this.structureType]) all[this.structureType] = {};
            all[this.structureType][pvId] = this.collectData();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
        } catch (e) {
            console.warn('[GeometrieStructureStorageManager] Sauvegarde échouée:', e);
        }
    }

    _restoreField(id, info) {
        const el = document.getElementById(id);
        if (!el || !info) return;
        // Ne jamais restaurer une valeur texte/nombre vide : un champ resté blanc au moment d'une
        // sauvegarde antérieure (ex. avant qu'un calcul automatique n'ait rempli le champ) ne doit
        // pas écraser la valeur par défaut/calculée actuelle par du vide — cela produisait des
        // champs (ex. "Entraxes poteaux") vidés au rechargement, avec des conséquences visuelles
        // (ex. un seul poteau affiché) plus graves qu'une simple perte de saisie.
        if (info.type !== 'checkbox' && (info.value === '' || info.value === null || info.value === undefined)) {
            return;
        }
        if (info.type === 'checkbox') {
            el.checked = !!info.value;
        } else {
            el.value = info.value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    restoreData() {
        const all = this._loadAll();
        const pvId = this.getPvId();
        const data = all?.[this.structureType]?.[pvId];
        if (!data) return;

        this.isRestoring = true;
        try {
            // 1. Restaurer d'abord les boutons à état actif (modèle, fabricant...) : leur
            // sélection réinitialise souvent plusieurs champs à des valeurs par défaut propres
            // au modèle (cf. setModel() dans batiment_metal.js), qui doivent donc être appliqués
            // AVANT la restauration des champs individuels ci-dessous.
            (data.activeButtons || []).forEach((buttonId) => {
                const btn = document.getElementById(buttonId);
                if (btn) btn.click();
            });
            (data.activeChoices || []).forEach(({ group, index }) => {
                const groupe = document.getElementById(group);
                const btn = groupe ? groupe.querySelectorAll('button')[index] : null;
                if (btn && !btn.classList.contains('active')) btn.click();
            });

            // 2. Restaurer tous les champs (postDistances est exclu, cf. EXCLUDED_FIELD_IDS :
            // il reste piloté par l'algorithme d'auto-remplissage / l'édition manuelle en cours,
            // jamais par une valeur restaurée depuis une session antérieure).
            const fields = data.fields || {};
            const exclus = this._champsExclus();
            Object.entries(fields).forEach(([id, info]) => {
                if (!exclus.has(id)) this._restoreField(id, info);
            });

            this.restored = true;
            console.log(`✅ [GeometrieStructureStorageManager] Données restaurées (${this.structureType}, ${pvId}).`);
        } catch (e) {
            console.error('[GeometrieStructureStorageManager] Erreur lors de la restauration:', e);
        } finally {
            this.isRestoring = false;
        }
    }

    init() {
        const attachSaveListeners = () => {
            const modal = document.getElementById('app-modal');
            if (modal) {
                modal.addEventListener('input', () => this.saveData());
                modal.addEventListener('change', () => this.saveData());
            }
        };
        const start = () => {
            attachSaveListeners();
            // IMPORTANT : ombriere_metal.js/ombriere_bois.js/ombriere_solumbra.js/batiment_metal.js
            // appliquent leurs valeurs par défaut (clic sur le modèle par défaut, calcul
            // automatique de l'entraxe...) après le DOMContentLoaded (window.addEventListener
            // ('load', ...) ou fin de leur propre handler DOMContentLoaded). Un délai fixe généreux
            // (au lieu de dépendre de l'ordre exact d'enregistrement des listeners entre fichiers,
            // fragile et difficile à garantir) laisse le temps à ces valeurs par défaut de
            // s'appliquer avant de restaurer la configuration précédemment sauvegardée par-dessus.
            setTimeout(() => {
                this.restoreData();
                this.initialRestoreDone = true;
                document.dispatchEvent(new CustomEvent('geometrieStructureRestauree', { detail: { pvId: this.getPvId() } }));
            }, 1500);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }

        window.addEventListener('beforeunload', () => this.saveData());
    }
}

// Champs synchronisés automatiquement depuis le calepinage/solarProjectData (cf.
// updateDimensionsFromStorage(), commune aux 4 fichiers ombriere_metal.js/ombriere_bois.js/
// ombriere_solumbra.js/batiment_metal.js) : ne jamais les sauvegarder/restaurer ici.
// postDistances est également exclu : ce champ est piloté par l'algorithme d'auto-remplissage
// de l'entraxe optimal (cf. autoFillOptimalEntraxe* dans chaque fichier de structure) tant que
// l'utilisateur ne l'a pas lui-même modifié dans la session en cours — restaurer une valeur
// d'une session précédente l'empêcherait définitivement de se recalculer correctement, et
// pourrait réintroduire une valeur devenue invalide entre-temps (ex. limite d'entraxe modifiée).
GeometrieStructureStorageManager.EXCLUDED_FIELD_IDS = new Set([
    'panelWidth', 'facadeLength', 'pvLayout', 'roofSlope', 'widthRoof', 'postDistances',
]);

// Petit champ solaire : champs recopiés depuis le calepinage shed de la page parente à chaque
// ouverture (cf. petit_champ_solaire/sync_calepinage_shed.js) — les restaurer écraserait la valeur
// à jour du calepinage.
GeometrieStructureStorageManager.EXCLUDED_BY_TYPE = {
    petit_champ_solaire: [
        'nbPanelsRampant', 'shedSpacing', 'nbShed', 'petitPanelLengthMm', 'petitPanelWidthMm',
        'petitPanelThicknessMm', 'panelSpacingY', 'shedGroupSpacing', 'panelSpacingX', 'nbShedGroups',
        'facadeRowSelector', 'leftOverhang', 'rightOverhang', 'passageHeight', 'postHeight',
    ],
};

// Groupes de choix mémorisés en plus des boutons à id (cf. collectData).
GeometrieStructureStorageManager.GROUPES_CHOIX_PAR_TYPE = {
    petit_champ_solaire: '#controls-container [id$="-group"], #panelOrientationGroup',
};

GeometrieStructureStorageManager.ANCIENNE_CLE = 'skv_geometrie_structure_data';

GeometrieStructureStorageManager.cleProjet = function (projetId) {
    return `${GeometrieStructureStorageManager.ANCIENNE_CLE}:${projetId || 'sans_projet'}`;
};

// Reprise UNIQUE de l'ancienne clé commune, puis suppression :
//  - réglages d'ombrière / de bâtiment (gardés uniquement dans ce navigateur) : rattachés au projet actif ;
//  - réglages du petit champ : on ne sait pas à quel projet ils appartenaient. Ils sont mis de côté
//    (clé ORPHELINS) : à l'ouverture du configurateur, le serveur indique s'ils sont déjà enregistrés
//    dans un projet de l'utilisateur ; sinon l'utilisateur choisit de les appliquer ou de les ignorer
//    (cf. petit_champ_solaire/dossier_plans/iframe/persistance_parametres.js). Jamais appliqués d'office.
GeometrieStructureStorageManager.reprendreAncienneCle = function (cleProjet) {
    try {
        const ancienne = localStorage.getItem(GeometrieStructureStorageManager.ANCIENNE_CLE);
        if (ancienne === null) return;
        localStorage.removeItem(GeometrieStructureStorageManager.ANCIENNE_CLE);
        const donnees = JSON.parse(ancienne || '{}') || {};
        const petitChamp = donnees.petit_champ_solaire;
        delete donnees.petit_champ_solaire;
        if (petitChamp && typeof petitChamp === 'object' && Object.keys(petitChamp).length) {
            const orphelins = GeometrieStructureStorageManager.lireOrphelins();
            orphelins.petit_champ_solaire = { ...petitChamp, ...(orphelins.petit_champ_solaire || {}) };
            localStorage.setItem(GeometrieStructureStorageManager.CLE_ORPHELINS, JSON.stringify(orphelins));
        }
        if (cleProjet.endsWith(':sans_projet') || localStorage.getItem(cleProjet) !== null) return;
        if (Object.keys(donnees).length) localStorage.setItem(cleProjet, JSON.stringify(donnees));
    } catch (e) {
        console.warn("[GeometrieStructureStorageManager] Reprise de l'ancienne clé impossible :", e);
    }
};

GeometrieStructureStorageManager.CLE_ORPHELINS = `${GeometrieStructureStorageManager.ANCIENNE_CLE}:orphelins`;

GeometrieStructureStorageManager.lireOrphelins = function () {
    try {
        const o = JSON.parse(localStorage.getItem(GeometrieStructureStorageManager.CLE_ORPHELINS) || '{}');
        return o && typeof o === 'object' ? o : {};
    } catch (e) {
        return {};
    }
};

/** Retire la copie orpheline (type, n° de champ) une fois traitée. */
GeometrieStructureStorageManager.oublierOrphelin = function (type, pvId) {
    const o = GeometrieStructureStorageManager.lireOrphelins();
    if (!o[type] || !o[type][pvId]) return;
    delete o[type][pvId];
    if (!Object.keys(o[type]).length) delete o[type];
    if (Object.keys(o).length) localStorage.setItem(GeometrieStructureStorageManager.CLE_ORPHELINS, JSON.stringify(o));
    else localStorage.removeItem(GeometrieStructureStorageManager.CLE_ORPHELINS);
};

window.GeometrieStructureStorageManager = GeometrieStructureStorageManager;

window.geometrieStructureStorageManager = new GeometrieStructureStorageManager(window.GEOMETRIE_STRUCTURE_TYPE);
window.geometrieStructureStorageManager.init();
