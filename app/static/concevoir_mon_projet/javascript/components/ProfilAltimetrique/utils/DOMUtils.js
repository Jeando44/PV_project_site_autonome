import { CHART_CONFIG, PROVIDER_LABELS, TAB_COLORS, ELEVATION_PROVIDERS } from '../constants.js';

/**
 * Utilitaires pour créer et gérer les éléments DOM
 * @class DOMUtils
 */
class DOMUtils {
  /**
   * Crée un bouton avec styles et événements
   * @param {string} text - Texte du bouton
   * @param {string} title - Tooltip
   * @param {Object} styles - Styles CSS personnalisés
   * @param {Function} onClick - Gestionnaire de clic
   * @returns {HTMLButtonElement} Bouton créé
   */
  static createButton(text, title, styles = {}, onClick = null) {
    const button = document.createElement('button');
    button.textContent = text;
    button.title = title;

    const defaultStyles = {
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease'
    };

    button.style.cssText = Object.entries({ ...defaultStyles, ...styles })
      .map(([key, value]) => `${this._camelToKebab(key)}: ${value}`)
      .join('; ');

    if (onClick) {
      button.addEventListener('click', onClick);
    }

    return button;
  }

  /**
   * Crée un input de texte
   * @param {string} placeholder - Placeholder
   * @param {string} value - Valeur initiale
   * @param {Function} onChange - Gestionnaire de changement
   * @returns {HTMLInputElement} Input créé
   */
  static createInput(placeholder, value = '', onChange = null) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    
    input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      transition: border-color 0.2s ease;
    `;

    input.addEventListener('focus', () => {
      input.style.borderColor = '#2196F3';
    });

    input.addEventListener('blur', () => {
      input.style.borderColor = '#ccc';
    });

    if (onChange) {
      input.addEventListener('input', onChange);
    }

    return input;
  }

  /**
   * Crée un élément select
   * @param {Array<{value: string, label: string}>} options - Options du select
   * @param {string} defaultValue - Valeur par défaut
   * @param {string} title - Tooltip
   * @param {Function} onChange - Gestionnaire de changement
   * @returns {HTMLSelectElement} Select créé
   */
  static createSelect(options, defaultValue = '', title = '', onChange = null) {
    const select = document.createElement('select');
    select.title = title;
    
    select.style.cssText = `
      padding: 6px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      background-color: white;
      cursor: pointer;
      transition: border-color 0.2s ease;
    `;

    // Ajouter les options
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === defaultValue) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener('focus', () => {
      select.style.borderColor = '#2196F3';
    });

    select.addEventListener('blur', () => {
      select.style.borderColor = '#ccc';
    });

    if (onChange) {
      select.addEventListener('change', onChange);
    }

    return select;
  }

  /**
   * Crée un élément d'onglet
   * @param {string} name - Nom de l'onglet
   * @param {boolean} isActive - Si l'onglet est actif
   * @param {Function} onClick - Gestionnaire de clic
   * @returns {HTMLDivElement} Onglet créé
   */
  static createTabElement(name, isActive, onClick = null) {
    const tab = document.createElement('div');
    tab.classList.add('profil-tab');
    if (isActive) {
      tab.classList.add('active');
    }

    // Toujours utiliser les couleurs bleues (Géoportail) pour les onglets
    const colors = TAB_COLORS[ELEVATION_PROVIDERS.GEOPORTAIL];

    tab.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      border-radius: 4px 4px 0 0;
      font-size: 12px;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      background-color: ${isActive ? colors.active : colors.inactive};
      color: ${isActive ? 'white' : colors.text};
    `;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    nameSpan.style.cssText = 'flex: 1;';

    const closeButton = document.createElement('span');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      padding: 0 4px;
    `;
    
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const event = new CustomEvent('tab:close', { detail: { name } });
      tab.dispatchEvent(event);
    });

    tab.appendChild(nameSpan);
    tab.appendChild(closeButton);

    if (onClick) {
      tab.addEventListener('click', onClick);
    }

    return tab;
  }

  /**
   * Crée la section de résumé des statistiques
   * @param {Object} stats - Statistiques à afficher
   * @param {string} provider - Fournisseur de données (optionnel)
   * @param {Array<Object>} points - Points du profil (pour afficher premier et dernier point)
   * @returns {HTMLDivElement} Section de résumé
   */
  static createSummarySection(stats, provider = null, points = null) {
    const container = document.createElement('div');
    container.style.cssText = `
      padding: 2px;
      background-color: white;
      width: 100%;
      height: fit-content;
      display: flex;
      flex-direction: column;
      gap: 2px;
    `;

    // Section du provider (si fourni)
    if (provider) {
      const providerSection = document.createElement('div');
      providerSection.style.cssText = `
        padding: 6px 12px;
        font-size: 10px;
        display: flex;
        justify-content: start;
        align-items: start;
        gap: 6px;
      `;

      const providerLabel = document.createElement('span');
      providerLabel.textContent = 'Fournisseur:';
      providerLabel.style.cssText = 'font-weight: 600; color: #666;';

      const providerValue = document.createElement('span');
      const displayLabel = PROVIDER_LABELS[provider] || provider || 'Inconnu';
      providerValue.textContent = displayLabel;
      providerValue.style.cssText = 'color: #2196F3; font-weight: bold;';

      providerSection.appendChild(providerLabel);
      providerSection.appendChild(providerValue);
      container.appendChild(providerSection);
    }

    // Container pour les stats (2 colonnes)
    const statsContainer = document.createElement('div');
    statsContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
    `;

    const section1 = document.createElement('div');
    section1.style.cssText = `
      display: flex;
      flex-direction: column;
      height:fit-content;
      gap: 6px;
      padding: 8px 12px;
      background-color: rgba(255, 255, 255, 0.9);
      font-size: 10px;
    `;
    const section2 = document.createElement('div');
    section2.style.cssText = `
      display: flex;
      flex-direction: column;
      height:fit-content;
      gap: 6px;
      padding: 8px 12px;
      background-color: rgba(255, 255, 255, 0.9);
      font-size: 10px;
    `;
    const statItems1 = [
      { label: 'Distance totale', value: `${stats.totalDistance.toFixed(2)} m`, color: '#333' },
      { label: 'Dénivelé positif', value: `+${stats.positiveElevation.toFixed(2)} m`, color: '#4CAF50' },
      { label: 'Dénivelé négatif', value: `-${stats.negativeElevation.toFixed(2)} m`, color: '#f44336' },

    ];
    const statItems2 = [
      { label: 'Pente moyenne', value: `${stats.averageSlope.toFixed(2)}%`, color: '#333' },
      { label: 'Plus forte pente', value: `${stats.maxSlope.toFixed(2)}%`, color: '#FF9800' },
      { label: 'Altitude max', value: `${stats.maxAltitude.toFixed(2)} m`, color: '#2196F3' }
    ];

    // Ajouter les informations du premier et dernier point si disponibles
    if (points && points.length > 0) {
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      
      // Ajouter le premier point dans la section 1
      statItems1.push({
        label: 'Premier point',
        value: `${firstPoint.altitude.toFixed(2)} m`,
        color: '#9C27B0',
        subtitle: `(${firstPoint.distance.toFixed(2)} m)`
      });
      
      // Ajouter le dernier point dans la section 2
      statItems2.push({
        label: 'Dernier point',
        value: `${lastPoint.altitude.toFixed(2)} m`,
        color: '#9C27B0',
        subtitle: `(${lastPoint.distance.toFixed(2)} m)`
      });
    }

    statItems1.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

      const label = document.createElement('span');
      label.textContent = item.label + ':';
      label.style.cssText = 'font-weight: 600; color: #666;';

      const valueContainer = document.createElement('div');
      valueContainer.style.cssText = `color: ${item.color}; font-weight: bold; display: flex; flex-direction: row; align-items: center; gap: 4px; justify-content: flex-end;`;
      
      const value = document.createElement('span');
      value.textContent = item.value;
      
      valueContainer.appendChild(value);
      

      div.appendChild(label);
      div.appendChild(valueContainer);
      section1.appendChild(div);
    });

    statItems2.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

      const label = document.createElement('span');
      label.textContent = item.label + ':';
      label.style.cssText = 'font-weight: 600; color: #666;';

      const valueContainer = document.createElement('div');
      valueContainer.style.cssText = `color: ${item.color}; font-weight: bold; display: flex; flex-direction: row; align-items: center; gap: 4px; justify-content: flex-end;`;
      
      const value = document.createElement('span');
      value.textContent = item.value;
      
      valueContainer.appendChild(value);
      


      div.appendChild(label);
      div.appendChild(valueContainer);
      section2.appendChild(div);
    });

    statsContainer.appendChild(section1);
    statsContainer.appendChild(section2);
    container.appendChild(statsContainer);
    return container;
  }

  /**
   * Crée le conteneur du graphique
   * @returns {HTMLDivElement} Conteneur du graphique
   */
  static createChartContainer() {
    const container = document.createElement('div');
    container.classList.add('profil-chart-container');


    return container;
  }

  /**
   * Convertit camelCase en kebab-case
   * @private
   * @param {string} str - Chaîne en camelCase
   * @returns {string} Chaîne en kebab-case
   */
  static _camelToKebab(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
  }
}

export default DOMUtils;

