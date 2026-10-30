## Composants UI — Modales & Tabs

Fichiers:
- `javascript/components/ErrorModal.js`
- `javascript/components/GraphModal.js`
- `javascript/components/SummaryModal.js`
- `javascript/components/TabsManager.js`

### Rôles
- Modales: affichage d’erreurs, graphiques, résumés
- `TabsManager`: navigation entre sections, publication d’événements

### Lignes directrices
- Déléguer la logique métier hors des composants DOM
- Émettre des `CustomEvents` pour synchroniser la carte et les vues
- Gérer les états de chargement et erreurs



