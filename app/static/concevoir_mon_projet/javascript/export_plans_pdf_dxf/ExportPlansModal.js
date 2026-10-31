import PlanSituationExporter from './plan_situation.js?v=4';
import PlanDeMasseExporter from './plan_de_masse.js?v=6';
import CaptureVeil from './utils/CaptureVeil.js';
import triggerBlobDownload from './utils/BlobDownload.js';

/**
 * Modal "Exporter les plans en PDF et DXF" : un onglet par plan (Situation,
 * Masse, Coupe ombrière métal, Coupe petit champ solaire). Vit directement
 * dans la page (pas d'iframe) pour accéder à window.map / MapViewsControl
 * lors de la capture.
 */
const TABS = [
  {
    id: 'situation', label: 'Plan de situation', enabled: true, exporter: PlanSituationExporter, pdfOnly: true,
    description: 'Plan de situation projet - A3 paysage, 2 pages (1/10000 puis 1/1000).',
  },
  {
    id: 'masse', label: 'Plan de masse', enabled: true, exporter: PlanDeMasseExporter,
    description: "Plan de masse - A3 paysage (1/500 puis échelle auto-adaptée à l'implantation des panneaux), avec les panneaux du calepinage ; pour un calepinage sur canevas, une page « Plan de calepinage » par champ PV.",
  },
  {
    id: 'coupe_ombriere', label: 'Coupe ombrière métal', enabled: false,
    stubMessage: "Export disponible directement depuis le formulaire de chaque ombrière métal (boutons \"Exporter Coupe + Façade en PDF\" / \"Exporter en DXF\"), une ombrière à la fois.",
  },
  { id: 'coupe_petit_champ', label: 'Coupe petit champ solaire', enabled: false },
  {
    id: 'devis', label: 'Devis', enabled: true, pdfOnly: true,
    // window.ResidentielChiffrage.PDF est défini par etude_economique/residentiel/DevisPdfGenerator.js
    // (script autonome chargé sur cette même page, cf. index.html) — indirection via wrapper pour
    // ne pas figer la référence à l'instant de l'import de ce module.
    exporter: { exportPdf: (opts) => window.ResidentielChiffrage.PDF.exportPdf(opts) },
    description: 'Devis résidentiel (CAPEX + charges annuelles), avec le détail des lignes par poste.',
  },
];

export default class ExportPlansModal {
  constructor() {
    this._lastGenerated = {}; // { [tabId]: { blob, filename } }
    this._buildDom();
  }

  _buildDom() {
    const overlay = document.createElement('div');
    overlay.id = 'export-plans-modal-overlay';
    overlay.addEventListener('click', () => this.close());

    const modal = document.createElement('div');
    modal.id = 'export-plans-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    modal.innerHTML = `
      <div id="export-plans-modal-header">
        <h2>Exporter les plans en PDF et DXF</h2>
        <button id="export-plans-modal-close" title="Fermer" aria-label="Fermer">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div id="export-plans-modal-body">
        <div class="export-plans-tabs"></div>
        <div class="export-plans-sections"></div>
      </div>
    `;

    const tabsContainer = modal.querySelector('.export-plans-tabs');
    const sectionsContainer = modal.querySelector('.export-plans-sections');

    TABS.forEach((tab, index) => {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'export-plans-tab' + (index === 0 ? ' active' : '');
      tabBtn.textContent = tab.label;
      tabBtn.dataset.tab = tab.id;
      tabBtn.addEventListener('click', () => this._selectTab(tab.id));
      tabsContainer.appendChild(tabBtn);

      sectionsContainer.appendChild(this._buildSection(tab, index === 0));
    });

    modal.querySelector('#export-plans-modal-close').addEventListener('click', () => this.close());

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    this.overlay = overlay;
    this.modal = modal;
  }

  _buildSection(tab, active) {
    const section = document.createElement('div');
    section.className = 'export-plans-section' + (active ? ' active' : '');
    section.dataset.section = tab.id;

    if (!tab.enabled) {
      section.innerHTML = `
        <p class="export-plans-desc">${tab.label}</p>
        <div class="export-plans-stub-notice">${tab.stubMessage || 'Disponible prochainement.'}</div>
      `;
      return section;
    }

    if (tab.id === 'devis') {
      section.innerHTML = `
        <p class="export-plans-desc">${tab.description || ''}</p>
        <div class="export-plans-actions" style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="export-plans-btn export-plans-btn-pdf" data-action="devis-detaille">
            <i class="fas fa-file-invoice-dollar"></i> Exporter le devis détaillé en PDF/Excel
          </button>
          <button type="button" class="export-plans-btn export-plans-btn-pdf" data-action="devis-synthetique">
            <i class="fas fa-file-invoice"></i> Exporter le devis synthétique en PDF/Excel
          </button>
        </div>
        <div class="export-plans-status"></div>
      `;
      const statusEl = section.querySelector('.export-plans-status');
      const btnDetaille = section.querySelector('[data-action="devis-detaille"]');
      const btnSynthetique = section.querySelector('[data-action="devis-synthetique"]');
      const runDevisExport = async (detailed) => {
        btnDetaille.disabled = true;
        btnSynthetique.disabled = true;
        statusEl.textContent = 'Génération de la prévisualisation du devis en cours...';
        statusEl.classList.remove('error');
        try {
          const PDF = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
          const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
          if (!PDF || typeof PDF.previewAndExport !== 'function') {
            throw new Error("Module d'export de devis indisponible.");
          }
          const result = await PDF.previewAndExport({
            capexOverride: Capex && typeof Capex.getData === 'function' ? Capex.getData() : undefined,
            detailed,
            onProgress: (msg) => { statusEl.textContent = msg; },
          });
          this._lastGenerated[tab.id] = result;
          statusEl.textContent = `Aperçu ouvert : ${result.filename}`;
        } catch (e) {
          console.error('[ExportPlansModal] Échec export devis:', e);
          statusEl.textContent = e.message || "Échec de l'export du devis.";
          statusEl.classList.add('error');
        } finally {
          btnDetaille.disabled = false;
          btnSynthetique.disabled = false;
        }
      };
      btnDetaille.addEventListener('click', () => runDevisExport(true));
      btnSynthetique.addEventListener('click', () => runDevisExport(false));
      return section;
    }

    section.innerHTML = `
      <p class="export-plans-desc">${tab.description || ''}</p>
      <label class="export-plans-field">
        Indice / Révision
        <input type="text" class="export-plans-indice" value="A" maxlength="4" style="width:3rem;">
      </label>
      <div class="export-plans-actions">
        <button class="export-plans-btn export-plans-btn-pdf" data-action="pdf">Export PDF</button>
        ${tab.pdfOnly ? '' : '<button class="export-plans-btn export-plans-btn-dxf" data-action="dxf">Export DXF</button>'}
        <button class="export-plans-btn export-plans-btn-download" data-action="download" disabled>Télécharger</button>
      </div>
      <div class="export-plans-status"></div>
    `;

    const statusEl = section.querySelector('.export-plans-status');
    const downloadBtn = section.querySelector('[data-action="download"]');
    const pdfBtn = section.querySelector('[data-action="pdf"]');
    const dxfBtn = section.querySelector('[data-action="dxf"]');
    const indiceInput = section.querySelector('.export-plans-indice');

    const setBusy = (busy, message) => {
      pdfBtn.disabled = busy;
      if (dxfBtn) dxfBtn.disabled = busy;
      statusEl.textContent = message || '';
      statusEl.classList.remove('error');
    };

    const runExport = async (kind) => {
      setBusy(true, `Génération ${kind.toUpperCase()} en cours...`);
      try {
        const indice = indiceInput.value.trim() || 'A';
        const onProgress = (msg) => { statusEl.textContent = msg; };
        const result = kind === 'pdf'
          ? await tab.exporter.exportPdf({ indice, onProgress })
          : await tab.exporter.exportDxf({ indice, onProgress });
        this._lastGenerated[tab.id] = result;
        downloadBtn.disabled = false;
        statusEl.textContent = `${kind.toUpperCase()} généré : ${result.filename}`;
        if (kind === 'pdf' && result && result.blob && typeof window.ouvrirApercuPdf === 'function') {
          window.ouvrirApercuPdf(result.blob, result.filename, { titre: `Prévisualisation — ${tab.label}` });
        }
      } catch (e) {
        console.error(`[ExportPlansModal] Échec export ${kind}:`, e);
        statusEl.textContent = e.message || `Échec de l'export ${kind.toUpperCase()}.`;
        statusEl.classList.add('error');
      } finally {
        // Garde-fou : l'export leve et retire lui-meme le voile de capture
        // (CaptureVeil), mais si une exception le court-circuite, la carte
        // resterait masquee. Ici l'export est termine, quel qu'en soit l'issue.
        CaptureVeil.forceHide();
        pdfBtn.disabled = false;
        if (dxfBtn) dxfBtn.disabled = false;
      }
    };

    pdfBtn.addEventListener('click', () => runExport('pdf'));
    if (dxfBtn) dxfBtn.addEventListener('click', () => runExport('dxf'));
    downloadBtn.addEventListener('click', () => {
      const result = this._lastGenerated[tab.id];
      if (result) triggerBlobDownload(result.blob, result.filename);
    });

    return section;
  }

  _selectTab(tabId) {
    this.modal.querySelectorAll('.export-plans-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    this.modal.querySelectorAll('.export-plans-section').forEach((sec) => {
      sec.classList.toggle('active', sec.dataset.section === tabId);
    });
  }

  open() {
    this.overlay.classList.add('open');
    this.modal.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
    this.modal.classList.remove('open');
  }
}
