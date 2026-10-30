/**
 * SystemPageLoader - Charge le contenu du fichier "Page système.docx" dans localStorage
 */

export default class SystemPageLoader {
  constructor() {
    this.docxPath = '/static/concevoir_mon_projet/docs/Page système.docx';
  }

  /**
   * Charge et extrait le contenu du fichier .docx
   */
  async loadDocxContent() {
    try {
      console.log('📄 Chargement du fichier Page système.docx...');

      // Vérifier que mammoth est disponible
      if (typeof mammoth === 'undefined') {
        console.error('❌ Mammoth.js n\'est pas chargé');
        return null;
      }

      // Charger le fichier .docx
      const response = await fetch(this.docxPath);

      if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      // Extraire le texte avec mammoth.js
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });

      if (result.value && result.value.trim() !== '') {
        console.log('✅ Contenu du fichier Page système.docx extrait avec succès');
        console.log(`   Longueur: ${result.value.length} caractères`);

        // Afficher les messages d'avertissement de mammoth s'il y en a
        if (result.messages.length > 0) {
          console.warn('⚠️ Messages de mammoth:', result.messages);
        }

        return result.value;
      } else {
        console.warn('⚠️ Le fichier docx semble vide');
        return null;
      }
    } catch (error) {
      console.error('❌ Erreur lors du chargement du fichier docx:', error);
      return null;
    }
  }

  /**
   * Sauvegarde le contenu dans localStorage
   */
  async saveToLocalStorage() {
    const content = await this.loadDocxContent();

    if (!content) {
      console.warn('⚠️ Aucun contenu à sauvegarder');
      return false;
    }

    try {
      // Récupérer les données du projet existantes
      const savedData = localStorage.getItem('solarProjectData');
      let projectData = {};

      if (savedData) {
        projectData = JSON.parse(savedData);
      }

      // Ajouter le contenu système
      projectData.systemPageContent = content;
      projectData.systemPageLoadedAt = new Date().toISOString();

      // Sauvegarder dans localStorage
      localStorage.setItem('solarProjectData', JSON.stringify(projectData));

      console.error('✅ Contenu de la page système sauvegardé dans localStorage  project info dans la page systempageloader:', projectData);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde dans localStorage:', error);
      return false;
    }
  }

  /**
   * Charge le contenu au démarrage de l'application
   */
  static async autoLoad() {
    console.log('🔄 Chargement automatique de la page système...');
    const loader = new SystemPageLoader();
    await loader.saveToLocalStorage();
  }
}

// Auto-charger au chargement du module si window est disponible
if (typeof window !== 'undefined') {
  // Attendre que mammoth soit chargé
  window.addEventListener('load', async () => {
    // Petit délai pour s'assurer que mammoth est bien chargé
    setTimeout(async () => {
      await SystemPageLoader.autoLoad();
    }, 500);
  });
}

export { SystemPageLoader };
