import * as CalculationUtils from "./DrawingControl/utils/CalculationUtils.js";
import PdfGraphReportGenerator from '../services/PdfGraphReportGenerator.js';

class GraphModal {
  static instance = null;

  constructor() {
    if (GraphModal.instance) {
      return GraphModal.instance;
    }
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.initialModalX = 0;
    this.initialModalY = 0;
    this.chartInstance = null;
    this.productible_p50 = 0;
    this.production_total = 0;
    this.sommeTotalP90 = 0;
    this.initialP50Total = 0;
    this.p50Chart = null;
    this.p90Chart = null;

    GraphModal.instance = this;
    return GraphModal.instance;
  }

  startDrag(e) {
    if (e.target.tagName === "BUTTON") return;

    if (e.target === this.modal || e.target.tagName === "H3") {
      this.isDragging = true;

      // Sauvegarder la position initiale du clic
      this.startX = e.clientX;
      this.startY = e.clientY;

      // Sauvegarder la position initiale de la modal
      const rect = this.modal.getBoundingClientRect();
      this.initialModalX = rect.left;
      this.initialModalY = rect.top;

      // Convertir en position absolue si ce n'est pas déjà fait
      if (this.modal.style.transform.includes("-50%")) {
        this.modal.style.transform = "none";
        this.modal.style.top = rect.top + "px";
        this.modal.style.left = rect.left + "px";
      }
    }
  }

  drag(e) {
    if (!this.isDragging) return;

    e.preventDefault();

    // Calculer le déplacement depuis la position initiale du clic
    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;

    // Appliquer le déplacement à partir de la position initiale de la modal
    this.modal.style.left = this.initialModalX + deltaX + "px";
    this.modal.style.top = this.initialModalY + deltaY + "px";
  }

  endDrag() {
    this.isDragging = false;
  }

  async showGraph() {
    try {
      // Ne pas appeler this.show() ici car nous allons créer une nouvelle modale

      // Supprimer la modale existante seulement si elle est présente dans le document
      if (this.modal && this.modal.parentNode === document.body) {
        document.body.removeChild(this.modal);
      }

      const newModal = document.createElement("div");
      newModal.classList.add("graph-modal-overlay");
      newModal.id = "modalOverlay";

      const modalContainer = document.createElement("div");
      modalContainer.classList.add("graph-modal-container");
      modalContainer.id = "modalContainer";

      const modalHeader = document.createElement("div");
      modalHeader.classList.add("graph-modal-header");
      modalHeader.innerHTML = `
        <h2><i class="fa fa-cogs"></i>Analyse de production solaire</h2>
        <button id="closeModalBtn" class="close-modal-btn">&times;</button>
      `;

      const modalContent = document.createElement("div");
      modalContent.classList.add("graph-modal-content");
      modalContent.innerHTML = `
        <div class="charts-wrapper">
          <!-- Premier graphique : Production solaire P50 mensuelle -->
          <div id="chart-container-p50" class="chart-container">
            <input type="hidden" id="voir-annee" value="20" name="voir-annee">
            <h3>Production solaire P50 mensuelle</h3>
            <div class="canvas-wrapper">
              <canvas id="p50Chart"></canvas>
            </div>
                        
            <div class="chart-info">
              <div class="info-row">
                <div class="pill" style="margin-top: -20px;">
                  <span>Somme annuelle P50:</span>
                  <span id="p50Total" class="total-info"></span>
                </div>
                <div class="pill">
                  <span>Production corrigée P50:</span>
                  <span id="correctedP50Total" class="total-info"></span>
                </div>
              </div>
              <div class="control p50">
                <label for="p50Adjustment">Ajustement P50 (%):</label>
                <input type="number" id="p50Adjustment" value="0" min="-100" max="100" step="0.1">
              </div>
              
              <div class="info-complementaire control p50">
                <p>Puissance projet: <span id="puissanceProjet"></span> kWc,</p>
                <p>Productible: <span id="productibleProjet"></span> kWh/kWc/an</p>
              </div>
              <div class="info-complementaire control" style='margin-top: -10px;'>
                <!--<p>Production projet: <span id="productionProjet"></span> MWH,</p>-->
                <p>BD Météologique: PVGIS-SARAH3</p>
              </div>
              <div class="info-complementaire">
                <p> 
                  <span class="bd-buttons">
                    <button class="bd-btn active">PVGIS-SARAH3</button>
                    <button class="bd-btn">SOLARGIS</button>
                  </span>
                </p>
              </div>
            </div>
          </div>

          <!-- Deuxième graphique : Projection Production P90 -->
          <div id="chart-container-p90" class="chart-container">
            <h3>Projection Production P90</h3>
            
            <div class="canvas-wrapper">
              <canvas id="p90Chart"></canvas>
            </div>
            <div class="chart-info">
              <div class="info-row pill" style="margin-top: -10px;">
                <span>Somme totale de production:</span>
                <span id="p90Total" class="total-info"></span>
              </div>

              <div class="controls">
                <div class="control">
                  <label for="uncertainty">Incertitude (%) :</label>
                  <input type="number" id="uncertainty" value="4.90" min="0.2" max="5" step="0.1">
                </div>
                <div class="control">
                  <label for="degradation">Dégradation (%) :</label>
                  <input type="number" id="degradation" value="0.25" min="2" max="10" step="0.1">
                </div>
                <div class="control">
                  <label for="duration">Durée (années) :</label>
                  <div class="duration-buttons">
                    <button class="duration-btn active" data-duration="20">20 ans</button>
                    <button class="duration-btn" data-duration="25">25 ans</button>
                    <button class="duration-btn" data-duration="30">30 ans</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      const modalFooter = document.createElement("div");
      modalFooter.classList.add("graph-modal-footer");
      modalFooter.innerHTML = `
        <button id="resetSizeBtn" class="modal-btn secondary">Réinitialiser la taille</button>
        <button id="exportPdfBtn" class="modal-btn">Exporter en PDF</button>
      `;

      modalContainer.appendChild(modalHeader);
      modalContainer.appendChild(modalContent);
      modalContainer.appendChild(modalFooter);

      newModal.appendChild(modalContainer);
      document.body.appendChild(newModal);

      // // Ajouter ceci comme référence pour une utilisation future
      this.modal = newModal;
      await this.showContents();
      await this.durationButtons();

      await this.p50AdjustmentInput();
      await this.uncertaintyInput();
      await this.degradationInput();
    } catch (error) {
      alert("Erreur dans showGraph: " + error.message);
      console.error("Erreur complète:", error);
    }
  }

  async showContents() {
    const modalOverlay = document.getElementById("modalOverlay");
    const modalContainer = document.getElementById("modalContainer");
    const closeModalBtn = document.getElementById("closeModalBtn");
    const p50AdjustmentInput = document.getElementById("p50Adjustment");
    const uncertaintyInput = document.getElementById("uncertainty");
    const degradationInput = document.getElementById("degradation");

    const p50TotalSpan = document.getElementById("p50Total");
    const correctedP50TotalSpan = document.getElementById("correctedP50Total");
    const p90TotalSpan = document.getElementById("p90Total");

    const puissanceProjet = document.getElementById("puissanceProjet");
    const productibleProjet = document.getElementById("productibleProjet");

    const resetSizeBtn = document.getElementById("resetSizeBtn");
    const exportPdfBtn = document.getElementById("exportPdfBtn");

    const initialWidth = "90vw";
    const initialHeight = "85vh";
    this.initialP50Total = 0;

    let annee = parseInt(document.getElementById("voir-annee").value);

    try {
      if (window.storageManager) {
        await window.storageManager.savePageData();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const savedData = localStorage.getItem("solarProjectData");
      if (!savedData) {
        await this.closeGraph();
        return;
      }
      const data = JSON.parse(savedData);
      if (!data.shapes || Object.keys(data.shapes).length === 0) {
        await this.closeGraph();
        return;
      }

      // ========== FETCH BACKEND ==========
      const response = await fetch("/concevoir_mon_projet/api/graph-modal/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarData: data.solarData,
          shapes: data.shapes,
          formData: data.formData,
          p50_adjustment: parseFloat(p50AdjustmentInput.value) || 0,
          uncertainty: parseFloat(uncertaintyInput.value) || 4.9,
          degradation: parseFloat(degradationInput.value) || 0.25,
          duration: annee,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        console.error("Erreur backend:", result.error);
        await this.closeGraph();
        return;
      }

      // ========== INJECTION DES RÉSULTATS ==========
      this.productible_p50 = result.data.projet.productible_p50;
      this.production_total = result.data.projet.production_total;
      this.initialP50Total = result.data.p50.initial_total;
      this.sommeTotalP90 = result.data.p90.total;

      // Affichage des valeurs
      p50TotalSpan.textContent = result.data.p50.initial_total_display + " MWh";
      correctedP50TotalSpan.textContent = result.data.p50.corrected_total_display + " MWh";
      p90TotalSpan.textContent = result.data.p90.total_display.toFixed(2) + " MWh";

      puissanceProjet.textContent = result.data.projet.puissance_kwc.toFixed(2);
      productibleProjet.textContent = result.data.projet.productible_p50;

      // ========== INJECTION DES GRAPHIQUES (images base64) ==========
      const p50Canvas = document.getElementById("p50Chart");
      const p90Canvas = document.getElementById("p90Chart");

      // Remplacer les canvas par des images
      const p50Img = document.createElement("img");
      p50Img.src = result.p50_chart;
      p50Img.style.width = "100%";
      p50Img.style.height = "100%";
      p50Img.style.objectFit = "contain";
      p50Img.id = "p50ChartImg";

      const p90Img = document.createElement("img");
      p90Img.src = result.p90_chart;
      p90Img.style.width = "100%";
      p90Img.style.height = "100%";
      p90Img.style.objectFit = "contain";
      p90Img.id = "p90ChartImg";

      // Détruire les anciens charts Chart.js s'ils existent
      if (this.p50Chart) { this.p50Chart.destroy(); this.p50Chart = null; }
      if (this.p90Chart) { this.p90Chart.destroy(); this.p90Chart = null; }

      // Remplacer canvas par img (ou mettre à jour si déjà remplacé)
      const existingP50Img = document.getElementById("p50ChartImg");
      const existingP90Img = document.getElementById("p90ChartImg");

      if (existingP50Img) {
        existingP50Img.src = result.p50_chart;
      } else {
        p50Canvas.parentNode.replaceChild(p50Img, p50Canvas);
      }

      if (existingP90Img) {
        existingP90Img.src = result.p90_chart;
      } else {
        p90Canvas.parentNode.replaceChild(p90Img, p90Canvas);
      }

    } catch (error) {
      console.error("Erreur complète:", error);
    }

    // ========== EVENT LISTENERS (inchangés) ==========
    closeModalBtn.addEventListener("click", () => {
      modalOverlay.style.display = "none";
    });

    interact(modalContainer)
      .draggable({
        allowFrom: ".graph-modal-header",
        listeners: {
          move(event) {
            const target = event.target;
            const x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;
            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute("data-x", x);
            target.setAttribute("data-y", y);
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        listeners: {
          move: function (event) {
            let { x, y } = event.target.dataset;
            x = parseFloat(x) || 0;
            y = parseFloat(y) || 0;
            Object.assign(event.target.style, {
              width: `${event.rect.width}px`,
              height: `${event.rect.height}px`,
            });
          },
        },
        modifiers: [
          interact.modifiers.restrictSize({ min: { width: 500, height: 400 } }),
        ],
      });

    resetSizeBtn.addEventListener("click", () => {
      modalContainer.style.width = initialWidth;
      modalContainer.style.height = initialHeight;
      modalContainer.style.transform = `translate(-50%, -50%)`;
      modalContainer.setAttribute("data-x", 0);
      modalContainer.setAttribute("data-y", 0);
    });

    exportPdfBtn.addEventListener("click", async () => {
      console.log('💾 Sauvegarde automatique des graphiques pour l\'export PDF...');
      await PdfGraphReportGenerator.saveGraphsToLocalStorage();

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");
      const p50ChartBox = document.querySelector(".chart-container:nth-of-type(1)");
      const p90ChartBox = document.querySelector(".chart-container:nth-of-type(2)");

      const captureAndAdd = async (element, yPos) => {
        const canvas = await html2canvas(element, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");
        const imgWidth = 190;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        doc.addImage(imgData, "PNG", 10, yPos, imgWidth, imgHeight);
        return yPos + imgHeight + 10;
      };

      doc.setFontSize(22);
      doc.text("Rapport de Production Solaire", 10, 20);

      let y = 30;
      y = await captureAndAdd(p50ChartBox, y);
      y = await captureAndAdd(p90ChartBox, y);

      doc.save("rapport_production_solaire.pdf");
    });

    setTimeout(async () => {
      console.log('💾 Sauvegarde automatique des graphiques dans localStorage...');
      await PdfGraphReportGenerator.saveGraphsToLocalStorage();
    }, 1000);
  }


  async closeGraph() {
    const modalOverlay = document.getElementById("modalOverlay");

    modalOverlay.style.display = "none";
    if (this.p50Chart) {
      this.p50Chart.destroy();
    }
    if (this.p90Chart) {
      this.p90Chart.destroy();
    }
  }

  async p50AdjustmentInput() {
    const p50Adjustment = document.getElementById("p50Adjustment");

    p50Adjustment.addEventListener("keyup", () => {
      this.showContents();
    });
  }

  async uncertaintyInput() {
    const incertitude = document.getElementById("uncertainty");

    incertitude.addEventListener("keyup", () => {
      document.getElementById("incertitude_P90").value = incertitude.value;
      this.showContents();
    });
  }

  async degradationInput() {
    const coefficient = document.getElementById("degradation");

    coefficient.addEventListener("keyup", () => {
      document.getElementById("coefficient_performance").value =
        coefficient.value;
      this.showContents();
    });
  }

  async durationButtons() {
    const durationButtons = document.querySelectorAll(".duration-btn");

    durationButtons.forEach((button) => {
      button.addEventListener("click", () => {
        durationButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        let selectedDuration = parseInt(button.dataset.duration, 10);
        document.getElementById("voir-annee").value = selectedDuration;
        this.showContents();
      });
    });
  }

  static getInstance() {
    if (!GraphModal.instance) {
      GraphModal.instance = new GraphModal();
    }
    return GraphModal.instance;
  }
}

export default GraphModal;
