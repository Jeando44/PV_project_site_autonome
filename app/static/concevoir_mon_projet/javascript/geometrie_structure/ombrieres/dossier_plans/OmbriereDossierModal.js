import OmbriereDossierState, { LIBELLES_FORMAT, codesPieces, champsAvecPlans } from './OmbriereDossierState.js?v=9';
import { PROFILS, profilAvecPlans } from '../../dossier_profils.js?v=1';
import { optionDevisHtml, brancherOptionDevis, boutonsDevisHtml, brancherBoutonsDevis, devisPropose, texteQuotaDossier } from '../../dossier_devis.js?v=4';
import { ouvrirApercuPdf } from '../../../services/PdfPreview.js?v=1';
import OmbriereDossierExport, { download } from './OmbriereDossierExport.js?v=14';
import { SECTIONS_REGLEMENTATION, TEXTES_TYPES } from './reglementation_modele.js?v=5';
import { listerChamps, resultatsAper, etatProductionPvlib, captureUtilisateurProjet, captureUtilisateurPerimee, messageSansOmbrage } from './OmbriereDossierCaptures.js?v=10';
import CartoucheData from '../../../export_plans_pdf_dxf/utils/CartoucheData.js';
import { bornesReglementation, erreursReglementation, enTexte } from '../../dossier_reglementation_validation.js?v=1';
import { reglementationDeborde } from '../../petit_champ_solaire/dossier_plans/DossierPieces.js?v=13';

/**
 * Modal « Dossier de plans de conception » projet entier, décliné par profil (dossier_profils.js) :
 * ombrières (bouton de la carte), toitures et mixte (export du parcours Chiffrage,
 * export_dossier_chiffrage.js) — open({ profil }). MÊME modal que celui du petit champ solaire
 * (trame .dp-* de la Déclaration préalable, styles communs de petitChampDossier.css), ouvert depuis
 * le bouton de la barre d'outils de la carte (ButtonControl, #ombrieres-dossier-plans-button).
 *
 * Un dossier par projet : toutes les ombrières (champs PV de type ombrière métal, bois ou Solumbra),
 * une coupe et une façade par ombrière. Page APER facultative (décochée par défaut), page
 * Réglementation facultative. Téléchargement : dossier complet (un PDF), ZIP (un PDF par pièce) ou
 * pièce seule. Une génération (validée par le serveur, 3 par projet) fige les saisies.
 */
const STEPS = [
  { id: 'pieces', label: 'Pièces & réglages' },
  { id: 'reglementation', label: 'Réglementation' },
  { id: 'export', label: 'Génération & export' },
];

// Bornes par défaut si /api/ombrieres/dossier/limites est injoignable (le serveur revalide).
const LIMITES_DEFAUT = {
  reglementation: { sections: { urbanisme: { min: 20, max: 3000, lignesMax: 80 }, sdis: { min: 20, max: 3000, lignesMax: 80 }, contraintes: { min: 20, max: 3000, lignesMax: 80 } } },
  dossier: { indicePattern: '^[A-Z]{1,2}[0-9]?$' },
};

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nb = (v, dec = 2) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: dec }) : '');
// eslint-disable-next-line no-control-regex
const CONTROLE_LIGNE = /[\u0000-\u001F]/;

export default class OmbriereDossierModal {
  constructor() {
    this.state = new OmbriereDossierState();
    this.exporter = new OmbriereDossierExport(this.state);
    this.busy = false;
    this.stale = false;
    this.limites = LIMITES_DEFAUT;
    this.quota = null;
    this.champs = [];
    this.current = 'pieces';
    this._build();
    this.state.onStatutServeur = (err) => { if (err) this._status(`Réglages non enregistrés : ${err}`, true); };
  }

  // -------------------------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------------------------
  _build() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'omb-dossier-overlay';
    this.modal = document.createElement('div');
    this.modal.id = 'omb-dossier-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'omb-dossier-title');
    this.modal.innerHTML = `
      <div class="dp-header">
        <h2 id="omb-dossier-title"><i class="bi bi-file-earmark-ruled"></i> Dossier de plans de conception - ombrières</h2>
        <button type="button" class="dp-close" title="Fermer" aria-label="Fermer">&times;</button>
      </div>
      <div class="dp-body">
        <div class="dp-steps" role="navigation" aria-label="Étapes du dossier">${STEPS.map((s, i) => `
          <button type="button" class="dp-step${i === 0 ? ' active' : ''}" data-step="${s.id}">
            <span class="dp-step-num">${i + 1}</span><span class="dp-step-label">${s.label}</span><span class="dp-step-flag"></span>
          </button>`).join('')}
          <p class="dp-rgpd"><i class="bi bi-info-circle"></i> <span data-quota-info></span></p>
        </div>
        <div class="dp-panels">${STEPS.map((s, i) => `<div class="dp-panel${i === 0 ? ' active' : ''}" data-panel="${s.id}"></div>`).join('')}</div>
      </div>
      <div class="dp-footer">
        <button type="button" class="dp-btn dp-btn-ghost" data-nav="prev">Précédent</button>
        <span class="dp-footer-status" aria-live="polite"></span>
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
      if (e.key === 'Escape' && this.isOpen() && !this.busy) this.close();
    });
  }

  isOpen() {
    return this.modal.classList.contains('open');
  }

  /** @param {{profil?: 'ombrieres'|'toitures'|'mixte'}} [options] */
  async open({ profil = 'ombrieres' } = {}) {
    const choisi = PROFILS[profil] || PROFILS.ombrieres;
    const autreProjet = this.state.projet && this.state.projet !== (localStorage.getItem('current_projet_id') || 'sans_projet');
    const autreProfil = choisi !== this.state.profil;
    // Un dossier généré appartient à un projet ET à un profil : il ne se télécharge pas sous un autre.
    if (autreProjet || autreProfil) { this.exporter.result = null; this.stale = false; this._details = null; this.current = 'pieces'; }
    if (autreProfil) this.state.choisirProfil(choisi);
    this.modal.querySelector('#omb-dossier-title').innerHTML = `<i class="bi bi-file-earmark-ruled"></i> ${esc(choisi.titreModal)}`;
    await this.state.load();
    this.champs = listerChamps(choisi);
    this.aper = resultatsAper();
    await Promise.all([this._chargerLimites(), this._prefill(), this._chargerQuota()]);
    this.modal.querySelector('[data-quota-info]').textContent = texteQuotaDossier(this.limites.dossier && this.limites.dossier.generationsParProjet);
    this._renderAll();
    this.overlay.classList.add('open');
    this.modal.classList.add('open');
  }

  close() {
    if (this.busy) return;
    this.overlay.classList.remove('open');
    this.modal.classList.remove('open');
  }

  async _chargerLimites() {
    if (this._limitesChargees) return;
    try {
      const res = await fetch('/concevoir_mon_projet/api/ombrieres/dossier/limites', { credentials: 'same-origin' });
      if (res.ok) {
        const json = await res.json();
        // Réponse mal formée : bornes par défaut (la validation ne doit jamais planter sur elles).
        const motifOk = json && json.dossier && typeof json.dossier.indicePattern === 'string' && (() => {
          try { new RegExp(json.dossier.indicePattern); return true; } catch (e) { return false; }
        })();
        if (motifOk && json.reglementation && typeof json.reglementation.sections === 'object') {
          this.limites = json;
          this._limitesChargees = true;
        }
      }
    } catch (e) { /* bornes par défaut */ }
  }

  async _chargerQuota() {
    this.quota = await this.exporter.quota();
  }

  async _prefill() {
    const d = this.state.data;
    if (!d.adresse) {
      try {
        const projet = await CartoucheData.getProjectInfo();
        if (projet && projet.adresse) d.adresse = projet.adresse.slice(0, 200);
      } catch (e) { /* adresse saisie à la main */ }
    }
  }

  _champsRetenus() {
    return this.state.champsRetenus(this.champs);
  }

  /** Pièces à produire : sans champ configurable retenu, ni coupe ni façade. */
  _piecesChoisies() {
    return this.state.piecesChoisies(this._champsRetenus());
  }

  // -------------------------------------------------------------------------------------------
  // Validation (miroir de app/services/ombrieres_dossier/validation.py)
  // -------------------------------------------------------------------------------------------
  _erreursDossier() {
    const d = this.state.data;
    const erreurs = {};
    if (!new RegExp(this.limites.dossier.indicePattern).test(enTexte(d.indice))) erreurs.indice = 'Indice invalide (ex. « A », « B », « A1 »).';
    if (enTexte(d.maitreOuvrage).trim().length > 120 || CONTROLE_LIGNE.test(enTexte(d.maitreOuvrage))) erreurs.maitreOuvrage = '120 caractères au plus, sur une ligne.';
    if (enTexte(d.adresse).trim().length > 200 || CONTROLE_LIGNE.test(enTexte(d.adresse))) erreurs.adresse = '200 caractères au plus, sur une ligne.';
    // Page Réglementation : types, longueurs, lignes, caractères imprimables, débordement de la page A4
    // (dossier_reglementation_validation.js, miroir de valider_reglementation côté serveur).
    Object.assign(erreurs, erreursReglementation(d.reglementation, SECTIONS_REGLEMENTATION, this._bornesReg(), reglementationDeborde));
    if (!this._piecesChoisies().length) erreurs.pieces = 'Sélectionnez au moins une pièce.';
    if (!this.champs.length) erreurs.champs = this.state.profil.aucun;
    else if (!this._champsRetenus().length) erreurs.champs = 'Cochez au moins un champ PV.';
    return erreurs;
  }

  /** Bornes de la page Réglementation (serveur, complétées par les valeurs par défaut). */
  _bornesReg() {
    return bornesReglementation(this.limites, LIMITES_DEFAUT, SECTIONS_REGLEMENTATION);
  }

  _modifie() {
    if (this.exporter.result) this.stale = true;
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
    const idx = STEPS.findIndex((s) => s.id === this.current);
    this.goTo(STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + delta))].id);
  }

  _renderAll() {
    this._renderPieces();
    this._renderReglementation();
    this._renderExport();
    this._updateFlags();
    this.goTo(this.current);
  }

  _panel(id) {
    return this.modal.querySelector(`[data-panel="${id}"]`);
  }

  _updateFlags() {
    const e = this._erreursDossier();
    const warn = {
      pieces: !!(e.indice || e.maitreOuvrage || e.adresse || e.pieces || e.champs),
      reglementation: Object.keys(e).some((k) => k.startsWith('reg_')),
      export: this.stale,
    };
    this.modal.querySelectorAll('.dp-step').forEach((b) => {
      b.querySelector('.dp-step-flag').className = `dp-step-flag ${warn[b.dataset.step] ? 'warn' : 'ok'}`;
    });
    this.modal.querySelectorAll('[data-erreur]').forEach((el) => {
      const msg = e[el.dataset.erreur];
      el.textContent = msg || '';
      el.hidden = !msg;
      const champ = this.modal.querySelector(`[data-controle="${el.dataset.erreur}"]`);
      if (champ) champ.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  }

  // -------------------------------------------------------------------------------------------
  // Étape 1 : pièces & réglages
  // -------------------------------------------------------------------------------------------
  _etatAper() {
    const a = this.aper;
    if (!a) return { classe: 'ko', texte: 'Calcul APER indisponible : la carte n\'est pas encore prête.' };
    if (!a.aDesSurfaces) return { classe: 'ko', texte: 'Aucune surface APER tracée : utilisez les outils « Loi APER » de la carte avant de générer.' };
    return {
      classe: a.isConforme ? 'ok' : 'ko',
      texte: `Surface assujettie ${nb(a.surfaceAssujettie, 0)} m² - objectif ${nb(a.surfaceSolarisableHuwart, 0)} m², projeté ${nb(a.surfaceProjeteeTotale, 0)} m² : ${a.isConforme ? 'conforme' : 'non conforme'}.`,
    };
  }

  /**
   * Information « Productible » (demande explicite) : le dossier reprend le productible pvlib AVEC
   * perte d'ombrage du bouton « Calculer et visualiser » ; à défaut, une estimation PVGIS sans ombrage.
   */
  /** Origine de la vue 3D du projet : capture de l'utilisateur prioritaire, sinon rendu automatique. */
  _blocVue3D() {
    const capture = captureUtilisateurProjet(this._champsRetenus());
    const perimee = capture ? null : captureUtilisateurPerimee(this._champsRetenus());
    return `<p class="dp-help"><i class="bi bi-camera"></i> ${capture
      ? `Vue 3D du projet : votre capture (appareil photo de la vue 3D, ${esc(capture.sourceId)}) sera insérée dans le dossier.`
      : perimee
        ? `Vue 3D du projet : votre capture (${esc(perimee)}) ne correspond plus à l'implantation actuelle des champs PV (ou ne les montrait pas tous) : rendu automatique. Reprenez la capture depuis la vue 3D pour insérer votre propre vue.`
        : "Vue 3D du projet : rendu automatique. Pour insérer votre propre vue, ouvrez la vue 3D, cadrez la scène puis cliquez sur l'appareil photo."}</p>`;
  }

  _blocProductible() {
    if (!this.champs.length) return '';
    const { couverts, manquants } = etatProductionPvlib(this._champsRetenus());
    const etat = manquants.length
      ? `<p class="omb-aper-etat ko">${esc(messageSansOmbrage(manquants))}</p>`
      : `<p class="omb-aper-etat ok">Productible avec ombrage à jour pour ${esc(couverts.join(', '))} : il sera repris dans le rapport.</p>`;
    return `
      <div class="dp-alert omb-productible" style="margin-top:10px">
        <strong><i class="bi bi-sun"></i> Productible</strong><br>
        Si vous cliquez sur « Calculer et visualiser » (calcul de production et d'autoconsommation), le dossier reprend
        le productible calculé <strong>avec la perte d'ombrage</strong> de la scène 3D, champ par champ,
        dans le tableau géométrie et la présentation. Sans ce calcul, ou si le calepinage a changé depuis, une estimation
        sans ombrage est utilisée.
        ${etat}
      </div>`;
  }

  _renderPieces() {
    const d = this.state.data;
    const p = this._panel('pieces');
    const exclus = new Set(d.champsExclus || []);
    const aper = this._etatAper();
    const profil = this.state.profil;
    const plans = {
      ombrieres: ' Une coupe et une façade par ombrière.',
      mixte: ' Une coupe et une façade par ombrière et par petit champ (pas pour les toitures).',
    }[profil.id] || '';
    p.innerHTML = `
      <h3>Pièces et réglages du dossier</h3>
      <p class="dp-help">Pages A4 et A3 paysage, cartouche commun.${plans} Le maître d'ouvrage et l'indice alimentent le cartouche de chaque page.</p>
      <div class="dp-grid">
        <label class="dp-field dp-span-2">Adresse des travaux
          <input type="text" data-field="adresse" data-controle="adresse" maxlength="200" value="${esc(d.adresse)}" placeholder="N°, rue, code postal, commune">
          <small class="pcs-erreur" data-erreur="adresse" hidden></small>
        </label>
        <label class="dp-field">Maître d'ouvrage
          <input type="text" data-field="maitreOuvrage" data-controle="maitreOuvrage" maxlength="120" value="${esc(d.maitreOuvrage)}" autocomplete="off">
          <small class="pcs-erreur" data-erreur="maitreOuvrage" hidden></small>
        </label>
        <label class="dp-field">Indice du dossier
          <input type="text" data-field="indice" data-controle="indice" value="${esc(d.indice)}" maxlength="3" style="max-width:6rem">
          <small class="pcs-erreur" data-erreur="indice" hidden></small>
        </label>
      </div>
      <h4>${esc(profil.champs)} du dossier</h4>
      ${this.champs.length ? `<ul class="dp-pieces omb-champs">${this.champs.map((c) => `<li>
          <label><input type="checkbox" data-champ="${esc(c.sourceId)}"${exclus.has(c.sourceId) ? '' : ' checked'}> <span><strong>${esc(c.sourceId)}</strong> - ${esc(c.libelleType)}</span></label>
          <span class="dp-badge">${c.nbPanneaux} panneaux - ${esc(nb(c.puissanceKwc))} kWc</span>
        </li>`).join('')}</ul>` : ''}
      <small class="pcs-erreur" data-erreur="champs" hidden></small>
      <h4>Pièces</h4>
      <ul class="dp-pieces pcs-pieces">${this.state.pieces.map((piece) => {
        const coche = piece.id === 'reglementation' ? d.reglementation.inclure : d.pieces[piece.id];
        return `<li>
          <label><input type="checkbox" data-piece="${piece.id}"${coche ? ' checked' : ''}> <span>${esc(piece.titre)}</span></label>
          <span class="dp-badge">${LIBELLES_FORMAT[piece.format]}</span>
          <span></span>
          ${piece.id === 'aper' ? `<p class="omb-aper-etat ${aper.classe}" style="grid-column:1/-1">${esc(aper.texte)}</p>` : ''}
        </li>`;
      }).join('')}</ul>
      <small class="pcs-erreur" data-erreur="pieces" hidden></small>
      ${optionDevisHtml(d)}
      ${this._blocProductible()}
      ${this._blocVue3D()}
      <p class="dp-help">Les pages « Résultats de la loi APER » et « Réglementation » sont facultatives (décochées par défaut). La page APER reprend le calcul du calculateur APER de la carte ; le texte de la Réglementation se complète à l'étape 2.</p>`;
    p.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
      this.state.set(el.dataset.field, el.dataset.field === 'indice' ? el.value.toUpperCase().trim() : el.value);
      if (el.dataset.field === 'indice' && el.value !== el.value.toUpperCase()) el.value = el.value.toUpperCase();
      this._modifie();
      this._updateFlags();
    }));
    p.querySelectorAll('[data-piece]').forEach((cb) => cb.addEventListener('change', () => this._cocherPiece(cb.dataset.piece, cb.checked)));
    brancherOptionDevis(p, this.state, this.exporter, (m, err) => this._status(m, err));
    p.querySelectorAll('[data-champ]').forEach((cb) => cb.addEventListener('change', () => {
      const ex = new Set(this.state.data.champsExclus || []);
      if (cb.checked) ex.delete(cb.dataset.champ); else ex.add(cb.dataset.champ);
      this.state.set('champsExclus', [...ex]);
      this._modifie();
      this._updateFlags();
    }));
  }

  _cocherPiece(id, coche) {
    if (id === 'reglementation') this.state.data.reglementation.inclure = coche;
    else this.state.data.pieces[id] = coche;
    this.state.save();
    this._modifie();
    // Les deux cases « Réglementation » (étapes 1 et 2) restent synchronisées.
    this.modal.querySelectorAll(`[data-piece="${id}"], [data-inclure="${id}"]`).forEach((el) => { el.checked = coche; });
    this._updateFlags();
  }

  // -------------------------------------------------------------------------------------------
  // Étape 2 : réglementation
  // -------------------------------------------------------------------------------------------
  _renderReglementation() {
    const reg = this.state.data.reglementation;
    const p = this._panel('reglementation');
    p.innerHTML = `
      <h3>Réglementation : urbanisme, SDIS & sécurité, contraintes du site</h3>
      <p class="dp-help">Page A4 portrait. Textes types pré-remplis à adapter au projet : remplacez chaque « [à compléter] ».</p>
      <label class="dp-check pcs-inclure"><input type="checkbox" data-inclure="reglementation"${reg.inclure ? ' checked' : ''}> Inclure cette page dans le dossier</label>
      ${SECTIONS_REGLEMENTATION.map((s) => {
        const regle = this._bornesReg()[s.id];
        return `
        <div class="dp-notice-head">
          <span>${esc(s.titre)} <small class="pcs-compteur" data-compteur="${s.id}"></small></span>
          <button type="button" class="dp-link" data-reinit="${s.id}"><i class="bi bi-arrow-counterclockwise"></i> Rétablir le texte type</button>
        </div>
        <textarea class="dp-notice-text pcs-reg-text" data-section="${s.id}" data-controle="reg_${s.id}" maxlength="${regle.max}" rows="7" aria-label="${esc(s.titre)}">${esc(reg.sections[s.id])}</textarea>
        <small class="pcs-erreur" data-erreur="reg_${s.id}" hidden></small>`;
      }).join('')}
      <small class="pcs-erreur" data-erreur="reg_page" hidden></small>
      <p class="dp-help">Caractères acceptés : ceux des polices du PDF (lettres accentuées, ponctuation, « € », « ’ », « – »…). Les émojis et symboles comme « ≥ » ou « → » ne s'impriment pas.</p>`;
    const compteur = (id) => {
      const el = p.querySelector(`[data-compteur="${id}"]`);
      el.textContent = `${enTexte(reg.sections[id]).trim().length} / ${this._bornesReg()[id].max}`;
    };
    SECTIONS_REGLEMENTATION.forEach((s) => compteur(s.id));
    p.querySelector('[data-inclure]').addEventListener('change', (e) => this._cocherPiece('reglementation', e.target.checked));
    p.querySelectorAll('[data-section]').forEach((ta) => ta.addEventListener('input', () => {
      reg.sections[ta.dataset.section] = ta.value;
      this.state.save();
      this._modifie();
      compteur(ta.dataset.section);
      this._updateFlags();
    }));
    p.querySelectorAll('[data-reinit]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.reinit;
      reg.sections[id] = enTexte(TEXTES_TYPES[id]);
      p.querySelector(`[data-section="${id}"]`).value = reg.sections[id];
      this.state.save();
      this._modifie();
      compteur(id);
      this._updateFlags();
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Étape 3 : génération & export
  // -------------------------------------------------------------------------------------------
  _texteQuota() {
    const q = (this.exporter.result && this.exporter.result.quota) || this.quota;
    if (!q) return '';
    if (q.limite == null) return 'Générations illimitées (administrateur).';
    return `Générations utilisées pour ce projet : ${q.utilisees} / ${q.limite}.`;
  }

  _renderExport() {
    const p = this._panel('export');
    if (!p) return;
    const result = this.exporter.result;
    const ids = this._piecesChoisies();
    const codes = codesPieces(ids);
    const erreurs = this._erreursDossier();
    const pret = result && !this.busy && !this.stale;
    const q = this.quota;
    const quotaEpuise = q && q.limite != null && q.restantes <= 0;
    const champs = this._champsRetenus();
    const nbAvecPlans = champsAvecPlans(champs).length;
    const configurateurs = profilAvecPlans(this.state.profil)
      ? " Le configurateur de chaque ombrière ou petit champ est ouvert en arrière-plan pour tracer sa coupe et sa façade : comptez quelques secondes par structure."
      : '';
    p.innerHTML = `
      <h3>Génération et export</h3>
      <p class="dp-help">Une génération vérifie les saisies et compte dans le quota de ce dossier pour le projet.${configurateurs} Ensuite, téléchargez le dossier complet, le ZIP ou chaque plan séparément, sans limite.</p>
      ${champs.length ? `<p class="dp-help">${esc(this.state.profil.champs)} du dossier : <strong>${champs.map((c) => esc(c.sourceId)).join(', ')}</strong>.</p>` : ''}
      <ul class="dp-pieces">${this.state.pieces.filter((pc) => ids.includes(pc.id)).map((pc) => `<li class="ok">
          <span><span class="dp-piece-code">${esc(codes[pc.id] || '-')}</span> ${esc(pc.titre)}</span>
          <span class="dp-piece-msg">${LIBELLES_FORMAT[pc.format]}${pc.parChamp ? ` - ${pc.plans ? nbAvecPlans : champs.length} page(s)` : ''}</span>
          ${pret && result.ids.includes(pc.id) ? `<button type="button" class="dp-link" data-dl="${pc.id}" title="Télécharger ce plan seul"><i class="bi bi-download"></i></button>` : '<span></span>'}
        </li>`).join('')}</ul>
      <div class="dp-progress" ${this.busy ? '' : 'hidden'}><div class="dp-progress-bar"><span></span></div><div class="dp-progress-msg"></div></div>
      ${Object.keys(erreurs).length ? `<div class="dp-alert pcs-alert-erreur">${Object.values(erreurs).map(esc).join('<br>')}</div>` : ''}
      ${result && result.captures.warnings.length ? `<div class="dp-alert">${result.captures.warnings.map(esc).join('<br>')}</div>` : ''}
      ${this.stale ? '<div class="dp-alert">Des saisies ont changé depuis la génération : regénérez le dossier pour les prendre en compte (une génération sera comptée).</div>' : ''}
      ${this._details && this._details.length ? `<div class="dp-alert pcs-alert-erreur">${this._details.map(esc).join('<br>')}</div>` : ''}
      <div class="dp-export-actions">
        ${this.busy
          ? '<button type="button" class="dp-btn dp-btn-ghost pcs-cancel">Annuler</button>'
          : `<button type="button" class="dp-btn dp-btn-primary pcs-generate"${Object.keys(erreurs).length || quotaEpuise ? ' disabled' : ''}><i class="bi bi-gear"></i> ${result ? 'Regénérer' : 'Générer le dossier'}</button>`}
        <button type="button" class="dp-btn pcs-dl-pdf"${pret ? '' : ' disabled'}><i class="bi bi-file-earmark-pdf"></i> Dossier complet (PDF)</button>
        <button type="button" class="dp-btn pcs-dl-zip"${pret ? '' : ' disabled'}><i class="bi bi-file-earmark-zip"></i> Plan par plan (ZIP)</button>
        ${boutonsDevisHtml(pret, result)}
      </div>
      <p class="dp-help" style="margin-top:12px">${esc(this._texteQuota())}${quotaEpuise ? ' Quota atteint pour ce projet.' : ''}
        ${pret ? ` Généré à ${result.generatedAt.toLocaleTimeString('fr-FR')}.` : ''}</p>`;

    p.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => this._safe(() => {
      const { blob, filename } = this.exporter.piece(b.dataset.dl);
      download(blob, filename);
    })));
    const gen = p.querySelector('.pcs-generate');
    if (gen) gen.addEventListener('click', () => this._generer());
    const cancel = p.querySelector('.pcs-cancel');
    if (cancel) cancel.addEventListener('click', () => { this.exporter.cancel(); cancel.disabled = true; cancel.textContent = 'Annulation…'; });
    p.querySelector('.pcs-dl-pdf').addEventListener('click', () => this._safe(() => {
      const { blob, filename } = this.exporter.pdfComplet();
      download(blob, filename);
    }));
    brancherBoutonsDevis(p, {
      exporter: this.exporter, safe: (fn) => this._safe(fn), status: (m, err) => this._status(m, err),
      apercu: () => this._apercu(),
    });
    p.querySelector('.pcs-dl-zip').addEventListener('click', () => this._safe(async () => {
      this._status("Création de l'archive ZIP…");
      const { blob, filename } = await this.exporter.zip((m) => this._status(m));
      download(blob, filename);
      this._status('');
    }));
  }

  async _generer() {
    const ids = this._piecesChoisies();
    if (Object.keys(this._erreursDossier()).length) { this._status('Corrigez les saisies signalées.', true); return; }
    this.busy = true;
    this.stale = false;
    this._details = null;
    this._status('');
    this.modal.classList.add('busy');
    this._renderExport();
    const bar = () => this.modal.querySelector('.dp-progress-bar span');
    const msg = () => this.modal.querySelector('.dp-progress-msg');
    const avant = JSON.stringify(this.state.data);
    try {
      await this.exporter.generer(ids, this._champsRetenus(), (m, ratio) => {
        if (msg()) msg().textContent = m;
        if (bar() && ratio != null) bar().style.width = `${Math.round(ratio * 100)}%`;
      });
      this.quota = this.exporter.result.quota || this.quota;
      if (JSON.stringify(this.state.data) !== avant) this.stale = true;
      this._status('Dossier prêt : téléchargez le dossier complet, le ZIP ou chaque plan.');
      if (devisPropose() && !this.stale) setTimeout(() => this._safe(() => this._apercu()), 0);
    } catch (e) {
      console.error('[Dossier ombrières] Génération :', e);
      this.exporter.result = null;
      this._details = e.details || null;
      this._status(e.message || 'Génération impossible.', true);
      await this._chargerQuota();
    } finally {
      this.busy = false;
      this.modal.classList.remove('busy');
      this._renderExport();
      this._updateFlags();
    }
  }

  /** Parcours Chiffrage : dossier complet affiché avant téléchargement (viewer du rapport). */
  _apercu() {
    const { blob, filename } = this.exporter.pdfComplet();
    ouvrirApercuPdf(blob, filename, { titre: 'Dossier plans - aperçu avant téléchargement' });
  }

  async _safe(fn) {
    if (this.stale) { this._status('Des saisies ont changé : regénérez le dossier.', true); return; }
    try {
      await fn();
    } catch (e) {
      console.error('[Dossier ombrières]', e);
      this._status(e.message || 'Erreur inattendue.', true);
    }
  }

  _status(message, error = false) {
    const el = this.modal.querySelector('.dp-footer-status');
    el.textContent = message || '';
    el.classList.toggle('error', error);
  }
}
