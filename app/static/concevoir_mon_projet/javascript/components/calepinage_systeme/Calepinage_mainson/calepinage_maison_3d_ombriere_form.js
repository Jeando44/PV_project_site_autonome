/**
 * Calepinage résidentiel — fenêtre de personnalisation des ombrières 3D (métal / bois).
 *
 * PORTAGE du formulaire ombrière de geometrie_3D/test_3d.html (readParams / updateModelFieldsVisibility
 * / updateBoisFieldsVisibility + boutons de modèle + bascule porte-à-faux sym/asym), restreint aux
 * deux familles « ombrière métal » et « ombrière bois » — pas de sélecteur « Type de structure »,
 * pas de bâtiment métal ni petit champ solaire, pas de section « Position sur la carte ».
 *
 * Les classes Tailwind du markup d'origine sont remplacées par une petite feuille de style scoppée
 * (#cmOmbFormStyle), injectée une fois. Tous les IDs sont préfixés « cmOmb_ » pour ne jamais entrer
 * en collision avec la modale du calepinage résidentiel.
 *
 * Points d'entrée exposés sur window.CalepinageMaisonIndiv (CM) :
 *   - CM.isOmbriereFamilyKey(typeKey)          -> true pour "metal_*" / "bois_*"
 *   - CM.ombriereFamilyModel(typeKey)          -> { family:'metal'|'bois', postModel:string }
 *   - CM.getOmbriereDefaults(family)           -> instantané COMPLET des valeurs par défaut du
 *                                                formulaire (remplace le readParams() de test_3d.html,
 *                                                indisponible ici) ; mémoïsé par famille.
 *   - CM.renderOmbriereForm(hostEl, objId, {onClose, onDelete})
 *                                              -> rend le formulaire dans hostEl (la modale centrée
 *                                                du viewer) et le câble sur CM.updateSceneObject3D.
 *
 * Le rendu 3D lui-même reste fait par calepinage_maison_3d_viewer.js, qui route
 * o.params.structureType vers window.buildOmbriere3D / window.buildOmbriereBois3D.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    // --- familles / modèles -------------------------------------------------------------------

    function isOmbriereFamilyKey(typeKey) {
        return typeof typeKey === 'string' && (typeKey.indexOf('metal_') === 0 || typeKey.indexOf('bois_') === 0);
    }
    function ombriereFamilyModel(typeKey) {
        const i = String(typeKey || '').indexOf('_');
        if (i < 0) return { family: 'metal', postModel: 'single' };
        return { family: typeKey.slice(0, i), postModel: typeKey.slice(i + 1) };
    }

    const METAL_MODELS = [
        { k: 'single', l: 'Centrés' }, { k: 'offset', l: 'Excentrés' }, { k: 'double', l: 'Double Poteaux' },
        { k: 'inclinedPost', l: 'Poteaux Inclinés' }, { k: 'linked', l: 'Centrés liaisonnés' },
        { k: 'y_shape', l: 'Toiture Y' }, { k: 'doubleYShape', l: 'Double toiture Y' },
    ];
    const BOIS_MODELS = [
        { k: 'inclinedPost', l: 'Gd. Monopan' }, { k: 'y_shape', l: 'Est-Ouest' }, { k: 'double', l: '2 poteaux (5m)' },
        { k: 'simple_azelan', l: 'Azélan' }, { k: 'simple_travolta', l: 'Travolta' }, { k: 'simple_travolta_2', l: 'Travolta-2' },
    ];

    // Entraxe par défaut par modèle métal (champ #postSpacing partagé — cf. test_3d.html).
    const POST_SPACING_DEFAULTS = { double: 4.0, linked: 15.0 };
    const POST_SPACING_INCLINED_DEFAULT = 3.0;

    // --- feuille de style scoppée -----------------------------------------------------------

    function ensureStyle() {
        if (document.getElementById('cmOmbFormStyle')) return;
        const st = document.createElement('style');
        st.id = 'cmOmbFormStyle';
        st.textContent = `
        .cmOmb-wrap{display:flex;flex-direction:column;max-height:82vh;}
        .cmOmb-head{flex:0 0 auto;background:#dc2626;color:#fff;padding:10px 14px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:center;}
        .cmOmb-head strong{font-size:14px;}
        .cmOmb-head button{background:none;border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer;}
        .cmOmb-body{flex:1 1 auto;min-height:0;padding:12px 14px;overflow-y:auto;}
        .cmOmb-foot{flex:0 0 auto;padding:10px 14px 14px;display:flex;justify-content:space-between;gap:8px;}
        .cmOmb-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;}
        .cmOmb-grid>.cs2,.cmOmb-grid>.cmOmb-grid,.cmOmb-grid>.cmOmb-sec{grid-column:1/-1;}
        .cmOmb-field{display:flex;flex-direction:column;}
        .cmOmb-field>label{font-size:11px;font-weight:700;color:#374151;margin-bottom:2px;}
        .cmOmb-field input[type=number],.cmOmb-field input[type=text],.cmOmb-field select{
            width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;color:#111;}
        .cmOmb-field input[readonly]{background:#f3f4f6;color:#6b7280;cursor:not-allowed;}
        .cmOmb-field input[type=color]{width:100%;height:28px;padding:1px;border:1px solid #d1d5db;border-radius:4px;}
        .cmOmb-check{flex-direction:row;align-items:center;gap:6px;font-size:12px;color:#374151;}
        .cmOmb-check input{width:auto;}
        .cmOmb-btnrow{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;}
        .cmOmb-btnrow button{flex:1 1 auto;min-width:64px;font-size:11px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;background:#f5f5f5;color:#333;cursor:pointer;}
        .cmOmb-btnrow button.on{background:#dc2626;color:#fff;border-color:#dc2626;}
        .cmOmb-sec{font-size:12px;font-weight:800;color:#111;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:12px 0 8px;cursor:pointer;user-select:none;display:flex;justify-content:space-between;}
        .cmOmb-hidden{display:none!important;}
        .cmOmb-btn{padding:6px 12px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;cursor:pointer;background:#f5f5f5;color:#333;}
        .cmOmb-btn.danger{background:#fef2f2;color:#991b1b;border-color:#fecaca;}
        .cmOmb-btn.primary{background:#dc2626;color:#fff;border-color:#dc2626;}
        `;
        document.head.appendChild(st);
    }

    // --- markup ---------------------------------------------------------------------------------

    function num(id, label, value, step, cls) {
        return `<div class="cmOmb-field ${cls || ''}" id="${id}Field"><label>${label}</label>`
            + `<input type="number" id="${id}" value="${value}" step="${step != null ? step : 0.01}"></div>`;
    }
    function txt(id, label, value, cls) {
        // inputmode="text" + spellcheck/autocomplete off : garantit qu'un contenu type "6*5" n'est
        // jamais coercé par le navigateur (bug rapporté "6*5 devient 65").
        // data-saisie-libre : exclut le champ du filtre de caractères posé sur document.body par
        // liste_de_materiels.js, qui retirait à la frappe les '*' et '+' des expressions d'entraxes
        // (« 4*5+7 » devenait « 457 ») — CAUSE RÉELLE du bug rapporté sur ce formulaire. La validation
        // de ces champs leur est propre (cf. CM.validerEntraxeOmbriere).
        return `<div class="cmOmb-field ${cls || ''}" id="${id}Field"><label>${label}</label>`
            + `<input type="text" inputmode="text" data-saisie-libre="expression" autocomplete="off" spellcheck="false" id="${id}" value="${value}"></div>`;
    }
    function col(id, label, value, cls) {
        return `<div class="cmOmb-field ${cls || ''}" id="${id}Field"><label>${label}</label>`
            + `<input type="color" id="${id}" value="${value}"></div>`;
    }
    function chk(id, label, checked, cls) {
        return `<div class="cmOmb-field cmOmb-check ${cls || ''}" id="${id}Field">`
            + `<input type="checkbox" id="${id}"${checked ? ' checked' : ''}><label style="margin:0;font-weight:600;">${label}</label></div>`;
    }
    function btnRow(id, items, activeKey, dataAttr) {
        return `<div class="cmOmb-btnrow" id="${id}">` + items.map((it) =>
            `<button type="button" data-${dataAttr}="${it.k}" class="${it.k === activeKey ? 'on' : ''}">${it.l}</button>`).join('') + `</div>`;
    }

    // Champs communs métal — un sous-ensemble fidèle de test_3d.html (modelSpecificFields +
    // grilles principales + Géométrie matériels + couleurs/toggles).
    function metalFieldsHtml(postModel) {
        return `
        <div class="cmOmb-field cs2"><label>Modèle de poteaux</label>${btnRow('cmOmb_modelGroup', METAL_MODELS, postModel, 'model')}</div>
        <div class="cmOmb-grid cs2" id="cmOmb_modelSpecificFields">
            ${num('cmOmb_postEccentricity', 'Excentrement (m)', 2.0, 0.01)}
            ${num('cmOmb_postSpacing', 'Entraxe (m)', 15.0, 0.1)}
            ${num('cmOmb_linkedPanelsCount', 'Nbre de pans de toiture', 2, 1)}
            ${num('cmOmb_doubleYShapePanelsCount', "Nbre d'ombrières", 2, 1)}
            ${num('cmOmb_postSpacingInclined', 'Entraxe poteaux inclinés (m)', 3.0, 0.1)}
            ${num('cmOmb_postInclinationInclined', 'Inclinaison poteaux (°)', 65, 1)}
        </div>
        <div class="cmOmb-field cs2" id="cmOmb_doublePostBracingField"><label>Variante contreventement (Double poteaux)</label>
            ${btnRow('cmOmb_bracingVariantGroup', [{ k: 'v1', l: 'V1' }, { k: 'v2', l: 'V2' }, { k: 'v3', l: 'V3' }, { k: 'v4', l: 'V4' }, { k: 'v5', l: 'V5' }, { k: 'v6', l: 'V6' }], 'v1', 'variant')}
            ${chk('cmOmb_showDoubleBracing', 'Afficher contreventement', true)}
        </div>
        <div class="cmOmb-field cs2"><label>Type de soutien</label>
            ${btnRow('cmOmb_reinforcementGroup', [{ k: 'bracons', l: 'Bracons' }, { k: 'jarrets', l: 'Jarrets' }], 'bracons', 'reinforcement')}</div>

        <div class="cmOmb-grid cs2">
            ${num('cmOmb_panelWidth', 'Largeur champ PV (m) — plan', 12.40, 0.1)}
            ${num('cmOmb_facadeLength', 'Longueur façade (m) — plan', 39, 0.1)}
            ${num('cmOmb_leftOverhang', 'P-à-f Gauche (m)', 1, 0.1)}
            ${num('cmOmb_rightOverhang', 'P-à-f Droit (m)', 2, 0.1)}
            ${txt('cmOmb_postDistances', 'Entraxes poteaux (ex. « 4*6 7 » = 4 travées de 6 m + 1 de 7 m)', '3*10 6', 'cs2')}
            ${num('cmOmb_postWidth', 'Épaisseur poteau (m)', 0.30, 0.01)}
            ${num('cmOmb_lowPointHeight', 'Hauteur égout (m)', 3.31, 0.01)}
            ${num('cmOmb_roofSlope', 'Pente toiture (°) — plan', 8, 1)}
            ${num('cmOmb_heightUnderBrace', 'Hauteur sous bracon (m)', 2.80, 0.01)}
            <div class="cmOmb-field cs2"><label>Porte-à-faux toiture F/G</label>
                ${btnRow('cmOmb_overhangTypeGroup', [{ k: 'sym', l: 'Symétrique' }, { k: 'asym', l: 'Asymétrique' }], 'sym', 'overhang')}</div>
            ${num('cmOmb_overhangSym', 'PF symétrique (m)', 0.5, 0.05)}
            ${num('cmOmb_overhangF', 'PF faîtage - H (m)', 0.2, 0.05)}
            ${num('cmOmb_overhangG', 'PF gouttière - B (m)', 0.6, 0.05)}
        </div>

        <div class="cmOmb-sec" id="cmOmb_matToggle"><span>Géométrie matériels</span><span>▾</span></div>
        <div class="cmOmb-grid cs2 cmOmb-hidden" id="cmOmb_matFields">
            ${num('cmOmb_beamHeight', 'Épaisseur traverse (m)', 0.15, 0.01)}
            ${num('cmOmb_beamWidth', 'Largeur traverse (m)', 0.10, 0.01)}
            ${num('cmOmb_purlinHeight', 'Épaisseur pannes (m)', 0.30, 0.01)}
            ${num('cmOmb_purlinCount', 'Nombre de pannes', 6, 1)}
            ${num('cmOmb_panelThickness', 'Épaisseur panneaux (m)', 0.03, 0.01)}
            ${num('cmOmb_integrationSystemHeight', 'Ht. système intégration (m)', 0.1, 0.01)}
            ${num('cmOmb_integrationSystemWidth', 'Lag. système intégration (m)', 0.06, 0.01)}
            ${num('cmOmb_braceWidth', 'Épaisseur bracons (m)', 0.10, 0.01)}
            ${num('cmOmb_braceFixPercentage', 'Fixation bracon (%)', 70, 1)}
        </div>

        <div class="cmOmb-grid cs2">
            ${txt('cmOmb_pvLayout', 'Disposition des panneaux (ex: 7LX40C)', '7LX40C', 'cs2')}
            ${col('cmOmb_structureColor', 'Couleur structure', '#8c929a')}
            ${col('cmOmb_panelColor', 'Couleur panneaux', '#1e293b')}
            ${chk('cmOmb_invertSlope', 'Inverser pente', false)}
            ${chk('cmOmb_hideRails', 'Masquer les rails', false)}
            ${chk('cmOmb_hidePanels', 'Masquer les panneaux', false)}
            ${chk('cmOmb_showAnchors', 'Afficher les ancrages au sol', false)}
        </div>`;
    }

    function boisFieldsHtml(postModel) {
        return `
        <div class="cmOmb-field cs2"><label>Modèle de poteaux (bois)</label>${btnRow('cmOmb_modelGroup', BOIS_MODELS, postModel, 'model')}</div>
        <div class="cmOmb-grid cs2" id="cmOmb_modelSpecificFieldsBois">
            ${num('cmOmb_passageHeightBois', 'Hauteur libre de passage (m)', 2.8, 0.01)}
            ${num('cmOmb_postSpacingInclinedBois', 'Entraxe (m)', 2.30, 0.01)}
            ${num('cmOmb_postSpacingBois', 'Entraxe (m)', 1.92, 0.01)}
            ${num('cmOmb_postSpacingOffsetBois', 'Entraxe (m)', 1.80, 0.01)}
            ${num('cmOmb_postSpacingAzelan', 'Entraxe (m)', 1.92, 0.01)}
            ${num('cmOmb_postSpacingTravolta', 'Entraxe (m)', 1.92, 0.01)}
            ${num('cmOmb_postOffsetTravolta', 'Porte-à-faux poteau/traverse (m)', 1.0, 0.01)}
            ${num('cmOmb_postEccentricityBois', 'Excentrement (m)', 2.0, 0.01)}
            <div class="cmOmb-field" id="cmOmb_offsetPostSideBoisField"><label>Position Poteau</label>
                ${btnRow('cmOmb_offsetSideGroupBois', [{ k: 'low', l: 'Bas' }, { k: 'center', l: 'Centré' }, { k: 'high', l: 'Haut' }], 'low', 'side')}</div>
            ${num('cmOmb_postInclinationBois', 'Inclinaison poteaux (°)', 65, 0.1)}
            ${chk('cmOmb_hideCentralPostBois', 'Masquer poteau central', true)}
            ${num('cmOmb_bracingPositionBois', 'Position contreventement (%)', 100, 1)}
            ${num('cmOmb_braceThicknessBois', 'Épaisseur contreventement (cm)', 25, 1)}
            ${num('cmOmb_postBracePercent', '% renfort Long poteau', 60, 1)}
            ${num('cmOmb_purlinBracePercent', '% renfort Long panne', 80, 1)}
            <div class="cmOmb-field cs2"><label>Position Contreventement</label>
                <div class="cmOmb-btnrow" style="gap:14px;">
                    <label class="cmOmb-check" style="flex:0;"><input type="checkbox" id="cmOmb_contreventementF1" checked> F1-Poteaux</label>
                    <label class="cmOmb-check" style="flex:0;"><input type="checkbox" id="cmOmb_contreventementF2" checked> F2-Poteaux</label>
                </div></div>
            <div class="cmOmb-field cs2"><label>Position Panne</label>
                ${btnRow('cmOmb_purlinsPositionGroupBois', [{ k: 'side', l: 'Côté' }, { k: 'top', l: 'Dessus' }], 'side', 'purlins-position')}</div>
        </div>
        <div class="cmOmb-field cs2"><label>Type de soutien</label>
            ${btnRow('cmOmb_reinforcementGroup', [{ k: 'bracons', l: 'Bracons' }, { k: 'jarrets', l: 'Jarrets' }], 'bracons', 'reinforcement')}</div>

        <div class="cmOmb-grid cs2">
            ${num('cmOmb_panelWidth', 'Largeur champ PV (m) — plan', 12.40, 0.1)}
            ${num('cmOmb_facadeLength', 'Longueur façade (m) — plan', 39, 0.1)}
            ${num('cmOmb_leftOverhang', 'P-à-f Gauche (m)', 1, 0.1)}
            ${num('cmOmb_rightOverhang', 'P-à-f Droit (m)', 2, 0.1)}
            ${txt('cmOmb_postDistances', 'Entraxes poteaux (ex. « 4*6 7 » = 4 travées de 6 m + 1 de 7 m)', '3*10 6', 'cs2')}
            ${num('cmOmb_postWidth', 'Épaisseur poteau (m)', 0.30, 0.01)}
            ${num('cmOmb_lowPointHeight', 'Hauteur égout (m)', 3.31, 0.01)}
            ${num('cmOmb_roofSlope', 'Pente toiture (°) — plan', 8, 1)}
            <div class="cmOmb-field cs2"><label>Porte-à-faux toiture F/G</label>
                ${btnRow('cmOmb_overhangTypeGroup', [{ k: 'sym', l: 'Symétrique' }, { k: 'asym', l: 'Asymétrique' }], 'sym', 'overhang')}</div>
            ${num('cmOmb_overhangSym', 'PF symétrique (m)', 0.5, 0.05)}
            ${num('cmOmb_overhangF', 'PF faîtage - H (m)', 0.2, 0.05)}
            ${num('cmOmb_overhangG', 'PF gouttière - B (m)', 0.6, 0.05)}
        </div>

        <div class="cmOmb-sec" id="cmOmb_matToggle"><span>Géométrie matériels</span><span>▾</span></div>
        <div class="cmOmb-grid cs2 cmOmb-hidden" id="cmOmb_matFields">
            ${num('cmOmb_beamHeight', 'Épaisseur traverse (m)', 0.40, 0.01)}
            ${num('cmOmb_beamWidth', 'Largeur traverse (m)', 0.10, 0.01)}
            ${num('cmOmb_purlinHeight', 'Épaisseur pannes (m)', 0.30, 0.01)}
            ${num('cmOmb_purlinWidthBois', 'Largeur panne (m)', 0.10, 0.01)}
            ${num('cmOmb_purlinCount', 'Nombre de pannes', 6, 1)}
            ${num('cmOmb_panelThickness', 'Épaisseur panneaux (m)', 0.03, 0.01)}
            ${num('cmOmb_integrationSystemHeight', 'Ht. système intégration (m)', 0.1, 0.01)}
            ${num('cmOmb_integrationSystemWidth', 'Lag. système intégration (m)', 0.06, 0.01)}
            ${num('cmOmb_braceWidth', 'Épaisseur bracons (m)', 0.10, 0.01)}
            ${num('cmOmb_braceFixPercentage', 'Fixation bracon (%)', 70, 1)}
        </div>

        <div class="cmOmb-grid cs2">
            ${txt('cmOmb_pvLayout', 'Disposition des panneaux (ex: 7LX40C)', '7LX40C', 'cs2')}
            ${col('cmOmb_structureColorBois', 'Couleur charpente bois', '#A0522D')}
            ${col('cmOmb_integrationColorBois', "Couleur système d'intégration", '#d1d5db')}
            ${col('cmOmb_panelColorBois', 'Couleur panneaux', '#1e293b')}
            ${chk('cmOmb_invertSlope', 'Inverser pente', false)}
            ${chk('cmOmb_hideRails', 'Masquer les rails', false)}
            ${chk('cmOmb_hidePanels', 'Masquer les panneaux', false)}
            ${chk('cmOmb_showAnchors', 'Afficher les ancrages au sol', true)}
        </div>`;
    }

    function formBodyHtml(family, postModel) {
        return family === 'bois' ? boisFieldsHtml(postModel) : metalFieldsHtml(postModel);
    }

    // --- lecture des champs -> params (équivalent readParams() de test_3d.html) --------------

    function readOmbriereParams(root, family, postModel) {
        const q = (id) => root.querySelector('#' + id);
        const n = (id) => { const el = q(id); return el ? parseFloat(String(el.value).replace(',', '.')) : undefined; };
        const s = (id) => { const el = q(id); return el ? el.value : undefined; };
        const c = (id) => { const el = q(id); return !!(el && el.checked); };
        const on = (groupId, dataAttr) => {
            const el = root.querySelector('#' + groupId + ' button.on');
            return el ? el.getAttribute('data-' + dataAttr) : undefined;
        };
        const p = {
            structureType: family,
            postModel: postModel,
            facadeLength: n('cmOmb_facadeLength'),
            panelWidth: n('cmOmb_panelWidth'),
            roofSlope: n('cmOmb_roofSlope'),
            leftOverhang: n('cmOmb_leftOverhang'),
            rightOverhang: n('cmOmb_rightOverhang'),
            // Expression d'entraxes : rendue TELLE QUELLE, sans nettoyage ni conversion.
            // CORRECTIF (bug rapporté : "le champ refuse le * et le +") : un `replace` retirait ici
            // silencieusement les caractères jugés indésirables — une saisie légèrement hors du jeu
            // prévu (espace insécable d'un copier-coller, séparateur exotique) ressortait donc
            // recollée en un nombre absurde ("7*7 + 7" -> "77 7"), sans le moindre message. La
            // validation est désormais faite en UN SEUL endroit, partagé avec le formulaire 2D et
            // les modales de géométrie (CM.validerEntraxeOmbriere), et une saisie invalide est
            // REJETÉE avec un message au lieu d'être corrigée à l'aveugle.
            postDistances: s('cmOmb_postDistances'),
            postWidth: n('cmOmb_postWidth'),
            lowPointHeight: n('cmOmb_lowPointHeight'),
            beamHeight: n('cmOmb_beamHeight'),
            beamWidth: n('cmOmb_beamWidth'),
            purlinHeight: n('cmOmb_purlinHeight'),
            purlinCount: n('cmOmb_purlinCount'),
            panelThickness: n('cmOmb_panelThickness'),
            integrationSystemHeight: n('cmOmb_integrationSystemHeight'),
            integrationSystemWidth: n('cmOmb_integrationSystemWidth'),
            heightUnderBrace: n('cmOmb_heightUnderBrace'),
            braceWidth: n('cmOmb_braceWidth'),
            braceFixPercentage: n('cmOmb_braceFixPercentage'),
            pvLayout: s('cmOmb_pvLayout'),
            overhangType: on('cmOmb_overhangTypeGroup', 'overhang') || 'sym',
            overhangSym: n('cmOmb_overhangSym'),
            overhangF: n('cmOmb_overhangF'),
            overhangG: n('cmOmb_overhangG'),
            invertSlope: c('cmOmb_invertSlope'),
            hideRails: c('cmOmb_hideRails'),
            hidePanels: c('cmOmb_hidePanels'),
            showAnchors: c('cmOmb_showAnchors'),
            reinforcementType: on('cmOmb_reinforcementGroup', 'reinforcement') || 'bracons',
        };
        if (family === 'metal') {
            p.postEccentricity = n('cmOmb_postEccentricity');
            p.postSpacing = n('cmOmb_postSpacing');
            p.linkedPanelsCount = n('cmOmb_linkedPanelsCount');
            p.doubleYShapePanelsCount = n('cmOmb_doubleYShapePanelsCount');
            p.postSpacingInclined = n('cmOmb_postSpacingInclined');
            p.postInclinationInclined = n('cmOmb_postInclinationInclined');
            p.doublePostBracing = on('cmOmb_bracingVariantGroup', 'variant') || 'v1';
            p.showDoubleBracing = c('cmOmb_showDoubleBracing');
            p.structureColor = s('cmOmb_structureColor');
            p.panelColor = s('cmOmb_panelColor');
        } else {
            p.passageHeight = n('cmOmb_passageHeightBois');
            p.postSpacingInclined = n('cmOmb_postSpacingInclinedBois');
            p.postSpacing = n('cmOmb_postSpacingBois');
            p.postSpacingOffset = n('cmOmb_postSpacingOffsetBois');
            p.postSpacingAzelan = n('cmOmb_postSpacingAzelan');
            p.postSpacingTravolta = n('cmOmb_postSpacingTravolta');
            p.postOffsetTravolta = n('cmOmb_postOffsetTravolta');
            p.postEccentricity = n('cmOmb_postEccentricityBois');
            p.offsetPostSide = on('cmOmb_offsetSideGroupBois', 'side') || 'low';
            p.postInclination = n('cmOmb_postInclinationBois');
            p.hideCentralPost = c('cmOmb_hideCentralPostBois');
            p.bracingPosition = n('cmOmb_bracingPositionBois');
            p.braceThickness = n('cmOmb_braceThicknessBois');
            p.postBracePercent = n('cmOmb_postBracePercent');
            p.purlinBracePercent = n('cmOmb_purlinBracePercent');
            p.contreventementF1 = c('cmOmb_contreventementF1');
            p.contreventementF2 = c('cmOmb_contreventementF2');
            p.purlinsPosition = on('cmOmb_purlinsPositionGroupBois', 'purlins-position') || 'side';
            p.purlinWidth = n('cmOmb_purlinWidthBois');
            p.structureColor = s('cmOmb_structureColorBois');
            p.panelColor = s('cmOmb_panelColorBois');
            p.integrationColor = s('cmOmb_integrationColorBois');
        }
        return p;
    }

    // --- visibilité des champs propres au modèle (porté de test_3d.html) --------------------

    function toggle(root, id, cond) {
        const el = root.querySelector('#' + id);
        if (el) el.classList.toggle('cmOmb-hidden', !cond);
    }

    function updateModelVisibility(root, family, m) {
        if (family === 'metal') {
            const showEcc = m === 'offset';
            const showSpacing = m === 'double' || m === 'linked' || m === 'doubleYShape';
            const showLinked = m === 'linked';
            const showDblY = m === 'doubleYShape';
            const showInclined = m === 'inclinedPost';
            const showDblBracing = m === 'double';
            toggle(root, 'cmOmb_postEccentricityField', showEcc);
            toggle(root, 'cmOmb_postSpacingField', showSpacing);
            toggle(root, 'cmOmb_linkedPanelsCountField', showLinked);
            toggle(root, 'cmOmb_doubleYShapePanelsCountField', showDblY);
            toggle(root, 'cmOmb_postSpacingInclinedField', showInclined);
            toggle(root, 'cmOmb_postInclinationInclinedField', showInclined);
            toggle(root, 'cmOmb_doublePostBracingField', showDblBracing);
            toggle(root, 'cmOmb_modelSpecificFields',
                showEcc || showSpacing || showLinked || showDblY || showInclined || showDblBracing);
        } else {
            toggle(root, 'cmOmb_postSpacingInclinedBoisField', m === 'inclinedPost' || m === 'y_shape');
            toggle(root, 'cmOmb_postSpacingBoisField', m === 'double');
            toggle(root, 'cmOmb_postSpacingOffsetBoisField', m === 'offset' || m === 'simple_travolta_2');
            toggle(root, 'cmOmb_postSpacingAzelanField', m === 'simple_azelan');
            toggle(root, 'cmOmb_postSpacingTravoltaField', m === 'simple_travolta');
            toggle(root, 'cmOmb_postOffsetTravoltaField', m === 'simple_travolta');
            toggle(root, 'cmOmb_postEccentricityBoisField', m === 'offset' || m === 'simple_travolta_2');
            toggle(root, 'cmOmb_offsetPostSideBoisField', m === 'offset' || m === 'simple_azelan');
            toggle(root, 'cmOmb_postInclinationBoisField', m !== 'simple_travolta_2');
            toggle(root, 'cmOmb_hideCentralPostBoisField', m === 'inclinedPost' || m === 'y_shape');
            toggle(root, 'cmOmb_bracingPositionBoisField', m === 'double' || m === 'offset' || m === 'simple_travolta_2');
        }
    }

    function updateOverhangVisibility(root) {
        const el = root.querySelector('#cmOmb_overhangTypeGroup button.on');
        const isSym = !el || el.getAttribute('data-overhang') === 'sym';
        toggle(root, 'cmOmb_overhangSymField', isSym);
        toggle(root, 'cmOmb_overhangFField', !isSym);
        toggle(root, 'cmOmb_overhangGField', !isSym);
    }

    // Pré-remplit tous les champs depuis un objet params.
    function applyParamsToForm(root, family, params) {
        const set = (id, v) => { const el = root.querySelector('#' + id); if (el && v != null && !Number.isNaN(v)) el.value = v; };
        const setChk = (id, v) => { const el = root.querySelector('#' + id); if (el) el.checked = !!v; };
        const setBtn = (groupId, dataAttr, key) => {
            if (key == null) return;
            root.querySelectorAll('#' + groupId + ' button').forEach((b) => {
                b.classList.toggle('on', b.getAttribute('data-' + dataAttr) === key);
            });
        };
        [['cmOmb_facadeLength', 'facadeLength'], ['cmOmb_panelWidth', 'panelWidth'], ['cmOmb_roofSlope', 'roofSlope'],
        ['cmOmb_leftOverhang', 'leftOverhang'], ['cmOmb_rightOverhang', 'rightOverhang'], ['cmOmb_postWidth', 'postWidth'],
        ['cmOmb_lowPointHeight', 'lowPointHeight'], ['cmOmb_heightUnderBrace', 'heightUnderBrace'],
        ['cmOmb_beamHeight', 'beamHeight'], ['cmOmb_beamWidth', 'beamWidth'], ['cmOmb_purlinHeight', 'purlinHeight'],
        ['cmOmb_purlinCount', 'purlinCount'], ['cmOmb_panelThickness', 'panelThickness'],
        ['cmOmb_integrationSystemHeight', 'integrationSystemHeight'], ['cmOmb_integrationSystemWidth', 'integrationSystemWidth'],
        ['cmOmb_braceWidth', 'braceWidth'], ['cmOmb_braceFixPercentage', 'braceFixPercentage'],
        ['cmOmb_overhangSym', 'overhangSym'], ['cmOmb_overhangF', 'overhangF'], ['cmOmb_overhangG', 'overhangG']].forEach(([id, k]) => set(id, params[k]));
        const setTxt = (id, v) => { const el = root.querySelector('#' + id); if (el && v != null) el.value = v; };
        setTxt('cmOmb_postDistances', params.postDistances);
        setTxt('cmOmb_pvLayout', params.pvLayout);
        setChk('cmOmb_invertSlope', params.invertSlope);
        setChk('cmOmb_hideRails', params.hideRails);
        setChk('cmOmb_hidePanels', params.hidePanels);
        setChk('cmOmb_showAnchors', params.showAnchors);
        setBtn('cmOmb_overhangTypeGroup', 'overhang', params.overhangType || 'sym');
        setBtn('cmOmb_reinforcementGroup', 'reinforcement', params.reinforcementType || 'bracons');
        if (family === 'metal') {
            set('cmOmb_postEccentricity', params.postEccentricity);
            set('cmOmb_postSpacing', params.postSpacing);
            set('cmOmb_linkedPanelsCount', params.linkedPanelsCount);
            set('cmOmb_doubleYShapePanelsCount', params.doubleYShapePanelsCount);
            set('cmOmb_postSpacingInclined', params.postSpacingInclined);
            set('cmOmb_postInclinationInclined', params.postInclinationInclined);
            setChk('cmOmb_showDoubleBracing', params.showDoubleBracing);
            setBtn('cmOmb_bracingVariantGroup', 'variant', params.doublePostBracing || 'v1');
            setTxt('cmOmb_structureColor', params.structureColor);
            setTxt('cmOmb_panelColor', params.panelColor);
        } else {
            set('cmOmb_passageHeightBois', params.passageHeight);
            set('cmOmb_postSpacingInclinedBois', params.postSpacingInclined);
            set('cmOmb_postSpacingBois', params.postSpacing);
            set('cmOmb_postSpacingOffsetBois', params.postSpacingOffset);
            set('cmOmb_postSpacingAzelan', params.postSpacingAzelan);
            set('cmOmb_postSpacingTravolta', params.postSpacingTravolta);
            set('cmOmb_postOffsetTravolta', params.postOffsetTravolta);
            set('cmOmb_postEccentricityBois', params.postEccentricity);
            set('cmOmb_postInclinationBois', params.postInclination);
            set('cmOmb_bracingPositionBois', params.bracingPosition);
            set('cmOmb_braceThicknessBois', params.braceThickness);
            set('cmOmb_postBracePercent', params.postBracePercent);
            set('cmOmb_purlinBracePercent', params.purlinBracePercent);
            set('cmOmb_purlinWidthBois', params.purlinWidth);
            setChk('cmOmb_hideCentralPostBois', params.hideCentralPost);
            setChk('cmOmb_contreventementF1', params.contreventementF1 !== false);
            setChk('cmOmb_contreventementF2', params.contreventementF2 !== false);
            setBtn('cmOmb_offsetSideGroupBois', 'side', params.offsetPostSide || 'low');
            setBtn('cmOmb_purlinsPositionGroupBois', 'purlins-position', params.purlinsPosition || 'side');
            setTxt('cmOmb_structureColorBois', params.structureColor);
            setTxt('cmOmb_panelColorBois', params.panelColor);
            setTxt('cmOmb_integrationColorBois', params.integrationColor);
        }
    }

    // --- valeurs par défaut complètes (remplace readParams() de test_3d.html) ----------------

    const _defaultsCache = {};
    function getOmbriereDefaults(family) {
        family = family === 'bois' ? 'bois' : 'metal';
        if (_defaultsCache[family]) return Object.assign({}, _defaultsCache[family]);
        ensureStyle();
        const holder = document.createElement('div');
        holder.style.display = 'none';
        const defModel = family === 'bois' ? 'inclinedPost' : 'single';
        holder.innerHTML = formBodyHtml(family, defModel);
        document.body.appendChild(holder);
        const params = readOmbriereParams(holder, family, defModel);
        document.body.removeChild(holder);
        _defaultsCache[family] = Object.assign({}, params);
        return Object.assign({}, params);
    }

    // --- rendu de la fenêtre dans la modale du viewer ---------------------------------------

    // planLock() : les 3 dimensions issues du plan 2D (verrouillées, cf. plan validé). Fournies par
    // calepinage_maison_3d_objects.js (CM.ombrierePlanDims). Repli neutre si indisponible.
    function planLock() {
        if (typeof CM.ombrierePlanDims === 'function') {
            try { return CM.ombrierePlanDims() || {}; } catch (e) { /* noop */ }
        }
        return {};
    }

    function renderOmbriereForm(host, objId, opts) {
        opts = opts || {};
        const isFormOmbriere = objId === CM.FORM_OMBRIERE_ID;
        const obj = isFormOmbriere
            ? (typeof CM.getFormOmbriereObject === 'function' ? CM.getFormOmbriereObject() : null)
            : (CM.state.sceneObjects3D || []).find((o) => o.id === objId);
        if (!obj || !host) return;
        ensureStyle();
        const fm = ombriereFamilyModel(obj.typeKey);
        let family = fm.family, postModel = (obj.params && obj.params.postModel) || fm.postModel;
        const title = (family === 'bois' ? '🪵 Ombrière bois' : '⛺ Ombrière métal');

        host.innerHTML =
            `<div class="cmOmb-wrap">
                <div class="cmOmb-head"><strong>${title}</strong><button type="button" data-cmomb="close">&times;</button></div>
                <div class="cmOmb-body"><div class="cmOmb-grid" id="cmOmb_root">${formBodyHtml(family, postModel)}</div></div>
                <div class="cmOmb-foot">
                    ${isFormOmbriere ? '<span></span>' : '<button type="button" class="cmOmb-btn danger" data-cmomb="delete">Supprimer</button>'}
                    <button type="button" class="cmOmb-btn primary" data-cmomb="close">Fermer</button>
                </div>
             </div>`;
        const root = host.querySelector('#cmOmb_root');

        // Pré-remplissage depuis l'instance puis (re)verrouillage des 3 champs "plan".
        applyParamsToForm(root, family, Object.assign({}, getOmbriereDefaults(family), obj.params || {}));
        const lock = planLock();
        [['cmOmb_facadeLength', 'facadeLength'], ['cmOmb_panelWidth', 'panelWidth'], ['cmOmb_roofSlope', 'roofSlope']].forEach(([id, k]) => {
            const el = root.querySelector('#' + id);
            if (!el) return;
            if (lock[k] != null && !Number.isNaN(lock[k])) el.value = lock[k];
            el.setAttribute('readonly', 'readonly');
            el.title = 'Dimension issue du plan 2D du calepinage (verrouillée)';
        });
        // Disposition des panneaux : grille du plan 2D (même nombre de panneaux que la carte).
        const layoutPlan = (typeof CM.pvLayoutDuPlan === 'function') ? CM.pvLayoutDuPlan(postModel) : null;
        const layoutEl = root.querySelector('#cmOmb_pvLayout');
        if (layoutEl && layoutPlan) {
            layoutEl.value = layoutPlan;
            layoutEl.setAttribute('readonly', 'readonly');
            layoutEl.title = 'Disposition issue du calepinage 2D (verrouillée)';
        }

        updateModelVisibility(root, family, postModel);
        updateOverhangVisibility(root);

        const commit = () => {
            const params = readOmbriereParams(root, family, postModel);
            // Dimensions plan : toujours réinjectées, jamais issues de la saisie.
            const l = planLock();
            if (l.facadeLength != null) params.facadeLength = l.facadeLength;
            if (l.panelWidth != null) params.panelWidth = l.panelWidth;
            if (l.roofSlope != null) params.roofSlope = l.roofSlope;
            const layout = (typeof CM.pvLayoutDuPlan === 'function') ? CM.pvLayoutDuPlan(postModel) : null;
            if (layout) params.pvLayout = layout;
            if (typeof CM.updateSceneObject3D === 'function') {
                CM.updateSceneObject3D(objId, { typeKey: family + '_' + postModel, params: params });
            }
        };
        let t = null;
        const commitSoon = () => { clearTimeout(t); t = setTimeout(commit, 250); };

        // Validation de l'expression d'entraxes : mêmes règles que le formulaire PRO et la modale
        // (valeurs > 0, max 12,50 m métal / 7,80 m bois, somme + porte-à-faux <= longueur), sauf
        // pour une ombrière posée à la main (pas de champ PV : règle de syntaxe seule).
        const validerEntraxes = (texte) => {
            const P = CM.poteauxOmbriere;
            if (P && typeof P.validerEntraxesLongitudinaux === 'function' && objId === CM.FORM_OMBRIERE_ID) {
                return P.validerEntraxesLongitudinaux(CM.state, texte, P.longueurStructure(CM.state));
            }
            return (typeof CM.validerEntraxeOmbriere === 'function') ? CM.validerEntraxeOmbriere(texte) : { ok: true };
        };
        const entraxeEl = root.querySelector('#cmOmb_postDistances');
        if (entraxeEl) {
            let msgEl = root.querySelector('#cmOmb_postDistancesError');
            if (!msgEl) {
                msgEl = document.createElement('div');
                msgEl.id = 'cmOmb_postDistancesError';
                msgEl.style.cssText = 'display:none;color:#dc3545;font-size:11px;margin-top:2px;';
                entraxeEl.parentNode.appendChild(msgEl);
            }
            entraxeEl.addEventListener('input', () => {
                const v = validerEntraxes(entraxeEl.value);
                entraxeEl.style.borderColor = v.ok ? '' : '#dc3545';
                msgEl.style.display = v.ok ? 'none' : 'block';
                msgEl.textContent = v.message || '';
            });
        }

        root.querySelectorAll('input').forEach((inp) => {
            // Les champs TEXTE (entraxes "6*5", disposition PV "7LX40C") ne commitent qu'à la
            // validation (change/blur) : sinon un recompute déclenché par un `input` en cours de
            // frappe pouvait interférer avec la saisie.
            if (inp.type === 'text') {
                inp.addEventListener('change', () => {
                    // Une expression d'entraxes invalide n'est pas envoyée à la 3D : le texte reste
                    // affiché avec son message, le modèle garde la dernière valeur valable.
                    if (inp.id === 'cmOmb_postDistances' && !validerEntraxes(inp.value).ok) return;
                    commit();
                });
            } else {
                inp.addEventListener('input', commitSoon);
                inp.addEventListener('change', commitSoon);
            }
        });

        // Boutons "Modèle de poteaux".
        root.querySelectorAll('#cmOmb_modelGroup button[data-model]').forEach((b) => {
            b.addEventListener('click', () => {
                postModel = b.getAttribute('data-model');
                root.querySelectorAll('#cmOmb_modelGroup button').forEach((x) => x.classList.toggle('on', x === b));
                if (family === 'metal' && POST_SPACING_DEFAULTS[postModel] !== undefined) {
                    const ps = root.querySelector('#cmOmb_postSpacing'); if (ps) ps.value = POST_SPACING_DEFAULTS[postModel];
                }
                if (family === 'metal' && postModel === 'inclinedPost') {
                    const pi = root.querySelector('#cmOmb_postSpacingInclined'); if (pi) pi.value = POST_SPACING_INCLINED_DEFAULT;
                }
                updateModelVisibility(root, family, postModel);
                commit();
            });
        });
        // Autres groupes de boutons (variante, soutien, position…) : activation + commit.
        root.querySelectorAll('.cmOmb-btnrow button:not([data-model])').forEach((b) => {
            b.addEventListener('click', () => {
                const grp = b.parentElement;
                grp.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
                if (grp.id === 'cmOmb_overhangTypeGroup') updateOverhangVisibility(root);
                commit();
            });
        });
        // Section repliable "Géométrie matériels".
        const mt = root.querySelector('#cmOmb_matToggle');
        if (mt) mt.addEventListener('click', () => {
            const f = root.querySelector('#cmOmb_matFields'); if (f) f.classList.toggle('cmOmb-hidden');
        });

        host.querySelectorAll('[data-cmomb="close"]').forEach((b) => b.addEventListener('click', () => {
            if (typeof opts.onClose === 'function') opts.onClose();
        }));
        const del = host.querySelector('[data-cmomb="delete"]');
        if (del) del.addEventListener('click', () => {
            if (typeof opts.onDelete === 'function') opts.onDelete(objId);
        });
    }

    Object.assign(CM, {
        isOmbriereFamilyKey,
        ombriereFamilyModel,
        getOmbriereDefaults,
        renderOmbriereForm,
    });
})();
