// DeletedPanelsStorage.js
// Utilitaire pour la gestion des panneaux supprimés dans le localStorage

const DELETED_PANELS_KEY = 'deletedPanels';

export class DeletedPanelsStorage {
  /**
   * Sauvegarde la liste des panneaux supprimés dans le localStorage
   * @param {Array} panels - Liste des panneaux supprimés
   */
  static save(panels) {
    try {
      localStorage.setItem(DELETED_PANELS_KEY, JSON.stringify(panels));
    } catch (e) {
      // Gestion d'erreur de stockage
      console.error('Erreur lors de la sauvegarde des panneaux supprimés :', e);
    }
  }

  /**
   * Charge la liste des panneaux supprimés depuis le localStorage
   * @returns {Array} Liste des panneaux supprimés
   */
  static load() {
    try {
      const data = localStorage.getItem(DELETED_PANELS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      // Gestion d'erreur de parsing
      console.error('Erreur lors du chargement des panneaux supprimés :', e);
      return [];
    }
  }

  /**
   * Ajoute un panneau supprimé à la liste et sauvegarde
   * @param {Object} panelData - Données du panneau supprimé
   */
  static add(panelData) {
    const panels = DeletedPanelsStorage.load();
    panels.push(panelData);
    DeletedPanelsStorage.save(panels);
  }

  /**
   * Supprime un panneau restauré de la liste et sauvegarde
   * @param {Function} predicate - Fonction de test pour trouver le panneau à retirer
   */
  static remove(predicate) {
    let panels = DeletedPanelsStorage.load();
    panels = panels.filter(panel => !predicate(panel));
    DeletedPanelsStorage.save(panels);
  }

  /**
   * Vide la liste des panneaux supprimés
   */
  static clear() {
    DeletedPanelsStorage.save([]);
  }
}

export default DeletedPanelsStorage;
