/**
 * EconomicDataSaver - Sauvegarde automatique des données économiques dans localStorage
 * Ce script doit être chargé dans la page Etudes_Economique.html
 */

export default class EconomicDataSaver {
  constructor() {
    this.debounceTimer = null;
    this.debounceDelay = 1000; // 1 seconde
  }

  /**
   * Initialise la sauvegarde automatique
   */
  init() {
    console.log('💾 Initialisation de la sauvegarde automatique des données économiques');

    // Observer les changements sur tous les champs de saisie
    this.setupInputObservers();

    // Sauvegarder lors de la fermeture de la fenêtre/modal
    window.addEventListener('beforeunload', () => {
      this.saveEconomicData();
    });
  }

  /**
   * Configure les observateurs sur les champs de saisie
   */
  setupInputObservers() {
    // CAPEX inputs
    const capexInputs = [
      'panneaux', 'onduleurs', 'structure', 'electricite',
      'etudes', 'installation', 'raccordement', 'autres_capex'
    ];

    // OPEX inputs
    const opexInputs = [
      'maintenance', 'assurance', 'monitoring', 'loyer', 'autres_opex'
    ];

    // Observer les changements
    [...capexInputs, ...opexInputs].forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('input', () => {
          this.debouncedSave();
        });
      }
    });

    // Observer les changements sur les éléments calculés (avec MutationObserver)
    this.setupDisplayObservers();
  }

  /**
   * Configure les observateurs sur les éléments d'affichage calculés
   */
  setupDisplayObservers() {
    const displayElements = [
      'total_capex_display', 'ratio_capex_display',
      'total_opex_display', 'ratio_opex_display',
      'van_display', 'tri_display', 'pri_display', 'lcoe_display',
      'panneaux_display', 'onduleurs_display', 'structure_display',
      'electricite_display', 'etudes_display', 'installation_display',
      'raccordement_display', 'autres_capex_display',
      'maintenance_display', 'assurance_display', 'monitoring_display',
      'loyer_display', 'autres_opex_display'
    ];

    displayElements.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        const observer = new MutationObserver(() => {
          this.debouncedSave();
        });

        observer.observe(element, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    });
  }

  /**
   * Sauvegarde avec debounce pour éviter trop d'appels
   */
  debouncedSave() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.saveEconomicData();
    }, this.debounceDelay);
  }

  /**
   * Récupère la valeur d'un élément en toute sécurité
   */
  getElementValue(id) {
    const element = document.getElementById(id);
    if (!element) return null;

    // Pour les inputs
    if (element.tagName === 'INPUT') {
      return element.value || null;
    }

    // Pour les spans/divs d'affichage
    return element.textContent?.trim() || null;
  }

  /**
   * Sauvegarde toutes les données économiques dans localStorage
   */
  saveEconomicData() {
    try {
      // Récupérer les données du projet existantes
      const savedData = localStorage.getItem('solarProjectData');
      let projectData = {};

      if (savedData) {
        projectData = JSON.parse(savedData);
      }

      // Collecter les données CAPEX
      const capexData = {
        panneaux: this.getElementValue('panneaux_display'),
        onduleurs: this.getElementValue('onduleurs_display'),
        structure: this.getElementValue('structure_display'),
        electricite: this.getElementValue('electricite_display'),
        etudes: this.getElementValue('etudes_display'),
        installation: this.getElementValue('installation_display'),
        raccordement: this.getElementValue('raccordement_display'),
        autres: this.getElementValue('autres_capex_display'),
        total: this.getElementValue('total_capex_display'),
        ratio: this.getElementValue('ratio_capex_display'),
      };

      // Collecter les données OPEX
      const opexData = {
        maintenance: this.getElementValue('maintenance_display'),
        assurance: this.getElementValue('assurance_display'),
        monitoring: this.getElementValue('monitoring_display'),
        loyer: this.getElementValue('loyer_display'),
        autres: this.getElementValue('autres_opex_display'),
        total: this.getElementValue('total_opex_display'),
        ratio: this.getElementValue('ratio_opex_display'),
      };

      // Collecter les indicateurs financiers
      const indicatorsData = {
        van: this.getElementValue('van_display'),
        tri: this.getElementValue('tri_display'),
        pri: this.getElementValue('pri_display'),
        lcoe: this.getElementValue('lcoe_display'),
      };

      // Vérifier qu'il y a au moins quelques données
      const hasCapexData = Object.values(capexData).some(v => v !== null && v !== '');
      const hasOpexData = Object.values(opexData).some(v => v !== null && v !== '');

      if (!hasCapexData && !hasOpexData) {
        console.log('⚠️ Aucune donnée économique à sauvegarder');
        return false;
      }

      // Sauvegarder dans le projet
      projectData.economicData = {
        capex: capexData,
        opex: opexData,
        indicators: indicatorsData,
        savedAt: new Date().toISOString()
      };

      // Sauvegarder dans localStorage
      localStorage.setItem('solarProjectData', JSON.stringify(projectData));

      console.log('✅ Données économiques sauvegardées dans localStorage');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des données économiques:', error);
      return false;
    }
  }

  /**
   * Charge les données économiques depuis localStorage
   */
  loadEconomicData() {
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (!savedData) {
        console.log('⚠️ Aucune donnée économique sauvegardée');
        return null;
      }

      const projectData = JSON.parse(savedData);
      if (!projectData.economicData) {
        console.log('⚠️ Aucune donnée économique dans le projet');
        return null;
      }

      console.log('✅ Données économiques chargées depuis localStorage');
      return projectData.economicData;
    } catch (error) {
      console.error('❌ Erreur lors du chargement des données économiques:', error);
      return null;
    }
  }

  /**
   * Restaure les données économiques dans le formulaire
   */
  restoreEconomicData() {
    const economicData = this.loadEconomicData();
    if (!economicData) return false;

    try {
      // Restaurer les inputs CAPEX
      if (economicData.capex) {
        const capexInputs = {
          'panneaux': 'panneaux',
          'onduleurs': 'onduleurs',
          'structure': 'structure',
          'electricite': 'electricite',
          'etudes': 'etudes',
          'installation': 'installation',
          'raccordement': 'raccordement',
          'autres': 'autres_capex'
        };

        Object.entries(capexInputs).forEach(([key, inputId]) => {
          const input = document.getElementById(inputId);
          if (input && economicData.capex[key]) {
            // Extraire la valeur numérique si c'est une chaîne avec unité
            const value = economicData.capex[key].toString().replace(/[^\d.,]/g, '');
            input.value = value;
          }
        });
      }

      // Restaurer les inputs OPEX
      if (economicData.opex) {
        const opexInputs = {
          'maintenance': 'maintenance',
          'assurance': 'assurance',
          'monitoring': 'monitoring',
          'loyer': 'loyer',
          'autres': 'autres_opex'
        };

        Object.entries(opexInputs).forEach(([key, inputId]) => {
          const input = document.getElementById(inputId);
          if (input && economicData.opex[key]) {
            const value = economicData.opex[key].toString().replace(/[^\d.,]/g, '');
            input.value = value;
          }
        });
      }

      console.log('✅ Données économiques restaurées dans le formulaire');

      // Déclencher le recalcul si la fonction existe
      if (typeof window.calculerRentabilite === 'function') {
        window.calculerRentabilite();
      }

      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la restauration des données économiques:', error);
      return false;
    }
  }

  /**
   * Initialisation automatique lors du chargement
   */
  static autoInit() {
    console.log('🔄 Initialisation automatique de EconomicDataSaver...');
    const saver = new EconomicDataSaver();
    saver.init();

    // Essayer de restaurer les données après un court délai
    setTimeout(() => {
      saver.restoreEconomicData();
    }, 500);

    // Exposer globalement pour permettre l'utilisation externe
    window.economicDataSaver = saver;
  }
}

// Auto-initialiser si dans un environnement browser
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    EconomicDataSaver.autoInit();
  });
}

export { EconomicDataSaver };
