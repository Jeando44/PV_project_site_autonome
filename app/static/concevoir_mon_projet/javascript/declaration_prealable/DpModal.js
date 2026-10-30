import DpState, { PIECES, IMAGE_SLOTS } from './DpState.js';
import DpViewpoints from './DpViewpoints.js';
import DpExport, { download, deduireDuCalepinage } from './DpExport.js';
import { importImage } from './DpImages.js';
import {
  genererNotice, TEINTES, COUVERTURE_LABELS, VALORISATION_LABELS, valorisationDepuisProjet,
} from './DpNotice.js';
import CartoucheData from '../export_plans_pdf_dxf/utils/CartoucheData.js';
import { chargerEntreprise } from './DpEntreprise.js';
import CaptureVeil from '../export_plans_pdf_dxf/utils/CaptureVeil.js';

/**
 * Modal « Déclaration préalable » (projets résidentiels) : saisie guidée en 5 étapes, import des
 * visuels, puis génération du dossier PDF A4 (complet, ZIP d'un PDF par pièce, ou pièce seule).
 * Vit dans la page Calepinage (pas d'iframe) pour piloter window.map lors des captures.
 */
const STEPS = [
  { id: 'projet', label: 'Projet & demandeur', icon: 'bi-person-vcard' },
  { id: 'notice', label: 'Notice DP11', icon: 'bi-card-text' },
  { id: 'plans', label: 'Plans & carte', icon: 'bi-map' },
  { id: 'visuels', label: 'Photos & visuels', icon: 'bi-images' },
  { id: 'export', label: 'Pièces & export', icon: 'bi-file-earmark-pdf' },
];

// Réglages dont dépendent les CAPTURES : les modifier après génération impose de regénérer.
const CHAMPS_CAPTURES = new Set(['champId', 'echelleMasse', 'pieces']);

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const options = (map, selected) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('');

export default class DpModal {
  constructor() {
    this.state = new DpState();
    this.viewpoints = new DpViewpoints(this.state);
    this.exporter = new DpExport(this.state, this.viewpoints);
    this.busy = false;
    this.stale = false;
    this._build();
  }

  // -------------------------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------------------------
  _build() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'dp-modal-overlay';
    this.modal = document.createElement('div');
    this.modal.id = 'dp-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-labelledby', 'dp-modal-title');
    this.modal.innerHTML = `
      <div class="dp-header">
        <h2 id="dp-modal-title"><i class="bi bi-file-earmark-ruled"></i> Déclaration préalable - toiture photovoltaïque</h2>
        <button type="button" class="dp-close" title="Fermer" aria-label="Fermer">&times;</button>
      </div>
      <div class="dp-body">
        <div class="dp-steps" role="navigation" aria-label="Étapes du dossier">${STEPS.map((s, i) => `
          <button type="button" class="dp-step${i === 0 ? ' active' : ''}" data-step="${s.id}">
            <span class="dp-step-num">${i + 1}</span><span class="dp-step-label">${s.label}</span><span class="dp-step-flag"></span>
          </button>`).join('')}
          <p class="dp-rgpd"><i class="bi bi-shield-lock"></i> Tout est traité dans votre navigateur. Les photos ne sont ni envoyées au serveur ni enregistrées : elles sont perdues à la fermeture de la page.</p>
        </div>
        <div class="dp-panels">${STEPS.map((s, i) => `<div class="dp-panel${i === 0 ? ' active' : ''}" data-panel="${s.id}"></div>`).join('')}</div>
      </div>
      <div class="dp-footer">
        <button type="button" class="dp-btn dp-btn-ghost" data-nav="prev">Précédent</button>
        <span class="dp-footer-status"></span>
        <button type="button" class="dp-btn dp-btn-primary" data-nav="next">Suivant</button>
      </div>`;
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.modal);

    this.overlay.addEventListener('click', () => this.close());
    this.modal.querySelector('.dp-close').addEventListener('click', () => this.close());
    this.modal.querySelectorAll('.dp-step').forEach((b) => b.addEventListener('click', () => this.goTo(b.dataset.step)));
    this.modal.querySelector('[data-nav="prev"]').addEventListener('click', () => this._navigate(-1));
    this.modal.querySelector('[data-nav="next"]').addEventListener('click', () => this._navigate(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen() && !this.busy && !document.querySelector('.dp-viewpoint-layer')) this.close();
    });

    // Retour au modal après un tracé de cotation sur la carte
    this.backBtn = document.createElement('button');
    this.backBtn.type = 'button';
    this.backBtn.id = 'dp-back-to-modal';
    this.backBtn.innerHTML = '<i class="bi bi-arrow-return-left"></i> Revenir au dossier DP';
    this.backBtn.addEventListener('click', () => this._finCotation());
    document.body.appendChild(this.backBtn);
  }

  isOpen() {
    return this.modal.classList.contains('open');
  }

  /**
   * @param {Object} [options]
   * @param {Function} [options.onClose] rappelé une fois à la fermeture (ex. réafficher le modal
   *   de calepinage, masqué le temps de la DP).
   */
  async open(options = {}) {
    this._onClose = typeof options.onClose === 'function' ? options.onClose : null;
    this.state.load();
    await this._prefill();
    this._renderAll();
    this.overlay.classList.add('open');
    this.modal.classList.add('open');
    this.viewpoints.showPreview(true);
  }

  close() {
    if (this.busy) return;
    this.overlay.classList.remove('open');
    this.modal.classList.remove('open');
    this.viewpoints.showPreview(false);
    const onClose = this._onClose;
    this._onClose = null;
    if (onClose) {
      try { onClose(); } catch (e) { console.warn('[DP] Retour au modal appelant impossible :', e); }
    }
  }

  _hideTemporarily(hidden) {
    this.overlay.classList.toggle('dp-hidden', hidden);
    this.modal.classList.toggle('dp-hidden', hidden);
  }

  /** Valeurs déduites du projet et du calepinage, sans écraser une saisie de l'utilisateur. */
  async _prefill() {
    const d = this.state.data;
    const auto = deduireDuCalepinage(d.champId);
    this.auto = auto;
    if (!d.adresse) {
      try {
        const projet = await CartoucheData.getProjectInfo();
        if (projet && projet.adresse) d.adresse = projet.adresse;
      } catch (e) { /* adresse saisie à la main */ }
    }
    if (d.nbPanneaux == null && auto.nbPanneaux) d.nbPanneaux = auto.nbPanneaux;
    if (!d.orientation && auto.orientation) d.orientation = auto.orientation;
    if (!d.valorisation) d.valorisation = valorisationDepuisProjet(window.ACTIVE_PROJECT_MODE_VALORISATION);
    if (!d.noticeModifiee || !d.noticeTexte) d.noticeTexte = genererNotice(d);
    this.state.save();
  }

  // -------------------------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------------------------
  goTo(stepId) {
    this.current = stepId;
    this.modal.querySelectorAll('.dp-step').forEach((b) => b.classList.toggle('active', b.dataset.step === stepId));
    this.modal.querySelectorAll('.dp-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === stepId));
    const idx = STEPS.findIndex((s) => s.id === stepId);
    this.modal.querySelector('[data-nav="prev"]').style.visibility = idx === 0 ? 'hidden' : 'visible';
    this.modal.querySelector('[data-nav="next"]').style.visibility = idx === STEPS.length - 1 ? 'hidden' : 'visible';
    if (stepId === 'export') this._renderExport();
    this.modal.querySelector('.dp-panels').scrollTop = 0;
  }

  _navigate(delta) {
    const idx = STEPS.findIndex((s) => s.id === (this.current || 'projet'));
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + delta))];
    this.goTo(next.id);
  }

  _renderAll() {
    this._renderProjet();
    this._renderNotice();
    this._renderPlans();
    this._renderVisuels();
    this._renderExport();
    this._updateFlags();
    this.goTo(this.current || 'projet');
  }

  _panel(id) {
    return this.modal.querySelector(`[data-panel="${id}"]`);
  }

  /** Liaison générique des champs [data-field] à l'état (sauvegarde locale immédiate). */
  _bind(root, onChange) {
    root.querySelectorAll('[data-field]').forEach((el) => {
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'radio' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const key = el.dataset.field;
        let value = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'radio' && !el.checked) return;
        if (el.type === 'number') value = el.value === '' ? null : Number(el.value);
        this.state.set(key, value);
        if (CHAMPS_CAPTURES.has(key) && this.exporter.result) this.stale = true;
        if (onChange) onChange(key, value);
        this._updateFlags();
      });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Étape 1 : projet & demandeur
  // -------------------------------------------------------------------------------------------
  _renderProjet() {
    const d = this.state.data;
    const p = this._panel('projet');
    p.innerHTML = `
      <h3>Projet et demandeur</h3>
      <p class="dp-help">Ces informations alimentent le cartouche de chaque pièce et la notice descriptive.</p>
      <div class="dp-grid">
        <label class="dp-field dp-span-2">Adresse des travaux
          <input type="text" data-field="adresse" value="${esc(d.adresse)}" placeholder="N°, rue, code postal, commune">
        </label>
        <div class="dp-field dp-span-2 dp-radios" role="radiogroup" aria-label="Le demandeur est">
          <span class="dp-legend">Le demandeur est</span>
          <label><input type="radio" name="dpTypeDemandeur" data-field="typeDemandeur" value="particulier"${d.typeDemandeur !== 'societe' ? ' checked' : ''}> un particulier</label>
          <label><input type="radio" name="dpTypeDemandeur" data-field="typeDemandeur" value="societe"${d.typeDemandeur === 'societe' ? ' checked' : ''}> une société</label>
        </div>
        <label class="dp-field dp-if-particulier">Civilité
          <select data-field="civilite">${options({ Monsieur: 'Monsieur', Madame: 'Madame', 'Madame et Monsieur': 'Madame et Monsieur', '': '(aucune)' }, d.civilite)}</select>
        </label>
        <label class="dp-field dp-if-particulier">Nom
          <input type="text" data-field="nom" value="${esc(d.nom)}" autocomplete="off">
        </label>
        <label class="dp-field dp-span-2 dp-if-societe">Raison sociale
          <input type="text" data-field="societe" value="${esc(d.societe)}" autocomplete="off">
        </label>
        <label class="dp-field">Indice du dossier
          <input type="text" data-field="indice" value="${esc(d.indice)}" maxlength="4" style="max-width:6rem">
        </label>
      </div>
      <h4>Établi par <small class="dp-help" style="margin:0">(Paramètres du projet &gt; Personnalisation du rapport)</small></h4>
      <div class="dp-etabli"><span class="dp-help">Chargement…</span></div>`;
    const toggle = () => {
      const societe = this.state.data.typeDemandeur === 'societe';
      p.querySelectorAll('.dp-if-particulier').forEach((el) => { el.hidden = societe; });
      p.querySelectorAll('.dp-if-societe').forEach((el) => { el.hidden = !societe; });
    };
    toggle();
    this._bind(p, () => { toggle(); this._syncNotice(); });
    this._renderEtabliPar(p.querySelector('.dp-etabli'));
  }

  /** Aperçu de la case « Établi par » du cartouche, avec les alertes de validation des formats. */
  async _renderEtabliPar(el) {
    if (!el) return;
    const ent = await chargerEntreprise();
    this.entreprise = ent;
    el.innerHTML = `
      <div class="dp-etabli-carte">
        ${ent.logo ? `<img src="${ent.logo}" alt="Logo">` : '<div class="dp-etabli-vide">Pas de logo</div>'}
        <div><strong>${esc(ent.nom || 'Nom de l’entreprise non renseigné')}</strong>
          ${ent.telephone ? `<br><small>${esc(ent.telephone)}</small>` : ''}${ent.email ? `<br><small>${esc(ent.email)}</small>` : ''}</div>
      </div>
      ${ent.alertes.length ? `<div class="dp-alert">${ent.alertes.map(esc).join('<br>')}<br>Complétez la section « Personnalisation du rapport » des Paramètres du projet (logo PNG ou JPEG, 1,5 Mo max).</div>` : ''}`;
    this._updateFlags();
  }

  // -------------------------------------------------------------------------------------------
  // Étape 2 : notice DP11
  // -------------------------------------------------------------------------------------------
  _renderNotice() {
    const d = this.state.data;
    const p = this._panel('notice');
    const auto = this.auto || {};
    p.innerHTML = `
      <h3>Notice descriptive (DP11)</h3>
      <p class="dp-help">Les choix ci-dessous complètent le texte type. Vous pouvez ensuite retoucher librement le texte : il ne sera plus régénéré automatiquement, sauf si vous cliquez sur « Régénérer ».</p>
      <div class="dp-grid">
        <label class="dp-field">Nombre de panneaux ${auto.nbPanneaux ? `<small>(calepinage : ${auto.nbPanneaux})</small>` : ''}
          <input type="number" min="1" step="1" data-field="nbPanneaux" value="${esc(d.nbPanneaux)}">
        </label>
        <label class="dp-field">Teinte des panneaux
          <select data-field="teinte">${options(Object.fromEntries(TEINTES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])), d.teinte)}</select>
        </label>
        <label class="dp-field">Orientation du pan ${auto.orientation ? `<small>(calepinage : ${esc(auto.orientation)})</small>` : ''}
          <input type="text" data-field="orientation" value="${esc(d.orientation)}" placeholder="sud-est  ·  plusieurs : sud-est, sud-ouest">
        </label>
        <label class="dp-field">Couverture existante
          <select data-field="couverture">${options(COUVERTURE_LABELS, d.couverture)}</select>
        </label>
        <label class="dp-field">Valorisation de l'électricité
          <select data-field="valorisation">${options(VALORISATION_LABELS, d.valorisation)}</select>
        </label>
        <label class="dp-field dp-check">
          <input type="checkbox" data-field="cheminsCables"${d.cheminsCables ? ' checked' : ''}> Chemins de câbles apparents en toiture
        </label>
      </div>
      <div class="dp-notice-head">
        <span>Texte de la notice <span class="dp-badge dp-notice-badge"></span></span>
        <button type="button" class="dp-btn dp-btn-ghost dp-regen"><i class="bi bi-arrow-clockwise"></i> Régénérer depuis les choix</button>
      </div>
      <textarea class="dp-notice-text" rows="16" spellcheck="true">${esc(d.noticeTexte)}</textarea>`;
    const area = p.querySelector('.dp-notice-text');
    area.addEventListener('input', () => {
      this.state.data.noticeTexte = area.value;
      this.state.data.noticeModifiee = true;
      this.state.save();
      this._noticeBadge();
      this._updateFlags();
    });
    p.querySelector('.dp-regen').addEventListener('click', () => {
      this.state.data.noticeModifiee = false;
      this._syncNotice(true);
    });
    this._bind(p, () => this._syncNotice());
    this._noticeBadge();
  }

  _syncNotice(force = false) {
    const d = this.state.data;
    if (d.noticeModifiee && !force) return;
    d.noticeTexte = genererNotice(d);
    this.state.save();
    const area = this.modal.querySelector('.dp-notice-text');
    if (area) area.value = d.noticeTexte;
    this._noticeBadge();
  }

  _noticeBadge() {
    const b = this.modal.querySelector('.dp-notice-badge');
    if (!b) return;
    const manuel = this.state.data.noticeModifiee;
    b.textContent = manuel ? 'modifié à la main' : 'généré automatiquement';
    b.classList.toggle('dp-badge-warn', manuel);
  }

  // -------------------------------------------------------------------------------------------
  // Étape 3 : plans & carte
  // -------------------------------------------------------------------------------------------
  _renderPlans() {
    const d = this.state.data;
    const p = this._panel('plans');
    const champs = (this.auto && this.auto.champs) || [];
    const cotations = window.drawingControl && window.drawingControl.cotationManager
      ? window.drawingControl.cotationManager.getCotations().length : 0;
    const vpLigne = (type, label) => {
      const vp = d.pointsDeVue[type];
      return `
        <div class="dp-row">
          <div><strong>${label}</strong><br><small>${vp ? `Placé - direction ${vp.bearing}°` : 'Non placé'}</small></div>
          <div class="dp-row-actions">
            <button type="button" class="dp-btn dp-btn-ghost" data-place="${type}"><i class="bi bi-geo-alt"></i> ${vp ? 'Replacer' : 'Placer sur la carte'}</button>
            ${vp ? `<button type="button" class="dp-btn dp-btn-ghost dp-btn-danger" data-unplace="${type}" title="Retirer"><i class="bi bi-trash"></i></button>` : ''}
          </div>
        </div>`;
    };
    p.innerHTML = `
      <h3>Plans et carte</h3>
      <div class="dp-grid">
        <label class="dp-field">Champ PV (coupe, vues 3D)
          <select data-field="champId"><option value="">Automatique (1er champ équipé)</option>${champs.map((c) => `<option value="${esc(c)}"${c === d.champId ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label class="dp-field">Échelle du plan de masse
          <select data-field="echelleMasse">${options({ auto: 'Automatique (toute la parcelle)', 250: '1/250', 500: '1/500', 750: '1/750', 1000: '1/1000', 1500: '1/1500', 2000: '1/2000' }, String(d.echelleMasse))}</select>
        </label>
      </div>
      <h4>Lignes de cotation <span class="dp-badge">${cotations} sur la carte</span></h4>
      <p class="dp-help">Distances aux limites de propriété, entre panneaux, aux obstacles… Reportées sur les plans de masse et de toiture. Clic sur le point de départ, clic sur l'arrivée, double-clic pour terminer. Également disponible dans la palette d'outils de la carte.</p>
      <div class="dp-row">
        <div class="dp-checks">
          <label><input type="checkbox" data-field="cotationsAvant"${d.cotationsAvant ? ' checked' : ''}> sur les plans avant travaux (masse, toiture)</label>
          <label><input type="checkbox" data-field="cotationsProjet"${d.cotationsProjet ? ' checked' : ''}> sur les plans projet (masse, toiture)</label>
        </div>
        <button type="button" class="dp-btn dp-btn-ghost dp-cotation"><i class="bi bi-rulers"></i> Tracer des cotations</button>
      </div>
      <h4>Points de vue des photographies</h4>
      <p class="dp-help">Repérés sur le plan de masse projet par le même symbole que sur la page DP7 - DP8. Deux clics : l'emplacement du photographe, puis la direction visée.</p>
      ${vpLigne('proche', 'DP7 - environnement proche')}
      ${vpLigne('lointain', 'DP8 - environnement lointain')}`;
    this._bind(p, (key) => {
      if (key === 'champId') {
        this.auto = deduireDuCalepinage(this.state.data.champId);
        if (!this.state.data.noticeModifiee) { this.state.data.orientation = this.auto.orientation; this._renderNotice(); this._syncNotice(); }
      }
    });
    p.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => this._placer(b.dataset.place)));
    p.querySelectorAll('[data-unplace]').forEach((b) => b.addEventListener('click', async () => {
      await this.viewpoints.remove(b.dataset.unplace);
      this._renderPlans();
      this._updateFlags();
    }));
    p.querySelector('.dp-cotation').addEventListener('click', (e) => this._debutCotation(e.currentTarget));
  }

  async _placer(type) {
    this._hideTemporarily(true);
    try {
      const placed = await this.viewpoints.place(type);
      if (placed) await this.viewpoints.showPreview(true);
    } catch (e) {
      console.error('[DP] Placement du point de vue :', e);
    } finally {
      this._hideTemporarily(false);
      this._renderPlans();
      this._updateFlags();
    }
  }

  _debutCotation(button) {
    const dc = window.drawingControl;
    if (!dc || typeof dc.toggleCotationMode !== 'function') return;
    this._hideTemporarily(true);
    this.backBtn.classList.add('visible');
    this._cotationBtn = button;
    dc.toggleCotationMode(button);
  }

  _finCotation() {
    const dc = window.drawingControl;
    if (dc && typeof dc.finishDrawingSession === 'function') dc.finishDrawingSession();
    this.backBtn.classList.remove('visible');
    this._hideTemporarily(false);
    this._renderPlans();
  }

  // -------------------------------------------------------------------------------------------
  // Étape 4 : photos & visuels
  // -------------------------------------------------------------------------------------------
  _renderVisuels() {
    const p = this._panel('visuels');
    p.innerHTML = `
      <h3>Photos et visuels</h3>
      <p class="dp-help">Glissez-déposez une image ou cliquez sur une vignette. Les photos sont réduites (2200 px max) et leurs métadonnées (dont la position GPS) supprimées à l'import.</p>
      <div class="dp-drops">${Object.entries(IMAGE_SLOTS).map(([slot, def]) => `
        <div class="dp-drop" data-slot="${slot}" tabindex="0" role="button" aria-label="${esc(def.label)}">
          <div class="dp-drop-thumb"></div>
          <div class="dp-drop-info">
            <strong>${esc(def.label)}</strong>${def.requis ? ' <span class="dp-badge dp-badge-warn">requis</span>' : ''}
            <small>${esc(def.aide || '')}</small>
            <span class="dp-drop-actions"></span>
          </div>
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </div>`).join('')}
      </div>`;
    p.querySelectorAll('.dp-drop').forEach((zone) => this._wireDrop(zone));
  }

  _wireDrop(zone) {
    const slot = zone.dataset.slot;
    const input = zone.querySelector('input[type=file]');
    const refresh = () => {
      const img = this.state.images[slot];
      zone.classList.toggle('filled', !!img);
      zone.querySelector('.dp-drop-thumb').innerHTML = img
        ? `<img src="${img.dataUrl}" alt="">` : '<i class="bi bi-cloud-arrow-up"></i>';
      zone.querySelector('.dp-drop-actions').innerHTML = img
        ? `<span class="dp-file">${esc(img.name)} · ${img.width}×${img.height}px</span> <button type="button" class="dp-link dp-remove">Retirer</button>`
        : '<span class="dp-file">Cliquer ou déposer une image</span>';
      const rm = zone.querySelector('.dp-remove');
      if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); this.state.setImage(slot, null); refresh(); this._updateFlags(); });
    };
    const handle = async (file) => {
      if (!file) return;
      zone.classList.add('loading');
      try {
        this.state.setImage(slot, await importImage(file));
      } catch (e) {
        alert(e.message || 'Import impossible.');
      } finally {
        zone.classList.remove('loading');
        refresh();
        this._updateFlags();
      }
    };
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { handle(input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); handle(e.dataTransfer.files[0]); });
    refresh();
  }

  // -------------------------------------------------------------------------------------------
  // Étape 5 : pièces & export
  // -------------------------------------------------------------------------------------------
  /** Complétude de chaque pièce : [niveau 'ok'|'warn', message]. */
  _checks() {
    const d = this.state.data;
    const img = this.state.images;
    const auto = this.auto || {};
    const aChamp = (auto.champs || []).length > 0;
    return {
      garde: ['ok', 'Bordereau généré automatiquement'],
      dp1: d.adresse ? ['ok', 'OSM 1/10000 + Géoportail 1/500'] : ['warn', "Adresse du projet manquante"],
      dp2: aChamp ? ['ok', 'Avant-projet + projet'] : ['warn', 'Aucun panneau dans le calepinage'],
      dp3: aChamp || (img.coupe && img.vueX) ? ['ok', img.coupe ? 'Coupe importée' : 'Coupe du calepinage + vue 3D'] : ['warn', 'Calepinage ou images requis'],
      dp4: aChamp ? ['ok', 'Avant / après travaux par champ PV'] : ['warn', 'Aucun champ PV équipé'],
      dp6: img.insertion ? ['ok', 'Image importée'] : aChamp ? ['ok', 'Vue 3D isométrique'] : ['warn', 'Importer une insertion'],
      dp78: img.proche && img.lointain
        ? (d.pointsDeVue.proche && d.pointsDeVue.lointain ? ['ok', 'Photos et points de vue'] : ['warn', 'Points de vue à placer (étape 3)'])
        : ['warn', 'Photos à importer (étape 4)'],
      dp11: (d.typeDemandeur === 'societe' ? d.societe : d.nom) ? ['ok', d.noticeModifiee ? 'Texte personnalisé' : 'Texte type complété'] : ['warn', 'Nom du demandeur manquant'],
    };
  }

  _updateFlags() {
    const checks = this._checks();
    const warnStep = {
      projet: checks.dp1[0] === 'warn' || checks.dp11[0] === 'warn' || !!(this.entreprise && !this.entreprise.nom),
      notice: false,
      plans: !(this.state.data.pointsDeVue.proche && this.state.data.pointsDeVue.lointain),
      visuels: !(this.state.images.proche && this.state.images.lointain),
      export: false,
    };
    this.modal.querySelectorAll('.dp-step').forEach((b) => {
      const flag = b.querySelector('.dp-step-flag');
      flag.className = `dp-step-flag ${warnStep[b.dataset.step] ? 'warn' : 'ok'}`;
    });
    if (this.current === 'export') this._renderExport();
  }

  _renderExport() {
    const p = this._panel('export');
    if (!p) return;
    const d = this.state.data;
    const checks = this._checks();
    const result = this.exporter.result;
    p.innerHTML = `
      <h3>Pièces du dossier</h3>
      <p class="dp-help">Format A4 paysage (notice et page de garde en portrait). Une pièce incomplète est tout de même produite, avec un cadre à compléter.</p>
      <ul class="dp-pieces">${PIECES.map((piece) => {
        const [niveau, msg] = checks[piece.id];
        return `<li class="${niveau}">
          <label><input type="checkbox" data-piece="${piece.id}"${d.pieces[piece.id] ? ' checked' : ''}${this.busy ? ' disabled' : ''}>
            <span class="dp-piece-code">${esc(piece.code || '—')}</span> <span>${esc(piece.titre)}</span></label>
          <span class="dp-piece-msg"><i class="bi ${niveau === 'ok' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i> ${esc(msg)}</span>
          ${result && result.pieceIds.includes(piece.id) && !this.stale ? `<button type="button" class="dp-link" data-dl="${piece.id}" title="Télécharger cette pièce seule"><i class="bi bi-download"></i></button>` : '<span></span>'}
        </li>`;
      }).join('')}</ul>
      <div class="dp-progress" ${this.busy ? '' : 'hidden'}><div class="dp-progress-bar"><span></span></div><div class="dp-progress-msg"></div></div>
      ${result && result.captures.warnings.length ? `<div class="dp-alert">${result.captures.warnings.map(esc).join('<br>')}</div>` : ''}
      ${this.stale ? '<div class="dp-alert">Des réglages de plans ont changé depuis la génération : regénérez le dossier.</div>' : ''}
      <div class="dp-export-actions">
        ${this.busy
          ? '<button type="button" class="dp-btn dp-btn-ghost dp-cancel">Annuler</button>'
          : `<button type="button" class="dp-btn dp-btn-primary dp-generate"><i class="bi bi-gear"></i> ${result ? 'Regénérer' : 'Générer le dossier'}</button>`}
        <button type="button" class="dp-btn dp-download-pdf"${result && !this.busy && !this.stale ? '' : ' disabled'}><i class="bi bi-file-earmark-pdf"></i> PDF complet</button>
        <button type="button" class="dp-btn dp-download-zip"${result && !this.busy && !this.stale ? '' : ' disabled'}><i class="bi bi-file-earmark-zip"></i> ZIP (1 PDF par pièce)</button>
      </div>
      ${result && !this.stale ? `<p class="dp-help">Généré à ${result.generatedAt.toLocaleTimeString('fr-FR')}. Les textes et photos modifiés depuis sont pris en compte au téléchargement ; seuls les réglages de plans imposent de regénérer.</p>` : ''}`;

    p.querySelectorAll('[data-piece]').forEach((cb) => cb.addEventListener('change', () => {
      this.state.data.pieces[cb.dataset.piece] = cb.checked;
      this.state.save();
      if (this.exporter.result) this.stale = true;
      this._renderExport();
    }));
    p.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => this._safe(() => {
      const { blob, filename } = this.exporter.piece(b.dataset.dl);
      download(blob, filename);
    })));
    const gen = p.querySelector('.dp-generate');
    if (gen) gen.addEventListener('click', () => this._generer());
    const cancel = p.querySelector('.dp-cancel');
    if (cancel) cancel.addEventListener('click', () => { this.exporter.cancel(); cancel.disabled = true; cancel.textContent = 'Annulation…'; });
    p.querySelector('.dp-download-pdf').addEventListener('click', () => this._safe(() => {
      const { blob, filename } = this.exporter.pdfComplet();
      download(blob, filename);
    }));
    p.querySelector('.dp-download-zip').addEventListener('click', () => this._safe(async () => {
      this._status('Création de l\'archive ZIP…');
      const { blob, filename } = await this.exporter.zip((m) => this._status(m));
      download(blob, filename);
      this._status('');
    }));
  }

  async _safe(fn) {
    try {
      await fn();
    } catch (e) {
      console.error('[DP] ', e);
      this._status(e.message || 'Erreur inattendue.', true);
    }
  }

  _status(msg, error = false) {
    const el = this.modal.querySelector('.dp-footer-status');
    el.textContent = msg || '';
    el.classList.toggle('error', error);
  }

  /** Vérifie et consomme le quota mensuel de DP (session['licence_dp'], cf. app/services/dp/quota.py). */
  async _checkQuotaDp() {
    const projectId = this.state.projet;
    if (!projectId || projectId === 'sans_projet') {
      this._status('Aucun projet actif.', true);
      return false;
    }
    try {
      const res = await fetch('/concevoir_mon_projet/api/dp/check-and-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this._status(data.error || 'Génération refusée.', true);
        return false;
      }
      document.dispatchEvent(new CustomEvent('dpUsageRegistered'));
      return true;
    } catch (e) {
      console.error('[DP] Vérification du quota :', e);
      this._status('Impossible de vérifier le quota de Déclaration Préalable.', true);
      return false;
    }
  }

  async _generer() {
    const ids = PIECES.filter((p) => this.state.data.pieces[p.id]).map((p) => p.id);
    if (!ids.length) { this._status('Sélectionnez au moins une pièce.', true); return; }
    if (!(await this._checkQuotaDp())) return;
    this.busy = true;
    this.stale = false;
    this._status('');
    this.modal.classList.add('busy');
    this._renderExport();
    const bar = () => this.modal.querySelector('.dp-progress-bar span');
    const msg = () => this.modal.querySelector('.dp-progress-msg');
    try {
      await this.exporter.generer(ids, (m, ratio) => {
        if (msg()) msg().textContent = m;
        if (bar() && ratio != null) bar().style.width = `${Math.round(ratio * 100)}%`;
      });
      this._status('Dossier prêt : téléchargez le PDF complet ou le ZIP.');
    } catch (e) {
      console.error('[DP] Génération :', e);
      this._status(e.message || 'Échec de la génération.', true);
    } finally {
      CaptureVeil.forceHide();
      this.busy = false;
      this.modal.classList.remove('busy');
      this._renderExport();
    }
  }
}
