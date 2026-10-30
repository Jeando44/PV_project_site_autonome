# Schéma unifilaire : accès à la bibliothèque de symboles

État au 2026-10-10 : la **palette de symboles** (panneau de gauche de la modale « Schéma unifilaire »)
est réservée au compte **administrateur**. Les autres utilisateurs gardent tout le reste de l'éditeur.

| Fonction | Administrateur | Utilisateur |
|---|---|---|
| Palette de symboles (glisser-déposer) | oui | **non** (panneau absent) |
| Générer auto, Circuit PV | oui | oui |
| Déplacer, faire pivoter ou supprimer un symbole posé, tracer des liaisons | oui | oui |
| Rectangle, liaison équipotentielle, zoom, libellés câbles | oui | oui |
| Export PDF A4/A3, schéma enregistré (localStorage) | oui | oui |

---

## Réafficher les symboles pour tous les utilisateurs : 1 seule modification

### Option A : modifier le paramètre (recommandé)

**Fichier : [config.py](../config.py), lignes 101-102**, classe `Config` :

```python
# AVANT (palette réservée à l'administrateur)
SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL = os.getenv(
    'SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL', 'true').strip().lower() in ('1', 'true', 'yes', 'on')

# APRÈS (palette ouverte à tous) : remplacer la valeur par défaut 'true' par 'false'
SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL = os.getenv(
    'SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL', 'false').strip().lower() in ('1', 'true', 'yes', 'on')
```

Redémarrez ensuite le serveur. Aucun autre fichier n'est à modifier : le template, l'API et le JS
lisent tous ce paramètre.

### Option B : passer par une variable d'environnement, sans modifier le code

Dans le `.env` (ou les variables d'environnement du service Cloud Run en production) :

```
SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL=false
```

Puis redémarrez le serveur. Attention : la variable d'environnement a la priorité sur la valeur par
défaut écrite dans `config.py`.

---

## Fonctionnement du verrou

Le paramètre est lu à un seul endroit, la fonction `_schema_unifilaire_symboles_autorises()` de
[app/routes/main.py](../app/routes/main.py) (lignes 358-364) :

```python
def _schema_unifilaire_symboles_autorises():
    if not current_app.config.get('SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL', True):
        return True                       # paramètre à False : tout le monde y a accès
    user = getattr(g, 'user', None)
    return bool(user and user.get('is_admin'))
```

Cette fonction est utilisée de deux façons :

1. **Affichage (frontend)** : la route `/concevoir_mon_projet/modal/schema_unifilaire`
   (main.py ligne 355) passe `symboles_autorises` au template
   [schema_unifilaire.html](../app/templates/concevoir_mon_projet/modals/schema_unifilaire/schema_unifilaire.html).
   Lignes 324-329 : `<div id="schema-palette">` n'est rendu que si `symboles_autorises` vaut vrai.
   Ligne 318 : le texte d'aide de la barre d'outils est adapté.
2. **Filet de sécurité (backend)** : la route `GET /concevoir_mon_projet/api/schema_unifilaire/palette`
   (main.py lignes 367-376) répond `403` à un non-administrateur. Dans
   [schema_unifilaire.js](../app/static/concevoir_mon_projet/javascript/systeme/schema_unifilaire.js) :
   - `renderPalette()` (ligne 939) appelle cette API avant de construire la palette. Sans réponse
     `200`, il retire le panneau et ne crée aucun symbole.
   - Le drop sur le canevas (ligne 2992) est refusé tant que `paletteAutorisee` ne vaut pas `true`.
     Recréer le panneau à la main dans les outils du navigateur ne permet donc pas de poser un symbole.

Ces lignes **n'ont pas à être modifiées** pour réouvrir l'accès. Elles sont indiquées ici pour la
maintenance. Si un jour vous voulez retirer complètement le verrou (code mort), voici quoi supprimer :

| Fichier | Lignes | Modification |
|---|---|---|
| `config.py` | 93-102 et 183 | supprimer le paramètre et son export |
| `app/routes/main.py` | 354-355 | revenir à `render_template('…/schema_unifilaire.html')` |
| `app/routes/main.py` | 358-376 | supprimer la fonction et la route API `palette` |
| `schema_unifilaire.html` | 318, 322-329 | retirer les `{% if symboles_autorises %}` |
| `schema_unifilaire.js` | 865-869 | supprimer `paletteAutorisee` |
| `schema_unifilaire.js` | 939-949 | retirer l'appel `fetch` et repasser `renderPalette` en synchrone |
| `schema_unifilaire.js` | 2992 | revenir à `if (!SYMBOL_LIBRARY[type]) return;` |

Pensez ensuite à incrémenter le `?v=` du script dans le template (actuellement `?v=21`).

## Limite connue

Les définitions graphiques des symboles (`SYMBOL_LIBRARY`) restent dans le fichier JS statique, car
« Générer auto » et « Circuit PV » en ont besoin pour dessiner le schéma des utilisateurs. Le verrou
porte donc sur la **palette** (affichage et glisser-déposer), pas sur le code des dessins lui-même.
Un utilisateur avancé qui appelle des fonctions internes depuis la console du navigateur pourrait
encore poser un symbole. Il faudrait alors enregistrer et valider le schéma côté serveur, ce qui
n'est pas le cas aujourd'hui (stockage `localStorage` uniquement).



#################
Pour réafficher les symboles à tous les utilisateurs
Tout passe par un seul paramètre, SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL, dans config.py:101-102. Remplacez la valeur par défaut 'true' par 'false', ou mettez SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL=false dans le .env, puis redémarrez le serveur. Aucun autre fichier n'est à toucher.

Le fichier demandé est docs/schema_unifilaire_symboles_acces.md. Il donne ces deux façons de rouvrir l'accès avec le code avant/après, explique le fonctionnement du verrou et liste fichier par fichier, ligne par ligne, quoi supprimer si vous voulez un jour retirer complètement le verrou.

Limite : les dessins des symboles restent dans le fichier JS, parce que Générer auto et Circuit PV en ont besoin. Un utilisateur averti pourrait encore poser un symbole en appelant directement le code depuis la console du navigateur. Pour l'empêcher vraiment, il faudrait enregistrer et contrôler le schéma côté serveur ; aujourd'hui il n'est stocké que dans le navigateur.

À tester : ouvrez la modale avec le compte admin, puis avec un compte utilisateur, et vérifiez que Générer auto fonctionne pour les deux.