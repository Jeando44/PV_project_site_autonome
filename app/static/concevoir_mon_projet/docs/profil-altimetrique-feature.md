# Plan de Tâches - Fonctionnalité Profil Altimétrique

## Vue d'ensemble
Implémentation d'un système de création et visualisation de profils altimétriques basé sur l'API IGN Géoportail.

**Objectif** : Permettre aux utilisateurs de dessiner des lignes sur la carte pour obtenir un profil altimétrique avec visualisation graphique et gestion de l'historique.

---

## Phase 1 : Architecture et Structure de Base

### 1.1 Créer la structure de dossiers
- [ ] Créer le dossier `components/ProfilAltimetrique/`
- [ ] Créer les sous-dossiers :
  - [ ] `core/` - Logique métier
  - [ ] `handlers/` - Gestionnaires d'événements
  - [ ] `utils/` - Fonctions utilitaires
  - [ ] `services/` - Services API
- [ ] Créer `constants.js` pour les constantes du module
- [ ] Créer `index.js` comme point d'entrée

**Fichiers à créer** :
```
components/ProfilAltimetrique/
├── constants.js
├── index.js
├── core/
│   ├── ProfilAltimetriqueControl.js
│   └── ProfilAltimetriqueManager.js
├── handlers/
│   ├── DrawingHandler.js
│   └── ChartHandler.js
├── utils/
│   ├── GeometryUtils.js
│   ├── CalculationUtils.js
│   └── DOMUtils.js
└── services/
    └── AltimetrieAPIService.js
```

### 1.2 Définir les constantes
- [ ] Définir les constantes de l'API IGN dans `constants.js`
  - [ ] URL de base de l'API
  - [ ] Paramètres par défaut (resource, delimiter, sampling, etc.)
  - [ ] Valeurs min/max pour le sampling (2-5000)
- [ ] Définir les événements personnalisés (CustomEvents)
  - [ ] `PROFIL_DRAWING_STARTED`
  - [ ] `PROFIL_POINT_ADDED`
  - [ ] `PROFIL_DRAWING_COMPLETED`
  - [ ] `PROFIL_DATA_LOADED`
  - [ ] `PROFIL_SAVED`
  - [ ] `PROFIL_SELECTED`
  - [ ] `PROFIL_EXPORTED`
- [ ] Définir les constantes de style pour les lignes de dessin
- [ ] Définir les constantes pour le localStorage (clés)
- [ ] Définir les constantes de nommage
  - [ ] Préfixe par défaut : "Alti-PV"
  - [ ] Format du nom : `${PREFIX}${number}`
  - [ ] Longueur max du nom personnalisé : 50 caractères

---

## Phase 2 : Service API et Utilitaires

### 2.1 Service API Altimétrie (`services/AltimetrieAPIService.js`)
- [ ] Créer la classe `AltimetrieAPIService` avec méthodes statiques
- [ ] Implémenter `getElevationLine(coordinates, options)`
  - [ ] Valider les coordonnées (min 2 points)
  - [ ] Construire l'URL avec paramètres
  - [ ] Gérer les paramètres `lon`, `lat`, `delimiter`, `sampling`
  - [ ] Gérer `profile_mode` (simple/accurate)
  - [ ] Effectuer la requête fetch
  - [ ] Gérer les erreurs HTTP
  - [ ] Parser et valider la réponse JSON
  - [ ] Retourner les données formatées
- [ ] Ajouter gestion d'erreurs avec try/catch
- [ ] Ajouter validation du nombre de points (max 5000)

**Tests unitaires 2.1** :
- [ ] Test : Construction correcte de l'URL avec 2 points
- [ ] Test : Construction correcte de l'URL avec multiples points
- [ ] Test : Validation du nombre de points (rejet si > 5000)
- [ ] Test : Gestion erreur 404
- [ ] Test : Gestion erreur 500
- [ ] Test : Parsing correct de la réponse JSON
- [ ] Test : Validation des données retournées

### 2.2 Utilitaires de Calcul (`utils/CalculationUtils.js`)
- [ ] Créer la classe `CalculationUtils` avec méthodes statiques
- [ ] Implémenter `calculateDistance(point1, point2)`
  - [ ] Utiliser la formule de Haversine
  - [ ] Retourner la distance en mètres
- [ ] Implémenter `calculateTotalDistance(elevations)`
  - [ ] Calculer la distance cumulative entre tous les points
- [ ] Implémenter `calculateSlope(elevation1, elevation2, distance)`
  - [ ] Calculer la pente en pourcentage
- [ ] Implémenter `calculateAverageSlope(elevations, totalDistance)`
- [ ] Implémenter `calculateMaxSlope(elevations)`
- [ ] Implémenter `calculatePositiveElevationGain(elevations)`
- [ ] Implémenter `calculateNegativeElevationGain(elevations)`
- [ ] Implémenter `formatProfileData(apiResponse)`
  - [ ] Transformer les données API en format chart
  - [ ] Calculer toutes les métriques (distance, pentes, dénivelés)
  - [ ] Retourner un objet complet avec toutes les statistiques

**Tests unitaires 2.2** :
- [ ] Test : Calcul de distance Haversine entre 2 points connus
- [ ] Test : Calcul de distance totale avec 3+ points
- [ ] Test : Calcul de pente simple (montée)
- [ ] Test : Calcul de pente simple (descente)
- [ ] Test : Calcul de pente moyenne
- [ ] Test : Calcul de pente maximale
- [ ] Test : Calcul de dénivelé positif
- [ ] Test : Calcul de dénivelé négatif
- [ ] Test : Formatage complet des données API

### 2.3 Utilitaires de Géométrie (`utils/GeometryUtils.js`)
- [ ] Créer la classe `GeometryUtils`
- [ ] Implémenter `createPolyline(coordinates, map)`
  - [ ] Créer une google.maps.Polyline
  - [ ] Appliquer les styles définis dans constants
  - [ ] Retourner l'objet Polyline
- [ ] Implémenter `createMarker(position, map, label)`
  - [ ] Créer un marker simple (cercle) pour chaque point de la ligne
  - [ ] Appliquer le style approprié (couleur, taille)
  - [ ] Ajouter un label numéroté si nécessaire
- [ ] Implémenter `clearDrawing(polyline, markers)`
  - [ ] Supprimer la polyline de la carte
  - [ ] Supprimer tous les markers
  - [ ] Nettoyer les listeners

**Tests unitaires 2.3** :
- [ ] Test : Création de polyline avec coordonnées valides
- [ ] Test : Création de marker avec position valide
- [ ] Test : Nettoyage complet (polyline + markers)

### 2.4 Utilitaires DOM (`utils/DOMUtils.js`)
- [ ] Créer la classe `DOMUtils`
- [ ] Implémenter `createPanelContainer()`
  - [ ] Créer la structure HTML du panneau
  - [ ] Appliquer les styles CSS
- [ ] Implémenter `createButton(text, title, styles, onClick)`
- [ ] Implémenter `createInput(placeholder, value, onChange)`
- [ ] Implémenter `createTabElement(name, isActive, onClick)`
- [ ] Implémenter `createSummarySection(data)`
  - [ ] Créer les éléments d'affichage des statistiques
- [ ] Implémenter `createChartContainer()`

**Tests unitaires 2.4** :
- [ ] Test : Création du conteneur principal
- [ ] Test : Création de bouton avec événements
- [ ] Test : Création d'input avec valeur initiale
- [ ] Test : Création d'onglet actif/inactif
- [ ] Test : Création section résumé avec données

---

## Phase 3 : Gestionnaire de Dessin

### 3.1 DrawingHandler (`handlers/DrawingHandler.js`)
- [ ] Créer la classe `DrawingHandler`
- [ ] Implémenter le constructeur
  - [ ] Initialiser les propriétés (map, isDrawing, currentPoints, etc.)
  - [ ] Créer les références aux overlays (polyline, markers)
  - [ ] Stocker la référence au curseur original
- [ ] Implémenter `startDrawingMode()`
  - [ ] Activer le mode dessin de ligne
  - [ ] Changer le curseur de la carte (cursor: crosshair)
  - [ ] Désactiver le dragging de la carte (optionnel pour plus de précision)
  - [ ] Dispatcher l'événement `PROFIL_DRAWING_STARTED`
  - [ ] Ajouter les listeners de carte (click, rightclick, mousemove)
- [ ] Implémenter `handleMapClick(event)`
  - [ ] Vérifier si le mode est actif
  - [ ] Extraire les coordonnées lat/lng du clic
  - [ ] Ajouter le point au tableau currentPoints
  - [ ] Créer un marker circulaire sur la carte pour ce point
  - [ ] Si c'est le premier point, initialiser la polyline
  - [ ] Si ce n'est pas le premier, mettre à jour la polyline
  - [ ] Dispatcher `PROFIL_POINT_ADDED` avec les coordonnées
  - [ ] Afficher un feedback visuel (nombre de points)
- [ ] Implémenter `handleMapMouseMove(event)` (optionnel)
  - [ ] Afficher une ligne temporaire entre le dernier point et le curseur
  - [ ] Mettre à jour en temps réel pendant le survol
- [ ] Implémenter `handleMapRightClick(event)`
  - [ ] Empêcher le menu contextuel par défaut
  - [ ] Désactiver le mode dessin
  - [ ] Valider le nombre de points (min 2)
  - [ ] Si < 2 points, afficher un message d'erreur via ErrorModal
  - [ ] Si >= 2 points, dispatcher `PROFIL_DRAWING_COMPLETED` avec les coordonnées
  - [ ] Restaurer le curseur normal et le dragging
- [ ] Implémenter `stopDrawingMode()`
  - [ ] Retirer tous les listeners (click, rightclick, mousemove)
  - [ ] Restaurer le curseur original
  - [ ] Réactiver le dragging de la carte
  - [ ] Nettoyer la polyline temporaire (mais garder la dernière validée)
  - [ ] Nettoyer les markers temporaires
  - [ ] Réinitialiser le tableau currentPoints
- [ ] Implémenter `cancelDrawing()`
  - [ ] Appeler stopDrawingMode()
  - [ ] Nettoyer complètement (polyline + markers)
  - [ ] Dispatcher un événement d'annulation
  - [ ] Afficher un message d'annulation (optionnel)
- [ ] Ajouter gestion de la touche Échap pour annuler
  - [ ] Listener sur document.keydown
  - [ ] Appeler cancelDrawing() si Échap pressée en mode actif
- [ ] Implémenter `clearLastDrawing()`
  - [ ] Supprimer la dernière polyline et ses markers
  - [ ] Utile pour recommencer un profil

**Tests unitaires 3.1** :
- [ ] Test : Démarrage du mode dessin
- [ ] Test : Ajout de points sur la carte (mock de map)
- [ ] Test : Création de polyline après 2 points
- [ ] Test : Finalisation avec clic droit (>= 2 points)
- [ ] Test : Annulation avec touche Échap
- [ ] Test : Nettoyage complet après annulation

**Tests E2E 3.1** :
- [ ] Test : Clic sur bouton "+" active le mode dessin
- [ ] Test : Curseur change en mode dessin
- [ ] Test : Ajout de 3 points sur la carte
- [ ] Test : Polyline visible après 2 points
- [ ] Test : Clic droit finalise le dessin
- [ ] Test : Touche Échap annule le dessin

---

## Phase 4 : Gestionnaire de Graphique

### 4.1 ChartHandler (`handlers/ChartHandler.js`)
- [ ] Créer la classe `ChartHandler`
- [ ] Implémenter le constructeur
  - [ ] Initialiser Google Charts
  - [ ] Créer le conteneur du graphique
- [ ] Implémenter `loadGoogleCharts()`
  - [ ] Charger la bibliothèque Google Charts
  - [ ] Charger le package 'corechart'
  - [ ] Retourner une Promise
- [ ] Implémenter `drawChart(profileData)`
  - [ ] Créer le DataTable Google Charts
  - [ ] Formater les données pour le graphique
  - [ ] Configurer les options du graphique
    - [ ] Titre : "Profil Altimétrique"
    - [ ] **Axes (convention standard)** :
      - [ ] Axe X (abscisse) : Distance (m)
      - [ ] Axe Y (ordonnée) : Altitude (m)
    - [ ] Type : LineChart ou AreaChart
    - [ ] Courbe lissée : `curveType: 'function'`
    - [ ] Couleur de la ligne : #2196F3 (bleu)
    - [ ] Remplissage sous la courbe (si AreaChart) : couleur bleue avec opacité
    - [ ] Grille visible pour meilleure lisibilité
    - [ ] Tooltip personnalisé avec toutes les infos (distance, altitude, pente)
    - [ ] Axe X : format en mètres avec labels clairs
    - [ ] Axe Y : format en mètres avec labels clairs
  - [ ] Dessiner le graphique dans le conteneur
- [ ] Implémenter `updateChart(profileData)`
  - [ ] Mettre à jour les données
  - [ ] Redessiner le graphique
- [ ] Implémenter `clearChart()`
  - [ ] Effacer le graphique existant

**Tests unitaires 4.1** :
- [ ] Test : Chargement de Google Charts
- [ ] Test : Création du DataTable avec données valides
- [ ] Test : Configuration des options du graphique
- [ ] Test : Mise à jour du graphique
- [ ] Test : Effacement du graphique

**Tests E2E 4.1** :
- [ ] Test : Graphique s'affiche après réception des données
- [ ] Test : Graphique affiche les bonnes valeurs
- [ ] Test : Titre du graphique est correct
- [ ] Test : Labels des axes sont corrects

---

## Phase 5 : Contrôle Principal et Manager

### 5.1 ProfilAltimetriqueControl (`core/ProfilAltimetriqueControl.js`)
- [ ] Créer la classe `ProfilAltimetriqueControl`
- [ ] Implémenter le constructeur
  - [ ] Accepter les options (map, errorModal, showSpinner, hideSpinner)
  - [ ] Créer le panneau latéral (DOM)
  - [ ] Initialiser le bouton "+"
  - [ ] Initialiser le bouton d'export CSV
  - [ ] Créer la zone des onglets
  - [ ] Créer la zone du graphique
  - [ ] Créer la zone du résumé
  - [ ] Créer l'input du nom de couche
    - [ ] Valeur par défaut : "Alti-PV1", "Alti-PV2", etc.
    - [ ] Placeholder : "Nom du profil"
    - [ ] Éditable par l'utilisateur
    - [ ] Bouton de sauvegarde [💾] ou auto-save au blur
    - [ ] Validation : non vide, max 50 caractères
- [ ] Implémenter `createPanelContainer()`
  - [ ] Créer la structure HTML complète
  - [ ] Appliquer les styles similaires à resuméParcelles.js
  - [ ] Ajouter tous les éléments enfants
- [ ] Implémenter `initializeEventListeners()`
  - [ ] Écouter `PROFIL_DRAWING_STARTED`
  - [ ] Écouter `PROFIL_POINT_ADDED`
  - [ ] Écouter `PROFIL_DRAWING_COMPLETED`
  - [ ] Écouter `PROFIL_DATA_LOADED`
  - [ ] Écouter `PROFIL_SAVED`
  - [ ] Écouter `PROFIL_SELECTED`
- [ ] Implémenter `handleAddButtonClick()`
  - [ ] Activer/désactiver le mode dessin
  - [ ] Mettre à jour l'icône du bouton
- [ ] Implémenter `handleExportButtonClick()`
  - [ ] Récupérer les données du profil actif
  - [ ] Appeler la méthode d'export CSV
- [ ] Implémenter `updateButtonState(isActive)`
  - [ ] Changer l'apparence du bouton "+"
  - [ ] Rouge avec "×" si actif
  - [ ] Vert avec "+" si inactif
- [ ] Implémenter `displayProfile(profileData)`
  - [ ] Afficher le graphique via ChartHandler
  - [ ] Afficher le résumé des statistiques
  - [ ] Mettre à jour le nom de la couche
- [ ] Implémenter `getDOMElement()`
  - [ ] Retourner le conteneur principal

**Tests unitaires 5.1** :
- [ ] Test : Création du panneau avec tous les éléments
- [ ] Test : Gestion du clic sur bouton "+"
- [ ] Test : Mise à jour de l'état du bouton
- [ ] Test : Affichage des données de profil
- [ ] Test : Récupération du DOM element

### 5.2 ProfilAltimetriqueManager (`core/ProfilAltimetriqueManager.js`)
- [ ] Créer la classe `ProfilAltimetriqueManager`
- [ ] Implémenter le constructeur
  - [ ] Initialiser DrawingHandler
  - [ ] Initialiser ChartHandler
  - [ ] Initialiser AltimetrieAPIService
  - [ ] Initialiser le tableau des profils
  - [ ] Initialiser l'ID du profil actif
- [ ] Implémenter `startNewProfile()`
  - [ ] Appeler DrawingHandler.startDrawingMode()
- [ ] Implémenter `handleDrawingCompleted(coordinates)`
  - [ ] Afficher le spinner
  - [ ] Appeler AltimetrieAPIService.getElevationLine()
  - [ ] Traiter les données reçues
  - [ ] Formater avec CalculationUtils
  - [ ] Dispatcher `PROFIL_DATA_LOADED`
  - [ ] Masquer le spinner
  - [ ] Gérer les erreurs
- [ ] Implémenter `saveProfile(name, profileData)`
  - [ ] Créer un objet profil avec ID unique
  - [ ] Générer un nom par défaut si non fourni : "Alti-PV1", "Alti-PV2", etc.
    - [ ] Incrémenter automatiquement le numéro en fonction des profils existants
    - [ ] Vérifier les doublons et ajuster le numéro si nécessaire
  - [ ] Ajouter au tableau des profils
  - [ ] Sauvegarder dans localStorage via StorageManager
  - [ ] Dispatcher `PROFIL_SAVED`
  - [ ] Créer un onglet pour ce profil avec le nom généré
- [ ] Implémenter `loadProfile(profileId)`
  - [ ] Récupérer le profil depuis le tableau
  - [ ] Dispatcher `PROFIL_SELECTED`
  - [ ] Mettre à jour l'interface
- [ ] Implémenter `loadProfilesFromStorage()`
  - [ ] Charger depuis localStorage
  - [ ] Recréer les onglets
  - [ ] Charger le dernier profil actif
- [ ] Implémenter `deleteProfile(profileId)`
  - [ ] Retirer du tableau
  - [ ] Mettre à jour localStorage
  - [ ] Supprimer l'onglet
- [ ] Implémenter `exportProfileToCSV(profileId)`
  - [ ] Récupérer les données du profil
  - [ ] Créer le contenu CSV
  - [ ] Format : "Distance (m), Altitude (m), Pente (%)"
  - [ ] Créer un blob et télécharger
- [ ] Implémenter `renameProfile(profileId, newName)`
  - [ ] Valider le nouveau nom (non vide, longueur max)
  - [ ] Mettre à jour le profil dans le tableau
  - [ ] Mettre à jour localStorage
  - [ ] Mettre à jour le label de l'onglet
  - [ ] Dispatcher un événement de modification
- [ ] Implémenter `generateDefaultName()`
  - [ ] Récupérer tous les noms de profils existants
  - [ ] Trouver le prochain numéro disponible (Alti-PV1, Alti-PV2, etc.)
  - [ ] Gérer les suppressions (réutiliser les numéros manquants ou continuer l'incrémentation)
  - [ ] Retourner le nom généré
- [ ] Ajouter méthodes de gestion des onglets
  - [ ] `createTab(profileId, profileName)`
  - [ ] `selectTab(profileId)`
  - [ ] `removeTab(profileId)`
  - [ ] `updateTabLabel(profileId, newName)`

**Tests unitaires 5.2** :
- [ ] Test : Démarrage d'un nouveau profil
- [ ] Test : Traitement des coordonnées après dessin
- [ ] Test : Appel API et formatage des données
- [ ] Test : Sauvegarde d'un profil avec nom par défaut "Alti-PV1"
- [ ] Test : Génération automatique de noms séquentiels (Alti-PV1, Alti-PV2, Alti-PV3)
- [ ] Test : Renommage d'un profil existant
- [ ] Test : Validation du nouveau nom (non vide, longueur max)
- [ ] Test : Chargement d'un profil existant
- [ ] Test : Suppression d'un profil
- [ ] Test : Export CSV avec format correct
- [ ] Test : Gestion des erreurs API
- [ ] Test : Gestion des doublons de noms (incrémentation automatique)

---

## Phase 6 : Intégration avec StorageManager

### 6.1 Extension du StorageManager
- [ ] Ajouter une clé pour les profils altimétriques
  - [ ] `altimetricProfiles` dans l'objet principal
- [ ] Implémenter `saveAltimetricProfile(profile)`
  - [ ] Sauvegarder un profil individuel
  - [ ] Mettre à jour le tableau des profils
- [ ] Implémenter `loadAltimetricProfiles()`
  - [ ] Charger tous les profils sauvegardés
- [ ] Implémenter `deleteAltimetricProfile(profileId)`
  - [ ] Supprimer un profil spécifique
- [ ] Implémenter `updateAltimetricProfile(profileId, updates)`
  - [ ] Mettre à jour un profil (ex: renommage)

**Tests unitaires 6.1** :
- [ ] Test : Sauvegarde d'un profil dans localStorage
- [ ] Test : Chargement de tous les profils
- [ ] Test : Suppression d'un profil
- [ ] Test : Mise à jour d'un profil
- [ ] Test : Gestion des erreurs de parsing JSON

---

## Phase 7 : Système d'Onglets et Historique

### 7.1 Gestion des Onglets
- [ ] Créer le composant d'onglets dans le DOM
- [ ] Implémenter `TabsManager` (peut être dans utils)
  - [ ] `addTab(id, name, isActive)`
  - [ ] `removeTab(id)`
  - [ ] `setActiveTab(id)`
  - [ ] `getActiveTab()`
- [ ] Implémenter les styles CSS des onglets
  - [ ] Onglet actif : fond coloré
  - [ ] Onglet inactif : fond grisé
  - [ ] Hover : effet de survol
- [ ] Ajouter bouton de suppression sur chaque onglet
  - [ ] Icône "×"
  - [ ] Confirmation avant suppression
- [ ] Limiter le nombre d'onglets visibles (scroll horizontal si nécessaire)

**Tests unitaires 7.1** :
- [ ] Test : Ajout d'un onglet
- [ ] Test : Suppression d'un onglet
- [ ] Test : Changement d'onglet actif
- [ ] Test : Récupération de l'onglet actif

**Tests E2E 7.1** :
- [ ] Test : Création de 3 profils génère 3 onglets
- [ ] Test : Clic sur onglet 2 affiche le profil 2
- [ ] Test : Suppression d'onglet supprime le profil
- [ ] Test : Confirmation avant suppression

---

## Phase 8 : Export CSV

### 8.1 Fonctionnalité d'Export
- [ ] Créer `CSVExporter` dans utils
- [ ] Implémenter `formatProfileToCSV(profileData)`
  - [ ] Créer l'en-tête CSV
  - [ ] Format : "Distance (m);Altitude (m);Latitude;Longitude;Pente (%)"
  - [ ] Ajouter les lignes de données
  - [ ] Ajouter une section de résumé en bas
- [ ] Implémenter `downloadCSV(csvContent, filename)`
  - [ ] Créer un Blob avec le contenu
  - [ ] Créer un lien de téléchargement
  - [ ] Déclencher le téléchargement
  - [ ] Nettoyer le lien
- [ ] Ajouter bouton d'export dans le panneau
  - [ ] Icône de téléchargement
  - [ ] Désactivé si aucun profil actif
- [ ] Gérer le nom du fichier
  - [ ] Format : "profil_altimetrique_[nom]_[date].csv"

**Tests unitaires 8.1** :
- [ ] Test : Formatage correct du CSV
- [ ] Test : En-têtes corrects
- [ ] Test : Données formatées correctement
- [ ] Test : Section de résumé présente
- [ ] Test : Nom de fichier correct

**Tests E2E 8.1** :
- [ ] Test : Bouton export désactivé sans profil
- [ ] Test : Clic sur export télécharge un fichier
- [ ] Test : Fichier téléchargé contient les bonnes données

---

## Phase 9 : Interface Utilisateur et Styles

### 9.1 Styles CSS
- [ ] Créer `ProfilAltimetrique.css` dans `/static/ombridesign/CSS/`
- [ ] Définir les styles du panneau principal
  - [ ] Position fixe : `position: fixed`
  - [ ] Positionnement : `top: 10px; left: 10px` (ou right selon préférence)
  - [ ] Z-index : `z-index: 1000` (au-dessus de la carte)
  - [ ] Largeur : `min-width: 400px; max-width: 600px`
  - [ ] Hauteur maximale : `max-height: 80vh; overflow-y: auto`
  - [ ] Couleurs : Suivre le style de resuméParcelles.js
  - [ ] Fond semi-transparent : `background-color: hsla(0, 0%, 100%, 0.95)`
  - [ ] Bordure arrondie : `border-radius: 8px`
  - [ ] Ombre portée : `box-shadow: 0 2px 10px rgba(0,0,0,0.2)`
- [ ] Définir les styles de l'en-tête du panneau
  - [ ] Flex container avec espace entre titre et boutons
  - [ ] Fond légèrement coloré : `background-color: hsla(0, 0%, 90%, 0.8)`
  - [ ] Padding : `padding: 12px 16px`
  - [ ] Bordure inférieure : `border-bottom: 2px solid #ddd`
- [ ] Définir les styles des boutons
  - [ ] Bouton "+" / "×" : 32px × 32px, border-radius: 4px
  - [ ] Bouton "+" : `background-color: #4CAF50` (vert)
  - [ ] Bouton "×" : `background-color: #f44336` (rouge)
  - [ ] Bouton export : `background-color: #2196F3` (bleu)
  - [ ] Effets hover : légère opacité et ombre
  - [ ] Transition smooth : `transition: all 0.2s ease`
- [ ] Définir les styles des onglets
  - [ ] Conteneur horizontal : `display: flex; overflow-x: auto`
  - [ ] Onglet actif : fond coloré `#2196F3`, texte blanc
  - [ ] Onglet inactif : fond gris `#e0e0e0`, texte noir
  - [ ] Hover : légère élévation avec box-shadow
  - [ ] Scroll horizontal si > 5 onglets
  - [ ] Bouton de fermeture (×) sur chaque onglet
- [ ] Définir les styles de la zone graphique
  - [ ] Conteneur du chart : `min-height: 300px; padding: 16px`
  - [ ] Fond blanc : `background-color: white`
  - [ ] Responsive : s'adapte à la largeur du panneau
  - [ ] Bordure subtile : `border: 1px solid #e0e0e0`
- [ ] Définir les styles de la zone résumé
  - [ ] Grille CSS pour les statistiques : `display: grid; grid-template-columns: 1fr 1fr`
  - [ ] Gap entre les éléments : `gap: 12px`
  - [ ] Padding : `padding: 16px`
  - [ ] Typographie : police 14px, ligne de hauteur 1.5
  - [ ] Labels en gras : `font-weight: 600`
  - [ ] Valeurs en couleur : selon le type (positif=vert, négatif=rouge)
- [ ] Définir les styles de l'input nom de couche
  - [ ] Largeur 100% : `width: 100%`
  - [ ] Padding : `padding: 8px 12px`
  - [ ] Bordure : `border: 1px solid #ccc`
  - [ ] Focus : bordure bleue `border-color: #2196F3`
  - [ ] Border-radius : `border-radius: 4px`
- [ ] Ajouter animations et transitions
  - [ ] Fade in/out pour l'affichage du panneau
  - [ ] Slide animation pour les onglets
  - [ ] Smooth transitions sur les boutons
- [ ] Ajouter classe pour le panneau masqué
  - [ ] `.hidden { display: none; }` ou animation slide-out

### 9.2 Responsive Design
- [ ] Adapter le panneau pour différentes tailles d'écran
- [ ] Gérer l'affichage sur mobile/tablette
- [ ] Ajuster la taille du graphique

---

## Phase 10 : Création du Panneau Latéral Indépendant

### 10.1 Structure Visuelle du Panneau
Le panneau doit suivre cette structure hiérarchique :

```
┌─────────────────────────────────────────────────┐
│ 📈 Profils Altimétriques          [📥] [+]     │ ← En-tête
├─────────────────────────────────────────────────┤
│ [Alti-PV1] [Alti-PV2*] [Alti-PV3] [+]         │ ← Onglets (scrollable) * = actif
├─────────────────────────────────────────────────┤
│                                                 │
│            [Graphique Chart]                    │ ← Zone graphique (LineChart)
│         (Distance vs Altitude)                  │
│                                                 │
├─────────────────────────────────────────────────┤
│ 📏 Distance totale: 1250 m                      │
│ ⬆️ Dénivelé positif: +45 m                      │
│ ⬇️ Dénivelé négatif: -23 m                      │ ← Résumé statistiques
│ 📐 Pente moyenne: 3.5%                          │
│ 📊 Plus forte pente: 12%                        │
├─────────────────────────────────────────────────┤
│ Nom de la couche: [Alti-PV2_________]     [💾] │ ← Input nom + save
└─────────────────────────────────────────────────┘

Légende boutons :
- [📥] = Export CSV (désactivé si pas de profil actif)
- [+] dans l'en-tête = Créer nouveau profil (devient [×] rouge en mode dessin)
- [+] dans les onglets = Créer un nouvel onglet (alternative)
- [💾] = Sauvegarder le nom modifié
- [×] sur chaque onglet = Supprimer le profil (avec confirmation)

Note : Le toggle du panneau se fait via un bouton sur la carte elle-même
```

### 10.2 Structure du Panneau Latéral
- [ ] Créer un panneau latéral indépendant (similaire à resuméParcelles)
- [ ] Positionner le panneau sur le côté de la carte
  - [ ] Position fixe en haut à gauche ou à droite
  - [ ] Styles CSS pour le positionnement
  - [ ] Z-index approprié pour rester visible
- [ ] Créer le titre du panneau : "Profils Altimétriques"
- [ ] Ajouter le bouton "+" dans l'en-tête du panneau
  - [ ] Bouton vert avec "+" par défaut
  - [ ] Bouton rouge avec "×" en mode actif
  - [ ] Tooltip explicatif
- [ ] Ajouter le bouton d'export CSV dans l'en-tête
  - [ ] Icône de téléchargement
  - [ ] Désactivé si aucun profil actif
- [ ] Rendre le panneau redimensionnable (optionnel)
- [ ] Rendre le panneau masquable/affichable avec un bouton toggle

### 10.2 Intégration dans GoogleMaps.js
- [ ] Importer `ProfilAltimetriqueControl` dans GoogleMaps.js
- [ ] Créer une instance après l'initialisation de la carte
- [ ] Passer les dépendances nécessaires (map, errorModal, spinners)
- [ ] Appeler `initializeWithMap()` quand la map est prête
- [ ] Ajouter le panneau au DOM de la page (pas dans la ToolBar)
- [ ] Positionner le panneau de manière indépendante
- [ ] Gérer l'affichage/masquage du panneau

### 10.3 Contrôle Custom sur la Carte
- [ ] Créer un contrôle Google Maps custom pour toggle le panneau
  - [ ] Bouton sur la carte pour afficher/masquer le panneau
  - [ ] Icône représentant un profil altimétrique
  - [ ] Position : `google.maps.ControlPosition.TOP_LEFT` ou `TOP_RIGHT`
- [ ] Implémenter la logique de toggle
  - [ ] Afficher/masquer le panneau au clic
  - [ ] Mettre à jour l'icône selon l'état
  - [ ] Sauvegarder l'état dans localStorage

**Tests E2E 10.1** :
- [ ] Test : Panneau visible indépendamment de la ToolBar
- [ ] Test : Panneau bien positionné (côté de la carte)
- [ ] Test : Bouton de toggle sur la carte fonctionne
- [ ] Test : État du panneau persiste après refresh
- [ ] Test : Interactions ne perturbent pas les autres contrôles
- [ ] Test : Panneau responsive (s'adapte à la taille d'écran)

---

## Phase 11 : Gestion des Erreurs

### 11.1 Gestion Globale des Erreurs
- [ ] Gérer les erreurs API
  - [ ] Timeout (délai max 30s)
  - [ ] Timeout (délai max 30s)
  - [ ] Erreurs réseau
  - [ ] Réponse invalide
  - [ ] Trop de points (>5000)
- [ ] Gérer les erreurs de calcul
  - [ ] Points invalides
  - [ ] Données manquantes
- [ ] Gérer les erreurs de stockage
  - [ ] localStorage plein
  - [ ] Données corrompues
- [ ] Afficher des messages d'erreur appropriés
  - [ ] Via ErrorModal
  - [ ] Messages clairs et actionnables
- [ ] Logger les erreurs en console pour debug

**Tests unitaires 11.1** :
- [ ] Test : Gestion timeout API
- [ ] Test : Gestion erreur réseau
- [ ] Test : Gestion réponse invalide
- [ ] Test : Gestion localStorage plein
- [ ] Test : Messages d'erreur corrects

---

## Phase 12 : Optimisations et Performance

### 12.1 Optimisations
- [ ] Implémenter debouncing pour les clics rapides
- [ ] Mettre en cache les calculs coûteux
- [ ] Lazy loading de Google Charts
- [ ] Optimiser le rendu des onglets (virtualisation si >10)
- [ ] Limiter la taille du localStorage
  - [ ] Max 20 profils sauvegardés
  - [ ] Supprimer les plus anciens si dépassement
- [ ] Optimiser les requêtes API
  - [ ] Limiter le sampling par défaut (100 points)
  - [ ] Proposer mode "accurate" optionnel

---

## Phase 13 : Tests E2E Complets

### 13.1 Scénarios Utilisateur Complets
- [ ] **Scénario 1 : Création d'un profil simple**
  - [ ] Ouvrir l'application
  - [ ] Cliquer sur bouton "+"
  - [ ] Dessiner 3 points sur la carte
  - [ ] Clic droit pour finaliser
  - [ ] Vérifier affichage du graphique
  - [ ] Vérifier affichage des statistiques
  - [ ] Nommer le profil "Test 1"
  - [ ] Vérifier sauvegarde automatique

- [ ] **Scénario 2 : Gestion de plusieurs profils**
  - [ ] Créer profil "Profil A"
  - [ ] Créer profil "Profil B"
  - [ ] Créer profil "Profil C"
  - [ ] Vérifier 3 onglets présents
  - [ ] Cliquer sur onglet "Profil A"
  - [ ] Vérifier affichage du bon profil
  - [ ] Cliquer sur onglet "Profil C"
  - [ ] Vérifier affichage du bon profil

- [ ] **Scénario 3 : Export CSV**
  - [ ] Créer un profil
  - [ ] Cliquer sur bouton export
  - [ ] Vérifier téléchargement du fichier
  - [ ] Ouvrir le fichier CSV
  - [ ] Vérifier format et données

- [ ] **Scénario 4 : Persistance**
  - [ ] Créer 2 profils
  - [ ] Rafraîchir la page
  - [ ] Vérifier que les profils sont toujours présents
  - [ ] Vérifier que les graphiques se rechargent

- [ ] **Scénario 5 : Suppression**
  - [ ] Créer 3 profils
  - [ ] Supprimer le profil du milieu
  - [ ] Vérifier mise à jour des onglets
  - [ ] Vérifier profil actif correct

- [ ] **Scénario 6 : Gestion d'erreurs**
  - [ ] Essayer de créer un profil avec 1 seul point
  - [ ] Vérifier message d'erreur
  - [ ] Dessiner un profil hors zone couverte
  - [ ] Vérifier gestion erreur API

---

## Phase 14 : Documentation

### 14.1 Documentation Technique
- [ ] Créer `profil-altimetrique.md` dans `/docs`
- [ ] Documenter l'architecture
  - [ ] Diagramme de classes
  - [ ] Flux de données
  - [ ] Événements personnalisés
- [ ] Documenter l'API IGN
  - [ ] Endpoints utilisés
  - [ ] Paramètres
  - [ ] Format de réponse
- [ ] Documenter les méthodes publiques (JSDoc)
- [ ] Créer des exemples d'utilisation
- [ ] Documenter la structure du localStorage

### 14.2 Guide Utilisateur
- [ ] Créer un guide d'utilisation
  - [ ] Comment créer un profil
  - [ ] Comment naviguer entre les profils
  - [ ] Comment exporter
  - [ ] Comment supprimer
- [ ] Ajouter des captures d'écran
- [ ] Ajouter des vidéos de démonstration

---

## Phase 15 : Revue et Finalisation

### 15.1 Revue de Code
- [ ] Vérifier conformité avec les règles du projet
  - [ ] camelCase pour variables
  - [ ] PascalCase pour classes
  - [ ] kebab-case pour fichiers
  - [ ] snake_case pour localStorage
- [ ] Vérifier l'utilisation de const/let (pas de var)
- [ ] Vérifier les imports/exports nommés
- [ ] Vérifier la gestion d'erreurs
- [ ] Vérifier les commentaires JSDoc
- [ ] Vérifier l'absence de code dupliqué

### 15.2 Tests Finaux
- [ ] Exécuter tous les tests unitaires
- [ ] Exécuter tous les tests E2E
- [ ] Vérifier la couverture de code (>80%)
- [ ] Tests de performance
  - [ ] Temps de réponse API
  - [ ] Temps de rendu du graphique
  - [ ] Performance avec 10+ profils
- [ ] Tests de compatibilité navigateur
  - [ ] Chrome
  - [ ] Firefox
  - [ ] Safari
  - [ ] Edge

### 15.3 Optimisations Finales
- [ ] Minimiser les fichiers CSS/JS si nécessaire
- [ ] Optimiser les images/icônes
- [ ] Vérifier les performances réseau
- [ ] Vérifier l'accessibilité (a11y)

---

## Checklist de Déploiement

- [ ] Tous les tests passent
- [ ] Documentation complète
- [ ] Code reviewed
- [ ] Pas de console.log en production
- [ ] Gestion d'erreurs complète
- [ ] Performance validée
- [ ] Compatible avec les navigateurs cibles
- [ ] Merge sur branche principale

---

## Notes Techniques

### Technologies Utilisées
- Google Maps JavaScript API
- Google Charts
- API IGN Géoportail Altimétrie
- LocalStorage API
- Vanilla JavaScript (ES6+)

### Dépendances
- Aucune dépendance externe supplémentaire
- Utilise les composants existants (ErrorModal, StorageManager)

### Points d'Attention
- Limiter le nombre de requêtes API (max 5000 points)
- Gérer le cas où l'API IGN est indisponible
- Optimiser le stockage localStorage (limiter la taille)
- Gérer les zones hors couverture de l'API
- Le panneau doit être indépendant et ne pas gêner la ToolBar ou le panneau Résumé Parcelles
- Le curseur doit changer visuellement en mode dessin (crosshair)
- Désactiver temporairement le dragging de la carte pour éviter les clics accidentels
- Ajouter un compteur de points visible pendant le dessin
- Le clic droit doit empêcher le menu contextuel du navigateur

### Icône SVG pour le Bouton Toggle
```svg
<!-- Icône représentant un profil altimétrique (montagne/graphique) -->
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 20L7 12L12 16L17 8L22 14V20H2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M2 20H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### Améliorations Futures (Post-MVP)
- [ ] Mode "accurate" pour plus de précision
- [ ] Affichage 3D du profil
- [ ] Comparaison de plusieurs profils (superposition de courbes)
- [ ] Import de fichiers GPX/KML
- [ ] Partage de profils (export JSON)
- [ ] Statistiques avancées (vitesse estimée, temps de parcours, etc.)
- [ ] Intégration avec les zones photovoltaïques (calculer pente des zones)
- [ ] Édition des points du profil (ajouter/supprimer après création)
- [ ] Annotations sur le graphique (markers, zones d'intérêt)
- [ ] Export en image (PNG) du graphique
- [ ] Mode "comparaison" avec 2 profils côte à côte

---

## Flux d'Utilisation Complet

### Scénario Utilisateur Standard

**1. Ouverture du panneau**
- L'utilisateur charge l'application Google Maps
- Un bouton avec icône 📈 apparaît sur la carte (contrôle custom)
- Clic sur le bouton → le panneau latéral s'affiche

**2. Création d'un nouveau profil**
- L'utilisateur clique sur le bouton "+" vert dans l'en-tête du panneau
- Le bouton devient "×" rouge pour indiquer le mode actif
- Le curseur de la carte change en croix (crosshair)
- Message d'aide affiché : "Cliquez sur la carte pour ajouter des points. Clic droit pour terminer."

**3. Dessin du profil**
- L'utilisateur clique sur la carte → premier point ajouté (marker circulaire affiché)
- Clic 2 → deuxième point + ligne reliant les deux points (polyline)
- Clic 3, 4, 5... → ajout de points supplémentaires, polyline mise à jour
- Compteur affiché : "5 points ajoutés"

**4. Finalisation du dessin**
- L'utilisateur fait un clic droit sur la carte
- Mode dessin désactivé automatiquement
- Bouton redevient "+" vert
- Spinner affiché : "Récupération du profil altimétrique..."

**5. Récupération des données**
- Appel API vers IGN Géoportail avec les coordonnées
- Réponse JSON parsée et formatée
- Calculs automatiques : distance, dénivelés, pentes

**6. Affichage des résultats**
- Graphique Google Charts généré et affiché
- Courbe lissée montrant l'évolution de l'altitude
- Statistiques affichées sous le graphique :
  - Distance totale : 1250 m
  - Dénivelé positif : +45 m
  - Dénivelé négatif : -23 m
  - Pente moyenne : 3.5%
  - Plus forte pente : 12%

**7. Sauvegarde du profil**
- L'utilisateur modifie le nom dans l'input : "Profil Parking Est"
- Clic sur bouton 💾 (ou auto-save au blur)
- Profil sauvegardé dans localStorage
- Nouvel onglet créé avec le nom du profil

**8. Création de profils supplémentaires**
- L'utilisateur clique à nouveau sur "+"
- Répète les étapes 3-7 pour créer "Profil Parking Ouest"
- Maintenant 2 onglets visibles : [Profil Parking Est*] [Profil Parking Ouest]

**9. Navigation entre profils**
- Clic sur onglet "Profil Parking Est"
- Le graphique et les statistiques se mettent à jour
- La polyline correspondante peut être affichée sur la carte

**10. Export CSV**
- L'utilisateur clique sur le bouton 📥
- Fichier téléchargé : `profil_altimetrique_parking_est_2025-10-14.csv`
- Le fichier contient toutes les données tabulaires

**11. Suppression d'un profil**
- L'utilisateur clique sur [×] de l'onglet "Profil Parking Ouest"
- Modal de confirmation : "Êtes-vous sûr de vouloir supprimer ce profil ?"
- Clic sur "Confirmer" → profil supprimé
- Onglet disparaît, profil actif bascule sur le précédent

**12. Persistance**
- L'utilisateur rafraîchit la page
- Le panneau se recharge avec tous les profils sauvegardés
- Le dernier profil actif est automatiquement sélectionné

---

## Exemples de Données

### Exemple de Requête API
```
GET https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json?lon=2.3522|2.3545|2.3568&lat=48.8566|48.8578|48.8590&resource=ign_rge_alti_wld&delimiter=|&sampling=3&profile_mode=simple
```

### Exemple de Réponse API
```json
{
  "elevations": [
    { "lon": 2.3522, "lat": 48.8566, "z": 35.2, "acc": "2.5m" },
    { "lon": 2.3545, "lat": 48.8578, "z": 42.8, "acc": "2.5m" },
    { "lon": 2.3568, "lat": 48.8590, "z": 38.5, "acc": "2.5m" }
  ],
  "height_differences": {
    "positive": 7.6,
    "negative": 4.3
  }
}
```

### Exemple de Données Formatées (après calculs)
```javascript
{
  id: "profile_1697456789",
  name: "Profil Parking Est",
  created: "2025-10-14T10:30:00Z",
  points: [
    { lat: 48.8566, lon: 2.3522, alt: 35.2, distance: 0, slope: 0 },
    { lat: 48.8578, lon: 2.3545, alt: 42.8, distance: 147.3, slope: 5.2 },
    { lat: 48.8590, lon: 2.3568, alt: 38.5, distance: 295.8, slope: -2.9 }
  ],
  stats: {
    totalDistance: 295.8,
    positiveElevation: 7.6,
    negativeElevation: 4.3,
    averageSlope: 1.1,
    maxSlope: 5.2
  }
}
```

### Exemple de CSV Exporté
```csv
Distance (m);Altitude (m);Latitude;Longitude;Pente (%)
0.0;35.2;48.8566;2.3522;0.0
147.3;42.8;48.8578;2.3545;5.2
295.8;38.5;48.8590;2.3568;-2.9

--- Résumé ---
Distance totale;295.8 m
Dénivelé positif;+7.6 m
Dénivelé négatif;-4.3 m
Pente moyenne;1.1 %
Plus forte pente;5.2 %
```

