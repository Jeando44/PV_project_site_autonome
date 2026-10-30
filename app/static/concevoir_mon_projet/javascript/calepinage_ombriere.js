const systemeIntegrationsDB = [
    { C1: "Ombrière (IAB)", C2: "Adiwatt", C3: "Profil Evolution", C5: "7", C6: "3", C7: "140", C8: "1", C9: "Portrait, Paysage***", C10: "ETN", C13: "NA" },
    { C1: "Ombrière (IAB)", C2: "DomeSolar", C3: "RC3", C5: "27", C6: "3", C7: "160", C8: "10", C9: "Portrait,Paysage***", C10: "ETN", C13: "Dans la panne" },
    { C1: "Ombrière (IAB)", C2: "Mocusin", C3: "MVOR", C5: "120", C6: "19", C7: "Portal", C8: "Putat", C9: "Portrait, Paysage", C10: "EN", C13: "NA" },
    { C1: "Ombrière (IAB)", C2: "Mécosun", C3: "MECO-REF-A", C5: "150", C6: "100", C7: "NA", C8: "NA", C9: "Portrait", C10: "EIN", C13: "Portal" },
    { C1: "Ombrière (IAB)", C2: "Mécosun", C3: "MECO-REF-B", C5: "150", C6: "100", C7: "NA", C8: "NA", C9: "Paysage", C10: "Avis", C13: "Portal" },
    { C1: "Ombrière (IAB)", C2: "VISIONPARK", C3: "SI Vision PARK", C5: "200", C6: "200", C7: "NA", C8: "NA", C9: "Portrait", C10: "EIN", C13: "Portal" },
    { C1: "Bac Sec (ISB)", C2: "Dome Sul", C3: "P", C5: "27", C6: "130", C7: "160", C8: "", C9: "Portrait", C10: "NA", C13: "NA" },
    { C1: "Bac Sec (ISB)", C2: "Opt", C3: "SRE-EVD", C5: "NA", C6: "NA", C7: "160", C8: "EIN", C9: "Portrait", C10: "NA", C13: "NA" },
    { C1: "Bac Sec (ISB)", C2: "mis", C3: "Pirat", C5: "NA", C6: "NA", C7: "150", C8: "EIN", C9: "Paysage", C10: "NA", C13: "Pirat" },
    { C1: "Bac Sec (ISB)", C2: "Att", C3: "Adiwatt-FRIMA", C5: "NA", C6: "NA", C7: "100", C8: "NA", C9: "Portrait, Paysage", C10: "ETN", C13: "Pas" },
    { C1: "Bac Sec (ISB)", C2: "DOLAR H", C3: "DoSOLA atat", C5: "NA", C6: "NA100", C7: "118", C8: "EN", C9: "Portrait, Paysage", C10: "NA", C13: "NA" },
    { C1: "Bac Sec (ISB)", C2: "DomeSOLAR egys", C3: "Pirat", C5: "NA", C6: "NA", C7: "EIN", C8: "Moc", C9: "Portrait", C10: "NA", C13: "NA" },
    { C1: "Bac Sec (ISB)", C2: "Dome Su", C3: "SULAR", C5: "NA", C6: "NA", C7: "NA", C8: "NA", C9: "Portrait", C10: "NA", C13: "NA" },
    { C1: "Bac Sec (ISB)", C2: "Dome", C3: "DmDOLAR NPO3.45", C5: "NA", C6: "NA", C7: "NA", C8: "NA", C9: "Portrait, Paysage", C10: "NA", C13: "NA" },
    { C1: "Bac Sandwich (ISB)", C2: "Done", C3: "Bat-Solar DRON", C5: "NA", C6: "NA", C7: "NA", C8: "Dota pame", C9: "Portrait", C10: "EN", C13: "NA" },
    { C1: "Bac Sandwich (ISB)", C2: "DomeSOLAR Sar", C3: "DOLAR H", C5: "NA", C6: "Faysa", C7: "Damla pomme", C8: "Мос", C9: "Paysage", C10: "NA", C13: "NA" }
];

// fonction de remplissage des champ avec la BD 
function updateSystemDropdown() {
    const structure = document.getElementById('type').value.toLowerCase();
    const couverture = document.getElementById('couverture_type').value;
    const systemSelect = document.getElementById('system');
    // Le champ "Système d'intégration" (#system) a été retiré du HTML (remplacé par la carte
    // "Réf. PV et SI"), mais cette fonction reste appelée par plusieurs écouteurs existants.
    if (!systemSelect) return;

    systemSelect.innerHTML = '<option value="">-- Sélectionnez un système --</option>';

    let filterType = "";

    if (structure.includes("ombriere")) {
        if (couverture === "Ombriere_IAB") filterType = "Ombrière (IAB)";
        if (couverture === "Ombriere_ISB") filterType = "Bac Sec (ISB)";
    } else if (structure === "toiture_inclinee") {
        if (couverture === "Bac_Sec_ISB") filterType = "Bac Sec (ISB)";
        if (couverture === "Bac_Sandwich_ISB") filterType = "Bac Sandwich (ISB)";
    }

    const filteredSystems = systemeIntegrationsDB.filter(s => s.C1 === filterType);

    filteredSystems.forEach((sys) => {
        const option = document.createElement('option');
        option.value = systemeIntegrationsDB.indexOf(sys);
        option.textContent = `${sys.C2} - ${sys.C3}`;
        systemSelect.appendChild(option);
    });
}

// NOUVEAU (unification du calepinage) : le calepinage de tous les projets vient du module
// résidentiel (Calepinage_mainson/), chargé dans la page principale. Ce configurateur est dans une
// iframe imbriquée (page -> modale ombrière -> ici) : on remonte les fenêtres parentes pour trouver
// le service qui traduit le champ PV en valeurs de ce formulaire, et le pvId (porté par l'URL de la
// modale ombrière, pas par la nôtre). Renvoie null quand aucun champ PV ne correspond : les
// anciennes synchronisations ci-dessous restent alors le repli.
function synchroniserDepuisModuleResidentiel() {
    let pvId = null;
    let service = null;
    let fen = window;
    for (let i = 0; i < 5 && fen; i++) {
        try {
            if (!pvId) pvId = new URLSearchParams(fen.location.search).get('pvId');
            if (!service && fen.CalepinageMaisonConfigurateurOmbriere) service = fen.CalepinageMaisonConfigurateurOmbriere;
        } catch (e) {
            break; // fenêtre d'une autre origine : on s'arrête là
        }
        if (fen === fen.parent) break;
        fen = fen.parent;
    }
    if (!service) return null;
    try {
        return service.injecterDansConfigurateur(document, pvId || undefined);
    } catch (e) {
        console.warn('Synchronisation depuis le calepinage résidentiel impossible :', e);
        return null;
    }
}

// Fonction pour synchroniser avec les données du projet parent (calepinage.html)
function syncFromLocalStorage() {
    if (synchroniserDepuisModuleResidentiel()) return;
    try {
        const savedData = localStorage.getItem('solarProjectData');
        if (!savedData) return;

        const data = JSON.parse(savedData);

        // Trouver le pvId cible
        const urlParams = new URLSearchParams(window.location.search);
        let targetPvId = urlParams.get('pvId');
        if (!targetPvId || !data.formData?.[targetPvId]) {
            targetPvId = Object.keys(data.formData || {})[0];
        }

        if (!targetPvId) return;

        const formData = data.formData[targetPvId];
        if (!formData) return;

        let changed = false;

        const updateVal = (id, val) => {
            if (val === undefined || val === null || val === '') return;
            const el = document.getElementById(id);
            if (el && String(el.value) !== String(val)) {
                el.value = val;
                changed = true;
            }
        };

        const updateRadio = (name, val) => {
            if (!val) return;
            const radios = document.getElementsByName(name);
            for (let i = 0; i < radios.length; i++) {
                if (radios[i].value.toLowerCase() === val.toLowerCase() && !radios[i].checked) {
                    radios[i].checked = true;
                    changed = true;
                }
            }
        };

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (val !== undefined && val !== null && val !== '') ? val : '-';
        };

        updateVal('panel_ref', formData.referencePanneau);
        updateVal('power_unit', formData.puissancePanneau);
        updateVal('azimut', formData.Azimuth || formData.azimuth);

        // --- Carte "Réf. PV et SI" (référence panneau + système d'intégration du calepinage) ---
        setText('ref-panneau-overlay', formData.referencePanneau);
        setText('ref-si-overlay', formData.referenceSI);

        updateVal('toiture_pente_type', formData.toiture_pente_type);
        updateVal('asymetrie_percent', formData.asymetrie_percent);
        updateVal('nb_pentes', formData.nb_pentes);
        updateVal('largeur_faitage_mm', formData.largeur_faitage_mm);

        // CORRECTIF : formData.espacementPanneauxX/Y peut valoir "0" (donnée ancienne enregistrée avant
        // les correctifs de calepinage.html/FormHandler.js, ou système d'intégration "Autres" jamais
        // défini) — updateVal() ne filtre que undefined/null/'', donc un "0" était copié tel quel et
        // écrasait le défaut 10/15 de ce formulaire. 0 n'a jamais été une valeur d'espacement légitime :
        // on force 20mm dans ce cas, comme pour le calepinage polygonal/rectangle du formulaire principal.
        const espX = parseFloat(formData.espacementPanneauxX);
        const espY = parseFloat(formData.espacementPanneauxY);
        updateVal('intermodule_x', (!formData.espacementPanneauxX || isNaN(espX) || espX === 0) ? 20 : formData.espacementPanneauxX);
        updateVal('intermodule_y', (!formData.espacementPanneauxY || isNaN(espY) || espY === 0) ? 20 : formData.espacementPanneauxY);

        // --- Synchronisation Joint de Dilatation & Longueur Limite ---
        let jd = formData.joint_dilatation;
        let ld = formData.limit_dilatation_m;

        if (window.parent && window.parent.document) {
            const jdInput = window.parent.document.getElementById('joint_dilatation-' + targetPvId) || window.parent.document.getElementById('joint_dilatation');
            if (jdInput && jdInput.value !== '') jd = jdInput.value;

            const ldInput = window.parent.document.getElementById('limit_dilatation_m-' + targetPvId) || window.parent.document.getElementById('limit_dilatation_m');
            if (ldInput && ldInput.value !== '') ld = ldInput.value;
        }
        // Force la mise à 0 si le parent est vide ou configuré sur 0, remplaçant ainsi les défauts (30 et 60)
        updateVal('joint_dilatation', jd !== undefined && jd !== null ? jd : 0);
        updateVal('limit_dilatation', ld !== undefined && ld !== null ? ld : 0);

        // --- Synchronisation Marges depuis constants.js (TYPE_COUVERTURE_MAP) ---
        const structType = formData.typeDeStructure || formData.type_de_structure || formData.typeCouverture || formData.type_projet;
        const refSI = formData.referenceSI;

        if (refSI) {
            let dX = null;
            let dY = null;

            // Base de données locale de sécurité pour les marges SI (Constants)
            const siMargins = {
                'Evolution': { dX: 160, dY: 3 },
                'Prima': { dX: 160, dY: 3 },
                'Optima': { dX: 160, dY: 3 },
                'SolarRC3': { dX: 150, dY: 3 },
                'Helios': { dX: 160, dY: 3 },
                'Kogysun': { dX: 160, dY: 3 },
                'Joriside_RSPARK': { dX: 191, dY: 0 },
                'Joriside_Optiroof': { dX: 0, dY: 100 },
                'Joriside_RSR': { dX: 50, dY: 0 },
                'Mecosun_MVUH': { dX: 170, dY: 3 },
                'Mecosun_MVOH': { dX: 170, dY: 3 },
                'SopraPark': { dX: 160, dY: 3 },
                'Triangle': { dX: 160, dY: 3 },
                'rail_novotegra': { dX: 160, dY: 3 },
                'rail_K2system': { dX: 160, dY: 3 },
                'fabricant': { dX: 160, dY: 0 } // Ombrière solumbra (référence SI unique "fabricant")
            };

            if (siMargins[refSI]) {
                dX = siMargins[refSI].dX;
                dY = siMargins[refSI].dY;
            } else if (structType && window.parent && window.parent.TYPE_COUVERTURE_MAP) {
                const list = window.parent.TYPE_COUVERTURE_MAP[structType];
                if (list) {
                    const siData = list.find(s => s.id === refSI);
                    if (siData) { dX = siData.dX; dY = siData.dY; }
                }
            }

            if (dX !== null && dX !== undefined) updateVal('delta_w', dX);
            if (dY !== null && dY !== undefined) updateVal('delta_l', dY);
        }

        // --- Synchronisation Dimensions Toiture (avec prise en compte de l'inclinaison) ---
        if (data.shapes && data.shapes[targetPvId] && data.shapes[targetPvId].dimensions) {
            const shapeDims = data.shapes[targetPvId].dimensions;
            const inclinaison = formData.inclinaison || formData.pente || 0;
            if (shapeDims.length !== undefined && shapeDims.width !== undefined) {
                let tMax = Math.max(shapeDims.length, shapeDims.width);
                let tMin = Math.min(shapeDims.length, shapeDims.width);
                let realWidth = tMin;
                if (inclinaison > 0) {
                    realWidth = tMin / Math.max(Math.cos(inclinaison * Math.PI / 180), 0.1);
                }
                tMax = Math.round((tMax + Number.EPSILON) * 100) / 100;
                realWidth = Math.round((realWidth + Number.EPSILON) * 100) / 100;
                updateVal('toiture_dim_l', tMax);
                updateVal('toiture_dim_w', realWidth);
            }
        }

        // --- Synchronisation Nombre de Panneaux (X et Y) ---
        // Lecture du type de pente pour répartir correctement les panneaux par zone
        const _penteTypeLS = formData.toiture_pente_type || 'Monopente';
        const _asymValLS = parseFloat(formData.asymetrie_percent || formData.asymmetryPct || 40);
        const _nbPentesLS = parseInt(formData.nb_pentes) || 4;

        let _totalColsLS = 0;
        let _totalRowsLS = 0;

        if (data.shapes && data.shapes[targetPvId] && data.shapes[targetPvId].gridInfo) {
            const gridInfo = data.shapes[targetPvId].gridInfo;
            _totalColsLS = gridInfo.numCols || 0;
            _totalRowsLS = gridInfo.numRows || 0;
        } else {
            _totalColsLS = parseInt(formData.colonne) || 0;
            _totalRowsLS = parseInt(formData.ligne) || 0;
        }

        if (_totalColsLS) {
            updateVal('count_x', _totalColsLS);
            updateVal('count_x2', _totalColsLS);
        }

        if (_totalRowsLS) {
            if (_penteTypeLS === 'Bipente_symetrique') {
                // Diviser par 2 : chaque versant reçoit la moitié des panneaux en rampant
                const _yHalf = Math.round(_totalRowsLS / 2);
                updateVal('count_y', _yHalf);
                updateVal('count_y2', _yHalf);
            } else if (_penteTypeLS === 'Bipente_asymetrique') {
                // Lire les valeurs physiques réelles stockées par FormHandler (précision maximale)
                let _y1 = null;
                let _y2 = null;
                try {
                    const _perPanRaw = localStorage.getItem('pvPerPanRows_' + targetPvId);
                    if (_perPanRaw) {
                        const _perPanArr = JSON.parse(_perPanRaw);
                        if (Array.isArray(_perPanArr) && _perPanArr.length >= 2) {
                            _y1 = _perPanArr[0]; // Zone 1 (Pente Basse/Grande)
                            _y2 = _perPanArr[1]; // Zone 2 (Pente Haute/Petite)
                        }
                    }
                } catch (_e) {}
                // Fallback : formule en pourcentage si pas de données physiques disponibles
                if (_y1 === null || _y2 === null) {
                    _y1 = Math.round(_totalRowsLS * (_asymValLS / 100));
                    _y2 = _totalRowsLS - _y1;
                }
                updateVal('count_y', _y1);
                updateVal('count_y2', _y2);
            } else if (_penteTypeLS === 'Multipente') {
                // Diviser par le nombre de pentes (symétrique) : chaque versant reçoit 1/N
                const _yPan = Math.round(_totalRowsLS / _nbPentesLS);
                updateVal('count_y', _yPan);
                updateVal('count_y2', _yPan);
            } else {
                // Monopente : toute la valeur va dans la Zone 1
                updateVal('count_y', _totalRowsLS);
            }
        }

        if (formData.modePose) {
            updateRadio('mode', formData.modePose);
            const el = document.querySelector(`input[name="mode"]:checked`);
            if (el) el.dispatchEvent(new Event('change'));
        }

        if (formData.typeDeStructure || formData.type_de_structure) {
            const structure = formData.typeDeStructure || formData.type_de_structure;
            let mappedType = '';
            if (structure.includes('Ombrière métal')) mappedType = 'Ombriere_metal';
            else if (structure.includes('Ombrière bois')) mappedType = 'Ombriere_bois';
            else if (structure.includes('Ombrière béton') || structure.includes('solumbra')) mappedType = 'Ombriere_beton';
            else if (structure.includes('incliné') || structure.includes('inclinée')) mappedType = 'toiture_inclinee';
            else mappedType = 'Autres';

            updateVal('type', mappedType);
        }

        if (formData.longueurPanneauCustom) updateVal('panel_dim_l', formData.longueurPanneauCustom);
        if (formData.largeurPanneauCustom) updateVal('panel_dim_w', formData.largeurPanneauCustom);

        if (changed) {
            if (typeof toggleConditionalFields === 'function') toggleConditionalFields();
            if (typeof togglePenteConditionalFields === 'function') togglePenteConditionalFields();
            if (typeof updateDimensions === 'function') updateDimensions();
            if (typeof updateAzimut === 'function') updateAzimut();
            calculateAndDraw();
        }

    } catch (e) {
        console.warn('Erreur lors de la synchronisation depuis localStorage:', e);
    }
}

function autoFillSystemData() {
    const systemSelect = document.getElementById('system');
    const selectedIndex = systemSelect.value;

    if (selectedIndex === "" || selectedIndex === undefined) return;

    const data = systemeIntegrationsDB[selectedIndex];

    document.getElementById('compatibilite_mode_pose').value = data.C9 || "";
    document.getElementById('avis_certification').value = data.C10 || "";
    document.getElementById('fixation_si').value = data.C13 || "";

    const cleanNum = (val) => {
        if (!val || val === "NA") return 0;
        const num = parseFloat(val.toString().replace(/[^0-9.]/g, ''));
        return isNaN(num) ? 0 : num;
    };

    document.getElementById('intermodule_x').value = cleanNum(data.C5);
    document.getElementById('intermodule_y').value = cleanNum(data.C6);
    document.getElementById('delta_w').value = cleanNum(data.C7);
    document.getElementById('delta_l').value = cleanNum(data.C8);

    calculateAndDraw();
}

let currentPanelFillColor = '#F3F4F6';
let isIndicatorVisible = true;
let isPVDisplayVisible = true;
let isToitureDisplayVisible = true;
let currentRoofTexture = 'Bac Acier';
let pvToiturePosition = 'PV1_PV2';
// Bornes (en pixels internes du canvas) du rectangle de toiture réellement dessiné par drawCanvas(),
// utilisées par positionNorthPointer() pour ancrer la rose des vents au plus près de la toiture/des
// panneaux plutôt qu'au coin du canvas (souvent bien plus grand que le contenu dessiné).
let lastRoofBounds = null;

const roofTextures = {
    'Bac Acier': { color: '#6B7280', pattern: 'bac_acier' },
    'Ardoise': { color: '#A0A0A0', pattern: 'ardoise' },
    'Fibrociment': { color: '#B45B00', pattern: 'fibrociment' },
    'Membrane bitumineuse': { color: '#1F2937', pattern: 'solid' },
    'Dalle béton': { color: '#9CA3AF', pattern: 'dalle_beton' }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('section-1-content').style.display = 'none';
    document.getElementById('section-2-content').style.display = 'none';
    document.getElementById('section-3-content').style.display = 'none';
    const s4 = document.getElementById('section-4-content');
    if(s4) s4.style.display = 'none';

    document.querySelector('#section-1 .toggle-btn').classList.add('rotated');
    document.querySelector('#section-2 .toggle-btn').classList.add('rotated');
    document.querySelector('#section-3 .toggle-btn').classList.add('rotated');
    const btn4 = document.querySelector('#section-4 .toggle-btn');
    if(btn4) btn4.classList.add('rotated');

    setTimeout(() => {
        syncFromLocalStorage();
        updateDimensions();
        updateAzimut();
        updatePente();
        toggleConditionalFields();
        togglePenteConditionalFields();
        setDefaultPanelCounts();
        setRoofTexture(currentRoofTexture);
        calculateAndDraw();
    }, 50);

    const formElements = document.querySelectorAll('#calepinage-form input:not([type="hidden"]), #calepinage-form select');
    formElements.forEach(element => {
        const ignoredIds = ['panel_dim_l', 'panel_dim_w', 'azimut', 'pente', 'pv_number', 'nb_identical', 'toiture_dim_l', 'toiture_dim_w', 'count_x', 'count_y', 'count_x2', 'count_y2', 'asymetrie_percent'];
        if (!ignoredIds.includes(element.id) && element.name !== 'mode' && element.name !== 'etn_check' && element.name !== 'toiture_pente_type') {
            element.addEventListener('change', calculateAndDraw);
            element.addEventListener('input', calculateAndDraw);
        }
    });

    document.getElementById('azimut').addEventListener('change', updateAzimut);
    document.getElementById('pente').addEventListener('change', updatePente);
    document.getElementById('pv_number').addEventListener('change', calculateAndDraw);
    document.getElementById('nb_identical').addEventListener('change', calculateAndDraw);
    document.getElementById('toiture_dim_l').addEventListener('change', calculateAndDraw);
    document.getElementById('toiture_dim_w').addEventListener('change', calculateAndDraw);
    document.getElementById('toiture_pente_type').addEventListener('change', calculateAndDraw);
    document.getElementById('asymetrie_percent').addEventListener('change', calculateAndDraw);
    document.getElementById('nb_pentes').addEventListener('change', calculateAndDraw);
    document.getElementById('largeur_faitage_mm').addEventListener('change', calculateAndDraw);
    document.getElementById('count_x2').addEventListener('change', calculateAndDraw);
    document.getElementById('count_y2').addEventListener('change', calculateAndDraw);

    toggleOtherField('type', 'other_structure_input');
    toggleOtherField('couverture_type', 'other_couverture_input');

    document.getElementById('type').addEventListener('change', updateSystemDropdown);
    document.getElementById('couverture_type').addEventListener('change', updateSystemDropdown);

    updateSystemDropdown();
    updateToggleButtons();

    // Synchronisation des dimensions de panneau
    const panelDimL = document.getElementById('panel_dim_l');
    const panelDimW = document.getElementById('panel_dim_w');
    const panelDimX = document.getElementById('panel_dim_x');
    const panelDimY = document.getElementById('panel_dim_y');

    function syncPanelDimensions() {
        const longueur = parseFloat(panelDimL.value) || 0;
        const largeur = parseFloat(panelDimW.value) || 0;
        panelDimX.value = longueur;
        panelDimY.value = largeur;
        document.getElementById('dim-pv-detail').textContent = `${longueur} mm X ${largeur} mm`;
        calculateAndDraw();
    }

    panelDimL.addEventListener('input', syncPanelDimensions);
    panelDimW.addEventListener('input', syncPanelDimensions);
});

function setDefaultPanelCounts() {
    const penteType = document.getElementById('toiture_pente_type').value;
    const countX1 = document.getElementById('count_x');
    const countY1 = document.getElementById('count_y');
    const countX2 = document.getElementById('count_x2');
    const countY2 = document.getElementById('count_y2');
    const asymetriePercent = document.getElementById('asymetrie_percent');
    const nbPentes = document.getElementById('nb_pentes');

    const isManualEntry = (countX1.value !== '' && countY1.value !== '');

    if (penteType === 'Monopente') {
        if (!isManualEntry) { countX1.value = 40; countY1.value = 10; }
    } else if (penteType === 'Bipente_symetrique') {
        if (!isManualEntry) { countX1.value = 40; countY1.value = 5; }
        countX2.value = countX1.value;
        countY2.value = countY1.value;
        countX2.setAttribute('readonly', 'readonly');
        countY2.setAttribute('readonly', 'readonly');
    } else if (penteType === 'Bipente_asymetrique') {
        if (!isManualEntry) { countX1.value = 40; countY1.value = 7; countX2.value = 40; countY2.value = 3; }
        asymetriePercent.value = 25;
        countX2.removeAttribute('readonly');
        countY2.removeAttribute('readonly');
    } else if (penteType === 'Multipente') {
        nbPentes.value = 4;
        if (!isManualEntry) { countX1.value = 40; countY1.value = 2; }
        countX2.value = countX1.value;
        countY2.value = countY1.value;
        countX2.setAttribute('readonly', 'readonly');
        countY2.setAttribute('readonly', 'readonly');
    }
}

function toggleSection(contentId, button) {
    const content = document.getElementById(contentId);
    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        button.classList.remove('rotated');
    } else {
        content.style.display = 'none';
        button.classList.add('rotated');
    }
    calculateAndDraw();
}

function toggleOtherField(selectId, inputId) {
    const selectElement = document.getElementById(selectId);
    const inputElement = document.getElementById(inputId);
    if (selectElement.value === 'Autres') {
        inputElement.classList.remove('hidden');
        inputElement.setAttribute('required', 'required');
    } else {
        inputElement.classList.add('hidden');
        inputElement.removeAttribute('required');
    }
}

function toggleConditionalFields() {
    const structureType = document.getElementById('type').value;
    const poteauxGroup = document.getElementById('poteaux-input-group');
    const couvertureGroup = document.getElementById('couverture-group');
    const penteToitureGroup = document.getElementById('pente-toiture-group');

    const needsPenteFields = [
        'toiture_inclinee',
        'Ombriere_metal',
        'Ombriere_bois',
        'Ombriere_beton'
    ];

    if (structureType === 'Ombriere_beton') {
        poteauxGroup.classList.remove('hidden');
        document.getElementById('nb_poteaux').setAttribute('required', 'required');
    } else {
        poteauxGroup.classList.add('hidden');
        document.getElementById('nb_poteaux').removeAttribute('required');
        document.getElementById('nb_poteaux').value = 0;
    }

    couvertureGroup.classList.remove('hidden');

    if (needsPenteFields.includes(structureType)) {
        penteToitureGroup.classList.remove('hidden');
    } else {
        penteToitureGroup.classList.add('hidden');
        document.getElementById('toiture_pente_type').value = 'Monopente';
    }

    togglePenteConditionalFields();
    calculateAndDraw();
    updateSystemDropdown();
}

function togglePenteConditionalFields() {
    const penteType = document.getElementById('toiture_pente_type').value;
    const asymetrieGroup = document.getElementById('asymetrie-group');
    const nbPentesGroup = document.getElementById('nb-pentes-group');
    const faitageGroup = document.getElementById('largeur-faitage-group');
    const toggleBtn = document.getElementById('toggle-pv-toiture-btn');
    const pvZone2Group = document.getElementById('pv-zone-2-group');

    const isMultiZone = (penteType === 'Bipente_symetrique' || penteType === 'Bipente_asymetrique' || penteType === 'Multipente');

    if (isMultiZone) {
        faitageGroup.classList.remove('hidden');
        toggleBtn.classList.remove('hidden');
        pvZone2Group.classList.remove('hidden');
        document.getElementById('largeur_faitage_mm').setAttribute('required', 'required');
        document.getElementById('count_x2').setAttribute('required', 'required');
        document.getElementById('count_y2').setAttribute('required', 'required');

        if (penteType === 'Bipente_symetrique' || penteType === 'Multipente') {
            document.getElementById('count_x2').setAttribute('readonly', 'readonly');
            document.getElementById('count_y2').setAttribute('readonly', 'readonly');
        } else {
            document.getElementById('count_x2').removeAttribute('readonly');
            document.getElementById('count_y2').removeAttribute('readonly');
        }
    } else {
        faitageGroup.classList.add('hidden');
        toggleBtn.classList.add('hidden');
        pvZone2Group.classList.add('hidden');
        document.getElementById('largeur_faitage_mm').removeAttribute('required');
        document.getElementById('count_x2').removeAttribute('required');
        document.getElementById('count_y2').removeAttribute('required');
        pvToiturePosition = 'PV1_PV2';
    }

    if (penteType === 'Bipente_asymetrique') {
        asymetrieGroup.classList.remove('hidden');
        document.getElementById('asymetrie_percent').setAttribute('required', 'required');
    } else {
        asymetrieGroup.classList.add('hidden');
        document.getElementById('asymetrie_percent').removeAttribute('required');
    }

    if (penteType === 'Multipente' || penteType === 'Bipente_symetrique' || penteType === 'Bipente_asymetrique') {
        nbPentesGroup.classList.remove('hidden');
        document.getElementById('nb_pentes').setAttribute('required', 'required');
        if (penteType === 'Bipente_symetrique' || penteType === 'Bipente_asymetrique') {
            document.getElementById('nb_pentes').value = 2;
            document.getElementById('nb_pentes').setAttribute('readonly', 'readonly');
        } else {
            document.getElementById('nb_pentes').removeAttribute('readonly');
        }
    } else {
        nbPentesGroup.classList.add('hidden');
        document.getElementById('nb_pentes').removeAttribute('required');
    }

    updatePVToiturePositionButtonText();
}

function updatePVToiturePositionButtonText() {
    const toggleBtn = document.getElementById('toggle-pv-toiture-btn');
    const penteType = document.getElementById('toiture_pente_type').value;
    let status = '';

    if (penteType === 'Multipente') {
        const nbPans = parseInt(document.getElementById('nb_pentes').value);
        if (nbPans === 4) {
            if (pvToiturePosition === 'PV1_PV2') status = 'Tous (Pans 1, 2, 3, 4)';
            else if (pvToiturePosition === 'PV1') status = 'Ext. (Pans 1 & 4)';
            else status = 'Centr. (Pans 2 & 3)';
        } else {
            if (pvToiturePosition === 'PV1_PV2') status = 'Tous les Pans';
            else if (pvToiturePosition === 'PV1') status = '1ère Zone';
            else status = '2ème Zone';
        }
        toggleBtn.textContent = `Afficher Zones (Actuel: ${status})`;
    } else if (penteType === 'Bipente_asymetrique' || penteType === 'Bipente_symetrique') {
        if (pvToiturePosition === 'PV1_PV2') status = 'Les Deux Zones (P1 & P2)';
        else if (pvToiturePosition === 'PV1') status = 'Zone 1 (Pente Basse)';
        else status = 'Zone 2 (Pente Haute)';
        toggleBtn.textContent = `Afficher Zones (Actuel: ${status})`;
    } else {
        toggleBtn.textContent = 'Afficher Zones (Actuel: Non applicable)';
    }
}

function togglePVToiturePosition() {
    switch (pvToiturePosition) {
        case 'PV1_PV2':
            pvToiturePosition = 'PV1';
            break;
        case 'PV1':
            pvToiturePosition = 'PV2';
            break;
        case 'PV2':
            pvToiturePosition = 'PV1_PV2';
            break;
    }
    updatePVToiturePositionButtonText();
    calculateAndDraw();
}

function setPanelColor(color) {
    currentPanelFillColor = color;
    calculateAndDraw();
}

function setRoofTexture(textureName) {
    currentRoofTexture = textureName;
    document.getElementById('current-texture-display').textContent = textureName;
    calculateAndDraw();
}

function updateDimensions() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const panelDimL = document.getElementById('panel_dim_l');
    const panelDimW = document.getElementById('panel_dim_w');
    const panelDimX = document.getElementById('panel_dim_x');
    const panelDimY = document.getElementById('panel_dim_y');

    const longueur = parseFloat(panelDimL.value) || 1762;
    const largeur = parseFloat(panelDimW.value) || 1134;

    if (mode === 'Portrait') {
        panelDimX.value = longueur;
        panelDimY.value = largeur;
        panelDimL.value = longueur;
        panelDimW.value = largeur;
    } else {
        panelDimX.value = largeur;
        panelDimY.value = longueur;
        panelDimL.value = longueur;
        panelDimW.value = largeur;
    }

    document.getElementById('dim-pv-detail').textContent = `${panelDimX.value} mm X ${panelDimY.value} mm`;
    calculateAndDraw();
}

// Ancre la rose des vents près du coin de la toiture réellement dessinée (lastRoofBounds, calculé
// par drawCanvas), et non du canvas ou du conteneur #drawing-zone qui sont généralement bien plus
// grands que le contenu dessiné (marges de mise à l'échelle) — sinon la rose reste visuellement
// loin des panneaux malgré un recadrage correct de l'image exportée sur le contenu non-blanc.
function positionNorthPointer() {
    const pointer = document.getElementById('north-pointer');
    const canvas = document.getElementById('pv-canvas');
    const zone = document.getElementById('drawing-zone');
    if (!pointer || !canvas || !zone) return;
    const canvasRect = canvas.getBoundingClientRect();
    const zoneRect = zone.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;
    const offset = 10; // Distance depuis le coin de la toiture

    if (lastRoofBounds && canvas.width > 0 && canvas.height > 0) {
        // Conversion des pixels internes du canvas vers les pixels CSS réellement affichés
        // (canvas.width/height peuvent différer de canvasRect.width/height selon la mise en page).
        const renderScaleX = canvasRect.width / canvas.width;
        const renderScaleY = canvasRect.height / canvas.height;
        const roofRightOnScreen = (lastRoofBounds.x + lastRoofBounds.width) * renderScaleX;
        const roofBottomOnScreen = (lastRoofBounds.y + lastRoofBounds.height) * renderScaleY;
        const distFromCanvasRightEdge = canvasRect.width - roofRightOnScreen;
        const distFromCanvasBottomEdge = canvasRect.height - roofBottomOnScreen;
        pointer.style.right = Math.max(4, (zoneRect.right - canvasRect.right) + distFromCanvasRightEdge + offset) + 'px';
        pointer.style.bottom = Math.max(4, (zoneRect.bottom - canvasRect.bottom) + distFromCanvasBottomEdge + offset) + 'px';
        return;
    }

    pointer.style.right = Math.max(4, zoneRect.right - canvasRect.right + offset) + 'px';
    pointer.style.bottom = Math.max(4, zoneRect.bottom - canvasRect.bottom + offset) + 'px';
}

function updateAzimut() {
    const azimut = parseFloat(document.getElementById('azimut').value) || 0;
    const rotation = -azimut;
    const pointer = document.getElementById('north-pointer');
    pointer.style.transform = `rotate(${rotation}deg)`;
    document.getElementById('azimut-value').textContent = `${azimut}°`;
    calculateAndDraw();
}

function updatePente() {
    const pente = parseFloat(document.getElementById('pente').value) || 0;
    document.getElementById('pente-value').textContent = `${pente}°`;
    calculateAndDraw();
}

function updateToggleButtons() {
    document.getElementById('toggle-indicator-btn').textContent = isIndicatorVisible ? "Masquer Indic." : "Afficher Indic.";
    document.getElementById('toggle-pv-display-btn').textContent = isPVDisplayVisible ? "Masquer PV" : "Afficher PV";
    document.getElementById('toggle-toiture-display-btn').textContent = isToitureDisplayVisible ? "Masquer Toiture" : "Afficher Toiture";
}

function togglePVIndicator() {
    isIndicatorVisible = !isIndicatorVisible;
    updateToggleButtons();
    calculateAndDraw();
}

function togglePVDisplay() {
    isPVDisplayVisible = !isPVDisplayVisible;
    updateToggleButtons();
    calculateAndDraw();
}

function toggleToitureDisplay() {
    isToitureDisplayVisible = !isToitureDisplayVisible;
    updateToggleButtons();
    calculateAndDraw();
}

function searchSystemFilter() {
    const system = document.getElementById('system').value;
    const compatibilite = document.getElementById('compatibilite_mode_pose').value;
    const avis = document.getElementById('avis_certification').value;
    const fixation = document.getElementById('fixation_si').value;
    const message = `Lancement de la recherche de Système d'Intégration...\n\nCritères:\n- Système : ${system}\n- Compatibilité Mode de pose : ${compatibilite || 'Non Spécifié'}\n- Avis de certification : ${avis || 'Non Spécifié'}\n- Point de fixation du SI : ${fixation || 'Non Spécifié'}\n\n(La recherche de données externes nécessite une intégration backend non incluse dans ce script HTML).`;
    alert(message);
}

function downloadPNG() {
    calculateAndDraw();
    const visualizationArea = document.getElementById('visualization-area');
    const originalBG = visualizationArea.style.backgroundColor;
    visualizationArea.style.backgroundColor = "white";
    visualizationArea.style.boxShadow = "none";
    visualizationArea.style.border = "none";
    const pdfCaptureArea = document.getElementById('pdf-capture-area');
    if (pdfCaptureArea) pdfCaptureArea.style.backgroundColor = "white";

    html2canvas(pdfCaptureArea, {
        logging: false,
        useCORS: true,
        scale: 4,
        backgroundColor: "#FFFFFF"
    }).then(canvasResult => {
        visualizationArea.style.backgroundColor = originalBG;
        const link = document.createElement('a');
        link.download = `Calepinage_PV_${document.getElementById('pv_number').value}.png`;
        link.href = canvasResult.toDataURL('image/png');
        link.click();
    });
}

const globalPdfCaptureArea = document.getElementById('pdf-capture-area');
if (globalPdfCaptureArea) {
    globalPdfCaptureArea.style.border = "none";
    globalPdfCaptureArea.style.boxShadow = "none";
}

function exportPDF() {
    calculateAndDraw();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const defaultMargin = 15;
    let y_offset = 20;
    const page_width = doc.internal.pageSize.getWidth();
    const page_height = doc.internal.pageSize.getHeight();

    const mode = document.querySelector('input[name="mode"]:checked').value;
    const etnCheckValue = document.querySelector('input[name="etn_check"]:checked').value;
    const panelRef = document.getElementById('panel_ref').value || 'Non spécifiée';
    const poteauxValue = document.getElementById('nb_poteaux').value || '0';
    const toitureLength = parseFloat(document.getElementById('toiture_dim_l').value) || 0;
    const toitureWidth = parseFloat(document.getElementById('toiture_dim_w').value) || 0;
    const largeurFaitage = parseFloat(document.getElementById('largeur_faitage_mm').value) / 1000 || 0;

    function getSelectedText(selectId, inputId) {
        const selectElement = document.getElementById(selectId);
        const selectedOption = selectElement.options[selectElement.selectedIndex].text;
        if (selectedOption.includes('Autres')) {
            const otherInput = document.getElementById(inputId).value;
            return otherInput || selectedOption;
        }
        return selectedOption;
    }

    const structureType = document.getElementById('type').value;
    const penteType = document.getElementById('toiture_pente_type').value;
    const asymetriePercent = document.getElementById('asymetrie_percent').value;
    const nbPentes = document.getElementById('nb_pentes').value;

    let penteText = document.getElementById('toiture_pente_type').options[document.getElementById('toiture_pente_type').selectedIndex].text;
    if (penteType === 'Bipente_asymetrique') {
        penteText += ` (${asymetriePercent}%)`;
    } else if (penteType === 'Multipente') {
        penteText += ` (${nbPentes} pans)`;
    }

    let etnMessageText = '';
    if (etnCheckValue === 'non') {
            etnMessageText = `La référence du panneau utilisée (${panelRef}) n’a pas été vérifiée dans la liste des panneaux intégrés à l’ETN/ATec du système d’intégration. Veuillez contacter le fournisseur du système d’intégration afin de valider ce point avant l'exécution de votre projet.`;
    } else {
            etnMessageText = `La référence du panneau utilisée (${panelRef}) pour ce projet est intégrée dans la liste des modules validés dans le cadre de l’ETN/ATec du système d’intégration choisi.`;
    }

    doc.setFontSize(18);
    doc.text(`Rapport de Calepinage Photovoltaïque`, defaultMargin, y_offset);
    y_offset += 10;

    let projectData = [
        ["N° Champ PV :", document.getElementById('pv_number').value],
        ["Nbre de champs identiques :", document.getElementById('nb_identical').value],
        ["Long. Toiture :", `${toitureLength.toFixed(1)} m`],
        ["Larg. Toiture :", `${toitureWidth.toFixed(1)} m`],
        ["Structure porteuse :", getSelectedText('type', 'other_structure_input')],
    ];

    if (structureType === 'toiture_inclinee') {
        projectData.push(["Géométrie de la Toiture :", penteText]);
        if (penteType !== 'Monopente') {
            projectData.push(["Largeur Faîtage :", `${largeurFaitage.toFixed(2)} m`]);
        }
        projectData.push(["Type de couverture :", getSelectedText('couverture_type', 'other_couverture_input')]);
    }

    projectData.push(
        ["Système d’Intégration :", document.getElementById('system').value],
        ["Compatibilité Mode de pose :", document.getElementById('compatibilite_mode_pose').value],
        ["Avis de certification :", document.getElementById('avis_certification').value],
        ["Point de fixation du SI :", document.getElementById('fixation_si').value],
    );

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("1. Paramètres du Projet & Système", defaultMargin, y_offset);
    doc.setFont('helvetica', 'normal');
    y_offset += 2;

    doc.autoTable({
        startY: y_offset,
        body: projectData,
        margin: { left: defaultMargin, right: defaultMargin },
        theme: 'grid',
        styles: {
            fontSize: 10,
            cellPadding: 1.5,
            lineColor: [150, 150, 150],
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: [40, 40, 40]
        },
        tableLineColor: [150, 150, 150],
        tableLineWidth: 0.1,
    });
    y_offset = doc.lastAutoTable.finalY + 8;

    doc.setFontSize(10);
    doc.setTextColor(etnCheckValue === 'non' ? 153 : 27, etnCheckValue === 'non' ? 27 : 119, etnCheckValue === 'non' ? 27 : 243);
    const lines = doc.splitTextToSize(etnMessageText, page_width - 2 * defaultMargin);
    doc.text("Vérification Panneau vs SI (ETN/ATec) :", defaultMargin, y_offset);
    y_offset += 4;
    doc.text(lines, defaultMargin, y_offset, { align: 'left' });
    y_offset += (lines.length * 4.5) + 4;
    doc.setTextColor(0, 0, 0);

    const dimData = [
        ["Référence Panneau :", panelRef],
        ["Mode de pose des panneaux :", mode],
        ["Total PV :", document.getElementById('npv-detail').textContent],
        ["Dim PV :", document.getElementById('dim-pv-detail').textContent],
        ["Long. Champ (X) :", document.getElementById('total-length-overlay').textContent],
        ["Larg. Champ (Y) :", document.getElementById('total-width-overlay').textContent],
        ["Puissance Champ :", document.getElementById('current-power-overlay').textContent],
        ["Azimut :", document.getElementById('azimut-value').textContent],
        ["Pente :", document.getElementById('pente-value').textContent]
    ];

    if (structureType === 'Ombriere_beton') {
        dimData.push(["Nombre de poteaux :", poteauxValue]);
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("2. Détails et Totaux du Champ PV", defaultMargin, y_offset);
    doc.setFont('helvetica', 'normal');
    y_offset += 2;

    doc.autoTable({
        startY: y_offset,
        body: dimData,
        margin: { left: defaultMargin, right: defaultMargin },
        theme: 'grid',
        styles: {
            fontSize: 10,
            cellPadding: 1.5,
            lineColor: [150, 150, 150],
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: [40, 40, 40]
        },
        tableLineColor: [150, 150, 150],
        tableLineWidth: 0.1,
    });
    y_offset = doc.lastAutoTable.finalY + 12;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("3. Visualisation du Calepinage (avec Cotations)", defaultMargin, y_offset);
    doc.setFont('helvetica', 'normal');
    y_offset += 4;

    const captureContainer = document.getElementById('pdf-capture-area');

    html2canvas(captureContainer, {
        logging: false,
        useCORS: true,
        scale: 3,
        backgroundColor: "#FFFFFF"
    }).then(canvasResult => {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        const cropTop = 0;
        const cropSide = 0;
        const sourceWidth = canvasResult.width;
        const sourceHeight = canvasResult.height;

        tempCanvas.width = sourceWidth;
        tempCanvas.height = sourceHeight;
        tempCtx.drawImage(canvasResult, cropSide, cropTop, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

        const imgData = tempCanvas.toDataURL('image/png');
        const imgProps = doc.getImageProperties(imgData);

        const pdfWidth = page_width - (2 * defaultMargin);
        const marginBottom = 10;
        const availableHeight = page_height - y_offset - marginBottom;

        const ratio = imgProps.width / imgProps.height;
        let finalPdfWidth = pdfWidth;
        let finalPdfHeight = pdfWidth / ratio;

        if (finalPdfHeight > availableHeight) {
            finalPdfHeight = availableHeight;
            finalPdfWidth = availableHeight * ratio;
        }

        const imgX = defaultMargin + (pdfWidth - finalPdfWidth) / 2;

        doc.addImage(imgData, 'PNG', imgX, y_offset, finalPdfWidth, finalPdfHeight);
        doc.save(`Rapport_Calepinage_${document.getElementById('pv_number').value}.pdf`);
    });
}

function drawCanvas(data) {
    const canvas = document.getElementById('pv-canvas');
    const ctx = canvas.getContext('2d');
    const areaContainer = document.getElementById('drawing-zone');
    const pdfCaptureArea = document.getElementById('pdf-capture-area');

    let cWidth = areaContainer.clientWidth;
    let cHeight = areaContainer.clientHeight;

    if (cWidth === 0 || cHeight === 0) {
        if (window.isGeneratingPDF || (window.parent && window.parent.isGeneratingPDF)) {
            cWidth = 900;
            cHeight = 600;
        }
    }

    canvas.width = cWidth;
    canvas.height = cHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toiture_length_mm = data.toiture_length_mm;
    const toiture_width_mm = data.toiture_width_mm;
    const total_length_mm = data.total_length_mm;
    const total_width_mm = data.total_width_mm;

    if (toiture_length_mm <= 0 || toiture_width_mm <= 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6B7280';
        ctx.font = '16px sans-serif';
        ctx.fillText("Veuillez entrer des dimensions de toiture valides (> 0).", canvas.width / 2, canvas.height / 2);
        return;
    }

    const topOffsetForOverlays = 30;
    const marginForScaling = 40;
    const canvasCenter = canvas.width / 2;

    const max_length_mm = Math.max(total_length_mm, toiture_length_mm);
    const max_width_mm = Math.max(total_width_mm, toiture_width_mm);

    const maxContentWidth = canvas.width - marginForScaling * 2;
    const maxContentHeight = canvas.height - topOffsetForOverlays - marginForScaling;

    const scaleX = maxContentWidth / max_length_mm;
    const scaleY = maxContentHeight / max_width_mm;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    const scaledRoofWidth = toiture_length_mm * scale;
    const scaledRoofHeight = toiture_width_mm * scale;
    const roofStartX = canvasCenter - scaledRoofWidth / 2;
    const roofStartY = topOffsetForOverlays + (maxContentHeight - scaledRoofHeight) / 2;

    lastRoofBounds = { x: roofStartX, y: roofStartY, width: scaledRoofWidth, height: scaledRoofHeight };

    let faitageY1;
    const faitageWidthPX = data.largeur_faitage_mm * scale;
    const isMultiZone = data.is_multi_zone;
    const penteType = data.pente_type;
    const asymetriePercent = data.asymetrie_percent;
    const nbPans = data.nb_pans;

    if (isMultiZone) {
        if (penteType === 'Bipente_symetrique') {
            faitageY1 = roofStartY + scaledRoofHeight / 2;
        } else if (penteType === 'Bipente_asymetrique') {
            faitageY1 = (roofStartY + scaledRoofHeight) - (scaledRoofHeight * asymetriePercent);
        }
    }

    function drawRoof(startX, startY, scaledW, scaledH, texture) {
        if (!isToitureDisplayVisible) return;
        ctx.save();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0;
        ctx.fillStyle = texture.color;
        ctx.fillRect(startX, startY, scaledW, scaledH);
        ctx.strokeRect(startX, startY, scaledW, scaledH);

        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        const textureScaleFactor = scale / 0.9;

        if (texture.pattern === 'bac_acier') {
            const spacing = 500 * textureScaleFactor;
            for (let x = startX + spacing; x < startX + scaledW; x += spacing) {
                ctx.beginPath();
                ctx.moveTo(x, startY);
                ctx.lineTo(x, startY + scaledH);
                ctx.stroke();
            }
        } else if (texture.pattern === 'ardoise') {
            const size = 500 * textureScaleFactor;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
            for (let y = startY; y < startY + scaledH; y += size * 0.7) {
                for (let x = startX - size; x < startX + scaledW; x += size) {
                    ctx.beginPath();
                    ctx.rect(x + (Math.floor(y / (size * 0.7)) % 2) * size / 2, y, size, size * 0.7);
                    ctx.stroke();
                }
            }
        } else if (texture.pattern === 'fibrociment') {
            const spacing = 500 * textureScaleFactor;
            ctx.fillStyle = 'rgba(0,0,0,0.05)';
            for (let y = startY; y < startY + scaledH; y += spacing) {
                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(startX + scaledW, y);
                ctx.stroke();
                ctx.fillRect(startX, y, scaledW, spacing * 0.3);
            }
        } else if (texture.pattern === 'dalle_beton') {
            const size = 400 * textureScaleFactor;
            for (let x = startX; x < startX + scaledW; x += size) {
                ctx.beginPath();
                ctx.moveTo(x, startY);
                ctx.lineTo(x, startY + scaledH);
                ctx.stroke();
            }
            for (let y = startY; y < startY + scaledH; y += size) {
                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(startX + scaledW, y);
                ctx.stroke();
            }
        }

        if (isMultiZone) {
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);

            if (penteType === 'Multipente' && nbPans > 1) {
                const panHeight = scaledH / nbPans;
                const nbFaitages = Math.floor(nbPans / 2);
                for (let i = 1; i <= nbFaitages; i++) {
                    const faitageY = startY + panHeight * i * 2;
                    ctx.beginPath();
                    ctx.moveTo(startX, faitageY);
                    ctx.lineTo(startX + scaledW, faitageY);
                    ctx.stroke();
                }
                if (nbPans === 4) {
                    const noueY = startY + panHeight * 2;
                    ctx.save();
                    ctx.strokeStyle = '#0000FF';
                    ctx.setLineDash([2, 5]);
                    ctx.beginPath();
                    ctx.moveTo(startX, noueY);
                    ctx.lineTo(startX + scaledW, noueY);
                    ctx.stroke();
                    ctx.restore();
                }
            } else {
                ctx.beginPath();
                ctx.moveTo(startX, faitageY1);
                ctx.lineTo(startX + scaledW, faitageY1);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    drawRoof(roofStartX, roofStartY, scaledRoofWidth, scaledRoofHeight, roofTextures[currentRoofTexture]);

    const scaledPVWidth = total_length_mm * scale;
    const scaledPVHeight = total_width_mm * scale;
    const pvStartX = roofStartX + (scaledRoofWidth - scaledPVWidth) / 2;
    const pvStartY = roofStartY + (scaledRoofHeight - scaledPVHeight) / 2;

    function drawPVGrid(startX, startY, count_x_zone, count_y_zone, module_X_mm, module_Y_mm, intermodule_x, intermodule_y, jointApresColonnes, pv_label, isDownwardPente) {
        if (!isPVDisplayVisible || count_x_zone === 0 || count_y_zone === 0) return;

        let xCursor = startX;
        ctx.fillStyle = currentPanelFillColor;
        ctx.strokeStyle = '#9CA3AF';

        const moduleWidthPX = module_X_mm * scale;
        const moduleHeightPX = module_Y_mm * scale;
        const totalHeightPX = (count_y_zone * moduleHeightPX) + ((count_y_zone - 1) * intermodule_y * scale);

        let jointIndex = 0;

        for (let cx = 1; cx <= count_x_zone; cx++) {
            let yCursor = startY;

            for (let cy = 1; cy <= count_y_zone; cy++) {
                ctx.beginPath();
                ctx.rect(xCursor, yCursor, moduleWidthPX, moduleHeightPX);
                ctx.fill();
                ctx.stroke();

                yCursor += moduleHeightPX;
                if (cy < count_y_zone) yCursor += intermodule_y * scale;
            }

            xCursor += moduleWidthPX;

            // Joint après cette colonne (liste des n° de colonne, cf. joint_apres_colonnes) : la
            // largeur du joint REMPLACE l'espacement X, comme dans le moteur du calepinage.
            const jointIci = cx < count_x_zone && jointIndex < jointApresColonnes.length && jointApresColonnes[jointIndex] === cx;
            if (cx < count_x_zone && !jointIci) {
                xCursor += intermodule_x * scale;
            }

            if (jointIci) {
                const jointWidthPx = data.joint_dilatation * scale;

                ctx.save();
                ctx.fillStyle = 'rgba(255, 159, 64, 0.5)';
                ctx.fillRect(xCursor, startY, jointWidthPx, totalHeightPX);

                ctx.fillStyle = '#CC5500';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                const jointCenter = xCursor + (jointWidthPx / 2);
                ctx.fillText(`Joint ${data.joint_dilatation}mm`, jointCenter, startY + totalHeightPX / 2);

                ctx.restore();

                xCursor += jointWidthPx;
                jointIndex++;
            }
        }

        if (isIndicatorVisible && pv_label) {
            const centerX = startX + (xCursor - startX) / 2;
            const centerY = startY + totalHeightPX / 2;
            const arrowLength = 40;
            const offset = 20;
            const arrowHeadSize = 16;

            ctx.save();
            ctx.fillStyle = '#FF8C00';
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pv_label, centerX, centerY - offset);
            ctx.restore();

            drawArrow(
                centerX, centerY + offset / 2,
                centerX, centerY + offset / 2 + (isDownwardPente ? arrowLength : -arrowLength),
                arrowHeadSize, null, false, isDownwardPente ? 90 : 270, 1, 0, 3
            );
        }
    }

    function drawArrow(x1, y1, x2, y2, size, text, inverted, rotationDegrees, textScale = 1, textOffset = 10, lineWidth = 2) {
        ctx.save();
        ctx.strokeStyle = '#FF8C00';
        ctx.fillStyle = '#FF8C00';
        ctx.lineWidth = lineWidth;
        ctx.font = `bold ${12 * textScale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        const angleFlèche = Math.atan2(y2 - y1, x2 - x1);
        const stopX = x2 - (size * Math.cos(angleFlèche));
        const stopY = y2 - (size * Math.sin(angleFlèche));
        ctx.lineTo(stopX, stopY);
        ctx.stroke();

        let angle = rotationDegrees * (Math.PI / 180);
        function drawSingleHead(x, y, currentAngle) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - size * Math.cos(currentAngle - Math.PI / 6), y - size * Math.sin(currentAngle - Math.PI / 6));
            ctx.lineTo(x - size * Math.cos(currentAngle + Math.PI / 6), y - size * Math.sin(currentAngle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
        }
        drawSingleHead(x2, y2, angle);
        if (inverted) drawSingleHead(x1, y1, angle + Math.PI);
        if (text) {
            const dx = x2 - x1, dy = y2 - y1;
            const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
            let textAngle = Math.atan2(dy, dx);
            if (Math.abs(textAngle) > Math.PI / 2) textAngle += Math.PI;
            ctx.translate(midX, midY);
            ctx.rotate(textAngle);
            ctx.fillText(text, 0, -textOffset);
        }
        ctx.restore();
    }

    const gridStartXBase = pvStartX + (data.delta_w * scale) / 2 + ((data.structure_type === 'Ombriere_beton' ? (5 * data.nb_poteaux) : 0) * scale) / 2;
    const gridWidthBase = scaledPVWidth - data.delta_w * scale - ((data.structure_type === 'Ombriere_beton' ? (5 * data.nb_poteaux) : 0) * scale);

    let zonesToDraw = [];

    if (isMultiZone) {
        if (penteType === 'Multipente' && nbPans > 1) {
            const panHeight = scaledRoofHeight / nbPans;
            const maxPVHeightY = (data.count_y1 * data.module_y_mm + (data.count_y1 - 1) * data.intermodule_y) * scale;

            for (let i = 1; i <= nbPans; i++) {
                const zone_y_start = roofStartY + panHeight * (i - 1);
                const zone_y_end = roofStartY + panHeight * i;
                const offset_y = zone_y_start + (panHeight - maxPVHeightY) / 2;

                let clip_start = zone_y_start;
                let clip_end = zone_y_end;

                if (i % 2 === 0) clip_start += faitageWidthPX / 2;
                if (i % 2 !== 0 && i < nbPans) clip_end -= faitageWidthPX / 2;

                if (clip_end - clip_start < maxPVHeightY) continue;

                const isDownwardPente = (i % 2 === 0);
                let shouldDraw = false;
                if (pvToiturePosition === 'PV1_PV2') shouldDraw = true;
                else if (pvToiturePosition === 'PV1' && (i === 1 || i === nbPans)) shouldDraw = true;
                else if (pvToiturePosition === 'PV2' && (i > 1 && i < nbPans)) shouldDraw = true;

                if (shouldDraw) {
                    zonesToDraw.push({
                        y_start: clip_start, y_end: clip_end, y_offset: offset_y,
                        count_y_zone: data.count_y1, pv_label: `PV${i}`,
                        isDownwardPente: isDownwardPente
                    });
                }
            }
        } else {
            const maxPVHeightY1 = (data.count_y1 * data.module_y_mm + (data.count_y1 - 1) * data.intermodule_y) * scale;
            const maxPVHeightY2 = (data.count_y2 * data.module_y_mm + (data.count_y2 - 1) * data.intermodule_y) * scale;

            const pv1_y_start = faitageY1 + faitageWidthPX / 2;
            const pv1_y_end = roofStartY + scaledRoofHeight;
            const offset1 = pv1_y_start + (pv1_y_end - pv1_y_start - maxPVHeightY1) / 2;

            const pv2_y_start = roofStartY;
            const pv2_y_end = faitageY1 - faitageWidthPX / 2;
            const offset2 = pv2_y_start + (pv2_y_end - pv2_y_start - maxPVHeightY2) / 2;

            if (pvToiturePosition === 'PV1_PV2' || pvToiturePosition === 'PV1') {
                zonesToDraw.push({
                    y_start: pv1_y_start, y_end: pv1_y_end, y_offset: offset1,
                    count_y_zone: data.count_y1, pv_label: 'PV1', isDownwardPente: true
                });
            }
            if (pvToiturePosition === 'PV1_PV2' || pvToiturePosition === 'PV2') {
                zonesToDraw.push({
                    y_start: pv2_y_start, y_end: pv2_y_end, y_offset: offset2,
                    count_y_zone: data.count_y2, pv_label: 'PV2', isDownwardPente: false
                });
            }
        }

        zonesToDraw.forEach(zone => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(gridStartXBase, zone.y_start, gridWidthBase, zone.y_end - zone.y_start);
            ctx.clip();
            drawPVGrid(
                gridStartXBase, zone.y_offset,
                data.count_x, zone.count_y_zone,
                data.module_x_mm, data.module_y_mm,
                data.intermodule_x, data.intermodule_y,
                data.joint_apres_colonnes || [],
                zone.pv_label,
                zone.isDownwardPente
            );
            ctx.restore();
        });

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        if (penteType === 'Multipente' && nbPans > 1) {
            const panHeight = scaledRoofHeight / nbPans;
            const nbFaitages = Math.floor(nbPans / 2);
            for (let i = 1; i <= nbFaitages; i++) {
                const faitageY = roofStartY + panHeight * i * 2;
                ctx.fillRect(roofStartX, faitageY - faitageWidthPX / 2, scaledRoofWidth, faitageWidthPX);
            }
        } else if (penteType !== 'Monopente') {
            ctx.fillRect(roofStartX, faitageY1 - faitageWidthPX / 2, scaledRoofWidth, faitageWidthPX);
        }
        ctx.restore();

    } else {
        const totalHeightPX = (data.count_y1 * data.module_y_mm + (data.count_y1 - 1) * data.intermodule_y) * scale;
        const offset = roofStartY + (scaledRoofHeight - totalHeightPX) / 2;
        drawPVGrid(
            gridStartXBase, offset,
            data.count_x, data.count_y1,
            data.module_x_mm, data.module_y_mm,
            data.intermodule_x, data.intermodule_y,
            data.joint_apres_colonnes || [],
            data.pv_number || 'PV1',
            true
        );
    }

    function drawDimensionLine(x1, y1, x2, y2, text, textOffset = 10, align = 'center') {
        ctx.save();
        ctx.strokeStyle = '#111827';
        ctx.fillStyle = '#111827';
        ctx.lineWidth = 1;
        ctx.font = '14px sans-serif';
        ctx.textAlign = align;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (y1 === y2) {
            ctx.moveTo(x1, y1 - 4); ctx.lineTo(x1, y1 + 4);
            ctx.moveTo(x2, y2 - 4); ctx.lineTo(x2, y2 + 4);
        } else {
            ctx.moveTo(x1 - 4, y1); ctx.lineTo(x1 + 4, y1);
            ctx.moveTo(x2 - 4, y2); ctx.lineTo(x2 + 4, y2);
        }
        ctx.stroke();

        if (y1 === y2) {
            ctx.fillText(text, (x1 + x2) / 2, y1 - textOffset);
        } else {
            ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(text, 0, -textOffset);
        }
        ctx.restore();
    }

    if (isToitureDisplayVisible && toiture_length_mm > 0 && toiture_width_mm > 0) {
        drawDimensionLine(roofStartX, roofStartY - 25, roofStartX + scaledRoofWidth, roofStartY - 25,
            `Long. Toiture = ${data.toiture_length_m.toFixed(2)} m`);
        drawDimensionLine(roofStartX - 25, roofStartY, roofStartX - 25, roofStartY + scaledRoofHeight,
            `Larg. Toiture = ${data.toiture_width_m.toFixed(2)} m`, 12);
    }
    if (isPVDisplayVisible) {
        drawDimensionLine(pvStartX, roofStartY + scaledRoofHeight + 25, pvStartX + scaledPVWidth, roofStartY + scaledRoofHeight + 25,
            `Long. champ PV = ${data.total_length_m.toFixed(2)} m`);
        drawDimensionLine(pvStartX + scaledPVWidth + 50, pvStartY, pvStartX + scaledPVWidth + 50, pvStartY + scaledPVHeight,
            `Larg. champ PV = ${data.total_width_m.toFixed(2)} m`, 12);
    }

    const paddingBottom = 60;
    const finalHeightForCapture = Math.max(500, roofStartY + scaledRoofHeight + paddingBottom);
    if (pdfCaptureArea) {
        pdfCaptureArea.style.height = `${finalHeightForCapture}px`;
    }
}

function calculateCalepinageLocal(data) {
    const INITIAL_DIM_X = 1762;
    const INITIAL_DIM_Y = 1134;

    const mode = data.mode || "Portrait";
    const dim_x_base = parseFloat(data.panel_dim_x) || INITIAL_DIM_X;
    const dim_y_base = parseFloat(data.panel_dim_y) || INITIAL_DIM_Y;

    const toiture_length_m = parseFloat(data.toiture_length_m) || 0;
    const toiture_width_m = parseFloat(data.toiture_width_m) || 0;
    const toiture_length_mm = toiture_length_m * 1000;
    const toiture_width_mm = toiture_width_m * 1000;

    const pente_type = data.pente_type || "Monopente";
    const asymetrie_percent = (parseFloat(data.asymetrie_percent) || 50) / 100;
    const largeur_faitage_mm = parseFloat(data.largeur_faitage_mm) || 0;
    const nb_pans = parseInt(data.nb_pentes) || 1;

    let module_x_mm, module_y_mm;
    if (mode === "Portrait") {
        module_x_mm = dim_y_base;
        module_y_mm = dim_x_base;
    } else {
        module_x_mm = dim_x_base;
        module_y_mm = dim_y_base;
    }

    const count_x1 = parseInt(data.count_x1) || 0;
    const count_y1 = parseInt(data.count_y1) || 0;
    let count_x2 = count_x1;
    let count_y2 = count_y1;

    const is_multi_zone = ["Bipente_symetrique", "Bipente_asymetrique", "Multipente"].includes(pente_type);

    if (is_multi_zone && pente_type === "Bipente_asymetrique") {
        count_x2 = parseInt(data.count_x2) || count_x1;
        count_y2 = parseInt(data.count_y2) || count_y1;
    }

    const count_x = Math.max(count_x1, count_x2);

    const power_unit = parseFloat(data.power_unit) || 0;
    const intermodule_x = parseFloat(data.intermodule_x) || 0;
    const intermodule_y = parseFloat(data.intermodule_y) || 0;
    const joint_dilatation = parseFloat(data.joint_dilatation) || 0;
    const limit_dilatation_m = parseFloat(data.limit_dilatation_m) || 0;
    const limit_dilatation_mm = limit_dilatation_m * 1000;
    const delta_y = parseFloat(data.delta_l) || 0;
    const delta_x = parseFloat(data.delta_w) || 0;

    let poteaux_compensation_mm = 0;
    const structure_type = data.structure_type || "";
    if (structure_type === "Ombriere_beton") {
        const nb_poteaux = parseFloat(data.nb_poteaux) || 0;
        poteaux_compensation_mm = 5 * nb_poteaux;
    }

    let total_panels = 0;
    let total_width_modules_mm = 0;

    if (pente_type === "Monopente") {
        total_panels = count_x1 * count_y1;
        total_width_modules_mm = (count_y1 * module_y_mm) + Math.max(0, count_y1 - 1) * intermodule_y;
    } else if (pente_type === "Bipente_symetrique" || pente_type === "Bipente_asymetrique") {
        total_panels = (count_x1 * count_y1) + (count_x2 * count_y2);
        const width_y1 = (count_y1 * module_y_mm) + Math.max(0, count_y1 - 1) * intermodule_y;
        const width_y2 = (count_y2 * module_y_mm) + Math.max(0, count_y2 - 1) * intermodule_y;
        total_width_modules_mm = width_y1 + width_y2 + largeur_faitage_mm;
    } else if (pente_type === "Multipente") {
        const width_per_pan = (count_y1 * module_y_mm) + Math.max(0, count_y1 - 1) * intermodule_y;
        const nb_faitages = Math.floor(nb_pans / 2);
        total_panels = nb_pans * (count_x1 * count_y1);
        total_width_modules_mm = (nb_pans * width_per_pan) + (nb_faitages * largeur_faitage_mm);
    }

    const total_power_wc = total_panels * power_unit;
    const length_modules_mm_x = (count_x * module_x_mm) + Math.max(0, count_x - 1) * intermodule_x;

    // Joints de dilatation — MÊME RÈGLE que le moteur du calepinage (calepinage_maison_calculs.js ::
    // decouperEnTroncons / placerColonnesAvecJoints) : aucun tronçon ne dépasse la longueur limite,
    // répartition égale (défaut) ou coupée à la limite (case « Couper à la longueur limite » du
    // formulaire, transmise par data.joint_repartition), et au joint la largeur du joint REMPLACE
    // l'espacement X. La longueur totale de l'ombrière comprend donc la largeur de tous les joints.
    // `joint_apres_colonnes` : n° (1..count_x-1) des colonnes suivies d'un joint, pour le dessin.
    let nb_joints = 0;
    const joint_positions_x_mm = [];
    const joint_apres_colonnes = [];
    if (joint_dilatation > 0 && limit_dilatation_mm > 0 && count_x > 1) {
        const longueurTroncon = (k) => k * module_x_mm + Math.max(0, k - 1) * intermodule_x;
        let troncons;
        if (data.joint_repartition === 'limite') {
            const parTroncon = Math.max(1, Math.floor((limit_dilatation_mm + intermodule_x + 1e-6) / (module_x_mm + intermodule_x)));
            troncons = [];
            for (let reste = count_x; reste > 0; reste -= parTroncon) troncons.push(Math.min(parTroncon, reste));
        } else {
            let nb = Math.max(1, Math.ceil(longueurTroncon(count_x) / limit_dilatation_mm - 1e-9));
            while (nb < count_x && longueurTroncon(Math.ceil(count_x / nb)) > limit_dilatation_mm + 1e-6) nb += 1;
            const base = Math.floor(count_x / nb), reste = count_x % nb;
            troncons = Array.from({ length: nb }, (_, i) => base + (i < reste ? 1 : 0));
        }
        let colonnes = 0;
        troncons.slice(0, -1).forEach((k) => {
            colonnes += k;
            joint_apres_colonnes.push(colonnes);
            // Abscisse (mm) du début du joint depuis le 1er panneau.
            joint_positions_x_mm.push(colonnes * module_x_mm + (colonnes - 1 - nb_joints) * intermodule_x + nb_joints * joint_dilatation);
            nb_joints += 1;
        });
    }

    const total_length_mm = length_modules_mm_x - (nb_joints * intermodule_x) + (nb_joints * joint_dilatation)
        + delta_x + poteaux_compensation_mm;
    const total_width_mm = total_width_modules_mm + delta_y;

    const nb_identical = parseInt(data.nb_identical) || 1;
    const total_length_m = total_length_mm / 1000;
    const total_width_m = total_width_mm / 1000;

    const total_panels_multiplied = total_panels * nb_identical;
    const total_power_kwc_multiplied = (total_power_wc / 1000) * nb_identical;

    let npv_detail_text = "";
    if (pente_type === "Bipente_asymetrique") {
        npv_detail_text = `${count_x1}x${count_y1} + ${count_x2}x${count_y2}`;
    } else if (is_multi_zone) {
        npv_detail_text = `${nb_pans} pans x (${count_x1}x${count_y1})`;
    } else {
        npv_detail_text = `${count_x1}x${count_y1}`;
    }

    const panel_ref = data.panel_ref || "Non spécifiée";
    const etn_check = data.etn_check || "non";
    let etn_message_short = "";
    let show_etn_warning = false;

    if (etn_check === "non") {
            etn_message_short = `La référence du panneau utilisée (${panel_ref}) n'a pas été vérifiée dans la liste des panneaux intégrés à l'ETN/ATec du système d'intégration. Veuillez contacter le fournisseur du système d'intégration afin de valider ce point avant l'exécution de votre projet.`;
        show_etn_warning = true;
    } else {
            etn_message_short = `La référence du panneau utilisée (${panel_ref}) pour ce projet est intégrée dans la liste des modules validés dans le cadre de l'ETN/ATec du système d'intégration choisi.`;
        show_etn_warning = false;
    }

    return {
        total_length_m: parseFloat(total_length_m.toFixed(2)),
        total_width_m: parseFloat(total_width_m.toFixed(2)),
        total_length_mm: total_length_mm,
        total_width_mm: total_width_mm,
        toiture_length_m: toiture_length_m,
        toiture_width_m: toiture_width_m,
        toiture_length_mm: toiture_length_mm,
        toiture_width_mm: toiture_width_mm,
        total_panels: total_panels,
        total_panels_multiplied: total_panels_multiplied,
        total_power_kwc: parseFloat((total_power_wc / 1000).toFixed(2)),
        total_power_kwc_multiplied: parseFloat(total_power_kwc_multiplied.toFixed(2)),
        npv_detail_text: npv_detail_text,
        npv_display: `(${npv_detail_text}) x ${nb_identical} = ${total_panels_multiplied}`,
        nb_joints: nb_joints,
        joint_positions_x_mm: joint_positions_x_mm,
        joint_apres_colonnes: joint_apres_colonnes,
        module_x_mm: module_x_mm,
        module_y_mm: module_y_mm,
        dim_pv_display: `${INITIAL_DIM_X} mm X ${INITIAL_DIM_Y} mm`,
        largeur_faitage_mm: largeur_faitage_mm,
        asymetrie_percent: asymetrie_percent,
        pente_type: pente_type,
        nb_pans: nb_pans,
        is_multi_zone: is_multi_zone,
        count_x1: count_x1, count_y1: count_y1,
        count_x2: count_x2, count_y2: count_y2,
        count_x: count_x,
        delta_w: delta_x,
        delta_l: delta_y,
        intermodule_x: intermodule_x,
        intermodule_y: intermodule_y,
        joint_dilatation: joint_dilatation,
        etn_check: etn_check,
        etn_message_short: etn_message_short,
        show_etn_warning: show_etn_warning
    };
}

async function calculateAndDraw() {
    const formData = {
        mode: document.querySelector('input[name="mode"]:checked').value,
        panel_dim_x: parseFloat(document.getElementById('panel_dim_x').value),
        panel_dim_y: parseFloat(document.getElementById('panel_dim_y').value),
        toiture_length_m: parseFloat(document.getElementById('toiture_dim_l').value) || 0,
        toiture_width_m: parseFloat(document.getElementById('toiture_dim_w').value) || 0,
        pente_type: document.getElementById('toiture_pente_type').value,
        asymetrie_percent: parseFloat(document.getElementById('asymetrie_percent').value) || 50,
        largeur_faitage_mm: parseFloat(document.getElementById('largeur_faitage_mm').value) || 0,
        nb_pentes: parseInt(document.getElementById('nb_pentes').value) || 1,
        count_x1: parseInt(document.getElementById('count_x').value) || 0,
        count_y1: parseInt(document.getElementById('count_y').value) || 0,
        count_x2: parseInt(document.getElementById('count_x2').value) || 0,
        count_y2: parseInt(document.getElementById('count_y2').value) || 0,
        power_unit: parseFloat(document.getElementById('power_unit').value) || 0,
        intermodule_x: parseFloat(document.getElementById('intermodule_x').value) || 0,
        intermodule_y: parseFloat(document.getElementById('intermodule_y').value) || 0,
        joint_dilatation: parseFloat(document.getElementById('joint_dilatation').value) || 0,
        // Répartition des joints choisie dans le formulaire du calepinage (posée par
        // calepinage_maison_configurateur_ombriere.js::injecterDansConfigurateur).
        joint_repartition: document.documentElement.dataset.jointRepartition || 'egale',
        limit_dilatation_m: parseFloat(document.getElementById('limit_dilatation').value) || 0,
        delta_w: parseFloat(document.getElementById('delta_w').value) || 0,
        delta_l: parseFloat(document.getElementById('delta_l').value) || 0,
        structure_type: document.getElementById('type').value,
        nb_poteaux: parseFloat(document.getElementById('nb_poteaux').value) || 0,
        nb_identical: parseInt(document.getElementById('nb_identical').value) || 1,
        pv_number: document.getElementById('pv_number').value || 'PV1',
        panel_ref: document.getElementById('panel_ref').value || 'Non spécifiée',
        etn_check: document.querySelector('input[name="etn_check"]:checked').value,
    };

    try {
        const data = calculateCalepinageLocal(formData);

        document.getElementById('total-panels-all').textContent = data.total_panels_multiplied;
        document.getElementById('total-power-all').textContent = `${data.total_power_kwc_multiplied.toFixed(2)} kWc`;
        document.getElementById('npv-detail').textContent = data.npv_display;
        document.getElementById('total-length-overlay').textContent = `${data.total_length_m.toFixed(2)} m`;
        document.getElementById('total-width-overlay').textContent = `${data.total_width_m.toFixed(2)} m`;
        document.getElementById('current-power-overlay').textContent = `${data.total_power_kwc_multiplied.toFixed(2)} kWc`;

        const etnMessageOverlay = document.getElementById('etn-message-overlay');
        const etnMessageContent = document.getElementById('etn-message-content');
        etnMessageContent.textContent = data.etn_message_short;
        if (data.show_etn_warning) {
            etnMessageOverlay.classList.remove('hidden');
        } else {
            etnMessageOverlay.classList.add('hidden');
        }

        const toggleBtn = document.getElementById('toggle-pv-toiture-btn');
        if (data.is_multi_zone && isPVDisplayVisible) {
            toggleBtn.classList.remove('hidden');
        } else {
            toggleBtn.classList.add('hidden');
        }

        drawCanvas(data);
        positionNorthPointer();

        // Synchronisation avec l'ombrière (page parent)
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'CALEPINAGE_UPDATE',
                width: data.total_width_m,   // largeur du champ PV (pour le plan de coupe)
                length: data.total_length_m, // longueur du champ PV (pour le plan de façade)
                toitureLongueur: parseFloat(document.getElementById('toiture_dim_l')?.value) || 0,
                toitureLargeur: parseFloat(document.getElementById('toiture_dim_w')?.value) || 0,
            }, '*');
        }
    } catch (error) {
        console.error('Erreur lors du calcul :', error);
    }
}

// Réception des dimensions et de l'inclinaison depuis la géométrie parente
window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SET_TOITURE_DIMS') {
        const l = Number(event.data.longueur);
        const w = Number(event.data.largeur);
        if (isNaN(l) || isNaN(w)) return;

        const pente = parseFloat(document.getElementById('pente').value) || 0;
        let tMax = Math.max(l, w);
        let tMin = Math.min(l, w);
        let realWidth = tMin;
        if (pente > 0) {
            realWidth = tMin / Math.max(Math.cos(pente * Math.PI / 180), 0.1);
        }
        tMax = Math.round((tMax + Number.EPSILON) * 100) / 100;
        realWidth = Math.round((realWidth + Number.EPSILON) * 100) / 100;

        const dimL = document.getElementById('toiture_dim_l');
        const dimW = document.getElementById('toiture_dim_w');
        let changed = false;
        if (dimL && Number(dimL.value) !== tMax) { dimL.value = tMax; changed = true; }
        if (dimW && Number(dimW.value) !== realWidth) { dimW.value = realWidth; changed = true; }
        if (changed) {
            if (dimL) dimL.dispatchEvent(new Event('change', { bubbles: true }));
            if (dimW) dimW.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    if (event.data.type === 'SET_INCLINAISON') {
        const value = Number(event.data.value);
        if (isNaN(value)) return;
        const input = document.getElementById('pente');
        // Prévenir les boucles infinies de mise à jour
        if (input && Number(input.value) !== value) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
});

// Écouteur pour synchroniser si le localStorage est mis à jour depuis le parent
window.addEventListener('storage', (e) => {
    if (e.key === 'solarProjectData') {
        syncFromLocalStorage();
    }
});