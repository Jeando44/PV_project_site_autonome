# Sauvegarde des données d'un projet : fonctionnement et règles de maintenance

Rédigé le 2026-10-17, après la fiabilisation de la sauvegarde. Document de référence pour toute
correction ou évolution qui touche à l'enregistrement des données d'un projet.

## Objectif

Les données d'un projet doivent être **en base avant** que l'utilisateur quitte l'application,
ouvre un autre projet ou génère un rapport. **C'est la base, et non le localStorage, qui alimente
l'application.** Le localStorage n'est qu'un cache de travail : il est partagé entre tous les
onglets et tous les projets du navigateur, et il a déjà causé des mélanges de données entre projets.

Quatre règles en découlent :

1. **Un seul point d'enregistrement complet**, avec une seule liste de sources de données.
2. **Aucun rapport sur un état absent de la base** : tout échec d'enregistrement bloque le rapport.
3. **Jamais d'écrasement silencieux** : un onglet ou un poste resté sur une ancienne version ne peut
   plus écrire par-dessus un travail plus récent.
4. **Jamais de perte silencieuse** : l'utilisateur est prévenu avant de quitter ou de changer de
   projet avec des données non enregistrées.

## Vue d'ensemble

| Mécanisme | Fichier principal | Rôle |
|---|---|---|
| Enregistrement complet | `app/static/concevoir_mon_projet/javascript/services/sauvegarde_projet.js` | Liste unique des sources, icône « Sauvegarder », fenêtre d'invitation, point orange, alerte de fermeture |
| Version du projet (navigateur) | `app/static/concevoir_mon_projet/javascript/services/version_projet.js` | En-têtes des écritures, détection des conflits, cohérence des caches au chargement |
| Version du projet (serveur) | `app/services/version_projet.py`, `app/models/projet_version.py` | Refus des écritures périmées, numéro de version |
| Verrou de l'onglet | `app/static/concevoir_mon_projet/javascript/services/garde_projet_actif.js` | Bloque tout enregistrement et impose de recharger la page |
| Variantes A-D | `app/services/variantes_projet.py`, `ParametresProjet.js` | Copies figées de l'état en base (inchangé, utilisé par la sauvegarde) |

Ordre de chargement des scripts (il compte) :

1. `components/menu_list.html`, tout en haut : `window.SKV_PROJET_RENDU` (version rendue par le
   serveur), puis `version_projet.js`. Il passe avant tout le reste, car il doit poser
   l'intercepteur `fetch` et vérifier les caches avant que les modules ne les lisent.
2. `components/menu.html` : `garde_projet_actif.js`, puis `sauvegarde_projet.js`.
3. Les modules (calepinage, étude éco, devis, Loi APER...) : ils s'enregistrent eux-mêmes et sont
   appelés par `sauvegarde_projet.js`.

## 1. L'enregistrement complet (`sauvegarde_projet.js`)

### Les sources de données

La fonction `sources()` est la **liste unique**. Les sources sont enregistrées l'une après
l'autre, jamais en parallèle :

| Ordre | Libellé affiché | Module | « Non enregistré » détecté par |
|---|---|---|---|
| 1 | Paramètres du projet | `DataManager` (`parametreProjetFormManager.js`) | `parametresNonEnregistres()` : formulaire ouvert sur le projet actif ET modifié par l'utilisateur |
| 2 | Calepinage | `calepinageService` (`CalepinageDataService.js`) | `modificationsNonEnregistrees()` : cache local ≠ dernier état connu en base |
| 3 | Calepinage des champs PV | `CalepinageMaisonPersistenceDB` | `modificationsNonEnregistreesConnues()` |
| 4 | Loi APER | `calculateurAPERInstance` (`calcul_APER.js`) | `modificationsEnAttente()` |
| 5 | Devis (CAPEX / OPEX) | `ResidentielChiffrage.DB` | `enAttente()` : enregistrement différé en cours ou dernier refus |
| 6 | Étude économique | `EtudesEconomiqueDB` | `enAttente()` : enregistrement différé, en cours ou dernier refus |

Particularités :

- **Paramètres** : envoyés seulement si l'utilisateur les a modifiés (événements `isTrusted` :
  le remplissage du formulaire par script ne compte pas), et jamais le formulaire d'un autre
  projet que le projet actif.
- **Calepinage PRO** : la comparaison ignore les clés que la route de lecture réinjecte depuis
  d'autres tables (`projectInfo`, `meteoData`, `normesElectriques`, `indicesRevision`), celles
  enregistrées par leur propre module (`economicStudyInputs`), les horodatages (`lastSaveTime`, `systemPageLoadedAt` réécrit à chaque chargement de page,
  `geometriePlansData.savedAt`, `totals.lastUpdated` réécrit à chaque mise à jour du résumé) et la vue de la carte (`mapCenter`, `mapZoom`, réécrites toutes les
  3 s par `StorageManager.savePageData` : un simple déplacement de la carte laissait le calepinage
  « non enregistré » en permanence, corrigé le 2026-10-17). Si le dernier état en base est inconnu, il est lu une fois en base
  au premier besoin (`chargerReference`). Le résultat est mémorisé tant que le cache ne change pas
  (gros calepinages).
- **Devis, étude éco, Loi APER** : un enregistrement refusé reste « à enregistrer » et part de
  nouveau au prochain enregistrement complet. Avant, il était simplement oublié.

### Fonctions publiques (`window.SauvegardeProjet`)

| Fonction | Usage |
|---|---|
| `enregistrerDonnees({ parametres })` | Enregistre toutes les sources. Renvoie `{ ok, echecs, message }`. **Tout échec donne `ok: false`.** |
| `sauvegarderProjet()` | Icône « Sauvegarder » : `enregistrerDonnees`, puis puissance projet (source `'sauvegarder'`), puis variante active si elle existe (jamais de création de A ici). Affiche le résultat. |
| `modificationsNonEnregistrees()` | Libellés des données non enregistrées (asynchrone, peut lire la base). |
| `modificationsNonEnregistreesConnues()` | Idem, synchrone, écarts déjà connus seulement (fermeture d'onglet, point orange). |
| `majIndicateur()` | Recalcule le point orange. |
| `autoriserSortie()` | La prochaine sortie de page se fait sans alerte (navigation décidée par le code). |

### Qui appelle l'enregistrement complet

| Geste | Appel | En cas d'échec |
|---|---|---|
| Icône « Sauvegarder » de la palette (`save-projet-button`, `ButtonControl.js`) | `sauvegarderProjet()` | Message d'erreur, rien d'autre |
| Génération du rapport PRO, résidentiel ou pompage (`ExportService.exportPDF` → `UIManager.demanderVarianteRapport`) | `syncAllProjectDataToDatabase` → `enregistrerDonnees()` | **Rapport non généré**, message avec la raison |
| Ouverture d'une variante (pastilles A-D) | `syncAllProjectDataToDatabase` | Variante non ouverte |
| Changement de projet (`selectAndLoadProject`, bouton « Charger » de Mes projets) | `saveCurrentProjectBeforeSwitch` : remet d'abord la session serveur sur le projet de la page (`activateOnServer`, la session a pu basculer avant : création, modification d'un autre projet, chargement d'un calepinage), puis `enregistrerDonnees({ parametres: false })` | Question : rester pour réessayer, ou continuer en perdant les modifications (`confirmerMalgreEchecEnregistrement`) |
| Création d'un projet, ou modification d'un **autre** projet que le projet ouvert (`submitParametreProjet`) | `saveCurrentProjectBeforeSwitch` **avant** l'envoi à `/parametre-projet/creer` ou `/update` (ces routes font du projet enregistré le projet actif de la session : après, toute écriture du projet quitté serait refusée en 409). Le projet quitté est alors noté `projetQuitteEnregistre` : « Ouvrir mon projet » ne le renvoie pas une seconde fois (marque levée dès l'activation du nouveau projet). | Même question ; « Annuler » = projet non créé, projet en cours toujours ouvert |
| « Revenir à Socalts », logo, « Paramètres », « Consommation d'énergie » | Fenêtre « Modifications non enregistrées » : « Annuler », « Continuer sans enregistrer », « Enregistrer et continuer » (sur une ligne) | Bouton « Réessayer » ; « Continuer sans enregistrer » toujours possible |
| Fermeture ou rechargement de l'onglet | Alerte native du navigateur | — |

Les enregistrements existants restent en place : « Calculer et visualiser », enregistrement
automatique du calepinage toutes les 2 minutes (`puissance_projet_sync.js`), enregistrements
différés de l'étude éco, du devis et de la Loi APER, export.

### Fenêtre d'invitation et alerte de fermeture

- Les clics sur les liens surveillés sont interceptés en phase de capture (`LIENS_SURVEILLES`),
  retenus le temps de la vérification, puis rejoués s'il n'y a rien à enregistrer.
- L'alerte de fermeture ne s'affiche ni quand l'onglet est verrouillé, ni pendant un changement,
  une création ou une suppression de projet (`current_projet_id` a changé depuis le chargement de
  la page : ces parcours enregistrent l'ancien projet avant de recharger la page).

### Point orange

Classe `skv-non-enregistre` sur `#save-projet-button`, avec une infobulle qui liste les données
concernées. Après une sauvegarde complète réussie depuis la page (icône ou « Enregistrer et
continuer », événement `projetSauvegarde`), le point passe aussitôt au **vert** (classe
`skv-enregistre`, infobulle « projet enregistré ») et le reste jusqu'à la prochaine modification.
Avant toute sauvegarde sur la page et sans modification : pas de point. Il est recalculé au plus
toutes les 2 s après un geste de l'utilisateur, toutes les 15 s, et après chaque enregistrement.

## 2. Version du projet : protection entre onglets et postes

### Principe (verrou optimiste)

- Table `projet_versions` : une ligne par projet (`version`, `dernier_onglet`, `maj_le`), créée à
  la première écriture.
- Chaque chargement de page tire un identifiant d'onglet. Chaque **écriture** envoie deux
  en-têtes :
  - `X-Skv-Onglet` : l'identifiant de l'onglet ;
  - `X-Skv-Version` : la dernière version que **cet onglet** a lui-même écrite, ou reçue au rendu
    de la page.
- **Règle de refus (409, `conflit_version: true`)** : la version envoyée diffère de la version en
  base **et** la dernière écriture vient d'un **autre** onglet. Les écritures successives ou
  parallèles d'un même onglet passent toujours.
- Après une écriture réussie, la version augmente et revient dans l'en-tête `X-Skv-Version`. Une
  réponse `inchange` / `skipped` / `omitted` ou `success: false` ne la fait pas augmenter.
- Les lectures (GET) renvoient la version, mais **ne font jamais avancer la version connue de
  l'onglet**. Sinon, un onglet resté sur un état périmé pourrait écrire après une simple lecture.
- Sur un refus, l'onglet est verrouillé (`window.verrouillerProjet`) avec l'écran « Projet modifié
  ailleurs » et un bouton « Recharger ». Les modifications de cet onglet sont perdues : c'est voulu.

### Adresses contrôlées

La liste est la même côté serveur (`_FAMILLES`) et côté navigateur (`CHEMINS_PROJET`) : **les deux
doivent rester identiques.**

| Adresse | Méthodes contrôlées |
|---|---|
| `/parametre-projet/<id>/…` (calepinages, étude éco, devis, Loi APER, IRVE, consommation, PAC, pompage, variantes, paramètres) | POST, PUT, PATCH, DELETE |
| `/api/petit_champ/<id>/<pv>/parametres` et `…/dossier` | PUT |
| `/api/dossier_plans/<type>/<id>` | PUT |
| `/api/ombrieres/dossier/<id>` | PUT |

Jamais contrôlées : `/activer`, `/verifier`, `/verifier-totaux`, `/puissance-projet` (valeur
recalculée depuis la base), `…/generer` (génération de dossier, quota), suppression du projet.
Le préfixe `/concevoir_mon_projet` est accepté partout.

### Cas sans contrôle (voulus)

- **Écritures pendant la fermeture de la page** (`beforeunload` / `pagehide`) : envoyées sans
  en-tête, donc ni contrôlées ni comptées. Sinon, la page rechargée verrait l'écriture de la page
  précédente comme venant d'un autre onglet (faux conflit).
- **Anciens scripts encore en cache** (sans en-tête) : comportement d'avant.
- **Table absente** (migration non appliquée) : contrôle ignoré, aucune erreur. C'est pour cela
  que la version est dans une table à part et non dans une colonne de `parametres_projet`, qui
  aurait fait planter toutes les requêtes sur les projets.
- **Projet d'un autre compte** : ni contrôlé ni compté ; c'est la route qui refuse.

### Modales intégrées (iframes)

Les pages chargées dans une modale ont leur propre `window` : l'intercepteur de la page principale
ne les atteint pas. Elles chargent `version_projet.js` en tête de leur `<head>` et **reprennent
l'identifiant et la version de l'onglet parent** (`window.parent.SkvVersionProjet.partage`). Une
chaîne de modales imbriquées fonctionne aussi.

- `modals/irve/app_irve_v1.16.html` (consommation, IRVE, PAC)
- `modals/autoconsommation/index_autoconso.html`
- `modals/geometrie/petit_champ_solaire.html` (paramètres du petit champ)

Effets : une écriture de la modale fait avancer la version de la page principale (pas de faux
conflit), et un conflit détecté dans la modale verrouille la page principale. Une de ces pages
ouverte seule dans un onglet compte comme un onglet à part entière.

## 3. Caches locaux oubliés quand l'utilisateur quitte son travail

Ajouté le 2026-10-18. Si l'utilisateur n'a pas enregistré au moment où il change de projet, se
déconnecte ou ferme sa session, les données du projet sont **supprimées du localStorage** : seule
la dernière version enregistrée en base est conservée. Objectif : aucune donnée en cache à
l'ouverture ou à la création d'un projet. Pas de copie de secours dans ce cas (contrairement au
cas « modifié ailleurs » de la section 4).

Fonction unique : `SkvVersionProjet.oublierCachesProjet(id)` (`version_projet.js`). Elle retire
les clés de `clesCachesProjet()` pour le projet indiqué **et** pour `current_projet_id`, ainsi que
les clés de sessionStorage de l'autoconsommation. La consommation (IndexedDB) est gardée.

| Moment | Où | Détection |
|---|---|---|
| Changement de projet (`selectAndLoadProject`, après création/modification d'un autre projet, « Charger » de Mes projets) | `oublierCachesProjetQuitte` (`parametreProjetFormManager.js`), `MesProjetsModal.loadProjet` | Toujours, enregistré ou non (la question « rester / continuer en perdant » reste posée si l'enregistrement échoue) |
| Déconnexion par inactivité | `logout()` de `components/menu.html` | Toujours |
| Nouvelle session de connexion (déconnexion, session expirée ou fermée) | `version_projet.js`, au chargement, avant les modules | `window.SKV_PROJET_RENDU.session` (identifiant opaque `session['skv_session_caches']`, créé par `_session_caches()` dans `app/routes/main.py`) ≠ `localStorage['skv_session_caches']` |
| Application rouverte (onglet ou navigateur fermé puis rouvert) | `version_projet.js`, au chargement | Marque `sessionStorage['skv_onglet_ouvert']` absente (nouvel onglet) **et** aucun autre onglet vivant dans `localStorage['skv_onglets_vivants']` (signe de vie toutes les 20 s, périmé après 3 min, retiré au `pagehide`) |

Un rechargement ou une navigation dans le même onglet garde les caches (marque sessionStorage
présente). Les modales intégrées (iframes) ne font jamais ce contrôle.

## 4. Cohérence des caches locaux à l'ouverture d'une page

`version_projet.js`, avant tout autre script :

- `localStorage['skv_version_base:<id>']` : version de la base que reflètent les caches de ce
  navigateur. Elle est posée au chargement et après chaque écriture réussie de ce navigateur.
- Si elle diffère de la version rendue par le serveur **et** que la dernière écriture ne vient pas
  d'un onglet récent de ce navigateur (`skv_onglets_recents`, 30 derniers), un autre poste a
  modifié le projet entre-temps. Alors :
  - les caches locaux du projet sont écartés (même liste que `purgerCachesLocauxVariante` +
    `aperPolygonsData`, `solarProjectStable`) ; les données de consommation (IndexedDB) sont gardées ;
  - chaque module recharge la version de la base ;
  - une copie des caches écartés est gardée 30 jours (IndexedDB `skv_secours_caches`) ;
  - un bandeau prévient l'utilisateur et propose « Télécharger la copie écartée » (fichier JSON).
- Première visite (aucune version locale) : caches gardés, version notée.
- Il n'y a **pas de restauration automatique** de la copie : remettre un état ancien par-dessus
  un état récent mélangerait les deux. La copie sert à l'assistance (`SkvVersionProjet.copiesSecours()`
  dans la console).

Rappel : sur la page Calepinage, le calepinage PRO est de toute façon relu en base à chaque
ouverture (`GoogleMaps.js`, `initMap`).

## Règles de maintenance

### Ajouter une nouvelle donnée de projet à enregistrer

1. Côté module : fournir une fonction d'enregistrement qui renvoie `{ success, message }` (et
   `skipped: true` quand il n'y a rien à faire), et une fonction « non enregistré ».
2. L'ajouter dans `sources()` de `sauvegarde_projet.js`, à la bonne place dans l'ordre.
3. Côté serveur, si c'est une nouvelle table liée au projet : la classer dans
   `app/services/variantes_projet.py` (`tables_variante()` ou `TABLES_COMMUNES`).
4. Si la route d'écriture n'est pas sous `/parametre-projet/<id>/`, ajouter l'adresse **dans les
   deux listes** `_FAMILLES` (serveur) et `CHEMINS_PROJET` (navigateur).
5. Si une réponse « rien n'a changé » est possible, renvoyer `inchange: true` (ou `skipped`) pour
   ne pas faire avancer la version.

### Ajouter une modale intégrée (iframe) qui enregistre

Charger `/static/concevoir_mon_projet/javascript/services/version_projet.js?v=…` **en premier**
dans son `<head>`. Sans cela, ses écritures ne seront ni contrôlées ni comptées.

### Ajouter une clé localStorage liée à un projet

Elle doit porter l'identifiant du projet, et elle doit être ajoutée à `clesCachesProjet()`
(`version_projet.js`) et à `purgerCachesLocauxVariante()` (`parametreProjetFormManager.js`) si le
module sait se recharger depuis la base quand elle est absente.

### Changer un script

- Augmenter son `?v=` (cache navigateur d'un jour), en relisant d'abord la valeur actuelle.
- Un module importé à plusieurs endroits doit avoir **le même `?v=` partout**, sinon deux
  instances coexistent : `MesProjetsModal.js` (`index.html` + import dynamique dans
  `parametreProjetFormManager.js`), `ExportService.js` (3 importeurs), `CalepinageDataService.js`
  (importé sans `?v=`).

### Ne pas faire

- Ne pas faire avancer la version connue sur une lecture.
- Ne pas envoyer les en-têtes pendant la fermeture de la page.
- Ne pas déplacer la version dans une colonne de `parametres_projet`.
- Ne pas rendre un échec d'enregistrement « non bloquant » pour le rapport.
- Ne pas réactiver une sauvegarde automatique aveugle (minuterie sans détection de
  modification) : c'est elle qui avait causé les corruptions entre projets en juillet 2026.

## Base de données

- Migration `migrations/versions/a7d3e9f1c2b4_projet_versions.py` (révise `f2c7a9d4e6b1`),
  appliquée automatiquement au déploiement (`flask preparer-base`) ; idempotente.
- En local, la table est créée au démarrage par `create_all`.
- `projet_versions` est commune à toutes les variantes (`TABLES_COMMUNES`).

## Tests

Les bancs se trouvent dans `tests/sauvegarde_projet/`. Ce dossier est ignoré par git : en garder
une copie.

| Fichier | Commande | Couvre |
|---|---|---|
| `test_version_serveur.py` | `Skvenv313/Scripts/python.exe tests/sauvegarde_projet/test_version_serveur.py` | Règles de version côté serveur (22 contrôles). Mini-application Flask + SQLite temporaire : **ne touche jamais la base de dev**. |
| `banc_fiabilite.py` | `python tests/sauvegarde_projet/banc_fiabilite.py` | Navigateur (Playwright), faux serveur : enregistrement complet, échec bloquant, point orange, Paramètres, conflit, caches écartés, modales intégrées (36 contrôles). |
| `banc_sauvegarde.py` | `python tests/sauvegarde_projet/banc_sauvegarde.py` | Fenêtre d'invitation, icône, alerte de fermeture, Socalts (9 contrôles). |
| `test_etape1.js` | `node tests/sauvegarde_projet/test_etape1.js` | Question posée avant de changer de projet si l'enregistrement échoue. |

Tests manuels à refaire après une modification de la sauvegarde :

1. Même projet dans deux onglets : enregistrer dans l'un, puis modifier dans l'autre → « Projet
   modifié ailleurs ».
2. Idem, en enregistrant depuis la modale Consommation / IRVE dans le premier onglet.
3. Rapport avec un champ du devis invalide → rapport non généré, message clair.
4. Modifier le calepinage, puis cliquer sur « Paramètres » → fenêtre d'invitation ; point orange
   présent puis retiré après « Sauvegarder ».
5. Changer de projet avec une modification non enregistrée et la connexion coupée → question
   « rester / continuer ».

## Dépannage

| Symptôme | Cause probable | Où regarder |
|---|---|---|
| « Projet modifié ailleurs » sans autre onglet ouvert | Écriture d'un ancien onglet ou d'une modale ouverte seule ; script d'une modale non chargé avec l'onglet parent | Console : `SkvVersionProjet.integre` dans la modale ; table `projet_versions.dernier_onglet` |
| Rapport refusé « Enregistrement impossible : X » | La source X a renvoyé `success: false` | Message et console `[SauvegardeProjet]` |
| « Devis (CAPEX / OPEX) (Champ invalide : …) » sans avoir ouvert l'étude éco | Valeur du devis enregistré hors des bornes du profil courant (rési / PRO), souvent après un changement de typologie ou de type de projet. Le contrôle porte sur les données (`Capex.erreursValidation()`, mêmes règles que `validate_capex_business_rules`), pas sur le DOM ; le message nomme le poste, la ligne et la plage | Console : `ResidentielChiffrage.Capex.erreursValidation()`. Une quantité imposée par le calepinage (lecture seule) ne doit jamais avoir une borne plus étroite que le calepinage (cas du 2026-10-26 : 666 panneaux, borne rési 250, projet Site autonome d'une typologie PRO) |
| Point orange qui ne disparaît pas | Une source se dit « non enregistrée » en permanence | Infobulle de l'icône ; pour le calepinage PRO, `calepinageService.ecartsNonEnregistres(true)` dans la console donne les chemins qui diffèrent avec les deux valeurs (après `await calepinageService.chargerReference()` si la page vient d'être rechargée) : clé réinjectée par la route de lecture ou réécrite sans geste de l'utilisateur, à ajouter dans `CLES_HORS_COMPARAISON` |
| Bandeau « données écartées » inattendu | Version locale ≠ version en base, écrite par un autre poste | `localStorage['skv_version_base:<id>']`, `SkvVersionProjet.copiesSecours()` |
| Écritures jamais comptées | Adresse absente de `_FAMILLES` / `CHEMINS_PROJET`, ou modale sans le script | Les deux listes ; en-têtes de la requête dans l'onglet Réseau |

## Limites connues

- Onglet gelé par le navigateur (économiseur de mémoire) plus de 3 min : un nouvel onglet le croit
  fermé et oublie les caches qu'il utilisait encore. Idem pour un onglet resté sur l'ancien script
  (sans signe de vie) juste après une mise en ligne.
- Navigateur qui restaure ses onglets avec leur sessionStorage : pas d'oubli à la réouverture,
  sauf si la session de connexion a changé entre-temps.

- Les écritures faites hors de ces adresses (configurateurs de géométrie qui n'enregistrent que
  dans le navigateur, autres modules) ne sont pas contrôlées par la version.
- Les écritures en XMLHttpRequest / jQuery `$.ajax` ne passent pas par l'intercepteur `fetch`.
- Après un conflit, les modifications de l'onglet bloqué ne sont pas récupérables automatiquement.
- `ExportService.choisirVarianteDuRapport` génère le rapport sans enregistrer si
  `window.uiManagerInstance` est absent. Ce cas ne se produit sur aucune des 7 pages actuelles ;
  à traiter si une nouvelle page propose le rapport.
