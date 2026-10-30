class OffsetModal {
  constructor() {
    this.modal = null;
    this.callback = null;
    this.isVisible = false;
    this.createModal();
  }

  createModal() {
    // Créer la structure du modal
    this.modal = document.createElement('div');
    this.modal.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      min-width: 300px;
    `;

    this.modal.innerHTML = `
      <h3 style="margin-top: 0;">Décalage de la forme</h3>
      <p style="font-size: 13px; color: #666;">
        Valeur positive = décalage intérieur<br>
        Valeur négative = décalage extérieur
      </p>
      <div style="margin: 15px 0;">
        <label style="display: block; margin-bottom: 5px;">Distance de décalage (m):</label>
        <input type="number" id="offset-value" step="0.1" value="1" 
               style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="offset-cancel" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">
          Annuler
        </button>
        <button id="offset-validate" style="padding: 8px 16px; border: none; background: #de0000; color: white; border-radius: 4px; cursor: pointer;">
          Valider
        </button>
      </div>
    `;

    // Overlay sombre
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 9999;
    `;

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.modal);

    // Event listeners
    this.modal.querySelector('#offset-cancel').addEventListener('click', () => this.hide());
    this.modal.querySelector('#offset-validate').addEventListener('click', () => this.validate());
    this.overlay.addEventListener('click', () => this.hide());
    
    // Validation avec Enter
    this.modal.querySelector('#offset-value').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.validate();
    });
  }

  show(callback) {
    this.callback = callback;
    this.overlay.style.display = 'block';
    this.modal.style.display = 'block';
    this.isVisible = true;
    this.modal.querySelector('#offset-value').focus();
  }

  hide() {
    this.overlay.style.display = 'none';
    this.modal.style.display = 'none';
    this.isVisible = false;
    this.callback = null;
  }

  isOpen() {
    return this.isVisible;
  }

  validate() {
    const value = parseFloat(this.modal.querySelector('#offset-value').value);
    if (isNaN(value) || value === 0) {
      alert('Veuillez entrer une valeur de décalage valide (différente de 0)');
      return;
    }
    if (this.callback) {
      this.callback(value);
    }
    this.hide();
  }
}

export default OffsetModal;