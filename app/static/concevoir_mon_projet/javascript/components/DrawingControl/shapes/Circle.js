import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS } from '../constants.js';

/**
 * Classe gérant les cercles sur la carte
 */
class Circle {
  /**
   * Constructeur
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnCircles = [];
    this.selectedCircle = null;
    this.usedCircleIds = new Set();
    this.circleLabels = new Map();
    this.labelsVisible = true;
  }

  /**
   * Calcule le rayon d'un cercle en mètres
   * @param {google.maps.Circle} circle - Le cercle à mesurer
   * @returns {number} Rayon en mètres
   */
  calculateCircleRadius(circle) {
    return circle.getRadius();
  }

  /**
   * Met à jour le label d'un cercle avec debounce
   * @param {google.maps.Circle} circle - Le cercle dont le label doit être mis à jour
   */
  updateCircleLabel(circle) {
    try {
      if (!circle || !circle.circleId) return;

      // Utiliser le debounce pour éviter les mises à jour trop fréquentes
      if (circle._updateTimeout) {
        clearTimeout(circle._updateTimeout);
      }
      
      circle._updateTimeout = setTimeout(() => {
        // Vérifier si le cercle est toujours sur la carte
        if (!circle.getMap()) return;

        // Supprimer l'ancien label s'il existe
        const existingLabel = this.circleLabels.get(circle.circleId);
        if (existingLabel) {
          existingLabel.map = null;
        }
        
        const radius = this.calculateCircleRadius(circle);
        if(radius < 1){
          // Supprimer le cercle de la carte
          circle.setMap(null);
          // Supprimer le cercle de la liste des cercles dessinés
          this.drawnCircles = this.drawnCircles.filter(c => c !== circle);
          // Supprimer l'ID de la liste des IDs utilisés
          this.usedCircleIds.delete(circle.circleId);
          // Supprimer le label associé
          const label = this.circleLabels.get(circle.circleId);
          if (label) {
            label.map = null;
            this.circleLabels.delete(circle.circleId);
          }
          // Afficher l'erreur
          this.drawingControl.errorModal.show('Le rayon du cercle est trop petit. Il doit être supérieur à 1m.');
          return;
        }

        // Obtenir le centre du cercle
        const center = circle.getCenter();
        
        // Créer le contenu du label
        const labelContent = document.createElement('div');
        labelContent.className = 'circle-label';
        labelContent.style.cssText = STYLES.CIRCLE_LABEL;
        
        // Créer le contenu du label avec l'ID et le rayon
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'display: flex; flex-direction: row; align-items: center; justify-content: center; width: fit-content;';
        infoDiv.innerHTML = `${circle.circleId} <br> Rayon: ${Math.round(radius * 100) / 100}m`;
        
        // Créer l'input pour le diamètre
        const inputContainer = document.createElement('div');
        inputContainer.classList.add(`input-container-${circle.circleId}`);
        inputContainer.style.cssText = 'margin-top: 5px; display: flex; align-items: center; justify-content: center; width: fit-content; height: 0; opacity:0;';
        
        const diameterInput = document.createElement('input');
        diameterInput.type = 'number';
        diameterInput.min = '2'; // Diamètre minimum de 2m
        diameterInput.value = Math.round(radius * 100) / 100;
        diameterInput.style.cssText = 'width:50px; height:28px; margin-right: 3px; padding: 4px; z-index: 1500; border: 2px solid #4285F4; border-radius: 4px; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
        diameterInput.placeholder = 'Diamètre';
        diameterInput.setAttribute('data-circle-id', circle.circleId); // Attribut pour retrouver facilement le cercle associé
        
        const unitSpan = document.createElement('span');
        unitSpan.textContent = 'm';
        unitSpan.style.marginRight = '3px';
        
        const editButton = document.createElement('button');
        editButton.innerHTML = '✏️'; // Emoji crayon
        editButton.title = 'Modifier le diamètre';
        editButton.style.cssText = 'padding: 2px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; border: none; z-index: 1000;';
        
        // Ajouter l'écouteur d'événement au bouton d'édition
        editButton.addEventListener('click', (e) => {
          e.stopPropagation(); // Empêcher la sélection du cercle
          editButton.style.border = '1px solid #4285F4';
          diameterInput.focus(); // Mettre le focus sur l'input
          diameterInput.select(); // Sélectionner le texte pour faciliter l'édition
        });
        
        // Ajouter un écouteur pour la touche Entrée pour valider la modification
        diameterInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            
            const newDiameter = parseFloat(diameterInput.value);
            if (isNaN(newDiameter) || newDiameter < 2) {
              this.drawingControl.errorModal.show('Le diamètre doit être un nombre supérieur à 2m.');
              return;
            }
            
            // Mettre à jour le rayon du cercle (diamètre)
            circle.setRadius(newDiameter);
            diameterInput.blur(); // Retirer le focus après validation
          }
        });
        
        // Valider également lors de la perte de focus
        diameterInput.addEventListener('blur', (e) => {
          const newDiameter = parseFloat(diameterInput.value);
          if (!isNaN(newDiameter) && newDiameter >= 2) {
            // Mettre à jour le rayon du cercle (diamètre / 2)
            circle.setRadius(newDiameter);
          } else {
            // Restaurer la valeur précédente en cas d'erreur
            diameterInput.value = Math.round(circle.getRadius() * 100) / 100;
          }
        });
        
        // Empêcher la propagation des événements de l'input
        diameterInput.addEventListener('click', (e) => e.stopPropagation());
        diameterInput.addEventListener('dblclick', (e) => e.stopPropagation());
        diameterInput.addEventListener('mousedown', (e) => e.stopPropagation());
        diameterInput.addEventListener('mouseup', (e) => e.stopPropagation());
        diameterInput.addEventListener('touchstart', (e) => e.stopPropagation());
        diameterInput.addEventListener('touchend', (e) => e.stopPropagation());
        
        // Assurer que l'input reste actif quand on clique dessus
        diameterInput.addEventListener('focus', () => {
          diameterInput.style.border = '2px solid #4285F4';
          diameterInput.style.backgroundColor = '#fff';
        });
        
        diameterInput.addEventListener('blur', () => {
          diameterInput.style.border = '1px solid #ccc';
          diameterInput.style.backgroundColor = '';
        });
        
        // Assembler l'interface
        inputContainer.appendChild(editButton);
        inputContainer.appendChild(diameterInput);
        inputContainer.appendChild(unitSpan);
        
        labelContent.appendChild(infoDiv);
        labelContent.appendChild(inputContainer);

        // Déplacer le label en dessous du centre du cercle
        const offset = 0.00003; 
        const offsetPosition = new google.maps.LatLng(
          center.lat() + offset,
          center.lng()
        );
        // Créer le label avec AdvancedMarkerElement
        const label = new this.drawingControl.AdvancedMarkerElement({
          map: this.labelsVisible ? this.drawingControl.map : null,
          position: offsetPosition,
          content: labelContent,
          collisionBehavior: 'REQUIRED_AND_HIDES_OPTIONAL'
        });

        // Stocker le label dans la Map
        this.circleLabels.set(circle.circleId, label);
      }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);

    } catch (error) {
      console.error('Erreur lors de la mise à jour du label de cercle:', error);
    }
  }

  /**
   * Gère la création d'un nouveau cercle
   * @param {google.maps.Circle} circle - Le cercle créé
   */
  handleCircleComplete(circle) {
    const circleId = this.generateCircleId();
    circle.circleId = circleId;
    this.drawnCircles.push(circle);
    this.usedCircleIds.add(circleId);
    
    // Configurer les écouteurs d'événements pour le cercle
    this.setupCircleListeners(circle);
    
    // Ajouter le label permanent
    this.updateCircleLabel(circle);
    // Déclencher l'événement de création de cercle
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CIRCLE_ADDED, {
      detail: { circleId }
    }));
    // Sélectionner le cercle
    this.setCircleSelection(circle);
    return circle;
  }

  /**
   * Configure les écouteurs d'événements pour un cercle
   * @param {google.maps.Circle} circle - Le cercle à configurer
   */
  setupCircleListeners(circle) {
    // Écouteur pour la sélection
    google.maps.event.addListener(circle, 'click', () => {
      this.setCircleSelection(circle);
      
      // Attendre que le label soit mis à jour
      setTimeout(() => {
        // Récupérer le label associé au cercle
        const label = this.circleLabels.get(circle.circleId);
        if (label) {
          // Trouver l'input dans le label
          const labelContent = label.content;
          if (labelContent) {
            const diameterInput = labelContent.querySelector('input');
            if (diameterInput) {
              // Mettre le focus sur l'input et sélectionner son contenu
              diameterInput.focus();
              diameterInput.select();
            }
          }
        }
      }, 100); // Court délai pour s'assurer que le label est prêt
    });

    // Écouteur pour le début du déplacement
    google.maps.event.addListener(circle, 'dragstart', () => {
      // Cacher temporairement le label pendant le déplacement
      const label = this.circleLabels.get(circle.circleId);
      if (label) {
        label.map = null;
      }
    });

    // Écouteur pour la fin du déplacement
    google.maps.event.addListener(circle, 'dragend', () => {
      this.updateCircleLabel(circle);
      this.saveCircleData(circle);
    });

    // Écouteur pour le changement de centre
    google.maps.event.addListener(circle, 'center_changed', () => {
      this.updateCircleLabel(circle);
      this.saveCircleData(circle);
    });

    // Écouteur pour le changement de rayon
    google.maps.event.addListener(circle, 'radius_changed', () => {
      this.updateCircleLabel(circle);
      this.saveCircleData(circle);
    });

    // Écouteur pour supprimer le cercle avec la touche Delete ou Backspace
    const handleCircleDeleteKeydown = (e) => {
      const offsetModalOpen = this.drawingControl?.offsetModal?.isOpen?.();
      if (offsetModalOpen && (e.key === 'Delete' || e.key === 'Backspace')) {
        return;
      }
      if(e.key === 'Delete' || e.key === 'Backspace') {
        if(this.selectedCircle) {
          e.preventDefault();
          this.deleteSelectedCircle();
        }
      }
    };
      // Ajouter l'écouteur pour le clic droit
      google.maps.event.addListener(circle, 'rightclick', () => {
        if(this.selectedCircle) {
          this.deleteSelectedCircle();
        }
      });

    
    document.addEventListener('keydown', handleCircleDeleteKeydown);

    // Stocker la référence à l'écouteur pour pouvoir le supprimer plus tard
    if (!circle._listeners) circle._listeners = [];
    circle._listeners.push({ type: 'keydown', listener: handleCircleDeleteKeydown });
  }

  /**
   * Génère un nouvel ID unique pour un cercle
   * @returns {string} ID unique pour le cercle
   */
  generateCircleId() {
    let counter = 1;
    let circleId;
    
    // Construction directe de l'ID avant vérification
    circleId = `${DRAWING_CONSTANTS.CIRCLE_ID_PREFIX}${counter}`;
    
    // Tant que l'ID existe déjà, incrémenter et réessayer
    while (this.usedCircleIds.has(circleId)) {
      counter++;
      circleId = `${DRAWING_CONSTANTS.CIRCLE_ID_PREFIX}${counter}`;
    }
    
    return circleId;
  }

  /**
   * Définit le cercle sélectionné
   * @param {google.maps.Circle} circle - Cercle à sélectionner
   */
  setCircleSelection(circle) {
    if (this.selectedCircle) {
      this.selectedCircle.setOptions(STYLES.DEFAULT_CIRCLE);
    }

    // Désélectionner les autres formes via le DrawingControl pour éviter les sélections multiples
    this.drawingControl.clearSelection();

    if (circle) {
      this.selectedCircle = circle;
      circle.setOptions(STYLES.SELECTED_CIRCLE);
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CIRCLE_SELECTED, {
        detail: { circleId: circle.circleId }
      }));
      const inputContainer = document.querySelector(`.input-container-${circle.circleId}`);
      if (inputContainer) {
        inputContainer.style.cssText = 'margin-top: 5px; display: flex; align-items: center; justify-content: center; width: fit-content; height: fit-content; opacity: 1;';
      }
    }
  }

  /**
   * Supprime le cercle sélectionné
   */
  deleteSelectedCircle() {
    if (this.selectedCircle) {
      const circleId = this.selectedCircle.circleId;
      // Supprimer le label avec vérification plus robuste
      const label = this.circleLabels.get(circleId);
      if (label) {
        try {
          label.map = null;
        } catch (error) {
          console.error("Erreur lors de la suppression du label:", error);
        }
        this.circleLabels.delete(circleId);
      }
      
      // Supprimer le cercle
      this.selectedCircle.setMap(null);
      this.drawnCircles = this.drawnCircles.filter(circle => circle !== this.selectedCircle);
      this.usedCircleIds.delete(circleId);
      this.selectedCircle = null;
      
      // Déclencher l'événement de suppression
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CIRCLE_REMOVED, {
        detail: { circleId }
      }));
      
      // Forcer une sauvegarde pour mettre à jour le localStorage immédiatement
      setTimeout(() => {
        if (window.storageManager) {
          window.storageManager.savePageData();
        }
      }, 50);
    }
  }

  /**
   * Sauvegarde les données d'un cercle avec debounce
   * @param {google.maps.Circle} circle - Cercle à sauvegarder
   */
  saveCircleData(circle) {
    if (circle._saveTimeout) {
      clearTimeout(circle._saveTimeout);
    }

    circle._saveTimeout = setTimeout(() => {
      // Déclencher la sauvegarde via le StorageManager
      window.storageManager.savePageData();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  /**
   * Collecte les données de tous les cercles
   * @returns {Object} Données des cercles
   */
  collectCirclesData() {
    try {
      const circlesData = {};
      
      this.drawnCircles.forEach(circle => {
        try {
          if (!circle || !circle.circleId) {
            console.warn('Cercle invalide détecté:', circle);
            return;
          }

          const center = circle.getCenter();
          const radius = circle.getRadius();

          circlesData[circle.circleId] = {
            center: {
              lat: center.lat(),
              lng: center.lng()
            },
            radius: radius
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du cercle ${circle?.circleId}:`, error);
        }
      });

      return circlesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des cercles:', error);
      return {};
    }
  }

  /**
   * Charge les cercles depuis les données sauvegardées
   * @param {Object} circlesData - Données des cercles à charger
   */
  loadCirclesFromData(circlesData) {
    try {
      if (!circlesData || typeof circlesData !== 'object') {
        console.warn('Données de cercles invalides:', circlesData);
        return;
      }

      // Vérifier qu'il y a des cercles à charger
      if (Object.keys(circlesData).length === 0) {
        return;
      }

      Object.entries(circlesData).forEach(([circleId, data]) => {
        try {
          if (!data.center || !data.radius) {
            console.warn(`Données invalides pour le cercle ${circleId}:`, data);
            return;
          }

          // Créer le cercle avec les options par défaut
          const circle = new google.maps.Circle({
            center: new google.maps.LatLng(data.center.lat, data.center.lng),
            radius: data.radius,
            ...STYLES.DEFAULT_CIRCLE,
            map: this.drawingControl.map
          });
          
          // Assigner l'ID et configurer les écouteurs
          circle.circleId = circleId;
          this.drawnCircles.push(circle);
          this.usedCircleIds.add(circleId);
          this.setupCircleListeners(circle);
          
          // Ajouter le label permanent
          this.updateCircleLabel(circle);

        } catch (error) {
          console.error(`Erreur lors du chargement du cercle ${circleId}:`, error);
        }
      });
    } catch (error) {
      console.error('Erreur lors du chargement des cercles:', error);
    }
  }

  /**
   * Supprime tous les cercles de la carte
   */
  clearAllCircles() {
    // Avant de supprimer les cercles, enregistrer leurs IDs
    const circleIds = this.drawnCircles.map(circle => circle.circleId);
    
    this.drawnCircles.forEach(circle => {
      circle.setMap(null);
      // Supprimer les labels associés
      const label = this.circleLabels.get(circle.circleId);
      if (label) {
        label.map = null;
      }
    });
    
    // Déclencher les événements de suppression pour chaque cercle
    circleIds.forEach(circleId => {
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CIRCLE_REMOVED, {
        detail: { circleId }
      }));
    });
    
    this.drawnCircles = [];
    this.usedCircleIds.clear();
    this.selectedCircle = null;
    this.circleLabels.clear();
  }

  setLabelsVisibility(show) {
    this.labelsVisible = show;
    this.circleLabels.forEach((label) => {
      if (label) {
        label.map = show ? this.drawingControl.map : null;
      }
    });
  }

  /**
   * Nettoie toutes les ressources lors de la suppression
   */
  onRemove() {
    // Nettoyer les labels de cercles
    this.circleLabels.forEach(label => {
      label.map = null;
    });
    this.circleLabels.clear();
    
    // Supprimer tous les cercles
    this.clearAllCircles();
  }
}

export default Circle;
