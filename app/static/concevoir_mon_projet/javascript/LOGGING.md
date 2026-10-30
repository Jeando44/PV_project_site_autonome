# 📊 Système de Logging - Documentation

Le système de logging centralisé permet de tracer tous les événements et détecter rapidement les erreurs dans les modals de géométrie.

## 🎯 Objectifs

- ✅ **Traçabilité**: Suivre tous les événements importants
- ✅ **Debugging rapide**: Identifier les erreurs avec contexte
- ✅ **Performance**: Mesurer les temps d'exécution
- ✅ **Production**: Désactiver facilement en production

## 📁 Fichiers

- `logger.js` - Classe Logger centralisée
- `geometrieModalCore.js` - Utilisation du logger dans la classe de base
- `geometrieModal.js` - Logging des événements d'ouverture/fermeture

## 🚀 Utilisation de Base

### Initialisation Automatique

Le logger global est créé automatiquement au chargement de `logger.js`:

```javascript
// Disponible globalement
window.logger // Instance Logger avec préfixe 'GeometrieModal'
```

### Créer un Logger Spécifique

```javascript
// Dans votre module/page
const myLogger = new window.GeometrieLogger('MonModule');
```

## 📝 Méthodes de Logging

### Logs de Base

```javascript
// Debug (détails techniques)
logger.debug('Message de debug', { data: 'optionnelle' });

// Information (événements normaux)
logger.info('Opération réussie', { result: 'ok' });

// Avertissement (problèmes potentiels)
logger.warn('Attention: valeur manquante', { field: 'nom' });

// Erreur (problèmes critiques)
logger.error('Échec de l\'opération', error);
```

### Logs d'Opération

```javascript
// Début d'opération
logger.start('Chargement des données');

// Fin d'opération
logger.end('Chargement des données');

// Échec d'opération
logger.fail('Chargement des données', error);
```

### Logs Spécialisés

```javascript
// Événement DOM
logger.event('click', buttonElement, { action: 'ouvrir' });

// Communication (messages postMessage)
logger.message('sent', 'closeModal', { origin: '*' });
logger.message('received', 'updateField', { field: 'longueur' });

// Changement d'état
logger.state('Modal', 'fermé', 'ouvert');
```

### Vérification d'Éléments

```javascript
// Vérifier qu'un élément existe
const modal = logger.checkElement('app-modal', true);  // required
const overlay = logger.checkElement('overlay', false); // optional

// Logs automatiques:
// ✓ Élément trouvé: #app-modal
// ⚠️ Élément optionnel introuvable: #overlay
```

### Mesure de Performance

```javascript
logger.time('Opération longue');
// ... code ...
logger.timeEnd('Opération longue');

// Console: [GeometrieModal] Opération longue: 123.45ms
```

## 🎨 Affichage dans la Console

### Codes Couleurs

- 🔵 **INFO**: Bleu (événements normaux)
- 🟡 **WARN**: Jaune/Orange (avertissements)
- 🔴 **ERROR**: Rouge (erreurs)
- ⚫ **DEBUG**: Gris (détails techniques)

### Icônes

- ▶️ Début d'opération
- ✅ Fin d'opération réussie
- ❌ Échec d'opération
- 🎯 Événement DOM
- ↗️ Message envoyé
- ↘️ Message reçu
- 🔄 Changement d'état
- ⚠️ Avertissement
- ✓ Succès

## 📊 Exemples Concrets

### Exemple 1: Ouverture de Modal

```javascript
openModal() {
    this.logger.start('Ouverture du modal');

    try {
        if (this.modalElement) {
            this.modalElement.classList.remove('hidden');
            this.logger.debug('Modal visible');
        } else {
            this.logger.error('Impossible d\'ouvrir le modal - élément introuvable');
            return;
        }

        this.logger.end('Ouverture du modal');
    } catch (error) {
        this.logger.fail('Ouverture du modal', error);
    }
}
```

**Console:**
```
[14:23:45.123] [GeometrieModal] [INFO] ▶️ Début: Ouverture du modal
[14:23:45.125] [GeometrieModal] [DEBUG] Modal visible
[14:23:45.126] [GeometrieModal] [INFO] ✅ Fin: Ouverture du modal
```

### Exemple 2: Gestion d'Événement

```javascript
button.addEventListener('click', (e) => {
    logger.event('click', button, 'Bouton de fermeture');

    if (!this.canClose()) {
        logger.warn('Fermeture bloquée', { reason: 'modifications non sauvegardées' });
        return;
    }

    this.handleClose();
});
```

**Console:**
```
[14:24:10.001] [GeometrieModal] [DEBUG] 🎯 Événement: click {element: 'BUTTON', data: 'Bouton de fermeture'}
[14:24:10.002] [GeometrieModal] [WARN] Fermeture bloquée {reason: 'modifications non sauvegardées'}
```

### Exemple 3: Communication Parent-Enfant

```javascript
syncFieldToParent(fieldName, value) {
    this.logger.start('Synchronisation du champ', { fieldName, value });

    try {
        // Sauvegarder dans localStorage
        const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        data[fieldName] = value;
        localStorage.setItem('solarProjectData', JSON.stringify(data));

        this.logger.debug('localStorage mis à jour', { fieldName, value });

        // Envoyer au parent
        if (this.isEmbedded) {
            window.parent.postMessage({
                action: 'updateCalepinageField',
                fieldName,
                value
            }, '*');
            this.logger.message('sent', 'updateCalepinageField', { fieldName, value });
        }

        this.logger.end('Synchronisation du champ');
    } catch (error) {
        this.logger.fail('Synchronisation du champ', error);
    }
}
```

**Console:**
```
[14:25:30.100] [GeometrieModal] [INFO] ▶️ Début: Synchronisation du champ {fieldName: 'longueur', value: 15.5}
[14:25:30.102] [GeometrieModal] [DEBUG] localStorage mis à jour {fieldName: 'longueur', value: 15.5}
[14:25:30.103] [GeometrieModal] [INFO] ↗️ Message sent: updateCalepinageField {fieldName: 'longueur', value: 15.5}
[14:25:30.104] [GeometrieModal] [INFO] ✅ Fin: Synchronisation du champ
```

## ⚙️ Configuration

### Niveaux de Log

```javascript
// Définir le niveau minimum de log
logger.setLevel(logger.logLevel.WARN); // Seulement WARN et ERROR

// Niveaux disponibles:
logger.logLevel.DEBUG  // Tout afficher
logger.logLevel.INFO   // Info, Warn, Error
logger.logLevel.WARN   // Warn, Error
logger.logLevel.ERROR  // Seulement Error
```

### Activer/Désactiver

```javascript
// Désactiver tous les logs
logger.setEnabled(false);

// Réactiver
logger.setEnabled(true);
```

### En Production

```javascript
// Dans votre code de production
if (window.location.hostname === 'production.example.com') {
    logger.setEnabled(false);
    // OU
    logger.setLevel(logger.logLevel.ERROR); // Seulement les erreurs
}
```

## 🔍 Debugging

### Afficher le Résumé

```javascript
// Afficher un résumé des événements
logger.summary();
```

**Console:**
```
📊 Résumé GeometrieModal
  Info: 45
  Warnings: 3
  Errors: 0
```

### Tracer une Fonction

```javascript
// Wrapper automatique avec logging
const myFunction = logger.trace(originalFunction, 'myFunction');

// Équivalent à:
function myFunction(...args) {
    logger.start('myFunction', { args });
    try {
        const result = originalFunction(...args);
        logger.end('myFunction', { result });
        return result;
    } catch (error) {
        logger.fail('myFunction', error);
        throw error;
    }
}
```

## 📋 Checklist d'Intégration

Pour intégrer le logging dans un nouveau module:

- [ ] Charger `logger.js` dans le HTML
- [ ] Créer une instance Logger spécifique
- [ ] Logger l'initialisation du module
- [ ] Logger les événements critiques (ouverture, fermeture, etc.)
- [ ] Logger les communications (postMessage)
- [ ] Logger les erreurs potentielles avec try/catch
- [ ] Vérifier les éléments DOM avec `checkElement()`
- [ ] Ajouter des logs de debug pour le développement
- [ ] Configurer le niveau de log pour la production

## 🎓 Bonnes Pratiques

### DO ✅

```javascript
// Contexte clair
logger.info('Modal ouvert depuis le menu', { source: 'menu-link' });

// Données structurées
logger.error('Champ invalide', { field: 'longueur', value: -1, expected: 'positive' });

// Try/catch avec logging
try {
    riskyOperation();
} catch (error) {
    logger.error('Opération risquée a échoué', error);
}
```

### DON'T ❌

```javascript
// Message vague
logger.info('Erreur');

// Trop de détails en production
logger.debug('Variable x = ' + x + ', y = ' + y + ', z = ' + z + '...');

// Ignorer les erreurs
try {
    riskyOperation();
} catch (e) {
    // Silence...
}
```

## 🐛 Résolution de Problèmes

### Le logger n'est pas défini

**Problème**: `logger is not defined`

**Solution**: Vérifier que `logger.js` est chargé **avant** les autres scripts:

```html
<script src="/static/ombridesign/javascript/logger.js"></script>
<script src="/static/ombridesign/javascript/geometrieModalCore.js"></script>
```

### Les logs ne s'affichent pas

**Problème**: Aucun log dans la console

**Solutions**:
1. Vérifier que le logging est activé: `logger.setEnabled(true)`
2. Vérifier le niveau: `logger.setLevel(logger.logLevel.DEBUG)`
3. Ouvrir la console du navigateur (F12)

### Trop de logs

**Problème**: Console surchargée

**Solutions**:
1. Augmenter le niveau: `logger.setLevel(logger.logLevel.INFO)`
2. Filtrer dans la console: `[GeometrieModal]`
3. Utiliser des loggers spécifiques par module

## 📚 Référence Rapide

| Méthode | Usage | Exemple |
|---------|-------|---------|
| `debug()` | Détails techniques | `logger.debug('Variable x', { x })` |
| `info()` | Événements normaux | `logger.info('Page chargée')` |
| `warn()` | Avertissements | `logger.warn('Valeur manquante')` |
| `error()` | Erreurs | `logger.error('Échec', error)` |
| `start()` | Début opération | `logger.start('Chargement')` |
| `end()` | Fin opération | `logger.end('Chargement')` |
| `fail()` | Échec opération | `logger.fail('Chargement', error)` |
| `event()` | Événement DOM | `logger.event('click', el)` |
| `message()` | Communication | `logger.message('sent', 'msg')` |
| `state()` | Changement d'état | `logger.state('Modal', 'open', 'closed')` |
| `checkElement()` | Vérifier élément | `logger.checkElement('id', true)` |
| `time()` | Début chrono | `logger.time('operation')` |
| `timeEnd()` | Fin chrono | `logger.timeEnd('operation')` |
| `summary()` | Résumé | `logger.summary()` |

---

**Auteur**: Équipe Solakvan
**Dernière mise à jour**: 2025-12-29
