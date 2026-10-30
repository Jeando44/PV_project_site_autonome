class ErrorModal {
    constructor() {
        this.createModal();
    }

    createModal() {
        const modal = document.createElement('div');
        modal.className = 'error-modal';
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
        title.textContent = 'Information :';
        title.style.cssText = `
            color: #e74c3c;
            margin-top: 0;
            margin-bottom: 15px;
        `;

        const message = document.createElement('p');
        message.id = 'error-message';
        message.style.cssText = `
            margin-bottom: 20px;
            line-height: 1.5;
            line-break: auto;
            text-align: left;
        `;

        const button = document.createElement('button');
        button.textContent = 'Fermer';
        button.style.cssText = `
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
        `;
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#c0392b';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#e74c3c';
        });
        button.onclick = () => this.hide();

        modal.appendChild(title);
        modal.appendChild(message);
        modal.appendChild(button);

        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.appendChild(overlay);
            mapContainer.appendChild(modal);
        }

        this.modal = modal;
        this.overlay = overlay;
        this.message = message;
    }

    show(errorMessage) {
        this.message.textContent = errorMessage;
        this.overlay.style.display = 'block';
        this.modal.style.display = 'block';
    }

    hide() {
        this.overlay.style.display = 'none';
        this.modal.style.display = 'none';
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

export default ErrorModal; 