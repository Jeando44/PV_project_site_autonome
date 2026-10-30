// import { updatePvTable } from './main_calepinage.js';


/** 
 * Hooks globaux permettant la communication bi-directionnelle avec l'application hôte
 * (Récupération des cotes réelles et déclenchement du redessin asynchrone)
 */
window.getRealPvDimensions = function (rectId) {
    const lInput = document.querySelector(`#dimensionsChampPVlongueur-${rectId}`) || document.getElementById('dimensionsChampPVlongueur');
    const wInput = document.querySelector(`#dimensionsChampPVlargeur-${rectId}`) || document.getElementById('dimensionsChampPVlargeur');
    return {
        finalLength: lInput ? parseFloat(lInput.value || lInput.dataset.baseValue || 0) : 0,
        finalWidth: wInput ? parseFloat(wInput.value || wInput.dataset.baseValue || 0) : 0
    };
};

window.refreshPostAxes = function (pvId) {
    if (window.drawingControl && window.drawingControl.drawnShapes) {
        const shape = window.drawingControl.drawnShapes.find(s => s.pvId === pvId);
        if (shape) {
            if (shape.type.includes('SolarRectangle') && window.drawingControl.solarRectangle) window.drawingControl.solarRectangle.updatePostAxes(shape);
            else if (shape.type.includes('LineToPolygon') && window.drawingControl.lineToPolygon) window.drawingControl.lineToPolygon.updatePostAxes(shape);
        }
    }
};

export class PostAxesManager {
    constructor(map) {
        this.map = map;
        this.configs = {}; // Stockage des configurations par rectId
        this.handles = {}; // Marqueurs (icônes d'ancrage) par rectId
        this.posts = {};   // Poteaux dessinés par rectId
        this.currentRectId = null;
        this.initModal();
    }

    defaultConfig() {
        return {
            transversal: 'center', // 'center' ou 'excenter'
            transversalOffset: 0,
            rampant: '1', // '1' (Monopoteau), '2', '3'
            entraxeRampant: 5,
            pfAuto: true,
            pfGauche: 1,
            pfDroite: 1,
            entraxesLong: '3*5',
            maxEntraxeX: 10,
            maxEntraxeY: 4,
            shape: 'circle', // 'rect', 'circle', 'square'
            showLinesLong: false,
            showLinesTrans: false,
            showPosts: false // Désactivé par défaut
        };
    }

    initModal() {
        this.modalOverlay = document.createElement('div');
        this.modalOverlay.style.cssText = `
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 100000; justify-content: center; align-items: center;
        `;

        this.modalContent = document.createElement('div');
        this.modalContent.style.cssText = `
            pointer-events: auto;
            background: white; padding: 25px 30px; border-radius: 8px; width: 850px; max-width: 95vw;
            max-height: 90vh; overflow-y: auto; overflow-x: hidden; box-sizing: border-box;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25); font-family: inherit; font-size: 14px;
        `;

        this.modalContent.innerHTML = `
            <div class="modal-header-axe" style="cursor: move; user-select: none; border-bottom: 2px solid #e74c3c; padding-bottom: 10px; margin-bottom: 15px;">
                <h3 style="margin:0; color: #04374f;">Configuration des axes des poteaux</h3>
            </div>
            
            <div id="post-real-dimensions" style="margin-bottom: 20px; padding: 10px 15px; background-color: #e8f4f8; border-left: 4px solid #3498db; border-radius: 4px; font-weight: bold; color: #2980b9; font-size: 13px;">
                Dimensions réelles du champ PV : Calcul en cours...
            </div>
            
            <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                <!-- Left Panel: Graphic Preview -->
                <div style="flex: 1; min-width: 300px; border: 1px solid #ccc; border-radius: 4px; background: #f8f9fa; display: flex; flex-direction: column; min-height: 400px;">
                    <div style="padding: 10px; background: #e9ecef; border-bottom: 1px solid #ccc; font-weight: bold; text-align: center; color: #04374f; border-radius: 4px 4px 0 0;">Prévisualisation Temps Réel</div>
                    <div style="flex: 1; position: relative; overflow: hidden; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                        <canvas id="post-preview-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></canvas>
                    </div>
                </div>

                <!-- Right Panel: Controls -->
                <div style="flex: 1; min-width: 300px; display: flex; flex-direction: column;">
                    <div style="margin-bottom: 20px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-weight: bold; color: #04374f; font-size: 15px; margin: 0;">Forme des axes :</label>
                            <label style="cursor: pointer; display:flex; align-items:center; gap:6px; font-weight: bold; color: #04374f; font-size: 14px;">
                                <input type="checkbox" id="post-show-posts" style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: checkbox !important;"> Afficher poteaux
                            </label>
                        </div>
                        <div style="display:flex; flex-direction:row; gap:20px; align-items:center; justify-content:flex-start;">
                            <label style="cursor: pointer; display:flex; align-items:center; gap:6px; font-size: 12px;" title="Cercle">
                                <input type="radio" name="post-shape" value="circle" checked style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: radio !important;"> 
                                <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" stroke="#04374f" stroke-width="2" fill="none"/></svg>
                                Cercle
                            </label>
                            <label style="cursor: pointer; display:flex; align-items:center; gap:6px; font-size: 12px;" title="Rectangle">
                                <input type="radio" name="post-shape" value="rect" style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: radio !important;"> 
                                <svg width="22" height="14" viewBox="0 0 22 14" style="transform: rotate(90deg); transform-origin: center; display: block;"><rect x="1" y="1" width="20" height="12" stroke="#04374f" stroke-width="2" fill="none"/></svg>
                                Rectangle
                            </label>
                            <label style="cursor: pointer; display:flex; align-items:center; gap:6px; font-size: 12px;" title="Carré">
                                <input type="radio" name="post-shape" value="square" style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: radio !important;"> 
                                <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" stroke="#04374f" stroke-width="2" fill="none"/></svg>
                                Carré
                            </label>
                        </div>
                    </div>

                    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                        <div style="flex: 1;">
                            <label style="font-weight: bold; display: block; margin-bottom: 5px;">Position transversale :</label>
                            <select id="post-transversal" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                                <option value="center">Centrés</option>
                                <option value="excenter">Excentrés</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="font-weight: bold; display: block; margin-bottom: 5px;">Config. rampant :</label>
                            <select id="post-rampant" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                                <option value="1">Monopoteau</option>
                                <option value="2">Double poteaux</option>
                                <option value="3">Triple poteaux</option>
                            </select>
                        </div>
                    </div>

                    <div id="post-transversal-offset-container" style="display:none; margin-bottom: 20px;">
                        <label style="font-weight: bold; display: block; margin-bottom: 5px;">Décalage depuis le bord (m) :</label>
                        <input type="number" id="post-transversal-offset" value="0" step="0.1" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>

                    <div id="post-entraxe-rampant-container" style="display:none; margin-bottom: 20px;">
                        <label style="font-weight: bold; display: block; margin-bottom: 5px;">Entraxe rampant (m) :</label>
                        <input type="number" id="post-entraxe-rampant" value="5" step="0.1" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>

                    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <label style="font-weight: bold; display: block; margin: 0;">Porte-à-faux Gauche (m):</label>
                                <label style="font-size: 11px; display:flex; align-items:center; gap:4px; cursor: pointer;">
                                    <input type="checkbox" id="post-pf-auto" checked style="margin:0;"> Auto
                                </label>
                            </div>
                            <input type="number" id="post-pf-gauche" value="1" step="0.1" disabled style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px; background: #f0f0f0;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-weight: bold; display: block; margin-bottom: 5px;">Porte-à-faux Droite (m):</label>
                            <input type="number" id="post-pf-droite" value="1" step="0.1" disabled style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px; background: #f0f0f0;">
                        </div>
                    </div>

                    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                        <div style="flex: 1;">
                            <label style="font-weight: bold; display: block; margin-bottom: 5px;" title="Garde-fou au déplacement (m)">Entraxe max X (m) :</label>
                            <input type="number" id="post-max-entraxe-x" value="10" min="0.1" step="0.1" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-weight: bold; display: block; margin-bottom: 5px;" title="Garde-fou au déplacement (m)">Entraxe max Y (m) :</label>
                            <input type="number" id="post-max-entraxe-y" value="4" min="0.1" step="0.1" style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="font-weight: bold; display: block; margin-bottom: 5px;">Entraxes longitudinaux (ex: 3*10+5) :</label>
                        <input type="text" id="post-entraxes-long" value="3*5" placeholder="Formule..." style="width:100%; padding:8px; border: 1px solid #ccc; border-radius: 4px;">
                        <div id="post-validation-msg" style="font-size: 13px; margin-top: 8px; font-weight: bold; line-height: 1.4;"></div>
                    </div>

                    <div style="margin-top: auto; padding-top: 15px; border-top: 1px solid #eee; text-align: left;">
                        <label style="font-weight: bold; color: #04374f; margin-bottom: 10px; display: block;">Affichage des axes :</label>
                        <div style="display: flex; border: 1px solid white; border-radius: 4px; flex-direction: column; align-items: flex-start; gap: 10px; margin-bottom: 10px;">
                            <label style="cursor: pointer; display:flex; align-items:center; gap:8px; font-weight: bold; color: #04374f;">
                                <input type="checkbox" id="post-show-lines-trans" style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: checkbox !important;"> Axes verticaux
                            </label>
                            <label style="cursor: pointer; display:flex; align-items:center; gap:8px; font-weight: bold; color: #04374f;">
                                <input type="checkbox" id="post-show-lines-long" style="display: block !important; margin: 0; width: 16px; height: 16px; opacity: 1 !important; position: static !important; appearance: checkbox !important;"> Axes horizontaux
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 15px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px;">
                <button id="post-btn-cancel" style="padding: 8px 16px; cursor: pointer; background: #95a5a6; color: white; border: none; border-radius: 4px; font-weight: bold;">Annuler</button>
                <button id="post-btn-save" style="padding: 8px 16px; cursor: pointer; background: #e74c3c; color: white; border: none; border-radius: 4px; font-weight: bold;">Valider</button>
            </div>
        `;

        this.modalOverlay.appendChild(this.modalContent);
        document.body.appendChild(this.modalOverlay);

        this._bindModalEvents();
    }

    _bindModalEvents() {
        // Registered first so stopImmediatePropagation() blocks all subsequent keydown handlers
        // (including document-level capturing listeners from Google Maps that intercept + and *)
        const entraxesLongInput = this.modalContent.querySelector('#post-entraxes-long');
        if (entraxesLongInput) {
            entraxesLongInput.addEventListener('keydown', function(e) {
                if (e.key === '*' || e.key === '+') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    this.value = this.value.slice(0, start) + e.key + this.value.slice(end);
                    this.selectionStart = this.selectionEnd = start + 1;
                    this.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        }

        const transversal = this.modalContent.querySelector('#post-transversal');
        const transOffsetContainer = this.modalContent.querySelector('#post-transversal-offset-container');
        transversal.addEventListener('change', () => {
            transOffsetContainer.style.display = transversal.value === 'excenter' ? 'block' : 'none';
        });

        const rampant = this.modalContent.querySelector('#post-rampant');
        const entraxeRampantContainer = this.modalContent.querySelector('#post-entraxe-rampant-container');
        rampant.addEventListener('change', () => {
            entraxeRampantContainer.style.display = rampant.value === '1' ? 'none' : 'block';
        });


        const pfAutoCheckbox = this.modalContent.querySelector('#post-pf-auto');
        const pfGaucheInput = this.modalContent.querySelector('#post-pf-gauche');
        const pfDroiteInput = this.modalContent.querySelector('#post-pf-droite');

        pfAutoCheckbox.addEventListener('change', (e) => {
            pfGaucheInput.disabled = e.target.checked;
            pfDroiteInput.disabled = e.target.checked;
            pfGaucheInput.style.background = e.target.checked ? '#f0f0f0' : '#fff';
            pfDroiteInput.style.background = e.target.checked ? '#f0f0f0' : '#fff';
            this._triggerLiveUpdate(e);
        });

        // Événements universels pour la mise à jour "Live"
        const allInputsAndSelects = this.modalContent.querySelectorAll('input, select');
        allInputsAndSelects.forEach(el => {
            if (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') {
                el.addEventListener('change', (e) => this._triggerLiveUpdate(e));
            } else {
                el.addEventListener('input', (e) => this._triggerLiveUpdate(e));
            }
        });

        this.modalContent.querySelector('#post-btn-cancel').onclick = () => {
            if (this.initialConfig) {
                this.configs[this.currentRectId] = this.initialConfig; // Annule les modifications Live
                if (window.refreshPostAxes) {
                    window.refreshPostAxes(this.currentRectId);
                }
            }
            this.modalOverlay.style.display = 'none';
        };

        this.modalContent.querySelector('#post-btn-save').onclick = () => {
            this.saveConfig(true);
        };

        // Logique de déplacement (Drag & Drop)
        const header = this.modalContent.querySelector('.modal-header-axe');
        let isDragging = false, startX, startY;
        this.modalCurrentX = 0; this.modalCurrentY = 0;
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - this.modalCurrentX;
            startY = e.clientY - this.modalCurrentY;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.modalCurrentX = e.clientX - startX;
            this.modalCurrentY = e.clientY - startY;
            this.modalContent.style.transform = `translate(${this.modalCurrentX}px, ${this.modalCurrentY}px)`;
        });
        document.addEventListener('mouseup', () => { isDragging = false; });
    }

    _triggerLiveUpdate(e) {
        const sourceId = e ? e.target.id : null;
        this._validateLogic(sourceId);
        this._drawPreview();
        this.saveConfig(false);
    }

    parseEntraxes(str) {
        if (!str) return []; // Retourne un tableau vide si la chaîne est vide ou nulle
        // Accepter 'x' ou 'X' comme équivalent à '*' et nettoyer la chaîne
        str = String(str).replace(/[xX]/g, '*').replace(/[^0-9*+.,]/g, '').replace(/,/g, '.');
        let parts = str.split('+');
        let result = [];
        for (let p of parts) {
            if (p.includes('*')) {
                let [count, val] = p.split('*');
                count = parseInt(count);
                // CORRECTION: Si la valeur après '*' est vide ou invalide, on l'ignore pour ne pas vider le canvas.
                if (val.trim() === '') continue;
                
                const numVal = parseFloat(val);
                if (!isNaN(count) && count > 0 && !isNaN(numVal) && numVal > 0) {
                    for (let i = 0; i < count; i++) result.push(numVal);
                }
            } else {
                let val = parseFloat(p);
                if (!isNaN(val) && val > 0) result.push(val);
            }
        }
        return result;
    }

    _compressEntraxes(arr) {
        if (!arr || arr.length === 0) return '';
        let res = [];
        let currentVal = parseFloat(arr[0]);
        let count = 1;
        for (let i = 1; i < arr.length; i++) {
            let val = parseFloat(arr[i]);
            if (val === currentVal && !isNaN(val)) {
                count++;
            } else {
                res.push(count > 1 ? `${count}*${currentVal}` : currentVal);
                currentVal = val;
                count = 1;
            }
        }
        res.push(count > 1 ? `${count}*${currentVal}` : currentVal);
        return res.join('+');
    }

    _validateLogic(sourceId = null) {
        if (!this.currentRectId) return;

        let L_reelle = 0;
        if (window.getRealPvDimensions) {
            const dims = window.getRealPvDimensions(this.currentRectId);
            if (dims && dims.finalLength) L_reelle = dims.finalLength;
        }

        const entraxesStr = this.modalContent.querySelector('#post-entraxes-long').value;

        const entraxes = this.parseEntraxes(entraxesStr);
        const sumEntraxes = entraxes.reduce((a, b) => a + b, 0);

        const isAuto = this.modalContent.querySelector('#post-pf-auto').checked;
        const pfGaucheInput = this.modalContent.querySelector('#post-pf-gauche');
        const pfDroiteInput = this.modalContent.querySelector('#post-pf-droite');
        const msgEl = this.modalContent.querySelector('#post-validation-msg');

        if (isAuto && L_reelle > 0) {
            // CORRECTION: Ajout d'une tolérance de 5cm pour les erreurs de virgule flottante
            if (sumEntraxes <= L_reelle + 0.05) {
                const pfAuto = (L_reelle - sumEntraxes) / 2;
                pfGaucheInput.value = pfAuto.toFixed(2);
                pfDroiteInput.value = pfAuto.toFixed(2);

                msgEl.style.color = '#27ae60';
                msgEl.innerHTML = `✓ Centrage longitudinal automatique<br><span style="font-weight:normal;">Les porte-à-faux ont été calculés à ${pfAuto.toFixed(2)}m.</span>`;
            } else {
                pfGaucheInput.value = 0;
                pfDroiteInput.value = 0;
                msgEl.style.color = '#c0392b';
                msgEl.innerHTML = `⚠️ Dépassement détecté<br><span style="font-weight:normal;">La somme des entraxes (${sumEntraxes.toFixed(2)}m) dépasse la longueur réelle (${L_reelle.toFixed(2)}m).</span>`;
            }
        } else if (!isAuto) {
            const pfG = parseFloat(pfGaucheInput.value) || 0;
            const pfD = parseFloat(pfDroiteInput.value) || 0;
            if (L_reelle > 0 && sumEntraxes + pfG + pfD > L_reelle + 0.05) {
                msgEl.style.color = '#c0392b';
                msgEl.innerHTML = `⚠️ Dépassement détecté<br><span style="font-weight:normal;">Total (${(sumEntraxes + pfG + pfD).toFixed(2)}m) > longueur réelle (${L_reelle.toFixed(2)}m).</span>`;
            } else if (L_reelle > 0) {
                msgEl.style.color = '#f39c12';
                msgEl.innerHTML = `Mode manuel actif<br><span style="font-weight:normal;">Total actuel : ${(sumEntraxes + pfG + pfD).toFixed(2)}m sur ${L_reelle.toFixed(2)}m.</span>`;
            }
        }
    }

    openModal(rectId) {
        this.currentRectId = rectId;
        const cfg = this.configs[rectId] || this.defaultConfig();
        this.initialConfig = JSON.parse(JSON.stringify(cfg)); // Sauvegarde pour annulation

        // MAJ de l'affichage des dimensions réelles
        let L_reelle = 0;
        let W_reelle = 0;
        if (window.getRealPvDimensions) {
            try {
                const dims = window.getRealPvDimensions(rectId);
                if (dims && dims.finalLength && !isNaN(Number(dims.finalLength))) L_reelle = Number(dims.finalLength);
                if (dims && dims.finalWidth && !isNaN(Number(dims.finalWidth))) W_reelle = Number(dims.finalWidth);
            } catch (e) { }
        }
        const dimEl = this.modalContent.querySelector('#post-real-dimensions');
        if (dimEl) {
            if (L_reelle > 0 && W_reelle > 0) {
                dimEl.textContent = `Dimensions réelles du champ PV : L = ${L_reelle.toFixed(2)} m | l = ${W_reelle.toFixed(2)} m`;
            } else {
                dimEl.textContent = `Dimensions réelles du champ PV : Non calculées`;
            }
        }

        this.modalContent.querySelector('#post-transversal').value = cfg.transversal;
        this.modalContent.querySelector('#post-transversal-offset').value = cfg.transversalOffset;
        this.modalContent.querySelector('#post-rampant').value = cfg.rampant;
        this.modalContent.querySelector('#post-entraxe-rampant').value = cfg.entraxeRampant;
        this.modalContent.querySelector('#post-pf-gauche').value = cfg.pfGauche;
        this.modalContent.querySelector('#post-pf-droite').value = cfg.pfDroite;
        this.modalContent.querySelector('#post-entraxes-long').value = cfg.entraxesLong;
        this.modalContent.querySelector('#post-max-entraxe-x').value = cfg.maxEntraxeX !== undefined ? cfg.maxEntraxeX : 10;
        this.modalContent.querySelector('#post-max-entraxe-y').value = cfg.maxEntraxeY !== undefined ? cfg.maxEntraxeY : 4;
        this.modalContent.querySelector(`input[name="post-shape"][value="${cfg.shape}"]`).checked = true;
        this.modalContent.querySelector('#post-show-lines-long').checked = cfg.showLinesLong === true;
        this.modalContent.querySelector('#post-show-lines-trans').checked = cfg.showLinesTrans === true;
        this.modalContent.querySelector('#post-show-posts').checked = cfg.showPosts === true;

        // Force event trigger to adjust UI displays
        this.modalContent.querySelector('#post-transversal').dispatchEvent(new Event('change'));
        this.modalContent.querySelector('#post-rampant').dispatchEvent(new Event('change'));

        // Réinitialiser la position de la modale
        this.modalCurrentX = 0; this.modalCurrentY = 0;
        this.modalContent.style.transform = 'translate(0px, 0px)';

        this.modalOverlay.style.display = 'flex';

        setTimeout(() => {
            this._drawPreview();
        }, 15);
    }

    _drawPreview() {
        const canvas = this.modalContent.querySelector('#post-preview-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let L_reelle = 10, W_reelle = 5;
        if (window.getRealPvDimensions && this.currentRectId) {
            const dims = window.getRealPvDimensions(this.currentRectId);
            if (dims && dims.finalLength && !isNaN(dims.finalLength)) L_reelle = dims.finalLength;
            if (dims && dims.finalWidth && !isNaN(dims.finalWidth)) W_reelle = dims.finalWidth;
        }

        const transversal = this.modalContent.querySelector('#post-transversal').value;
        const transversalOffset = parseFloat(this.modalContent.querySelector('#post-transversal-offset').value) || 0;
        const rampant = this.modalContent.querySelector('#post-rampant').value;
        const entraxeRampant = parseFloat(this.modalContent.querySelector('#post-entraxe-rampant').value) || 0;
        const pfGauche = parseFloat(this.modalContent.querySelector('#post-pf-gauche').value) || 0;
        const entraxesLongStr = this.modalContent.querySelector('#post-entraxes-long').value;
        const shapeNode = this.modalContent.querySelector('input[name="post-shape"]:checked');
        const shape = shapeNode ? shapeNode.value : 'circle';
        const showLinesLong = this.modalContent.querySelector('#post-show-lines-long').checked;
        const showLinesTrans = this.modalContent.querySelector('#post-show-lines-trans').checked;
        const showPosts = this.modalContent.querySelector('#post-show-posts').checked;

        const entraxes = this.parseEntraxes(entraxesLongStr);
        let xPositions = [pfGauche];
        let currentX = pfGauche;
        for (let e of entraxes) {
            currentX += e;
            xPositions.push(currentX);
        }

        let yPositions = [];
        if (transversal === 'center') {
            const centerPos = W_reelle / 2;
            if (rampant === '1') yPositions = [centerPos];
            else if (rampant === '2') yPositions = [centerPos - entraxeRampant / 2, centerPos + entraxeRampant / 2];
            else if (rampant === '3') yPositions = [centerPos - entraxeRampant, centerPos, centerPos + entraxeRampant];
        } else {
            let startY = transversalOffset;
            if (rampant === '1') yPositions = [startY];
            else if (rampant === '2') yPositions = [startY, startY + entraxeRampant];
            else if (rampant === '3') yPositions = [startY, startY + entraxeRampant, startY + entraxeRampant * 2];
        }

        const padding = 30;
        const availW = canvas.width - padding * 2;
        const availH = canvas.height - padding * 2;
        const scaleX = availW / (L_reelle || 1);
        const scaleY = availH / (W_reelle || 1);
        const scale = Math.min(scaleX, scaleY);

        const drawW = L_reelle * scale;
        const drawH = W_reelle * scale;
        const startX = canvas.width / 2 - drawW / 2;
        const startY = canvas.height / 2 - drawH / 2;

        ctx.fillStyle = 'rgba(52, 152, 219, 0.15)';
        ctx.strokeStyle = '#2980b9';
        ctx.lineWidth = 2;
        ctx.fillRect(startX, startY, drawW, drawH);
        ctx.strokeRect(startX, startY, drawW, drawH);

        if (showLinesTrans) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            for (let x of xPositions) { const px = startX + x * scale; ctx.beginPath(); ctx.moveTo(px, startY); ctx.lineTo(px, startY + drawH); ctx.stroke(); }
            ctx.setLineDash([]);
        }
        if (showLinesLong) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            for (let y of yPositions) { const py = startY + y * scale; ctx.beginPath(); ctx.moveTo(startX, py); ctx.lineTo(startX + drawW, py); ctx.stroke(); }
            ctx.setLineDash([]);
        }

        // Affichage des Cotes d'entraxes en Preview
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#e74c3c";

        for (let i = 0; i < entraxes.length; i++) {
            const px1 = startX + xPositions[i] * scale;
            const px2 = startX + xPositions[i + 1] * scale;
            const midX = (px1 + px2) / 2;
            ctx.beginPath(); ctx.moveTo(px1, startY - 12); ctx.lineTo(px2, startY - 12);
            ctx.strokeStyle = "#34495e"; ctx.lineWidth = 1; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px1, startY - 15); ctx.lineTo(px1, startY - 9); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px2, startY - 15); ctx.lineTo(px2, startY - 9); ctx.stroke();
            ctx.fillText(`d = ${entraxes[i]} m`, midX, startY - 14);
        }

        if (yPositions.length > 1) {
            for (let i = 0; i < yPositions.length - 1; i++) {
                const y1 = yPositions[i];
                const y2 = yPositions[i + 1];
                const py1 = startY + y1 * scale;
                const py2 = startY + y2 * scale;
                ctx.beginPath(); ctx.moveTo(startX - 12, py1); ctx.lineTo(startX - 12, py2);
                ctx.strokeStyle = "#34495e"; ctx.lineWidth = 1; ctx.stroke();
                ctx.beginPath(); ctx.moveTo(startX - 15, py1); ctx.lineTo(startX - 9, py1); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(startX - 15, py2); ctx.lineTo(startX - 9, py2); ctx.stroke();
                ctx.save();
                ctx.translate(startX - 14, startY + ((y1 + y2) / 2) * scale);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(`d = ${(y2 - y1).toFixed(2)} m`, 0, 0);
                ctx.restore();
            }
        }

        if (showPosts) {
            ctx.fillStyle = '#E74C3C';
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            for (let x of xPositions) {
                for (let y of yPositions) {
                    const px = startX + x * scale, py = startY + y * scale;
                    ctx.beginPath();
                    if (shape === 'circle') { ctx.arc(px, py, 4, 0, Math.PI * 2); }
                    else if (shape === 'rect') { ctx.rect(px - 3, py - 5, 6, 10); }
                    else { ctx.rect(px - 4, py - 4, 8, 8); }
                    ctx.fill(); ctx.stroke();
                }
            }
        }
    }

    saveConfig(closeModal = true) {
        this.configs[this.currentRectId] = {
            transversal: this.modalContent.querySelector('#post-transversal').value,
            transversalOffset: parseFloat(this.modalContent.querySelector('#post-transversal-offset').value) || 0,
            rampant: this.modalContent.querySelector('#post-rampant').value,
            entraxeRampant: parseFloat(this.modalContent.querySelector('#post-entraxe-rampant').value) || 0,
            pfAuto: this.modalContent.querySelector('#post-pf-auto').checked,
            pfGauche: parseFloat(this.modalContent.querySelector('#post-pf-gauche').value) || 0,
            pfDroite: parseFloat(this.modalContent.querySelector('#post-pf-droite').value) || 0,
            entraxesLong: this.modalContent.querySelector('#post-entraxes-long').value,
            maxEntraxeX: parseFloat(this.modalContent.querySelector('#post-max-entraxe-x').value) || 10,
            maxEntraxeY: parseFloat(this.modalContent.querySelector('#post-max-entraxe-y').value) || 4,
            shape: this.modalContent.querySelector('input[name="post-shape"]:checked').value,
            showLinesLong: this.modalContent.querySelector('#post-show-lines-long').checked,
            showLinesTrans: this.modalContent.querySelector('#post-show-lines-trans').checked,
            showPosts: this.modalContent.querySelector('#post-show-posts').checked
        };
        if (closeModal) {
            this.modalOverlay.style.display = 'none';
        }

        if (window.refreshPostAxes) {
            window.refreshPostAxes(this.currentRectId);
        }
    }

    updateHandle(rf, c) {
        const mid_edge_pos = google.maps.geometry.spherical.interpolate(rf.coords[1], rf.coords[2], 0.5); // Milieu de la largeur
        if (!this.handles[rf.id]) {
            // CORRECTIF (demande explicite) : cette poignée servait auparavant à ouvrir la
            // configuration des axes de poteaux (clic désactivé depuis un bug, jamais réactivé) — elle
            // sert désormais de poignée de rotation du rectangle (glisser pour pivoter), cf. les
            // écouteurs 'dragstart'/'drag'/'dragend' attachés par l'appelant
            // (LineToPolygon.js::_attachRotationHandleDrag).
            this.handles[rf.id] = new google.maps.Marker({
                map: this.map,
                position: mid_edge_pos,
                icon: {
                    url: '/static/concevoir_mon_projet/medias/icons/sync.svg',
                    scaledSize: new google.maps.Size(26, 26),
                    anchor: new google.maps.Point(13, 13)
                },
                title: "Faire pivoter",
                draggable: true,
                cursor: 'grab',
                zIndex: 1050
            });
        } else {
            this.handles[rf.id].setPosition(mid_edge_pos);
        }
    }

    removeHandle(rectId) {
        if (this.handles[rectId]) {
            this.handles[rectId].setMap(null);
            delete this.handles[rectId];
        }
        this.clearPosts(rectId);
    }

    removeRect(rectId) {
        this.removeHandle(rectId);
        delete this.configs[rectId];
    }

    clearPosts(rectId) {
        if (this.posts[rectId]) {
            this.posts[rectId].forEach(p => p.setMap(null));
        }
        this.posts[rectId] = [];
    }

    drawPosts(rf, c) {
        this.clearPosts(rf.id);

        const cfg = this.configs[rf.id] || this.defaultConfig();
        const showLinesLong = cfg.showLinesLong === true;
        const showLinesTrans = cfg.showLinesTrans === true;
        const showPosts = cfg.showPosts === true;

        const D1 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[0], rf.coords[1]);
        const D2 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[0], rf.coords[3]);

        let W_reelle = D2;
        let L_reelle = D1;
        try {
            if (window.getRealPvDimensions) {
                const dims = window.getRealPvDimensions(rf.id);
                if (dims && dims.finalWidth && !isNaN(Number(dims.finalWidth))) {
                    W_reelle = Number(dims.finalWidth);
                }
                if (dims && dims.finalLength && !isNaN(Number(dims.finalLength))) {
                    L_reelle = Number(dims.finalLength);
                }
            }
        } catch (e) {
            console.warn("Erreur lors de la récupération des dimensions réelles:", e);
        }

        const tilt = parseFloat(c['inclinaison']) || 0;
        const L_proj = W_reelle * Math.cos(tilt * Math.PI / 180);

        // Calcul des décalages pour centrer le champ PV réel par rapport au rectangle dessiné sur la carte
        let offsetX = Math.max(0, (D1 - L_reelle) / 2);
        let offsetY = Math.max(0, (D2 - L_proj) / 2);

        // Centrage automatique transversal : Position_Axe = (Largeur_Reelle * cos(Inclinaison)) / 2
        let yPositions = [];
        if (cfg.transversal === 'center') {
            const centerPos = offsetY + (L_proj / 2);
            if (cfg.rampant === '1') yPositions = [centerPos];
            else if (cfg.rampant === '2') yPositions = [centerPos - cfg.entraxeRampant / 2, centerPos + cfg.entraxeRampant / 2];
            else if (cfg.rampant === '3') yPositions = [centerPos - cfg.entraxeRampant, centerPos, centerPos + cfg.entraxeRampant];
        } else {
            let startY = offsetY + cfg.transversalOffset;
            if (cfg.rampant === '1') yPositions = [startY];
            else if (cfg.rampant === '2') yPositions = [startY, startY + cfg.entraxeRampant];
            else if (cfg.rampant === '3') yPositions = [startY, startY + cfg.entraxeRampant, startY + cfg.entraxeRampant * 2];
        }

        const entraxes = this.parseEntraxes(cfg.entraxesLong);

        let xPositions = [offsetX + cfg.pfGauche];
        let currentX = offsetX + cfg.pfGauche;
        for (let e of entraxes) {
            currentX += e;
            xPositions.push(currentX);
        }

        const p0 = rf.coords[0];
        const headingX = google.maps.geometry.spherical.computeHeading(rf.coords[0], rf.coords[1]);
        const headingY = google.maps.geometry.spherical.computeHeading(rf.coords[0], rf.coords[3]);

        if (showLinesLong) {
            // Dessin de la grille (lignes horizontales - longitudinales de l'emprise réelle)
            if (yPositions.length > 0) {
                for (let y of yPositions) {
                    if (isNaN(y)) continue;
                    const pRealStart = google.maps.geometry.spherical.computeOffset(p0, offsetX, headingX);
                    const startPt = google.maps.geometry.spherical.computeOffset(pRealStart, y, headingY);
                    // Traversser jusqu'à la limite longitudinale réelle
                    const endPt = google.maps.geometry.spherical.computeOffset(startPt, L_reelle, headingX);

                    const line = new google.maps.Polyline({
                        map: this.map, path: [startPt, endPt],
                        strokeColor: '#000000', strokeWeight: 1, strokeOpacity: 0.8, zIndex: 1019
                    });
                    this.posts[rf.id].push(line);
                }
            }
        }

        if (showLinesTrans) {
            // Dessin de la grille (lignes verticales - transversales de l'emprise projetée)
            if (xPositions.length > 0) {
                for (let x of xPositions) {
                    if (isNaN(x)) continue;
                    const startPt = google.maps.geometry.spherical.computeOffset(p0, x, headingX);
                    const realYStartPt = google.maps.geometry.spherical.computeOffset(startPt, offsetY, headingY);
                    // Traverser jusqu'à la limite transversale réelle projetée
                    const endPt = google.maps.geometry.spherical.computeOffset(realYStartPt, L_proj, headingY);

                    const line = new google.maps.Polyline({
                        map: this.map, path: [startPt, endPt],
                        strokeColor: '#000000', strokeWeight: 1, strokeOpacity: 0.8, zIndex: 1019
                    });
                    this.posts[rf.id].push(line);
                }
            }
        }

        if (showPosts) {
            // Dessin des lignes de Cotes (Dimensions)
            for (let i = 0; i < entraxes.length; i++) {
                const e = entraxes[i];
                const x1 = xPositions[i];
                const x2 = xPositions[i + 1];
                if (isNaN(x1) || isNaN(x2)) continue;

                const dimOffset = offsetY - 0.8;
                const pDimStart = google.maps.geometry.spherical.computeOffset(p0, x1, headingX);
                const pDimEnd = google.maps.geometry.spherical.computeOffset(p0, x2, headingX);
                const pLabelStart = google.maps.geometry.spherical.computeOffset(pDimStart, dimOffset, headingY);
                const pLabelEnd = google.maps.geometry.spherical.computeOffset(pDimEnd, dimOffset, headingY);

                const line = new google.maps.Polyline({ map: this.map, path: [pLabelStart, pLabelEnd], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });

                const tickLen = 0.4;
                const pTick1Start = google.maps.geometry.spherical.computeOffset(pLabelStart, tickLen / 2, headingY);
                const pTick1End = google.maps.geometry.spherical.computeOffset(pLabelStart, tickLen / 2, (headingY + 180) % 360);
                const pTick2Start = google.maps.geometry.spherical.computeOffset(pLabelEnd, tickLen / 2, headingY);
                const pTick2End = google.maps.geometry.spherical.computeOffset(pLabelEnd, tickLen / 2, (headingY + 180) % 360);
                const tick1 = new google.maps.Polyline({ map: this.map, path: [pTick1Start, pTick1End], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });
                const tick2 = new google.maps.Polyline({ map: this.map, path: [pTick2Start, pTick2End], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });

                this.posts[rf.id].push(line, tick1, tick2);

                const midPoint = google.maps.geometry.spherical.interpolate(pLabelStart, pLabelEnd, 0.5);
                let svgRot = (headingX - 90) % 360;
                if (svgRot < 0) svgRot += 360;
                if (svgRot > 90 && svgRot < 270) svgRot -= 180;

                const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><g transform="rotate(${svgRot}, 50, 15)"><text x="50" y="10" font-size="12" font-family="Arial" fill="#e74c3c" font-weight="bold" text-anchor="middle" style="text-shadow: 1px 1px 0 rgba(255,255,255,0.8), -1px -1px 0 rgba(255,255,255,0.8), 1px -1px 0 rgba(255,255,255,0.8), -1px 1px 0 rgba(255,255,255,0.8);">d = ${e} m</text></g></svg>`;
                const marker = new google.maps.Marker({ map: this.map, position: midPoint, icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgText), anchor: new google.maps.Point(50, 15) }, zIndex: 1020 });
                this.posts[rf.id].push(marker);
            }

            if (yPositions.length > 1) {
                for (let i = 0; i < yPositions.length - 1; i++) {
                    const y1 = yPositions[i];
                    const y2 = yPositions[i + 1];
                    if (isNaN(y1) || isNaN(y2)) continue;

                    const dist = (y2 - y1).toFixed(2);
                    const dimOffset = offsetX - 0.8;
                    const pDimStart = google.maps.geometry.spherical.computeOffset(p0, dimOffset, headingX);
                    const pLabelStart = google.maps.geometry.spherical.computeOffset(pDimStart, y1, headingY);
                    const pLabelEnd = google.maps.geometry.spherical.computeOffset(pDimStart, y2, headingY);

                    const line = new google.maps.Polyline({ map: this.map, path: [pLabelStart, pLabelEnd], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });

                    const tickLen = 0.4;
                    const pTick1Start = google.maps.geometry.spherical.computeOffset(pLabelStart, tickLen / 2, headingX);
                    const pTick1End = google.maps.geometry.spherical.computeOffset(pLabelStart, tickLen / 2, (headingX + 180) % 360);
                    const pTick2Start = google.maps.geometry.spherical.computeOffset(pLabelEnd, tickLen / 2, headingX);
                    const pTick2End = google.maps.geometry.spherical.computeOffset(pLabelEnd, tickLen / 2, (headingX + 180) % 360);
                    const tick1 = new google.maps.Polyline({ map: this.map, path: [pTick1Start, pTick1End], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });
                    const tick2 = new google.maps.Polyline({ map: this.map, path: [pTick2Start, pTick2End], strokeColor: '#34495e', strokeWeight: 1, zIndex: 1019 });

                    this.posts[rf.id].push(line, tick1, tick2);

                    const midPoint = google.maps.geometry.spherical.interpolate(pLabelStart, pLabelEnd, 0.5);
                    let svgRot = (headingY - 90) % 360;
                    if (svgRot < 0) svgRot += 360;
                    if (svgRot > 90 && svgRot < 270) svgRot -= 180;

                    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><g transform="rotate(${svgRot}, 50, 15)"><text x="50" y="10" font-size="12" font-family="Arial" fill="#e74c3c" font-weight="bold" text-anchor="middle" style="text-shadow: 1px 1px 0 rgba(255,255,255,0.8), -1px -1px 0 rgba(255,255,255,0.8), 1px -1px 0 rgba(255,255,255,0.8), -1px 1px 0 rgba(255,255,255,0.8);">d = ${dist} m</text></g></svg>`;
                    const marker = new google.maps.Marker({ map: this.map, position: midPoint, icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgText), anchor: new google.maps.Point(50, 15) }, zIndex: 1020 });
                    this.posts[rf.id].push(marker);
                }
            }
        }

        const allShapes = [];
        let xIndex = 0;
        for (let x of xPositions) {
            let yIndex = 0;
            for (let y of yPositions) {
                if (isNaN(x) || isNaN(y)) continue; // Évite un plantage de Google Maps si la coordonnée est invalide
                const ptX = google.maps.geometry.spherical.computeOffset(p0, x, headingX);
                const ptFinal = google.maps.geometry.spherical.computeOffset(ptX, y, headingY);
                if (showPosts) {
                    const shape = this.drawShape(rf.id, ptFinal, cfg.shape, headingX, headingY);
                    if (shape) {
                        shape.xIndex = xIndex;
                        shape.yIndex = yIndex;
                        allShapes.push(shape);
                    }
                }
                yIndex++;
            }
            xIndex++;
        }

        if (showPosts) {
            allShapes.forEach(shape => {
                shape.setOptions({ draggable: true, cursor: 'move' }); // Curseurs bidirectionnels

                let dragOffsetX = 0;
                let dragOffsetY = 0;

                google.maps.event.addListener(shape, 'dragstart', (e) => {
                    const mDist = google.maps.geometry.spherical.computeDistanceBetween(p0, e.latLng);
                    const mh = google.maps.geometry.spherical.computeHeading(p0, e.latLng);
                    const mouseX = mDist * Math.cos((mh - headingX) * Math.PI / 180);
                    const mouseY = mDist * Math.cos((mh - headingY) * Math.PI / 180);

                    dragOffsetX = xPositions[shape.xIndex] - mouseX;
                    dragOffsetY = yPositions[shape.yIndex] - mouseY;
                });

                google.maps.event.addListener(shape, 'drag', (e) => {
                    const xIdx = shape.xIndex;
                    const yIdx = shape.yIndex;

                    const mDist = google.maps.geometry.spherical.computeDistanceBetween(p0, e.latLng);
                    const mh = google.maps.geometry.spherical.computeHeading(p0, e.latLng);
                    let mouseX = mDist * Math.cos((mh - headingX) * Math.PI / 180);
                    let mouseY = mDist * Math.cos((mh - headingY) * Math.PI / 180);

                    let newX = mouseX + dragOffsetX;
                    let newY = mouseY + dragOffsetY;

                    // Récupérer les garde-fous
                    const maxEntraxeX = parseFloat(this.modalContent.querySelector('#post-max-entraxe-x').value) || 10;
                    const maxEntraxeY = parseFloat(this.modalContent.querySelector('#post-max-entraxe-y').value) || 4;

                    // --- CONTRÔLE SUR L'AXE DES X ---
                    const minX_left = (xIdx === 0) ? offsetX : xPositions[xIdx - 1] + 0.1;
                    const minX_right = (xIdx < xPositions.length - 1) ? xPositions[xIdx + 1] - maxEntraxeX : -Infinity;
                    const minX = Math.max(minX_left, minX_right);

                    const maxX_right = (xIdx === xPositions.length - 1) ? offsetX + L_reelle : xPositions[xIdx + 1] - 0.1;
                    const maxX_left = (xIdx > 0) ? xPositions[xIdx - 1] + maxEntraxeX : Infinity;
                    const maxX = Math.min(maxX_right, maxX_left);

                    newX = Math.max(minX, Math.min(Math.max(minX, maxX), newX));
                    xPositions[xIdx] = newX;

                    // --- CONTRÔLE SUR L'AXE DES Y ---
                    let newOffset = yPositions[0];
                    let newEntraxe = (yPositions.length > 1) ? (yPositions[1] - yPositions[0]) : 0;

                    if (yPositions.length === 1) {
                        newOffset = Math.max(offsetY, Math.min(offsetY + L_proj, newY));
                        yPositions[0] = newOffset;
                    } else {
                        if (yIdx === 0) {
                            newOffset = newY;
                            const maxOffset = offsetY + L_proj - newEntraxe * (yPositions.length - 1);
                            newOffset = Math.max(offsetY, Math.min(maxOffset, newOffset));
                        } else {
                            newEntraxe = (newY - yPositions[0]) / yIdx;
                            const maxEntraxeLimitBounds = (offsetY + L_proj - yPositions[0]) / (yPositions.length - 1);
                            const maxEntraxeLimit = Math.min(maxEntraxeY, maxEntraxeLimitBounds);
                            newEntraxe = Math.max(0.1, Math.min(maxEntraxeLimit, newEntraxe));
                        }

                        for (let i = 0; i < yPositions.length; i++) {
                            yPositions[i] = newOffset + i * newEntraxe;
                        }
                    }

                    // --- REPOSITIONNEMENT DE TOUTES LES FORMES ---
                    allShapes.forEach(s => {
                        const nPtX = google.maps.geometry.spherical.computeOffset(p0, xPositions[s.xIndex], headingX);
                        const nPtFinal = google.maps.geometry.spherical.computeOffset(nPtX, yPositions[s.yIndex], headingY);

                        if (s instanceof google.maps.Circle) {
                            s.setCenter(nPtFinal);
                        } else {
                            let length = cfg.shape === 'rect' ? 0.4 : 0.5;
                            let width = cfg.shape === 'rect' ? 0.8 : 0.5;
                            const p1 = google.maps.geometry.spherical.computeOffset(nPtFinal, length / 2, headingX);
                            const c1 = google.maps.geometry.spherical.computeOffset(p1, width / 2, headingY);
                            const c2 = google.maps.geometry.spherical.computeOffset(p1, width / 2, (headingY + 180) % 360);
                            const p2 = google.maps.geometry.spherical.computeOffset(nPtFinal, length / 2, (headingX + 180) % 360);
                            const c3 = google.maps.geometry.spherical.computeOffset(p2, width / 2, (headingY + 180) % 360);
                            const c4 = google.maps.geometry.spherical.computeOffset(p2, width / 2, headingY);
                            s.setPaths([c1, c2, c3, c4]);
                        }
                    });

                    // --- MISE À JOUR UI X ---
                    const newPfGauche = Math.max(0, xPositions[0] - offsetX);
                    const newEntraxes = [];
                    for (let i = 0; i < xPositions.length - 1; i++) {
                        newEntraxes.push(Math.max(0.1, xPositions[i + 1] - xPositions[i]).toFixed(2));
                    }
                    const newPfDroite = Math.max(0, L_reelle - (xPositions[xPositions.length - 1] - offsetX));

                    const pfAutoCb = this.modalContent.querySelector('#post-pf-auto');
                    if (pfAutoCb && pfAutoCb.checked) {
                        pfAutoCb.checked = false;
                        this.modalContent.querySelector('#post-pf-gauche').disabled = false;
                        this.modalContent.querySelector('#post-pf-droite').disabled = false;
                        this.modalContent.querySelector('#post-pf-gauche').style.background = '#fff';
                        this.modalContent.querySelector('#post-pf-droite').style.background = '#fff';
                    }

                    const pfGaucheInput = this.modalContent.querySelector('#post-pf-gauche');
                    const pfDroiteInput = this.modalContent.querySelector('#post-pf-droite');
                    const entraxesInput = this.modalContent.querySelector('#post-entraxes-long');

                    if (pfGaucheInput) pfGaucheInput.value = newPfGauche.toFixed(2);
                    if (pfDroiteInput) pfDroiteInput.value = newPfDroite.toFixed(2);
                    if (entraxesInput) entraxesInput.value = this._compressEntraxes(newEntraxes);

                    // --- MISE À JOUR UI Y ---
                    const transversalSelect = this.modalContent.querySelector('#post-transversal');
                    if (transversalSelect && transversalSelect.value === 'center') {
                        transversalSelect.value = 'excenter';
                        const offsetContainer = this.modalContent.querySelector('#post-transversal-offset-container');
                        if (offsetContainer) offsetContainer.style.display = 'block';
                    }
                    const offsetInput = this.modalContent.querySelector('#post-transversal-offset');
                    if (offsetInput) offsetInput.value = Math.max(0, newOffset - offsetY).toFixed(2);

                    if (yPositions.length > 1) {
                        const entraxeInput = this.modalContent.querySelector('#post-entraxe-rampant');
                        if (entraxeInput) entraxeInput.value = newEntraxe.toFixed(2);
                    }

                    this._validateLogic();
                    this._drawPreview();
                });

                google.maps.event.addListener(shape, 'dragend', () => {
                    this.saveConfig(false);
                });
            });
        }
    }

    drawShape(rectId, center, shapeType, hX, hY) {
        const polyColor = '#E74C3C'; // Rouge vif
        const strokeCol = '#FFFFFF'; // Bordure blanche pour délimiter fortement
        let shape;

        if (shapeType === 'circle') {
            shape = new google.maps.Circle({
                map: this.map, center: center, radius: 0.3, // Réduction de la taille pour correspondre aux attentes
                fillColor: polyColor, fillOpacity: 1.0, strokeColor: strokeCol, strokeWeight: 2, zIndex: 1020
            });
        } else {
            let length = shapeType === 'rect' ? 0.4 : 0.5; // Dimensions réduites et pivotées de 90° (X plus petit que Y)
            let width = shapeType === 'rect' ? 0.8 : 0.5;

            const p1 = google.maps.geometry.spherical.computeOffset(center, length / 2, hX);
            const c1 = google.maps.geometry.spherical.computeOffset(p1, width / 2, hY);
            const c2 = google.maps.geometry.spherical.computeOffset(p1, width / 2, (hY + 180) % 360);

            const p2 = google.maps.geometry.spherical.computeOffset(center, length / 2, (hX + 180) % 360);
            const c3 = google.maps.geometry.spherical.computeOffset(p2, width / 2, (hY + 180) % 360);
            const c4 = google.maps.geometry.spherical.computeOffset(p2, width / 2, hY);

            shape = new google.maps.Polygon({
                map: this.map, paths: [c1, c2, c3, c4],
                fillColor: polyColor, fillOpacity: 1.0, strokeColor: strokeCol, strokeWeight: 2, zIndex: 1020
            });
        }
        this.posts[rectId].push(shape);
        return shape;
    }
}