/**
 * Calepinage résidentiel — fenêtre de personnalisation du PETIT CHAMP SOLAIRE 3D.
 *
 * Même patron que calepinage_maison_3d_ombriere_form.js : réutilise les générateurs Babylon
 * existants de geometrie_3D/Petit_champ_solaire/ (window.buildPetitChampSolaire3D) via un objet de
 * scène synthétique (CM.getFormPetitChampObject) reconstruit à chaque rendu depuis CM.state
 * (modèle + surcharges) et calé sur l'emprise du plan 2D.
 *
 * Points d'entrée exposés sur CM :
 *   - CM.isPetitChampFamilyKey(typeKey)      -> true pour "petit_champ_solaire_*"
 *   - CM.getPetitChampDefaults()             -> instantané des valeurs par défaut du formulaire porté
 *   - CM.renderPetitChampForm(hostEl, objId, {onClose, onDelete})
 *
 * Modèles (mêmes valeurs internes que test_3d.html) : centre / excentre / double / bipente.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    const MODELS = [
        { k: 'centre', l: 'Centrés' }, { k: 'excentre', l: 'Excentrés' },
        { k: 'double', l: 'Double Poteaux' }, { k: 'bipente', l: 'Bipente' },
    ];

    function isPetitChampFamilyKey(typeKey) {
        return typeof typeKey === 'string' && typeKey.indexOf('petit_champ_solaire_') === 0;
    }

    // Réutilise la feuille de style de la fenêtre ombrière (mêmes classes .cmOmb-*). Guardé par id.
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
        .cmOmb-hidden{display:none!important;}
        .cmOmb-btn{padding:6px 12px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;cursor:pointer;background:#f5f5f5;color:#333;}
        .cmOmb-btn.danger{background:#fef2f2;color:#991b1b;border-color:#fecaca;}
        .cmOmb-btn.primary{background:#dc2626;color:#fff;border-color:#dc2626;}
        `;
        document.head.appendChild(st);
    }

    // --- markup helpers ---------------------------------------------------------------------
    function num(id, label, value, step, cls) {
        return `<div class="cmOmb-field ${cls || ''}" id="${id}Field"><label>${label}</label>`
            + `<input type="number" id="${id}" value="${value}" step="${step != null ? step : 0.01}"></div>`;
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

    function formBodyHtml(model) {
        return `
        <div class="cmOmb-field cs2"><label>Modèle de poteaux</label>${btnRow('cmPc_modelGroup', MODELS, model, 'model')}</div>
        <div class="cmOmb-grid cs2" id="cmPc_modelSpecific">
            ${num('cmPc_postEccentricity', 'Excentrement (m)', 2.0, 0.01)}
            ${num('cmPc_postSpacing', 'Entraxe poteaux double (m)', 3.0, 0.1)}
        </div>
        <div class="cmOmb-field cs2" id="cmPc_bracingVariantField"><label>Variante contreventement (Double poteaux)</label>
            ${btnRow('cmPc_bracingVariantGroup', [{ k: 'v1', l: 'V1' }, { k: 'v2', l: 'V2' }, { k: 'v3', l: 'V3' }, { k: 'v4', l: 'V4' }], 'v1', 'variant')}
            <div style="font-size:10px;color:#6b7280;margin-top:3px;line-height:1.35;">
                V1 : barre de liaison + 1 bracon (poteau haut → milieu traverse).<br>
                V2 : aucun contreventement.<br>
                V3 : 1 bracon du pied du poteau haut → milieu traverse (sans barre de liaison).<br>
                V4 : contreventement en W (4 bracons depuis les pieds des poteaux).
            </div>
        </div>
        <div class="cmOmb-field cs2"><label>Orientation des panneaux</label>
            ${btnRow('cmPc_orientationGroup', [{ k: 'portrait', l: 'Portrait' }, { k: 'paysage', l: 'Paysage' }], 'portrait', 'orientation')}</div>
        <div class="cmOmb-grid cs2">
            ${num('cmPc_facadeLength', 'Longueur (m) — plan', 20, 0.1)}
            ${num('cmPc_roofSlope', 'Pente (°) — plan', 14, 1)}
            ${num('cmPc_nbPanelsRampant', 'Nb panneaux en rampant', 2, 1)}
            ${num('cmPc_panelSpacingYMm', 'Espacement entre panneaux (mm)', 20, 1)}
            ${num('cmPc_overhangPct', 'Porte-à-faux (%)', 20, 1)}
            ${num('cmPc_lowPointHeight', 'Hauteur bas PV (m)', 0.8, 0.05)}
            ${num('cmPc_nbShed', 'Nombre de sheds', 2, 1)}
            ${num('cmPc_shedSpacing', 'Espacement entre sheds (m)', 2.5, 0.05)}
            ${num('cmPc_petitPanelLengthMm', 'Longueur panneau (mm)', 2382, 1)}
            ${num('cmPc_petitPanelWidthMm', 'Largeur panneau (mm)', 1134, 1)}
        </div>
        <div class="cmOmb-grid cs2">
            ${col('cmPc_structureColor', 'Couleur structure', '#8c929a')}
            ${col('cmPc_panelColor', 'Couleur panneaux', '#1e293b')}
            ${chk('cmPc_hidePanels', 'Masquer les panneaux', false)}
            ${chk('cmPc_showAnchors', 'Afficher les ancrages au sol', false)}
        </div>`;
    }

    // --- lecture des champs -> params (consommés par buildPetitChampSolaire3D / computePetitChampCommon) ---
    function readParams(root, model) {
        const q = (id) => root.querySelector('#' + id);
        const n = (id) => { const el = q(id); return el ? parseFloat(String(el.value).replace(',', '.')) : undefined; };
        const s = (id) => { const el = q(id); return el ? el.value : undefined; };
        const c = (id) => { const el = q(id); return !!(el && el.checked); };
        const on = (groupId, dataAttr) => {
            const el = root.querySelector('#' + groupId + ' button.on');
            return el ? el.getAttribute('data-' + dataAttr) : undefined;
        };
        return {
            structureType: 'petit_champ_solaire',
            postModelPetit: model,
            doublePostBracingVariant: on('cmPc_bracingVariantGroup', 'variant') || 'v1',
            isPaysage: (on('cmPc_orientationGroup', 'orientation') || 'portrait') === 'paysage',
            facadeLength: n('cmPc_facadeLength'),
            roofSlope: n('cmPc_roofSlope'),
            leftOverhang: 0,
            nbPanelsRampant: n('cmPc_nbPanelsRampant'),
            panelSpacingYMm: n('cmPc_panelSpacingYMm'),
            overhangPct: n('cmPc_overhangPct'),
            overhangPctPetit: n('cmPc_overhangPct'),
            lowPointHeight: n('cmPc_lowPointHeight'),
            nbShedPetit: n('cmPc_nbShed'),
            shedSpacingPetit: n('cmPc_shedSpacing'),
            petitPanelLengthMm: n('cmPc_petitPanelLengthMm'),
            petitPanelWidthMm: n('cmPc_petitPanelWidthMm'),
            postEccentricity: n('cmPc_postEccentricity'),
            postEccentricityPetit: n('cmPc_postEccentricity'),
            postSpacing: n('cmPc_postSpacing'),
            postSpacingPetit: n('cmPc_postSpacing'),
            structureColor: s('cmPc_structureColor'),
            panelColor: s('cmPc_panelColor'),
            hidePanels: c('cmPc_hidePanels'),
            showAnchors: c('cmPc_showAnchors'),
        };
    }

    function updateModelVisibility(root, model) {
        const t = (id, cond) => { const el = root.querySelector('#' + id); if (el) el.classList.toggle('cmOmb-hidden', !cond); };
        t('cmPc_postEccentricityField', model === 'excentre');
        t('cmPc_postSpacingField', model === 'double');
        t('cmPc_bracingVariantField', model === 'double'); // variantes V1/V2/V3 propres au Double poteaux
    }

    function applyToForm(root, model, p) {
        const set = (id, v) => { const el = root.querySelector('#' + id); if (el && v != null && !Number.isNaN(v)) el.value = v; };
        const setChk = (id, v) => { const el = root.querySelector('#' + id); if (el) el.checked = !!v; };
        const setBtn = (groupId, dataAttr, key) => {
            if (key == null) return;
            root.querySelectorAll('#' + groupId + ' button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-' + dataAttr) === key));
        };
        [['cmPc_facadeLength', 'facadeLength'], ['cmPc_roofSlope', 'roofSlope'],
        ['cmPc_nbPanelsRampant', 'nbPanelsRampant'], ['cmPc_panelSpacingYMm', 'panelSpacingYMm'],
        ['cmPc_overhangPct', 'overhangPct'], ['cmPc_lowPointHeight', 'lowPointHeight'],
        ['cmPc_nbShed', 'nbShedPetit'], ['cmPc_shedSpacing', 'shedSpacingPetit'],
        ['cmPc_petitPanelLengthMm', 'petitPanelLengthMm'], ['cmPc_petitPanelWidthMm', 'petitPanelWidthMm'],
        ['cmPc_postEccentricity', 'postEccentricity'], ['cmPc_postSpacing', 'postSpacing']].forEach(([id, k]) => set(id, p[k]));
        const setTxt = (id, v) => { const el = root.querySelector('#' + id); if (el && v != null) el.value = v; };
        setTxt('cmPc_structureColor', p.structureColor);
        setTxt('cmPc_panelColor', p.panelColor);
        setChk('cmPc_hidePanels', p.hidePanels);
        setChk('cmPc_showAnchors', p.showAnchors);
        setBtn('cmPc_orientationGroup', 'orientation', p.isPaysage ? 'paysage' : 'portrait');
        setBtn('cmPc_bracingVariantGroup', 'variant', p.doublePostBracingVariant || 'v1');
    }

    // --- valeurs par défaut (DOM détaché) -------------------------------------------------
    let _defaults = null;
    function getPetitChampDefaults() {
        if (_defaults) return Object.assign({}, _defaults);
        ensureStyle();
        const holder = document.createElement('div');
        holder.style.display = 'none';
        holder.innerHTML = formBodyHtml('centre');
        document.body.appendChild(holder);
        _defaults = readParams(holder, 'centre');
        document.body.removeChild(holder);
        return Object.assign({}, _defaults);
    }

    // --- rendu de la fenêtre -----------------------------------------------------------------
    function planLock() {
        if (typeof CM.ombrierePlanDims === 'function') {
            try { return CM.ombrierePlanDims() || {}; } catch (e) { /* noop */ }
        }
        return {};
    }

    function renderPetitChampForm(host, objId, opts) {
        opts = opts || {};
        const isForm = objId === CM.FORM_PETITCHAMP_ID;
        const obj = isForm
            ? (typeof CM.getFormPetitChampObject === 'function' ? CM.getFormPetitChampObject() : null)
            : (CM.state.sceneObjects3D || []).find((o) => o.id === objId);
        if (!obj || !host) return;
        ensureStyle();
        let model = (obj.params && obj.params.postModelPetit) || (CM.state.petitChampModel) || 'centre';

        host.innerHTML =
            `<div class="cmOmb-wrap">
                <div class="cmOmb-head"><strong>🔆 Petit champ solaire</strong><button type="button" data-pc="close">&times;</button></div>
                <div class="cmOmb-body"><div class="cmOmb-grid" id="cmPc_root">${formBodyHtml(model)}</div></div>
                <div class="cmOmb-foot">
                    ${isForm ? '<span></span>' : '<button type="button" class="cmOmb-btn danger" data-pc="delete">Supprimer</button>'}
                    <button type="button" class="cmOmb-btn primary" data-pc="close">Fermer</button>
                </div>
             </div>`;
        const root = host.querySelector('#cmPc_root');

        applyToForm(root, model, Object.assign({}, getPetitChampDefaults(), obj.params || {}));
        // Longueur / Pente verrouillées sur le plan 2D.
        const lock = planLock();
        [['cmPc_facadeLength', 'facadeLength'], ['cmPc_roofSlope', 'roofSlope']].forEach(([id, k]) => {
            const el = root.querySelector('#' + id);
            if (!el) return;
            if (lock[k] != null && !Number.isNaN(lock[k])) el.value = lock[k];
            el.setAttribute('readonly', 'readonly');
            el.title = 'Dimension issue du plan 2D du calepinage (verrouillée)';
        });

        updateModelVisibility(root, model);

        const commit = () => {
            const params = readParams(root, model);
            const l = planLock();
            if (l.facadeLength != null) params.facadeLength = l.facadeLength;
            if (l.roofSlope != null) params.roofSlope = l.roofSlope;
            if (typeof CM.updateSceneObject3D === 'function') {
                CM.updateSceneObject3D(objId, { typeKey: 'petit_champ_solaire_' + model, params: params });
            }
        };
        let t = null;
        const commitSoon = () => { clearTimeout(t); t = setTimeout(commit, 250); };
        root.querySelectorAll('input').forEach((inp) => {
            inp.addEventListener('input', commitSoon);
            inp.addEventListener('change', commitSoon);
        });
        root.querySelectorAll('#cmPc_modelGroup button[data-model]').forEach((b) => {
            b.addEventListener('click', () => {
                model = b.getAttribute('data-model');
                root.querySelectorAll('#cmPc_modelGroup button').forEach((x) => x.classList.toggle('on', x === b));
                updateModelVisibility(root, model);
                commit();
            });
        });
        // Groupes de boutons hors "modèle" (orientation, variante de contreventement) : activation + commit.
        root.querySelectorAll('.cmOmb-btnrow button:not([data-model])').forEach((b) => {
            b.addEventListener('click', () => {
                b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
                commit();
            });
        });
        host.querySelectorAll('[data-pc="close"]').forEach((b) => b.addEventListener('click', () => {
            if (typeof opts.onClose === 'function') opts.onClose();
        }));
        const del = host.querySelector('[data-pc="delete"]');
        if (del) del.addEventListener('click', () => { if (typeof opts.onDelete === 'function') opts.onDelete(objId); });
    }

    Object.assign(CM, {
        isPetitChampFamilyKey,
        getPetitChampDefaults,
        renderPetitChampForm,
    });
})();
