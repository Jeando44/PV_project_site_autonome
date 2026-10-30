/**
 * Gestionnaire de modal pour les pages de géométrie et configuration
 * Affiche les pages de configuration dans un modal avec iframe
 */
class GeometrieModal {
  constructor() {
    const logger = window.logger || console;
    this.logger = logger;

    logger.info('🔧 Construction de GeometrieModal');

    // Valeurs par défaut pour la position et la taille
    this.defaultPosition = {
      width: '95vw',
      maxWidth: '1700px',
      height: '95vh',
      maxHeight: '95vh'
    };

    // Variables pour le drag and drop
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

    // Variables pour le resize
    this.isResizing = false;
    this.resizeDirection = null;
    this.resizeStart = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 };

    try {
      this.createModal();
      this.setupEventListeners();
      this.setupDragAndDrop();
      this.setupResize();
      logger.info('✅ GeometrieModal construit avec succès');
    } catch (error) {
      logger.error('❌ Erreur lors de la construction de GeometrieModal', error);
      throw error;
    }
  }

  createModal() {
    this.logger.start('Création du modal container');

    // Créer le conteneur du modal qui occupe tout l'écran (overlay)
    const modalContainer = document.createElement('div');
    modalContainer.id = 'geometrie-modal-container';
    modalContainer.className = 'geometrie-modal-container';
    modalContainer.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      overflow: auto;
      justify-content: center;
      align-items: center;
      padding: 2rem;
    `;

    this.logger.debug('Modal container créé', { id: modalContainer.id });

    // Créer un wrapper blanc pour le contenu (le vrai modal)
    const modalContent = document.createElement('div');
    modalContent.id = 'geometrie-modal-content';
    modalContent.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 95vw;
      max-width: 1700px;
      height: 95vh;
      max-height: 95vh;
      min-width: 600px;
      min-height: 480px;
      background-color: white;
      display: flex;
      flex-direction: column;
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
    `;

    // Créer un header avec bouton de fermeture
    const modalHeader = document.createElement('div');
    modalHeader.id = 'geometrie-modal-header';
    modalHeader.style.cssText = `
      background-color: #DC2626;
      color: white;
      padding: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      border-radius: 8px 8px 0 0;
      cursor: move;
      user-select: none;
    `;

    const modalTitle = document.createElement('h2');
    modalTitle.id = 'geometrie-modal-title';
    modalTitle.style.cssText = `
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      flex: 1;
    `;
    modalTitle.textContent = 'Configuration de Géométrie';

    // Conteneur pour les boutons
    const headerButtons = document.createElement('div');
    headerButtons.style.cssText = `
      display: flex;
      gap: 0.5rem;
      align-items: center;
    `;

    // Bouton de réinitialisation
    const resetButton = document.createElement('button');
    resetButton.id = 'geometrie-modal-reset';
    resetButton.innerHTML = '⟲';
    resetButton.title = 'Réinitialiser la position et la taille';
    resetButton.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: background-color 0.2s;
    `;
    resetButton.onmouseover = () => resetButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    resetButton.onmouseout = () => resetButton.style.backgroundColor = 'transparent';

    // Bouton de fermeture
    const closeButton = document.createElement('button');
    closeButton.id = 'geometrie-modal-close';
    closeButton.innerHTML = '✕';
    closeButton.title = 'Fermer';
    closeButton.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: background-color 0.2s;
    `;
    closeButton.onmouseover = () => closeButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    closeButton.onmouseout = () => closeButton.style.backgroundColor = 'transparent';

    headerButtons.appendChild(resetButton);
    headerButtons.appendChild(closeButton);

    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(headerButtons);

    this.logger.debug('Header créé avec boutons reset et fermeture');

    // Créer l'iframe qui occupe tout l'espace restant
    const iframe = document.createElement('iframe');
    iframe.id = 'geometrie-modal-iframe';
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      flex: 1;
    `;

    this.logger.debug('Iframe créé', { id: iframe.id });

    // Créer les poignées de redimensionnement
    const resizeHandles = this.createResizeHandles();
    this.logger.debug('Poignées de redimensionnement créées');

    // Assembler les éléments
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(iframe);

    // Ajouter les poignées de resize
    resizeHandles.forEach(handle => modalContent.appendChild(handle));

    modalContainer.appendChild(modalContent);

    // Ajouter au body
    if (document.body) {
      document.body.appendChild(modalContainer);
      this.logger.info('✅ Modal container ajouté au DOM', {
        parentElement: 'body',
        modalId: modalContainer.id
      });
    } else {
      this.logger.error('❌ document.body introuvable!');
      throw new Error('document.body is null');
    }

    // Stocker les références
    this.modalContainer = modalContainer;
    this.modalContent = modalContent;
    this.modalHeader = modalHeader;
    this.modalTitle = modalTitle;
    this.closeButton = closeButton;
    this.resetButton = resetButton;
    this.iframe = iframe;
    this.resizeHandles = resizeHandles;

    // Vérifier que l'élément est bien dans le DOM
    const elementInDOM = document.getElementById('geometrie-modal-container');
    if (elementInDOM) {
      this.logger.info('✅ Vérification: Modal container trouvé dans le DOM');
    } else {
      this.logger.error('❌ Vérification: Modal container NOT trouvé dans le DOM!');
    }

    this.logger.end('Création du modal container');
  }

  createResizeHandles() {
    const handles = [];
    const directions = [
      { name: 'n', cursor: 'ns-resize', position: 'top: 0; left: 0; right: 0; height: 8px;' },
      { name: 's', cursor: 'ns-resize', position: 'bottom: 0; left: 0; right: 0; height: 8px;' },
      { name: 'e', cursor: 'ew-resize', position: 'top: 0; right: 0; bottom: 0; width: 8px;' },
      { name: 'w', cursor: 'ew-resize', position: 'top: 0; left: 0; bottom: 0; width: 8px;' },
      { name: 'ne', cursor: 'nesw-resize', position: 'top: 0; right: 0; width: 16px; height: 16px;' },
      { name: 'nw', cursor: 'nwse-resize', position: 'top: 0; left: 0; width: 16px; height: 16px;' },
      { name: 'se', cursor: 'nwse-resize', position: 'bottom: 0; right: 0; width: 16px; height: 16px;' },
      { name: 'sw', cursor: 'nesw-resize', position: 'bottom: 0; left: 0; width: 16px; height: 16px;' }
    ];

    directions.forEach(dir => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir.name}`;
      handle.dataset.direction = dir.name;
      handle.style.cssText = `
        position: absolute;
        ${dir.position}
        cursor: ${dir.cursor};
        z-index: 10;
      `;
      handles.push(handle);
    });

    return handles;
  }

  setupEventListeners() {
    this.logger.start('Configuration des event listeners');

    // Événement de clic sur le bouton de fermeture
    if (this.closeButton) {
      this.closeButton.addEventListener('click', () => {
        this.logger.event('click', this.closeButton, 'Fermeture du modal');
        this.close();
      });
      this.logger.debug('✓ Event listener ajouté: bouton fermeture');
    }

    // Événement de clic sur le bouton de réinitialisation
    if (this.resetButton) {
      this.resetButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Empêcher le drag
        this.logger.event('click', this.resetButton, 'Réinitialisation de la position');
        this.resetPosition();
      });
      this.logger.debug('✓ Event listener ajouté: bouton reset');
    }

    // Fermer avec la touche Échap
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalContainer.style.display === 'block') {
        this.logger.event('keydown', null, 'Touche Échap pressée');
        this.close();
      }
    });
    this.logger.debug('✓ Event listener ajouté: touche Échap');

    // Fermer en cliquant sur l'overlay (en dehors du contenu)
    this.modalContainer.addEventListener('click', (e) => {
      if (e.target === this.modalContainer) {
        this.logger.event('click', this.modalContainer, 'Clic sur overlay');
        this.close();
      }
    });
    this.logger.debug('✓ Event listener ajouté: clic overlay');

    // Écouter les messages de l'iframe pour fermer le modal et synchroniser les champs
    window.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'closeModal') {
        this.logger.message('received', 'closeModal', event.data);
        this.close();
      }

      // Synchronisation des champs depuis le modal vers la page calepinage
      if (event.data && event.data.action === 'updateCalepinageField') {
        const { fieldName, value, pvId } = event.data;
        this.logger.message('received', 'updateCalepinageField', { fieldName, value, pvId });

        // Chercher le champ avec le suffixe pvId d'abord, puis sans suffixe
        const fieldWithPv = pvId ? document.getElementById(`${fieldName}-${pvId}`) : null;
        const field = fieldWithPv || document.getElementById(fieldName);
        if (field) {
          let isDifferent = false;

          // 1. Cas des Checkboxes et Radios
          if (field.type === 'checkbox' || field.type === 'radio') {
            const isChecked = (value === true || value === 'true' || value === 'on' || value === 1);
            if (field.checked !== isChecked) {
              field.checked = isChecked;
              isDifferent = true;
            }
          } 
          // 2. Cas des Inputs standards (Nombres et Textes)
          else {
            const isNum = !isNaN(field.value) && !isNaN(value) && field.value !== '' && value !== '' && value !== null;
            if (isNum) {
              if (Number(field.value) !== Number(value)) {
                field.value = value;
                isDifferent = true;
              }
            } else if (String(field.value) !== String(value)) {
              field.value = value;
              isDifferent = true;
            }
          }

          // IMPORTANT : On bloque la mise à jour si la valeur mathématique ou booléenne est équivalente
          if (isDifferent) {
            this.logger.debug(`Champ ${field.id} mis à jour`, { value });

            // Déclencher un événement change pour mettre à jour les calculs
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          this.logger.warn(`Champ ${fieldName} non trouvé dans la page`);
        }
      }
    });
    this.logger.debug('✓ Event listener ajouté: messages postMessage');

    this.logger.end('Configuration des event listeners');
  }

  /**
   * Ouvre le modal avec une page spécifique
   * @param {string} url - URL de la page à afficher
   * @param {string} title - Titre du modal
   * @param {string|null} pvId - Identifiant du PV courant (ex: 'PV1')
   */
  open(url, title = 'Configuration de Géométrie', pvId = null) {
    this.logger.start('Ouverture du modal');
    this.logger.info('URL à charger', { url, title, pvId });

    try {
      // Vérifier que les éléments existent
      if (!this.modalContainer) {
        this.logger.error('❌ modalContainer est null!');
        throw new Error('modalContainer is null');
      }

      if (!this.iframe) {
        this.logger.error('❌ iframe est null!');
        throw new Error('iframe is null');
      }

      // Mettre à jour le titre
      if (this.modalTitle) {
        this.modalTitle.textContent = title;
        this.logger.debug('Titre mis à jour', { title });
      }

      // Construire l'URL avec pvId en paramètre si disponible
      const iframeUrl = pvId ? `${url}?pvId=${encodeURIComponent(pvId)}` : url;

      // Une ouverture précédente fermée autrement que par close() laisserait son écouteur de
      // réinjection derrière elle.
      if (typeof this._arreterReinjection === 'function') this._arreterReinjection();

      // Charger l'URL dans l'iframe
      this.logger.info('Chargement de l\'URL dans l\'iframe', { iframeUrl });
      this.iframe.src = iframeUrl;

      // ETAPES 2 et 3 de l'unification du calepinage : la configuration de la structure n'est plus
      // saisie a la main ici (ni calculee par FormHandler.js / le configurateur en iframe), elle est
      // deduite de la GRILLE DE PANNEAUX reellement posee sur le champ PV dessine - cf.
      // Calepinage_mainson/calepinage_maison_dimensions_ombriere.js (rectangle -> ombriere) et
      // calepinage_maison_dimensions_petit_champ.js (polygone libre -> petit champ solaire / sheds).
      //
      // AIGUILLAGE (indispensable) : les deux modales partagent des ids (#roofSlope, #pvLayout,
      // #facadeLength, #panelWidth...) avec des SEMANTIQUES differentes - le petit champ solaire
      // recalcule lui-meme sa longueur de facade et sa largeur de champ PV a partir du calepinage
      // LxC. On choisit donc le service selon l'URL du modal ouvert, jamais les deux.
      //
      // L'injection a lieu apres le chargement de l'iframe (meme origine), une seule fois par
      // ouverture, et reste sans effet si aucun champ n'est dessine ou si le modal ne porte pas ces
      // champs : dans les deux cas l'utilisateur retrouve la saisie manuelle d'avant.
      const estPetitChamp = String(url).indexOf('petit_champ') !== -1;
      this.iframe.addEventListener('load', () => {
        const service = estPetitChamp
          ? window.CalepinageMaisonDimensionsPetitChamp
          : window.CalepinageMaisonDimensionsOmbriere;
        if (!service) return;
        let documentIframe = null;
        try {
          documentIframe = this.iframe.contentDocument;
        } catch (erreur) {
          return; // origine differente : rien a injecter, on laisse le modal tel quel
        }
        if (!documentIframe) return;
        // CORRECTIF (bug rapporté : "les dimensions du champ PV ne sont pas envoyées dans les
        // modales géométries ombrières bois, métal, solumbra ; les dimensions des ombrières ne
        // correspondent pas à celles du champ PV sur la carte/canevas").
        //
        // Deux passes. Le configurateur en iframe initialise une partie de ses champs APRÈS son
        // propre 'load' (restauration depuis localStorage, valeurs par défaut posées par ses
        // scripts, listes remplies en différé). Une injection unique au 'load' pouvait donc être
        // écrasée aussitôt, et l'utilisateur voyait des dimensions sans rapport avec son champ PV.
        // La seconde passe repasse après ce démarrage ; elle est idempotente (mêmes valeurs
        // réécrites, cf. injecterDansModal) et sans effet si le modal a été refermé entre-temps.
        const injecter = (passe) => {
          if (!this.iframe || this.iframe.contentDocument !== documentIframe) return; // modal refermé
          try {
            // Petit champ : modèle de poteaux / variante / hauteur bas PV AVANT les dimensions (le
            // clic sur un modèle réinitialise des champs que l'injection ci-dessous réécrit), et
            // retour des choix faits dans le configurateur vers l'état du champ (bidirectionnel).
            if (estPetitChamp && typeof service.injecterStructureDansModal === 'function') {
              service.injecterStructureDansModal({ racine: documentIframe, sourceId: pvId || undefined });
              service.brancherRetourStructure({ racine: documentIframe, sourceId: pvId || undefined });
            }
            // Ombrière : retour des champs COMMUNS saisis dans la modale (hauteur à l'égout,
            // entraxes de poteaux) vers l'état du champ PV, donc vers le formulaire PRO. Sans lui,
            // la synchronisation était à sens unique et la saisie faite ici était perdue à la
            // réinjection suivante. Idempotent : il ne se branche qu'une fois par document.
            if (!estPetitChamp && typeof service.brancherRetourOmbriere === 'function') {
              service.brancherRetourOmbriere({ racine: documentIframe, sourceId: pvId || undefined });
            }
            // Ombrière : modèle de poteaux + réglages propres à la modale (porte-à-faux, renfort,
            // entraxe, inclinaison, altimétrie) mémorisés dans l'état du champ PV, donc persistés en
            // base — AVANT les dimensions : le clic sur un modèle réinitialise des champs.
            // Sur un recalcul du calepinage, seul le modèle est accordé (pas de réécriture d'une
            // saisie en cours dans la modale).
            if (!estPetitChamp && typeof service.imposerReglagesModale === 'function') {
              service.imposerReglagesModale({ racine: documentIframe, sourceId: pvId || undefined, complet: passe !== 'recalcul' });
            }
            const ecrits = service.injecterDansModal(null, {
              racine: documentIframe,
              sourceId: pvId || undefined,
            });
            this.logger.info('Configuration injectee depuis le calepinage', {
              structure: estPetitChamp ? 'petit champ solaire' : 'ombriere',
              champs: ecrits, passe, sourceId: pvId || '(champ affiche)',
            });
            if (!ecrits.length && passe === 1) {
              // Diagnostic explicite : sans champ PV correspondant, l'utilisateur retrouve la saisie
              // manuelle et ne comprend pas pourquoi. Le cas normal est un pvId sans calepinage.
              this.logger.warn('Aucune dimension injectee : aucun champ PV du calepinage ne porte cet identifiant', { pvId });
            }
          } catch (erreur) {
            this.logger.warn('Injection des dimensions de calepinage impossible', erreur);
          }
        };
        injecter(1);
        setTimeout(() => injecter(2), 400);

        // NOUVEAU (demande explicite : « assurez-vous que les données soient actualisées pour les
        // ombrières en passant d'un type de calepinage incliné à shed ») : jusqu'ici l'injection
        // n'avait lieu QU'À l'ouverture. Changer le calepinage pendant que la modale est ouverte
        // (type de pose, nombre de panneaux, pente, entraxes, hauteur à l'égout…) la laissait
        // afficher et dessiner la configuration précédente.
        //
        // `calepinageMaisonEtatRecalcule` est émis par CM.recomputeResults(), c.-à-d. après CHAQUE
        // action du calepinage. La réinjection est groupée (250 ms) et n'écrit que les champs dont
        // la valeur a réellement changé (cf. injecterDansModal) : une modale déjà à jour ne reçoit
        // aucun événement, donc aucun redessin inutile ni boucle avec le retour bidirectionnel du
        // petit champ solaire.
        let reinjection = null;
        const surRecalcul = () => {
          clearTimeout(reinjection);
          reinjection = setTimeout(() => {
            if (!this.iframe || this.iframe.contentDocument !== documentIframe) return; // modale refermée
            injecter('recalcul');
          }, 250);
        };
        // Émis sur `document` sans `bubbles` (cf. calepinage_maison_orchestrateur.js) : un
        // écouteur posé sur `window` ne le recevrait jamais.
        document.addEventListener('calepinageMaisonEtatRecalcule', surRecalcul);
        // Débranché à la fermeture : on ne laisse pas un écouteur orphelin derrière chaque ouverture.
        this._arreterReinjection = () => {
          clearTimeout(reinjection);
          document.removeEventListener('calepinageMaisonEtatRecalcule', surRecalcul);
          this._arreterReinjection = null;
        };
      }, { once: true });

      // Afficher le modal (flex pour centrage)
      this.logger.info('Affichage du modal container');
      this.modalContainer.style.display = 'flex';

      // Bloquer le scroll de la page
      document.body.style.overflow = 'hidden';

      // Vérifier l'état après affichage
      const computedStyle = window.getComputedStyle(this.modalContainer);
      this.logger.info('État du modal après affichage', {
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        zIndex: computedStyle.zIndex,
        position: computedStyle.position
      });

      // Vérifier que le modal est bien visible
      const rect = this.modalContainer.getBoundingClientRect();
      this.logger.info('Position du modal', {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });

      // Sauvegarder l'état pour persistance au refresh
      sessionStorage.setItem('openModalState', JSON.stringify({
        type: 'geometrie',
        url: url,
        title: title
      }));

      this.logger.end('Ouverture du modal');
      this.logger.info('✅ Modal ouvert avec succès!');
    } catch (error) {
      this.logger.fail('Ouverture du modal', error);
      throw error;
    }
  }

  /**
   * Ferme le modal
   */
  close() {
    this.logger.start('Fermeture du modal');

    try {
      if (this.modalContainer) {
        this.modalContainer.style.display = 'none';
        this.logger.debug('Modal container masqué');
      }

      if (this.iframe) {
        this.iframe.src = '';
        this.logger.debug('Iframe src vidé');
      }

      // Arrête la réinjection des dimensions du calepinage (cf. open()).
      if (typeof this._arreterReinjection === 'function') this._arreterReinjection();

      document.body.style.overflow = '';
      this.logger.debug('Scroll de la page restauré');

      // Supprimer l'état de persistance
      sessionStorage.removeItem('openModalState');

      this.logger.end('Fermeture du modal');
      this.logger.info('✅ Modal fermé avec succès');
    } catch (error) {
      this.logger.fail('Fermeture du modal', error);
    }
  }

  /**
   * Configure le drag and drop du modal
   */
  setupDragAndDrop() {
    this.logger.start('Configuration du drag and drop');

    if (!this.modalHeader || !this.modalContent) {
      this.logger.warn('Éléments manquants pour le drag and drop');
      return;
    }

    this.modalHeader.addEventListener('mousedown', (e) => {
      // Ne pas activer le drag si on clique sur un bouton
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }

      this.isDragging = true;
      const rect = this.modalContent.getBoundingClientRect();

      this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      // Retirer transform pour utiliser top/left
      this.modalContent.style.transform = 'none';
      this.modalContent.style.top = rect.top + 'px';
      this.modalContent.style.left = rect.left + 'px';

      this.logger.debug('Drag démarré', this.dragOffset);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;

      const newLeft = e.clientX - this.dragOffset.x;
      const newTop = e.clientY - this.dragOffset.y;

      this.modalContent.style.left = newLeft + 'px';
      this.modalContent.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.logger.debug('Drag terminé');
      }
    });

    this.logger.debug('✓ Drag and drop configuré');
    this.logger.end('Configuration du drag and drop');
  }

  /**
   * Configure le redimensionnement du modal
   */
  setupResize() {
    this.logger.start('Configuration du redimensionnement');

    if (!this.resizeHandles || !this.modalContent) {
      this.logger.warn('Éléments manquants pour le resize');
      return;
    }

    this.resizeHandles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();

        this.isResizing = true;
        this.resizeDirection = handle.dataset.direction;

        const rect = this.modalContent.getBoundingClientRect();
        this.resizeStart = {
          x: e.clientX,
          y: e.clientY,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left
        };

        // Retirer transform pour utiliser top/left/width/height
        if (this.modalContent.style.transform !== 'none') {
          this.modalContent.style.transform = 'none';
          this.modalContent.style.top = rect.top + 'px';
          this.modalContent.style.left = rect.left + 'px';
          this.modalContent.style.width = rect.width + 'px';
          this.modalContent.style.height = rect.height + 'px';
        }

        this.logger.debug('Resize démarré', { direction: this.resizeDirection });
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isResizing) return;

      const deltaX = e.clientX - this.resizeStart.x;
      const deltaY = e.clientY - this.resizeStart.y;

      let newWidth = this.resizeStart.width;
      let newHeight = this.resizeStart.height;
      let newTop = this.resizeStart.top;
      let newLeft = this.resizeStart.left;

      // Calculer les nouvelles dimensions selon la direction
      if (this.resizeDirection.includes('e')) {
        newWidth = Math.max(400, this.resizeStart.width + deltaX);
      }
      if (this.resizeDirection.includes('w')) {
        newWidth = Math.max(400, this.resizeStart.width - deltaX);
        newLeft = this.resizeStart.left + (this.resizeStart.width - newWidth);
      }
      if (this.resizeDirection.includes('s')) {
        newHeight = Math.max(300, this.resizeStart.height + deltaY);
      }
      if (this.resizeDirection.includes('n')) {
        newHeight = Math.max(300, this.resizeStart.height - deltaY);
        newTop = this.resizeStart.top + (this.resizeStart.height - newHeight);
      }

      this.modalContent.style.width = newWidth + 'px';
      this.modalContent.style.height = newHeight + 'px';
      this.modalContent.style.top = newTop + 'px';
      this.modalContent.style.left = newLeft + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.isResizing = false;
        this.logger.debug('Resize terminé');
      }
    });

    this.logger.debug('✓ Redimensionnement configuré');
    this.logger.end('Configuration du redimensionnement');
  }

  /**
   * Réinitialise la position et la taille du modal
   */
  resetPosition() {
    this.logger.start('Réinitialisation de la position');

    if (!this.modalContent) {
      this.logger.warn('modalContent introuvable');
      return;
    }

    // Réappliquer les valeurs par défaut
    this.modalContent.style.width = this.defaultPosition.width;
    this.modalContent.style.maxWidth = this.defaultPosition.maxWidth;
    this.modalContent.style.height = this.defaultPosition.height;
    this.modalContent.style.maxHeight = this.defaultPosition.maxHeight;
    this.modalContent.style.top = '50%';
    this.modalContent.style.left = '50%';
    this.modalContent.style.transform = 'translate(-50%, -50%)';

    this.logger.info('✅ Position et taille réinitialisées');
    this.logger.end('Réinitialisation de la position');
  }
}

// Mapping des types de structure vers les fichiers modals
const STRUCTURE_MODAL_MAPPING = {
  'Ombrière métal': {
    // url: '/concevoir_mon_projet/modal/ombriere_metal',
    url: '/concevoir_mon_projet/geometrie/ombriere',
    title: 'Configuration Ombrière Métal',
    available: true // Maintenant disponible
  },
  'Ombrière bois': {
    url: '/concevoir_mon_projet/modal/ombriere_bois',
    title: 'Configuration Ombrière Bois',
    available: true // Maintenant disponible
  },
  'Ombrière béton': {
    url: '/concevoir_mon_projet/modal/batiment_metal',
    title: 'Configuration Ombrière Béton',
    available: false
  },

  // 'Bâtiment incliné métal': {        
  //   url: '/concevoir_mon_projet/modal/batiment_metal',
  //   title: 'Configuration Bâtiment Incliné Métal',
  //   available: true // Déjà implémenté
  // },

  'Ombrière solumbra': {
      url: '/concevoir_mon_projet/geometrie/ombriere_solumbra',
      title: 'Configuration Ombrière Solumbra',
      available: true
  },

  'Bâtiment incliné métal': {
      url: '/concevoir_mon_projet/geometrie/batiment_metal',
      title: 'Configuration bâtiment métal',
      available: true
  },

  'bâtiment incliné bois': {
    url: '/concevoir_mon_projet/modal/ombriere_metal',
    title: 'Configuration Bâtiment Incliné Bois',
    available: false
  },
  'Petit champ solaire': {
    url: '/concevoir_mon_projet/geometrie/petit_champ_',
    title: 'Configuration Petit Champ Solaire',
    available: true
  },
  // CORRECTIF (demande explicite : liste des types de structure alignée sur le formulaire
  // résidentiel) : "Toiture résidentielle" et "Toiture terrasse" sont des types de TOITURE, pas des
  // structures à configurer — aucun configurateur de géométrie à ouvrir. `sansModal` les distingue
  // d'un type non pris en charge ("Ombrière béton", `available: false`), qui affiche lui le modal
  // "fonctionnalité non disponible". Avant cette demande, les deux étaient `hidden disabled` dans
  // le formulaire, donc jamais sélectionnables.
  'Toiture résidentielle': { sansModal: true },
  'Toiture terasse': { sansModal: true },
  'Autres': {
    url: '/concevoir_mon_projet/modal/batiment_metal',
    title: 'Configuration Personnalisée',
    available: false
  }
};

// Initialiser le modal de fonctionnalités non disponibles
let featureUnavailableModal = null;

// Fonction pour initialiser le modal de fonctionnalités non disponibles
function initFeatureUnavailableModal() {
  if (!featureUnavailableModal) {
    // Créer le modal de fonctionnalités non disponibles
    const FeatureUnavailableModal = class {
      constructor() {
        this.createModal();
      }

      createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'feature-unavailable-overlay';
        overlay.style.cssText = `
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.6);
          z-index: 10000;
          backdrop-filter: blur(2px);
        `;

        const modal = document.createElement('div');
        modal.className = 'feature-unavailable-modal';
        modal.style.cssText = `
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background-color: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
          z-index: 10001;
          min-width: 400px;
          max-width: 500px;
          text-align: center;
        `;

        const icon = document.createElement('div');
        icon.innerHTML = `
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" style="margin: 0 auto 20px;">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#FFA500" opacity="0.3"/>
            <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="#FFA500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="2" fill="#FFA500"/>
          </svg>
        `;

        const title = document.createElement('h3');
        title.textContent = 'Fonctionnalité en cours de développement';
        title.style.cssText = `
          color: #FF8C00;
          margin: 0 0 15px 0;
          font-size: 22px;
          font-weight: 600;
        `;

        const message = document.createElement('p');
        message.id = 'feature-unavailable-message';
        message.style.cssText = `
          margin-bottom: 25px;
          line-height: 1.6;
          color: #555;
          font-size: 15px;
        `;

        const note = document.createElement('p');
        note.textContent = 'Cette fonctionnalité sera bientôt disponible.';
        note.style.cssText = `
          margin-bottom: 25px;
          font-size: 13px;
          color: #888;
          font-style: italic;
        `;

        const button = document.createElement('button');
        button.textContent = 'Compris';
        button.style.cssText = `
          background: linear-gradient(135deg, #FFA500 0%, #FF8C00 100%);
          color: white;
          border: none;
          padding: 12px 30px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 15px;
          font-weight: 500;
          transition: all 0.3s;
          box-shadow: 0 4px 12px rgba(255, 140, 0, 0.3);
        `;

        button.addEventListener('mouseenter', () => {
          button.style.transform = 'translateY(-2px)';
          button.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.4)';
        });

        button.addEventListener('mouseleave', () => {
          button.style.transform = 'translateY(0)';
          button.style.boxShadow = '0 4px 12px rgba(255, 140, 0, 0.3)';
        });

        button.onclick = () => this.hide();

        modal.appendChild(icon);
        modal.appendChild(title);
        modal.appendChild(message);
        modal.appendChild(note);
        modal.appendChild(button);

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        overlay.onclick = () => this.hide();

        this.modal = modal;
        this.overlay = overlay;
        this.message = message;
      }

      show(featureName = 'Cette fonctionnalité') {
        this.message.textContent = `${featureName} est actuellement en cours d'implémentation par notre équipe de développement.`;
        this.overlay.style.display = 'block';
        this.modal.style.display = 'block';
      }

      hide() {
        this.overlay.style.display = 'none';
        this.modal.style.display = 'none';
      }
    };

    featureUnavailableModal = new FeatureUnavailableModal();
  }
  return featureUnavailableModal;
}

// Initialisation
let geometrieModal;
let modalLogger;

// Initialiser le logger pour ce module
if (window.logger) {
    modalLogger = new window.GeometrieLogger('GeometrieModalManager');
} else {
    modalLogger = {
        info: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.log.bind(console)
    };
}

// Initialiser le modal dès que le DOM est prêt
modalLogger.info('📦 Script geometrieModal.js chargé');
modalLogger.info('État du DOM', { readyState: document.readyState });

function initializeModal() {
    modalLogger.info('🚀 Initialisation du modal');
    modalLogger.info('document.body disponible?', { available: !!document.body });

    if (!document.body) {
        modalLogger.error('❌ document.body non disponible - attente de DOMContentLoaded');
        return;
    }

    try {
        geometrieModal = new GeometrieModal();
        modalLogger.info('✅ geometrieModal créé avec succès', geometrieModal);

        // Vérifier que le modal est bien dans le DOM
        const modalInDOM = document.getElementById('geometrie-modal-container');
        if (modalInDOM) {
            modalLogger.info('✅ Vérification finale: Modal trouvé dans le DOM', {
                id: modalInDOM.id,
                parentElement: modalInDOM.parentElement?.tagName
            });
        } else {
            modalLogger.error('❌ Vérification finale: Modal NOT trouvé dans le DOM!');
        }
    } catch (error) {
        modalLogger.error('❌ Erreur lors de la création de geometrieModal', error);
    }
}

// Initialiser immédiatement si le DOM est déjà chargé, sinon attendre
if (document.readyState === 'loading') {
    modalLogger.info('⏳ DOM en cours de chargement - attente de DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', () => {
        modalLogger.info('✅ DOMContentLoaded déclenché');
        initializeModal();
    });
} else {
    modalLogger.info('✅ DOM déjà chargé - initialisation immédiate');
    initializeModal();
}

// 1. Event listener sur le select type_de_structure
// Utilisation de l'event delegation - attaché immédiatement
document.addEventListener('change', function(e) {
  // Vérifier si c'est un select type_de_structure (peut avoir un ID dynamique comme type_de_structure-PV1)
  // On vérifie si l'ID ou le NAME commence par 'type_de_structure'
  const isTypeStructureSelect = e.target && (
    (e.target.id && e.target.id.startsWith('type_de_structure')) ||
    (e.target.name && e.target.name.startsWith('type_de_structure'))
  );

  if (isTypeStructureSelect) {
    // CORRECTIF (bug rapporté : "il arrive qu'on clique sur les dimensions ou sur le bouton et le
    // modal de calepinage multi-typologie ne s'ouvre pas") : le miroir des deux formulaires
    // (calepinage_maison_form_pro.js) reporte dans ce <select> le type de structure choisi côté
    // résidentiel, et doit pour cela émettre un 'change' — sans quoi les cascades du formulaire PRO
    // (toggleStructureFields, modèles, couverture...) ne suivraient pas. Ce 'change'-là est une
    // SYNCHRONISATION, pas un choix de l'utilisateur : ouvrir le configurateur de géométrie
    // par-dessus était un effet de bord, qui recouvrait notamment le modal de calepinage en cours
    // d'ouverture. L'émetteur le signale par ce drapeau ; tout le reste du traitement est inchangé.
    if (e.detail && e.detail.origine === 'synchronisation-calepinage') {
      modalLogger.debug('↔️ Changement de type de structure issu de la synchronisation des formulaires : aucun configurateur ouvert');
      return;
    }
    const selectedValue = e.target.value;
    modalLogger.info('🔄 Type de structure sélectionné', { type: selectedValue, elementId: e.target.id });

    const modalConfig = STRUCTURE_MODAL_MAPPING[selectedValue];

    if (!modalConfig) {
      modalLogger.warn('⚠️ Aucune configuration trouvée pour le type', { type: selectedValue });
      return;
    }

    // Type de TOITURE (pas de structure à configurer) : on n'ouvre rien, pas même le modal
    // "fonctionnalité non disponible" — cf. STRUCTURE_MODAL_MAPPING.
    if (modalConfig.sansModal) {
      modalLogger.info('ℹ️ Type de toiture : aucun configurateur de géométrie à ouvrir', { type: selectedValue });
      return;
    }

    // Vérifier si la fonctionnalité est disponible
    if (modalConfig.available === false) {
      modalLogger.info('⚠️ Fonctionnalité non disponible - affichage du modal d\'information');
      const unavailableModal = initFeatureUnavailableModal();
      unavailableModal.show(modalConfig.title);
      return;
    }

    if (!geometrieModal) {
      modalLogger.error('❌ geometrieModal non initialisé');
      return;
    }

    // Récupérer le pvId depuis le tab-content parent (id="form-PVx")
    const pvTabContent = e.target.closest('.tab-content');
    const pvIdForModal = pvTabContent?.id?.startsWith('form-') ? pvTabContent.id.replace('form-', '') : null;

    modalLogger.info('➡️ Ouverture du modal', { ...modalConfig, pvId: pvIdForModal });
    try {
      geometrieModal.open(modalConfig.url, modalConfig.title, pvIdForModal);
    } catch (error) {
      modalLogger.error('Erreur lors de l\'ouverture du modal', error);
    }
  }
});

// 2. Event listener sur le bouton de configuration de géométrie dans calepinage.html
// Utilisation de l'event delegation - attaché immédiatement
document.addEventListener('click', function(e) {
  // Vérifier si le clic est sur le bouton ou un de ses enfants
  // Le bouton a un ID qui commence par 'btn-open-geometrie-modal' (avec suffixe dynamique comme -PV1, -PV2, etc.)
  const button = e.target.closest('[id^="btn-open-geometrie-modal"]');

  if (button) {
    modalLogger.info('🖱️ Clic sur bouton géométrie', { buttonId: button.id });
    e.preventDefault();
    e.stopPropagation();

    if (!geometrieModal) {
      modalLogger.error('❌ geometrieModal non défini - impossible d\'ouvrir le modal');
      return;
    }

    // Récupérer le type de structure sélectionné depuis l'onglet parent du bouton
    // Chaque onglet PV a son propre select type_de_structure avec un ID dynamique (type_de_structure-PV1, etc.)
    const parentTab = button.closest('.tab-content');
    let typeStructureSelect = null;

    if (parentTab) {
      // Chercher un select dont l'ID ou le NAME commence par 'type_de_structure'
      typeStructureSelect = parentTab.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si le select n'est pas trouvé dans l'onglet parent, chercher dans l'onglet actif
    if (!typeStructureSelect) {
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        typeStructureSelect = activeTab.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
      }
    }

    // Si toujours pas trouvé, chercher directement dans le document (pour calepinage.html par exemple)
    if (!typeStructureSelect) {
      typeStructureSelect = document.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si le select n'existe toujours pas, afficher un message
    if (!typeStructureSelect) {
      modalLogger.warn('⚠️ Aucun select type_de_structure trouvé - Aucune forme dessinée');
      alert('Il faut dessiner une forme sur la carte avant de configurer la géométrie.');
      return;
    }

    const selectedStructure = typeStructureSelect.value || 'Ombrière métal';

    const modalConfig = STRUCTURE_MODAL_MAPPING[selectedStructure] || STRUCTURE_MODAL_MAPPING['Ombrière métal'];
    // Type de TOITURE (pas de structure à configurer) : l'utilisateur a cliqué explicitement sur le
    // bouton de configuration, on le lui dit en clair — pas le modal "bientôt disponible", qui
    // promettrait à tort un configurateur à venir. Cf. STRUCTURE_MODAL_MAPPING.
    if (modalConfig.sansModal) {
      modalLogger.info('ℹ️ Type de toiture : aucun configurateur de géométrie à ouvrir', { selectedStructure });
      alert("Ce type de toiture n'a pas de configurateur de structure : choisissez une ombrière, un bâtiment incliné ou un petit champ solaire.");
      return;
    }


    if (!modalConfig) {
      modalLogger.error('❌ Configuration modal introuvable', { selectedStructure });
      return;
    }

    // Vérifier si la fonctionnalité est disponible
    if (modalConfig.available === false) {
      modalLogger.info('⚠️ Fonctionnalité non disponible - affichage du modal d\'information');
      const unavailableModal = initFeatureUnavailableModal();
      unavailableModal.show(modalConfig.title);
      return;
    }

    // Récupérer le pvId depuis le tab-content parent (class='tab-content', id='form-PVx')
    const tabContent = button.closest('.tab-content');
    const pvIdFromTab = tabContent?.id?.startsWith('form-') ? tabContent.id.replace('form-', '') : null;

    modalLogger.info('➡️ Ouverture du modal depuis bouton', {
      structure: selectedStructure,
      config: modalConfig,
      pvId: pvIdFromTab
    });

    try {
      geometrieModal.open(modalConfig.url, modalConfig.title, pvIdFromTab);
    } catch (error) {
      modalLogger.error('Erreur lors de l\'ouverture du modal', error);
    }
  }
});

// 3. Modifier le lien dans menu_list.html pour ouvrir le modal
// Attendre que le DOM soit chargé pour ce listener spécifique
document.addEventListener('DOMContentLoaded', function() {
  modalLogger.info('📄 DOMContentLoaded - Configuration du lien géométrie');

  const geometrieLink = document.querySelector('a[href="/concevoir_mon_projet/geometrie"]');

  if (!geometrieLink) {
    modalLogger.warn('⚠️ Lien géométrie introuvable dans le menu');
    return;
  }

  modalLogger.debug('✓ Lien géométrie trouvé');

  geometrieLink.addEventListener('click', function(e) {
    e.preventDefault();
    modalLogger.info('🔗 Clic sur lien géométrie du menu');

    if (!geometrieModal) {
      modalLogger.error('❌ geometrieModal non initialisé');
      return;
    }

    // Récupérer le type de structure sélectionné depuis l'onglet actif
    // Les IDs sont dynamiques (type_de_structure-PV1, type_de_structure-PV2, etc.)
    const activeTab = document.querySelector('.tab-content.active');
    let typeStructureSelect = null;

    if (activeTab) {
      typeStructureSelect = activeTab.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si aucun onglet actif, chercher le premier select disponible
    if (!typeStructureSelect) {
      typeStructureSelect = document.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si toujours pas trouvé, afficher un message
    if (!typeStructureSelect) {
      modalLogger.warn('⚠️ Select type_de_structure introuvable - Aucune forme dessinée');
      alert('Il faut dessiner une forme sur la carte avant de configurer la géométrie.');
      return;
    }

    const selectedStructure = typeStructureSelect.value || 'Ombrière métal';

    const modalConfig = STRUCTURE_MODAL_MAPPING[selectedStructure] || STRUCTURE_MODAL_MAPPING['Ombrière métal'];
    // Type de TOITURE (pas de structure à configurer) : l'utilisateur a cliqué explicitement sur le
    // bouton de configuration, on le lui dit en clair — pas le modal "bientôt disponible", qui
    // promettrait à tort un configurateur à venir. Cf. STRUCTURE_MODAL_MAPPING.
    if (modalConfig.sansModal) {
      modalLogger.info('ℹ️ Type de toiture : aucun configurateur de géométrie à ouvrir', { selectedStructure });
      alert("Ce type de toiture n'a pas de configurateur de structure : choisissez une ombrière, un bâtiment incliné ou un petit champ solaire.");
      return;
    }


    // Vérifier si la fonctionnalité est disponible
    if (modalConfig.available === false) {
      modalLogger.info('⚠️ Fonctionnalité non disponible - affichage du modal d\'information');
      const unavailableModal = initFeatureUnavailableModal();
      unavailableModal.show(modalConfig.title);
      return;
    }

    // Récupérer le pvId depuis l'onglet actif
    const activeTabForMenu = document.querySelector('.tab-content.active');
    const pvIdFromMenu = activeTabForMenu?.id?.startsWith('form-') ? activeTabForMenu.id.replace('form-', '') : null;

    modalLogger.info('➡️ Ouverture du modal depuis menu', {
      structure: selectedStructure,
      config: modalConfig,
      pvId: pvIdFromMenu
    });

    try {
      geometrieModal.open(modalConfig.url, modalConfig.title, pvIdFromMenu);
    } catch (error) {
      modalLogger.error('Erreur lors de l\'ouverture du modal', error);
    }
  });

  modalLogger.info('✅ Listener du lien géométrie configuré');
});

// Exporter pour utilisation externe si nécessaire
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeometrieModal;
}
