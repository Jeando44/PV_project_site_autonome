/**
 * Modal de confirmation avec deux boutons (Confirmer / Annuler)
 * @class ConfirmModal
 */
class ConfirmModal {
  constructor() {
    this.createModal();
    this.onConfirmCallback = null;
    this.onCancelCallback = null;
  }

  createModal() {
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    modal.style.cssText = `
      display: none;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      z-index: 1001;
      min-width: 300px;
      text-align: center;
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1000;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Confirmation';
    title.style.cssText = `
      color: #e74c3c;
      margin-top: 0;
      margin-bottom: 15px;
    `;

    const message = document.createElement('p');
    message.id = 'confirm-message';
    message.style.cssText = `
      margin-bottom: 20px;
      line-height: 1.5;
      line-break: auto;
      text-align: left;
    `;

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: center;
    `;

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Annuler';
    cancelButton.style.cssText = `
      background-color: #757575;
      color: white;
      border: none;
      padding: 2px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.3s;
      height: fit-content;
      min-width: 100px;
      margin: 0 auto;
      display: block;
      text-align: center;
    `;
    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.backgroundColor = '#616161';
    });
    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.backgroundColor = '#757575';
    });
    cancelButton.onclick = () => this._handleCancel();

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirmer';
    confirmButton.style.cssText = `
      background-color: #e74c3c;
      color: white;
      border: none;
      padding: 2px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.3s;
      height: fit-content;
      margin: 0 auto;
      display: block;
      text-align: center;
      min-width: 100px;
    `;
    confirmButton.addEventListener('mouseenter', () => {
      confirmButton.style.backgroundColor = '#c0392b';
    });
    confirmButton.addEventListener('mouseleave', () => {
      confirmButton.style.backgroundColor = '#e74c3c';
    });
    confirmButton.onclick = () => this._handleConfirm();

    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(confirmButton);

    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(buttonsContainer);

    const mapContainer = document.getElementById('map');
    if (mapContainer) {
      mapContainer.appendChild(overlay);
      mapContainer.appendChild(modal);
    }

    this.modal = modal;
    this.overlay = overlay;
    this.message = message;
  }

  /**
   * Affiche la modal de confirmation
   * @param {string} message - Message de confirmation
   * @param {Function} onConfirm - Callback appelé si l'utilisateur confirme
   * @param {Function} onCancel - Callback appelé si l'utilisateur annule (optionnel)
   */
  show(message, onConfirm, onCancel = null) {
    this.message.textContent = message;
    this.onConfirmCallback = onConfirm;
    this.onCancelCallback = onCancel;
    this.overlay.style.display = 'block';
    this.modal.style.display = 'block';
  }

  hide() {
    this.overlay.style.display = 'none';
    this.modal.style.display = 'none';
    this.onConfirmCallback = null;
    this.onCancelCallback = null;
  }

  _handleConfirm() {
    if (this.onConfirmCallback) {
      this.onConfirmCallback();
    }
    this.hide();
  }

  _handleCancel() {
    if (this.onCancelCallback) {
      this.onCancelCallback();
    }
    this.hide();
  }

  remove() {
    if (this.modal?.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
    if (this.overlay?.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}

export default ConfirmModal;

