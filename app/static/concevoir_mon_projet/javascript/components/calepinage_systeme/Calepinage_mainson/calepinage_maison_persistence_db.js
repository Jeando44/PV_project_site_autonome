/**
 * Calepinage résidentiel (toiture multi-typologie) — Persistance en base de données.
 *
 * Complète (sans la remplacer) la persistance localStorage existante (calepinage_persistence.js
 * pour l'état par maison, polygon_maison.js pour les tracés) — la BD est la sauvegarde durable
 * (survit à un changement de navigateur/poste), le localStorage reste le cache/transport utilisé
 * en temps réel par le reste du module, exactement comme pour le calepinage rectangulaire/
 * polygonale/shed (cf. CalepinageDataService.js).
 *
 * Table dédiée côté backend (CalepinageMaison, app/models/calepinage.py) : ce module reste
 * volontairement indépendant du calepinage rectangulaire/polygonale/shed (cf. demande explicite),
 * donc pas de réutilisation de la route/table `calepinage` existante.
 */
(function () {
    const POLYGONS_KEY = 'calepinage_maison_polygons_v1';
    const STATES_KEY = 'calepinage_maison_v1';

    function getProjetId() {
        return localStorage.getItem('current_projet_id');
    }

    // Reconstitue, à partir des 2 clés localStorage existantes, le payload { [maisonId]: { coordonnees, state } }
    // attendu par la route de sauvegarde — sans dupliquer/modifier le format déjà utilisé par
    // calepinage_persistence.js/polygon_maison.js.
    function buildMaisonsPayload() {
        let polygons = [];
        try { polygons = JSON.parse(localStorage.getItem(POLYGONS_KEY) || '[]'); } catch (err) { polygons = []; }

        let statesStore = {};
        try { statesStore = JSON.parse(localStorage.getItem(STATES_KEY) || '{}'); } catch (err) { statesStore = {}; }

        const maisons = {};
        const projetActif = getProjetId();
        (polygons || []).forEach((entry) => {
            if (!entry || !entry.maisonId) return;
            let saved = statesStore[entry.maisonId];
            // État marqué d'un AUTRE projet (écriture tardive de l'ancien projet après un changement de
            // projet, cf. calepinage_persistence.js) : jamais envoyé sous l'identité de celui-ci.
            if (saved && saved.projetId && projetActif && String(saved.projetId) !== String(projetActif)) saved = null;
            maisons[entry.maisonId] = {
                coordonnees: entry.path || [],
                // CORRECTIF (bug rapporté, gravissime : "on enregistre un calepinage rectangulaire,
                // on change de projet, on revient : le calepinage s'est désorganisé") : le mode de
                // tracé ('rect'/'polygon') n'était PAS transmis à la base — il ne survivait donc
                // jamais à un aller-retour, et tout contour réhydraté depuis la base redevenait un
                // 'polygon' (repli de restorePolygons). Or en mode 'polygon' l'orientation des
                // panneaux n'est pas dérivée du contour mais fixée plein sud (cf.
                // calepinage_maison_calculs.js::resetDivision) : un rectangle orienté retrouvait une
                // grille en biais, panneaux "désorganisés", azimut affiché à 0°. Le payload passe
                // entier dans la colonne JSON `donnees_completes` (cf. la route de sauvegarde) :
                // aucune migration de schéma n'est nécessaire pour le transporter.
                mode: entry.mode || (window.MaisonPolygonManager
                    ? window.MaisonPolygonManager.inferModeFromPath(entry.path)
                    : 'polygon'),
                state: (saved && saved.state) || {},
                // Limite de propriété, trait et valeur du décalage d'un champ issu de parcelles
                // cadastrales (cf. decalage_parcelles/DecalageParcelles.js) : même colonne JSON
                // `donnees_completes`, validé côté serveur (recul 1 à 50 m).
                ...(entry.origineParcelles ? { origineParcelles: entry.origineParcelles } : {}),
                // Type de structure imposé à la création (ex. champ solaire issu du décalage de
                // parcelles) et réglages initiaux : jusqu'ici perdus en base — un champ jamais ouvert
                // dans le modal revenait alors en « toiture résidentielle » après un changement de
                // projet ou une réouverture (bug rapporté sur le petit champ solaire).
                ...(entry.typeMontageInitial ? { typeMontageInitial: entry.typeMontageInitial } : {}),
                ...(entry.reglagesInitiaux ? { reglagesInitiaux: entry.reglagesInitiaux } : {}),
            };
        });
        return maisons;
    }

    // ------------------------------------------------------------------------------------------
    // Modifications non enregistrées (demande explicite : « s'il n'y a pas eu de modification, fermer
    // le calepinage sans afficher le message de sauvegarde ») : l'état local est comparé au DERNIER
    // ENREGISTREMENT en base — dernier envoi réussi de saveToDatabase(), sinon contenu de la base lu
    // au chargement de la page. Comparaison sur le payload réellement envoyé à la base, sous forme
    // canonique : clés triées (la base renvoie ses clés dans un autre ordre), nombres arrondis au
    // millionième (un recalcul à l'ouverture ne doit pas compter comme une modification), réglages
    // d'affichage du canevas exclus (zoom, cadrage, cases « afficher... ») : ouvrir, zoomer ou
    // basculer en 3D ne modifie pas le projet.
    // ------------------------------------------------------------------------------------------
    const CLES_AFFICHAGE = new Set([
        'scale', 'offsetX', 'offsetY', 'zoomFactor', 'panOffsetX', 'panOffsetY', 'panToolActive',
        'viewMode', 'view3DMode', 'coupePanIndex',
    ]);
    const estCleAffichage = (cle) => CLES_AFFICHAGE.has(cle) || /^show[A-Z]/.test(cle);

    function canonique(valeur) {
        if (typeof valeur === 'number') return Number.isFinite(valeur) ? Math.round(valeur * 1e6) / 1e6 : null;
        if (Array.isArray(valeur)) return valeur.map(canonique);
        if (valeur && typeof valeur === 'object') {
            const out = {};
            Object.keys(valeur).sort().forEach((k) => {
                if (valeur[k] !== undefined) out[k] = canonique(valeur[k]);
            });
            return out;
        }
        return valeur === undefined ? null : valeur;
    }

    /** Empreinte d'un payload { [maisonId]: { coordonnees, mode, state } } (format de la base). */
    function signatureMaisons(maisons) {
        const net = {};
        Object.keys(maisons || {}).forEach((id) => {
            const m = maisons[id] || {};
            const state = {};
            Object.keys(m.state || {}).forEach((k) => { if (!estCleAffichage(k)) state[k] = m.state[k]; });
            net[id] = {
                coordonnees: m.coordonnees || [], mode: m.mode || null, state,
                typeMontageInitial: m.typeMontageInitial || null, reglagesInitiaux: m.reglagesInitiaux || null,
            };
        });
        return JSON.stringify(canonique(net));
    }

    // null tant que le dernier enregistrement n'est pas connu (base injoignable...) : on demande alors
    // toujours, par prudence.
    let enregistrement = null; // payload canonique du dernier enregistrement
    // Projet auquel appartient `enregistrement` : au changement de projet sans rechargement de page,
    // celui de l'ancien projet restait la référence (jamais remplacé, cf. `enregistrement === null`
    // dans hydrateFromDatabaseIfEmpty) — modifications fantômes ou, à l'inverse, sauvegarde sautée.
    let enregistrementProjetId = null;
    function memoriserEnregistrement(maisons) {
        enregistrement = JSON.parse(signatureMaisons(maisons));
        enregistrementProjetId = getProjetId();
    }
    const enregistrementConnu = () => enregistrement !== null
        && String(enregistrementProjetId) === String(getProjetId());

    /**
     * Écarts entre le calepinage local et le dernier enregistrement (chemins lisibles, ex.
     * « PV1.state.obstacles[0].x »). Un réglage du calepinage ABSENT de l'enregistrement est ignoré :
     * il a été ajouté au module après cet enregistrement (valeur par défaut posée au chargement), ce
     * n'est pas une modification de l'utilisateur — sans cela, tout projet enregistré avec une
     * version antérieure du module demandait à être sauvegardé à chaque fermeture (bug rapporté).
     */
    // Réglages d'un état calculés à l'ouverture (jamais une saisie) : absents d'un enregistrement
    // antérieur à leur ajout, ils ne sont pas une modification de l'utilisateur.
    const CLES_DERIVEES = new Set(['roofLocalOriginLatLng']);

    /**
     * Valeur canonique par défaut de chaque réglage d'un état neuf (CM.createDefaultState), ou null
     * si le module n'est pas chargé.
     */
    function valeursParDefaut() {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.createDefaultState !== 'function') return null;
        try {
            const d = CM.createDefaultState();
            const out = {};
            Object.keys(d).forEach((k) => {
                const v = d[k] instanceof Map ? Array.from(d[k].entries()) : d[k];
                out[k] = JSON.stringify(canonique(v));
            });
            return out;
        } catch (err) {
            return null;
        }
    }

    function differencesNonEnregistrees() {
        if (!enregistrementConnu()) return ['dernier enregistrement en base inconnu'];
        const local = JSON.parse(signatureMaisons(buildMaisonsPayload()));
        const ecarts = [];
        let defauts;
        // CORRECTIF (bug rapporté : « le calepinage enregistré du champ solaire change à la
        // réouverture, je dois tout refaire ») : un réglage absent de l'enregistrement était
        // TOUJOURS ignoré. Un enregistrement à l'état vide (champ jamais ouvert) rendait alors toute
        // modification invisible : la sauvegarde était sautée (« inchangé ») à chaque fois et la base
        // gardait l'état vide. Désormais, au premier niveau de l'état, un réglage absent n'est ignoré
        // que s'il vaut encore sa valeur par défaut (réglage ajouté au module depuis l'enregistrement)
        // ou s'il est calculé à l'ouverture (CLES_DERIVEES).
        const absentIgnorable = (cle, valeur, niveauEtat) => {
            if (!niveauEtat || CLES_DERIVEES.has(cle)) return true;
            if (defauts === undefined) defauts = valeursParDefaut();
            if (!defauts) return true;
            return Object.prototype.hasOwnProperty.call(defauts, cle) && defauts[cle] === JSON.stringify(valeur);
        };
        const comparer = (a, b, chemin, dansEtat, niveauEtat) => {
            if (ecarts.length >= 20) return;
            if (a === b) return;
            const objA = a && typeof a === 'object', objB = b && typeof b === 'object';
            if (!objA || !objB || Array.isArray(a) !== Array.isArray(b)) { ecarts.push(chemin); return; }
            if (Array.isArray(a)) {
                if (a.length !== b.length) { ecarts.push(`${chemin} (longueur ${b.length} -> ${a.length})`); return; }
                a.forEach((v, i) => comparer(v, b[i], `${chemin}[${i}]`, dansEtat, false));
                return;
            }
            new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
                if (!(k in b) && dansEtat && absentIgnorable(k, a[k], niveauEtat)) return; // réglage jamais enregistré
                comparer(a[k], b[k], chemin ? `${chemin}.${k}` : k, dansEtat || k === 'state', k === 'state' && !dansEtat);
            });
        };
        comparer(local, enregistrement, '', false);
        return ecarts;
    }

    /** true si le calepinage local diffère du dernier enregistrement en base (ou si celui-ci est inconnu). */
    function aDesModificationsNonEnregistrees() {
        const ecarts = differencesNonEnregistrees();
        if (ecarts.length) console.info('[CalepinageMaisonPersistenceDB] Modifications non enregistrées :', ecarts);
        return ecarts.length > 0;
    }

    // Puissance totale (kWc) de toutes les maisons connues — demande explicite : la colonne
    // "P. projet (kWc)" de "Mes projets" restait vide pour un projet fait uniquement en calepinage
    // maison (computeProjectKwc(), parametreProjetFormManager.js, ne lit que calepinage_data, propre
    // au calepinage rectangulaire/polygonale/shed). Réutilise CM.getAllPvFieldSummaries() (déjà
    // utilisée par SummaryModal.js), qui agrège TOUTES les maisons connues via ensureAllSourcesLoaded
    // (pas seulement celle actuellement ouverte).
    function resumesChampsPv() {
        if (!window.CalepinageMaisonIndiv || typeof window.CalepinageMaisonIndiv.getAllPvFieldSummaries !== 'function') {
            return [];
        }
        return window.CalepinageMaisonIndiv.getAllPvFieldSummaries() || [];
    }
    function computeTotalPuissanceKwc(resumes) {
        return (resumes || resumesChampsPv()).reduce((sum, s) => sum + (Number(s.peakPower) || 0), 0);
    }
    // Surface projetée au sol des panneaux (m²) : même source que la puissance, enregistrée en base
    // avec elle et relue par le calculateur Loi APER (« Surface projetée champ PV »).
    function computeTotalSurfaceProjeteeM2(resumes) {
        const total = (resumes || resumesChampsPv()).reduce((sum, s) => sum + (Number(s.surfaceProjeteeM2) || 0), 0);
        return Math.round(total * 100) / 100;
    }

    // La base connaît-elle déjà la surface projetée de ce projet ? (false : calepinage enregistré
    // avant son ajout -> elle est envoyée à la prochaine sauvegarde, même sans modification).
    let surfaceProjeteeEnregistree = null;
    let surfaceProjeteeProjetId = null;
    function noterSurfaceProjetee(res) {
        if (!res || typeof res.surfaceProjeteeEnregistree !== 'boolean') return;
        surfaceProjeteeEnregistree = res.surfaceProjeteeEnregistree;
        surfaceProjeteeProjetId = getProjetId();
    }
    const surfaceProjeteeManquante = () => surfaceProjeteeEnregistree === false
        && String(surfaceProjeteeProjetId) === String(getProjetId());

    // Sauvegarde en base — appelée sur le même clic "Calculer et Visualiser" que le calepinage
    // rectangulaire (cf. la fonction dédiée en bas de ce fichier), sans jamais toucher à
    // CalepinageDataService.js (écouteur indépendant, cf. commentaire plus bas).
    // Renumérotations des champs (PV2 -> PV1 après suppression de PV1) pas encore enregistrées, du
    // numéro connu de la base vers le numéro actuel. Envoyées avec la sauvegarde qui porte les
    // nouveaux numéros : le serveur y fait suivre les données rattachées au n° de champ (paramètres
    // du petit champ, géométrie des configurateurs, champs exclus du dossier ombrières).
    let renumerotationEnAttente = {};
    function noterRenumerotation(correspondance) {
        if (!correspondance || typeof correspondance !== 'object') return;
        const cibles = new Set(Object.values(renumerotationEnAttente));
        const composee = {};
        Object.entries(renumerotationEnAttente).forEach(([base, actuel]) => {
            composee[base] = Object.prototype.hasOwnProperty.call(correspondance, actuel) ? correspondance[actuel] : actuel;
        });
        Object.entries(correspondance).forEach(([ancien, nouveau]) => {
            if (!cibles.has(ancien)) composee[ancien] = nouveau;
        });
        Object.keys(composee).forEach((k) => { if (composee[k] === k) delete composee[k]; });
        // Filet : deux champs vers le même n° seraient refusés par le serveur (sauvegarde bloquée) —
        // ces entrées sont écartées (le serveur traite alors ces champs comme supprimés/inchangés).
        const parCible = {};
        Object.entries(composee).forEach(([k, v]) => { (parCible[v] = parCible[v] || []).push(k); });
        Object.values(parCible).forEach((sources) => {
            if (sources.length > 1) sources.forEach((k) => delete composee[k]);
        });
        renumerotationEnAttente = composee;
    }

    // Champ supprimé avant d'avoir été enregistré sous son nouveau n° : la renumérotation qui y menait
    // disparaît avec lui (le serveur le verra absent et supprimera ses données).
    document.addEventListener('maisonShapeRemoved', (e) => {
        const pvId = e && e.detail && e.detail.pvId;
        if (!pvId) return;
        Object.keys(renumerotationEnAttente).forEach((base) => {
            if (renumerotationEnAttente[base] === pvId) delete renumerotationEnAttente[base];
        });
    });

    // Sauvegarde en cours, attendue par puissance_projet_sync.js plutôt que d'en relancer une
    // seconde en parallèle (deux remplacements concurrents des lignes de la même maison).
    let sauvegardeEnCours = null;
    function saveToDatabase(options) {
        // Sauvegardes ENCHAÎNÉES, jamais en parallèle : deux remplacements concurrents des lignes
        // d'un même projet (changement de projet + Calculer...) pouvaient dupliquer des maisons.
        const precedente = sauvegardeEnCours;
        const promesse = (precedente ? precedente.catch(() => null) : Promise.resolve())
            .then(() => enregistrerEnBase(options));
        sauvegardeEnCours = promesse;
        promesse.finally(() => { if (sauvegardeEnCours === promesse) sauvegardeEnCours = null; });
        return promesse;
    }

    function enregistrerEnBase(options) {
        // Projet changé dans un autre onglet (cf. garde_projet_actif.js) : le cache local et
        // current_projet_id appartiennent à l'autre projet — rien n'est envoyé.
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) {
            return Promise.resolve({ success: false, bloque: true, message: 'Projet changé dans un autre onglet : rechargez la page' });
        }
        const projetId = getProjetId();
        if (!projetId) return Promise.resolve({ success: false, message: 'Aucun projet actif' });

        // GARDE-FOU CROISÉ (symétrique de CalepinageDataService.js::ownerKey/saveToDatabase, pour
        // le calepinage rectangulaire/polygonale/shed) : hydrateFromDatabaseIfEmpty() protège déjà
        // la LECTURE (vide le cache s'il appartient à un autre projet), mais rien ne protégeait
        // jusqu'ici l'ÉCRITURE — un appel à saveToDatabase() survenant AVANT ce nettoyage (chemin de
        // code qui ne passe pas par l'hydratation, ex. modification directe des équipements sans
        // recharger les contours) aurait pu envoyer en base le cache d'un projet sous l'identité
        // d'un autre. On bloque plutôt que de risquer une corruption croisée.
        const owner = localStorage.getItem('calepinage_maison_owner_id');
        if (owner && String(owner) !== String(projetId)) {
            console.error(`🚨 [CalepinageMaisonPersistenceDB] Incohérence détectée : le cache local de calepinage maison appartient au projet ${owner}, mais la sauvegarde est ciblée sur le projet ${projetId}. Sauvegarde bloquée pour éviter une corruption croisée entre projets.`);
            return Promise.resolve({ success: false, message: `Incohérence de projet actif détectée (données du projet ${owner} vs cible ${projetId})`, blocked: true });
        }

        const maisons = buildMaisonsPayload();
        // Calepinage identique au dernier enregistrement connu : rien n'est envoyé — ouvrir un projet
        // sans rien modifier ne doit ni réécrire le calepinage ni changer sa puissance enregistrée.
        const renumerotation = { ...renumerotationEnAttente };
        if (!(options && options.explicitDeletion) && !Object.keys(renumerotation).length && enregistrement !== null
            && !surfaceProjeteeManquante() && differencesNonEnregistrees().length === 0) {
            return Promise.resolve({ success: true, skipped: true, inchange: true });
        }
        // Rien à sauvegarder ET aucune suppression explicite en cours : ne pas appeler la route du
        // tout (évite un aller-retour réseau inutile — le garde-fou anti-perte-de-données côté
        // backend gérerait de toute façon ce cas correctement).
        if (!Object.keys(maisons).length && !(options && options.explicitDeletion)) {
            memoriserEnregistrement(maisons);
            return Promise.resolve({ success: true, skipped: true });
        }

        const resumes = resumesChampsPv();
        return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/calepinage-maison/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                maisons,
                explicitDeletion: !!(options && options.explicitDeletion),
                puissanceTotaleKwc: computeTotalPuissanceKwc(resumes),
                surfaceProjeteeTotaleM2: computeTotalSurfaceProjeteeM2(resumes),
                ...(Object.keys(renumerotation).length ? { renumerotation } : {}),
            }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res && res.success !== false) {
                    memoriserEnregistrement(maisons);
                    noterSurfaceProjetee(res);
                    // Renumérotations ENVOYÉES acquittées ; celles ajoutées pendant l'envoi repartent
                    // des numéros que la base vient de recevoir.
                    if (Object.keys(renumerotation).length) {
                        const reste = {};
                        Object.entries(renumerotationEnAttente).forEach(([k, v]) => {
                            const base = Object.prototype.hasOwnProperty.call(renumerotation, k) ? renumerotation[k] : k;
                            if (base !== v) reste[base] = v;
                        });
                        renumerotationEnAttente = reste;
                    }
                }
                return res;
            })
            .catch((err) => {
                console.warn('[CalepinageMaisonPersistenceDB] Échec de sauvegarde en base.', err);
                return { success: false, message: String(err) };
            });
    }

    function loadFromDatabase(projetId) {
        if (!projetId) return Promise.resolve(null);
        return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/calepinage-maison/load`)
            .then((r) => r.json())
            .catch((err) => {
                console.warn('[CalepinageMaisonPersistenceDB] Échec de chargement depuis la base.', err);
                return null;
            });
    }

    // Hydrate le localStorage depuis la BD UNIQUEMENT s'il est vide pour ce module (aucun contour
    // local) — la BD complète un poste/navigateur neuf, elle n'écrase jamais un travail local déjà
    // présent (même principe de prudence que le garde-fou anti-perte-de-données côté backend).
    // Appelée une seule fois, avant MaisonPolygonManagerInstance.restorePolygons() (cf.
    // polygon_maison.js), pour que les maisons sauvegardées en base réapparaissent sur un poste qui
    // n'a jamais eu ce projet en localStorage.
    async function hydrateFromDatabaseIfEmpty() {
        const projetId = getProjetId();
        if (!projetId) return;
        if (String(enregistrementProjetId) !== String(projetId)) enregistrement = null;

        // CORRECTIF (bug rapporté : "fuite de données — les maisons d'un projet apparaissent dans
        // un autre projet") : calepinage_maison_owner_id (posé par _persistPolygons()/cette même
        // fonction) indique à quel projet appartient RÉELLEMENT le contenu actuel de ces 2 clés. Un
        // désaccord explicite avec le projet actif signale un cache laissé par un AUTRE projet — on
        // le vide avant de décider s'il faut recharger depuis la base, pour ne jamais redessiner les
        // maisons d'un autre projet. Un marqueur ABSENT (jamais encore posé, ex. juste après le
        // déploiement de ce correctif) n'est PAS traité comme un désaccord : on continue de faire
        // confiance au cache local existant, pour ne pas perdre des modifications non encore
        // synchronisées en base sur un simple rechargement de page.
        const ownerId = localStorage.getItem('calepinage_maison_owner_id');
        // Marqueur ABSENT alors que des contours sont en cache : origine inconnue (tracés avant toute
        // sélection de projet, ancien cache...) — la base fait foi, le cache est écarté plutôt que
        // d'être rattaché à ce projet (cause possible de calepinages mélangés).
        if (!ownerId || String(ownerId) !== String(projetId)) {
            localStorage.removeItem(POLYGONS_KEY);
            localStorage.removeItem(STATES_KEY);
        }

        if (localStorage.getItem(POLYGONS_KEY)) {
            // Contours locaux conservés (ils peuvent porter des modifications non enregistrées) : on
            // lit tout de même la base, en arrière-plan, pour connaître le dernier enregistrement.
            loadFromDatabase(projetId).then((res) => {
                if (res && res.success && enregistrement === null) memoriserEnregistrement(res.maisons || {});
                if (res && res.success) noterSurfaceProjetee(res);
            });
            return;
        }

        const result = await loadFromDatabase(projetId);
        if (result && result.success && enregistrement === null) memoriserEnregistrement(result.maisons || {});
        if (result && result.success) noterSurfaceProjetee(result);
        if (!result || !result.success || !result.maisons || !Object.keys(result.maisons).length) return;

        const polygons = [];
        const statesStore = {};
        Object.entries(result.maisons).forEach(([maisonId, info]) => {
            // Mode de tracé : celui enregistré avec le contour, sinon celui de l'état de la maison
            // (contourMode fait partie de l'état persisté), sinon déduit de la géométrie. Sans cette
            // chaîne de replis, le contour revenait de la base sans mode et repartait en 'polygon',
            // ce qui réorientait tout le calepinage plein sud (cf. buildMaisonsPayload ci-dessus).
            const path = info.coordonnees || [];
            const mode = info.mode
                || (info.state && info.state.contourMode)
                || (window.MaisonPolygonManager ? window.MaisonPolygonManager.inferModeFromPath(path) : 'polygon');
            polygons.push({
                maisonId, path, mode,
                ...(info.origineParcelles ? { origineParcelles: info.origineParcelles } : {}),
                ...(info.typeMontageInitial ? { typeMontageInitial: info.typeMontageInitial } : {}),
                ...(info.reglagesInitiaux ? { reglagesInitiaux: info.reglagesInitiaux } : {}),
            });
            if (info.state && Object.keys(info.state).length) {
                statesStore[maisonId] = {
                    sourceType: 'maps',
                    sourceLabel: maisonId,
                    savedAt: Date.now(),
                    projetId,
                    state: info.state,
                };
            }
        });

        try {
            localStorage.setItem(POLYGONS_KEY, JSON.stringify(polygons));
            // Les états sont TOUJOURS remplacés par ceux de la base (même vides) : un état resté en
            // cache (autre projet, écriture tardive) ne doit pas se greffer sur le PV1 de ce projet.
            if (Object.keys(statesStore).length) localStorage.setItem(STATES_KEY, JSON.stringify(statesStore));
            else localStorage.removeItem(STATES_KEY);
            // cf. polygon_maison.js::_persistPolygons() : même marqueur de propriétaire, posé ici
            // aussi puisque cette hydratation écrit directement les 2 clés sans passer par
            // _persistPolygons().
            localStorage.setItem('calepinage_maison_owner_id', projetId);
        } catch (err) {
            console.warn('[CalepinageMaisonPersistenceDB] Hydratation locale impossible (quota ?).', err);
        }
    }

    window.CalepinageMaisonPersistenceDB = {
        saveToDatabase, loadFromDatabase, hydrateFromDatabaseIfEmpty, aDesModificationsNonEnregistrees,
        differencesNonEnregistrees, _signatureMaisons: signatureMaisons,
        sauvegardeEnCours: () => sauvegardeEnCours,
        noterRenumerotation,
        renumerotationEnAttente: () => ({ ...renumerotationEnAttente }),
        // Modifications locales non enregistrées, sans le cas « dernier enregistrement inconnu »
        // (page tout juste chargée) qui ne doit pas afficher « modifié » dans « Mes projets ».
        modificationsNonEnregistreesConnues: () => {
            if (!enregistrementConnu()) return false;
            return differencesNonEnregistrees().length > 0;
        },
    };

    // Déclencheur : même geste EXACT que CalepinageDataService.js pour le calepinage rectangulaire
    // (mêmes sélecteurs, même garde IRVE) — un second écouteur délégué INDÉPENDANT sur le même
    // bouton "Calculer et Visualiser" (les écouteurs `click` sur `document` s'empilent sans se
    // gêner), pour ne jamais avoir à modifier CalepinageDataService.js (garde ce module découplé,
    // cf. demande explicite d'indépendance).
    document.addEventListener('click', (event) => {
        const target = event.target;

        if (target.closest('.btn-calculate-irve, [onclick*="calculateEnergie"], [onclick*="calculateBilanPuissance"], [id*="bilan-calculate-btn"]')) {
            return;
        }

        // CORRECTIF (bug rapporté : "la puissance du projet n'apparaît toujours pas pour le
        // calepinage résidentiel") : ces sélecteurs ciblent tous le bouton "Calculer et Visualiser"
        // DANS un onglet de champ PV du calepinage grands-projets (cf. calepinage.html) — un onglet
        // qui n'existe tout simplement jamais pour un projet Résidentielle (son panneau #pvTabs/
        // #pvForms est masqué, cf. ButtonControl.applyResidentialUIFiltering()). Le seul point
        // d'entrée réellement emprunté pour voir la synthèse d'un projet résidentiel est le lien de
        // menu "Dimensionnement" (cf. menu_list.html::openDimensionnementModal(), qui ouvre
        // SummaryModal), jamais capté ici jusqu'à présent : la sauvegarde en base
        // (puissance_maison_kwc) n'était donc simplement jamais déclenchée pour ce type de projet.
        const btn = target.closest('#btn-calculer, .btn-calculer, #btn-calculer-visualiser, .btn-calculer-visualiser, #btn-open-results, a[data-nav-step="dimensionnement"]')
            || (target.closest('button, a') && (
                target.closest('button, a').textContent.includes('Calculer et visualiser') ||
                target.closest('button, a').textContent.includes('Calculer')
            ));

        if (btn) {
            saveToDatabase().catch((err) => {
                console.warn('[CalepinageMaisonPersistenceDB] Échec de la sauvegarde forcée avant calcul.', err);
            });
        }
    });

    // NOUVEAU (demande explicite : "les saisies du modal Dimensionnement pour le résidentiel
    // doivent être sauvegardées en BD" — bug confirmé par investigation : CM.setMaisonFieldResult()
    // n'était rattaché à AUCUN déclencheur de sauvegarde) : même pont debouncé (800ms) que
    // ResidentielChiffrageDB.js pour le module CAPEX/OPEX résidentiel — PAS une réintroduction de
    // l'autosave périodique du calepinage Pro/Grand (désactivé volontairement le 2026-07-26 suite à
    // un bug de corruption cross-projet, cf. CalepinageDataService.js) : ici l'événement est
    // déclenché explicitement par une saisie utilisateur dans le modal Dimensionnement, jamais par
    // un intervalle aveugle, et cible toujours le projet actuellement chargé (getProjetId()).
    let dimensionnementSaveTimeout;
    document.addEventListener('calepinageMaisonFieldChanged', () => {
        clearTimeout(dimensionnementSaveTimeout);
        dimensionnementSaveTimeout = setTimeout(() => {
            saveToDatabase().catch((err) => {
                console.warn('[CalepinageMaisonPersistenceDB] Échec de la sauvegarde du résultat de dimensionnement.', err);
            });
        }, 800);
    });

    // RETIRÉ (demande explicite : "quelle que soit la typologie de projet, la sauvegarde des
    // calepinages et obstacles en base doit être réalisée UNIQUEMENT lorsqu'on clique sur le
    // bouton Calculer et visualiser") : un écouteur 'calepinageMaisonStateChanged' déclenchant une
    // sauvegarde BD automatique à chaque mutation d'état (ajout/déplacement/suppression d'obstacle,
    // édition d'un pan) avait été ajouté ici, puis retiré sur cette demande explicite — cohérent
    // avec l'autosave périodique du calepinage Pro/Grand, déjà désactivée volontairement le
    // 2026-07-26 suite à un bug de corruption cross-projet (cf. CalepinageDataService.js). La
    // sauvegarde en base du calepinage/des obstacles reste donc déclenchée UNIQUEMENT par le clic
    // "Calculer et visualiser" (écouteur plus haut dans ce fichier) — la persistance localStorage
    // (temps réel, cf. calepinage_maison_orchestrateur.js::persistCurrentState) n'est pas affectée.
})();
