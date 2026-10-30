/**
 * DIAGNOSTIC TEMPORAIRE — vérification backend du nombre de panneaux du calepinage résidentiel, en
 * regard du calcul frontend (calepinage_maison_calculs.js). Plan de double-vérification résidentiel
 * (mêmes principes que app/models/calepinage_systeme/ pour le calepinage Pro/Grand-projet) : TOUS
 * les poseMode ('incline'/'plat'/'shed'/'dome') sont couverts, chacun revérifié numériquement
 * contre l'extrait JS d'origine avant intégration.
 *
 * DEUX moteurs backend, cf. app/models/calepinage_maison_verification/ :
 *   - residentiel_engine.py : reproduit calepinage_maison_calculs.js sur les MÊMES mètres locaux
 *     déjà calculés par le frontend — détecte les bugs d'algorithme.
 *   - geodesic_engine.py (pyproj+Shapely, demande explicite : "s'il y a une erreur au niveau de la
 *     conversion du front, le backend ne le détectera[it] pas car ils dépendent de la même
 *     source") : reprojette CHAQUE sommet/obstacle depuis ses coordonnées géographiques réelles,
 *     indépendamment de la conversion équirectangulaire du frontend — seul ce résultat peut
 *     détecter une erreur de PROJECTION elle-même (confirmé : identique au 1er moteur sur une
 *     maison, mais diverge sur un très grand toit — cf. tests). Devient l'AUTORITÉ pour le
 *     remplacement (cf. applyOverridesFromResult) quand disponible ; repli sur le 1er moteur sinon
 *     (maison basée sur une image importée, sans référence géographique).
 *
 * IMPORTANT (bug déjà rencontré une fois, cf. shedSpacingM/shedPanelsPerGroup) : tout nouveau champ
 * lu par residentiel_engine.py::_build_ctx doit être ajouté ICI, dans buildVerifPayload() — sinon
 * le backend calcule avec des valeurs par défaut silencieusement fausses plutôt qu'avec les vrais
 * réglages de la maison, donnant l'illusion d'un bug de calcul qui n'en est pas un.
 *
 * Déclenchement : bouton manuel "Vérif Python (test)" dans l'en-tête du modal Calepinage Maison,
 * OU automatiquement à chaque "Ouvrir le dimensionnement"/"Système"/"Calculer et Visualiser" pour
 * un projet Résidentielle (cf. wireAutoTrigger — enveloppe window.summaryModalInstance.showSummary,
 * point de passage commun aux 3, sans toucher à ButtonControl.js/menu_list.html). Le popup de
 * comparaison reste ouvert/à jour entre plusieurs déclenchements successifs — fermeture uniquement
 * manuelle (×), pour permettre de tester plusieurs scénarios de suite.
 *
 * Fichier 100% additif : ne modifie aucun fichier existant.
 */
(function () {
    'use strict';

    // NOUVEAU (demande explicite : "s'il y a une erreur au niveau de la conversion du front, le
    // backend ne le détectera[it] pas car ils dépendent de la même source" — mettre en place
    // pyproj/Shapely) : convertit chaque sommet de pan / centre d'obstacle en lat/lng réelles (via
    // CM.localToLatLng, l'inverse EXACT de latLngToLocal déjà utilisé pour les construire), en plus
    // des mètres locaux déjà envoyés — cf. geodesic_engine.py, qui les reprojette lui-même via
    // pyproj (indépendamment de cette conversion frontend) pour détecter une éventuelle imprécision
    // de projection, invisible à la comparaison JS/Python "mêmes mètres locaux" seule. `null` si la
    // maison n'a aucune référence géographique (image importée, cf. calepinage_image_source.js —
    // state.roofLocalOrigin y vaut null) : la vérification géodésique est alors indisponible pour
    // cette maison (signalé explicitement par le backend, jamais une approximation de repli).
    function toPlainLatLng(ll) {
        return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
    }

    function buildLatLngConverter(state) {
        const CM = window.CalepinageMaisonIndiv;
        const origin = state.roofLocalOrigin;
        if (!origin || !CM || typeof CM.localToLatLng !== 'function') return null;
        return (pt) => toPlainLatLng(CM.localToLatLng(origin, pt));
    }

    function buildVerifPayload(state) {
        const gridOffsetByPan = {};
        (state.gridOffsetByPan || new Map()).forEach((v, k) => { gridOffsetByPan[k] = v; });
        const deletedPanelIndicesByPan = {};
        (state.deletedPanelIndicesByPan || new Map()).forEach((v, k) => { deletedPanelIndicesByPan[k] = Array.from(v); });
        const toLatLng = buildLatLngConverter(state);

        return {
            pans: (state.pans || []).map((p) => ({
                id: p.id,
                points: p.points,
                pointsLatLng: toLatLng ? p.points.map(toLatLng) : null,
                angle: p.angle,
                poseMode: p.poseMode,
                ridgeEdgeIndices: p.ridgeEdgeIndices || [],
            })),
            obstacles: state.obstacles || [],
            obstaclesLatLng: toLatLng ? (state.obstacles || []).map((o) => toLatLng({ x: o.x, y: o.y })) : null,
            panelLengthMm: state.panelLengthMm,
            panelWidthMm: state.panelWidthMm,
            panelSpacingXMm: state.panelSpacingXMm,
            panelSpacingYMm: state.panelSpacingYMm,
            panelOrientation: state.panelOrientation,
            penteDeg: state.penteDeg,
            overhangRampant: state.overhangRampant,
            overhangLongpan: state.overhangLongpan,
            edgeClearanceM: state.edgeClearanceM,
            ridgeClearanceEachSideM: state.ridgeClearanceEachSideM,
            divisionMode: state.divisionMode,
            contourMode: state.contourMode,
            // Contour issu d'un décalage de parcelles : limite de surface du polygone
            // (cf. surface_contour.py::verifier_surface_etat_verification).
            origineParcelles: !!(state.currentPolygonRef && state.currentPolygonRef.origineParcelles),
            rectAzimuthOffsetDeg: state.rectAzimuthOffsetDeg,
            gridOffsetByPan,
            deletedPanelIndicesByPan,
            // CORRECTIF (bug rapporté : "Python bug" — en réalité un payload incomplet) : ces 5
            // champs pilotent le calcul shed côté backend (cf. residentiel_engine.py::_build_ctx)
            // mais avaient été oubliés ici lors de l'ajout du support shed — le backend recevait donc
            // shedSpacingM=0/shedPanelsPerGroup=1 par défaut au lieu des vrais réglages, empilant les
            // rangées sans espacement réel et sans logique de groupe, d'où un surcomptage massif
            // (confirmé : 3609 reproduit exactement avec ces défauts, 1924 = JS avec les vraies
            // valeurs shedSpacingM=2.5/shedPanelsPerGroup=2 de ce cas précis).
            shedSpacingM: state.shedSpacingM,
            shedPanelsPerRow: state.shedPanelsPerRow,
            shedRowGroupSpacingM: state.shedRowGroupSpacingM,
            shedPanelsPerGroup: state.shedPanelsPerGroup,
            shedRegularAlignment: state.shedRegularAlignment,
            // Dôme (cf. residentiel_engine.py::_build_ctx) — mêmes précautions que pour le shed
            // ci-dessus : sans ces 3 champs, le backend calculerait avec domeSpacingM/
            // domePanelSpacingM=0 et domeTiltDeg=0, faussant entièrement l'empilement par paire.
            domeSpacingM: state.domeSpacingM,
            domePanelSpacingM: state.domePanelSpacingM,
            domeTiltDeg: state.domeTiltDeg,
            domePanelsPerRow: state.domePanelsPerRow,
            // Joints de dilatation (cf. residentiel_engine.py::_params_joint_dilatation) : le type
            // de structure (normalisé) décide s'il y en a, les deux réglages de leur position.
            typeMontage: window.CalepinageMaisonIndiv.normalizeTypeMontage(state.typeMontage),
            jointDilatationMm: state.jointDilatationMm,
            jointDilatationLimiteM: state.jointDilatationLimiteM,
            jointDilatationRepartition: state.jointDilatationRepartition,
            terrasseSeparationMm: state.terrasseSeparationMm,
        };
    }

    // NOUVEAU (demande explicite : "mettre en place le remplacement des panneaux si les résultats
    // sont différents. S'ils sont identiques, on ne change rien") : quand un écart est détecté sur
    // un pan, ses panneaux sont désormais remplacés par ceux calculés côté Python (positions
    // incluses, cf. residentiel_engine.py::verify_maison_state(include_positions=True)) — appliqué
    // en enveloppant CM.packPanelsForPan UNE SEULE FOIS (même principe déjà établi dans ce projet,
    // cf. wrapRunSimulationForGainAnnuel) : cette fonction est LA source unique consommée par
    // render(), recomputeResults(), getAllPvFieldSummaries() et l'export PDF — un seul point de
    // greffe couvre donc tout, sans toucher à calepinage_maison_calculs.js/dessin.js.
    //
    // `originalPackPanelsForPan` (capturé AVANT l'enveloppe) reste la mesure "JS pure", utilisée
    // uniquement par ce diagnostic (computeJsCountsPerPan) — sans cette distinction, une fois un
    // correctif appliqué à un pan, le tableau de comparaison se remettrait à lire le résultat
    // Python déjà en place (via CM.packPanelsForPan enveloppée) et afficherait à tort "identique"
    // pour toujours, masquant toute vraie divergence future sur ce même pan.
    let originalPackPanelsForPan = null;

    function wrapPackPanelsForPanForOverride() {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.packPanelsForPan !== 'function') {
            setTimeout(wrapPackPanelsForPanForOverride, 500);
            return;
        }
        if (CM.packPanelsForPan.__cmBackendOverrideWrapped) return;
        originalPackPanelsForPan = CM.packPanelsForPan;
        CM.packPanelsForPan = function (pan) {
            const overrides = CM.state && CM.state.backendPanelsByPan;
            if (overrides && overrides.has(pan.id)) {
                return overrides.get(pan.id).map((p, idx) => ({
                    cx: p.cx, cy: p.cy, w: p.w, l: p.l, angle: p.angle,
                    panId: pan.id, panelIndex: `backend-${idx}`,
                }));
            }
            return originalPackPanelsForPan(pan);
        };
        CM.packPanelsForPan.__cmBackendOverrideWrapped = true;
    }

    function computeJsCountsPerPan(state) {
        const CM = window.CalepinageMaisonIndiv;
        const fn = originalPackPanelsForPan || (CM && CM.packPanelsForPan);
        const out = {};
        (state.pans || []).forEach((pan) => {
            try {
                out[pan.id] = fn(pan).length;
            } catch (e) {
                out[pan.id] = null;
            }
        });
        return out;
    }

    // Convertit les centres de panneaux renvoyés par geodesic_engine.py (lat/lng réelles, repère
    // géodésique propre au backend) dans LE REPÈRE LOCAL DU FRONTEND (CM.state.roofLocalOrigin) —
    // l'inverse exact de buildLatLngConverter ci-dessus. Nécessaire car packPanelsForPan/render()
    // attendent des positions en mètres locaux équirectangulaires (comme le reste du moteur JS),
    // jamais dans le repère pyproj interne au backend.
    function geodesicPanelsToLocal(state, panelsLatLng) {
        const CM = window.CalepinageMaisonIndiv;
        const origin = state.roofLocalOrigin;
        if (!origin || !CM || typeof CM.latLngToLocal !== 'function' || typeof google === 'undefined') return null;
        return panelsLatLng.map((p) => {
            const local = CM.latLngToLocal(origin, new google.maps.LatLng(p.lat, p.lng));
            return { cx: local.x, cy: local.y, w: p.w, l: p.l, angle: p.angle };
        });
    }

    // Applique/retire les correctifs par pan à partir des résultats backend : un pan dont le
    // compte Python (géodésique en priorité — la vérification la plus rigoureuse, cf. demande
    // explicite "utiliser pyproj pour recalculer et vérifier le nombre de panneaux" ; repli sur la
    // comparaison en mètres locaux si la géodésie est indisponible, ex. maison basée sur une image
    // importée) diffère du compte JS voit ses panneaux remplacés (CM.state.backendPanelsByPan) ; un
    // pan désormais identique (ex. après correction d'un payload incomplet, ou d'une modification
    // utilisateur) voit un correctif précédent retiré, pour revenir au calcul JS normal — jamais de
    // correctif maintenu "au cas où" sur un pan qui n'en a plus besoin.
    function applyOverridesFromResult(state, jsCounts, backendResult, geodesicResult) {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || !CM.state) return { replacedPanIds: [], authorityByPanId: {} };
        if (!CM.state.backendPanelsByPan) CM.state.backendPanelsByPan = new Map();

        const geoById = {};
        if (geodesicResult && geodesicResult.available) {
            (geodesicResult.pans || []).forEach((p) => { geoById[p.panId] = p; });
        }

        const replacedPanIds = [];
        const authorityByPanId = {};

        (backendResult.pans || []).forEach((localP) => {
            if (localP.skipped) return;
            const panId = localP.panId;
            const jsCount = jsCounts[panId];
            const geoP = geoById[panId];
            const useGeo = !!(geoP && !geoP.skipped);
            const authoritativeCount = useGeo ? geoP.panelCount : localP.panelCount;
            authorityByPanId[panId] = useGeo ? 'geodesic' : 'local';

            if (jsCount === authoritativeCount) {
                if (CM.state.backendPanelsByPan.has(panId)) CM.state.backendPanelsByPan.delete(panId);
                return;
            }

            let panelsForOverride = null;
            if (useGeo && Array.isArray(geoP.panels)) {
                panelsForOverride = geodesicPanelsToLocal(state, geoP.panels);
            }
            if (!panelsForOverride && Array.isArray(localP.panels)) {
                panelsForOverride = localP.panels; // repli mètres locaux si conversion géodésique impossible
            }
            if (panelsForOverride) {
                CM.state.backendPanelsByPan.set(panId, panelsForOverride);
                replacedPanIds.push(panId);
            }
        });

        if (replacedPanIds.length) { CM.render(); CM.recomputeResults(); }
        return { replacedPanIds, authorityByPanId };
    }

    let overlay = null;

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'cmVerifTestOverlay';
        overlay.style.cssText = 'display:none; position:fixed; top:8vh; left:50%; transform:translateX(-50%); width:520px; max-width:92vw; max-height:80vh; overflow-y:auto; background:#fff; border:2px solid #7c3aed; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.35); z-index:1000001; font-family:sans-serif; font-size:0.85rem;';
        document.body.appendChild(overlay);
        return overlay;
    }

    function renderResults(jsCounts, backendResult, payload, replacedPanIds, authorityByPanId) {
        const el = ensureOverlay();
        const pansById = {};
        (backendResult.pans || []).forEach((p) => { pansById[p.panId] = p; });
        const geodesicResult = backendResult.geodesic || { available: false };
        const geoById = {};
        if (geodesicResult.available) (geodesicResult.pans || []).forEach((p) => { geoById[p.panId] = p; });
        const replacedSet = new Set(replacedPanIds || []);
        const authority = authorityByPanId || {};

        const allPanIds = Array.from(new Set([...Object.keys(jsCounts), ...Object.keys(pansById)]));
        const rows = allPanIds.map((panId) => {
            const jsCount = jsCounts[panId];
            const be = pansById[panId];
            const geoP = geoById[panId];
            const geoCell = !geodesicResult.available ? '<span style="color:#9ca3af;">n/d</span>'
                : (geoP && geoP.skipped) ? '<span style="color:#9ca3af;">n/d</span>'
                : (geoP ? geoP.panelCount : '-');
            if (be && be.skipped) {
                return `<tr><td>${panId}</td><td>${jsCount ?? '-'}</td><td colspan="3" style="color:#92400e;">non supporté — ${be.reason || be.poseMode}</td></tr>`;
            }
            const localCount = be ? be.panelCount : null;
            const useGeo = authority[panId] === 'geodesic';
            const authoritativeCount = useGeo ? (geoP && geoP.panelCount) : localCount;
            const match = be && jsCount === authoritativeCount;
            const wasReplaced = replacedSet.has(panId);
            const style = match ? 'color:#166534;' : (wasReplaced ? 'color:#6d28d9; font-weight:700;' : 'color:#b91c1c; font-weight:700;');
            const label = match ? '✓ identique' : (wasReplaced ? `↻ remplacé (${useGeo ? 'pyproj' : 'local'})` : '✗ écart');
            return `<tr><td>${panId}</td><td>${jsCount ?? '-'}</td><td>${localCount ?? '-'}</td><td>${geoCell}</td><td style="${style}">${label}</td></tr>`;
        }).join('');

        const jsTotal = Object.values(jsCounts).reduce((s, v) => s + (v || 0), 0);
        const totalMatch = jsTotal === backendResult.totalPanelCount;

        el.innerHTML = `
            <div style="background:#7c3aed; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
                <strong>Vérif Python (diagnostic temporaire)</strong>
                <button id="cmVerifTestCloseBtn" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer; line-height:1;">&times;</button>
            </div>
            <div style="padding:12px 16px;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="text-align:left; border-bottom:1px solid #e5e7eb;">
                            <th style="padding:4px 6px;">Pan</th><th style="padding:4px 6px;">JS</th><th style="padding:4px 6px;">Python (local)</th><th style="padding:4px 6px;">Python (pyproj)</th><th style="padding:4px 6px;">Statut</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #7c3aed; font-weight:700;">
                            <td style="padding:6px;">Total</td><td style="padding:6px;">${jsTotal}</td><td style="padding:6px;">${backendResult.totalPanelCount}</td>
                            <td style="padding:6px;">${geodesicResult.available ? geodesicResult.totalPanelCount : 'n/d'}</td>
                            <td style="padding:6px; ${totalMatch ? 'color:#166534;' : 'color:#b91c1c;'}">${totalMatch ? '✓' : '✗'}</td>
                        </tr>
                    </tfoot>
                </table>
                ${!geodesicResult.available ? `<p style="color:#92400e; font-size:0.8rem; margin-top:8px;">Vérification géodésique (pyproj) indisponible : ${geodesicResult.reason || 'coordonnées géographiques manquantes (maison basée sur une image importée ?)'}</p>` : ''}
                ${backendResult.anyUnsupported ? '<p style="color:#92400e; font-size:0.8rem; margin-top:8px;">Au moins un pan n\'a pas pu être vérifié (voir le détail dans la colonne Statut).</p>' : ''}
                ${!totalMatch ? `
                    <div style="margin-top:12px; padding-top:10px; border-top:1px dashed #d1d5db;">
                        <p style="font-size:0.78rem; color:#6b7280; margin:0 0 6px;">
                            Écart détecté — les panneaux du/des pan(s) concerné(s) ont été remplacés par le résultat Python (le calepinage a été mis à jour à l'écran). Pour investiguer la cause de l'écart, copiez les données ci-dessous et transmettez-les.
                        </p>
                        <button id="cmVerifTestCopyBtn" style="background:#fff; color:#7c3aed; border:1px solid #7c3aed; border-radius:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; cursor:pointer;">Copier les données (debug)</button>
                        <span id="cmVerifTestCopyStatus" style="font-size:0.75rem; color:#166534; margin-left:8px;"></span>
                    </div>
                ` : ''}
            </div>
        `;
        el.querySelector('#cmVerifTestCloseBtn').addEventListener('click', () => { el.style.display = 'none'; });
        const copyBtn = el.querySelector('#cmVerifTestCopyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const debugBlob = JSON.stringify({ state: payload, jsCounts, backendResult }, null, 2);
                const status = el.querySelector('#cmVerifTestCopyStatus');
                navigator.clipboard.writeText(debugBlob)
                    .then(() => { if (status) status.textContent = 'Copié ✓'; })
                    .catch(() => { if (status) status.textContent = 'Échec de la copie — voir la console.'; console.log(debugBlob); });
            });
        }
        el.style.display = 'block';
    }

    function renderError(message) {
        const el = ensureOverlay();
        el.innerHTML = `
            <div style="background:#b91c1c; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
                <strong>Vérif Python — échec</strong>
                <button id="cmVerifTestCloseBtn" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer; line-height:1;">&times;</button>
            </div>
            <div style="padding:12px 16px;">${message}</div>
        `;
        el.querySelector('#cmVerifTestCloseBtn').addEventListener('click', () => { el.style.display = 'none'; });
        el.style.display = 'block';
    }

    // `silentIfEmpty` : appelé automatiquement depuis "Ouvrir le dimensionnement"/"Calculer et
    // visualiser" (cf. wireAutoTrigger ci-dessous) — n'affiche jamais d'erreur si aucun contour
    // n'est tracé (ces 2 boutons sont cliqués quelle que soit la typologie/l'état du projet, pas
    // seulement quand une maison est en cours d'édition). Le clic manuel sur "Vérif Python (test)"
    // reste bruyant (renderError) : dans ce cas, l'utilisateur s'attend explicitement à un résultat.
    function runVerification(options) {
        const silentIfEmpty = !!(options && options.silentIfEmpty);
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || !CM.state || !CM.state.pans || !CM.state.pans.length) {
            if (!silentIfEmpty) renderError('Aucun pan à vérifier (contour non tracé).');
            return;
        }
        const jsCounts = computeJsCountsPerPan(CM.state);
        const payload = buildVerifPayload(CM.state);
        // inclure_positions:true à chaque appel (coût de sérialisation acceptable pour un
        // diagnostic déclenché sur clic, pas en continu) — nécessaire pour pouvoir remplacer
        // immédiatement un pan en écart, sans un 2e aller-retour réseau une fois l'écart constaté.
        fetch('/concevoir_mon_projet/calepinage-maison/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: payload, inclure_positions: true }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (!res.success) { renderError(res.message || 'Erreur de vérification inconnue.'); return; }
                const { replacedPanIds, authorityByPanId } = applyOverridesFromResult(CM.state, jsCounts, res, res.geodesic);
                renderResults(jsCounts, res, payload, replacedPanIds, authorityByPanId);
            })
            .catch((err) => renderError(String(err)));
    }

    // NOUVEAU (demande explicite : "lance le branchement aux boutons. On garde le modal de
    // comparaison. Je veux tester plusieurs scénarios avant de fermer") : déclenche automatiquement
    // ce même diagnostic à chaque "Ouvrir le dimensionnement" / "Système" / "Calculer et
    // Visualiser" — les 3 convergent vers LA MÊME méthode window.summaryModalInstance.showSummary()
    // (cf. ButtonControl.js et menu_list.html::openDimensionnementModal) : l'envelopper UNE SEULE
    // FOIS ici couvre les 3 sans toucher à aucun de ces 2 fichiers (même principe déjà établi dans
    // ce projet — cf. wrapRunSimulationForGainAnnuel, ResidentielEtudeEcoView.js). N'affiche le
    // popup que pour un projet Résidentielle avec une maison réellement chargée (CM.state.pans) —
    // ne fait RIEN pour le Pro/Grand-projet, dont le mécanisme de correction (CalepinageCorrection)
    // reste totalement inchangé et indépendant.
    //
    // Remplacement (demande explicite : "mettre en place le remplacement des panneaux si les
    // résultats sont différents ; s'ils sont identiques, on ne change rien") : un pan résidentiel
    // n'ayant pas de liste de panneaux persistée (toujours recalculée à la volée depuis
    // pan.points/angle, cf. computeCandidatePanelSlots), le "remplacement" consiste à faire du
    // résultat backend la source de CM.packPanelsForPan pour ce pan (cf. wrapPackPanelsForPanForOverride
    // ci-dessus) — géodésique en priorité (le plus rigoureux), mètres locaux en repli.
    //
    // Le popup ne se ferme jamais tout seul entre 2 déclenchements successifs : si l'utilisateur le
    // laisse ouvert et reclique sur l'un de ces boutons (autre maison, autre configuration), son
    // contenu est simplement remplacé par le nouveau résultat — fermeture uniquement manuelle (×).
    function wireAutoTrigger() {
        const instance = window.summaryModalInstance;
        if (!instance || typeof instance.showSummary !== 'function') {
            setTimeout(wireAutoTrigger, 500);
            return;
        }
        if (instance.showSummary.__cmVerifAutoTriggerWrapped) return;
        const original = instance.showSummary.bind(instance);
        instance.showSummary = async function (...args) {
            const result = await original(...args);
            if (window.isResidentialPath()) {
                runVerification({ silentIfEmpty: true });
            }
            return result;
        };
        instance.showSummary.__cmVerifAutoTriggerWrapped = true;
    }

    // Demande explicite : bouton "Vérif Python (test)" MASQUÉ dans l'en-tête du modal Calepinage
    // Maison. Passer à true pour le réafficher (diagnostic manuel). La vérification automatique
    // (wireAutoTrigger) et le remplacement des pans en écart restent actifs.
    const AFFICHER_BOUTON_VERIF_PYTHON = false;

    function injectButtonWhenReady() {
        if (!AFFICHER_BOUTON_VERIF_PYTHON) return;
        const CM = window.CalepinageMaisonIndiv;
        const closeBtn = CM && CM.modal && CM.modal.querySelector('#closeCalepinageMaisonBtn');
        // Déjà injecté : on s'arrête (auparavant la boucle continuait toutes les 500 ms indéfiniment).
        if (document.getElementById('cmVerifTestBtn')) return;
        if (!closeBtn) {
            setTimeout(injectButtonWhenReady, 500);
            return;
        }
        const btn = document.createElement('button');
        btn.id = 'cmVerifTestBtn';
        btn.textContent = 'Vérification croisée (test)';
        btn.title = 'Diagnostic temporaire : compare le nombre de panneaux à une vérification indépendante';
        btn.style.cssText = 'background:#7c3aed; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; cursor:pointer; margin-right:10px;';
        btn.addEventListener('click', () => runVerification());
        closeBtn.insertAdjacentElement('beforebegin', btn);
    }

    injectButtonWhenReady();
    wireAutoTrigger();
    wrapPackPanelsForPanForOverride();
})();
