// utils.js - Fonctions utilitaires
export class Utils {
    static showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${type === 'error' ? 'exclamation-triangle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => document.body.removeChild(toast), 300);
        }, 3000);
    }

    static showError(message) {
        console.error(message);
        this.showToast(message, 'error');
    }

    static debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    static isValidCoordinate(lat, lng) {
        return !isNaN(lat) && !isNaN(lng) &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180;
    }

    static extractAddressComponents(components) {
        const getComponent = (type) =>
            (components.find(c => c.types.includes(type)) || {}).long_name || '';

        return {
            code_postal: getComponent('postal_code'),
            ville: getComponent('locality') || getComponent('administrative_area_level_2'),
            departement: getComponent('administrative_area_level_2'),
            region: getComponent('administrative_area_level_1')
        };
    }

    static setActiveSuggestion(suggestions, index) {
        suggestions.forEach((s, i) => {
            s.classList.toggle('active', i === index);
        });
    }

    static hideSuggestions(container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    static showNotification(message, type = 'info') {
        // Crée une notification toast temporaire
        const toast = document.createElement('div');
        toast.className = `map-notification ${type}`;
        toast.textContent = message;

        // Style de base (à adapter selon votre CSS)
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '250px';
        toast.style.padding = '12px 24px';
        toast.style.backgroundColor = type === 'error' ? '#ff4444' :
            type === 'warning' ? '#ffbb33' : '#33b5e5';
        toast.style.color = 'white';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '1000';
        toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        toast.style.animation = 'fadeIn 0.3s, fadeOut 0.3s 2.7s';

        document.body.appendChild(toast);

        // Suppression automatique après 3 secondes
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}