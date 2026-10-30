# Modals de Géométrie - Structure Modulaire

Ce répertoire contient les modals de configuration géométrique pour les différents types de structures PV.

## 📁 Structure du Projet

### HTML Templates
- `templates/ombridesign/menu/modele/modal/geometrie/`
  - `batiment_metal_full.html` - Configurateur pour Bâtiment Métal
  - `ombriere_metal_full.html` - Configurateur pour Ombrière Métal (Bois)

### CSS Modulaires
- `static/ombridesign/CSS/`
  - `geometrieModal.css` - Styles communs à tous les modals de géométrie
  - `batimentMetalModal.css` - Styles spécifiques au configurateur de bâtiment

### JavaScript Modulaires
- `static/ombridesign/javascript/`
  - `geometrieModalCore.js` - Classe de base pour la gestion des modals
  - `geometrieModal.js` - Gestionnaire d'ouverture/fermeture des modals

## 🔧 Architecture

### Mode Embedded
Les modals sont conçus pour fonctionner en mode "embedded" dans une iframe. Le système détecte automatiquement si le modal est ouvert dans une iframe et adapte son comportement:

- **Mode Standalone**: Affiche le modal avec overlay et header
- **Mode Embedded**: Affiche le contenu en plein écran sans overlay ni header

### CSS Communs (geometrieModal.css)
Ce fichier contient tous les styles réutilisables:
- Variables CSS (couleurs principales, dimensions par défaut)
- Styles pour le mode embedded
- Styles du modal de lancement
- Styles du modal principal (header, body, overlay)
- Styles des formulaires et inputs
- Styles des onglets et boutons outils
- Utilitaires responsive

### JavaScript Core (geometrieModalCore.js)
Classe `GeometrieModalCore` qui fournit:
- Détection automatique du mode embedded
- Gestion de l'ouverture/fermeture du modal
- Communication avec le parent via `postMessage`
- Synchronisation des champs avec la page calepinage
- Gestion du drag & drop (en mode standalone)
- Gestion du redimensionnement

## 🚀 Ajouter un Nouveau Modal

### 1. Créer le fichier HTML

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nouveau Configurateur</title>

    <!-- Libraries externes -->
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <!-- CSS Modulaires (OBLIGATOIRE) -->
    <link rel="stylesheet" href="/static/ombridesign/CSS/geometrieModal.css">

    <!-- CSS spécifique (optionnel) -->
    <link rel="stylesheet" href="/static/ombridesign/CSS/monNouveauModal.css">
</head>
<body>
    <!-- Modal de lancement -->
    <div id="welcome-modal-overlay">
        <div id="welcome-modal">
            <h2 class="text-3xl font-bold text-gray-900 mb-6">Nouveau Configurateur</h2>
            <button id="launch-btn">
                <span>Lancer le configurateur</span>
            </button>
        </div>
    </div>

    <!-- Overlay et Modal -->
    <div id="modal-overlay" class="hidden"></div>
    <div id="app-modal" class="hidden">
        <div id="modal-header">
            <h2>Nouveau Configurateur</h2>
            <button id="close-modal-btn" class="modal-header-btn" title="Fermer">
                ✕
            </button>
        </div>
        <div id="modal-body">
            <!-- Votre contenu ici -->
        </div>
    </div>

    <!-- JavaScript Core (OBLIGATOIRE) -->
    <script src="/static/ombridesign/javascript/geometrieModalCore.js"></script>

    <!-- Initialisation -->
    <script>
        const modalCore = new GeometrieModalCore();
        // Votre code spécifique ici
    </script>
</body>
</html>
```

### 2. Créer une route Flask

Dans `app.py`:

```python
@app.route('/ombridesign/modal/mon_nouveau_modal')
@permission_required('concevoir_mon_projet')
@login_required
def mon_nouveau_modal():
    if 'user' not in session:
        return redirect(url_for('login'))

    return render_template('ombridesign/menu/modele/modal/geometrie/mon_nouveau_modal.html')
```

### 3. Ajouter le mapping dans geometrieModal.js

Dans `static/ombridesign/javascript/geometrieModal.js`:

```javascript
const STRUCTURE_MODAL_MAPPING = {
    'Mon Nouveau Type': {
        url: '/ombridesign/modal/mon_nouveau_modal',
        title: 'Configuration Mon Nouveau Type'
    },
    // ... autres mappings
};
```

## 📝 Fonctionnalités Disponibles

### Synchronisation avec la page parent

```javascript
// Dans votre code spécifique
modalCore.syncFieldToParent('longueur', 15.5);
modalCore.syncFieldToParent('largeur', 12.0);
```

### Gestion du redimensionnement

```javascript
modalCore.setupResizeHandler(() => {
    // Code à exécuter lors du redimensionnement
    updateCanvas();
});
```

### Fermeture personnalisée

```javascript
// Le bouton close-modal-btn est géré automatiquement
// Mais vous pouvez aussi fermer manuellement:
modalCore.handleClose();
```

## ⚙️ Configuration

### Variables CSS personnalisables

Dans votre fichier CSS spécifique:

```css
:root {
    --main-color: #DC2626;           /* Couleur principale */
    --main-color-hover: #B91C1C;     /* Couleur au survol */
    --modal-default-width: 90vw;     /* Largeur par défaut */
    --modal-default-height: 90vh;    /* Hauteur par défaut */
}
```

## 🔗 Communication Parent-Enfant

### Messages envoyés au parent

1. **Fermeture du modal**:
```javascript
window.parent.postMessage({ action: 'closeModal' }, '*');
```

2. **Mise à jour d'un champ**:
```javascript
window.parent.postMessage({
    action: 'updateCalepinageField',
    fieldName: 'longueur',
    value: 15.5
}, '*');
```

### Messages reçus du parent

Le gestionnaire est dans `geometrieModal.js`:

```javascript
window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'closeModal') {
        // Fermeture du modal
    }

    if (event.data && event.data.action === 'updateCalepinageField') {
        // Mise à jour d'un champ dans la page calepinage
    }
});
```

## 🎨 Personnalisation des Styles

### Surcharger les styles communs

Créez un fichier CSS spécifique et surchargez les classes:

```css
/* monNouveauModal.css */
.tool-button.active {
    background-color: #10B981; /* Vert au lieu de rouge */
}

.tab-button.active {
    border-bottom-color: #10B981;
    color: #10B981;
}
```

## 🐛 Debugging

### Console Logs
Le mode embedded est loggé automatiquement:
```
GeometrieModalCore - Mode embedded: true/false
```

### Vérifier le mode
```javascript
console.log('Mode embedded:', modalCore.isEmbedded);
```

## 📦 Dépendances

- **Tailwind CSS**: Framework CSS utilitaire
- **Leaflet**: Bibliothèque de cartes interactives
- **html2canvas**: Capture d'écran HTML vers canvas
- **jsPDF**: Génération de PDF

## 🔄 Migration Progressive

Cette architecture permet une migration progressive. Vous pouvez:

1. Garder le code JavaScript dans le HTML (comme actuellement)
2. Progressivement extraire le code dans des fichiers `.js` séparés
3. Créer des classes réutilisables qui étendent `GeometrieModalCore`

## 📚 Exemples

Consultez:
- `batiment_metal_full.html` - Exemple complet avec formulaires, onglets, canvas
- `ombriere_metal_full.html` - Exemple avec carte Leaflet

---

**Auteur**: Équipe Solakvan
**Dernière mise à jour**: 2025-12-29
