// import DOMUtils from '../utils/DOMUtils.js';
import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS } from "../constants.js";
import MeasurementControl from "./MeasurementControl.js";
import ExportService from "../../../services/ExportService.js?v=12"; // ?v= : cf. GoogleMaps.js (même valeur, singleton getInstance() — un import module ES sans cache-busting jusqu'ici)
import GraphModal from "../../../components/GraphModal.js";
import PDFGenerator from "../../../services/PDFGenerator.js";
import DecalageParcelles from "../../decalage_parcelles/DecalageParcelles.js";
// Parcours Chiffrage : définit window.lancerExportDossierChiffrage (bouton ci-dessous et modal de
// chiffrage) — chargé ici, avec la palette, car il ne sert que sur la page Calepinage.
import "../../../geometrie_structure/export_dossier_chiffrage.js?v=5";

/**
 * Boutons non pertinents pour un projet "Résidentielle" (demande explicite) : masqués de la
 * palette (mais laissés dans le DOM, même principe que export-pdf-button) tant que
 * window.ACTIVE_PROJECT_TYPOLOGIE vaut "Résidentielle" (cf. index.html, exposé côté backend depuis
 * ParametreProjet.typologie_projet). Portée module (pas seulement locale à createControls()) pour
 * être réutilisable par ButtonControl.applyResidentialUIFiltering().
 */
const RESIDENTIAL_HIDDEN_BUTTON_IDS = new Set([
  "draw-line-to-polygon-button",
  "draw-polygon-sheds-button",
  "show-hidden-cotation-button",
  "active-desactive-button",
  "show-graph-data-button",
  "draw-polygone-aper-tools-button",
  "draw-simple-shapes-button",
  "draw-obstacle-button",
  "decalage-button",
]);

/**
 * Boutons réservés aux typologies Résidentielle et Professionnelle (masqués en « Grand projet »),
 * même mécanisme de classe CSS que RESIDENTIAL_HIDDEN_BUTTON_IDS (cf. applyResidentialUIFiltering()).
 */
const GRAND_PROJET_HIDDEN_BUTTON_IDS = new Set([
  "orthophoto-drone-button",
]);

/**
 * Boutons réservés aux projets en autoconsommation collective (mode de valorisation contenant
 * « collective », même règle que AccParticipantsCarte.estProjetAcc) : masqués sinon.
 */
const ACC_ONLY_BUTTON_IDS = new Set([
  "acc-participants-button",
]);

/**
 * Boutons à masquer de manière permanente dans la palette d'outils sur la carte (demande explicite) :
 * - Activer/Désactiver la suppression des panneaux (active-desactive-button)
 * - Afficher le graphique de performance (show-graph-data-button)
 * - Dessiner un obstacle (draw-obstacle-button)
 * - Chiffrer votre projet (chiffrage-ouvrir-palette-button) : doublon du bouton vert
 *   « Chiffrer votre projet » (#chiffrage-ouvrir-button) — demande explicite
 */
/**
 * Boutons masqués selon le parcours ouvert depuis Solakvan (clé de la liste `masquer` de
 * app/utils/parcours.py -> id du bouton). Masqués, jamais supprimés.
 */
const PARCOURS_HIDDEN_BUTTON_IDS = {
  plans_ombrieres: "ombrieres-dossier-plans-button",
};

const MAP_HIDDEN_BUTTON_IDS = new Set([
  "active-desactive-button",
  "show-graph-data-button",
  "draw-obstacle-button",
  "chiffrage-ouvrir-palette-button",
]);

// Boutons de la palette réservés au parcours Chiffrage.
const CHIFFRAGE_SEULEMENT_IDS = new Set(["chiffrage-ouvrir-palette-button"]);

/**
 * Gestion des boutons de contrôle
 */

export default class ButtonControl {

  /**
   * Crée un bouton de contrôle
   * @param {string} icon - HTML de l'icône
   * @param {Function} onClick - Fonction de clic
   * @param {string} title - Titre du bouton
   * @returns {HTMLElement} Élément bouton
   */
  /** Ouvre le modal de chiffrage (menu_list.html, openChiffrageModal). */
  static ouvrirChiffrage(event) {
    if (event) event.preventDefault();
    if (typeof window.openChiffrageModal === "function") {
      window.openChiffrageModal(event);
    } else {
      console.warn("Le modal de chiffrage n'est pas encore initialisé.");
    }
  }

  /**
   * Ouvre le calepinage multi-typologie (modale « Calepinage résidentiel ») : maison sélectionnée,
   * à défaut la première ; sans maison tracée, import d'une image. Bouton de la palette et bouton
   * « Revenir au calepinage 2D ».
   * @param {DrawingControl} drawingControl
   */
  static ouvrirCalepinageMultiTypologie(drawingControl) {
    const mgr = window.MaisonPolygonManagerInstance;
    const poly = (mgr && mgr.selected) || (mgr && mgr.polygons && mgr.polygons[0]);
    if (poly && mgr && typeof mgr._notifyReady === 'function') {
      mgr._notifyReady(poly);
    } else if (typeof window.openCalepinageImageSourceModal === 'function') {
      // CORRECTIF (demande explicite : "on doit pouvoir ouvrir le modal sans géométrie
      // dessinée sur la carte — pour importer l'image on doit passer par ce modal") : aucune
      // maison tracée n'est plus un cul-de-sac bloquant — importer une photo/un plan est
      // l'AUTRE point d'entrée du calepinage résidentiel (cf. calepinage_image_source.js,
      // qui appelle directement window.openCalepinageMaisonModal({type:'image',...}) sans
      // jamais dépendre d'un polygone tracé sur la carte). Même modal que le clic droit sur
      // #draw-maison-polygon-button (raccourci existant mais peu découvrable) — ce bouton
      // devient donc le point d'entrée unique, quel que soit le point de départ souhaité.
      window.openCalepinageImageSourceModal();
    } else if (drawingControl && drawingControl.errorModal) {
      drawingControl.errorModal.show("Aucune maison tracée — dessinez d'abord un contour (rectangle ou polygone libre), ou importez une image, avant d'ouvrir le calepinage multi-typologie.");
    }
  }

  /**
   * « Revenir au pompage solaire » : rouvre la modale Consommation d'énergie (iframe universelle)
   * et y sélectionne l'onglet Pompage solaire, dès que son menu est prêt (irve_nav_menu.js).
   */
  static revenirAuPompageSolaire() {
    if (typeof window.openBDMateriels !== "function") {
      console.warn("La modale Consommation d'énergie n'est pas encore initialisée.");
      return;
    }
    window.openBDMateriels(new Event('click'));
    const iframe = document.getElementById('universal-iframe');
    const debut = Date.now();
    const selectionner = () => {
      let menu = null;
      try { menu = iframe && iframe.contentWindow && iframe.contentWindow.IrveNavMenu; } catch (e) { /* navigation en cours */ }
      if (menu && typeof menu.ouvrirOnglet === 'function') {
        menu.ouvrirOnglet('pompage-solaire');
        return;
      }
      if (Date.now() - debut < 20000) setTimeout(selectionner, 200);
    };
    selectionner();
  }

  static createButton(icon, onClick, title, id) {
    const button = document.createElement("button");
    button.setAttribute("aria-label", title);
    button.setAttribute("role", "button");
    button.innerHTML = icon;
    button.style.cssText = `
      background-color: white;
      border: none;
      cursor: pointer;
      padding: 8px;
      margin: 2px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.3s;
      width: 40px;
      height: 40px;
    `;
    button.title = title;
    button.id = id;

    // Ajouter les écouteurs d'événements
    button.addEventListener("mouseenter", () => {
      if (!button.classList.contains("selected") && button.dataset.colorLocked !== "true") {
        button.style.backgroundColor = "#f0f0f0";
      }
    });

    button.addEventListener("mouseleave", () => {
      if (!button.classList.contains("selected") && button.dataset.colorLocked !== "true") {
        button.style.backgroundColor = "white";
      }
    });

    button.addEventListener("click", () => onClick(button));

    return button;
  }
  /**
   * Crée un séparateur entre les boutons de dessin
   * @returns {HTMLElement} Séparateur
   */
  static createSeparator() {
    const separator = document.createElement("div");
    separator.style.cssText = `
      border-right: 2px solid #f50000;
      height: 44px;
      min-height: 100%;
      width: 4px;
    `;
    return separator;
  }

  /**
   * Affiche une notification de sauvegarde
   */
  static showSaveNotification() {
    const notification = document.createElement("div");
    notification.textContent = "Données sauvegardées";
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 120px;
      background-color: #4CAF50;
      color: white;
      padding: 16px;
      border-radius: 4px;
      z-index: 1000;
      animation: fadeInOut 2s ease-in-out forwards;
    `;

    // Ajouter le style d'animation si pas déjà présent
    if (!document.querySelector("#save-notification-style")) {
      const style = document.createElement("style");
      style.id = "save-notification-style";
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateY(20px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-20px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
  }

  /**
   * Crée un conteneur pour les contrôles de dessin
   * @returns {HTMLElement} Conteneur
   */
  static createControlContainer() {
    const container = document.createElement("div");
    const hideButton = document.createElement("button");
    hideButton.classList.add("hide-control-button");
    hideButton.type = "button";
    hideButton.title = "Masquer les contrôles";
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.setAttribute("aria-expanded", "true");

    // Application des corrections : z-index, pointer-events, et position absolue
    hideButton.style.cssText = `
      background-color: white;
      border: none;
      padding: 8px;
      cursor: pointer;
      z-index: 1001 !important;
      pointer-events: auto !important;
      box-shadow: 2px 0 5px rgba(0,0,0,0.1);
      border-radius: 0 4px 4px 0;
      width: 28px;
      min-width: 28px;
      min-height: 40px;
      display: flex;
      justify-content: center;
      align-items: center;
      position: absolute;
      top: 0;
      right: -28px;
      transition: background-color 0.3s, box-shadow 0.3s, top 0.3s;
    `;
    hideButton.innerHTML = "<i id='hide-control-button-icon' class='fas fa-chevron-left' style='font-size: 16px; transition: transform 0.3s ease-in-out;'></i>";

    hideButton.addEventListener("click", () => {
      const innerContainer = document.querySelector(".drawing-control-inner-container");
      if (!innerContainer) return;

      innerContainer.classList.toggle("collapsed");
      const isCollapsed = innerContainer.classList.contains("collapsed");
      hideButton.title = isCollapsed ? "Afficher la palette d'outils" : "Masquer les contrôles";
      hideButton.setAttribute("aria-label", hideButton.title);
      hideButton.setAttribute("aria-expanded", String(!isCollapsed));
      // Palette masquée : la poignée devient un petit point rouge cliquable (GoogleMaps.css,
      // .palette-point), qui reste visible pour réafficher la palette.
      hideButton.classList.toggle("palette-point", isCollapsed);
      container.classList.toggle("palette-masquee", isCollapsed);
      if (typeof container._adapterALaCarte === "function") container._adapterALaCarte();
    });

    container.className = "drawing-control";
    container.style.cssText = `
      background-color: transparent;
      border-radius: 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin: 20px 350px 20px 20px;
      z-index: 1000;
      width: fit-content;
      position: relative;
      overflow: visible !important;
    `;

    container.appendChild(hideButton);

    // Conteneur externe pour les boutons d'actions globales (Système, Calculer)
    const externalActionContainer = document.createElement("div");
    externalActionContainer.className = "drawing-control-actions";
    externalActionContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 100%;
        margin-left: 50px;
        display: flex;
        gap: 15px;
        z-index: 1000;
    `;

    // Ajout du bouton Système (anciennement Voir données solaire)
    const systemeButton = document.createElement("button");
    systemeButton.type = "button";
    systemeButton.innerHTML = '<i class="fas fa-bolt" style="margin-right: 8px;"></i> Système';
    systemeButton.title = "Système";
    systemeButton.id = "show-solar-data-button-external";
    // Parcours Chiffrage : pas de dimensionnement (cf. .masque-chiffrage, menu_list.html).
    // Résidentiel connecté au réseau / Site autonome en pompage : masqué (.masque-parcours-retour).
    systemeButton.classList.add('masque-chiffrage', 'masque-parcours-retour');
    systemeButton.style.cssText = `
        white-space: nowrap;
        background-color: #28a745;
        color: white;
        border: none;
        padding: 12px 20px;
        font-size: 1.1rem;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        transition: background-color 0.2s, transform 0.1s;
    `;
    systemeButton.addEventListener('mouseenter', () => { systemeButton.style.backgroundColor = '#218838'; });
    systemeButton.addEventListener('mouseleave', () => { systemeButton.style.backgroundColor = '#28a745'; });
    systemeButton.addEventListener('mousedown', () => { systemeButton.style.transform = 'scale(0.95)'; });
    systemeButton.addEventListener('mouseup', () => { systemeButton.style.transform = 'scale(1)'; });
    systemeButton.addEventListener('click', async (e) => {
        e.preventDefault();

        if (window.drawingControl && window.drawingControl.summaryModal) {
             window.drawingControl.summaryModal.showSummary();
        }

        // NOUVEAU (demande explicite) : le bouton "Système" ouvre la même modale de synthèse que
        // l'étape "Dimensionnement" du menu horizontal (cf. openDimensionnementModal(), menu_list.html)
        // — on met donc en évidence ce même titre.
        if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('dimensionnement');

        // Activer le bouton "Calculer et Visualiser" après avoir cliqué sur Système
        if (calcVisButton) {
            calcVisButton.disabled = false;
            calcVisButton.style.opacity = '1';
            calcVisButton.style.cursor = 'pointer';
        }
    });

    // Ajout du bouton "Calculer et Visualiser" à droite du menu
    const calcVisButton = document.createElement("button");
    calcVisButton.type = "button";
    calcVisButton.innerHTML = '<i class="fas fa-chart-line" style="margin-right: 8px;"></i> Calculer et Visualiser';
    calcVisButton.title = "Lancer l'analyse d'autoconsommation";
    // Parcours Chiffrage : pas de calcul de production ni d'étude économique. Résidentiel connecté au
    // réseau / Site autonome en pompage : remplacé par un bouton de retour (cf. plus bas).
    calcVisButton.classList.add('masque-chiffrage', 'masque-parcours-retour');
    calcVisButton.disabled = false;
    calcVisButton.style.cssText = `
        white-space: nowrap;
        background-color: #dc2626;
        color: white;
        border: none;
        padding: 12px 20px;
        font-size: 1.1rem;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        z-index: 1000;
        display: flex;
        align-items: center;
        transition: background-color 0.2s, transform 0.1s;
        opacity: 1;
    `;
    
    calcVisButton.addEventListener('mouseenter', () => { if (!calcVisButton.disabled) calcVisButton.style.backgroundColor = '#b91c1c'; });
    calcVisButton.addEventListener('mouseleave', () => { if (!calcVisButton.disabled) calcVisButton.style.backgroundColor = '#dc2626'; });
    calcVisButton.addEventListener('mousedown', () => { if (!calcVisButton.disabled) calcVisButton.style.transform = 'scale(0.95)'; });
    calcVisButton.addEventListener('mouseup', () => { if (!calcVisButton.disabled) calcVisButton.style.transform = 'scale(1)'; });

    calcVisButton.addEventListener('click', async (e) => {
        if (calcVisButton.disabled) return;
        e.preventDefault();

        // Rafraîchit les n° de parcelle (demande explicite : ne plus interroger l'API cadastrale à
        // chaque forme dessinée/déplacée — uniquement ici, au clic). Fire-and-forget : purement
        // informatif, ne bloque jamais la suite du calcul.
        if (window.resumeParcellesControl && typeof window.resumeParcellesControl.refreshAllParcelles === 'function') {
            window.resumeParcellesControl.refreshAllParcelles();
        }

        // Sauvegarde intermédiaire (Action 1) : à chaque clic sur "Calculer et Visualiser", on
        // persiste immédiatement les données de calepinage en base, en plus de l'autosauvegarde
        // périodique (cf. CalepinageDataService.js) — ce clic est un point de contrôle déterministe
        // qui ne dépend pas du minutage du timer.
        if (window.calepinageService && typeof window.calepinageService.saveToDatabase === 'function') {
            window.calepinageService.saveToDatabase().catch(err => {
                console.warn("Sauvegarde intermédiaire du calepinage impossible :", err);
            });
        }

        // Contrôle strict de la puissance totale vs quota de licence (+ tolérance configurable)
        if (typeof window.checkPowerLicenceCompliance === 'function') {
            let totalPower = 0;
            try {
                const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                totalPower = Number(savedData?.totals?.totalPower || 0);
            } catch (_) {}

            const licenceCheck = window.checkPowerLicenceCompliance(totalPower);
            if (!licenceCheck.allowed) {
                if (window.drawingControl && window.drawingControl.errorModal) {
                    window.drawingControl.errorModal.show(licenceCheck.message);
                } else {
                    alert(licenceCheck.message);
                }
                return;
            }
        }

        // Restriction géographique (cf. Config.PROJECT_RADIUS_LIMIT_KM) : bloque le calcul si une
        // surface PV dessinée dépasse le rayon d'action maximal autorisé autour de l'adresse du projet.
        if (window.drawingControl && typeof window.drawingControl.checkProjectRadiusCompliance === 'function') {
            const compliance = window.drawingControl.checkProjectRadiusCompliance();
            if (!compliance.ok) {
                const worst = compliance.violations.reduce((a, b) => (b.distanceKm > a.distanceKm ? b : a));
                const message = `Calcul impossible : une surface (${worst.pvId}) est à ${worst.distanceKm.toFixed(2)} km de l'adresse du projet, au-delà du rayon d'action maximal autorisé (${worst.limitKm} km).`;
                if (window.drawingControl.errorModal) {
                    window.drawingControl.errorModal.show(message);
                } else {
                    alert(message);
                }
                return;
            }
        }

        // NOUVEAU: rafraîchit systématiquement les données solaires du calepinage/système (même
        // traitement que le bouton "Système") avant de lancer le calcul, pour ne plus dépendre d'un
        // clic manuel préalable sur ce bouton et éviter les allées-retours entre les onglets.
        // CORRECTIF (demande explicite : "soumission Système automatique SANS ouvrir sa modale") :
        // showSummary({ silent: true }) exécute tout le calcul/la soumission (mêmes données
        // fiabilisées que le bouton "Système", persistées dans localStorage.solarProjectData) sans
        // jamais appeler this.show() — remplace l'ancien contournement "afficher puis masquer
        // aussitôt" (show() + hide()), qui provoquait un flash visuel et dépendait du timing d'une
        // éventuelle animation d'ouverture/fermeture de la modale.
        if (window.drawingControl && window.drawingControl.summaryModal && typeof window.drawingControl.summaryModal.showSummary === 'function') {
            try {
                await window.drawingControl.summaryModal.showSummary({ silent: true });
            } catch (err) {
                console.warn("Impossible de rafraîchir les données solaires avant le calcul", err);
            }
        }

        // Ratio DC/AC au-delà du « Coef. de surdimensionnement » ou puissance DC au-delà de la
        // P. max DC de l'onduleur (cf. chaines_pertes_modal.js) : calcul bloqué. Placé après le
        // rafraîchissement ci-dessus, qui publie la liste à jour des champs PV.
        if (window.ChainesPertesControle && typeof window.ChainesPertesControle.verifierAvantCalcul === 'function') {
            const controleOnduleurs = window.ChainesPertesControle.verifierAvantCalcul();
            if (!controleOnduleurs.ok) {
                if (window.drawingControl && window.drawingControl.errorModal) {
                    window.drawingControl.errorModal.show(controleOnduleurs.message);
                } else {
                    alert(controleOnduleurs.message);
                }
                return;
            }
        }

        // Démarre la nouvelle séquence de navigation (IRVE -> Autoconso -> Éco -> Rapport)
        if (window.ModalNavigator) {
            window.ModalNavigator.startSequence(e);
        } else {
            // Fallback d'urgence (Ancien comportement)
            localStorage.setItem('autoRunAutoconso', 'true');
            
            if (typeof window.openPrestations === 'function') {
                window.openPrestations(e);
            } else if (typeof window.openModalAutoconso === 'function') {
                window.openModalAutoconso(e);
            } else { 
                console.warn("Les fonctions d'ouverture du modal ne sont pas disponibles."); 
            }
            
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('startAutomatedAutoconso'));
            }, 400);
        }
    });


    // Parcours Chiffrage : grand bouton « Exporter le rapport » à la place de « Calculer et
    // Visualiser » (masqué en Chiffrage) — même export que le bouton du modal de chiffrage
    // (export_dossier_chiffrage.js). Visible seulement en Chiffrage (classe seulement-chiffrage).
    const exportChiffrageButton = document.createElement("button");
    exportChiffrageButton.type = "button";
    exportChiffrageButton.id = "chiffrage-dossier-plans-button";
    exportChiffrageButton.innerHTML = '<i class="fas fa-file-invoice-dollar" style="margin-right: 8px;"></i> Exporter le rapport';
    exportChiffrageButton.title = "Enregistrer le projet puis exporter le dossier plans avec le devis en dernière page";
    exportChiffrageButton.classList.add('seulement-chiffrage');
    exportChiffrageButton.style.cssText = calcVisButton.style.cssText;
    exportChiffrageButton.addEventListener('mouseenter', () => { exportChiffrageButton.style.backgroundColor = '#b91c1c'; });
    exportChiffrageButton.addEventListener('mouseleave', () => { exportChiffrageButton.style.backgroundColor = '#dc2626'; });
    exportChiffrageButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.lancerExportDossierChiffrage === "function") {
            window.lancerExportDossierChiffrage();
        } else {
            console.warn("L'export du dossier plans (chiffrage) n'est pas encore initialisé.");
        }
    });

    // Parcours Chiffrage : « Chiffrer votre projet » juste avant « Exporter le rapport » —
    // ouvre le modal de chiffrage (même action que l'entrée « € Chiffrage » du menu).
    const chiffrerButton = document.createElement("button");
    chiffrerButton.type = "button";
    chiffrerButton.id = "chiffrage-ouvrir-button";
    chiffrerButton.innerHTML = '<i class="fas fa-euro-sign" style="margin-right: 8px;"></i> Chiffrer votre projet';
    chiffrerButton.title = "Ouvrir le chiffrage du projet";
    chiffrerButton.classList.add('seulement-chiffrage');
    chiffrerButton.style.cssText = systemeButton.style.cssText;
    chiffrerButton.addEventListener('mouseenter', () => { chiffrerButton.style.backgroundColor = '#218838'; });
    chiffrerButton.addEventListener('mouseleave', () => { chiffrerButton.style.backgroundColor = '#28a745'; });
    chiffrerButton.addEventListener('click', (e) => ButtonControl.ouvrirChiffrage(e));

    // À la place de « Calculer et Visualiser » (demande explicite), même style, visibles selon le
    // parcours du projet (classes posées sur <html> par window.appliquerParcoursRetour) :
    //  - Résidentiel connecté au réseau ou système Alimentation électrique / Système hybride / Solaire thermique : retour à la modale Calepinage multi-typologie ;
    //  - Site autonome en pompage solaire : retour à la modale Consommation d'énergie, onglet Pompage.
    const creerBoutonRetour = (id, icone, libelle, titre, classe, action) => {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.id = id;
      bouton.innerHTML = `<i class="fas ${icone}" style="margin-right: 8px;"></i> ${libelle}`;
      bouton.title = titre;
      bouton.classList.add('masque-chiffrage', classe);
      bouton.style.cssText = calcVisButton.style.cssText;
      bouton.addEventListener('mouseenter', () => { bouton.style.backgroundColor = '#b91c1c'; });
      bouton.addEventListener('mouseleave', () => { bouton.style.backgroundColor = '#dc2626'; });
      bouton.addEventListener('mousedown', () => { bouton.style.transform = 'scale(0.95)'; });
      bouton.addEventListener('mouseup', () => { bouton.style.transform = 'scale(1)'; });
      bouton.addEventListener('click', (e) => { e.preventDefault(); action(); });
      return bouton;
    };
    const retourCalepinageButton = creerBoutonRetour("retour-calepinage-2d-button", "fa-th",
      "Revenir au calepinage 2D", "Rouvrir le calepinage multi-typologie", 'seulement-residentiel-reseau',
      () => ButtonControl.ouvrirCalepinageMultiTypologie(window.drawingControl));
    const retourPompageButton = creerBoutonRetour("retour-pompage-solaire-button", "fa-tint",
      "Revenir au pompage solaire", "Rouvrir la consommation d'énergie, onglet Pompage solaire", 'seulement-pompage-autonome',
      () => ButtonControl.revenirAuPompageSolaire());

    externalActionContainer.appendChild(systemeButton);
    externalActionContainer.appendChild(calcVisButton);
    externalActionContainer.appendChild(retourCalepinageButton);
    externalActionContainer.appendChild(retourPompageButton);
    externalActionContainer.appendChild(chiffrerButton);
    externalActionContainer.appendChild(exportChiffrageButton);
    container.appendChild(externalActionContainer);

    return container;
  }
  /**
   * Crée un conteneur interne pour les contrôles de dessin
   * @returns {HTMLElement} Conteneur interne
   */
  static createInnerControlContainer() {
    const innerContainer = document.createElement("div");
    innerContainer.classList.add("drawing-control-inner-container");
    innerContainer.style.cssText = `
      background-color: white;
      display: flex;
      height: 100%;
      width: 100%;
    `;

    return innerContainer;
  }
  /**
   * Crée les contrôles de dessin
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  static createControls(drawingControl) {
    const controls = [
      // {
      //   icon: "line-to-polygon",
      //   title: "Dessiner un champ PV incliné",
      //   action: (button) => {
      //     const wasSelected = button.classList.contains("selected");
      //     ButtonControl.clearAllActiveModes(drawingControl);
      //     if (!wasSelected) {
      //       drawingControl.toggleLineToPolygonMode(button);
      //       ButtonControl.updateSupportPvUI('line-to-polygon');
      //     }
      //   },
      //   id: "draw-line-to-polygon-button",
      // },

      // Emplacement code pour l'affichage du bouton shed

      // {
      //   // CORRECTIF (demande explicite : "remplacer l'icône du calepinage polygone en shed") :
      //   // icône remplacée, comportement shed inchangé.
      //   icon: "solar-power-plant-clean-energy-solar-farm-solar-enrgy-svgrepo-com",
      //   title: "Dessiner un champ PV en sheds",
      //   action: (button) => {
      //     // Diagnostic temporaire : alerte visuelle impossible à manquer (contrairement à la
      //     // console, noyée sous les logs d'autres modules) si une exception survient dans cette
      //     // chaîne — à retirer une fois le moteur shed validé en navigateur.
      //     try {
      //       const wasSelected = button.classList.contains("selected");
      //       ButtonControl.clearAllActiveModes(drawingControl);
      //       if (!wasSelected) {
      //         drawingControl.toggleShedPolygonMode(button);
      //         ButtonControl.updateSupportPvUI('polygon-sheds');
      //       }
      //     } catch (error) {
      //       console.error('[draw-polygon-sheds-button] Erreur:', error);
      //       alert('[DIAGNOSTIC] Erreur au clic sur le bouton shed : ' + (error && error.message ? error.message : error) + '\n\nStack: ' + (error && error.stack ? error.stack : 'indisponible'));
      //     }
      //   },
      //   id: "draw-polygon-sheds-button",
      // },

      // Calepinage résidentiel (toiture pavillon) : totalement décorrélé du système de calepinage
      // "grands projets" ci-dessus — cf. polygon_maison.js (MaisonPolygonManager), qui dessine avec son
      // propre DrawingManager indépendant, exactement comme la Loi APER (cf. polygone_aper.js), pour
      // garantir zéro risque de régression sur les outils existants.
      {
        // CORRECTIF (demande explicite : "le bouton Calepinage toiture multi-typologie doit tracer
        // uniquement des rectangles, remplacer l'icône actuelle") : icône remplacée ; startDraw('rect')
        // explicite (comportement inchangé, c'était déjà l'effet par défaut — cf.
        // polygon_maison.js::startDraw/_initPolygon).
        icon: "rectangle-tool-svgrepo-com",
        title: "Calepinage rectangulaire",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) {
            if (window.MaisonPolygonManagerInstance && typeof window.MaisonPolygonManagerInstance.startDraw === 'function') {
              window.MaisonPolygonManagerInstance.startDraw('rect');
              drawingControl.activeButton = button;
              button.classList.add('selected');
              button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
            } else if (drawingControl.errorModal) {
              drawingControl.errorModal.show("Le module de calepinage résidentiel n'est pas encore prêt. Veuillez réessayer.");
            }
          }
        },
        id: "draw-maison-polygon-button",
      },

      // NOUVEAU (demande explicite : "ajouter une nouvelle icône de dessin des panneaux solaires...
      // polyline... visible pour toute typologie de calepinage... contrôle le dessin des panneaux
      // polygone") : second point d'entrée du même module résidentiel (cf. bouton précédent), mode
      // 'polygon' — le tracé à main levée n'est plus redressé à angles droits (remplace l'ancien
      // bouton "Angles 90°" du modal, retiré). Volontairement absent de
      // RESIDENTIAL_HIDDEN_BUTTON_IDS (visible pour toutes les typologies), comme son voisin.
      {
        icon: "polyline-pt-svgrepo-com",
        title: "Calepinage polygonal",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) {
            if (window.MaisonPolygonManagerInstance && typeof window.MaisonPolygonManagerInstance.startDraw === 'function') {
              window.MaisonPolygonManagerInstance.startDraw('polygon');
              drawingControl.activeButton = button;
              button.classList.add('selected');
              button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
            } else if (drawingControl.errorModal) {
              drawingControl.errorModal.show("Le module de calepinage résidentiel n'est pas encore prêt. Veuillez réessayer.");
            }
          }
        },
        id: "draw-maison-polyline-button",
      },

      // DÉPLACÉ (demande explicite : juste après le polygone libre) et ÉTENDU : avec une forme simple
      // sélectionnée, décalage de cette forme (comportement historique) ; sinon, champ solaire à
      // partir de parcelles cadastrales (sélection des parcelles, fusion, recul, remplissage) — cf.
      // components/decalage_parcelles/DecalageParcelles.js. Réservé aux typologies PRO / Grand projet.
      {
        icon: "decalage",
        // Accès réglé dans config.py (DECALAGE_PARCELLES_POUR_TOUS / DECALAGE_PARCELLES_EMAILS).
        title: DecalageParcelles.accesAutorise()
          ? "Créer une forme de décalage (forme simple sélectionnée) ou un champ solaire à partir de parcelles cadastrales"
          : "Créer une forme de décalage",
        action: (button) => {
          const hasSelection =
            drawingControl.simpleRectangleManager.selectedSimpleRectangle ||
            drawingControl.lineManager.selectedLine ||
            drawingControl.circleManager.selectedCircle ||
            drawingControl.simplePolygonManager.selectedSimplePolygon;

          if (hasSelection) {
            drawingControl.offsetModal.show((offsetValue) => {
              drawingControl.createOffsetShape(offsetValue);
            });
            return;
          }
          if (!DecalageParcelles.accesAutorise()) {
            drawingControl.errorModal.show("Veuillez d'abord sélectionner une forme simple (ligne, cercle, rectangle ou polygone)");
            return;
          }
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected && DecalageParcelles.demarrer(drawingControl)) {
            drawingControl.activeButton = button;
            button.classList.add("selected");
            button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || "#e0e0e0";
          }
        },
        id: "decalage-button",
      },

      // RETIRÉ (demande explicite : "ce bouton de ligne devrait être dans le modal du calepinage
      // résidentiel") : le bouton "Dessiner une ligne (trait libre)" qui vivait ici a été déplacé DANS
      // le modal résidentiel (#cmToolbar, groupe "contour") — cf.
      // calepinage_maison_toolbar_config.js (bouton calepinageMaisonDrawLineBtn) +
      // calepinage_maison_dessin.js (nouvelle primitive de tracé native au canevas Canvas 2D de ce
      // modal, CM.state.freeLines — le mécanisme "ligne simple" de la carte réutilisé ici
      // (toggleSimpleLineMode/lineManager) restant lui inchangé et toujours accessible en Pro/Grand-
      // projet via le sous-menu "draw-simple-shapes-button").

      // {
      //  icon: "solar-panel",
      //  title: "Dessiner un champ PV rectangulaire en shed",
      //  action: (button) => {
      //    const wasSelected = button.classList.contains("selected");
      //    ButtonControl.clearAllActiveModes(drawingControl);
      //    if (!wasSelected) drawingControl.toggleSolarRectangleMode(button);
      //  },
      //  id: "draw-solar-panel-button",
      //  },

      
      // {
      //   icon: "performance-labels",
      //   title: "Afficher les labels de performance sur la carte",
      //   action: () => {
      //     MeasurementControl.togglePerformanceLabelsVisibility();
      //   },
      //   id: "toggle-performance-labels-button",
      // },

      {
        icon: "cotations",
        title: "Afficher et masquer les cotations",
        action: (button) => {
          if (typeof drawingControl.toggleCotationsVisibility === 'function') {
            drawingControl.toggleCotationsVisibility(button);
          }
        },
        id: "show-hidden-cotation-button",
      },

      // Ligne de cotation (Déclaration préalable) : flèche à chaque extrémité, cf.
      // shapes/CotationLine.js. Absente de RESIDENTIAL_HIDDEN_BUTTON_IDS : visible pour toutes les
      // typologies (le dossier DP vise d'abord le résidentiel, où les formes simples sont masquées).
      {
        icon: "cotation-line",
        title: "Tracer une ligne de cotation (clic départ, clic arrivée, double-clic pour terminer)",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) drawingControl.toggleCotationMode(button);
        },
        id: "draw-cotation-line-button",
      },

      {
        icon: "panneau-solaire",
        title: "Ajouter/Masquer les panneaux solaires",
        action: (button) => {
          // Demande explicite : bouton actif pour toutes les typologies, il masque/réaffiche les
          // panneaux du champ PV SÉLECTIONNÉ sur la carte (calepinage_maison_carte_plans.js).
          const CM = window.CalepinageMaisonIndiv;
          const mgr = window.MaisonPolygonManagerInstance;
          const champ = mgr && mgr.selected;
          if (CM && typeof CM.basculerPanneauxCarte === 'function' && champ && champ.maisonId) {
            const visibles = CM.basculerPanneauxCarte(champ.maisonId);
            button.title = visibles
              ? `Masquer les panneaux solaires (${champ.maisonId})`
              : `Afficher les panneaux solaires (${champ.maisonId})`;
          } else if (!drawingControl.selectedShape && drawingControl.errorModal) {
            drawingControl.errorModal.show("Sélectionnez d'abord un champ PV sur la carte pour masquer ou afficher ses panneaux.");
          }
          // Anciennes formes du calepinage grand projet : bascule de la forme sélectionnée.
          const currentSelection = drawingControl.selectedShape;
          if (currentSelection && typeof currentSelection.getMap === 'function' && currentSelection.getMap()
              && typeof drawingControl.toggleSolarPanelsVisibility === 'function') {
            drawingControl.toggleSolarPanelsVisibility(currentSelection);
          }
        },
        id: "show-hidden-panels-button",
      },

      // Copier-coller d'un champ PV (demande explicite) : uniquement le calepinage multi-typologie
      // (polygon_maison.js::demarrerCopieChamp) — copie le champ sélectionné, le clic suivant sur la
      // carte pose la copie sous le numéro PV N+1, enregistrée en localStorage et en base.
      {
        icon: "copy-paste",
        title: "Copier/Coller le champ PV sélectionné (cliquez ensuite sur la carte pour placer la copie)",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          const mgr = window.MaisonPolygonManagerInstance;
          if (wasSelected || !mgr || typeof mgr.demarrerCopieChamp !== "function") return;
          if (mgr.demarrerCopieChamp()) {
            drawingControl.activeButton = button;
            button.classList.add("selected");
            button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || "#e0e0e0";
          }
        },
        id: "copy-paste-button",
      },

      {
        icon: "ActiveDesactive_SupprRestau_Panneaux",
        title: "Activer/Desactiver la Supression et la restauration des panneaux solaires",
        action: (button) => {
          // Activer le mode pour LineToPolygon et Polygon
          if (drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.toggleBoolShowHide === 'function') {
            drawingControl.lineToPolygon.toggleBoolShowHide(button);
          }
          if (drawingControl.polygonPanels && typeof drawingControl.polygonPanels.toggleBoolShowHide === 'function') {
            drawingControl.polygonPanels.toggleBoolShowHide(button);
          }
          if (drawingControl.solarRectangle && typeof drawingControl.solarRectangle.toggleBoolShowHide === 'function') {
            drawingControl.solarRectangle.toggleBoolShowHide(button);
          }
        },
        id: "active-desactive-button",
      },


      // Desactiver les bouton de rotation de panneaux par JJD
      // {
      // icon: "rotate-panels-left",
      // title: "Rotation panneaux -1°",
      //action: () => {
      //  drawingControl.rotatePanelsOrientation(-DRAWING_CONSTANTS.PANEL_ROTATION_STEP);
      // },
      // id: "rotate-panels-left-button",
      //},

      //{
      //icon: "rotate-panels-right",
      //title: "Rotation panneaux +1°",
      // action: () => {
      //drawingControl.rotatePanelsOrientation(DRAWING_CONSTANTS.PANEL_ROTATION_STEP);
      // },
      //id: "rotate-panels-right-button",
      // },

      {
        icon: "graphique",
        title: "Afficher le graphique de performance",
        action: (button) => {
          console.log(GraphModal.getInstance());
          GraphModal.getInstance().showGraph(button);
        },
        id: "show-graph-data-button",
      },

      // NOUVEAU (demande explicite : "ouvrir le modal de calepinage résidentiel depuis la palette
      // d'outils, visible pour le calepinage rési ET grand projet") : réutilise le point d'entrée
      // déjà existant MaisonPolygonManagerInstance._notifyReady(poly) — celui déjà déclenché par un
      // clic sur une cotation (cf. polygon_maison.js::_updateDimensionLabels), qui recalcule les
      // azimuts puis appelle window.openCalepinageMaisonModal(poly, azimuths). Cible .selected (la
      // maison la plus récemment enregistrée/sélectionnée) avec repli sur .polygons[0] (première
      // maison connue) si aucune n'est sélectionnée. Ajouté JUSTE À CÔTÉ du bouton graphique
      // ci-dessus, sans le remplacer (décision confirmée) — PAS ajouté à
      // RESIDENTIAL_HIDDEN_BUTTON_IDS, reste donc visible pour toutes les typologies, même principe
      // déjà utilisé pour les 2 boutons de tracé résidentiel (cf. leur propre commentaire plus bas).
      {
        icon: "open-in-new-window-button-2-svgrepo-com",
        title: "Ouvrir le calepinage multi-typologie",
        action: () => ButtonControl.ouvrirCalepinageMultiTypologie(drawingControl),
        id: "open-calepinage-maison-button",
      },

      // NOUVEAU (demande explicite : « arriver à la vue 3D directement sans passer par la vue du
      // modal calepinage résidentiel », bouton placé après « Ouvrir le calepinage ») : ouvre le
      // calepinage du champ sélectionné (même cible que le bouton précédent) et bascule aussitôt sur
      // sa vue 3D. La 3D vit dans ce modal (canevas, état du champ, barre d'outils 3D) : « Retour au
      // plan 2D » reste disponible, la croix referme le tout.
      {
        icon: "3D",
        title: "Vue 3D du calepinage",
        action: () => {
          const mgr = window.MaisonPolygonManagerInstance;
          const poly = (mgr && mgr.selected) || (mgr && mgr.polygons && mgr.polygons[0]);
          const CM = window.CalepinageMaisonIndiv;
          if (!poly || !mgr || typeof mgr._notifyReady !== 'function') {
            if (drawingControl.errorModal) {
              drawingControl.errorModal.show("Aucun champ PV tracé : dessinez d'abord un contour (rectangle ou polygone libre) pour afficher sa vue 3D.");
            }
            return;
          }
          mgr._notifyReady(poly); // ouverture synchrone du modal sur ce champ
          if (CM && typeof CM.open3DView === 'function' && !(CM.state && CM.state.view3DMode)) CM.open3DView();
        },
        id: "open-vue-3d-button",
      },

      // {
      //   icon: "rotate-left",
      //   title: "Rotation -1°",
      //   action: () => { },
      // },
      // {
      //   icon: "rotate-right",
      //   title: "Rotation +1°",
      //   action: () => { },
      // },
      {
        icon: "save",
        title: "Sauvegarder le projet",
        id: "save-projet-button",
        action: async () => {
          // Filet de sécurité (demande explicite 2026-10-17) : TOUT le projet ouvert est enregistré
          // en base — calepinages, Loi APER, devis, étude économique, puissance projet et variante
          // active (services/sauvegarde_projet.js, qui affiche le résultat).
          if (window.SauvegardeProjet && typeof window.SauvegardeProjet.sauvegarderProjet === 'function') {
            await window.SauvegardeProjet.sauvegarderProjet();
            return;
          }
          try {
            // Sauvegarder dans le localStorage
            const success = await window.storageManager.savePageData();

            if (success) {
              // Sauvegarder dans la base de données si un projet est sélectionné
              if (window.calepinageService && window.calepinageService.getCurrentProjetId()) {
                const dbResult = await window.calepinageService.saveToDatabase();

                if (dbResult.success) {
                  this.showSaveNotification();
                  console.log('✅ Données sauvegardées dans localStorage et base de données');
                } else {
                  // Sauvegarde localStorage OK mais DB échouée
                  console.warn('⚠️ Sauvegarde localStorage OK, mais erreur DB:', dbResult.message);
                  this.showSaveNotification(); // Afficher quand même la notification
                }
              } else {
                // Pas de projet sélectionné, sauvegarder uniquement dans localStorage
                this.showSaveNotification();
                console.log('ℹ️ Données sauvegardées uniquement dans localStorage (aucun projet sélectionné)');
              }
            }
          } catch (error) {
            console.error("Erreur lors de la sauvegarde:", error);
          }
        },
      },

      // ajout icon calculateur APER
      // {
      //   icon: `<i class="bi bi-calculator" style="font-size: 24px; color: #374151;"></i>`,
      //   title: "Calculateur Loi APER",
      //   action: (button) => {
      //     if (typeof window.openCalculateurAPER === 'function') {
      //       window.openCalculateurAPER();
      //     } else if (typeof window.openLoiAperModal === 'function') {
      //       window.openLoiAperModal();
      //     } else {
      //       console.warn("Calculateur APER non instancié.");
      //     }
      //   },
      //   id: "calculateur-aper-button",
      // },


      {
        icon: "pdf-export",
        title: "Rapport projet",
        action: (button) => {
          console.log(ExportService.getInstance());
          ExportService.getInstance().exportPDF(button);
        },
        id: "export-pdf-button",
      },

      {
        icon: `<img src="/static/concevoir_mon_projet/medias/icons/file-download-svgrepo-com (1).svg" alt="Exporter les plans en PDF et DXF" style="height: 24px; width: 24px;">`,
        title: "Exporter les plans en PDF et DXF",
        action: () => {
          if (window.exportPlansModal) {
            window.exportPlansModal.open();
          } else {
            console.warn("Le modal d'export des plans n'est pas encore initialisé.");
          }
        },
        id: "export-plans-pdf-dxf-button",
      },

      // Parcours Chiffrage : « Chiffrer votre projet », juste à droite de l'export des plans
      // (visible seulement en Chiffrage, cf. CHIFFRAGE_SEULEMENT_IDS).
      {
        icon: `<i class="fas fa-euro-sign" style="font-size: 20px; line-height: 1; color: #15803d;" aria-hidden="true"></i>`,
        title: "Chiffrer votre projet",
        action: () => ButtonControl.ouvrirChiffrage(),
        id: "chiffrage-ouvrir-palette-button",
      },

      // Dossier de plans de conception des ombrières (toutes les ombrières du projet : coupe et
      // façade par champ PV, page APER facultative), cf. geometrie_structure/ombrieres/dossier_plans/.
      // Même modal que le dossier du petit champ solaire, monté par pages/index.html.
      {
        icon: `<i class="bi bi-file-earmark-ruled" style="font-size: 21px; line-height: 1; color: #1f2937;" aria-hidden="true"></i>`,
        title: "Dossier de plans de conception - ombrières",
        action: () => {
          if (window.ombriereDossierModal) {
            window.ombriereDossierModal.open();
          } else {
            console.warn("Le dossier de plans des ombrières n'est pas encore initialisé.");
          }
        },
        id: "ombrieres-dossier-plans-button",
      },

      // {
      //  icon: "pdf-export",
      //  title: "Rapport détaillé ",
      //  action: () => {
      //    const pdfGen = new PDFGenerator();
      //    pdfGen.generatePDF();
      //   },
      //  id: "btnPDF",
      // },

      {
        icon: "eyes-map",
        title: "Afficher le rayon de 3km",
        action: (button) => {
          let newState;
          if (window.mapSyncManager) {
            newState = window.mapSyncManager.toggleMainMapRadius();
          } else if (window._projectAddressCircle) {
            // Fallback : mapSyncManager pas encore initialisé (modale pas encore ouverte)
            const isVisible = window._projectAddressCircle.getMap() !== null;
            window._projectAddressCircle.setMap(isVisible ? null : window.map);
            // NOUVEAU: la croix (marqueur du centre) suit la visibilité du cercle
            if (window._projectAddressMarker) {
              window._projectAddressMarker.setMap(isVisible ? null : window.map);
            }
            newState = !isVisible;
          } else {
            console.warn('Aucun rayon de 3km disponible');
            return;
          }
          if (newState) {
            button.classList.add('selected');
            button.style.backgroundColor = '#e3f2fd';
            button.title = "Masquer le rayon de 3km";
          } else {
            button.classList.remove('selected');
            button.style.backgroundColor = 'white';
            button.title = "Afficher le rayon de 3km";
          }
        },
        id: "toggle-radius-button",
      },
      // {
      //   icon: "sync",
      //   title: "Synchroniser avec la carte principale",
      //   action: (button) => {
      //     // Vérifier que tous les éléments sont disponibles
      //     if (!window.parametreProjetManager || !window.drawingControl) {
      //       console.error('Managers non disponibles');
      //       return;
      //     }

      //     const parametreManager = window.parametreProjetManager;
      //     const mainMap = window.drawingControl.map;
      //     const coords = parametreManager.coordinateManager.getCoordinates('parametreProject');

      //     if (coords.length === 0) {
      //       alert('Veuillez d\'abord sélectionner une adresse dans le modal');
      //       return;
      //     }

      //     const coordData = coords[0];

      //     // Appeler directement la synchronisation
      //     if (window.mapSyncManager) {
      //       window.mapSyncManager.syncToMainMap(coordData);
      //     } else {
      //       // Créer le MapSyncManager si nécessaire
      //       window.mapSyncManager = new MapSyncManager(
      //         mainMap,
      //         parametreManager.map,
      //         parametreManager.coordinateManager
      //       );
      //       window.mapSyncManager.syncToMainMap(coordData);
      //     }

      //     // Feedback visuel
      //     button.classList.add('synced');
      //     setTimeout(() => button.classList.remove('synced'), 1500);
      //   },
      //   id: "sync-radius-button",
      // },

      {
        icon: "clear",
        title: "Effacer la sélection",
        action: () => ButtonControl.clearSelection(drawingControl),
        id: "clear-selection-button",
      },

      {
        icon: "location-svgrepo-com",
        title: "Placer un marqueur de coordonnées (Décimal et DMS)",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) {
            if (drawingControl.geocodingMarkerManager) {
              drawingControl.geocodingMarkerManager.startMode();
            }
            drawingControl.activeButton = button;
            button.classList.add("selected");
            button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || "#e0e0e0";
          }
        },
        id: "geocoding-marker-button",
      },

      {
        // Orthophoto drone (JPEG/PNG + fichier de coordonnées), posée sur la carte à sa position réelle —
        // typologies Résidentielle et Professionnelle uniquement (masqué en Grand projet, cf.
        // GRAND_PROJET_HIDDEN_BUTTON_IDS). Implémentation : components/orthophoto/orthophoto_drone.js.
        icon: "satellite",
        title: "Importer une orthophoto drone (image + fichier de coordonnées)",
        action: () => {
          ButtonControl.clearAllActiveModes(drawingControl);
          if (window.OrthophotoDrone && typeof window.OrthophotoDrone.ouvrirImport === "function") {
            window.OrthophotoDrone.ouvrirImport();
          }
        },
        id: "orthophoto-drone-button",
      },

      {
        // Carte des participants ACC (adresse / bâtiment de chaque participant, cercles 2 / 10 / 20 km,
        // contrôle du périmètre et de la puissance) — projets en autoconsommation collective
        // uniquement (cf. ACC_ONLY_BUTTON_IDS). Implémentation : components/acc_participants/.
        icon: "circle-dashed-svgrepo-com",
        title: "Participants de l'autoconsommation collective (carte et périmètre)",
        action: () => {
          ButtonControl.clearAllActiveModes(drawingControl);
          if (window.AccParticipantsCarte && typeof window.AccParticipantsCarte.ouvrir === "function") {
            window.AccParticipantsCarte.ouvrir();
          }
        },
        id: "acc-participants-button",
      },

      {
        icon: "pencil-square-svgrepo-com",
        title: "Outils de tracé Loi APER (surfaces / exclusions)",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) ButtonControl.togglePolygoneAperMenu(button, drawingControl);
        },
        id: "draw-polygone-aper-tools-button",
      },

      {
        icon: "polygon",
        title: "Dessiner des formes simples",
        action: (button) => {
          // La palette reste ouverte après chaque tracé : seul un clic sur ce bouton la referme.
          ButtonControl.clearAllActiveModes(drawingControl);
          ButtonControl.toggleSimpleShapesMenu(button, drawingControl);
        },
        id: "draw-simple-shapes-button",
      },

      {
        icon: "obstacle",
        title: "Dessiner un obstacle",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) ButtonControl.toggleObstacleMenu(button, drawingControl);
        },
        id: "draw-obstacle-button",
      },
      {
        icon: "performance-labels",
        title: "Matériels électriques",
        action: (button) => {
          const wasSelected = button.classList.contains("selected");
          ButtonControl.clearAllActiveModes(drawingControl);
          if (!wasSelected) ButtonControl.toggleMatElecMenu(button, drawingControl);
        },
        id: "mat-elec-button",
      },

      {
        icon: `<img src="/static/concevoir_mon_projet/medias/icons/pencil-slash-svgrepo-com.svg" alt="Schéma unifilaire" style="height: 24px; width: 24px;">`,
        title: "Ouvrir l'éditeur de schéma unifilaire",
        action: () => {
          ButtonControl.openSchemaUnifilaireModal();
        },
        id: "schema-unifilaire-button",
      },
    ];

    controls.forEach((control) => {
      if (control.type === "orientation") {
        // Pour les contrôles d'orientation, on ajoute directement l'élément créé
        drawingControl.container.appendChild(control.control());
      } else {
        // Pour les autres contrôles, on utilise la logique existante
        const iconHtml = control.icon.startsWith('<')
          ? control.icon
          : `<img src="/static/concevoir_mon_projet/medias/icons/${control.icon}.svg" alt="${control.title}" style="height: 24px; width: 24px;">`;

        const button = this.createButton(
          iconHtml,
          control.action,
          control.title,
          control.id
        );

        // Masqué de la barre d'outils, mais volontairement laissé dans le DOM et pleinement
        // fonctionnel : triggerProjectExport() (menu_list.html) fait
        // document.getElementById('export-pdf-button').click() pour déclencher l'export du rapport
        // depuis le menu et la navigation séquentielle (navigation-modales.js) — le supprimer ou le
        // désactiver casserait cet export.
        if (
          control.id === "export-pdf-button" ||
          MAP_HIDDEN_BUTTON_IDS.has(control.id)
        ) {
          button.style.display = "none";
        }
        // Classe CSS !important (menu_list.html) : résiste aux bascules d'affichage de la palette.
        if (CHIFFRAGE_SEULEMENT_IDS.has(control.id)) button.classList.add("seulement-chiffrage");

        if (
          control.id === "save-projet-button" ||
          control.id === "show-hidden-panels-button" ||
          control.id === "mat-elec-button" ||
          control.id === "geocoding-marker-button"
        ) {
          const separator = this.createSeparator();
          // Demande explicite (Résidentielle uniquement) : les séparateurs après copy-paste-button
          // et show-hidden-panels-button (juste après draw-maison-polygon-button une fois les
          // boutons intermédiaires masqués) et après geocoding-marker-button (juste avant
          // mat-elec-button) deviennent orphelins/inutiles — celui après mat-elec-button, lui, reste
          // affiché dans tous les cas. Marqué ici (au lieu d'être simplement omis) pour rester
          // basculable dynamiquement par applyResidentialUIFiltering() (cf. plus bas, appelée en fin
          // de createControls()), sans devoir recréer toute la palette au changement de projet actif.
          // show-hidden-panels-button n'y figure plus : bouton désormais visible en Résidentielle,
          // son séparateur l'est donc aussi.
          // Le séparateur de copy-paste-button précède désormais save-projet-button (juste après la vue 3D)
          // (le bouton de copie a été placé juste après show-hidden-panels-button).
          if (
            control.id === "save-projet-button" ||
            control.id === "geocoding-marker-button"
          ) {
            separator.classList.add("residential-hide-separator");
          }
          drawingControl.innerContainer.appendChild(separator);
        }
        // Stocker la référence du bouton de dessin
        if (control.id === "draw-solar-panel-button") {
          drawingControl.drawButton = button;
          // Désactiver le bouton initialement si le zoom est trop faible
          drawingControl.updateDrawButtonState(
            drawingControl.map?.getZoom() || 0
          );
        } else if (control.id === "draw-line-button") {
          drawingControl.lineButton = button;
        } else if (control.id === "draw-circle-button") {
          drawingControl.circleButton = button;
        } else if (control.id === "draw-text-button") {
          drawingControl.textButton = button;
        } else if (control.id === "copy-paste-button") {
          drawingControl.copyButton = button;
        } else if (control.id === "draw-line-to-polygon-button") {
          drawingControl.lineToPolygonButton = button;
        } else if (control.id === "draw-simpleRectangle-button") {
          drawingControl.simpleRectangleButton = button;
        } else if (control.id === "draw-simplePolygon-button") {
          drawingControl.simplePolygonButton = button;
        }

        if (control.icon === "rotate-left" || control.icon === "rotate-right") {
          let rotationInterval;
          const angle = control.icon === "rotate-left" ? 1 : -1;

          button.addEventListener("mousedown", () => {

            const rotateStep = () => {
              drawingControl.rotateSelectedElement(
                angle * DRAWING_CONSTANTS.ROTATION_STEP,
                false
              ); // false = ne pas déclencher de recalcul lourd explicite côté PV
            };
            rotateStep();
            rotationInterval = setInterval(rotateStep, 25);
          });

          const stopRotation = () => {
            if (rotationInterval) {
              clearInterval(rotationInterval);
              rotationInterval = null;

              // Recalculer et afficher les panneaux une fois la rotation terminée
              drawingControl.rotateSelectedElement(0, true);
            }
          };

          button.addEventListener("mouseup", stopRotation);
          button.addEventListener("mouseleave", stopRotation);
        }

        drawingControl.innerContainer.appendChild(button);
      }
    });
    drawingControl.container.appendChild(drawingControl.innerContainer);
    ButtonControl.registerDeleteShortcut(drawingControl);
    ButtonControl.applyResidentialUIFiltering();
    ButtonControl.installerAdaptationLargeur(drawingControl);
  }

  /**
   * Adapte la palette à la largeur de la carte : sur une carte étroite, les boutons passent sur
   * plusieurs lignes et les actions « Système / Calculer et Visualiser » se placent au-dessus de la
   * palette au lieu de sortir de la carte à droite. Recalculé à chaque redimensionnement de la carte
   * (fenêtre, formulaire, menus) et à chaque masquage/affichage de la palette.
   * @param {DrawingControl} drawingControl
   */
  static installerAdaptationLargeur(drawingControl) {
    const container = drawingControl.container;
    const inner = drawingControl.innerContainer;
    const mapDiv = drawingControl.map && typeof drawingControl.map.getDiv === "function"
      ? drawingControl.map.getDiv()
      : document.getElementById("map");
    const actions = container && container.querySelector(".drawing-control-actions");
    if (!container || !inner || !mapDiv || !actions) return;

    const MARGE_NORMALE = "20px 350px 20px 20px"; // place réservée aux actions à droite
    const ECART_ACTIONS = 50; // margin-left des actions en disposition normale

    const adapter = () => {
      const largeurCarte = mapDiv.clientWidth;
      if (!largeurCarte) return;

      // Largeur naturelle (une seule ligne) de la palette, mesurée sans retour à la ligne.
      inner.style.flexWrap = "nowrap";
      inner.style.maxWidth = "none";
      const largeurPalette = inner.classList.contains("collapsed") ? 0 : inner.scrollWidth;
      actions.style.flexWrap = "nowrap";
      actions.style.maxWidth = "none";
      const largeurActions = actions.scrollWidth;

      // 20px de marge de chaque côté + 28px pour la poignée de masquage.
      const tientSurUneLigne = largeurPalette + 28 + ECART_ACTIONS + largeurActions + 40 <= largeurCarte;
      container.classList.toggle("drawing-control--compact", !tientSurUneLigne);

      if (tientSurUneLigne) {
        container.style.margin = MARGE_NORMALE;
        Object.assign(actions.style, {
          top: "0", bottom: "", left: "100%", transform: "", marginLeft: ECART_ACTIONS + "px",
          justifyContent: "",
        });
      } else {
        const largeurDispo = Math.max(120, largeurCarte - 40 - 28);
        container.style.margin = "20px 48px 20px 20px";
        inner.style.flexWrap = "wrap";
        inner.style.justifyContent = "center";
        inner.style.maxWidth = largeurDispo + "px";
        Object.assign(actions.style, {
          top: "auto", bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)",
          marginLeft: "0", flexWrap: "wrap", justifyContent: "center", maxWidth: largeurDispo + "px",
        });
      }
    };

    container._adapterALaCarte = () => requestAnimationFrame(adapter);
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(container._adapterALaCarte).observe(mapDiv);
    } else {
      window.addEventListener("resize", container._adapterALaCarte);
    }
    // Boutons affichés/masqués selon la typologie ou le parcours après le premier rendu.
    setTimeout(container._adapterALaCarte, 500);
    setTimeout(container._adapterALaCarte, 2000);
    container._adapterALaCarte();
  }

  /**
   * Ré-applique le filtrage "Résidentielle" (boutons + séparateurs orphelins + panneau calepinage +
   * tableaux du résumé non pertinents) à partir de la valeur COURANTE de
   * window.ACTIVE_PROJECT_TYPOLOGIE, sans recréer la palette/les modales. Nécessaire car
   * createControls() et la construction de SummaryModal ne s'exécutent qu'une seule fois au
   * chargement de la page, alors que le projet actif peut changer en cours de session sans
   * rechargement complet (cf. selectAndLoadProject() dans
   * parametreProjetMap/parametreProjetFormManager.js, qui appelle cette fonction — exposée
   * globalement ci-dessous — juste après avoir déterminé la typologie du projet nouvellement actif).
   * Corrige le bug rapporté : après création d'un projet Résidentielle, il fallait recharger la page
   * pour que la palette d'outils reflète correctement la typologie.
   *
   * Utilise une classe CSS (.residential-hidden, injectée ci-dessous) plutôt que de manipuler
   * directement style.display : plusieurs éléments ciblés (boutons, labels) ont déjà un display
   * inline non "block" (flex...) fixé à leur création — écraser puis "annuler" via style.display
   * perdrait cette valeur d'origine (ex. icônes de bouton désaxées). classList.toggle() n'a pas ce
   * problème : retirer la classe restaure exactement l'état précédent, quel qu'il soit.
   */
  static applyResidentialUIFiltering() {
    if (!document.getElementById("residential-hidden-style")) {
      const style = document.createElement("style");
      style.id = "residential-hidden-style";
      style.textContent = ".residential-hidden, .grand-projet-hidden, .map-palette-hidden, .acc-only-hidden { display: none !important; }";
      document.head.appendChild(style);
    }

    const isResidential = window.isResidentialPath();
    const toggle = (el) => { if (el) el.classList.toggle("residential-hidden", isResidential); };

    RESIDENTIAL_HIDDEN_BUTTON_IDS.forEach((id) => toggle(document.getElementById(id)));
    const typologie = String(window.ACTIVE_PROJECT_TYPOLOGIE || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const isGrandProjet = typologie === "grand projet";
    GRAND_PROJET_HIDDEN_BUTTON_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("grand-projet-hidden", isGrandProjet);
    });
    const isAcc = !!(window.AccParticipantsCarte && window.AccParticipantsCarte.estProjetAcc());
    ACC_ONLY_BUTTON_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("acc-only-hidden", !isAcc);
    });
    // Boutons masqués par le parcours (app/utils/parcours.py, liste `masquer`).
    Object.entries(PARCOURS_HIDDEN_BUTTON_IDS).forEach(([cle, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("map-palette-hidden", typeof window.parcoursMasque === "function" && window.parcoursMasque(cle));
    });
    // Toujours masquer les boutons retirés de la palette sur la carte
    MAP_HIDDEN_BUTTON_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("map-palette-hidden");
    });
    document.querySelectorAll(".residential-hide-separator, .residential-hide-section").forEach(toggle);
    toggle(document.querySelector(".form-container"));
    toggle(document.querySelector(".resize-handle"));
    if (typeof window.appliquerParcoursRetour === "function") window.appliquerParcoursRetour();
    // Nombre de boutons visibles changé : recalcul de la disposition de la palette.
    const palette = document.querySelector(".drawing-control");
    if (palette && typeof palette._adapterALaCarte === "function") palette._adapterALaCarte();
  }

  /**
   * Met à jour l'état du bouton de dessin en fonction du niveau de zoom
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {number} zoomLevel - Niveau de zoom actuel
   */
  static updateDrawButtonState(drawingControl, zoomLevel) {
    if (!drawingControl.drawButton) return;

    if (zoomLevel < DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      // Désactiver le bouton de dessin standard
      drawingControl.drawButton.disabled = true;
      drawingControl.drawButton.style.opacity = "0.5";
      drawingControl.drawButton.style.cursor = "not-allowed";
      drawingControl.drawButton.title = `Zoom minimum requis: ${DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`;

      // Désactiver également le bouton Line to Polygon
      if (drawingControl.lineToPolygonButton) {
        drawingControl.lineToPolygonButton.disabled = true;
        drawingControl.lineToPolygonButton.style.opacity = "0.5";
        drawingControl.lineToPolygonButton.style.cursor = "not-allowed";
        drawingControl.lineToPolygonButton.title = `Zoom minimum requis: ${DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`;
      }

      // Désactiver le mode dessin si actif
      if (drawingControl.drawingManager) {
        drawingControl.drawingManager.setDrawingMode(null);
        if (drawingControl.activeButton) {
          drawingControl.activeButton.classList.remove("selected");
          drawingControl.activeButton.style.backgroundColor = "white";
          drawingControl.activeButton = null;
        }
      }

      // Désactiver le mode Line to Polygon si actif
      if (
        drawingControl.lineToPolygon &&
        drawingControl.lineToPolygon.isActive
      ) {
        drawingControl.lineToPolygon.clearTemp();
        drawingControl.lineToPolygon.isActive = false;
        if (drawingControl.lineToPolygon.button) {
          drawingControl.lineToPolygon.button.classList.remove("selected");
          drawingControl.lineToPolygon.button.style.backgroundColor =
            STYLES.DEFAULT_BUTTON.backgroundColor;
        }
        document.body.classList.remove("line-to-polygon-cursor");
        drawingControl.map.setOptions({ draggableCursor: null });
      }
    } else {
      // Réactiver le bouton de dessin standard
      drawingControl.drawButton.disabled = false;
      drawingControl.drawButton.style.opacity = "1";
      drawingControl.drawButton.style.cursor = "pointer";
      drawingControl.drawButton.title =
        "Dessiner une surface de panneaux solaires";

      // Réactiver le bouton Line to Polygon
      if (drawingControl.lineToPolygonButton) {
        drawingControl.lineToPolygonButton.disabled = false;
        drawingControl.lineToPolygonButton.style.opacity = "1";
        drawingControl.lineToPolygonButton.style.cursor = "pointer";
        drawingControl.lineToPolygonButton.title =
          "Créer un polygon depuis une ligne";
      }
    }
  }
  static clearSelection(drawingControl) {
    try {
      // Vue 3D du calepinage résidentiel ouverte : « Supprimer » (bouton ou touche Suppr) ne vise
      // que l'objet 3D sélectionné. Sans ce garde, il supprimait le contour du champ PV sélectionné
      // sur la carte, et avec lui tous ses panneaux (carte + canevas 2D) — bug rapporté.
      const cm = window.CalepinageMaisonIndiv;
      if (cm && typeof cm.is3DViewActive === 'function' && cm.is3DViewActive()) {
        if (typeof cm.supprimerSelection3D === 'function') cm.supprimerSelection3D();
        return;
      }
      if (drawingControl.selectedShape) {
        drawingControl.deleteSelectedShape();
        setTimeout(() => { }, 100);
        return;
      }
      if (drawingControl.lineManager.selectedLine) {
        drawingControl.lineManager.deleteSelectedLine();
        return;
      }
      if (drawingControl.cotationManager && drawingControl.cotationManager.selectedLine) {
        drawingControl.cotationManager.deleteSelectedLine();
        return;
      }
      if (drawingControl.circleManager.selectedCircle) {
        drawingControl.circleManager.deleteSelectedCircle();
        return;
      }
      if (drawingControl.textManager.selectedText) {
        drawingControl.textManager.deleteSelectedText();
        return;
      }
      if (drawingControl.simpleRectangleManager.selectedSimpleRectangle) {
        drawingControl.simpleRectangleManager.deleteSelectedSimpleRectangle();
        return;
      }
      if (drawingControl.simplePolygonManager.selectedSimplePolygon) {
        drawingControl.simplePolygonManager.deleteSelectedSimplePolygon();
        return; // sans ce return, la suppression se poursuivait sur le champ PV ci-dessous
      }
      if (drawingControl.obstacleCircleManager.selectedObstacleCircle) {
        drawingControl.obstacleCircleManager.deleteSelectedObstacleCircle();
        return;
      }
      if (drawingControl.obstacleRectangleManager.selectedObstacleRectangle) {
        drawingControl.obstacleRectangleManager.deleteSelectedObstacleRectangle();
        return;
      }
      if (drawingControl.obstaclePolygonManager.selectedObstaclePolygon) {
        drawingControl.obstaclePolygonManager.deleteSelectedObstaclePolygon();
        return;
      }
      if (drawingControl.obstacleLineManager.selectedObstacleLine) {
        drawingControl.obstacleLineManager.deleteSelectedObstacleLine();
        return;
      }

      // Calepinage résidentiel (toiture maison individuelle) : totalement décorrélé du système de
      // calepinage "grands projets" ci-dessus (cf. polygon_maison.js/MaisonPolygonManager, même
      // principe d'indépendance que la Loi APER) — demande explicite : le bouton "Supprimer"/la
      // touche Suppr de la barre d'outils doit aussi pouvoir supprimer le polygone maison
      // actuellement sélectionné sur la carte. Placé en DERNIER (après toutes les formes
      // "grands projets" ci-dessus) : sur un projet combinant les deux systèmes, une forme
      // "grands projets" activement sélectionnée doit rester prioritaire — MaisonPolygonManager.
      // selected ne reflète que la dernière maison enregistrée/restaurée, pas nécessairement le
      // dernier élément avec lequel l'utilisateur vient d'interagir. Réutilise removePolygon()
      // (retrait carte + persistance localStorage déjà gérés) et synchronise la suppression en base
      // avec le même signal explicitDeletion que le bouton "Supprimer le polygone" du modal (cf.
      // calepinage_maison_formulaires.js).
      // Uniquement si l'utilisateur a choisi ce champ en dernier (selectionActive, cf.
      // polygon_maison.js) : `selected` désigne toujours un champ, même quand l'utilisateur vient de
      // cliquer une forme simple — Suppr supprimait alors un champ PV à la place de la forme.
      // Modal du calepinage ouvert : Suppr y vise ses propres objets (obstacle sélectionné...).
      const maisonMgr = window.MaisonPolygonManagerInstance;
      const modalCalepinageOuvert = !!(cm && cm.modal && cm.modal.style.display !== 'none');
      if (maisonMgr && maisonMgr.selected && maisonMgr.selectionActive && !modalCalepinageOuvert) {
        const poly = maisonMgr.selected;
        maisonMgr.selectionActive = false;
        const maisonId = poly.maisonId;
        maisonMgr.removePolygon(poly);
        if (window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.removeSourceOption === 'function') {
          window.CalepinageMaisonIndiv.removeSourceOption(maisonId);
        }
        if (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.saveToDatabase === 'function') {
          window.CalepinageMaisonPersistenceDB.saveToDatabase({ explicitDeletion: true }).catch(() => {});
        }
      }
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
    }
  }

  /**
   * Réinitialise tous les modes de dessin et d'interaction pour assurer l'exclusion mutuelle
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  static clearAllActiveModes(drawingControl) {
    if (!drawingControl) return;

    // 1. Réinitialiser le gestionnaire de dessin (DrawingManager)
    if (drawingControl.drawingManager) {
      drawingControl.drawingManager.setDrawingMode(null);
    }
    if (drawingControl.terraDrawEngine) {
      drawingControl.terraDrawEngine.stop();
    }

    // 2. Nettoyer les écouteurs spéciaux (Mode Texte)
    if (drawingControl._textClickListener) {
      google.maps.event.removeListener(drawingControl._textClickListener);
      drawingControl._textClickListener = null;
    }

    // 3. Réinitialiser les modes booléens
    drawingControl.isPasteMode = false;
    drawingControl.simpleRectangleMode = false;
    drawingControl.simplePolygonMode = false;
    
    // Nettoyer les flags Sheds et Obstacles (Exclusivité garantie)
    drawingControl.isShedsPolygonModeActive = false;
    drawingControl.nextPolygonShedsCapable = false;
    drawingControl.obstacleMode = null;

    // 4. Désactiver et nettoyer les gestionnaires complexes
    if (drawingControl.lineToPolygon && drawingControl.lineToPolygon.isActive) {
      drawingControl.lineToPolygon.isActive = false;
      if (typeof drawingControl.lineToPolygon.clearTemp === 'function') drawingControl.lineToPolygon.clearTemp();
    }

    // NOUVEAU (tracé rectangle résidentiel à 3 points, cf. polygon_maison.js::startRect3PointDraw) :
    // même principe que lineToPolygon ci-dessus — annule un tracé en cours (overlays temporaires +
    // écouteurs) quand un autre outil est sélectionné, ou sur Échap.
    if (window.MaisonPolygonManagerInstance && window.MaisonPolygonManagerInstance.isRectDrawActive) {
      window.MaisonPolygonManagerInstance.cancelRectDraw();
    }
    // Copier-coller d'un champ PV armé (bouton copy-paste-button) : même principe.
    if (window.MaisonPolygonManagerInstance && typeof window.MaisonPolygonManagerInstance.annulerCollage === 'function') {
      window.MaisonPolygonManagerInstance.annulerCollage();
    }

    if (drawingControl.polygon && drawingControl.polygon.isActive) {
      drawingControl.polygon.isActive = false;
    }

    if (drawingControl.solarRectangle && drawingControl.solarRectangle.isActive) {
      drawingControl.solarRectangle.isActive = false;
      if (typeof drawingControl.solarRectangle.clearTemp === 'function') drawingControl.solarRectangle.clearTemp();
    }

    // CORRECTIF (bouton shed "sélectionné par défaut"/désynchronisé) : contrairement à lineToPolygon/
    // polygon/solarRectangle ci-dessus, shedPolygon.isActive n'était jamais réinitialisé ici — son
    // propre toggleMode() se basant sur ce flag (pas sur drawingControl.activeButton, remis à null
    // plus bas), un 1er dessin laissait isActive bloqué à true alors que le bouton perdait déjà sa
    // classe "selected" (cf. finishDrawingSession) : le clic suivant appelait alors deactivate() au
    // lieu d'activate(), désynchronisant durablement l'état visuel du bouton et l'état réel de l'outil.
    if (drawingControl.shedPolygon && drawingControl.shedPolygon.isActive) {
      drawingControl.shedPolygon.isActive = false;
    }

    if (drawingControl.obstacleLineManager && drawingControl.obstacleLineManager.isActive) {
      if (typeof drawingControl.obstacleLineManager.stopCustomDrawing === 'function') drawingControl.obstacleLineManager.stopCustomDrawing();
    }

    // Désactiver Matériel Électrique
    if (drawingControl.localisationMatElec && drawingControl.localisationMatElec.isActive) {
      drawingControl.localisationMatElec.stopMode();
    }

    // Désactiver le mode de placement de marqueur de coordonnées
    if (drawingControl.geocodingMarkerManager && drawingControl.geocodingMarkerManager.isActive) {
      drawingControl.geocodingMarkerManager.stopMode();
    }

    // Sélection de parcelles cadastrales (bouton de décalage, cf. DecalageParcelles.js)
    DecalageParcelles.arreter();

    // Désactiver le mode de dessin des polygones Loi APER (surfaces + / exclusions -). Le tracé passe
    // désormais par le moteur Terra Draw partagé (modes 'aper-surface'/'aper-exclusion', cf.
    // polygone_aper.js) — déjà arrêté génériquement par drawingControl.terraDrawEngine.stop() plus
    // haut, quel que soit l'outil actif. Il ne reste donc qu'à réinitialiser l'état copier/coller
    // propre à ce gestionnaire, pour éviter qu'il ne reste actif en même temps qu'un autre outil.
    if (window.calculateurAPERInstance && window.calculateurAPERInstance.polygonManager) {
      const aperMgr = window.calculateurAPERInstance.polygonManager;
      aperMgr.isCopying = false;
      aperMgr.copyBuffer = null;
    }

    // Même principe pour le calepinage résidentiel (cf. polygon_maison.js) : le tracé passe
    // désormais par le moteur Terra Draw partagé (mode 'maison-polygon', cf. TerraDrawEngine.js) —
    // déjà arrêté génériquement par drawingControl.terraDrawEngine.stop() plus haut, quel que soit
    // l'outil actif. Rien de spécifique à réinitialiser ici (plus de DrawingManager dédié).

    // 5. Réinitialiser le curseur de la carte et le bouton actif
    if (drawingControl.map) {
      drawingControl.map.setOptions({ draggableCursor: null });
    }
    drawingControl.activeButton = null;

    // 6. Mise à jour visuelle : retirer la classe .selected de tous les boutons de dessin
    const buttonsToReset = [
      drawingControl.drawButton,
      drawingControl.lineButton,
      drawingControl.circleButton,
      drawingControl.textButton,
      drawingControl.copyButton,
      drawingControl.lineToPolygonButton,
      drawingControl.simpleRectangleButton,
      drawingControl.simplePolygonButton,
      document.getElementById('draw-polygon-button'),
      document.getElementById('draw-polygon-sheds-button'), // Manquait à l'appel
      document.getElementById('draw-obstacle-button'),
      document.getElementById('draw-simple-shapes-button'),
      document.getElementById('draw-cotation-line-button'),
      document.getElementById('draw-polygone-aper-tools-button'),
      document.getElementById('draw-maison-polygon-button'),
      document.getElementById('draw-maison-polyline-button'),
      document.getElementById('decalage-button'),
      document.getElementById('mat-elec-button'),
      document.getElementById('geocoding-marker-button')
    ];

    buttonsToReset.forEach(btn => {
      if (btn) {
        btn.classList.remove('selected');
        if (btn.dataset.colorLocked !== "true") {
          btn.style.backgroundColor = STYLES?.DEFAULT_BUTTON?.backgroundColor || 'white';
        }
      }
    });

    // 7. Cas particulier : Fermer le sous-menu d'obstacles s'il est ouvert
    const obstacleMenu = document.getElementById('obstacle-submenu');
    if (obstacleMenu) {
      obstacleMenu.remove();
    }
    if (drawingControl._closeObstacleMenuListener) {
      document.removeEventListener('click', drawingControl._closeObstacleMenuListener);
      drawingControl._closeObstacleMenuListener = null;
    }

    // Fermer le sous-menu matériel électrique
    const matElecMenu = document.getElementById('mat-elec-submenu');
    if (matElecMenu) matElecMenu.remove();
    if (drawingControl._closeMatElecMenuListener) {
      document.removeEventListener('click', drawingControl._closeMatElecMenuListener);
      drawingControl._closeMatElecMenuListener = null;
    }

    // Fermer le sous-menu des outils de tracé Loi APER
    const polygoneAperMenu = document.getElementById('polygone-aper-submenu');
    if (polygoneAperMenu) polygoneAperMenu.remove();
    if (drawingControl._closePolygoneAperMenuListener) {
      document.removeEventListener('click', drawingControl._closePolygoneAperMenuListener);
      drawingControl._closePolygoneAperMenuListener = null;
    }

      // NOUVEAU: Réinitialiser l'UI du support PV
      ButtonControl.updateSupportPvUI(null);
  }

    /**
     * Met à jour dynamiquement l'état des options de support des panneaux
     * @param {string|null} toolType - Type d'outil actif ('line-to-polygon', 'polygon', 'polygon-sheds' ou null)
     */
    static updateSupportPvUI(toolType) {
      const supportInclineInputs = document.querySelectorAll('input[id^="supportIncline"]');
      
      supportInclineInputs.forEach((inclineInput) => {
        const suffix = inclineInput.id.substring('supportIncline'.length);
        const platInput = document.getElementById('supportPlat' + suffix);
        const shedInput = document.getElementById('supportShed' + suffix);
        const inclineLabel = document.getElementById('supportInclineLabel' + suffix);
        const platLabel = document.getElementById('supportPlatLabel' + suffix);
        const shedLabel = document.getElementById('supportShedLabel' + suffix);
        
        // Sélecteurs pour le Mode de Pose (adaptez les sélecteurs selon vos vrais IDs HTML si besoin)
        const portraitInput = document.getElementById('portrait' + suffix) || document.querySelector(`input[name="modePose${suffix}"][value="portrait"]`);
        const paysageInput = document.getElementById('paysage' + suffix) || document.querySelector(`input[name="modePose${suffix}"][value="paysage"]`);
        const portraitLabel = portraitInput ? document.querySelector(`label[for="${portraitInput.id}"]`) : null;
        const paysageLabel = paysageInput ? document.querySelector(`label[for="${paysageInput.id}"]`) : null;

        if (!platInput || !shedInput) return;

        // NOUVEAU : Ne modifier QUE le template de base pour ne pas écraser les formes déjà dessinées
        if (suffix !== '') return;

        if (toolType === 'line-to-polygon') {
          platInput.disabled = true;
          shedInput.disabled = true;
          inclineInput.disabled = false;
          inclineInput.checked = true;
          if (platLabel) { platLabel.style.opacity = '0.5'; platLabel.style.cursor = 'not-allowed'; }
          if (shedLabel) { shedLabel.style.opacity = '0.5'; shedLabel.style.cursor = 'not-allowed'; }
          if (inclineLabel) { inclineLabel.style.opacity = '1'; inclineLabel.style.cursor = 'pointer'; }
          inclineInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (toolType === 'polygon') {
          inclineInput.disabled = true;
          shedInput.disabled = true;
          platInput.disabled = false;
          platInput.checked = true;
          if (inclineLabel) { inclineLabel.style.opacity = '0.5'; inclineLabel.style.cursor = 'not-allowed'; }
          if (shedLabel) { shedLabel.style.opacity = '0.5'; shedLabel.style.cursor = 'not-allowed'; }
          if (platLabel) { platLabel.style.opacity = '1'; platLabel.style.cursor = 'pointer'; }
          platInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (toolType === 'polygon-sheds') {
          inclineInput.disabled = true;
          platInput.disabled = true;
          shedInput.disabled = false;
          shedInput.checked = true;
          if (inclineLabel) { inclineLabel.style.opacity = '0.5'; inclineLabel.style.cursor = 'not-allowed'; }
          if (platLabel) { platLabel.style.opacity = '0.5'; platLabel.style.cursor = 'not-allowed'; }
          if (shedLabel) { shedLabel.style.opacity = '1'; shedLabel.style.cursor = 'pointer'; }
          shedInput.dispatchEvent(new Event('change', { bubbles: true }));

          // Portrait par défaut pour Shed, mais Paysage reste sélectionnable (la logique de largeur
          // projetée s'adapte dynamiquement au mode choisi, cf. getPanelConfigFromForm).
          if (portraitInput) {
            portraitInput.checked = true;
            portraitInput.dispatchEvent(new Event('change', { bubbles: true }));
            if (portraitLabel) { portraitLabel.style.opacity = '1'; portraitLabel.style.cursor = 'pointer'; }
          }
          if (paysageInput) {
            paysageInput.disabled = false;
            if (paysageLabel) { paysageLabel.style.opacity = '1'; paysageLabel.style.cursor = 'pointer'; }
          }
        } else {
            inclineInput.disabled = false;
            platInput.disabled = false;
            shedInput.disabled = false;
            if (inclineLabel) { inclineLabel.style.opacity = '1'; inclineLabel.style.cursor = 'pointer'; }
            if (platLabel) { platLabel.style.opacity = '1'; platLabel.style.cursor = 'pointer'; }
            if (shedLabel) { shedLabel.style.opacity = '1'; shedLabel.style.cursor = 'pointer'; }

            // CORRECTIF (demande explicite : "Le label Calepinage shed est sélectionné par défaut, je
            // ne parviens pas à le désélectionner") : ce sont des <input type="radio"> — un radio coché
            // ne peut JAMAIS être décoché par un simple clic dessus (seul le choix d'un autre bouton du
            // même groupe, ou une action JS explicite, le peut). Les branches 'line-to-polygon'/
            // 'polygon'/'polygon-sheds' ci-dessus cochent un input à l'activation d'un outil, mais rien
            // ne le décochait jamais à la désactivation (toolType=null, ex: clearAllActiveModes) — le
            // dernier outil utilisé restait donc coché indéfiniment, sans aucun moyen pour
            // l'utilisateur de revenir à "aucun sélectionné" depuis l'interface.
            inclineInput.checked = false;
            platInput.checked = false;
            shedInput.checked = false;

            // Réactiver le mode Paysage (utile pour Toiture Terrasse / Support Plat)
            if (paysageInput) {
              paysageInput.disabled = false;
              if (paysageLabel) { paysageLabel.style.opacity = '1'; paysageLabel.style.cursor = 'pointer'; }
            }
        }
      });
    }

  static toggleSimpleShapesMenu(button, drawingControl) {
    // Vérifier si le menu existe déjà : un clic sur le bouton principal le referme
    let menu = document.getElementById('simple-shapes-submenu');

    if (menu) {
      menu.remove();
      button.classList.remove('selected');
      button.style.backgroundColor = 'white';
      return;
    }

    // Créer le sous-menu. Il reste ouvert pour enchaîner plusieurs tracés (comme la palette Loi
    // APER) : plus de fermeture au clic ailleurs ni après le choix d'une forme.
    menu = document.createElement('div');
    menu.id = 'simple-shapes-submenu';
    menu.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 0;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      z-index: 1001;
    `;
    // Le menu est un enfant du bouton principal : un clic dans ses marges ne doit pas le refermer.
    menu.addEventListener('click', (e) => e.stopPropagation());

    const makeSubButton = (icon, title) => {
      const subButton = document.createElement('button');
      subButton.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/${icon}.svg" alt="${title}" style="height: 20px; width: 20px;">`;
      subButton.title = title;
      subButton.style.cssText = `
        background-color: white;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.3s;
        width: 32px;
        height: 32px;
      `;
      subButton.addEventListener('mouseenter', () => {
        subButton.style.backgroundColor = '#f0f0f0';
      });
      subButton.addEventListener('mouseleave', () => {
        subButton.style.backgroundColor = 'white';
      });
      return subButton;
    };

    // Créer les boutons pour les formes simples
    const shapes = [
      { icon: 'text', title: 'Ajouter un texte', action: () => drawingControl.toggleDrawingMode(button, "text") },
      { icon: 'line', title: 'Dessiner une ligne', action: () => drawingControl.toggleSimpleLineMode(button) },
      { icon: 'cotation-line', title: 'Tracer une ligne de cotation', action: () => drawingControl.toggleCotationMode(button) },
      { icon: 'circle', title: 'Dessiner un cercle', action: () => drawingControl.toggleSimpleCircleMode(button) },
      { icon: 'rectangle', title: 'Dessiner un rectangle simple', action: () => drawingControl.toggleSimpleRectangleMode(button) },
      { icon: 'polygon', title: 'Dessiner un polygone simple', action: () => drawingControl.toggleSimplePolygonMode(button) }
    ];

    shapes.forEach(shapeDef => {
      const subButton = makeSubButton(shapeDef.icon, shapeDef.title);

      subButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Bloque la propagation vers le bouton parent

        // Par sécurité, s'assurer que tout autre mode est inactif avant de dessiner
        ButtonControl.clearAllActiveModes(drawingControl);

        // Activer le mode dessin pour la forme choisie (le menu reste ouvert)
        shapeDef.action();

        drawingControl.activeButton = button;
        button.classList.add('selected');
        button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
      });

      menu.appendChild(subButton);
    });

    // Afficher / masquer les étiquettes (surface, longueur, diamètre) des formes simples. Les lignes
    // de cotation gardent leur valeur. N'interrompt pas un tracé en cours.
    const separator = document.createElement('div');
    separator.style.cssText = 'width: 1px; height: 22px; background: #ddd; margin: 0 2px;';
    menu.appendChild(separator);

    const labelsTitle = (visible) => visible
      ? 'Masquer les étiquettes des formes simples'
      : 'Afficher les étiquettes des formes simples';
    const labelsIcon = (visible) => visible ? 'eye-slash-svgrepo-com' : 'eyes-map';
    const labelsVisible = drawingControl.simpleShapeLabelsVisible !== false;
    const labelsButton = makeSubButton(labelsIcon(labelsVisible), labelsTitle(labelsVisible));
    labelsButton.id = 'toggle-simple-shape-labels-button';
    labelsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = drawingControl.toggleSimpleShapeLabels();
      labelsButton.title = labelsTitle(visible);
      const img = labelsButton.querySelector('img');
      img.src = `/static/concevoir_mon_projet/medias/icons/${labelsIcon(visible)}.svg`;
      img.alt = labelsTitle(visible);
    });
    menu.appendChild(labelsButton);

    // Positionner le menu par rapport au bouton
    button.style.position = 'relative';
    button.appendChild(menu);
    button.classList.add('selected');
    button.style.backgroundColor = '#e0e0e0';
  }

  static toggleObstacleMenu(button, drawingControl) {
    // Vérifier si le menu existe déjà
    let menu = document.getElementById('obstacle-submenu');

    if (menu) {
      // Si le menu existe, le supprimer
      menu.remove();
      button.classList.remove('selected');
      button.style.backgroundColor = 'white';
      if (drawingControl._closeObstacleMenuListener) {
        document.removeEventListener('click', drawingControl._closeObstacleMenuListener);
        drawingControl._closeObstacleMenuListener = null;
      }
      return;
    }

    // Créer le sous-menu
    menu = document.createElement('div');
    menu.id = 'obstacle-submenu';
    menu.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 0;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      gap: 4px;
      padding: 4px;
      z-index: 1001;
    `;

    // Définir la fonction de fermeture de manière accessible
    const closeMenu = (e) => {
      if (!button.contains(e.target)) {
        if (menu.parentNode) menu.remove();
        button.classList.remove('selected');
        button.style.backgroundColor = 'white';
        document.removeEventListener('click', closeMenu);
        drawingControl._closeObstacleMenuListener = null;
      }
    };
    drawingControl._closeObstacleMenuListener = closeMenu;

    // Créer les quatre boutons
    const obstacles = [
      { icon: 'circle', title: 'Obstacle circulaire' },
      { icon: 'rectangle', title: 'Obstacle rectangulaire' },
      { icon: 'polygon', title: 'Obstacle polygonal' },
      { icon: 'line', title: 'Obstacle ligne' }
    ];

    obstacles.forEach(obs => {
      const subButton = document.createElement('button');
      subButton.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/${obs.icon}.svg" alt="${obs.title}" style="height: 20px; width: 20px;">`;
      subButton.title = obs.title;
      subButton.style.cssText = `
        background-color: white;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.3s;
        width: 32px;
        height: 32px;
      `;

      subButton.addEventListener('mouseenter', () => {
        subButton.style.backgroundColor = '#f0f0f0';
      });

      subButton.addEventListener('mouseleave', () => {
        subButton.style.backgroundColor = 'white';
      });

      subButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Bloque la propagation vers le bouton parent
        
        document.removeEventListener('click', closeMenu);
        drawingControl._closeObstacleMenuListener = null;

        // Par sécurité, s'assurer que tout autre mode est inactif avant de dessiner un obstacle
        ButtonControl.clearAllActiveModes(drawingControl);

        // Activer le mode dessin pour l'obstacle choisi
        drawingControl.obstacleMode = obs.icon;

        // Le tracé passe par Terra Draw (remplace google.maps.drawing.DrawingManager, en fin de
        // vie) — la complétion appelle directement la même méthode handleObstacle*Complete
        // qu'auparavant, inchangée (elle acceptait déjà une forme google.maps.* native générique).
        const finishObstacleDrawing = () => {
          drawingControl.obstacleMode = null;
          drawingControl.finishDrawingSession();
        };

        if (obs.icon === 'circle') {
          drawingControl.terraDrawEngine.start('obstacle-circle', (circle) => {
            drawingControl.obstacleCircleManager.handleObstacleCircleComplete(circle);
            finishObstacleDrawing();
          });
        } else if (obs.icon === 'rectangle') {
          drawingControl.terraDrawEngine.start('obstacle-rectangle', (rectangle) => {
            drawingControl.obstacleRectangleManager.handleObstacleRectangleComplete(rectangle);
            finishObstacleDrawing();
          });
        } else if (obs.icon === 'polygon') {
          drawingControl.terraDrawEngine.start('obstacle-polygon', (polygon) => {
            drawingControl.obstaclePolygonManager.handleObstaclePolygonComplete(polygon);
            finishObstacleDrawing();
          });
        } else if (obs.icon === 'line') {
          // Utiliser le mode de dessin personnalisé pour les obstacles lignes (limité à 2 points) —
          // déjà indépendant de google.maps.drawing, aucun changement nécessaire.
          drawingControl.obstacleLineManager.startCustomDrawing();
        }

        // Fermer le menu et réinitialiser le bouton principal
        if (menu.parentNode) menu.remove();

        // Indiquer visuellement que l'outil obstacle principal est actif
        drawingControl.activeButton = button;
        button.classList.add('selected');
        button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
      });

      menu.appendChild(subButton);
    });

    // Positionner le menu par rapport au bouton
    button.style.position = 'relative';
    button.appendChild(menu);
    button.classList.add('selected');
    button.style.backgroundColor = '#e0e0e0';

    // Fermer le menu si on clique ailleurs
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  static toggleMatElecMenu(button, drawingControl) {
    let menu = document.getElementById('mat-elec-submenu');

    if (menu) {
      menu.remove();
      button.classList.remove('selected');
      button.style.backgroundColor = 'white';
      if (drawingControl._closeMatElecMenuListener) {
        document.removeEventListener('click', drawingControl._closeMatElecMenuListener);
        drawingControl._closeMatElecMenuListener = null;
      }
      return;
    }

    menu = document.createElement('div');
    menu.id = 'mat-elec-submenu';
    menu.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 0;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: row;
      gap: 4px;
      padding: 4px;
      z-index: 1001;
    `;

    // Le menu reste ouvert tant qu'on ne reclique pas volontairement sur le bouton principal Matériels électriques

    const items = [
      { id: 'IRVE', title: 'Borne IRVE', icon: '🚗', color: '#1E8449' },
      { id: 'PDL', title: 'PDL', icon: '⚡', color: '#FDE047' },
      { id: 'TGBT_Batiment', title: 'TGBT Bâtiment', icon: '⚡', color: '#EF4444' },
      { id: 'TGBT_PV', title: 'TGBT PV', icon: '⚡', color: '#EAB308' },
      { id: 'TGBT_IRVE', title: 'TGBT IRVE', icon: '⚡', color: '#3B82F6' },
      { id: 'TGBT_PV_IRVE', title: 'TGBT PV & IRVE', icon: '⚡', color: '#8B5CF6' },
      { id: 'Poste_Soutirage', title: 'Poste Soutirage', icon: '⚡', color: '#F97316' },
      { id: 'Poste_Production', title: 'Poste Production', icon: '⚡', color: '#10B981' },
      { id: 'CABLE', title: 'Tracer Câble', icon: '〰️', color: '#9CA3AF' },
      { id: 'separator' },
      { id: 'TOGGLE_IRVE', title: 'Afficher/Masquer IRVE', icon: '👁️🚗', color: '#333' },
      { id: 'TOGGLE_ORGANES', title: 'Afficher/Masquer Organes', icon: '👁️⚡', color: '#333' },
      { id: 'TOGGLE_CABLES', title: 'Afficher/Masquer Câbles', icon: '👁️〰️', color: '#333' },
      { id: 'TOGGLE_LABELS', title: 'Afficher/Masquer Labels', icon: '🏷️', color: '#333' }
    ];

    items.forEach(item => {
      if (item.id === 'separator') {
        const sep = document.createElement('div');
        sep.style.cssText = 'width: 2px; background-color: #ccc; margin: 0 4px; border-radius: 1px;';
        menu.appendChild(sep);
        return;
      }

      const subButton = document.createElement('button');
      subButton.title = item.title;
      
      if (item.id.startsWith('TGBT') || item.id.startsWith('Poste')) {
        subButton.innerHTML = `<div style="width: 14px; height: 14px; background-color: ${item.color}; border: 1px solid #999; border-radius: 2px;"></div>`;
      } else {
        subButton.innerHTML = `<span style="color:${item.color}; font-size:16px;">${item.icon}</span>`;
      }
      
      subButton.style.cssText = `
        background-color: white;
        border: 1px solid #eee;
        cursor: pointer;
        padding: 6px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.3s;
        width: 32px;
        height: 32px;
      `;

      subButton.addEventListener('mouseenter', () => subButton.style.backgroundColor = '#f0f0f0');
      subButton.addEventListener('mouseleave', () => subButton.style.backgroundColor = 'white');

      subButton.addEventListener('click', (e) => {
        e.stopPropagation();

        if (item.id.startsWith('TOGGLE_')) {
          drawingControl.localisationMatElec.toggleVisibility(item.id);
          return;
        }

        // On détache le menu temporairement pour le protéger de la purge de clearAllActiveModes
        menu.remove();
        
        ButtonControl.clearAllActiveModes(drawingControl);
        
        // On le rattache immédiatement
        button.appendChild(menu);
        drawingControl.localisationMatElec.startMode(item.id);
        drawingControl.activeButton = button;
        button.classList.add('selected');
        button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
      });
      menu.appendChild(subButton);
    });

    button.style.position = 'relative';
    button.appendChild(menu);
    button.classList.add('selected');
    button.style.backgroundColor = '#e0e0e0';
  }

  /**
   * Ouvre l'éditeur de schéma unifilaire dans une iframe plein écran, sur le même principe que
   * geometrieModal.js (Ombrière métal) : le contenu (en-tête, styles, positionnement du modal) est
   * entièrement géré par la page chargée dans l'iframe (schema_unifilaire.html) — le conteneur créé
   * ici n'est qu'un cadre transparent plein écran, sans second arrière-plan ni second en-tête.
   * Fermeture pilotée par modal_header_unified.html via postMessage({action:'closeModal'}).
   */
  static openSchemaUnifilaireModal() {
    let container = document.getElementById('schema-unifilaire-modal-container');
    if (container) {
      container.style.display = 'flex';
      return;
    }

    container = document.createElement('div');
    container.id = 'schema-unifilaire-modal-container';
    // CORRECTIF (demande explicite : "le modal ouvre par-dessous du modal calepinage — passez-le en
    // avant") : z-index 9999 restait bien en-dessous du modal de calepinage résidentiel
    // (#calepinageMaisonModal, z-index:999998, cf. calepinage_maison_formulaires.js::createModal) —
    // ce dernier s'ouvre désormais un point d'entrée schéma unifilaire DANS son propre menu
    // horizontal (cf. cmOpenSchemaUnifilaireBtn), rendant ce chevauchement visible en pratique.
    container.style.cssText = `
      display: flex;
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      z-index: 1000000;
    `;

    const iframe = document.createElement('iframe');
    iframe.id = 'schema-unifilaire-modal-iframe';
    iframe.src = '/concevoir_mon_projet/modal/schema_unifilaire';
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    container.appendChild(iframe);
    document.body.appendChild(container);

    if (!window._schemaUnifilaireCloseListenerAttached) {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.action === 'closeModal') {
          const c = document.getElementById('schema-unifilaire-modal-container');
          if (c) c.style.display = 'none';
        }
      });
      window._schemaUnifilaireCloseListenerAttached = true;
    }
  }

  /**
   * Sous-menu des outils de tracé Loi APER (surfaces + / exclusions -), rattaché à l'icône
   * pencil-square. Reste ouvert (bouton actif) après chaque sélection — demande explicite : l'utilisateur
   * doit recliquer sur l'icône pour le refermer, afin de pouvoir enchaîner plusieurs actions (dessiner
   * plusieurs surfaces/exclusions, masquer, copier...) sans rouvrir la palette à chaque fois. Le risque
   * de blocage des interactions sous-jacentes (sélection/déplacement de polygones existants) est traité
   * séparément (cf. AperPolygonManager._isOtherDrawingModeActive / annulation du mode de dessin résiduel
   * au clic sur une forme existante, dans polygone_aper.js).
   * @param {HTMLElement} button - Bouton icône ayant déclenché l'ouverture
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  static togglePolygoneAperMenu(button, drawingControl) {
    let menu = document.getElementById('polygone-aper-submenu');

    if (menu) {
      menu.remove();
      button.classList.remove('selected');
      button.style.backgroundColor = 'white';
      return;
    }

    const getPolygonManager = () => {
      if (window.calculateurAPERInstance && typeof window.calculateurAPERInstance.ensurePolygonManager === 'function') {
        return window.calculateurAPERInstance.ensurePolygonManager();
      }
      return null;
    };

    menu = document.createElement('div');
    menu.id = 'polygone-aper-submenu';
    menu.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 0;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 6px;
      padding: 8px;
      z-index: 1001;
      width: 260px;
      box-sizing: border-box;
    `;

    const tools = [
      { label: '+ Surface', bg: '#4CAF50', color: '#fff', run: (mgr) => mgr.startDrawSurface() },
      { label: '- Exclusion', bg: '#f44336', color: '#fff', run: (mgr) => mgr.startDrawExclusion() },
      { label: 'Copier', bg: '#f5f5f5', color: '#333', run: (mgr) => mgr.startCopySelected() },
      { label: 'Supprimer', bg: '#f5f5f5', color: '#333', run: (mgr) => mgr.deleteSelected() },
      { label: 'Masquer surface', bg: '#f5f5f5', color: '#333', run: (mgr) => mgr.toggleVisibility('surface') },
      { label: 'Masquer exclusion', bg: '#f5f5f5', color: '#333', run: (mgr) => mgr.toggleVisibility('exclusion') },
    ];

    tools.forEach((tool) => {
      const subButton = document.createElement('button');
      subButton.textContent = tool.label;
      subButton.title = tool.label;
      subButton.style.cssText = `
        background-color: ${tool.bg};
        color: ${tool.color};
        border: ${tool.bg === '#f5f5f5' ? '1px solid #ddd' : 'none'};
        cursor: pointer;
        padding: 6px 4px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        white-space: normal;
        line-height: 1.2;
        width: 100%;
        box-sizing: border-box;
        transition: filter 0.2s;
      `;
      subButton.addEventListener('mouseenter', () => { subButton.style.filter = 'brightness(0.92)'; });
      subButton.addEventListener('mouseleave', () => { subButton.style.filter = 'none'; });

      subButton.addEventListener('click', (e) => {
        e.stopPropagation();

        const mgr = getPolygonManager();
        if (!mgr) {
          if (drawingControl.errorModal) drawingControl.errorModal.show("La carte n'est pas encore prête. Veuillez réessayer.");
          return;
        }

        // On détache le menu temporairement pour le protéger de la purge de clearAllActiveModes,
        // puis on le rattache : il reste ouvert (bouton actif) pour enchaîner plusieurs actions APER,
        // jusqu'à un clic explicite sur l'icône pour le refermer.
        menu.remove();
        ButtonControl.clearAllActiveModes(drawingControl);
        button.appendChild(menu);

        tool.run(mgr);

        drawingControl.activeButton = button;
        button.classList.add('selected');
        button.style.backgroundColor = STYLES?.SELECTED_BUTTON?.backgroundColor || '#e0e0e0';
      });

      menu.appendChild(subButton);
    });

    button.style.position = 'relative';
    button.appendChild(menu);
    button.classList.add('selected');
    button.style.backgroundColor = '#e0e0e0';
  }

  static registerDeleteShortcut(drawingControl) {
    if (!drawingControl || drawingControl.__deleteShortcutRegistered) return;
    const handler = (event) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isEditable = document.activeElement?.isContentEditable;
      const isInputContext = ["input", "textarea", "select"].includes(activeTag) || isEditable;
      if (event.key === "Delete" && !isInputContext) {
        event.preventDefault();
        ButtonControl.clearSelection(drawingControl);
      } else if (event.key === "Escape" && !isInputContext) {
        event.preventDefault();
        ButtonControl.clearAllActiveModes(drawingControl);
        if (typeof drawingControl.clearSelection === 'function') {
          drawingControl.clearSelection();
        }
      }
    };
    document.addEventListener("keydown", handler);
    drawingControl.__deleteShortcutRegistered = true;
    drawingControl.__deleteShortcutHandler = handler;
  }
}

// Exposée globalement pour parametreProjetMap/parametreProjetFormManager.js (script classique, pas
// un module ES) : appelée depuis selectAndLoadProject() juste après avoir déterminé la typologie
// du projet nouvellement actif, pour rafraîchir la palette sans recharger la page.
window.applyResidentialUIFiltering = ButtonControl.applyResidentialUIFiltering;
