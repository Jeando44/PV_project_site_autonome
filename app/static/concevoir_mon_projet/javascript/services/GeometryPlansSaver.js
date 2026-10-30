/**
 * GeometryPlansSaver - Service pour sauvegarder les plans de géométrie
 * Capture les canvas des modals et les sauvegarde dans localStorage
 */

export default class GeometryPlansSaver {
  constructor() {
    this.canvasIds = {
      coupe: 'coupeCanvas',
      facade: 'facadeCanvas',
      implantation: 'implantationCanvas'
    };
    // Le calepinage utilise mapContainer (div Leaflet), pas un canvas
    this.mapContainerId = 'mapContainer';
  }

  /**
   * Capture un canvas et le convertit en image base64
   * Gère automatiquement le cas où le canvas est masqué
   */
  async captureCanvas(canvasId) {
    return new Promise(async (resolve) => {
      try {
        const canvas = document.getElementById(canvasId);

        if (!canvas) {
          console.warn(`⚠️ Canvas ${canvasId} non trouvé`);
          resolve(null);
          return;
        }

        // Trouver le conteneur parent qui peut être masqué
        const parentView = canvas.closest('[class*="tab-content"]');
        let wasHidden = false;
        let originalDisplay = null;

        // Si le conteneur parent est masqué, le rendre visible temporairement
        if (parentView && parentView.classList.contains('hidden')) {
          wasHidden = true;
          originalDisplay = parentView.style.display;
          parentView.classList.remove('hidden');
          parentView.style.display = 'block';
          console.log(`📸 ${canvasId} était masqué, rendu visible temporairement pour capture`);

          // Attendre un peu que le DOM se mette à jour
          await new Promise(r => setTimeout(r, 100));
        }

        // Réinitialiser le zoom/pan pour un cadrage optimal avant capture
        const resetBtnMap = {
          coupeCanvas: 'resetCoupe',
          facadeCanvas: 'resetFacade',
          implantationCanvas: 'resetImplantation'
        };
        const resetBtnId = resetBtnMap[canvasId];
        if (resetBtnId) {
          const resetBtn = document.getElementById(resetBtnId);
          if (resetBtn) {
            resetBtn.click();
            await new Promise(r => setTimeout(r, 150));
            console.log(`🔄 Vue ${canvasId} réinitialisée pour capture`);
          }
        }

        // Vérifier que le canvas n'est pas vide
        if (canvas.width === 0 || canvas.height === 0) {
          console.warn(`⚠️ Canvas ${canvasId} est vide (width ou height = 0)`);

          // Restaurer l'état de visibilité
          if (wasHidden && parentView) {
            parentView.classList.add('hidden');
            if (originalDisplay !== null) {
              parentView.style.display = originalDisplay;
            }
          }

          resolve(null);
          return;
        }

        // Convertir le canvas en image base64
        const imgData = canvas.toDataURL('image/png');

        // Vérifier que l'image est valide
        if (!imgData || imgData.length < 500) {
          console.warn(`⚠️ Image ${canvasId} invalide ou vide`);

          // Restaurer l'état de visibilité
          if (wasHidden && parentView) {
            parentView.classList.add('hidden');
            if (originalDisplay !== null) {
              parentView.style.display = originalDisplay;
            }
          }

          resolve(null);
          return;
        }

        console.log(`✅ Canvas ${canvasId} capturé avec succès (${(imgData.length / 1024).toFixed(0)}KB)`);

        // Restaurer l'état de visibilité d'origine
        if (wasHidden && parentView) {
          parentView.classList.add('hidden');
          if (originalDisplay !== null) {
            parentView.style.display = originalDisplay;
          }
          console.log(`✅ ${canvasId} restauré à son état masqué`);
        }

        resolve(imgData);
      } catch (error) {
        console.error(`❌ Erreur lors de la capture du canvas ${canvasId}:`, error);
        resolve(null);
      }
    });
  }

  /**
   * Capture le plan de calepinage depuis le conteneur Leaflet/Map
   * Gère automatiquement le cas où le conteneur est masqué
   */
  async captureMapContainer() {
    return new Promise(async (resolve) => {
      try {
        const mapContainer = document.getElementById(this.mapContainerId);

        if (!mapContainer) {
          console.warn('⚠️ mapContainer non trouvé - ce modal n\'a peut-être pas de plan de calepinage');
          resolve(null);
          return;
        }

        // Sauvegarder l'état de visibilité actuel
        const viewCalepinage = mapContainer.closest('#viewCalepinage');
        let wasHidden = false;
        let originalDisplay = null;

        // Si le conteneur parent est masqué, le rendre visible temporairement
        if (viewCalepinage && viewCalepinage.classList.contains('hidden')) {
          wasHidden = true;
          originalDisplay = viewCalepinage.style.display;
          viewCalepinage.classList.remove('hidden');
          viewCalepinage.style.display = 'block';
          console.log('📸 viewCalepinage était masqué, rendu visible temporairement pour capture');

          // Attendre un peu que le DOM se mette à jour et que la carte se rende
          await new Promise(r => setTimeout(r, 300));
        }

        // Utiliser html2canvas pour capturer le conteneur de la carte
        let imgData = null;
        if (typeof html2canvas !== 'undefined') {
          console.log('📸 Capture du mapContainer en cours...');
          const canvas = await html2canvas(mapContainer, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: 'white',
            logging: false,
            scale: 2 // Meilleure qualité
          });

          imgData = canvas.toDataURL('image/png');
          console.log(`✅ Map container capturé avec succès (${(imgData.length / 1024).toFixed(0)}KB)`);
        } else {
          console.warn('⚠️ html2canvas non disponible');
        }

        // Restaurer l'état de visibilité d'origine
        if (wasHidden && viewCalepinage) {
          viewCalepinage.classList.add('hidden');
          if (originalDisplay !== null) {
            viewCalepinage.style.display = originalDisplay;
          }
          console.log('✅ viewCalepinage restauré à son état masqué');
        }

        resolve(imgData);
      } catch (error) {
        console.error('❌ Erreur lors de la capture du map container:', error);
        resolve(null);
      }
    });
  }

  /**
   * Sauvegarde les plans dans localStorage pour le PV courant (lu depuis l'URL)
   * Si pvId non trouvé, sauvegarde en format global (fallback)
   */
  async savePlans() {
    console.log('🔄 Début de la sauvegarde des plans de géométrie...');

    // Lire le pvId depuis les paramètres URL de l'iframe courant
    const urlParams = new URLSearchParams(window.location.search);
    const currentPvId = urlParams.get('pvId') || null;

    // Capturer les plans du modal ouvert
    const coupeImg = await this.captureCanvas(this.canvasIds.coupe);
    const calepinageImg = await this.captureMapContainer();
    const facadeImg = await this.captureCanvas(this.canvasIds.facade);
    const implantationImg = await this.captureCanvas(this.canvasIds.implantation);

    console.log('📸 Plans capturés:', {
      pvId: currentPvId || 'global',
      coupe: coupeImg ? `${(coupeImg.length / 1024).toFixed(0)}KB` : 'non capturé',
      calepinage: calepinageImg ? `${(calepinageImg.length / 1024).toFixed(0)}KB` : 'non capturé',
      facade: facadeImg ? `${(facadeImg.length / 1024).toFixed(0)}KB` : 'non capturé',
      implantation: implantationImg ? `${(implantationImg.length / 1024).toFixed(0)}KB` : 'non capturé'
    });

    // Charger les données existantes pour ne pas écraser les autres PV
    let plansData = { savedAt: new Date().toISOString() };
    try {
      const existing = localStorage.getItem('geometriePlansData');
      if (existing) {
        const parsed = JSON.parse(existing);
        // Copier les données existantes (sans savedAt)
        Object.entries(parsed).forEach(([key, val]) => {
          if (key !== 'savedAt') plansData[key] = val;
        });
      }
    } catch (e) {
      console.warn('⚠️ Erreur lors du chargement des plans existants:', e);
    }

    if (currentPvId) {
      // Sauvegarder uniquement pour le PV courant
      plansData[currentPvId] = {
        coupe: coupeImg,
        calepinage: calepinageImg,
        facade: facadeImg,
        implantation: implantationImg
      };
      console.log(`✅ Plans sauvegardés pour ${currentPvId}`);
    } else {
      // Fallback : format global
      console.warn('⚠️ pvId non trouvé, sauvegarde en format global');
      plansData.coupe = coupeImg;
      plansData.calepinage = calepinageImg;
      plansData.facade = facadeImg;
      plansData.implantation = implantationImg;
    }

    // Sauvegarder dans localStorage
    try {
      localStorage.setItem('geometriePlansData', JSON.stringify(plansData));

      // Compter les plans capturés
      const capturedPlans = [
        coupeImg && 'Coupe',
        calepinageImg && 'Calepinage',
        facadeImg && 'Façade',
        implantationImg && 'Implantation'
      ].filter(Boolean);

      console.log(`✅ Plans sauvegardés dans localStorage pour ${currentPvId || 'global'}: ${capturedPlans.join(', ')}`);

      // Afficher un message de confirmation
      this.showSaveConfirmation(capturedPlans.length, currentPvId ? 1 : 1);

      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des plans:', error);
      this.showSaveError();
      return false;
    }
  }

  /**
   * Affiche un message de confirmation
   */
  showSaveConfirmation(plansCount = 0, pvCount = 1) {
    // Créer un toast de confirmation
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 15px 20px;
      border-radius: 5px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      z-index: 100000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    `;
    toast.innerHTML = `
      <strong>✅ Plans sauvegardés avec succès</strong><br>
      <small>${plansCount} plan(s) pour ${pvCount} PV</small>
    `;
    document.body.appendChild(toast);

    // Retirer le toast après 4 secondes
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  /**
   * Affiche un message d'erreur
   */
  showSaveError() {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #f44336;
      color: white;
      padding: 15px 20px;
      border-radius: 5px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      z-index: 100000;
      font-family: Arial, sans-serif;
      font-size: 14px;
    `;
    toast.textContent = '❌ Erreur lors de la sauvegarde des plans';
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  /**
   * Ajoute un bouton de sauvegarde au modal
   */
  addSaveButton(containerId = 'modal-footer') {
    // Chercher le conteneur où ajouter le bouton
    const container = document.getElementById(containerId);

    if (!container) {
      console.warn(`⚠️ Conteneur ${containerId} non trouvé pour ajouter le bouton de sauvegarde`);
      return;
    }

    // Créer le bouton
    const saveButton = document.createElement('button');
    saveButton.id = 'save-plans-btn';
    saveButton.className = 'btn btn-primary';
    saveButton.style.cssText = `
      background-color: #007bff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      margin-left: 10px;
    `;
    saveButton.innerHTML = '<i class="fa fa-save"></i> Sauvegarder les plans';

    // Ajouter l'événement de clic
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      saveButton.textContent = 'Sauvegarde en cours...';

      await this.savePlans();

      saveButton.disabled = false;
      saveButton.innerHTML = '<i class="fa fa-save"></i> Sauvegarder les plans';
    });

    container.appendChild(saveButton);
    console.log('✅ Bouton de sauvegarde ajouté au modal');
  }
}

// Créer une instance globale
if (typeof window !== 'undefined') {
  window.geometryPlansSaver = new GeometryPlansSaver();

  // Écouter les messages du parent (pour l'appel depuis ExportService)
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.action === 'savePlans') {
      console.log('📩 Message reçu: sauvegarde des plans demandée');
      await window.geometryPlansSaver.savePlans();
    }
  });
}

export { GeometryPlansSaver };
